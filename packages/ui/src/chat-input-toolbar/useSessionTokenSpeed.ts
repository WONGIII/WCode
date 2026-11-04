import { useEffect, useMemo, useState } from "react";
import type { SessionDebugRound } from "@zcode/shared";
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
}

const EMPTY_SUMMARY: SessionTokenSpeedSummary = {
  averageTokensPerSecond: null,
  averageTtftMs: null,
  sessionDurationMs: null,
  ttftSampleCount: 0,
};

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
): SessionTokenSpeedSummary {
  if (rounds.length === 0) {
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

  const sessionDurationMs =
    earliestStart !== null && latestEnd !== null && latestEnd > earliestStart
      ? latestEnd - earliestStart
      : null;

  return {
    averageTokensPerSecond: resolveAverageTokensPerSecond(rounds),
    averageTtftMs: ttftSampleCount > 0 ? ttftTotal / ttftSampleCount : null,
    sessionDurationMs,
    ttftSampleCount,
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
  const { rounds } = useSessionDebug({
    workspacePath,
    workspaceIdentity,
    taskId,
    enabled,
  });

  return useMemo(() => summarizeSessionTokenSpeed(rounds), [rounds]);
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
