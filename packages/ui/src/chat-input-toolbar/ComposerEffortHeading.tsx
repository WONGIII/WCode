import { RollingToolbarLabel } from "@/chat-input-toolbar/RollingToolbarLabel.js";
import { ControlShortcutBadge } from "@/ControlShortcutBadge.js";

export function ComposerEffortHeading({
  label,
  value,
  shortcut,
  ultra = false,
}: {
  label: string;
  value: string;
  shortcut?: string;
  /** Codex 模式下最高档用紫色强调；非 Codex 模式不传。 */
  ultra?: boolean;
}) {
  return (
    <div className="mb-1 flex items-center gap-2 text-ui-base">
      <span className="text-ui-sm text-foreground-subtle">{label}</span>
      <span
        className={ultra ? "codex-effort-heading" : undefined}
        data-ultra={ultra || undefined}
        data-testid="composer-thought-value"
      >
        <RollingToolbarLabel label={value} />
      </span>
      {/* 通用 Kbd 的 muted 颜色在当前主题未定义；与工具栏 Tooltip 复用同一键帽避免裸文字。 */}
      {shortcut ? (
        <ControlShortcutBadge className="ml-auto" data-testid="composer-effort-shortcut">
          {shortcut}
        </ControlShortcutBadge>
      ) : null}
    </div>
  );
}
