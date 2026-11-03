import { useMemo } from "react";
import type { SessionDebugRound } from "@zcode/shared";
import type { ZCodeModelTrajectoryRecord } from "@zcode/services";
import { useSessionDebug } from "@/hooks/useSessionDebug.js";
import { useModelTrajectory } from "@/hooks/useModelTrajectory.js";

/** 首 token 平均 TTFT 与会话总耗时都来自调试快照的 round 序列，这里只做聚合。 */
export interface SessionTokenSpeedSummary {
  /** 最近一轮的生成速度（token/s）；无有效数据时为 null。 */
  latestTokensPerSecond: number | null;
  /** 全会话首 token 延迟平均值（毫秒）；无有效样本时为 null。 */
  averageTtftMs: number | null;
  /** 会话总用时（毫秒，从最早 round 起点到最晚 round 结束）；无数据时为 null。 */
  sessionDurationMs: number | null;
  /** 有效 TTFT 样本数，用于弹窗里说明均值口径。 */
  ttftSampleCount: number;
}

const EMPTY_SUMMARY: SessionTokenSpeedSummary = {
  latestTokensPerSecond: null,
  averageTtftMs: null,
  sessionDurationMs: null,
  ttftSampleCount: 0,
};

/** 取最近一个有值的速度；rounds 按时间顺序追加，倒序找第一个有效值即可。 */
function resolveLatestTokensPerSecond(
  rounds: readonly SessionDebugRound[],
): number | null {
  for (let index = rounds.length - 1; index >= 0; index -= 1) {
    const value = rounds[index]?.tokensPerSecond;
    if (value !== null && value !== undefined && Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  return null;
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
    latestTokensPerSecond: resolveLatestTokensPerSecond(rounds),
    averageTtftMs: ttftSampleCount > 0 ? ttftTotal / ttftSampleCount : null,
    sessionDurationMs,
    ttftSampleCount,
  };
}

/**
 * 读取当前会话的 token 速度摘要。
 *
 * 数据来源优先级：
 * 1. 实时调试快照（useSessionDebug）——包含精确的 TTFT 与 token/s；
 * 2. 磁盘轨迹回退（useModelTrajectory）——快照只存在于 Agent 进程内存，
 *    进程重启后为空，此时改读已落盘的 model-io 记录重建同样口径的摘要。
 *
 * 因此旧会话与重启后的会话也能看到数值，无需新会话重建或数据库迁移。
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

  const liveSummary = useMemo(() => summarizeSessionTokenSpeed(rounds), [rounds]);

  // 仅在实时快照无数据时才启用轨迹查询，避免每个会话都读一次磁盘。
  const needsTrajectoryFallback = enabled && liveSummary.latestTokensPerSecond === null;
  const { data: trajectory } = useModelTrajectory(
    workspacePath,
    needsTrajectoryFallback ? taskId : null,
    workspaceIdentity,
  );

  return useMemo(() => {
    if (liveSummary.latestTokensPerSecond !== null) {
      return liveSummary;
    }
    if (!trajectory) {
      return liveSummary;
    }
    const persisted = summarizeTrajectoryTokenSpeed(trajectory.records ?? []);
    // 轨迹没有任何可用数值时仍返回实时结果，避免把「有 TTFT 但无速度」冲掉。
    return persisted.latestTokensPerSecond === null &&
      persisted.averageTtftMs === null &&
      persisted.sessionDurationMs === null
      ? liveSummary
      : persisted;
  }, [liveSummary, trajectory]);
}

/**
 * 从落盘的 model-io 记录重建速度摘要。
 *
 * 口径与实时快照保持一致：
 * - token/s = 该次调用的 outputTokens ÷ 生成耗时；
 *   落盘记录只有整次调用耗时 durationMs，没有「首 token 到结束」的精确区间，
 *   因此用 durationMs 近似，数值会略低于实时口径（偏保守）。
 * - TTFT 无法从落盘记录还原（没有首 token 时间戳），保持 null 并让样本数为 0，
 *   弹窗据此显示「暂无」而不是展示编造值。
 * - 会话跨度取最早 startedAt → 最晚 completedAt。
 */
export function summarizeTrajectoryTokenSpeed(
  calls: readonly ZCodeModelTrajectoryRecord[],
): SessionTokenSpeedSummary {
  if (calls.length === 0) {
    return EMPTY_SUMMARY;
  }

  let latestTokensPerSecond: number | null = null;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;

  for (const call of calls) {
    const outputTokens = call.response?.usage?.outputTokens;
    const durationMs = call.durationMs;
    if (
      typeof outputTokens === "number" &&
      Number.isFinite(outputTokens) &&
      outputTokens > 0 &&
      typeof durationMs === "number" &&
      Number.isFinite(durationMs) &&
      durationMs > 0
    ) {
      // 倒序遍历更合适，但记录顺序不由这里保证，直接取最后一个有效值即可。
      latestTokensPerSecond = (outputTokens * 1000) / durationMs;
    }

    const start = Date.parse(call.startedAt);
    if (Number.isFinite(start) && (earliestStart === null || start < earliestStart)) {
      earliestStart = start;
    }
    const endSource = call.completedAt ? Date.parse(call.completedAt) : NaN;
    const end = Number.isFinite(endSource)
      ? endSource
      : Number.isFinite(start) && typeof durationMs === "number"
        ? start + durationMs
        : NaN;
    if (Number.isFinite(end) && (latestEnd === null || end > latestEnd)) {
      latestEnd = end;
    }
  }

  return {
    latestTokensPerSecond,
    // 落盘记录没有首 token 时间戳，不编造 TTFT。
    averageTtftMs: null,
    sessionDurationMs:
      earliestStart !== null && latestEnd !== null && latestEnd > earliestStart
        ? latestEnd - earliestStart
        : null,
    ttftSampleCount: 0,
  };
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
