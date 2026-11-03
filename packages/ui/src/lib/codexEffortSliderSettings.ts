/*
 * Codex 风格推理档位滑块的本地设置。
 *
 * 三项开关，默认全部关闭，保证默认表现与原版一致：
 *   enabled          —— 总开关：是否启用 Codex 风格滑块视觉
 *   showNoEffectNote —— 是否显示 "无实际作用" 提示
 *   showFastBolt     —— 是否显示 Fast 闪电按钮
 *
 * 存 localStorage：纯前端展示偏好，不参与会话状态，也不需要跨设备同步。
 */

export interface CodexEffortSliderSettings {
  enabled: boolean;
  showNoEffectNote: boolean;
  showFastBolt: boolean;
}

const STORAGE_KEY = "wcode:codex-effort-slider";

export const DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS: CodexEffortSliderSettings = {
  enabled: false,
  showNoEffectNote: false,
  showFastBolt: false,
};

type Listener = (settings: CodexEffortSliderSettings) => void;

const listeners = new Set<Listener>();
let cached: CodexEffortSliderSettings | null = null;

function readStorage(): CodexEffortSliderSettings {
  if (typeof window === "undefined") {
    return DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS;
    }
    const parsed = JSON.parse(raw) as Partial<CodexEffortSliderSettings>;
    // 逐项兜底：历史写入可能缺字段，缺失一律按关闭处理（默认关）。
    return {
      enabled: parsed.enabled === true,
      showNoEffectNote: parsed.showNoEffectNote === true,
      showFastBolt: parsed.showFastBolt === true,
    };
  } catch {
    return DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS;
  }
}

export function getCodexEffortSliderSettings(): CodexEffortSliderSettings {
  if (!cached) {
    cached = readStorage();
  }
  return cached;
}

export function setCodexEffortSliderSettings(
  patch: Partial<CodexEffortSliderSettings>,
): CodexEffortSliderSettings {
  const next: CodexEffortSliderSettings = { ...getCodexEffortSliderSettings(), ...patch };
  cached = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 写入失败只影响持久化，界面仍按内存值响应。
    }
  }
  for (const listener of listeners) {
    listener(next);
  }
  return next;
}

export function subscribeCodexEffortSliderSettings(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCodexEffortSliderSettings(): CodexEffortSliderSettings {
  return setCodexEffortSliderSettings(DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS);
}
