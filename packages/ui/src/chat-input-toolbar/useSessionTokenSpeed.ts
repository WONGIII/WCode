import { useMemo } from "react";
import type { SessionDebugRound } from "@zcode/shared";
import { useSessionDebug } from "@/hooks/useSessionDebug.js";

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
