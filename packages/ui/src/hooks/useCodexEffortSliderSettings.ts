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
 * 用 useSyncExternalStore 而非 useState+useEffect：设置页切换开关时，
 * 已经打开的 composer 需要立即跟着变，跨组件树同步靠外部 store。
 */
export function useCodexEffortSliderSettings(): CodexEffortSliderSettings {
  return useSyncExternalStore(
    subscribeCodexEffortSliderSettings,
    getCodexEffortSliderSettings,
    () => DEFAULT_CODEX_EFFORT_SLIDER_SETTINGS,
  );
}
