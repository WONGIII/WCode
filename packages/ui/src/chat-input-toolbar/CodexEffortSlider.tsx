import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { cn } from "@/components/lib/utils.js";
import { ControlHintTooltip } from "@/ControlHintTooltip.js";
import "@/chat-input-toolbar/codex-effort-slider.css";

/**
 * Codex 风格推理档位滑块。
 *
 * 视觉移植自 .tmp-preview/codex-slider.html：
 * - 蓝色轨道填充 + 白色刻度圆点
 * - Ultra（最高档）紫色流光 + 扫光警告
 * - 白色粒子层：Ultra 未开 Fast 时原地晃动，开 Fast 后获得横向位移
 * - 进入 Ultra 的紫色爆发粒子
 *
 * 与预览页的关键差异（避免直接硬搬导致 UI 错位）：
 * 1. 轨道按父容器宽度自适应，不使用预览页的绝对定位弹层。
 * 2. 粒子速度按真实帧间隔计算，高刷屏不会翻倍。
 * 3. 首次挂载在 Ultra 档时不播放「进入 Ultra」警告，只有档位切换才触发。
 * 4. 所有交互都阻止冒泡，避免 Radix DropdownMenuItem 把拖动当成菜单选择。
 */

/** 粒子种子：固定后可避免重渲染时位置跳变。 */
const PARTICLE_SEEDS: readonly (readonly [number, number])[] = [
  [17, 15],
  [20, 12],
  [28, 18],
  [48, 21],
  [69, 23],
  [95, 15],
  [112, 20],
  [134, 15],
  [138, 24],
  [150, 9],
  [165, 20],
  [177, 10],
  [190, 22],
  [198, 26],
  [217, 15],
  [237, 18],
  [254, 12],
  [275, 24],
  [290, 14],
  [315, 20],
];

/** 粒子横穿速度相对插件基准的缩放；0.6 是预览页实测观感更稳的值。 */
const PARTICLE_SPEED_SCALE = 0.6;
const KNOB_SIZE = 30;
const KNOB_RADIUS = KNOB_SIZE / 2;
const RAIL_HEIGHT = 26;

export interface CodexEffortSliderProps {
  /** 档位标题行；由调用方传入，保持与非 Codex 模式一致。 */
  heading: ReactNode;
  /** 档位数量（至少 2）。 */
  levelCount: number;
  /** 当前档位下标。 */
  value: number;
  /** 是否最高档（Ultra）。 */
  ultra: boolean;
  /** Fast 视觉开关是否生效（已综合总开关与闪电可见性）。 */
  fast: boolean;
  /** 是否显示 Fast 闪电按钮。 */
  showFastBolt: boolean;
  /** 是否显示「无实际作用」说明。 */
  showNoEffectNote: boolean;
  disabled?: boolean;
  /** Fast 按钮的无障碍标签。 */
  fastLabel: string;
  /** Fast 按钮悬停提示（1.5 倍速 · 用量更多）。 */
  fastHint?: string;
  /** 「无实际作用」说明文案。 */
  noEffectNote?: string;
  /** 进入 Ultra 时的扫光警告文案。 */
  ultraWarning: string;
  /** 档位变化回调；不排队、不锁，立即提交。 */
  onValueChange: (index: number) => void;
  /** Fast 切换回调。 */
  onFastChange: (next: boolean) => void;
  className?: string;
}

export function CodexEffortSlider({
  heading,
  levelCount,
  value,
  ultra,
  fast,
  showFastBolt,
  showNoEffectNote,
  disabled = false,
  fastLabel,
  fastHint,
  noEffectNote,
  ultraWarning,
  onValueChange,
  onFastChange,
  className,
}: CodexEffortSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [warning, setWarning] = useState(false);

  // 动画状态放在 ref：每帧读写，用 state 会触发重渲染。
  const motion = useRef({
    speed: 0,
    from: 0,
    target: 0,
    changedAt: 0,
    travel: 0,
    // 蓝色 ↔ 紫色填充的连续混合值；粒子与填充共用同一条缓动曲线，不做硬切。
    mix: 0,
    mixFrom: 0,
    mixTarget: 0,
    mixChangedAt: 0,
  });
  const lastFrameAt = useRef(0);

  const fraction = levelCount > 1 ? value / (levelCount - 1) : 0;
  const latest = useRef({ ultra, fast, fraction });
  latest.current = { ultra, fast, fraction };

  // 首次挂载时如果已经在 Ultra，不应重播「进入 Ultra」的警告。
  const previousUltra = useRef(ultra);
  useEffect(() => {
    const wasUltra = previousUltra.current;
    previousUltra.current = ultra;
    if (ultra === wasUltra) {
      return;
    }
    if (!ultra) {
      setWarning(false);
      return;
    }

    setWarning(true);
    const clearTimer = window.setTimeout(() => setWarning(false), 1800);
    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [ultra]);

  // 粒子与爆发动画循环。
  useEffect(() => {
    const canvas = particlesRef.current;
    const rail = railRef.current;
    if (!canvas || !rail) {
      return;
    }

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    let frame = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(0, rail.clientWidth);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(RAIL_HEIGHT * dpr);
    };
    resize();
    // ResizeObserver 观察轨道本身：菜单宽度变化时粒子层跟着重算缓冲区。
    const observer = new ResizeObserver(resize);
    observer.observe(rail);

    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      // 用真实帧间隔而不是固定 1/60：高刷屏上固定值会让位移变快。
      const delta = lastFrameAt.current ? Math.min(now - lastFrameAt.current, 50) / 1000 : 0;
      lastFrameAt.current = now;

      const current = latest.current;
      const m = motion.current;

      // 蓝色 → 紫色：连续缓动，进入/退出 Ultra 时填充颜色和粒子速度共用同一进度。
      const mixTarget = current.ultra ? 1 : 0;
      if (mixTarget !== m.mixTarget) {
        m.mixFrom = m.mix;
        m.mixTarget = mixTarget;
        m.mixChangedAt = now;
      }
      const mixProgress = Math.min(1, Math.max(0, (now - m.mixChangedAt) / 460));
      m.mix = m.mixFrom + (m.mixTarget - m.mixFrom) * mixProgress * mixProgress * (3 - 2 * mixProgress);

      const target = current.fast ? m.mix : 0;
      if (target !== m.target) {
        m.from = m.speed;
        m.target = target;
        m.changedAt = now;
      }
      const progress = Math.min(1, Math.max(0, (now - m.changedAt) / (m.target ? 600 : 750)));
      // smoothstep：两端缓入缓出，避免开关瞬间突兀。
      m.speed = m.from + (m.target - m.from) * progress * progress * (3 - 2 * progress);
      m.travel += delta * m.speed * PARTICLE_SPEED_SCALE;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const t = now / 1000;
      const speed = m.speed;
      const width = canvas.width / dpr;

      // Fast 但未到 Ultra 时粒子只原地晃动；Ultra 且 Fast 才横向流动。
      // 粒子必须裁剪在蓝色填充区内：填充为 0 档时该层本身透明，不能再露出粒子。
      const fillWidth =
        current.fraction > 0 ? (width - KNOB_SIZE) * current.fraction + KNOB_RADIUS : 0;
      if ((current.ultra || current.fast || m.mix > 0.01) && fillWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, fillWidth * dpr, canvas.height);
        ctx.clip();
        for (let i = 0; i < PARTICLE_SEEDS.length; i += 1) {
          const seed = PARTICLE_SEEDS[i]!;
          const px = seed[0];
          const py = seed[1];
          const phase = i * 2.39;
          const offset = m.travel * (145 + (i % 6) * 17);
          const x =
            ((((px / 346) * width - offset + Math.sin(t * 9 + phase) * 0.7 * (1 - speed)) % width) +
              width) %
            width;
          const y =
            (py +
              Math.cos(t * 10 + phase) * 0.55 * (1 - speed) +
              Math.sin(t * 1.3 + phase) * 0.8 * speed) *
            (RAIL_HEIGHT / 36);
          const idle = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.1 + phase));
          const moving = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + phase));
          const radius = (i % 7 === 0 ? 2.1 : i % 4 === 0 ? 1.55 : 1.1) * (RAIL_HEIGHT / 36);

          ctx.beginPath();
          ctx.arc(x * dpr, y * dpr, radius * dpr, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,255,255,${idle + (moving - idle) * speed})`;
          ctx.fill();
        }
        ctx.restore();
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      lastFrameAt.current = 0;
    };
  }, []);

  /** 指针位置映射到最近的档位下标。 */
  const nearestIndex = useCallback(
    (clientX: number) => {
      const rail = railRef.current;
      if (!rail || levelCount < 2) {
        return 0;
      }
      const box = rail.getBoundingClientRect();
      const usableWidth = box.width - KNOB_SIZE;
      const ratio =
        usableWidth > 0
          ? Math.max(0, Math.min(1, (clientX - box.left - KNOB_RADIUS) / usableWidth))
          : 0;
      return Math.round(ratio * (levelCount - 1));
    },
    [levelCount],
  );

  const commitIndex = useCallback(
    (index: number) => {
      if (disabled) {
        return;
      }
      const clamped = Math.max(0, Math.min(levelCount - 1, index));
      if (clamped !== value) {
        onValueChange(clamped);
      }
    },
    [disabled, levelCount, onValueChange, value],
  );

  const stopMenuInteraction = (event: ReactPointerEvent) => {
    // 拖动/点击滑轨不能冒泡到 DropdownMenuItem，否则菜单会被当成「已选择」关闭。
    event.stopPropagation();
  };

  return (
    <div
      className={cn("relative", className)}
      data-codex-effort="true"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className={cn("transition-opacity duration-200", warning && "opacity-0")}>
        {heading}
        {showFastBolt ? (
          <div className="mb-1.5 flex min-h-5 items-center gap-2">
            <ControlHintTooltip
              title={fastHint}
              description={showNoEffectNote ? noEffectNote : undefined}
              standalone
              side="top"
              sideOffset={6}
              // 菜单内容层级是 z-[60]，默认 tooltip 的 z-50 会被菜单盖住。
              className="z-[70]"
            >
              <button
                type="button"
                data-testid="codex-effort-fast-toggle"
                data-active={fast || undefined}
                data-ultra={ultra || undefined}
                aria-label={fastLabel}
                aria-pressed={fast}
                className="codex-effort-fast flex size-6 items-center justify-center rounded-md text-foreground-subtle transition-colors hover:bg-foreground/5 hover:text-foreground"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onFastChange(!fast);
                }}
              >
                <svg
                  className="codex-effort-bolt"
                  data-active={fast || undefined}
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M14.4 2Q16 .2 15.8 2.5L15.1 8.5H20.5Q22 8.5 21 9.8L10.7 21.7Q9 23.4 9.2 21.2L10 14.2H4.2Q2.6 14.2 3.6 12.9L14.4 2Z" />
                </svg>
              </button>
            </ControlHintTooltip>
            {showNoEffectNote && noEffectNote ? (
              <span className="codex-effort-note min-w-0 truncate">{noEffectNote}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* 扫光警告：进入 Ultra 时短暂覆盖标题行，不改变滑块高度。
          不使用独立背景色：菜单项 hover/选中高亮需要连续铺满整行，
          否则会在高亮上留下一个突兀的浅色方块。 */}
      {warning ? (
        <div
          className="codex-effort-warning absolute inset-x-0 top-0 z-10 py-1 text-center text-ui-sm"
          aria-live="polite"
        >
          <span>{ultraWarning}</span>
        </div>
      ) : null}

      <div className="relative mt-0.5 h-[30px]">
        <div
          ref={railRef}
          data-testid="codex-effort-rail"
          data-effort={ultra ? "max" : String(value)}
          data-ultra={ultra || undefined}
          data-fast={fast || undefined}
          data-dragging={dragging || undefined}
          data-disabled={disabled || undefined}
          className={cn(
            "codex-effort-rail relative h-[26px] w-full rounded-[16px] outline-none",
            disabled && "opacity-50",
          )}
          style={{ "--codex-effort-pos": fraction } as CSSProperties}
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled || undefined}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, levelCount - 1)}
          aria-valuenow={value}
          onPointerDown={(event) => {
            if (disabled || levelCount < 2) {
              return;
            }
            stopMenuInteraction(event);
            event.currentTarget.setPointerCapture(event.pointerId);
            setDragging(true);
            commitIndex(nearestIndex(event.clientX));
          }}
          onPointerMove={(event) => {
            if (disabled || levelCount < 2) {
              return;
            }
            if (dragging) {
              commitIndex(nearestIndex(event.clientX));
              return;
            }
            const rail = railRef.current;
            if (!rail) {
              return;
            }
            const box = rail.getBoundingClientRect();
            const index = nearestIndex(event.clientX);
            const tickX =
              box.left + KNOB_RADIUS + (index / (levelCount - 1)) * (box.width - KNOB_SIZE);
            setHoveredIndex(Math.abs(event.clientX - tickX) < 10 && index !== value ? index : -1);
          }}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onPointerLeave={() => setHoveredIndex(-1)}
          onKeyDown={(event) => {
            if (disabled) {
              return;
            }
            let next = value;
            if (event.key === "ArrowRight" || event.key === "ArrowUp") {
              next += 1;
            } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
              next -= 1;
            } else if (event.key === "Home") {
              next = 0;
            } else if (event.key === "End") {
              next = levelCount - 1;
            } else {
              // 方向键等按键不能冒泡给菜单；Escape 除外，交给 Radix 关闭菜单。
              if (event.key !== "Escape") {
                event.stopPropagation();
              }
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            commitIndex(next);
          }}
        >
          {/* 填充层：左端圆角、右端直角，伸到手柄正下方。
              底层固定蓝色，Ultra 渐变层通过 opacity 渐变叠加，避免蓝紫硬切。 */}
          <div
            className="codex-effort-fill absolute inset-y-0 left-0 overflow-hidden rounded-l-[16px]"
            style={{ width: `calc((100% - ${KNOB_SIZE}px) * ${fraction} + ${KNOB_RADIUS}px)` }}
          >
            <div className="codex-effort-ultra-layer pointer-events-none absolute inset-0" />
          </div>

          {/* 刻度圆点：Ultra 下隐藏，Fast 下已覆盖的圆点也隐藏。 */}
          {Array.from({ length: levelCount }, (_, index) => (
            <span
              key={index}
              data-testid="codex-effort-dot"
              data-passed={index <= value || undefined}
              data-covered={index < value || undefined}
              data-hovered={hoveredIndex === index || undefined}
              className="codex-effort-dot absolute top-[11px] size-1 -translate-x-1/2 rounded-full"
              style={{
                left: `calc((100% - ${KNOB_SIZE}px) * ${
                  levelCount > 1 ? index / (levelCount - 1) : 0
                } + ${KNOB_RADIUS}px)`,
              }}
            />
          ))}

          {/* 粒子层：Ultra 或 Fast 时可见。 */}
          <div className="codex-effort-sparks absolute inset-0 overflow-hidden rounded-[16px]">
            <canvas ref={particlesRef} className="block h-[26px] w-full" aria-hidden="true" />
          </div>

          {/* 手柄：始终静止，不参与任何抖动动画。 */}
          <div
            className="codex-effort-knob absolute -top-0.5 size-[30px] rounded-full"
            style={{ left: `calc((100% - ${KNOB_SIZE}px) * ${fraction})` }}
          />

        </div>
      </div>
    </div>
  );
}
