import {
  isZCodeAgentProvider,
  resolveModelProviderFamilySpecByProviderId,
  zcodeProviderAccountAccessSchema,
  type ZCodeProviderAccountAccess,
  type ZCodeProvider,
} from "@zcode/shared";
import type { ModelSelectionView } from "@zcode/services";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { decodeCustomModelValue, encodeCustomModelValue } from "@/lib/zcodeCustomModelValue.js";
import { shouldShowModelVisionBadge } from "@/lib/modelVisionBadge.js";

/**
 * 模型 ID → 可读显示名的兜底格式化。
 *
 * 用户显式配置的 displayName 永远优先；只有未配置时才使用这里的结果。
 * 目的不是猜厂商官方名称，而是避免输入框和模型菜单直接暴露
 * `deepseek-v4.1-flash` 这类内部 ID。
 */
const MODEL_ID_BRAND_CASING: Record<string, string> = {
  ai: "AI",
  api: "API",
  claude: "Claude",
  codex: "Codex",
  command: "Command",
  deepseek: "DeepSeek",
  gemini: "Gemini",
  glm: "GLM",
  gpt: "GPT",
  grok: "Grok",
  kimi: "Kimi",
  llama: "Llama",
  mcp: "MCP",
  mimo: "MiMo",
  mistral: "Mistral",
  qwen: "Qwen",
  vl: "VL",
};

const MODEL_ID_WORD_CASING: Record<string, string> = {
  chat: "Chat",
  coder: "Coder",
  flash: "Flash",
  highspeed: "Highspeed",
  instruct: "Instruct",
  latest: "Latest",
  max: "Max",
  mini: "Mini",
  preview: "Preview",
  pro: "Pro",
  reasoning: "Reasoning",
  thinking: "Thinking",
  turbo: "Turbo",
  vision: "Vision",
};

function formatModelIdDisplayName(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return modelId;
  }
  // 供应商前缀（如 deepseek/deepseek-v4.1-flash）不进入显示名。
  const leaf = trimmed.split("/").pop()?.trim() || trimmed;
  const parts = leaf.replace(/_+/g, "-").split("-").filter(Boolean);
  if (parts.length === 0) {
    return trimmed;
  }

  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      const brand = MODEL_ID_BRAND_CASING[lower];
      if (brand) {
        return brand;
      }
      const word = MODEL_ID_WORD_CASING[lower];
      if (word) {
        return word;
      }
      // v4 / v4.1 → V4 / V4.1
      if (/^v\d+(?:\.\d+)*$/.test(lower)) {
        return `V${lower.slice(1)}`;
      }
      // 纯版本号、日期与数字后缀保持原样。
      if (/^\d+(?:\.\d+)*$/.test(lower) || /^\d{4,8}$/.test(lower)) {
        return lower;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

export interface ModelProviderGroupLabelOptions {
  apiKeyLabel?: string;
  apiKeyBadgeLabel?: string;
  codingPlanLabel?: string;
  codingPlanBadgeLabel?: string;
  startPlanLabel?: string;
  startPlanBadgeLabel?: string;
  teamPlanBadgeLabel?: string;
  teamPlanFallbackLabel?: string;
}

function supportsRegistryApiFormat(
  selectedProvider: ZCodeProvider,
  apiFormat: string | null | undefined,
): boolean {
  if (!apiFormat) return false;
  // 仅剩 glm（ZCode Agent）provider；三方 CLI 的 api format 差异已随 provider 下线。
  return isZCodeAgentProvider(selectedProvider);
}

export function buildRegistryModelSelectGroups(
  selectedProvider: ZCodeProvider,
  view: ModelSelectionView,
  labels: ModelProviderGroupLabelOptions = {},
): ModelSelectGroup[] {
  return view.providers.flatMap((provider) => {
    if (!supportsRegistryApiFormat(selectedProvider, provider.config.api?.type)) {
      return [];
    }

    const accountAccess = zcodeProviderAccountAccessSchema.safeParse(provider.config.access);
    const accountPresentation = accountAccess.success
      ? getRegistryAccountProviderGroupPresentation(provider.providerId, accountAccess.data, labels)
      : null;

    // 合并菜单仍需区分同名供应商的接入方式；API 标识直接来自 access，不能从名称猜测。
    const labelBadge =
      accountPresentation?.labelBadge ??
      (provider.config.access?.type === "api-key" ||
      provider.config.access?.type === "zhipu-coding-plan-api-key"
        ? (labels.apiKeyBadgeLabel ?? "API")
        : undefined);

    return [
      {
        key: `registry-provider:${provider.providerId}`,
        label: accountPresentation?.label || provider.providerName?.trim() || provider.providerId,
        ...(provider.config.logo ? { logo: provider.config.logo } : {}),
        ...(labelBadge ? { labelBadge } : {}),
        ...(accountPresentation ? { directItems: true } : {}),
        items: provider.models.map(({ modelId, config }) => ({
          key: `registry-provider:${provider.providerId}:${modelId}`,
          value: encodeCustomModelValue(provider.providerId, modelId),
          // 用户自定义显示名优先；未设置时把模型 ID 转成可读名称。
          // 这里才是输入框模型选择菜单真正渲染的 name 来源，
          // 改 CLI 侧 toModelOption.label 不会影响这条链路。
          name: config.displayName?.trim() || formatModelIdDisplayName(modelId),
          ...(shouldShowModelVisionBadge(
            modelId,
            config.properties?.inputFormat?.supportsImage,
            provider.config.access,
          )
            ? { supportsVisionInput: true }
            : {}),
        })),
      },
    ];
  });
}

function getRegistryAccountProviderGroupPresentation(
  providerId: string,
  access: ZCodeProviderAccountAccess,
  labels: ModelProviderGroupLabelOptions,
): Pick<ModelSelectGroup, "label" | "labelBadge"> {
  const familySpec = resolveModelProviderFamilySpecByProviderId(providerId);
  const label = familySpec?.label ?? providerId;
  if (access.mode === "start-plan") {
    return { label: "Start Plan", labelBadge: labels.startPlanBadgeLabel ?? "Free" };
  }
  if (access.mode === "team-coding-plan") {
    return { label, labelBadge: labels.teamPlanBadgeLabel ?? "Team" };
  }
  return { label, labelBadge: labels.codingPlanBadgeLabel ?? "Individual" };
}

export function resolveModelDisplayName(
  modelGroups: readonly ModelSelectGroup[],
  value: string,
): string | null {
  for (const group of modelGroups) {
    const matched = group.items.find((item) => item.value === value);
    if (matched) return matched.name;
  }

  const custom = decodeCustomModelValue(value);
  return custom?.modelName ? formatModelIdDisplayName(custom.modelName) : null;
}
