/**
 * 草稿态空态问候：时间问候语 + ZCode Logo。
 * 自旧版 ChatView/ChatViewEmptyState.tsx 恢复（该组件随旧 ChatView 删除，
 * i18n key `chat.empty.greeting.*` 一直保留）；边界时刻自动换档逻辑保真。
 * 手机远控复用同一组件，但继续保留 20px 紧凑标题；桌面草稿首页才按标题自身宽度适配。
 */
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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

export function getChatEmptyGreetingMessageId(
  date: Date = new Date(),
): ChatEmptyGreetingMessageId {
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
    candidates.find((candidate) => candidate.getTime() > date.getTime()) ??
    tomorrowFirstBoundary;

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
      Math.floor(
        GREETING_MAX_FONT_SIZE_PX * (availableWidthPx / naturalTextWidthPx),
      ),
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
  const [greetingFontSizePx, setGreetingFontSizePx] = useState(
    GREETING_MAX_FONT_SIZE_PX,
  );
  const greetingContainerRef = useRef<HTMLParagraphElement | null>(null);
  const greetingMeasurementRef = useRef<HTMLSpanElement | null>(null);
  const greeting = intl.formatMessage({
    id: isOfficeMode
      ? "chat.empty.greeting.office"
      : getChatEmptyGreetingMessageId(greetingDate),
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
      setGreetingFontSizePx(GREETING_MIN_FONT_SIZE_PX);
      return;
    }
    const container = greetingContainerRef.current;
    const measurement = greetingMeasurementRef.current;
    if (!container || !measurement) {
      return;
    }

    let frameId: number | null = null;
    const measure = () => {
      frameId = null;
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

      setGreetingFontSizePx((currentFontSizePx) => {
        if (currentFontSizePx === nextFontSizePx) {
          return currentFontSizePx;
        }
        logger.debug("[v4-draft-greeting] 标题自身可用宽度变化，更新字号", {
          availableWidthPx: Math.round(availableWidthPx),
          naturalTextWidthPx: Math.round(naturalTextWidthPx),
          previousFontSizePx: currentFontSizePx,
          nextFontSizePx,
        });
        return nextFontSizePx;
      });
    };
    const scheduleMeasure = () => {
      if (frameId !== null) {
        return;
      }
      frameId = window.requestAnimationFrame(measure);
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", scheduleMeasure);
      return () => {
        if (frameId !== null) {
          window.cancelAnimationFrame(frameId);
        }
        window.removeEventListener("resize", scheduleMeasure);
      };
    }

    // 标题字号曾直接绑定整个视口宽度，最小窗口里文字两侧仍有大量空间却被
    // 强制缩到 20px。分别观察标题容器和 30px 原始文案，只在两者真实相撞时缩小。
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    observer.observe(measurement);
    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
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
        style={
          {
            "--v4-draft-greeting-font-size": `${greetingFontSizePx}px`,
          } as CSSProperties
        }
        className={cn(
          "relative z-10 w-full px-4 text-center font-medium text-foreground",
          compactForRemoteControl
            ? "text-xl/[1.2]"
            : "text-[length:var(--v4-draft-greeting-font-size)]/[1.2]",
        )}
      >
        <span
          ref={greetingMeasurementRef}
          aria-hidden="true"
          className="pointer-events-none invisible absolute whitespace-nowrap text-3xl/[1.2]"
        >
          {greeting}
        </span>
        <span>{greeting}</span>
      </p>
    </div>
  );
}

function ZCodeEmptyStateLogo({ className }: { className?: string }) {
  // 修复原因：原先深色态使用 assets/Z.svg 位图作为背景，该资源的渐变是
  // #444/#2A2A2A 深灰，落在深色底上几乎不可见。这里统一用 currentColor
  // 线框，交由 text-foreground-subtlest 随主题取色，两套主题共用同一形状。
  return (
    <svg
      aria-hidden="true"
      className={cn(
        className,
        "opacity-70",
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
  );
}
