import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/components/lib/utils.js";

/**
 * Codex 风格推理档位滑块。
 *
 * 移植自 DSH-Codex-reasoning-effort-slider 的核心视觉：
 * - 蓝色轨道填充 + 白色刻度圆点
 * - Ultra（最高档）紫色流光 + 白色粒子层
 * - 粒子在 Ultra 未开 Fast 时原地晃动，开 Fast 后横向流动
 * - 进入 Ultra 的爆发粒子与扫光警告
 *
 * 与插件的差异（按本产品需求）：
 * 1. 不锁运行态——回合进行中也允许改档位，不排队等待。
 *    插件锁档是因为档位变更会让历史 thinking 块与请求不匹配；
 *    这里接受该风险以换取即时响应。
 * 2. 粒子速度默认 0.6×（插件 1.0× 在本产品轨道宽度下偏快）。
 * 3. 用真实帧间隔而非固定 1/60，避免高刷屏上位移翻倍。
 */

/** 粒子种子：与插件一致，固定后可避免重渲染时位置跳变。 */
const PARTICLE_SEEDS: readonly [number, number][] = [
  [17, 15], [20, 12], [28, 18], [48, 21], [69, 23], [95, 15], [112, 20],
  [134, 15], [138, 24], [150, 9], [165, 20], [177, 10], [190, 22], [198, 26],
  [217, 15], [237, 18], [254, 12], [275, 24], [290, 14], [315, 20],
];

/** 粒子横穿速度相对插件基准的缩放；0.6 是实测观感更稳的值。 */
const PARTICLE_SPEED_SCALE = 0.6;

export interface CodexEffortSliderProps {
  /** 档位数量（至少 2）。 */
  levelCount: number;
  /** 当前档位下标。 */
  value: number;
  /** 档位变化回调；不排队、不锁，立即提交。 */
  onValueChange: (index: number) => void;
  /** 是否最高档（Ultra）。 */
  ultra: boolean;
  /** Fast 视觉开关状态。 */
  fast: boolean;
  /** 是否显示 Fast 按钮。 */
  showFastBolt: boolean;
  /** Fast 切换回调。 */
  onFastChange: (next: boolean) => void;
  /** 是否禁用整条滑块。 */
  disabled?: boolean;
  /** Fast 按钮的无障碍标签。 */
  fastLabel: string;
  /** "无实际作用" 说明文案；传入则显示。 */
  noEffectNote?: string;
  className?: string;
}

export function CodexEffortSlider({
  levelCount,
  value,
  onValueChange,
  ultra,
  fast,
  showFastBolt,
  onFastChange,
  disabled = false,
  fastLabel,
  noEffectNote,
  className,
}: CodexEffortSliderProps) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const particlesRef = useRef<HTMLCanvasElement | null>(null);
  const burstRef = useRef<HTMLCanvasElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [message, setMessage] = useState(false);

  // 动画状态放 ref：每帧读写，用 state 会触发重渲染。
  const motion = useRef({ speed: 0, from: 0, target: 0, changedAt: 0, travel: 0, burst: 0 });
  const lastFrameAt = useRef(0);
  const latest = useRef({ ultra: false, fast: false, disabled: false });
  latest.current = { ultra, fast, disabled };

  const fraction = levelCount > 1 ? value / (levelCount - 1) : 0;

  /** 进入 Ultra 时触发扫光警告与爆发粒子。 */
  useEffect(() => {
    if (!ultra) {
      setMessage(false);
      motion.current.burst = 0;
      return;
    }
    setMessage(true);
    const burstTimer = window.setTimeout(() => {
      motion.current.burst = performance.now();
    }, 220);
    const clearTimer = window.setTimeout(() => setMessage(false), 1800);
    return () => {
      window.clearTimeout(burstTimer);
      window.clearTimeout(clearTimer);
    };
  }, [ultra]);

  /** 粒子与爆发动画循环。 */
  useEffect(() => {
    const canvas = particlesRef.current;
    const burstCanvas = burstRef.current;
    const rail = railRef.current;
    if (!canvas || !burstCanvas || !rail) return;

    const ctx = canvas.getContext("2d");
    const bctx = burstCanvas.getContext("2d");
    if (!ctx || !bctx) return;

    let frame = 0;
    let railWidth = 248;

    const observer = new ResizeObserver((entries) => {
      railWidth = entries[0]?.contentRect.width ?? 248;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(railWidth * dpr);
      canvas.height = Math.round(26 * dpr);
      canvas.style.width = `${railWidth}px`;
      canvas.style.height = "26px";
    });
    observer.observe(rail);

    const draw = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const delta = lastFrameAt.current ? Math.min(now - lastFrameAt.current, 50) / 1000 : 0;
      lastFrameAt.current = now;

      const current = latest.current;
      const m = motion.current;
      const target = current.ultra && current.fast ? 1 : 0;
      if (target !== m.target) {
        m.from = m.speed;
        m.target = target;
        m.changedAt = now;
      }
      const progress = Math.min(
        1,
        Math.max(0, (now - m.changedAt) / (m.target ? 600 : 750)),
      );
      // smoothstep：两端缓入缓出，避免开关瞬间突兀。
      m.speed = m.from + (m.target - m.from) * progress * progress * (3 - 2 * progress);
      m.travel += delta * m.speed * PARTICLE_SPEED_SCALE;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      bctx.clearRect(0, 0, burstCanvas.width, burstCanvas.height);

      const t = now / 1000;
      const speed = current.ultra ? m.speed : 0;
      const w = canvas.width / dpr;

      for (let i = 0; i < PARTICLE_SEEDS.length; i += 1) {
        const seed = PARTICLE_SEEDS[i]!;
        const px = seed[0];
        const py = seed[1];
        const phase = i * 2.39;
        // 只有开了 Fast 才有横向位移；否则仅靠 sin/cos 原地晃动。
        const offset = current.ultra ? m.travel * (145 + (i % 6) * 17) : 0;
        const x =
          ((((px / 346) * w - offset + Math.sin(t * 9 + phase) * 0.7 * (1 - speed)) % w) +
            w) %
          w;
        const y =
          (py +
            Math.cos(t * 10 + phase) * 0.55 * (1 - speed) +
            Math.sin(t * 1.3 + phase) * 0.8 * speed) *
          (26 / 36);
        const idle = 0.55 + 0.3 * (0.5 + 0.5 * Math.sin(t * 1.1 + phase));
        const moving = 0.3 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + phase));
        const radius = (i % 7 === 0 ? 2.1 : i % 4 === 0 ? 1.55 : 1.1) * (26 / 36);

        ctx.beginPath();
        ctx.arc(x * dpr, y * dpr, radius * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,255,255,${idle + (moving - idle) * speed})`;
        ctx.fill();
      }

      // 进入 Ultra 的瞬间爆出一圈紫色粒子。
      if (m.burst && now - m.burst < 520) {
        const age = (now - m.burst) / 1000;
        for (let i = 0; i < 22; i += 1) {
          const angle = i * 2.399 + 0.18;
          const x = 72 + Math.cos(angle) * (43 + (48 + (i % 5) * 12) * age * 2);
          const y = 72 + Math.sin(angle) * (43 + (48 + (i % 4) * 10) * age * 2);
          bctx.beginPath();
          bctx.arc(x, y, (i % 6 === 0 ? 2.3 : 1.35) * 2 * (1 - age), 0, Math.PI * 2);
          bctx.fillStyle = `rgba(165,107,233,${0.7 * (1 - age / 0.52)})`;
          bctx.fill();
        }
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
      if (!rail || levelCount < 2) return 0;
      const box = rail.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - box.left - 15) / (box.width - 30)));
      return Math.round(ratio * (levelCount - 1));
    },
    [levelCount],
  );

  const commitIndex = useCallback(
    (index: number) => {
      if (disabled) return;
      const clamped = Math.max(0, Math.min(levelCount - 1, index));
      if (clamped !== value) onValueChange(clamped);
    },
    [disabled, levelCount, onValueChange, value],
  );

  return (
    <div className={cn("relative", className)} data-codex-effort="true">
      {/* Fast 按钮固定在弹层左上，与插件布局一致。 */}
      {showFastBolt ? (
        <button
          type="button"
          data-testid="codex-effort-fast-toggle"
          data-active={fast}
          aria-label={fastLabel}
          aria-pressed={fast}
          className={cn(
            "codex-effort-fast absolute left-0 top-0 z-10 flex size-7 items-center justify-center rounded-md",
            "text-foreground-subtle transition-colors hover:bg-foreground/5 hover:text-foreground",
            fast && "text-[#3988f6]",
            ultra && fast && "text-[#9c4ce3]",
          )}
          onClick={(event) => {
            // 按钮在菜单项内，阻止冒泡避免 Radix 把点击当成菜单选择。
            event.preventDefault();
            event.stopPropagation();
            onFastChange(!fast);
          }}
        >
          <svg className="codex-effort-bolt" data-active={fast} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14.4 2Q16 .2 15.8 2.5L15.1 8.5H20.5Q22 8.5 21 9.8L10.7 21.7Q9 23.4 9.2 21.2L10 14.2H4.2Q2.6 14.2 3.6 12.9L14.4 2Z" />
          </svg>
        </button>
      ) : null}

      {/* "无实际作用" 说明只在 Fast 激活后显示，位置在轨道上方。 */}
      {noEffectNote && fast ? (
        <p className="codex-effort-note absolute inset-x-0 top-0 text-center">{noEffectNote}</p>
      ) : null}

      <div
        ref={railRef}
        data-testid="codex-effort-rail"
        data-effort={ultra ? "max" : String(value)}
        data-dragging={dragging || undefined}
        className={cn(
          "codex-effort-rail relative h-[26px] w-full rounded-[16px]",
          disabled && "opacity-50",
        )}
        style={{ "--codex-effort-pos": fraction } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, levelCount - 1)}
        aria-valuenow={value}
        aria-disabled={disabled}
        onPointerDown={(event) => {
          if (disabled || levelCount < 2) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
          commitIndex(nearestIndex(event.clientX));
        }}
        onPointerMove={(event) => {
          if (dragging) {
            commitIndex(nearestIndex(event.clientX));
            return;
          }
          const rail = railRef.current;
          if (!rail || levelCount < 2) return;
          const box = rail.getBoundingClientRect();
          const index = nearestIndex(event.clientX);
          const tickX = box.left + 15 + (index / (levelCount - 1)) * (box.width - 30);
          setHoveredIndex(
            Math.abs(event.clientX - tickX) < 10 && index !== value ? index : -1,
          );
        }}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onPointerLeave={() => setHoveredIndex(-1)}
        onKeyDown={(event) => {
          let next = value;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") next += 1;
          else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next -= 1;
          else if (event.key === "Home") next = 0;
          else if (event.key === "End") next = levelCount - 1;
          else {
            // 不让 Escape 之外的按键冒泡到菜单，避免方向键被菜单抢走。
            if (event.key !== "Escape") event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          commitIndex(next);
        }}
      >
        {/* 填充层：Ultra 时叠加紫色流光与扫光。 */}
        <div
          className={cn(
            "codex-effort-fill absolute inset-y-0 left-0 overflow-hidden rounded-l-[16px]",
            ultra && "codex-effort-fill-ultra",
          )}
          style={{
            width: `calc((100% - 30px) * ${fraction} + 15px)`,
          }}
        />

        {/* 刻度圆点：Ultra 下整体隐藏（被流光取代）。 */}
        {Array.from({ length: levelCount }, (_, index) => (
          <span
            key={index}
            data-testid="codex-effort-dot"
            data-passed={index <= value || undefined}
            data-covered={index < value || undefined}
            data-hovered={hoveredIndex === index || undefined}
            className="codex-effort-dot absolute top-[11px] size-1 -translate-x-1/2 rounded-full"
            style={{ left: `calc((100% - 30px) * ${levelCount > 1 ? index / (levelCount - 1) : 0} + 15px)` }}
          />
        ))}

        {/* 粒子层：Ultra 或 Fast 时可见。 */}
        <div className="codex-effort-sparks absolute inset-0 overflow-hidden rounded-[16px]">
          <canvas ref={particlesRef} className="block h-[26px] w-full" aria-hidden="true" />
        </div>

        {/* 手柄：始终静止，不参与任何抖动动画。 */}
        <div
          className="codex-effort-knob absolute -top-0.5 size-[30px] rounded-full"
          style={{ left: `calc((100% - 30px) * ${fraction})` }}
        />

        {/* 爆发粒子画布：定位在手柄右上。 */}
        <canvas
          ref={burstRef}
          width={144}
          height={144}
          className="pointer-events-none absolute -top-[52px] h-[52px] w-[52px]"
          style={{ left: "calc(100% - 41px)" }}
          aria-hidden="true"
        />

        {/* 扫光警告：进入 Ultra 后短暂覆盖标题行。 */}
        {message ? (
          <div className="codex-effort-warning pointer-events-none absolute inset-x-0 -top-[45px] text-center text-[13px] leading-[18px]">
            <span>更快消耗使用额度</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
