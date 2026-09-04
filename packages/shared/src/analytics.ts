// Phân tích sự kiện người chơi (doc 35 §A1) — HỢP ĐỒNG dùng chung client ↔ server.
//
// Vì sao đặt ở `shared` chứ không ở client: danh sách TÊN sự kiện phải là MỘT nguồn sự thật.
// Thêm tên mới ⇒ phải sửa union bên dưới ⇒ typecheck bắt lỗi ở mọi nơi dùng sai. Nếu để client
// tự do gửi chuỗi tuỳ ý thì sau 3 tháng bảng sự kiện sẽ có `match_end`, `matchEnd`, `match-end`
// và không truy vấn nổi.
//
// Nguyên tắc:
//  1. KHÔNG PII. Không email, không `initData`, không token, không tên hiển thị. Có `sanitizeProps`
//     chặn ở tầng code chứ không chỉ dặn miệng.
//  2. Mọi sự kiện mang `platform` ngay từ đầu (hiện chỉ có `telegram`) — doc 35 §B8: thêm trục này
//     sau sẽ phải backfill toàn bộ.
//  3. Mọi sự kiện mang `build_id` để quy lỗi/hành vi theo bản phát hành (doc 35 §A8: Mini App không
//     ép cập nhật được, người chơi có thể còn ở bản cũ).
//  4. `event_id` do CLIENT sinh để server khử trùng khi client gửi lại lô (mạng chập chờn).

/** Đổi số này khi ĐỔI Ý NGHĨA của một trường đã có. Thêm sự kiện/trường mới thì KHÔNG cần đổi. */
export const ANALYTICS_SCHEMA_VERSION = 1;

/** Nền tảng phát sinh sự kiện. `web` để dành cho giai đoạn sau (doc 35 §B8). */
export type AnalyticsPlatform = "telegram" | "web";

/**
 * Danh sách TÊN sự kiện — khoá cứng. Bộ tối thiểu phủ đủ funnel của doc 35 §A1:
 * mở app → FTUE → đăng nhập → chọn chế độ → chơi → kinh tế → quảng cáo → mời bạn.
 */
export type AnalyticsEventName =
  // vòng đời phiên
  | "app_open"
  | "session_end"
  // onboarding
  | "ftue_step"
  | "login_success"
  | "login_failed"
  // chơi
  | "mode_select"
  | "match_start"
  | "match_end"
  | "campaign_level_start"
  | "campaign_level_complete"
  | "campaign_level_fail"
  // kinh tế
  | "energy_empty"
  | "energy_purchase"
  | "shop_open"
  | "purchase_start"
  | "purchase_success"
  | "purchase_fail"
  // quảng cáo
  | "ad_request"
  | "ad_impression"
  | "ad_reward"
  | "ad_error"
  // lan truyền
  | "invite_sent"
  | "invite_accepted"
  // CHỈ server phát (doc 35 §A1.4) — lời khai về tiền và tài nguyên. Client gửi ba tên này lên
  // `POST /v1/events` thì bị từ chối: một lời khai của client về việc mình vừa được cộng tiền
  // không phải là dữ liệu, nó là yêu cầu.
  | "purchase_fulfilled"
  | "energy_spend"
  | "energy_grant";

/** Danh sách chạy được (để test/validate/liệt kê ở admin) — phải khớp union trên. */
export const ANALYTICS_EVENT_NAMES: readonly AnalyticsEventName[] = [
  "app_open",
  "session_end",
  "ftue_step",
  "login_success",
  "login_failed",
  "mode_select",
  "match_start",
  "match_end",
  "campaign_level_start",
  "campaign_level_complete",
  "campaign_level_fail",
  "energy_empty",
  "energy_purchase",
  "shop_open",
  "purchase_start",
  "purchase_success",
  "purchase_fail",
  "ad_request",
  "ad_impression",
  "ad_reward",
  "ad_error",
  "invite_sent",
  "invite_accepted",
  "purchase_fulfilled",
  "energy_spend",
  "energy_grant",
] as const;

/**
 * Ai phát ra sự kiện (doc 35 §A1.4).
 *
 * Vì sao phải có trục này chứ không chỉ dựa vào tên sự kiện: `match_end` và `campaign_level_complete`
 * được phát ở CẢ HAI phía. Client phát sớm hơn và phủ được cả ván không nộp kết quả; server phát
 * muộn hơn nhưng là thứ duy nhất dùng để đếm tiền và đánh giá liêm chính. Trộn hai nguồn vào một
 * cột `name` là cách chắc chắn nhất để mọi con số về sau đều nhân đôi mà không ai nhận ra.
 *
 * Quy ước truy vấn: số liệu HÀNH VI (funnel, retention) đọc `source = 'client'`; số liệu TIỀN và
 * liêm chính đọc `source = 'server'`.
 */
export type AnalyticsSource = "client" | "server";

/** Sự kiện chỉ server được phát — client gửi lên thì phải bị từ chối. */
export const SERVER_ONLY_EVENTS: readonly AnalyticsEventName[] = [
  "purchase_fulfilled",
  "energy_spend",
  "energy_grant",
];

/** Giá trị thuộc tính cho phép — cố ý KHÔNG cho object/array lồng nhau để bảng còn truy vấn được. */
export type AnalyticsValue = string | number | boolean | null;
export type AnalyticsProps = Record<string, AnalyticsValue>;

/** Bối cảnh phiên — client gắn vào mọi sự kiện. */
export interface AnalyticsContext {
  /** Id phiên (một lần mở app). */
  sessionId: string;
  /** Id thiết bị ẩn danh, bền qua nhiều phiên. KHÔNG phải player_id. */
  anonId: string;
  platform: AnalyticsPlatform;
  /** Bản phát hành (commit sha ngắn hoặc số build). */
  buildId: string;
}

/** Một sự kiện đã đóng gói, đúng dạng gửi lên `POST /v1/events`. */
export interface AnalyticsEvent {
  /** UUID do client sinh — server khử trùng theo trường này. */
  eventId: string;
  name: AnalyticsEventName;
  /** Epoch ms lúc sự kiện XẢY RA (không phải lúc gửi). */
  ts: number;
  schema: number;
  sessionId: string;
  anonId: string;
  platform: AnalyticsPlatform;
  buildId: string;
  props: AnalyticsProps;
}

// ---- Chặn PII ---------------------------------------------------------------------------------

/**
 * Khoá bị CẤM trong `props`. Chặn ở tầng code vì đây là thứ dễ vô tình lọt nhất: ai đó thêm
 * `{ email }` vào một sự kiện và không ai nhận ra cho tới lúc kiểm toán dữ liệu.
 * So khớp KHÔNG phân biệt hoa thường và theo chuỗi con, nên `userEmail`/`user_email` đều bị chặn.
 */
export const FORBIDDEN_PROP_KEYS: readonly string[] = [
  "email",
  "phone",
  "password",
  "token",
  "initdata",
  "displayname",
  "username",
  "firstname",
  "lastname",
  "address",
  "ip",
];

/** Trần độ dài chuỗi trong props — chống việc nhét cả payload vào một trường. */
export const MAX_PROP_STRING_LENGTH = 200;
/** Trần số thuộc tính mỗi sự kiện. */
export const MAX_PROPS = 20;

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_PROP_KEYS.some((bad) => k.includes(bad));
}

/**
 * Lọc `props` về dạng an toàn và truy vấn được:
 *  - bỏ khoá nghi PII,
 *  - bỏ giá trị không phải nguyên thuỷ (object/array/hàm/undefined),
 *  - bỏ số không hữu hạn (NaN/Infinity làm hỏng phép tổng hợp),
 *  - cắt chuỗi quá dài, cắt bớt khi quá nhiều khoá.
 *
 * Cố ý KHÔNG ném lỗi: mất một thuộc tính thì vẫn còn sự kiện để đếm; ném lỗi giữa vòng lặp game
 * chỉ đổi một lỗi dữ liệu thành một lỗi runtime.
 */
export function sanitizeProps(props: Record<string, unknown> | undefined): AnalyticsProps {
  const out: AnalyticsProps = {};
  if (!props) return out;
  let count = 0;
  for (const [key, value] of Object.entries(props)) {
    if (count >= MAX_PROPS) break;
    if (isForbiddenKey(key)) continue;
    if (value === null) { out[key] = null; count++; continue; }
    if (typeof value === "boolean") { out[key] = value; count++; continue; }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value; count++; continue;
    }
    if (typeof value === "string") {
      out[key] = value.length > MAX_PROP_STRING_LENGTH ? value.slice(0, MAX_PROP_STRING_LENGTH) : value;
      count++; continue;
    }
    // object/array/undefined/function → bỏ
  }
  return out;
}

// ---- Dựng sự kiện -----------------------------------------------------------------------------

/** UUID chạy được ở cả trình duyệt lẫn Node. Có `crypto.randomUUID` thì dùng, không thì tự dựng. */
function newEventId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Dự phòng: đủ ngẫu nhiên để khử trùng trong phạm vi một phiên.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Đóng gói một sự kiện. `now` truyền vào được để test tất định (không phụ thuộc đồng hồ thật).
 */
export function makeEvent(
  name: AnalyticsEventName,
  props: Record<string, unknown> | undefined,
  ctx: AnalyticsContext,
  now: number = Date.now(),
): AnalyticsEvent {
  return {
    eventId: newEventId(),
    name,
    ts: now,
    schema: ANALYTICS_SCHEMA_VERSION,
    sessionId: ctx.sessionId,
    anonId: ctx.anonId,
    platform: ctx.platform,
    buildId: ctx.buildId,
    props: sanitizeProps(props),
  };
}

/**
 * Kiểm một sự kiện nhận từ ngoài (server dùng trước khi ghi database). Trả danh sách lỗi; rỗng = hợp lệ.
 * Server KHÔNG tin client nên phải kiểm lại, kể cả khi client đã dùng `makeEvent`.
 */
export function validateEvent(input: unknown): string[] {
  const errs: string[] = [];
  if (typeof input !== "object" || input === null) return ["sự kiện không phải object"];
  const e = input as Partial<AnalyticsEvent>;

  if (typeof e.eventId !== "string" || e.eventId.length === 0 || e.eventId.length > 64) errs.push("eventId không hợp lệ");
  if (typeof e.name !== "string" || !ANALYTICS_EVENT_NAMES.includes(e.name as AnalyticsEventName)) errs.push("name không nằm trong danh sách");
  if (typeof e.ts !== "number" || !Number.isFinite(e.ts) || e.ts <= 0) errs.push("ts không hợp lệ");
  if (typeof e.schema !== "number" || e.schema <= 0) errs.push("schema không hợp lệ");
  if (typeof e.sessionId !== "string" || e.sessionId.length === 0) errs.push("thiếu sessionId");
  if (typeof e.anonId !== "string" || e.anonId.length === 0) errs.push("thiếu anonId");
  if (e.platform !== "telegram" && e.platform !== "web") errs.push("platform không hợp lệ");
  if (typeof e.buildId !== "string" || e.buildId.length === 0) errs.push("thiếu buildId");
  if (e.props !== undefined && (typeof e.props !== "object" || e.props === null || Array.isArray(e.props))) {
    errs.push("props phải là object phẳng");
  }
  return errs;
}
