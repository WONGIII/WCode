import { z } from "zod";

export const SESSION_DEBUG_LIMITS = { rounds: 200, network: 100, dedupe: 2000 } as const;
export const sessionDebugParamsSchema = z.object({ sessionId: z.string().min(1) }).strict();
const count = z.number().finite().nonnegative();
const debugUsageSchema = z
  .object({
    inputTokens: count.optional(),
    outputTokens: count.optional(),
    totalTokens: count.optional(),
    reasoningTokens: count.optional(),
    cachedInputTokens: count.optional(),
    cachedWriteInputTokens: count.optional(),
  })
  .strict();
export const sessionDebugRoundSchema = z
  .object({
    eventKey: z.string(),
    requestId: z.string(),
    requestIndex: count,
    recordedAt: count,
    usage: debugUsageSchema,
    hitRate: count.nullable(),
    generationDurationMs: count.nullable(),
    tokensPerSecond: count.nullable(),
    // 首 token 延迟直接来自 provider 的 timeToFirstContentMs。
    // 之前只落 generationDurationMs（= durationMs - 首token延迟），首 token 时间被丢弃，
    // 导致 UI 只能看到生成速度、看不到 TTFT。补回该字段后历史会话无需重建也能算均值。
    timeToFirstContentMs: count.nullable(),
  })
  .strict();
export const sessionDebugNetworkEntrySchema = z
  .object({
    eventKey: z.string(),
    traceId: z.string(),
    recordedAt: count,
    statusType: z.enum([
      "model_request_started",
      "model_request_completed",
      "model_request_failed",
      "model_retry_scheduled",
      "model_stream_stalled",
    ]),
    requestId: z.string().optional(),
    providerId: z.string().optional(),
    modelId: z.string().optional(),
    providerKind: z.string().optional(),
    transport: z.string().optional(),
    baseURL: z.string().optional(),
    querySource: z.string().optional(),
    queryId: z.string().optional(),
    timestamp: z.string().optional(),
    attempt: count.optional(),
    maxAttempts: count.optional(),
    nextAttempt: count.optional(),
    retryable: z.boolean().optional(),
    statusCode: count.optional(),
    durationMs: count.optional(),
    delayMs: count.optional(),
    idleMs: count.optional(),
    timeoutMs: count.optional(),
    reason: z.string().optional(),
    message: z.string().optional(),
    requestHeaders: z.record(z.string(), z.string()),
    responseHeaders: z.record(z.string(), z.string()),
    requestHeaderCount: count,
    responseHeaderCount: count,
  })
  .strict();
export const sessionDebugSnapshotSchema = z
  .object({
    sessionId: z.string(),
    rounds: z.array(sessionDebugRoundSchema).max(SESSION_DEBUG_LIMITS.rounds),
    networkEntries: z.array(sessionDebugNetworkEntrySchema).max(SESSION_DEBUG_LIMITS.network),
    cache: z
      .object({
        hitRateRequestCount: count,
        totalInputTokens: count,
        totalCacheReadTokens: count,
        hitRate: count.nullable(),
      })
      .strict()
      .nullable(),
    /**
     * 会话全量累计用量，独立于 rounds 的 200 条上限。
     *
     * rounds 会被截断（tok/s 只需要最近若干轮），但累计值必须是全量，
     * 否则长会话的累计总量会随上限缩水。仅在后端从持久化记录重建时提供。
     */
    persistentCumulative: z
      .object({
        inputTokens: count,
        outputTokens: count,
        cacheReadTokens: count,
        cacheWriteTokens: count,
      })
      .strict()
      .optional(),
    /**
     * 全量 model_usage 聚合结果。
     *
     * rounds 只保留最近 200 条、且进程重启后内存快照只覆盖本次观察到的轮次，
     * 不能代表整个会话。会话总用时、平均速度与 TTFT 的平均值必须用这份全量聚合，
     * 否则长会话会显示成最近几轮的局部值。
     */
    sessionTotals: z
      .object({
        earliestStartedAt: count.nullable(),
        latestCompletedAt: count.nullable(),
        outputTokens: count,
        generationDurationMs: count,
        ttftTotalMs: count,
        ttftSampleCount: count,
      })
      .strict()
      .optional(),
  })
  .strict();
export type SessionDebugSnapshot = z.infer<typeof sessionDebugSnapshotSchema>;
export type SessionDebugRound = z.infer<typeof sessionDebugRoundSchema>;
export type SessionDebugNetworkEntry = z.infer<typeof sessionDebugNetworkEntrySchema>;

/** 输出 token 与首输出到请求结束的同源时间；未知值不能用请求总耗时替代。 */
export function calculateOutputTps(
  outputTokens: number | undefined,
  generationDurationMs: number | null,
): number | null {
  if (
    outputTokens === undefined ||
    !Number.isFinite(outputTokens) ||
    outputTokens < 0 ||
    generationDurationMs === null ||
    !Number.isFinite(generationDurationMs) ||
    generationDurationMs <= 0
  )
    return null;
  const tps = (outputTokens * 1000) / generationDurationMs;
  return Number.isFinite(tps) ? tps : null;
}
