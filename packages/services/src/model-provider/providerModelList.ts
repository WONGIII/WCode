import type { ZCodeProviderListModelsResult } from "@zcode/shared";

/** 供应商 `GET {baseUrl}/models` 的通用响应形状（OpenAI / Anthropic 兼容）。 */
interface RawModelListPayload {
  readonly data?: readonly unknown[];
  readonly models?: readonly unknown[];
}

interface RawModelEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly displayName?: unknown;
}

export interface ProviderModelListRequest {
  /** 已保存的供应商 API baseUrl（可能已带 /v1）。 */
  readonly baseUrl: string;
  /** 供应商协议类型，决定鉴权头与列表路径。 */
  readonly apiType: "anthropic-messages" | "openai-chat-completions" | "openai-responses";
  readonly apiKey: string | null;
  readonly headers?: Readonly<Record<string, string>> | null;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 拼接模型列表 URL。
 *
 * 用户填的 baseUrl 可能已经带 `/v1`，也可能是裸域名，
 * 这里统一收敛：已以 /v1 结尾就直接拼 /models，否则先补 /v1。
 */
export function resolveModelListUrl(baseUrl: string): string | null {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  return /\/v\d+$/i.test(trimmed) ? `${trimmed}/models` : `${trimmed}/v1/models`;
}

/** 按协议类型生成鉴权头；Anthropic 用 x-api-key，OpenAI 兼容用 Bearer。 */
export function buildModelListHeaders(
  request: ProviderModelListRequest,
): Record<string, string> {
  const headers: Record<string, string> = {
    accept: "application/json",
  };

  if (request.apiType === "anthropic-messages") {
    if (request.apiKey) {
      headers["x-api-key"] = request.apiKey;
    }
    headers["anthropic-version"] = "2023-06-01";
  } else if (request.apiKey) {
    headers.authorization = `Bearer ${request.apiKey}`;
  }

  for (const [key, value] of Object.entries(request.headers ?? {})) {
    // 自定义头允许覆盖默认值，但空 key 直接跳过。
    if (key.trim()) {
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * 解析供应商返回的模型列表。
 *
 * 不同兼容实现的字段名不统一（data / models，id / name / display_name），
 * 这里做保守归一：只接受非空字符串 id，去重并保持服务端顺序。
 */
export function parseModelListPayload(
  payload: unknown,
  alreadyAddedIds: ReadonlySet<string>,
): ZCodeProviderListModelsResult {
  if (typeof payload !== "object" || payload === null) {
    return { models: [] };
  }

  const raw = payload as RawModelListPayload;
  const entries = Array.isArray(raw.data)
    ? raw.data
    : Array.isArray(raw.models)
      ? raw.models
      : [];

  const seen = new Set<string>();
  const models: ZCodeProviderListModelsResult["models"] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      const id = entry.trim();
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      models.push({ id, alreadyAdded: alreadyAddedIds.has(id) });
      continue;
    }

    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const item = entry as RawModelEntry;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);

    const name =
      pickString(item.name) ?? pickString(item.display_name) ?? pickString(item.displayName);
    models.push({
      id,
      ...(name ? { name } : {}),
      alreadyAdded: alreadyAddedIds.has(id),
    });
  }

  return { models };
}

function pickString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * 请求供应商模型列表。
 *
 * 说明：这是唯一的外部网络副作用点，按仓库要求收敛在此 adapter 内，
 * 业务层只拿到解析后的结果或异常，不做自己的 fetch。
 */
export async function fetchProviderModelList(
  request: ProviderModelListRequest,
  alreadyAddedIds: ReadonlySet<string>,
): Promise<ZCodeProviderListModelsResult> {
  const url = resolveModelListUrl(request.baseUrl);
  if (!url) {
    throw new Error("供应商 Base URL 无效，无法请求模型列表。");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildModelListHeaders(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      // 401/403 单独提示，避免用户以为是网络问题而反复重试。
      if (response.status === 401 || response.status === 403) {
        throw new Error("鉴权失败，请检查 API Key 是否正确。");
      }
      throw new Error(`请求模型列表失败：HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    return parseModelListPayload(payload, alreadyAddedIds);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求模型列表超时，请检查网络或 Base URL。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
