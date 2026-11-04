import { useSyncExternalStore } from "react";
import {
  DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS,
  getCodexEffortSliderSettings,
  subscribeCodexEffortSliderSettings,
  type CodexEffortSliderSettings,
} from "@/lib/codexEffortSliderSettings.js";

/**
 * 订阅 Codex 风格滑块设置。
 *
 * 用 useSyncExternalStore 而非 useState+useEffect：设置页切换开关或 Fast 按钮后，
 * 已打开的输入框与触发器必须立即同步，跨组件树同步靠外部 store。
 */
export function useCodexEffortSliderSettings(): CodexEffortSliderSettings {
  return useSyncExternalStore(
    subscribeCodexEffortSliderSettings,
    getCodexEffortSliderSettings,
    () => DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS,
  );
}
