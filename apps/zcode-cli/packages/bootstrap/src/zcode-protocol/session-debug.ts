import {
  SessionEventType,
  type ModelNetworkStatusPayload,
  type SessionEvent,
} from "@zcode/contracts";
import {
  SESSION_DEBUG_LIMITS,
  calculateOutputTps,
  sessionDebugParamsSchema,
  zcodeTaskNetworkDebugStatusFromPayload,
  type SessionDebugSnapshot,
} from "@zcode/shared";
import { requireSession, type ZCodeProtocolAgentServerContext } from "./server-types.js";

type SessionRecord = { app: { sessionId: string } };
interface Observation {
  snapshot: SessionDebugSnapshot;
  seenEvents: Set<string>;
  completedRequests: Set<string>;
  hasUnknownCacheUsage: boolean;
}
// 旁路记录跟随 CLI record 回收，不挂到聊天投影、轮次事实或已提交输入队列上。
const observations = new WeakMap<SessionRecord, Observation>();
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 512;
const MAX_MESSAGE_LENGTH = 2048;

function emptySnapshot(sessionId: string): SessionDebugSnapshot {
  return { sessionId, rounds: [], networkEntries: [], cache: null };
}
function remember(keys: Set<string>, key: string): boolean {
  if (keys.has(key)) return false;
  keys.add(key);
  if (keys.size > SESSION_DEBUG_LIMITS.dedupe) keys.delete(keys.values().next().value!);
  return true;
}
function boundedHeaders(headers: Record<string, string>): Record<string, string> {
  // adapter 已脱敏；此处只限制调试响应体积，不保存正文，也不复制无限大小的 headers。
  return Object.fromEntries(
    Object.entries(headers)
      .slice(0, MAX_HEADER_COUNT)
      .map(([key, value]) => [
        key.slice(0, MAX_HEADER_VALUE_LENGTH),
        value.slice(0, MAX_HEADER_VALUE_LENGTH),
      ]),
  );
}
function token(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function observeSessionDebug(record: SessionRecord, event: SessionEvent): void {
  if (
    event.type !== SessionEventType.ModelNetworkStatus ||
    String(event.sessionId) !== record.app.sessionId
  )
    return;
  const payload = event.payload as ModelNetworkStatusPayload;
  const mapped = zcodeTaskNetworkDebugStatusFromPayload({
    taskId: record.app.sessionId,
    traceId: event.traceId,
    eventId: String(event.id),
    payload: { ...payload, model: { providerId: payload.providerId, modelId: payload.modelId } },
  });
  if (!mapped) return;
  let observation = observations.get(record);
  if (!observation) {
    observation = {
      snapshot: emptySnapshot(record.app.sessionId),
      seenEvents: new Set(),
      completedRequests: new Set(),
      hasUnknownCacheUsage: false,
    };
    observations.set(record, observation);
  }
  if (!remember(observation.seenEvents, String(event.id))) return;
  const { type: _type, taskId: _taskId, eventId: _eventId, inputId: _inputId, ...entry } = mapped;
  const parsedAt = Date.parse(payload.timestamp);
  const recordedAt = Number.isFinite(parsedAt) ? parsedAt : event.timestamp.getTime();
  const state = observation.snapshot;
  state.networkEntries = [
    ...state.networkEntries,
    {
      ...entry,
      recordedAt,
      // maxAttempts=0 表示无限重试，旧映射器会丢掉它，调试面必须保留。
      maxAttempts: payload.maxAttempts,
      requestHeaders: boundedHeaders(entry.requestHeaders),
      responseHeaders: boundedHeaders(entry.responseHeaders),
      ...(entry.message ? { message: entry.message.slice(0, MAX_MESSAGE_LENGTH) } : {}),
    },
  ].slice(-SESSION_DEBUG_LIMITS.network);
  if (
    payload.type !== "model_request_completed" ||
    payload.querySource !== "main_turn" ||
    !remember(observation.completedRequests, payload.requestId)
  )
    return;
  const usage = payload.usage;
  const inputTokens = token(usage?.inputTokens);
  const outputTokens = token(usage?.outputTokens);
  const cacheReadTokens = token(usage?.cacheReadTokens);
  const duration = token(payload.durationMs);
  const first = token(payload.timeToFirstContentMs);
  const generationDurationMs =
    duration !== undefined && first !== undefined && duration > first ? duration - first : null;
  observation.hasUnknownCacheUsage ||= inputTokens === undefined || cacheReadTokens === undefined;
  const previous = state.cache;
  const totalInputTokens = (previous?.totalInputTokens ?? 0) + (inputTokens ?? 0);
  const totalCacheReadTokens = (previous?.totalCacheReadTokens ?? 0) + (cacheReadTokens ?? 0);
  const requestIndex = (previous?.hitRateRequestCount ?? 0) + 1;
  state.cache = {
    hitRateRequestCount: requestIndex,
    totalInputTokens,
    totalCacheReadTokens,
    hitRate:
      !observation.hasUnknownCacheUsage && totalInputTokens > 0
        ? totalCacheReadTokens / totalInputTokens
        : null,
  };
  state.rounds = [
    ...state.rounds,
    {
      eventKey: String(event.id),
      requestId: payload.requestId,
      requestIndex,
      recordedAt,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens:
          token(usage?.totalTokens) ??
          (inputTokens !== undefined && outputTokens !== undefined
            ? inputTokens + outputTokens
            : undefined),
        reasoningTokens: token(usage?.reasoningTokens),
        cachedInputTokens: cacheReadTokens,
        cachedWriteInputTokens: token(usage?.cacheWriteTokens),
      },
      hitRate:
        inputTokens !== undefined && inputTokens > 0 && cacheReadTokens !== undefined
          ? cacheReadTokens / inputTokens
          : null,
      generationDurationMs,
      tokensPerSecond: calculateOutputTps(outputTokens, generationDurationMs),
      // 首 token 延迟原本只参与 generationDurationMs 的减法就被丢弃，
      // 前端因此无法展示 TTFT。这里额外保留原值，供工具栏 token/s 弹窗做均值统计。
      timeToFirstContentMs: first ?? null,
    },
  ].slice(-SESSION_DEBUG_LIMITS.rounds);
}

export function readSessionDebug(record: SessionRecord): SessionDebugSnapshot {
  return observations.get(record)?.snapshot ?? emptySnapshot(record.app.sessionId);
}

/**
 * 从已落盘的 model_usage 记录重建调试快照。
 *
 * 为什么需要：observations 是 WeakMap，快照只活在 Agent 进程内存里。
 * 进程重启后 readSessionDebug 返回空 rounds，UI 的 tok/s 与 TTFT 全部显示为空。
 * 这些字段在 model_usage 表里已有持久化副本（first_token_at / duration_ms / usage），
 * 因此空快照时回落到磁盘重建同一口径，旧会话也能直接看到数据。
 *
 * 口径与实时快照保持一致：
 * - generationDurationMs = 总耗时 − 首 token 延迟
 * - tokensPerSecond = outputTokens ÷ generationDuration
 * - timeToFirstContentMs = time_to_first_token_ms
 * 非流式调用（标题生成等）没有 first_token_at，其 TTFT 保持 null 且不参与均值。
 */
export async function readPersistedSessionDebug(
  context: ZCodeProtocolAgentServerContext,
  sessionId: string,
): Promise<SessionDebugSnapshot> {
  const store = context.deps.sessionStore;
  if (!store) {
    return emptySnapshot(sessionId);
  }
  const rows = await store.queryModelUsageTurns({
    sessionID: sessionId as Parameters<typeof store.queryModelUsageTurns>[0]["sessionID"],
    limit: SESSION_DEBUG_LIMITS.rounds,
  });

  const rounds = rows.map((row, index) => {
    const ttft =
      row.timeToFirstTokenMs !== null && Number.isFinite(row.timeToFirstTokenMs)
        ? row.timeToFirstTokenMs
        : null;
    // 与实时口径一致：生成耗时是总耗时扣掉等首 token 的时间。
    const generationDurationMs =
      row.durationMs !== null && Number.isFinite(row.durationMs)
        ? Math.max(0, row.durationMs - (ttft ?? 0))
        : null;
    const inputTokens = row.inputTokens;
    const outputTokens = row.outputTokens;
    // 只在真流式调用上算速度：标题生成等非流式调用没有 first_token_at，
    // 其 duration_ms 覆盖整段处理而非生成区间，算进去会把「最近速度」拉成假值。
    const isStreamingCall = ttft !== null && generationDurationMs !== null;

    return {
      eventKey: row.id,
      requestId: row.id,
      requestIndex: index,
      recordedAt: row.completedAt ?? row.startedAt,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: row.totalTokens,
        ...(row.reasoningTokens > 0 ? { reasoningTokens: row.reasoningTokens } : {}),
        ...(row.cacheReadTokens > 0 ? { cachedInputTokens: row.cacheReadTokens } : {}),
        ...(row.cacheCreationTokens > 0
          ? { cachedWriteInputTokens: row.cacheCreationTokens }
          : {}),
      },
      hitRate:
        inputTokens > 0 && Number.isFinite(row.cacheReadTokens)
          ? row.cacheReadTokens / inputTokens
          : null,
      generationDurationMs: isStreamingCall ? generationDurationMs : null,
      tokensPerSecond: isStreamingCall
        ? calculateOutputTps(outputTokens, generationDurationMs)
        : null,
      timeToFirstContentMs: ttft,
    };
  });

  return {
    sessionId,
    rounds: rounds.slice(-SESSION_DEBUG_LIMITS.rounds),
    // 网络条目与上下文缓存只存在于运行时，落盘不记录，重建时保持空。
    networkEntries: [],
    cache: null,
  };
}

export async function querySessionDebug(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<SessionDebugSnapshot> {
  const params = sessionDebugParamsSchema.parse(rawParams);
  const record = requireSession(context, params.sessionId);
  const live = readSessionDebug(record);
  // 内存快照有 rounds 时直接用，避免每次轮询都查磁盘。
  if (live.rounds.length > 0) {
    return live;
  }
  try {
    const persisted = await readPersistedSessionDebug(context, params.sessionId);
    // 磁盘也没有记录（新会话尚未调用模型）时仍返回空快照。
    return persisted.rounds.length > 0 ? persisted : live;
  } catch {
    // 重建失败不能拖垮调试接口本身，退回内存快照。
    return live;
  }
}
