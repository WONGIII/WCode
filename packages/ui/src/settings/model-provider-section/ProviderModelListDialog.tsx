import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { ZCodeProviderListModelsResult } from "@zcode/shared";
import { Button } from "@/components/ui/button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";

type FetchedModel = ZCodeProviderListModelsResult["models"][number];

export interface ProviderModelListDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 触发拉取并返回模型列表；失败时抛出错误由本组件展示。 */
  fetchModels: () => Promise<ZCodeProviderListModelsResult>;
  /** 用户确认后把选中的模型 ID 交给上层批量添加。 */
  onConfirm: (modelIds: readonly string[]) => void | Promise<void>;
}

/**
 * 「获取模型列表」弹窗。
 *
 * 打开即请求供应商模型列表；已存在的模型显示为已勾选且不可取消，
 * 避免用户重复添加或误以为可以移除已有配置。
 */
export function ProviderModelListDialog({
  open,
  onOpenChange,
  fetchModels,
  onConfirm,
}: ProviderModelListDialogProps) {
  const { intl } = useZCodeIntl();
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; models: readonly FetchedModel[] }
  >({ status: "loading" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setFilter("");
    try {
      const result = await fetchModels();
      setState({ status: "ready", models: result.models });
      // 默认只勾选尚未添加的项；已添加项本身不可交互。
      setSelected(new Set());
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [fetchModels]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();
  }, [open, load]);

  const visibleModels = useMemo(() => {
    if (state.status !== "ready") {
      return [];
    }
    const keyword = filter.trim().toLocaleLowerCase();
    if (!keyword) {
      return state.models;
    }
    return state.models.filter((model) => {
      const haystack = `${model.id} ${model.name ?? ""}`.toLocaleLowerCase();
      return haystack.includes(keyword);
    });
  }, [state, filter]);

  const selectedCount = selected.size;

  const toggle = (model: FetchedModel) => {
    if (model.alreadyAdded) {
      return;
    }
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(model.id)) {
        next.delete(model.id);
      } else {
        next.add(model.id);
      }
      return next;
    });
  };

  const handleConfirm = async () => {
    if (selectedCount === 0) {
      return;
    }
    setSubmitting(true);
    try {
      await onConfirm([...selected]);
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {intl.formatMessage({ id: "settings.modelProvider.modelList.title" })}
          </DialogTitle>
          <DialogDescription>
            {intl.formatMessage({ id: "settings.modelProvider.modelList.description" })}
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="flex items-center gap-2 py-8 text-ui-base text-foreground-subtle">
            <Loader2Icon className="size-4 animate-spin" />
            {intl.formatMessage({ id: "settings.modelProvider.modelList.loading" })}
          </div>
        ) : state.status === "error" ? (
          <div className="space-y-3 py-4">
            <p className="text-ui-base text-destructive" role="alert">
              {state.message}
            </p>
            <Button onClick={() => void load()} size="sm" type="button" variant="outline">
              {intl.formatMessage({ id: "common.retry" })}
            </Button>
          </div>
        ) : state.models.length === 0 ? (
          <p className="py-8 text-ui-base text-foreground-subtle">
            {intl.formatMessage({ id: "settings.modelProvider.modelList.empty" })}
          </p>
        ) : (
          <div className="space-y-3">
            <Input
              onChange={(event) => setFilter(event.target.value)}
              placeholder={intl.formatMessage({
                id: "settings.modelProvider.modelList.filterPlaceholder",
              })}
              type="text"
              value={filter}
            />
            <div className="max-h-80 space-y-1 overflow-y-auto rounded-lg border border-border p-1">
              {visibleModels.map((model) => {
                const checked = model.alreadyAdded || selected.has(model.id);
                return (
                  <label
                    className={
                      model.alreadyAdded
                        ? "flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-ui-base opacity-60"
                        : "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ui-base hover:bg-surface"
                    }
                    key={model.id}
                  >
                    <input
                      checked={checked}
                      className="size-4"
                      // 已有模型锁定为已勾选，禁止交互（用户不能在此处取消已有配置）。
                      disabled={model.alreadyAdded}
                      onChange={() => toggle(model)}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono">{model.id}</span>
                    {model.name && model.name !== model.id ? (
                      <span className="shrink-0 truncate text-ui-sm text-foreground-subtle">
                        {model.name}
                      </span>
                    ) : null}
                    {model.alreadyAdded ? (
                      <span className="shrink-0 text-ui-sm text-foreground-subtlest">
                        {intl.formatMessage({
                          id: "settings.modelProvider.modelList.alreadyAdded",
                        })}
                      </span>
                    ) : null}
                  </label>
                );
              })}
            </div>
            <p className="text-ui-sm text-foreground-subtle">
              {intl.formatMessage(
                { id: "settings.modelProvider.modelList.selectedCount" },
                { count: selectedCount },
              )}
            </p>
          </div>
        )}

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
            {intl.formatMessage({ id: "common.cancel" })}
          </Button>
          <Button
            disabled={selectedCount === 0 || submitting || state.status !== "ready"}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {submitting ? <Loader2Icon className="mr-1.5 size-3.5 animate-spin" /> : null}
            {intl.formatMessage(
              { id: "settings.modelProvider.modelList.confirm" },
              { count: selectedCount },
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
