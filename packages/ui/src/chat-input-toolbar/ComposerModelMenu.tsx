import { useRef, useState, type ReactNode } from "react";
import { ScrollFadeViewport } from "@/components/ui/scroll-fade-viewport.js";
import { cn } from "@/components/lib/utils.js";
import type { ComposerPlanGroup } from "@/lib/composerPlanGroups.js";
import type { ModelSelectGroup } from "@/ModelConfigSelect.js";
import { isNoThoughtLevel } from "@/chat-input-toolbar/thoughtLevelOptions.js";
import { ComposerEffortHeading } from "@/chat-input-toolbar/ComposerEffortHeading.js";
import { ComposerProviderMenu } from "@/chat-input-toolbar/ComposerProviderMenu.js";
import { CodexEffortSlider } from "@/chat-input-toolbar/CodexEffortSlider.js";
import { useCodexEffortSliderSettings } from "@/hooks/useCodexEffortSliderSettings.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { setCodexEffortSliderSettings } from "@/lib/codexEffortSliderSettings.js";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu.js";
import "@/chat-input-toolbar/composer-thought-slider.css";

// 固定种子避免重渲染重新随机，让最高档气泡错峰流动而不影响模型选择状态。
const EFFORT_BUBBLES = [
  { top: 4, size: 2, duration: 2.6, delay: -0.4 },
  { top: 14, size: 3, duration: 3.2, delay: -2.1 },
  { top: 8, size: 4, duration: 2.8, delay: -1.1 },
  { top: 18, size: 2, duration: 3.6, delay: -0.8 },
  { top: 3, size: 3, duration: 3, delay: -2.5 },
  { top: 12, size: 2, duration: 3.4, delay: -1.7 },
  { top: 6, size: 3, duration: 3.1, delay: -0.9 },
  { top: 17, size: 4, duration: 2.9, delay: -2.3 },
  { top: 10, size: 2, duration: 3.5, delay: -0.2 },
  { top: 2, size: 2, duration: 2.7, delay: -1.8 },
  { top: 15, size: 3, duration: 3.3, delay: -1.2 },
  { top: 7, size: 4, duration: 3.6, delay: -3.1 },
];

const HIGHSPEED_BUBBLES = Array.from({ length: 32 }, (_, index) => ({
  ...EFFORT_BUBBLES[index % EFFORT_BUBBLES.length]!,
  duration: (8 + (index % 5)) / 10,
  delay: -index * 0.137,
}));

export interface ComposerModelOptions {
  providerMenu?: {
    groups: readonly ComposerPlanGroup[];
    selectedKey?: string;
    pending: boolean;
    error: string | null;
    onSelect: (group: ComposerPlanGroup) => void;
  };
  providerLabel: string;
  modelsLabel: string;
  effortLabel: string;
  effortShortcutLabel?: string;
  selectModelLabel: string;
  levels: readonly { value: string; label: string }[];
  value: string;
  onValueChange: (value: string) => void;
}

export function getComposerThoughtDisplay(options: ComposerModelOptions) {
  const current = options.levels.find((level) => level.value === options.value);
  const thinking = options.levels.filter((level) => !isNoThoughtLevel(level));
  const progress =
    current && !isNoThoughtLevel(current)
      ? ((thinking.findIndex((level) => level.value === current.value) + 1) / thinking.length) * 100
      : 0;
  return { label: current?.label ?? "—", progress };
}

export function isGlmHighspeedModel(name: string) {
  // GLM FlashX 与 Highspeed 共用视觉；只按显示名称判定，避免误命中其他品牌。
  return /glm/i.test(name) && /highspeed|flashx/i.test(name);
}

export function ComposerThoughtIndicator({
  options,
  highspeed = false,
}: {
  options: ComposerModelOptions;
  highspeed?: boolean;
}) {
  const { label, progress } = getComposerThoughtDisplay(options);
  const codexSettings = useCodexEffortSliderSettings();
  const currentIndex = options.levels.findIndex((level) => level.value === options.value);
  const currentLevel = currentIndex >= 0 ? options.levels[currentIndex] : undefined;
  // 输入框触发器与菜单使用同一判定：只有 Codex 模式、已选中连接且位于最后一档才是 Ultra。
  const ultra =
    codexSettings.enabled &&
    currentLevel !== undefined &&
    currentIndex === options.levels.length - 1 &&
    !isNoThoughtLevel(currentLevel);
  // 闪电按钮被隐藏时，不再让持久化的 Fast 状态在触发器上留下残影。
  const fast = codexSettings.enabled && codexSettings.showFastBolt && codexSettings.fastActive;
  return (
    <>
      {fast ? (
        <svg
          className="codex-effort-trigger-bolt shrink-0 text-foreground group-data-[composer-compact=true]/combined:hidden"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M14.4 2Q16 .2 15.8 2.5L15.1 8.5H20.5Q22 8.5 21 9.8L10.7 21.7Q9 23.4 9.2 21.2L10 14.2H4.2Q2.6 14.2 3.6 12.9L14.4 2Z" />
        </svg>
      ) : null}
      <span
        className={cn(
          "shrink-0 text-foreground-subtle group-data-[composer-compact=true]/combined:hidden",
          ultra && "codex-effort-trigger-effort",
        )}
        data-ultra={ultra || undefined}
        data-composer-thought-label
      >
        {label}
      </span>
      <span
        aria-hidden="true"
        data-testid="composer-thought-meter"
        data-highspeed={highspeed}
        data-progress={progress}
        className="relative hidden h-4 w-1 shrink-0 overflow-hidden rounded-full bg-foreground/10 group-data-[composer-compact=true]/combined:block"
      >
        <span
          className="composer-thought-meter-fill absolute bottom-0 left-0 w-full rounded-full bg-success"
          style={{ height: `${progress}%` }}
        />
      </span>
    </>
  );
}

export function ComposerModelMenu({
  groups,
  normalizedValue,
  options,
  renderItems,
  renderConnection,
  providerFooter,
  isItemLocked,
  onSelectModel,
}: {
  groups: readonly ModelSelectGroup[];
  normalizedValue: string;
  options: ComposerModelOptions;
  renderItems: (items: ModelSelectGroup["items"]) => ReactNode;
  renderConnection: (group: ModelSelectGroup) => ReactNode;
  providerFooter?: ReactNode;
  isItemLocked: (value: string) => boolean;
  onSelectModel: (value: string) => void;
}) {
  // 无可用模型的分组仍可浏览配置；实际选择始终由 Composer owner 回传。
  const [browse, setBrowse] = useState<{ key: string; selection: string } | null>(null);
  const menuGroups: readonly ComposerPlanGroup[] = options.providerMenu?.groups ?? groups;
  const selected =
    menuGroups.find((group) => group.key === options.providerMenu?.selectedKey) ??
    menuGroups.find((group) => group.items.some((item) => item.value === normalizedValue));
  const group =
    (browse?.selection === normalizedValue
      ? menuGroups.find((item) => item.key === browse.key)
      : undefined) ??
    selected ??
    menuGroups[0];
  // 视觉只由选中模型名称派生，避免供应商名或内部 value 含 highspeed 时误触发。
  const modelName = selected?.items.find((item) => item.value === normalizedValue)?.name ?? "";
  const highspeed = isGlmHighspeedModel(modelName);
  const currentGroupSelected = group?.key === selected?.key && Boolean(selected);
  const currentIndex = options.levels.findIndex((level) => level.value === options.value);
  const { label } = getComposerThoughtDisplay(options);
  const sliderRef = useRef<HTMLInputElement>(null);
  const catalogPending = groups.length === 0 && Boolean(normalizedValue);
  const showEffort = options.levels.length > 0 || catalogPending;
  const [hoveredStop, setHoveredStop] = useState<string | null>(null);
  const codexSettings = useCodexEffortSliderSettings();
  const { intl } = useZCodeIntl();
  const codexEnabled = codexSettings.enabled;
  const currentLevel = currentIndex >= 0 ? options.levels[currentIndex] : undefined;
  // Ultra 只看「当前连接已选中 + 档位目录的最后一档」，与持久化的 Fast 状态无关。
  const codexUltra =
    codexEnabled &&
    currentGroupSelected &&
    currentIndex >= 0 &&
    currentIndex === options.levels.length - 1 &&
    currentLevel !== undefined &&
    !isNoThoughtLevel(currentLevel);
  // 弹层里关闭了闪电按钮时，不再让持久化的 Fast 状态悄悄影响粒子动画。
  const codexFast =
    codexEnabled && currentGroupSelected && codexSettings.showFastBolt && codexSettings.fastActive;
  const sliderDisabled =
    Boolean(options.providerMenu?.pending) || !currentGroupSelected || options.levels.length < 2;
  const sliderProgress =
    options.levels.length > 1 && currentIndex >= 0 && currentGroupSelected
      ? (currentIndex / (options.levels.length - 1)) * 100
      : 0;
  const sliderFilled =
    currentGroupSelected && currentIndex >= 0 && !isNoThoughtLevel(options.levels[currentIndex]!);
  const selectSliderValue = (index: number) => {
    const level = options.levels[index];
    if (!sliderDisabled && level && level.value !== options.value)
      options.onValueChange(level.value);
  };
  return (
    <>
      <ComposerProviderMenu
        groups={menuGroups}
        error={options.providerMenu?.error}
        disabled={options.providerMenu?.pending}
        loading={options.providerMenu?.pending}
        isDisabled={(candidate) => Boolean((candidate as ComposerPlanGroup).connection?.disabled)}
        separatorBeforeKey={
          options.providerMenu
            ? menuGroups.find(
                (candidate) =>
                  !candidate.connection && !candidate.key.startsWith("registry-provider:account:"),
              )?.key
            : undefined
        }
        group={group}
        label={options.providerLabel}
        providerFooter={providerFooter}
        onSelect={(candidate) => {
          if (options.providerMenu) {
            options.providerMenu.onSelect(candidate as ComposerPlanGroup);
            return;
          }
          setBrowse({ key: candidate.key, selection: normalizedValue });
          // 复用唯一选择链路，供应商页只负责导航，不缓存模型状态。
          const model =
            candidate.items.find(
              (item) => item.value === normalizedValue && !isItemLocked(item.value),
            ) ?? candidate.items.find((item) => !isItemLocked(item.value));
          if (model && model.value !== normalizedValue) onSelectModel(model.value);
        }}
      >
        <DropdownMenuSeparator className="bg-border/50" />
        <DropdownMenuLabel className="text-ui-sm text-foreground-subtle">
          {options.modelsLabel}
        </DropdownMenuLabel>
        {group ? renderConnection(group) : null}
        <ScrollFadeViewport
          className="max-h-60 flex-initial"
          inert={options.providerMenu?.pending || undefined}
          data-composer-model-list
        >
          {group ? renderItems(group.items) : null}
        </ScrollFadeViewport>
        {showEffort ? (
          <>
            <DropdownMenuSeparator className="bg-border/50" />
            {options.levels.length === 1 ? (
              // 单一档位没有可调范围；旧逻辑渲染禁用滑杆并提示快捷键，误导用户可调档。
              <div className="px-2 py-2">
                <ComposerEffortHeading
                  label={options.effortLabel}
                  value={currentGroupSelected ? label : "—"}
                />
              </div>
            ) : (
              <DropdownMenuItem
                className="block px-2 py-2 focus:bg-transparent"
                aria-disabled={sliderDisabled}
                onSelect={(event) => event.preventDefault()}
              >
                {codexEnabled ? (
                  <CodexEffortSlider
                    heading={
                      <ComposerEffortHeading
                        label={options.effortLabel}
                        value={currentGroupSelected ? label : "—"}
                        shortcut={options.effortShortcutLabel}
                        ultra={codexUltra}
                      />
                    }
                    levelCount={options.levels.length}
                    value={Math.max(0, currentIndex)}
                    ultra={codexUltra}
                    fast={codexFast}
                    showFastBolt={codexSettings.showFastBolt}
                    showNoEffectNote={codexSettings.showNoEffectNote}
                    disabled={sliderDisabled}
                    fastLabel={intl.formatMessage({ id: "settings.appearance.codexEffort.fast" })}
                    fastHint={intl.formatMessage({
                      id: "settings.appearance.codexEffort.fastHint",
                    })}
                    noEffectNote={intl.formatMessage({
                      id: "settings.appearance.codexEffort.noEffectInline",
                    })}
                    ultraWarning={intl.formatMessage({
                      id: "settings.appearance.codexEffort.ultraWarning",
                    })}
                    onValueChange={selectSliderValue}
                    onFastChange={(next) => setCodexEffortSliderSettings({ fastActive: next })}
                  />
                ) : (
                  <>
                    <ComposerEffortHeading
                      label={options.effortLabel}
                      value={currentGroupSelected ? label : "—"}
                      shortcut={options.effortShortcutLabel}
                    />
                    <div
                      className="composer-thought-slider relative h-8 w-full rounded-full"
                      data-disabled={sliderDisabled}
                    >
                      <div
                        // 模型或档位目录变化时只重置视觉层，避免跨模型补间，同时保留 input 焦点。
                        key={JSON.stringify([
                          normalizedValue,
                          group?.key,
                          options.levels.map((level) => level.value),
                        ])}
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0"
                      >
                        <div
                          data-testid="composer-thought-track"
                          data-progress={sliderFilled ? sliderProgress : 0}
                          className="absolute inset-x-0 top-1 h-6 overflow-hidden rounded-full bg-foreground/10"
                        >
                          {/* 外层 border 会包住绿色填充；描边放到底层，让选中区域完全覆盖它。 */}
                          <div className="absolute inset-0 rounded-full border border-foreground/10" />
                          <div
                            className="composer-thought-slider-fill absolute inset-y-0 left-0 overflow-hidden rounded-full"
                            data-max={sliderFilled && currentIndex === options.levels.length - 1}
                            data-highspeed={highspeed && currentGroupSelected}
                            style={{
                              width: sliderFilled
                                ? `calc(14px + (100% - 28px) * ${sliderProgress / 100})`
                                : 0,
                            }}
                          >
                            {sliderFilled &&
                            currentIndex === options.levels.length - 1 &&
                            !sliderDisabled ? (
                              <div
                                data-testid="composer-thought-bubbles"
                                className="composer-thought-bubbles absolute inset-0"
                              >
                                {(highspeed ? HIGHSPEED_BUBBLES : EFFORT_BUBBLES).map(
                                  (bubble, index) => (
                                    <span
                                      key={index}
                                      className="composer-thought-bubble absolute inset-x-0"
                                      style={{
                                        top: bubble.top,
                                        animationDuration: `${bubble.duration}s`,
                                        animationDelay: `${bubble.delay}s`,
                                      }}
                                    >
                                      <span
                                        className="block rounded-full bg-white"
                                        style={{ width: bubble.size, height: bubble.size }}
                                      />
                                    </span>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="absolute inset-x-3.5 inset-y-0 flex items-center justify-between">
                          {options.levels.map((level, index) => (
                            <span
                              key={level.value}
                              data-composer-thought-stop
                              data-filled={sliderFilled && index <= currentIndex}
                              data-hovered={
                                !sliderDisabled &&
                                hoveredStop === `${normalizedValue}:${level.value}`
                              }
                              className="composer-thought-slider-stop size-1 shrink-0 rounded-full"
                            />
                          ))}
                        </div>
                        <div
                          className="composer-thought-slider-thumb absolute top-0.5 size-7 rounded-full shadow-sm"
                          style={{ left: `calc((100% - 28px) * ${sliderProgress / 100})` }}
                        />
                      </div>
                      <input
                        ref={sliderRef}
                        type="range"
                        min={0}
                        max={Math.max(0, options.levels.length - 1)}
                        step={1}
                        value={Math.max(0, currentIndex)}
                        // 目录在调档后会短暂重读；原生 disabled 会移走焦点，后续方向键落到菜单。
                        // 用 aria-disabled 保留焦点，等待期间通过事件与提交入口阻止交互。
                        aria-disabled={sliderDisabled}
                        aria-label={options.effortLabel}
                        aria-valuetext={currentGroupSelected ? label : "—"}
                        data-testid="composer-thought-slider"
                        data-levels={JSON.stringify(options.levels.map((level) => level.value))}
                        className="composer-thought-range absolute inset-0 m-0 h-8 w-full cursor-pointer appearance-none bg-transparent outline-none aria-disabled:cursor-default"
                        onPointerDown={(event) => {
                          // 拦截冒泡会让 Radix 的内部点击标记残留，导致第一次外部点击无法关闭菜单。
                          if (sliderDisabled) event.preventDefault();
                        }}
                        onPointerLeave={() => setHoveredStop(null)}
                        onPointerMove={(event) => {
                          // 原生 range 覆盖圆点，用坐标反馈悬停，避免圆点截获拖拽事件。
                          const rect = event.currentTarget.getBoundingClientRect();
                          const trackWidth = rect.width - 28;
                          const index = Math.round(
                            ((event.clientX - rect.left - 14) / trackWidth) *
                              (options.levels.length - 1),
                          );
                          const level = options.levels[index];
                          const center =
                            rect.left + 14 + (trackWidth * index) / (options.levels.length - 1);
                          setHoveredStop(
                            !sliderDisabled &&
                              event.pointerType !== "touch" &&
                              level &&
                              Math.abs(event.clientX - center) <= 10
                              ? `${normalizedValue}:${level.value}`
                              : null,
                          );
                        }}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key !== "Escape") {
                            event.stopPropagation();
                            if (sliderDisabled && event.key !== "Tab") event.preventDefault();
                          }
                        }}
                        // 原因：缺失档位时 range 的物理位置仍为 0；Home 或点击首格不触发 change，
                        // 必须在明确完成手势时接纳首格选择，不能把展示位置提前当成用户意图。
                        onKeyUp={(event) => {
                          if (
                            [
                              "Home",
                              "End",
                              "ArrowLeft",
                              "ArrowRight",
                              "ArrowUp",
                              "ArrowDown",
                              "PageUp",
                              "PageDown",
                            ].includes(event.key)
                          )
                            selectSliderValue(Number(event.currentTarget.value));
                        }}
                        onPointerUp={(event) => {
                          selectSliderValue(Number(event.currentTarget.value));
                        }}
                        onChange={(event) => selectSliderValue(Number(event.currentTarget.value))}
                      />
                    </div>
                  </>
                )}
              </DropdownMenuItem>
            )}
          </>
        ) : null}
      </ComposerProviderMenu>
    </>
  );
}
