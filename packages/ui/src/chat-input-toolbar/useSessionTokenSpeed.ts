import { useEffect, useMemo, useState } from "react";
import type {
  SessionDebugNetworkEntry,
  SessionDebugRound,
  SessionDebugSnapshot,
} from "@zcode/shared";
import { useSessionDebug } from "@/hooks/useSessionDebug.js";
import type { ContextCumulativeTokens } from "@/chat-input-toolbar/contextUsage.js";

/** 首 token 平均 TTFT 与会话总耗时都来自调试快照的 round 序列，这里只做聚合。 */
export interface SessionTokenSpeedSummary {
  /**
   * 整个会话的平均生成速度（token/s）。
   *
   * 口径是「所有主轮输出 token 之和 / 所有主轮生成耗时之和」，
   * 而不是每轮速度的算术平均：短轮次不应该和长轮次权重相同。
   */
  averageTokensPerSecond: number | null;
  /** 全会话首 token 延迟平均值（毫秒）；无有效样本时为 null。 */
  averageTtftMs: number | null;
  /** 会话总用时（毫秒，从最早 round 起点到最晚 round 结束）；无数据时为 null。 */
  sessionDurationMs: number | null;
  /** 有效 TTFT 样本数，用于弹窗里说明均值口径。 */
  ttftSampleCount: number;
  /** 当前是否有主轮模型请求仍在生成；为真时总用时按当前时刻实时增长。 */
  hasActiveRequest: boolean;
}

const EMPTY_SUMMARY: SessionTokenSpeedSummary = {
  averageTokensPerSecond: null,
  averageTtftMs: null,
  sessionDurationMs: null,
  ttftSampleCount: 0,
  hasActiveRequest: false,
};

/**
 * 是否存在尚未收到 completed / failed 的主轮请求。
 *
 * rounds 只包含已完成的请求，因此流式生成期间用它计算「会话总用时」会一直
 * 停在上一次完成时刻，等本轮结束才跳变。这里从调试快照的网络事件里找
 * 最新一次 main_turn started，并且只认晚于最后一轮完成时间的请求，
 * 避免历史残留的 started 事件让用时无限增长。
 */
function hasActiveMainTurnRequest(
  rounds: readonly SessionDebugRound[],
  networkEntries: readonly SessionDebugNetworkEntry[],
): boolean {
  let latestRoundEnd = 0;
  const startedAt = new Map<string, number>();
  const settledAt = new Map<string, number>();

  const settle = (requestId: string, at: number) => {
    const previous = settledAt.get(requestId) ?? 0;
    if (at > previous) {
      settledAt.set(requestId, at);
    }
  };

  for (const round of rounds) {
    if (!Number.isFinite(round.recordedAt)) {
      continue;
    }
    settle(round.requestId, round.recordedAt);
    latestRoundEnd = Math.max(latestRoundEnd, round.recordedAt);
  }

  for (const entry of networkEntries) {
    if (
      entry.statusType === "model_request_completed" ||
      entry.statusType === "model_request_failed"
    ) {
      if (entry.requestId) {
        settle(entry.requestId, entry.recordedAt);
      }
      continue;
    }
    if (entry.statusType !== "model_request_started") {
      continue;
    }
    if (entry.querySource !== undefined && entry.querySource !== "main_turn") {
      continue;
    }
    if (!entry.requestId) {
      continue;
    }
    // 重试会以同一个 requestId 再次 started；只保留最后一次开始时间，
    // 这样「失败 → 重试」不会因为先前的 failed 事件被误判为已结束。
    const previous = startedAt.get(entry.requestId) ?? 0;
    if (entry.recordedAt > previous) {
      startedAt.set(entry.requestId, entry.recordedAt);
    }
  }

  for (const [requestId, started] of startedAt) {
    if (started <= (settledAt.get(requestId) ?? 0)) {
      continue;
    }
    // 历史残留的 started（请求被取消且没有终态事件）不能被当作仍在生成：
    // 后续任何一轮已完成就说明它早已过期。
    if (started > latestRoundEnd) {
      return true;
    }
  }
  return false;
}

/**
 * 全会话平均速度：总输出 token / 总生成耗时。
 *
 * 只累计 outputTokens 与 generationDurationMs 都有效的轮次；
 * 用真实生成时长做分母，避免把排队、工具执行等空档算进模型速度。
 */
function resolveAverageTokensPerSecond(rounds: readonly SessionDebugRound[]): number | null {
  let totalOutputTokens = 0;
  let totalGenerationMs = 0;

  for (const round of rounds) {
    const outputTokens = round.usage.outputTokens;
    const generationMs = round.generationDurationMs;
    if (
      outputTokens === undefined ||
      !Number.isFinite(outputTokens) ||
      outputTokens < 0 ||
      generationMs === null ||
      !Number.isFinite(generationMs) ||
      generationMs <= 0
    ) {
      continue;
    }
    totalOutputTokens += outputTokens;
    totalGenerationMs += generationMs;
  }

  if (totalGenerationMs <= 0) {
    return null;
  }

  const average = (totalOutputTokens * 1_000) / totalGenerationMs;
  return Number.isFinite(average) && average > 0 ? average : null;
}

export function summarizeSessionTokenSpeed(
  rounds: readonly SessionDebugRound[],
  networkEntries: readonly SessionDebugNetworkEntry[] = [],
  now: number = Date.now(),
  sessionTotals?: SessionDebugSnapshot["sessionTotals"],
): SessionTokenSpeedSummary {
  if (rounds.length === 0 && !sessionTotals) {
    return EMPTY_SUMMARY;
  }

  let ttftTotal = 0;
  let ttftSampleCount = 0;
  // recordedAt 是本轮结束时刻；减去 generationDurationMs 得到本轮生成起点。
  // 会话跨度取「最早起点 → 最晚结束」，只覆盖真正在跑模型的区间。
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;

  for (const round of rounds) {
    const ttft = round.timeToFirstContentMs;
    if (ttft !== null && ttft !== undefined && Number.isFinite(ttft) && ttft >= 0) {
      ttftTotal += ttft;
      ttftSampleCount += 1;
    }

    if (!Number.isFinite(round.recordedAt)) {
      continue;
    }

    const generationDurationMs = round.generationDurationMs;
    const start =
      generationDurationMs !== null && Number.isFinite(generationDurationMs)
        ? round.recordedAt - generationDurationMs
        : round.recordedAt;
    if (earliestStart === null || start < earliestStart) {
      earliestStart = start;
    }
    if (latestEnd === null || round.recordedAt > latestEnd) {
      latestEnd = round.recordedAt;
    }
  }

  // rounds 只覆盖本进程观察到的轮次（以及最近 200 条），不能代表整个会话。
  // 会话起点、终点、输出 token 与生成时长优先取全量聚合值。
  const hasActiveRequest = hasActiveMainTurnRequest(rounds, networkEntries);
  // 生成中的轮次还没有 round 记录，用当前时刻补上末尾，让总用时连续增长而不是等结束才跳变。
  const idleEnd = Math.max(latestEnd ?? 0, sessionTotals?.latestCompletedAt ?? 0);
  const effectiveEnd = hasActiveRequest ? Math.max(idleEnd, now) : idleEnd > 0 ? idleEnd : null;
  const sessionStart = sessionTotals?.earliestStartedAt ?? earliestStart;
  const sessionDurationMs =
    sessionStart !== null && effectiveEnd !== null && effectiveEnd > sessionStart
      ? effectiveEnd - sessionStart
      : null;

  const sessionAverage =
    sessionTotals && sessionTotals.generationDurationMs > 0
      ? (sessionTotals.outputTokens * 1_000) / sessionTotals.generationDurationMs
      : null;
  const averageTokensPerSecond =
    sessionAverage !== null && Number.isFinite(sessionAverage) && sessionAverage > 0
      ? sessionAverage
      : resolveAverageTokensPerSecond(rounds);

  const averageTtftMs =
    sessionTotals && sessionTotals.ttftSampleCount > 0
      ? sessionTotals.ttftTotalMs / sessionTotals.ttftSampleCount
      : ttftSampleCount > 0
        ? ttftTotal / ttftSampleCount
        : null;

  return {
    averageTokensPerSecond,
    averageTtftMs,
    sessionDurationMs,
    ttftSampleCount: sessionTotals?.ttftSampleCount ?? ttftSampleCount,
    hasActiveRequest,
  };
}

/**
 * 读取当前会话的 token 速度摘要。
 *
 * 数据来自开发者工具的同一份调试快照。快照本身是 Agent 进程内存态，
 * 进程重启后会为空；此时后端 querySessionDebug 会自动从持久化的
 * model_usage 记录重建 rounds（含 TTFT 与耗时），因此这里只需消费结果，
 * 不需要前端再额外读磁盘。
 */
export function useSessionTokenSpeed({
  workspacePath,
  workspaceIdentity,
  taskId,
  enabled = true,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
  enabled?: boolean;
}): SessionTokenSpeedSummary {
  const { rounds, networkEntries, sessionTotals } = useSessionDebug({
    workspacePath,
    workspaceIdentity,
    taskId,
    enabled,
  });

  // 生成期间调试快照每秒才刷新一次；额外用本地时钟推进总用时，
  // 避免弹窗里的「总用时」只在轮次结束时跳一下。
  const [tick, setTick] = useState(0);
  const summary = useMemo(
    () => summarizeSessionTokenSpeed(rounds, networkEntries, Date.now(), sessionTotals),
    [networkEntries, rounds, sessionTotals, tick],
  );
  useEffect(() => {
    if (!summary.hasActiveRequest) {
      return;
    }
    const timer = window.setInterval(() => setTick((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [summary.hasActiveRequest]);

  return summary;
}

/**
 * 读取会话全量累计用量。
 *
 * 用快照里的 persistentCumulative（后端按全量 model_usage 求和），
 * 而不是对 rounds 求和——rounds 有 200 条上限，长会话会缩水。
 *
 * 同时返回 loading：首帧数据未到时为 true，调用方据此推迟渲染，
 * 避免先渲染「仅容量条」的原版形态、再闪成完整版。
 */
export function useSessionCumulativeUsage({
  workspacePath,
  workspaceIdentity,
  taskId,
  enabled = true,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
  enabled?: boolean;
}): { cumulative: ContextCumulativeTokens | null; loading: boolean } {
  const { persistentCumulative, sessionId, error } = useSessionDebug({
    workspacePath,
    workspaceIdentity,
    taskId,
    enabled,
  });

  const cumulative = useMemo(() => {
    if (!persistentCumulative) {
      return null;
    }
    const { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } = persistentCumulative;
    const hasAny =
      inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0 || cacheWriteTokens > 0;
    return hasAny ? { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } : null;
  }, [persistentCumulative]);

  // sessionId 为空表示快照尚未返回（useSessionDebug 的 EMPTY_DEBUG 占位）。
  // 设 2 秒上限：后端异常或会话不存在时不能永久隐藏触发器。
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (!taskId || !enabled || sessionId) {
      setTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setTimedOut(true), 2000);
    return () => window.clearTimeout(timer);
  }, [taskId, enabled, sessionId]);

  const loading = Boolean(taskId) && enabled && !sessionId && !error && !timedOut;

  return { cumulative, loading };
}

/** 弹窗里的用量分类行；顺序即展示顺序。 */
export interface SessionTokenUsageRow {
  key: "input" | "output" | "reasoning" | "cachedInput" | "cachedWrite";
  tokens: number;
}

export interface SessionTokenUsageTotals {
  totalTokens: number;
  rows: SessionTokenUsageRow[];
}

/**
 * 汇总整段会话的 token 用量并按类型分类。
 *
 * 口径说明：totalToken 优先用协议给的 totalTokens；缺失时回退为 input+output。
 * 缓存读 token 已包含在 inputTokens 内，因此分类行里单独列出但不重复计入总量。
 */
export function summarizeSessionTokenUsage(
  rounds: readonly SessionDebugRound[],
): SessionTokenUsageTotals | null {
  if (rounds.length === 0) {
    return null;
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let reportedTotal = 0;
  let hasReportedTotal = false;
  let reasoningTokens = 0;
  let cachedInputTokens = 0;
  let cachedWriteInputTokens = 0;
  let hasAny = false;

  for (const round of rounds) {
    const usage = round.usage;
    if (!usage) {
      continue;
    }

    if (usage.inputTokens !== undefined) {
      inputTokens += usage.inputTokens;
      hasAny = true;
    }
    if (usage.outputTokens !== undefined) {
      outputTokens += usage.outputTokens;
      hasAny = true;
    }
    if (usage.totalTokens !== undefined) {
      reportedTotal += usage.totalTokens;
      hasReportedTotal = true;
    }
    if (usage.reasoningTokens !== undefined) {
      reasoningTokens += usage.reasoningTokens;
    }
    if (usage.cachedInputTokens !== undefined) {
      cachedInputTokens += usage.cachedInputTokens;
    }
    if (usage.cachedWriteInputTokens !== undefined) {
      cachedWriteInputTokens += usage.cachedWriteInputTokens;
    }
  }

  if (!hasAny) {
    return null;
  }

  const totalTokens = hasReportedTotal ? reportedTotal : inputTokens + outputTokens;
  const rows: SessionTokenUsageRow[] = [
    { key: "input", tokens: inputTokens },
    { key: "output", tokens: outputTokens },
    { key: "reasoning", tokens: reasoningTokens },
    { key: "cachedInput", tokens: cachedInputTokens },
    { key: "cachedWrite", tokens: cachedWriteInputTokens },
  ].filter((row) => row.tokens > 0) as SessionTokenUsageRow[];

  return { totalTokens, rows };
}
