import { useCallback, useSyncExternalStore } from "react";

/**
 * 自定义用户显示信息。
 *
 * 断网 / 未登录时侧栏只能显示「连接使用」，用户无法区分本机上的多个工作环境。
 * 这里允许本地覆盖头像与名字，只存本机，不上报服务端。
 *
 * 存储分两处：
 * - 显示名：localStorage（很小，且需要跨窗口 storage 事件同步）
 * - 头像：IndexedDB 存 Blob。localStorage 只有约 5MB 配额，
 *   且 data URL 相比原图会膨胀约 1/3，稍大的图会直接写入失败。
 *   IndexedDB 配额随磁盘空间走，20MB 头像没有压力。
 */
export interface CustomUserProfile {
  /** 自定义显示名；空串表示未设置。 */
  displayName: string;
  /** 头像的对象 URL（由 IndexedDB 中的 Blob 生成）；空串表示未设置。 */
  avatarUrl: string;
}

/** 头像单文件上限：20MB。 */
export const MAX_AVATAR_BYTES = 20 * 1024 * 1024;

const STORAGE_KEY = "zcode-custom-user-profile";
const DB_NAME = "zcode-custom-user";
const DB_VERSION = 1;
const STORE_NAME = "avatar";
const AVATAR_KEY = "avatar";
const EMPTY_PROFILE: CustomUserProfile = { displayName: "", avatarUrl: "" };

interface StoredName {
  displayName: string;
}

function readDisplayName(): string {
  if (typeof localStorage === "undefined") {
    return "";
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return "";
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return "";
    }
    const value = (parsed as StoredName).displayName;
    return typeof value === "string" ? value : "";
  } catch {
    // 存储被清理或内容损坏时回退默认，避免设置页因解析失败白屏。
    return "";
  }
}

function writeDisplayName(displayName: string): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    if (displayName.trim()) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ displayName }));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // 隐私模式或配额不足时仍更新内存态，让本次会话内设置可见。
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
  return dbPromise;
}

async function readAvatarBlob(): Promise<Blob | null> {
  try {
    const db = await openDatabase();
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(AVATAR_KEY);
      request.onsuccess = () => {
        const value: unknown = request.result;
        resolve(value instanceof Blob ? value : null);
      };
      request.onerror = () => reject(request.error ?? new Error("avatar read failed"));
    });
  } catch {
    // IndexedDB 不可用或读取失败时按「未设置头像」处理。
    return null;
  }
}

async function writeAvatarBlob(blob: Blob | null): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    if (blob) {
      store.put(blob, AVATAR_KEY);
    } else {
      store.delete(AVATAR_KEY);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("avatar write failed"));
  });
}

let snapshot: CustomUserProfile = EMPTY_PROFILE;
/** 当前头像的 object URL；换图或重置时必须 revoke，否则 Blob 一直占内存。 */
let currentObjectUrl: string | null = null;
let avatarLoaded = false;
const listeners = new Set<() => void>();

function emit(next: CustomUserProfile): void {
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function setAvatarObjectUrl(blob: Blob | null): void {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  if (blob) {
    currentObjectUrl = URL.createObjectURL(blob);
  }
  emit({ ...snapshot, avatarUrl: currentObjectUrl ?? "" });
}

function getSnapshot(): CustomUserProfile {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 首次读取：显示名同步就绪，头像异步补齐。 */
function bootstrap(): void {
  snapshot = { displayName: readDisplayName(), avatarUrl: "" };
  void readAvatarBlob().then((blob) => {
    avatarLoaded = true;
    if (blob) {
      setAvatarObjectUrl(blob);
    } else {
      emit({ ...snapshot, avatarUrl: "" });
    }
  });
}

if (typeof window !== "undefined") {
  bootstrap();
  // 显示名跨窗口同步；头像体积大且不常改，不额外走 storage 事件。
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) {
      return;
    }
    emit({ ...snapshot, displayName: readDisplayName() });
  });
}

export function useCustomUserProfile() {
  const profile = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setDisplayName = useCallback((displayName: string) => {
    writeDisplayName(displayName);
    emit({ ...snapshot, displayName });
  }, []);

  /**
   * 写入头像文件。
   *
   * 只接受图片且不超过 20MB；写入 IndexedDB 后把 Blob 转成 object URL 供展示。
   * 失败时抛错，由调用方展示具体原因（不是静默忽略）。
   */
  const setAvatarFile = useCallback(async (file: File): Promise<void> => {
    if (!file.type.startsWith("image/")) {
      throw new Error("avatar-not-image");
    }
    if (file.size > MAX_AVATAR_BYTES) {
      throw new Error("avatar-too-large");
    }
    await writeAvatarBlob(file);
    setAvatarObjectUrl(file);
  }, []);

  const clearAvatar = useCallback(async (): Promise<void> => {
    await writeAvatarBlob(null);
    setAvatarObjectUrl(null);
  }, []);

  const reset = useCallback(async (): Promise<void> => {
    writeDisplayName("");
    // 头像删除失败也要让界面回到默认，避免用户看到「点了没反应」。
    try {
      await writeAvatarBlob(null);
    } catch {
      // ignore
    }
    setAvatarObjectUrl(null);
    emit({ ...EMPTY_PROFILE, avatarUrl: "" });
  }, []);

  const hasCustomization =
    profile.displayName.trim().length > 0 || profile.avatarUrl.trim().length > 0;

  return {
    profile,
    hasCustomization,
    avatarReady: avatarLoaded,
    setDisplayName,
    setAvatarFile,
    clearAvatar,
    reset,
  };
}

/** 非 hook 场景读取当前值（如侧栏渲染前的判断）。 */
export function readCustomUserProfile(): CustomUserProfile {
  return snapshot;
}
