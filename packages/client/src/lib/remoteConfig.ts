// Client đọc remote config (doc 35 §A2, lát a2.2).
//
// Luật giải quyết cấu hình nằm ở `@hexagon/shared` — file này chỉ lo VẬN CHUYỂN và BỘ NHỚ ĐỆM.
//
// Ba tình huống quyết định thiết kế, tất cả đều là "mạng không như ý":
//
//  1. **Lần đầu mở app, không có mạng.** Chưa từng tải được cấu hình nào ⇒ dùng hằng số mặc định
//     trong shared. Game phải chơi được. Đây là lý do `get()` luôn ĐỒNG BỘ và luôn trả về đủ khoá.
//  2. **Mở lại app, không có mạng.** Bản tải lần trước nằm trong `localStorage` ⇒ dùng lại, tốt
//     hơn mặc định vì nó phản ánh những gì đội vận hành đã chỉnh.
//  3. **Có mạng nhưng cấu hình không đổi.** Gửi `If-None-Match` ⇒ server trả 304, không tốn băng
//     thông và không tốn parse. Đây là lý do phải lưu cả `etag` chứ không chỉ giá trị.
//
// Và một luật xuyên suốt: hàm ở đây KHÔNG BAO GIỜ được ném lỗi ra ngoài. Cấu hình hỏng thì trò chơi
// vẫn phải chạy; biến nó thành nguồn lỗi mới là đánh mất chính lý do nó tồn tại.

import {
  REMOTE_CONFIG_DEFAULTS,
  resolveRemoteConfig,
  type ConfigPlatform,
  type RemoteConfigBundle,
  type RemoteConfigKey,
  type RemoteConfigValue,
} from "@hexagon/shared";
import { API_URL } from "./backend";
import { getTelegramWebApp, hasTelegramMiniAppInitData } from "./telegram";

/** Khoá localStorage. Đổi hậu tố khi đổi dạng lưu để bản cũ không được đọc nhầm. */
export const CONFIG_CACHE_KEY = "hexagon.remote-config.v1";
/** Bản đã tải sống 5 phút (doc 35 §A2) trước khi hỏi lại. */
export const CONFIG_TTL_MS = 5 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface CachedConfig {
  config: RemoteConfigBundle;
  etag: string | null;
  at: number;
}

export interface RemoteConfigDeps {
  now: () => number;
  storage: StorageLike | null;
  /** Trả về `null` khi 304 (giữ nguyên bản đang có) hoặc khi hỏng. */
  fetchConfig: (etag: string | null) => Promise<{ config: unknown; etag: string | null } | null>;
  platform: ConfigPlatform;
  buildId: string;
  anonId: string;
}

export interface RemoteConfigClient {
  /** Luôn ĐỒNG BỘ và luôn đủ khoá. Chưa tải được gì thì trả mặc định. */
  get: <K extends RemoteConfigKey>(key: K) => RemoteConfigValue;
  all: () => RemoteConfigBundle;
  /** Tải lại nếu đã quá hạn. `force` bỏ qua hạn. An toàn khi gọi song song. */
  refresh: (force?: boolean) => Promise<void>;
  /** Chỉ dùng cho test/chẩn đoán. */
  state: () => { etag: string | null; at: number; loaded: boolean };
}

/** Đọc bản đệm. Hỏng/thiếu khoá ⇒ coi như chưa có, KHÔNG ném. */
function readCache(deps: RemoteConfigDeps): CachedConfig | null {
  if (!deps.storage) return null;
  try {
    const raw = deps.storage.getItem(CONFIG_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedConfig>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.config !== "object" || parsed.config === null) return null;
    // Chạy lại qua luật của shared: bản đệm có thể là từ phiên bản app CŨ, thiếu khoá mới thêm
    // hoặc chứa khoá đã bỏ. Ép nó về đúng hình dạng hiện tại thay vì tin nguyên trạng.
    const rows = Object.entries(parsed.config as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    return {
      config: resolveRemoteConfig(rows, { platform: deps.platform, buildId: deps.buildId, unitId: deps.anonId }),
      etag: typeof parsed.etag === "string" ? parsed.etag : null,
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    return null;
  }
}

function writeCache(deps: RemoteConfigDeps, value: CachedConfig): void {
  try {
    deps.storage?.setItem(CONFIG_CACHE_KEY, JSON.stringify(value));
  } catch {
    /* hết quota / chế độ riêng tư ⇒ chấp nhận mất đệm, không được ném */
  }
}

/** `fetch` mặc định. Mọi lỗi mạng đều thành `null` — nơi gọi chỉ cần biết "không có gì mới". */
function defaultFetchConfig(platform: ConfigPlatform, buildId: string, anonId: string) {
  return async (etag: string | null): Promise<{ config: unknown; etag: string | null } | null> => {
    const url = `${API_URL}/v1/config?platform=${encodeURIComponent(platform)}&build=${encodeURIComponent(buildId)}&anonId=${encodeURIComponent(anonId)}`;
    try {
      const res = await fetch(url, {
        credentials: "include",
        // `cache: "no-cache"` = LUÔN hỏi lại server, nhưng vẫn kèm ETag nên câu trả lời thường là
        // 304 (rẻ). Không có nó thì bộ đệm HTTP của trình duyệt tự trả bản cũ theo
        // `Cache-Control: max-age=300` của server và request này không bao giờ tới nơi — kill-switch
        // trễ tới 5 phút dù ta đã chủ động gọi lại. Đã đo thấy đúng hiện tượng đó khi thiếu dòng này.
        cache: "no-cache",
        headers: etag ? { "if-none-match": etag } : {},
      });
      if (res.status === 304) return null;
      if (!res.ok) return null;
      const body = (await res.json()) as { config?: unknown; etag?: unknown };
      return { config: body.config, etag: typeof body.etag === "string" ? body.etag : res.headers.get("etag") };
    } catch {
      return null;
    }
  };
}

export function createRemoteConfig(overrides: Partial<RemoteConfigDeps> = {}): RemoteConfigClient {
  const platform = overrides.platform ?? "web";
  const buildId = overrides.buildId ?? "dev";
  const anonId = overrides.anonId ?? "anonymous";
  const deps: RemoteConfigDeps = {
    now: Date.now,
    storage: null,
    fetchConfig: defaultFetchConfig(platform, buildId, anonId),
    platform,
    buildId,
    anonId,
    ...overrides,
  };

  const cached = readCache(deps);
  let bundle: RemoteConfigBundle = cached?.config ?? { ...REMOTE_CONFIG_DEFAULTS };
  let etag: string | null = cached?.etag ?? null;
  let fetchedAt = cached?.at ?? 0;
  let loaded = cached !== null;
  // Gộp các lần gọi song song: nhiều màn hình cùng hỏi cấu hình lúc khởi động là chuyện thường.
  let inflight: Promise<void> | null = null;

  async function doRefresh(): Promise<void> {
    const result = await deps.fetchConfig(etag);
    if (result === null) {
      // 304 hoặc mạng hỏng. Với 304 thì bản đang giữ đúng là bản mới nhất nên dời hạn ra;
      // với mạng hỏng thì cũng không có gì tốt hơn để dùng, và dời hạn tránh gọi lại dồn dập.
      fetchedAt = deps.now();
      return;
    }
    const rows = Object.entries((result.config ?? {}) as Record<string, unknown>).map(([key, value]) => ({ key, value }));
    bundle = resolveRemoteConfig(rows, { platform: deps.platform, buildId: deps.buildId, unitId: deps.anonId });
    etag = result.etag;
    fetchedAt = deps.now();
    loaded = true;
    writeCache(deps, { config: bundle, etag, at: fetchedAt });
  }

  return {
    get: (key) => bundle[key],
    all: () => ({ ...bundle }),
    state: () => ({ etag, at: fetchedAt, loaded }),
    refresh: async (force = false) => {
      if (!force && loaded && deps.now() - fetchedAt < CONFIG_TTL_MS) return;
      if (inflight) return inflight;
      inflight = doRefresh().finally(() => { inflight = null; });
      return inflight;
    },
  };
}

// ---- Bản dùng chung cho cả app ------------------------------------------------------------------

let singleton: RemoteConfigClient | null = null;

/** Nền tảng hiện tại — dùng đúng cổng kiểm Telegram của doc 15, không đoán theo user agent. */
function resolvePlatform(): ConfigPlatform {
  return hasTelegramMiniAppInitData(getTelegramWebApp()?.initData) ? "telegram" : "web";
}

/**
 * Client dùng chung. Tạo lần đầu thì đọc ngay bản đệm (đồng bộ) rồi gọi `refresh()` chạy nền —
 * màn hình đầu tiên không phải chờ mạng, và cũng không bao giờ hiển thị bằng giá trị rỗng.
 */
export function remoteConfig(): RemoteConfigClient {
  if (singleton) return singleton;

  let storage: StorageLike | null = null;
  try {
    storage = typeof window === "undefined" ? null : window.localStorage;
  } catch {
    storage = null;
  }

  let anonId = "anonymous";
  try {
    anonId = storage?.getItem("hexagon.anon-id") ?? "anonymous";
  } catch {
    /* bỏ qua */
  }

  singleton = createRemoteConfig({
    storage,
    platform: typeof window === "undefined" ? "web" : resolvePlatform(),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
    anonId,
  });
  void singleton.refresh();
  return singleton;
}

/** Đọc một khoá cấu hình. An toàn ở mọi nơi, kể cả khi render phía server. */
export function configValue<K extends RemoteConfigKey>(key: K): RemoteConfigValue {
  try {
    return remoteConfig().get(key);
  } catch {
    return REMOTE_CONFIG_DEFAULTS[key];
  }
}

/** Đọc một cờ bật/tắt. Khoá không phải boolean ⇒ trả về mặc định của chính nó. */
export function configFlag(key: RemoteConfigKey): boolean {
  const value = configValue(key);
  return typeof value === "boolean" ? value : Boolean(REMOTE_CONFIG_DEFAULTS[key]);
}

/** Chỉ dùng cho test: xoá singleton. */
export function resetRemoteConfigForTest(): void {
  singleton = null;
}
