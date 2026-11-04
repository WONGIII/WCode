/*
 * Codex 风格推理档位滑块的本地设置。
 *
 * 纯前端展示偏好，不参与会话状态，也不需要跨设备同步，因此存 localStorage。
 * 字段说明：
 *   enabled          —— 总开关：是否启用 Codex 风格滑块视觉，默认关闭
 *   showNoEffectNote —— 是否显示 Fast 的「无实际作用」说明
 *   showFastBolt     —— 是否显示 Fast 闪电按钮
 *   fastActive       —— Fast 开关本身的状态；必须持久化，否则关闭菜单后闪电复活/熄灭
 *
 * 注意：两个子开关默认开启。用户打开总开关后应立即看到完整效果，
 * 不能因为子开关默认关闭而误判为「闪电没生效」。
 */

export interface CodexEffortSliderSettings {
  enabled: boolean;
  showNoEffectNote: boolean;
  showFastBolt: boolean;
  fastActive: boolean;
}

const STORAGE_KEY = "wcode:codex-effort-slider";

export const DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS: CodexEffortSliderSettings = {
  enabled: false,
  showNoEffectNote: true,
  showFastBolt: true,
  fastActive: false,
};

type Listener = (settings: CodexEffortSliderSettings) => void;

const listeners = new Set<Listener>();
let cached: CodexEffortSliderSettings | null = null;
let storageListenerBound = false;

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
    // 逐项兜底：历史写入可能缺字段，缺失一律按默认值处理。
    // 子开关缺失时用默认 true（完整效果），显式 false 才关闭。
    return {
      enabled: parsed.enabled === true,
      showNoEffectNote: parsed.showNoEffectNote !== false,
      showFastBolt: parsed.showFastBolt !== false,
      fastActive: parsed.fastActive === true,
    };
  } catch {
    return DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS;
  }
}

function bindStorageSync(): void {
  if (storageListenerBound || typeof window === "undefined") {
    return;
  }
  storageListenerBound = true;
  // 多窗口时设置页与输入框可能在不同 renderer；storage 事件让两边看到同一份值。
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || event.storageArea !== window.localStorage) {
      return;
    }
    cached = readStorage();
    for (const listener of listeners) {
      listener(cached);
    }
  });
}

export function getCodexEffortSliderSettings(): CodexEffortSliderSettings {
  if (!cached) {
    bindStorageSync();
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
  bindStorageSync();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resetCodexEffortSliderSettings(): CodexEffortSliderSettings {
  return setCodexEffortSliderSettings(DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS);
}
