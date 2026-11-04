import { useMemo } from "react";
import {
  Context,
  ContextContent,
  ContextContentBody,
  ContextTrigger,
} from "@/components/ai-elements/context.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  useSessionTokenSpeed,
  type SessionTokenSpeedSummary,
} from "@/chat-input-toolbar/useSessionTokenSpeed.js";

const MS_PER_SECOND = 1_000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** 速度保留 1 位小数；整数时不显示多余的小数点。 */
export function formatTokensPerSecondLabel(tokensPerSecond: number | null): string | null {
  if (tokensPerSecond === null || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return null;
  }

  const rounded = Math.round(tokensPerSecond * 10) / 10;
  return `${rounded}`;
}

/** 秒级时长：小于 1 分钟显示「n 秒」，否则「n 分 m 秒」，超过 1 小时再加小时段。 */
export function formatDurationFromMs(
  durationMs: number | null,
  intl: ReturnType<typeof useZCodeIntl>["intl"],
): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  const totalSeconds = durationMs / MS_PER_SECOND;
  if (totalSeconds < SECONDS_PER_MINUTE) {
    return intl.formatMessage(
      { id: "chat.tokenSpeed.duration.seconds" },
      { seconds: totalSeconds.toFixed(1) },
    );
  }

  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = Math.round(totalSeconds % SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) {
    return intl.formatMessage(
      { id: "chat.tokenSpeed.duration.minutes" },
      { minutes: totalMinutes, seconds },
    );
  }

  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = totalMinutes % MINUTES_PER_HOUR;
  return intl.formatMessage({ id: "chat.tokenSpeed.duration.hours" }, { hours, minutes });
}

function SpeedRows({
  summary,
  intl,
  locale,
}: {
  summary: SessionTokenSpeedSummary;
  intl: ReturnType<typeof useZCodeIntl>["intl"];
  locale: string;
}) {
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const averageTtftLabel = useMemo(() => {
    if (summary.averageTtftMs === null) {
      return null;
    }
    return intl.formatMessage(
      { id: "chat.tokenSpeed.ttftValue" },
      { seconds: (summary.averageTtftMs / MS_PER_SECOND).toFixed(2) },
    );
  }, [intl, summary.averageTtftMs]);
  const durationLabel = useMemo(
    () => formatDurationFromMs(summary.sessionDurationMs, intl),
    [intl, summary.sessionDurationMs],
  );
  const sampleLabel = useMemo(() => {
    if (summary.ttftSampleCount <= 1) {
      return null;
    }
    return intl.formatMessage(
      { id: "chat.tokenSpeed.ttftSamples" },
      { count: numberFormatter.format(summary.ttftSampleCount) },
    );
  }, [intl, numberFormatter, summary.ttftSampleCount]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 text-ui-sm">
        <span className="text-foreground-subtle">
          {intl.formatMessage({ id: "chat.tokenSpeed.ttftLabel" })}
        </span>
        <span className="font-mono text-ui-sm tabular-nums text-foreground">
          {averageTtftLabel ?? "—"}
        </span>
      </div>
      {sampleLabel ? (
        <div className="text-right text-ui-sm text-foreground-subtlest">{sampleLabel}</div>
      ) : null}
      <div className="flex items-center justify-between gap-3 border-t border-border pt-2 text-ui-sm">
        <span className="text-foreground-subtle">
          {intl.formatMessage({ id: "chat.tokenSpeed.totalDurationLabel" })}
        </span>
        <span className="font-mono text-ui-sm tabular-nums text-foreground">
          {durationLabel ?? "—"}
        </span>
      </div>
    </div>
  );
}

/**
 * 输入框工具栏的 token/s 指示器。
 *
 * 位置固定在上下文窗口用量左侧。触发与弹层都复用 ai-elements 的 Context 组件，
 * 这样 `openDelay/closeDelay` 与上下文弹窗一致（都是 0），
 * 不会出现鼠标悬停后要等几百毫秒才浮出的延迟感。
 */
export function ChatTokenSpeedIndicator({
  workspacePath,
  workspaceIdentity,
  taskId,
}: {
  workspacePath: string;
  workspaceIdentity?: string;
  taskId: string | null;
}) {
  const { intl, locale } = useZCodeIntl();
  const summary = useSessionTokenSpeed({
    workspacePath,
    workspaceIdentity,
    taskId,
  });
  const speedLabel = formatTokensPerSecondLabel(summary.averageTokensPerSecond);

  // 没有速度样本时不占位，避免新会话出现空壳。
  if (!speedLabel) {
    return null;
  }

  const triggerLabel = intl.formatMessage({ id: "chat.tokenSpeed.trigger" }, { speed: speedLabel });

  return (
    <Context maxTokens={1} usedTokens={0}>
      {/* ContextTrigger 内部是 HoverCardTrigger asChild，children 必须是单个元素。
          直接传字符串会让 Radix Slot 无法克隆而整块不渲染（表现为「指示器消失了」）。 */}
      <ContextTrigger
        aria-label={triggerLabel}
        data-chat-toolbar-popover-trigger="true"
        data-testid="chat-token-speed-indicator"
      >
        <span className="inline-flex shrink-0 items-center whitespace-nowrap px-1 font-mono text-ui-base tabular-nums text-foreground-subtle">
          {triggerLabel}
        </span>
      </ContextTrigger>
      <ContextContent className="!w-80 !rounded-xl !shadow-md" side="top" sideOffset={2}>
        <ContextContentBody className="space-y-3">
          <div className="flex min-w-0 mb-3 items-center gap-3">
            <span className="shrink-0 text-ui-base font-medium text-foreground">
              {intl.formatMessage({ id: "chat.tokenSpeed.title" })}
            </span>
            <span className="ml-auto shrink-0 text-right font-mono text-ui-sm text-foreground-subtle">
              {triggerLabel}
            </span>
          </div>
          <SpeedRows intl={intl} locale={locale} summary={summary} />
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}
