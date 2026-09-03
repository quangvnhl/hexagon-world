// Gom lô và gửi sự kiện phân tích (doc 35 §A1, lát a1.2).
//
// Hợp đồng sự kiện nằm ở `@hexagon/shared` (tên + chặn PII); file này chỉ lo ĐƯỜNG VẬN CHUYỂN:
// gom lô, gửi, và không mất sự kiện khi mạng chập chờn hoặc người chơi đóng app.
//
// Ba ràng buộc định hình thiết kế:
//  1. **Không bao giờ làm hỏng game.** Mọi lỗi (mạng, storage bị chặn ở chế độ riêng tư, JSON hỏng)
//     đều bị nuốt. Mất một sự kiện là chuyện nhỏ; ném lỗi giữa vòng lặp game là chuyện lớn.
//  2. **Đóng app là lúc mất dữ liệu nhiều nhất** — Mini App bị đóng đột ngột rất thường xuyên. Nên
//     phải có đường gửi đồng bộ bằng `sendBeacon` lúc `pagehide`/`visibilitychange`.
//  3. **Kiểm thử được.** Mọi phụ thuộc vào trình duyệt (fetch, localStorage, beacon, đồng hồ) đều
//     tiêm vào được, nên logic gom lô/đệm/thử lại test được trong môi trường node.

import {
  makeEvent,
  type AnalyticsContext,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type AnalyticsPlatform,
} from "@hexagon/shared";
import { API_URL } from "./backend";
import { getTelegramWebApp, hasTelegramMiniAppInitData } from "./telegram";

/** Khoá lưu trữ cục bộ. */
export const ANON_ID_KEY = "hexagon.anon-id";
export const BUFFER_KEY = "hexagon.analytics.buffer";

/** Số sự kiện tối đa mỗi lô gửi lên. */
export const DEFAULT_BATCH_SIZE = 20;
/** Nhịp gửi định kỳ (ms). */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000;
/** Trần số sự kiện giữ lại khi gửi hỏng — vượt thì BỎ CÁI CŨ NHẤT. */
export const DEFAULT_MAX_BUFFERED = 200;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface AnalyticsDeps {
  /** Đồng hồ — tiêm vào để test tất định. */
  now: () => number;
  /** Nơi đệm khi gửi hỏng. `null` = không đệm (SSR hoặc storage bị chặn). */
  storage: StorageLike | null;
  /** Gửi bất đồng bộ. Trả `true` khi server đã nhận. */
  send: (url: string, body: string) => Promise<boolean>;
  /** Gửi đồng bộ lúc rời trang. `null` = không có beacon. */
  sendBeacon: ((url: string, body: string) => boolean) | null;
  endpoint: string;
  batchSize: number;
  maxBuffered: number;
}

export interface AnalyticsClient {
  /** Ghi nhận một sự kiện. KHÔNG bao giờ ném lỗi. */
  track: (name: AnalyticsEventName, props?: Record<string, unknown>) => void;
  /** Gửi hết hàng đợi. Hỏng ⇒ đệm lại để lần sau thử tiếp. */
  flush: () => Promise<void>;
  /** Gửi đồng bộ lúc rời trang (beacon). Không có beacon ⇒ đệm lại. */
  flushOnExit: () => void;
  /** Số sự kiện đang chờ gửi (phục vụ test/gỡ lỗi). */
  pending: () => number;
}

// ---- Bối cảnh -------------------------------------------------------------------------------

/**
 * Nền tảng của sự kiện. Theo `AGENTS.md` §3 và doc 15: **chỉ** kết luận Telegram khi
 * `window.Telegram.WebApp` tồn tại VÀ `initData` có dữ liệu Mini App thật — không suy từ URL,
 * user-agent hay cờ do client tự đặt. Đây là NHÃN gợi ý cho phân tích; nguồn sự thật về platform
 * của một tài khoản vẫn là session do server xác định.
 */
export function resolvePlatform(): AnalyticsPlatform {
  return hasTelegramMiniAppInitData(getTelegramWebApp()?.initData) ? "telegram" : "web";
}

/** Id thiết bị ẩn danh, bền qua nhiều phiên. KHÔNG phải player_id, không suy ra được người thật. */
export function resolveAnonId(storage: StorageLike | null): string {
  const fresh = () => `a-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  if (!storage) return fresh();
  try {
    const saved = storage.getItem(ANON_ID_KEY);
    if (saved) return saved;
    const created = fresh();
    storage.setItem(ANON_ID_KEY, created);
    return created;
  } catch {
    // Chế độ riêng tư / storage bị chặn ⇒ dùng id tạm cho phiên này.
    return fresh();
  }
}

/** Bối cảnh mặc định trong trình duyệt. */
export function browserContext(storage: StorageLike | null): AnalyticsContext {
  return {
    sessionId: `s-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    anonId: resolveAnonId(storage),
    platform: resolvePlatform(),
    buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
  };
}

// ---- Client ---------------------------------------------------------------------------------

function defaultSend(url: string, body: string): Promise<boolean> {
  return fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  })
    .then((r) => r.ok)
    .catch(() => false);
}

/**
 * Tạo một client gom lô. Không tự chạy timer — phần gắn vào vòng đời trình duyệt nằm ở
 * `startBrowserAnalytics` để logic ở đây test được thuần tuý.
 */
export function createAnalytics(ctx: AnalyticsContext, overrides: Partial<AnalyticsDeps> = {}): AnalyticsClient {
  const deps: AnalyticsDeps = {
    now: Date.now,
    storage: null,
    send: defaultSend,
    sendBeacon: null,
    endpoint: `${API_URL}/v1/events`,
    batchSize: DEFAULT_BATCH_SIZE,
    maxBuffered: DEFAULT_MAX_BUFFERED,
    ...overrides,
  };

  // Nạp lại phần còn nợ từ phiên trước (đóng app giữa chừng, mạng hỏng…).
  const queue: AnalyticsEvent[] = readBuffer(deps);
  clearBuffer(deps);

  function readBuffer(d: AnalyticsDeps): AnalyticsEvent[] {
    if (!d.storage) return [];
    try {
      const raw = d.storage.getItem(BUFFER_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
    } catch {
      return []; // JSON hỏng ⇒ bỏ, không để một bản ghi lỗi chặn mãi mãi
    }
  }

  function clearBuffer(d: AnalyticsDeps): void {
    try { d.storage?.removeItem(BUFFER_KEY); } catch { /* bỏ qua */ }
  }

  /** Đệm lại phần chưa gửi được; vượt trần thì BỎ CÁI CŨ NHẤT (sự kiện mới có giá trị hơn). */
  function writeBuffer(events: AnalyticsEvent[]): void {
    if (!deps.storage || events.length === 0) return;
    try {
      const kept = events.length > deps.maxBuffered ? events.slice(events.length - deps.maxBuffered) : events;
      deps.storage.setItem(BUFFER_KEY, JSON.stringify(kept));
    } catch { /* hết quota / bị chặn ⇒ đành mất, không được ném */ }
  }

  function payload(events: AnalyticsEvent[]): string {
    return JSON.stringify({ events });
  }

  function track(name: AnalyticsEventName, props?: Record<string, unknown>): void {
    try {
      queue.push(makeEvent(name, props, ctx, deps.now()));
      if (queue.length >= deps.batchSize) void flush();
    } catch { /* không bao giờ làm hỏng luồng gọi */ }
  }

  async function flush(): Promise<void> {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    try {
      const ok = await deps.send(deps.endpoint, payload(batch));
      if (!ok) writeBuffer(batch);
    } catch {
      writeBuffer(batch);
    }
  }

  function flushOnExit(): void {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    try {
      const ok = deps.sendBeacon?.(deps.endpoint, payload(batch)) ?? false;
      if (!ok) writeBuffer(batch);
    } catch {
      writeBuffer(batch);
    }
  }

  return { track, flush, flushOnExit, pending: () => queue.length };
}

// ---- Gắn vào vòng đời trình duyệt -------------------------------------------------------------

let singleton: AnalyticsClient | null = null;

/**
 * Khởi động client dùng chung + gắn vào vòng đời trang. An toàn khi gọi nhiều lần và khi render
 * phía server (không có `window` thì không làm gì).
 *
 * Dùng `pagehide` + `visibilitychange` chứ không dùng `beforeunload`: trên iOS/WebView (đúng môi
 * trường Telegram Mini App) `beforeunload` thường KHÔNG bắn.
 */
export function startBrowserAnalytics(intervalMs: number = DEFAULT_FLUSH_INTERVAL_MS): AnalyticsClient | null {
  if (typeof window === "undefined") return null;
  if (singleton) return singleton;

  const startedAt = Date.now();
  let storage: StorageLike | null = null;
  try { storage = window.localStorage; } catch { storage = null; }

  const client = createAnalytics(browserContext(storage), {
    storage,
    sendBeacon:
      typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
        ? (url, body) => navigator.sendBeacon(url, new Blob([body], { type: "application/json" }))
        : null,
  });

  // `session_end` phải được ĐẨY VÀO HÀNG ĐỢI TRƯỚC khi xả, nếu không nó sẽ nằm lại tới lần xả
  // sau — mà thường không có lần sau. Đó là lý do nó nằm ở đây chứ không ở một listener riêng:
  // listener đăng ký sau sẽ chạy sau `flushOnExit()` và sự kiện mất trắng.
  let ended = false;
  const endSession = () => {
    if (!ended) {
      ended = true;
      client.track("session_end", { duration_sec: Math.round((Date.now() - startedAt) / 1000) });
    }
    client.flushOnExit();
  };

  window.setInterval(() => void client.flush(), intervalMs);
  window.addEventListener("pagehide", endSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") endSession();
  });

  singleton = client;
  return client;
}

/**
 * Ghi nhận sự kiện qua client dùng chung.
 *
 * TỰ khởi động nếu chưa: nếu không, mọi `track()` gọi trước `startBrowserAnalytics()` sẽ biến mất
 * im lặng — đúng loại lỗi không ai phát hiện ra cho tới lúc mở bảng số liệu và thấy trống. Ở SSR
 * (`window` không tồn tại) vẫn là no-op như cũ.
 */
export function track(name: AnalyticsEventName, props?: Record<string, unknown>): void {
  (singleton ?? startBrowserAnalytics())?.track(name, props);
}

/** Chỉ dùng cho test: xoá singleton. */
export function resetBrowserAnalyticsForTest(): void {
  singleton = null;
}
