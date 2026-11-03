import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { Switch } from "@/components/ui/switch.js";
import { Button } from "@/components/ui/button.js";
import { SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { useCodexEffortSliderSettings } from "@/hooks/useCodexEffortSliderSettings.js";
import {
  resetCodexEffortSliderSettings,
  setCodexEffortSliderSettings,
} from "@/lib/codexEffortSliderSettings.js";

/**
 * 外观设置里的「推理档位滑块」区块。
 *
 * 总开关默认关闭，关闭时不改变输入框原有的档位控件表现。
 * 两个子开关只在总开关开启后可调，且各自独立：
 * - 「无实际作用」说明：Fast 纯粹是视觉，避免用户误以为能加速
 * - Fast 闪电按钮：是否显示这个开关本身
 */
export function CodexEffortSliderSection() {
  const { intl } = useZCodeIntl();
  const settings = useCodexEffortSliderSettings();
  const subDisabled = !settings.enabled;

  return (
    <div className="min-w-0 space-y-3">
      <div>
        <h3 className="text-ui-lg font-semibold text-foreground">
          {intl.formatMessage({ id: "settings.appearance.codexEffort.title" })}
        </h3>
        <p className="mt-1 text-ui-base leading-6 text-foreground-subtle">
          {intl.formatMessage({ id: "settings.appearance.codexEffort.description" })}
        </p>
      </div>
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.appearance.codexEffort.enable" })}
          description={intl.formatMessage({
            id: "settings.appearance.codexEffort.enableDescription",
          })}
          control={
            <Switch
              data-testid="codex-effort-slider-enabled"
              aria-label={intl.formatMessage({
                id: "settings.appearance.codexEffort.enable",
              })}
              size="sm"
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                setCodexEffortSliderSettings({ enabled: checked })
              }
              className="shrink-0"
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.appearance.codexEffort.fastBolt" })}
          description={intl.formatMessage({
            id: "settings.appearance.codexEffort.fastBoltDescription",
          })}
          control={
            <Switch
              data-testid="codex-effort-slider-fast-bolt"
              aria-label={intl.formatMessage({
                id: "settings.appearance.codexEffort.fastBolt",
              })}
              size="sm"
              checked={settings.showFastBolt}
              disabled={subDisabled}
              onCheckedChange={(checked) =>
                setCodexEffortSliderSettings({ showFastBolt: checked })
              }
              className="shrink-0"
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.appearance.codexEffort.noEffectNote" })}
          description={intl.formatMessage({
            id: "settings.appearance.codexEffort.noEffectNoteDescription",
          })}
          control={
            <Switch
              data-testid="codex-effort-slider-no-effect-note"
              aria-label={intl.formatMessage({
                id: "settings.appearance.codexEffort.noEffectNote",
              })}
              size="sm"
              checked={settings.showNoEffectNote}
              disabled={subDisabled}
              onCheckedChange={(checked) =>
                setCodexEffortSliderSettings({ showNoEffectNote: checked })
              }
              className="shrink-0"
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.appearance.codexEffort.reset" })}
          description={intl.formatMessage({
            id: "settings.appearance.codexEffort.resetDescription",
          })}
          control={
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="codex-effort-slider-reset"
              onClick={() => resetCodexEffortSliderSettings()}
            >
              {intl.formatMessage({ id: "settings.appearance.codexEffort.resetAction" })}
            </Button>
          }
        />
      </SettingsGroupCard>
    </div>
  );
}
