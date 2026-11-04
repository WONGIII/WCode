import {
  SESSION_ENTRY_CONTEXT_USAGE_BREAKDOWN,
  type ContextUsageBreakdownItem,
} from "@zcode/contracts";
import { createModelUsageSummaryFromEvents, traceContextToLogContext } from "../deps.js";
import type { MessageId, MessageWithParts, Model, ModelUsage, TraceContext } from "../deps.js";
import type { MainTurnCacheHitAggregate, RuntimeModelTextResult } from "../types.js";
import type { AgentRuntimeInternal } from "../internal.js";
import type { RegularTurnLoopState } from "./turn-loop-state.js";
import type { RuntimeMessageEntry } from "../../agent/message-history.js";
import {
  persistedTokenUsageBaseline,
  type PersistedTokenUsageBaseline,
} from "../../agent/message-history-usage.js";
import { recordModelUsageFact } from "./usage-observability.js";

interface RecordMainTurnModelUsageInput {
  assistantMessageId: MessageId;
  error?: unknown;
  model: Model;
  modelTraceContext: TraceContext;
  networkEventStartIndex: number;
  result?: RuntimeModelTextResult;
  startedAt: number;
  status: "completed" | "error" | "cancelled";
  toolCallCount?: number;
}

export async function recordMainTurnModelUsage(
  runtime: AgentRuntimeInternal,
  state: RegularTurnLoopState,
  input: RecordMainTurnModelUsageInput,
): Promise<void> {
  // 失败请求的已报告消耗在恢复前结算，成功路径仍使用原有计数。
  if (!input.result) {
    state.tokenCount +=
      createModelUsageSummaryFromEvents(state.events.slice(input.networkEventStartIndex))
        ?.totalTokens ?? 0;
  }
  await recordModelUsageFact(runtime, {
    assistantMessageId: input.assistantMessageId,
    error: input.error,
    events: state.events,
    // 运行中切模会立即更新 Session Selection；usage 若在 await 后重新读取它，
    // 就会把旧请求的 token 归到新模型。这里只消费 model step 开始时的不可变快照。
    model: input.model,
    networkEventStartIndex: input.networkEventStartIndex,
    parentUserMessageId: state.currentUserMessageId,
    querySource: querySourceForTask(runtime.config.taskType),
    result: input.result,
    startedAt: input.startedAt,
    status: input.status,
    toolCallCount: input.toolCallCount,
    traceContext: input.modelTraceContext,
  });
}

export function querySourceForTask(taskType: AgentRuntimeInternal["config"]["taskType"]): string {
  if (taskType === "subagent_child") return "subagent";
  if (taskType === "workflow_child" || taskType === "nested_workflow_child")
    return "workflow_child";
  return "main_turn";
}

interface PersistedContextUsageBreakdownEntry {
  breakdown: ContextUsageBreakdownItem[];
  used: number;
  contextWindow?: number;
}

/**
 * 持久化最近一次主轮请求的 context 来源占比。
 *
 * ModelComplete 只存在于进程内 eventStore，冷启动后 `resolveSessionContextUsage`
 * 拿不到 breakdown，上下文弹窗在发消息前只剩总量和缓存命中率。
 * 这里把 breakdown 连同当时的 used/size 一起写成 session entry，
 * 冷恢复时会用 used/size 对齐校验，避免把旧分支或压缩前的比例挂到当前窗口上。
 */
export async function persistContextUsageBreakdown(
  runtime: AgentRuntimeInternal,
  input: {
    breakdown: ContextUsageBreakdownItem[] | undefined;
    contextWindow: number | undefined;
    used: number | undefined;
    traceContext: TraceContext;
  },
): Promise<void> {
  const { breakdown, contextWindow, used, traceContext } = input;
  if (!runtime.sessionStore?.saveSessionEntry) return;
  if (!breakdown || breakdown.length === 0 || used === undefined || used <= 0) return;

  const timestamp = Date.now();
  try {
    await runtime.sessionStore.saveSessionEntry({
      id: `${runtime.sessionId}:runtime-context-usage-breakdown`,
      sessionID: runtime.sessionId,
      type: SESSION_ENTRY_CONTEXT_USAGE_BREAKDOWN,
      // 展示偏好快照不是用户活动，不能刷新会话活跃时间。
      touchSession: false,
      time: { created: timestamp, updated: timestamp },
      data: {
        breakdown,
        used,
        ...(contextWindow !== undefined && contextWindow > 0 ? { contextWindow } : {}),
      } satisfies PersistedContextUsageBreakdownEntry,
    });
  } catch (error) {
    runtime.logger?.warn("Failed to persist context usage breakdown", {
      ...traceContextToLogContext(traceContext),
      errorMessage: error instanceof Error ? error.message : String(error),
      event: "context_usage.breakdown.persist_failed",
      module: "core.runtime",
      status: "failed",
    });
  }
}

export function findLatestCommittedAssistantUsage(
  sourceEntries: readonly (RuntimeMessageEntry | undefined)[],
): { messageIndex: number; baseline: PersistedTokenUsageBaseline } | undefined {
  for (let messageIndex = sourceEntries.length - 1; messageIndex >= 0; messageIndex--) {
    const entry = sourceEntries[messageIndex];
    if (!entry || entry.kind === "attachment" || entry.message.role !== "assistant") continue;
    const baseline = persistedTokenUsageBaseline(entry.tokens);
    if (baseline) return { messageIndex, baseline };
  }
  return undefined;
}

export function mainTurnCacheHitAggregateFromMessages(input: {
  activeMessages: readonly MessageWithParts[];
  persistedMessages: readonly MessageWithParts[];
}): MainTurnCacheHitAggregate {
  const activeMessageIds = new Set(input.activeMessages.map((message) => message.info.id));

  return input.persistedMessages.reduce<MainTurnCacheHitAggregate>(
    (aggregate, message) => {
      if (
        !activeMessageIds.has(message.info.id) ||
        message.info.role !== "assistant" ||
        message.info.summary
      ) {
        return aggregate;
      }

      // activeMessages 是 provider/context projection，Compact preserved usage
      // 可能已被清零。active IDs 只决定分支成员，cache aggregate 必须读取持久化原始 tokens。
      const inputTokens = nonNegativeInteger(message.info.tokens.input) ?? 0;
      const cacheReadTokens = nonNegativeInteger(message.info.tokens.cache.read) ?? 0;
      const cacheWriteTokens = nonNegativeInteger(message.info.tokens.cache.write) ?? 0;
      if (inputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
        return aggregate;
      }

      return {
        requestCount: aggregate.requestCount + 1,
        totalInputTokens: aggregate.totalInputTokens + inputTokens,
        totalCacheReadTokens: aggregate.totalCacheReadTokens + cacheReadTokens,
        totalCacheWriteTokens: aggregate.totalCacheWriteTokens + cacheWriteTokens,
      };
    },
    {
      requestCount: 0,
      totalInputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
    },
  );
}

export function recordMainTurnCacheHitUsage(
  runtime: AgentRuntimeInternal,
  usage: ModelUsage | undefined,
):
  | {
      cacheReadTokens: number;
      cacheWriteTokens: number;
      hitRate: number | null;
      hitRateRequestCount: number;
      inputTokens: number;
      latestHitRate: number | null;
      totalCacheReadTokens: number;
      totalCacheWriteTokens: number;
      totalInputTokens: number;
    }
  | undefined {
  if (!usage) {
    return undefined;
  }
  // AI SDK v6 已把 Anthropic cache read/write 并入 inputTokens；
  // 缓存命中率的分母应使用 total input，不能再把 cache 字段重复加到分母或上下文用量里。
  const inputTokens = modelUsageInputWindowTokens(usage) ?? 0;
  const cacheReadTokens = nonNegativeInteger(usage.cacheReadTokens) ?? 0;
  const cacheWriteTokens = nonNegativeInteger(usage.cacheWriteTokens) ?? 0;
  if (inputTokens <= 0 && cacheReadTokens <= 0 && cacheWriteTokens <= 0) {
    return undefined;
  }

  runtime.mainTurnCacheHitAggregate = {
    requestCount: runtime.mainTurnCacheHitAggregate.requestCount + 1,
    totalInputTokens: runtime.mainTurnCacheHitAggregate.totalInputTokens + inputTokens,
    totalCacheReadTokens: runtime.mainTurnCacheHitAggregate.totalCacheReadTokens + cacheReadTokens,
    totalCacheWriteTokens:
      runtime.mainTurnCacheHitAggregate.totalCacheWriteTokens + cacheWriteTokens,
  };

  const aggregate = runtime.mainTurnCacheHitAggregate;
  return {
    inputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    latestHitRate: inputTokens > 0 ? cacheReadTokens / inputTokens : null,
    hitRate:
      aggregate.totalInputTokens > 0
        ? aggregate.totalCacheReadTokens / aggregate.totalInputTokens
        : null,
    hitRateRequestCount: aggregate.requestCount,
    totalInputTokens: aggregate.totalInputTokens,
    totalCacheReadTokens: aggregate.totalCacheReadTokens,
    totalCacheWriteTokens: aggregate.totalCacheWriteTokens,
  };
}

function modelUsageInputWindowTokens(usage?: ModelUsage): number | undefined {
  if (!usage) return undefined;

  // core test/runtime 通过包入口解析 @zcode/contracts，新增 contracts helper 在未构建时不可用。
  // 这里保留同一算法：按 Anthropic 口径把 cache read 并入当前请求的 input window。
  const inputTokens = positiveInteger(usage.inputTokens);
  if (inputTokens !== undefined) {
    // AI SDK v6 的 Anthropic inputTokens 已经是普通输入 + cache read/write 的 total input。
    // 统一使用 provider 已归一化的 input，避免自动压缩和 UI context meter 重复计算 cache。
    return inputTokens;
  }

  const totalTokens = positiveInteger(usage.totalTokens);
  if (totalTokens !== undefined) {
    const outputTokens = nonNegativeInteger(usage.outputTokens) ?? 0;
    return Math.max(0, totalTokens - outputTokens);
  }

  const cacheTokens =
    (nonNegativeInteger(usage.cacheReadTokens) ?? 0) +
    (nonNegativeInteger(usage.cacheWriteTokens) ?? 0);
  return cacheTokens > 0 ? cacheTokens : undefined;
}

function positiveInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

function nonNegativeInteger(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const integer = Math.floor(value);
  return integer >= 0 ? integer : undefined;
}
