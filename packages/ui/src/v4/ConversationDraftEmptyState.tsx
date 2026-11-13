/**
 * 草稿态空态问候：时间问候语 + ZCode Logo。
 * 自旧版 ChatView/ChatViewEmptyState.tsx 恢复（该组件随旧 ChatView 删除，
 * i18n key `chat.empty.greeting.*` 一直保留）；边界时刻自动换档逻辑保真。
 * 手机远控复用同一组件，但继续保留 20px 紧凑标题；桌面草稿首页才按标题自身宽度适配。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import darkEmptyStateLogoUrl from "@/assets/WEmptyStateDark.svg";
import { cn } from "@/components/lib/utils.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useIsOfficeMode } from "@/hooks/useInterfaceMode.js";
import { logger } from "@/logger.js";

const GREETING_BOUNDARY_HOURS = [5, 9, 12, 14, 18, 23] as const;
const GREETING_MIN_FONT_SIZE_PX = 20;
const GREETING_MAX_FONT_SIZE_PX = 30;

export type ChatEmptyGreetingMessageId =
  | "chat.empty.greeting.morningEarly"
  | "chat.empty.greeting.morning"
  | "chat.empty.greeting.noon"
  | "chat.empty.greeting.afternoon"
  | "chat.empty.greeting.evening"
  | "chat.empty.greeting.lateNight";

export function getChatEmptyGreetingMessageId(date: Date = new Date()): ChatEmptyGreetingMessageId {
  const hour = date.getHours();

  if (hour >= 5 && hour < 9) return "chat.empty.greeting.morningEarly";
  if (hour >= 9 && hour < 12) return "chat.empty.greeting.morning";
  if (hour >= 12 && hour < 14) return "chat.empty.greeting.noon";
  if (hour >= 14 && hour < 18) return "chat.empty.greeting.afternoon";
  if (hour >= 18 && hour < 23) return "chat.empty.greeting.evening";

  return "chat.empty.greeting.lateNight";
}

export function getNextChatEmptyGreetingDelayMs(date: Date = new Date()) {
  const candidates = GREETING_BOUNDARY_HOURS.map((hour) => {
    const boundary = new Date(date);
    boundary.setHours(hour, 0, 0, 0);
    return boundary;
  });
  const tomorrowFirstBoundary = new Date(date);
  tomorrowFirstBoundary.setDate(tomorrowFirstBoundary.getDate() + 1);
  tomorrowFirstBoundary.setHours(GREETING_BOUNDARY_HOURS[0], 0, 0, 0);

  const nextBoundary =
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ?? tomorrowFirstBoundary;

  return Math.max(1, nextBoundary.getTime() - date.getTime());
}

export function resolveGreetingFontSizePx({
  availableWidthPx,
  naturalTextWidthPx,
  compactForRemoteControl = false,
}: {
  availableWidthPx: number;
  naturalTextWidthPx: number;
  compactForRemoteControl?: boolean;
}) {
  if (compactForRemoteControl) {
    return GREETING_MIN_FONT_SIZE_PX;
  }
  if (
    !Number.isFinite(availableWidthPx) ||
    !Number.isFinite(naturalTextWidthPx) ||
    availableWidthPx <= 0 ||
    naturalTextWidthPx <= 0 ||
    availableWidthPx >= naturalTextWidthPx
  ) {
    return GREETING_MAX_FONT_SIZE_PX;
  }

  return Math.max(
    GREETING_MIN_FONT_SIZE_PX,
    Math.min(
      GREETING_MAX_FONT_SIZE_PX,
      Math.floor(GREETING_MAX_FONT_SIZE_PX * (availableWidthPx / naturalTextWidthPx)),
    ),
  );
}

export function ConversationDraftEmptyState({
  className,
  compactForRemoteControl = false,
}: {
  className?: string;
  compactForRemoteControl?: boolean;
}) {
  const { intl } = useZCodeIntl();
  const isOfficeMode = useIsOfficeMode();
  const [greetingDate, setGreetingDate] = useState(() => new Date());
  const greetingContainerRef = useRef<HTMLParagraphElement | null>(null);
  const greetingMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const greeting = intl.formatMessage({
    id: isOfficeMode ? "chat.empty.greeting.office" : getChatEmptyGreetingMessageId(greetingDate),
  });

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setGreetingDate(new Date());
    }, getNextChatEmptyGreetingDelayMs(greetingDate));

    return () => {
      window.clearTimeout(timeout);
    };
  }, [greetingDate]);

  useLayoutEffect(() => {
    if (compactForRemoteControl) {
      return;
    }
    const container = greetingContainerRef.current;
    const measurement = greetingMeasurementRef.current;
    if (!container || !measurement) {
      return;
    }

    const measure = () => {
      const containerStyle = window.getComputedStyle(container);
      const horizontalPaddingPx =
        Number.parseFloat(containerStyle.paddingLeft) +
        Number.parseFloat(containerStyle.paddingRight);
      const availableWidthPx = Math.max(
        0,
        container.getBoundingClientRect().width - horizontalPaddingPx,
      );
      const naturalTextWidthPx = measurement.getBoundingClientRect().width;
      const nextFontSizePx = resolveGreetingFontSizePx({
        availableWidthPx,
        naturalTextWidthPx,
      });

      const nextFontSize = `${nextFontSizePx}px`;
      if (container.style.getPropertyValue("--v4-draft-greeting-font-size") === nextFontSize) {
        return;
      }
      // Bugfix：侧栏收窄时，RO → RAF → React state 会先画出旧字号的两行标题，
      // 把输入框推下再弹回。字号只属于 DOM 投影，必须在本次绘制前直接适配。
      container.style.setProperty("--v4-draft-greeting-font-size", nextFontSize);
      logger.debug("[v4-draft-greeting] 标题自身可用宽度变化，更新字号", {
        availableWidthPx: Math.round(availableWidthPx),
        naturalTextWidthPx: Math.round(naturalTextWidthPx),
        nextFontSizePx,
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        window.removeEventListener("resize", measure);
      };
    }

    // 标题字号曾直接绑定整个视口宽度，最小窗口里文字两侧仍有大量空间却被
    // 强制缩到 20px。分别观察标题容器和 30px 原始文案，只在两者真实相撞时缩小。
    const observer = new ResizeObserver(measure);
    // 可见标题的高度会随字号改变；观察它会让同步适配反过来触发 RO 循环。
    // 隐藏测量区字号固定，分别提供可用宽度和原始文案宽度，不受适配结果影响。
    observer.observe(measurement.parentElement!);
    observer.observe(measurement);
    return () => {
      observer.disconnect();
    };
  }, [compactForRemoteControl, greeting]);

  return (
    <div
      className={cn(
        "relative mb-10 flex w-full max-w-2xl flex-col items-center justify-center gap-6 text-foreground sm:mb-8",
        className,
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 aspect-[400/250] w-[min(72vw,25rem)] -mt-10",
          "-translate-x-1/2 -translate-y-1/2 text-foreground-subtlest",
        )}
      >
        <ZCodeEmptyStateLogo className="h-full w-full" />
      </div>
      <p
        ref={greetingContainerRef}
        data-v4-draft-greeting="true"
        className={cn(
          "relative z-10 w-full px-4 text-center font-medium text-foreground",
          compactForRemoteControl
            ? "text-xl/[1.2]"
            : "text-[length:var(--v4-draft-greeting-font-size,30px)]/[1.2]",
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none invisible absolute inset-x-4 whitespace-nowrap text-3xl/[1.2]"
        >
          <span ref={greetingMeasurementRef} className="inline-block">
            {greeting}
          </span>
        </span>
        <span>{greeting}</span>
      </p>
    </div>
  );
}

function ZCodeEmptyStateLogo({ className }: { className?: string }) {
  return (
    <>
      {/* 浅色沿用 ZCode 原版内联线框：单条 currentColor 描边 + 底部渐隐遮罩。 */}
      <svg
        aria-hidden="true"
        className={cn(
          className,
          "opacity-70 dark:hidden",
          "[-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]",
          "[mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[mask-repeat:no-repeat] [mask-size:100%_100%]",
        )}
        width="400"
        height="250"
        viewBox="0 0 400 250"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* 品牌字形从 Z 换成 W。W 的 bbox 是 710x435，按容器 88% 宽度等比缩放后居中。 */}
        <g transform="translate(24 17.17) scale(0.49577) translate(-157 -294)">
          <path
            d="M 267.00 294.00 L 267.00 294.00 L 349.31 532.68 L 294.30 692.19 L 157.00 294.00 Z"
            stroke="currentColor"
          />
          <path
            d="M 307.00 729.00 L 307.00 729.00 L 444.30 330.81 L 499.31 490.32 L 417.00 729.00 Z"
            stroke="currentColor"
          />
          <path
            d="M 567.00 294.00 L 567.00 294.00 L 649.31 532.68 L 594.30 692.19 L 457.00 294.00 Z"
            stroke="currentColor"
          />
          <path
            d="M 607.00 729.00 L 607.00 729.00 L 757.00 294.00 L 867.00 294.00 L 717.00 729.00 Z"
            stroke="currentColor"
          />
        </g>
      </svg>
      {/* 深色沿用 ZCode 原版做法：资源自带「模糊光晕 + 渐变描边」两层，
          不是单层平描边。资源本身使用浅色渐变，保证在深色底上可见；
          与浅色图形通过主题类互斥显示，避免同时占位。 */}
      <img
        aria-hidden="true"
        className={cn(
          className,
          "hidden dark:block",
          // 光晕资源自身只有描边渐变，叠加与浅色一致的底部渐隐，避免下缘突然截断。
          "[-webkit-mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[-webkit-mask-repeat:no-repeat] [-webkit-mask-size:100%_100%]",
          "[mask-image:linear-gradient(to_bottom,black_0%,transparent_70%,transparent_100%)]",
          "[mask-repeat:no-repeat] [mask-size:100%_100%]",
        )}
        data-v4-draft-logo="dark"
        src={darkEmptyStateLogoUrl}
        alt=""
      />
    </>
  );
}
