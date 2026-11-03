import { useId, useRef, useState } from "react";
import { Loader2, RotateCcw, User } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import {
  MAX_AVATAR_BYTES,
  useCustomUserProfile,
} from "@/lib/customUserProfile.js";
import { SettingsGroupCard } from "@/settings/SettingsPageParts.js";

/**
 * 「自定义用户」设置分区。
 *
 * 目的：用 API Key 连接时没有账号资料，侧栏只能显示「连接使用」，
 * 无法区分本机多个工作环境。这里允许本机自定义头像与名字，
 * 头像存 IndexedDB（不是 localStorage），所以可以放较大的图。
 */
export function CustomUserSection() {
  const { intl } = useZCodeIntl();
  const {
    profile,
    hasCustomization,
    setDisplayName,
    setAvatarFile,
    clearAvatar,
    reset,
  } = useCustomUserProfile();
  const displayNameInputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const fallbackText = profile.displayName.trim().charAt(0).toUpperCase() || null;
  const maxSizeLabel = `${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))} MB`;

  const handleAvatarPick = async (file: File | undefined) => {
    if (!file) {
      return;
    }
    setAvatarBusy(true);
    try {
      await setAvatarFile(file);
      setAvatarError(null);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setAvatarError(
        code === "avatar-not-image"
          ? intl.formatMessage({ id: "settings.customUser.avatarNotImage" })
          : code === "avatar-too-large"
            ? intl.formatMessage(
                { id: "settings.customUser.avatarTooLarge" },
                { size: maxSizeLabel },
              )
            : intl.formatMessage({ id: "settings.customUser.avatarReadFailed" }),
      );
    } finally {
      setAvatarBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.customUser.description" })}
      </p>
      <SettingsGroupCard>
        <div className="space-y-6 p-4">
          <div className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.customUser.title" })}
          </div>
          <div className="flex items-center gap-4">
            <Avatar size="lg">
              {profile.avatarUrl ? (
                <AvatarImage
                  alt={intl.formatMessage({ id: "settings.customUser.title" })}
                  src={profile.avatarUrl}
                />
              ) : null}
              <AvatarFallback className="bg-surface text-foreground">
                {fallbackText ?? <User className="size-5" />}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={avatarBusy}
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {avatarBusy ? (
                  <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                ) : null}
                {intl.formatMessage({ id: "settings.customUser.chooseAvatar" })}
              </Button>
              {profile.avatarUrl ? (
                <Button
                  onClick={() => {
                    void clearAvatar().catch(() => undefined);
                    setAvatarError(null);
                  }}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {intl.formatMessage({ id: "settings.customUser.removeAvatar" })}
                </Button>
              ) : null}
              <input
                accept="image/*"
                className="hidden"
                data-testid="custom-user-avatar-input"
                onChange={(event) => {
                  void handleAvatarPick(event.target.files?.[0]);
                  // 允许连续选择同一个文件时仍然触发 change。
                  event.target.value = "";
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
          </div>
          <p className="text-ui-sm text-foreground-subtlest">
            {intl.formatMessage(
              { id: "settings.customUser.avatarHint" },
              { size: maxSizeLabel },
            )}
          </p>
          {avatarError ? (
            <p className="text-ui-sm text-destructive" role="alert">
              {avatarError}
            </p>
          ) : null}

          <div>
            <label
              className="mb-1 block text-ui-base text-foreground-subtle"
              htmlFor={displayNameInputId}
            >
              {intl.formatMessage({ id: "settings.customUser.displayName" })}
            </label>
            <Input
              data-testid="custom-user-display-name"
              id={displayNameInputId}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder={intl.formatMessage({
                id: "settings.customUser.displayNamePlaceholder",
              })}
              size="lg"
              type="text"
              value={profile.displayName}
            />
            <p className="mt-1 text-ui-sm text-foreground-subtlest">
              {intl.formatMessage({ id: "settings.customUser.displayNameHint" })}
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <p className="min-w-0 text-ui-sm text-foreground-subtle">
              {intl.formatMessage({ id: "settings.customUser.resetHint" })}
            </p>
            <Button
              data-testid="custom-user-reset"
              disabled={!hasCustomization}
              onClick={() => {
                void reset().catch(() => undefined);
                setAvatarError(null);
              }}
              size="sm"
              type="button"
              variant="outline"
            >
              <RotateCcw className="mr-1.5 size-3.5" />
              {intl.formatMessage({ id: "settings.customUser.reset" })}
            </Button>
          </div>
        </div>
      </SettingsGroupCard>
    </div>
  );
}
