import {
  zcodeProviderListModelsParamsSchema,
  type ZCodeProviderListModelsResult,
} from "@zcode/shared";
import {
  parseParams,
  type ZCodeProtocolAgentServerContext,
} from "./server-types.js";

/** 供应商 `GET /models` 的通用响应形状（OpenAI / Anthropic 兼容）。 */
interface RawModelListPayload {
  readonly data?: readonly unknown[];
  readonly models?: readonly unknown[];
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * 拼接模型列表 URL。
 *
 * 用户填的 baseUrl 可能已带 /v1，也可能是裸域名；统一收敛：
 * 已以 /v1 结尾直接拼 /models，否则先补 /v1。
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

/**
 * 拉取供应商模型列表。
 *
 * 凭证与 baseUrl 从该 app 的 provider registry 快照读取，请求在 CLI 侧发出；
 * 渲染进程只拿模型 ID 列表，apiKey 不经过渲染进程。
 */
export async function listProviderModels(
  context: ZCodeProtocolAgentServerContext,
  rawParams: unknown,
): Promise<ZCodeProviderListModelsResult> {
  const params = parseParams(zcodeProviderListModelsParamsSchema, rawParams);
  // 用户可能刚保存了 baseUrl / apiKey；不先刷新会读到旧 endpoint。
  await context.deps.refreshProviderRegistry?.("provider-list-models");

  const snapshot = await context.deps.readProviderConfigSnapshot?.();
  const provider = snapshot?.find(
    (item: { providerId: string }) => item.providerId === params.providerId,
  );
  if (!provider) {
    throw new Error("找不到该供应商配置。");
  }

  const config = provider.config;
  const access = config.access;
  const api = config.api;
  if (access?.type !== "api-key" && access?.type !== "zhipu-coding-plan-api-key") {
    throw new Error("当前连接方式不支持获取模型列表，请使用 API Key 连接。");
  }
  const url = api?.baseUrl ? resolveModelListUrl(api.baseUrl) : null;
  if (!url) {
    throw new Error("请先填写有效的供应商 Base URL。");
  }

  const headers: Record<string, string> = { accept: "application/json" };
  if (api?.type === "anthropic-messages") {
    if (access.apiKey) headers["x-api-key"] = access.apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (access.apiKey) {
    headers.authorization = `Bearer ${access.apiKey}`;
  }
  for (const [key, value] of Object.entries(api?.headers ?? {})) {
    if (key.trim()) headers[key] = value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "GET", headers, signal: controller.signal });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("鉴权失败，请检查 API Key 是否正确。");
      }
      throw new Error(`请求模型列表失败：HTTP ${response.status}`);
    }
    return parseModelListPayload(await response.json(), provider);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("请求模型列表超时，请检查网络或 Base URL。");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 归一化各兼容实现的字段差异，并标记已在配置中的模型。 */
function parseModelListPayload(
  payload: unknown,
  provider: { models?: readonly { modelId: string }[] },
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
  const alreadyAdded = new Set((provider.models ?? []).map((item) => item.modelId));
  const seen = new Set<string>();
  const models: ZCodeProviderListModelsResult["models"] = [];

  for (const entry of entries) {
    const id =
      typeof entry === "string"
        ? entry.trim()
        : typeof entry === "object" && entry !== null && typeof (entry as { id?: unknown }).id === "string"
          ? (entry as { id: string }).id.trim()
          : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, alreadyAdded: alreadyAdded.has(id) });
  }
  return { models };
}
