import type { ReactNode } from "react";
import { cn } from "@/components/lib/utils.js";

interface RootStartupLoadingProps {
  label: string;
  children?: ReactNode;
  busy?: boolean;
}

export function RootStartupLoading({ label, children, busy = true }: RootStartupLoadingProps) {
  return (
    <div
      // Web 端全局 html/body/#root 为 Electron 透明背景让路，React 接管后会替换 HTML 启动壳。
      // 这里必须由阻塞态自身承接主题背景，否则远控链接会在 Root 恢复期间继续露出浏览器白底。
      className="flex h-full min-h-dvh flex-col items-center justify-center gap-6 bg-background text-foreground"
      role="status"
      aria-busy={busy}
      aria-label={label}
      data-testid="root-startup-loading"
    >
      <ZCodeStartupLogoBadge />
      {children}
    </div>
  );
}

/** 初始化与引导共用品牌图标，保持底色、描边、圆角和标志比例一致。 */
export function ZCodeStartupLogoBadge({
  animated = true,
  size = "default",
}: {
  animated?: boolean;
  size?: "default" | "titlebar";
}) {
  return (
    <div
      data-desktop-logo-badge={size === "titlebar" ? "true" : undefined}
      className={cn(
        // WCode 品牌：白底 + 黑字，与 build/icon.png 一致。
        // 深色主题下白底仍可辨识，因此边框用中性灰而非白色叠加。
        "relative flex items-center justify-center bg-[#ffffff] text-[#000000] before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:border before:border-[rgba(0,0,0,0.08)] before:content-['']",
        size === "titlebar"
          ? // 标题栏/侧边栏这个尺寸很小，投影在白底上会糊成一圈灰边，去掉投影只留描边。
            "size-5 rounded before:border-black/15"
          : "size-24 rounded-3xl shadow-xl/20",
      )}
    >
      {/* Button 会给 SVG 默认尺寸；紧凑 Logo 显式恢复自动高度，保持标志原始比例。
          W 字形宽高比 710:435 比原 Z 的 256:218 更宽，标题栏尺寸同步放大以免挤压。 */}
      <ZCodeStartupLogo
        className={size === "titlebar" ? "size-auto w-4" : "h-auto w-16"}
        animated={animated}
      />
    </div>
  );
}

export function ZCodeStartupLogo({
  className,
  animated = true,
}: {
  className?: string;
  animated?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="710"
      height="435"
      fill="none"
      viewBox="0 0 710 435"
      className={cn("shrink-0 text-current", className)}
      aria-hidden="true"
      focusable="false"
    >
      {animated ? (
        <animate
          attributeName="opacity"
          begin="3s"
          dur="1.8s"
          repeatCount="indefinite"
          values="1;0.4;1"
        />
      ) : null}
      <g transform="translate(-157 -294)">
        <path
          fill="currentColor"
          d="M 267.00 294.00 L 267.00 294.00 L 349.31 532.68 L 294.30 692.19 L 157.00 294.00 Z"
        />
        <path
          fill="currentColor"
          d="M 307.00 729.00 L 307.00 729.00 L 444.30 330.81 L 499.31 490.32 L 417.00 729.00 Z"
        />
        <path
          fill="currentColor"
          d="M 567.00 294.00 L 567.00 294.00 L 649.31 532.68 L 594.30 692.19 L 457.00 294.00 Z"
        />
        <path
          fill="currentColor"
          d="M 607.00 729.00 L 607.00 729.00 L 757.00 294.00 L 867.00 294.00 L 717.00 729.00 Z"
        />
      </g>
    </svg>
  );
}
