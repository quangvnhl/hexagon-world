// Remote config + feature flag (doc 35 §A2) — HỢP ĐỒNG dùng chung client ↔ server ↔ admin.
//
// Vấn đề đang có: mọi tham số nằm trong `config.ts` + `.env`, nên đổi giá năng lượng, tần suất
// quảng cáo hay tắt một chế độ đều phải build + deploy. Không có kill-switch: sự cố xảy ra lúc
// 2 giờ sáng thì không tắt được thứ đang hỏng.
//
// Bốn nguyên tắc, mỗi cái sinh ra từ một cách hệ thống này có thể hỏng:
//
//  1. **Luôn có fallback.** Mỗi khoá có giá trị mặc định NGAY TRONG CODE. Database chết, mạng
//     hỏng, JSON sai — game vẫn chạy bằng hằng số. Remote config không bao giờ được trở thành
//     một điểm chết mới.
//  2. **Giá trị sai KIỂU thì bỏ, không sập.** Ai đó gõ nhầm `"true"` (chuỗi) vào ô boolean trong
//     trang admin lúc 2 giờ sáng thì hậu quả tệ nhất phải là "khoá đó dùng mặc định", không phải
//     "client trắng màn hình".
//  3. **Rollout theo % phải TẤT ĐỊNH.** Cùng một người chơi phải luôn rơi vào cùng một nhánh, kể
//     cả khi client và server tự tính độc lập. Nên dùng hàm băm thuần trên (khoá + id), không
//     dùng random, không dùng thời gian.
//  4. **Mọi khoá mang nhãn platform ngay từ đầu** (doc 35 §B8) — thêm trục này sau sẽ phải đi sửa
//     lại toàn bộ dữ liệu cũ.

/** Nền tảng của người đang hỏi cấu hình. */
export type ConfigPlatform = "telegram" | "web";

/** Kiểu giá trị cho phép — cố ý hẹp để bảng còn kiểm tra được kiểu. */
export type RemoteConfigValue = string | number | boolean;

/**
 * Bộ khoá kill-switch tối thiểu (doc 35 §A2). Khoá cứng thành union vì lý do giống `analytics.ts`:
 * để client, server và admin dùng CHUNG một danh sách, gõ sai tên là typecheck bắt ngay.
 */
export type RemoteConfigKey =
  | "ads.enabled"
  | "ads.rewarded_daily_cap"
  | "ads.rewarded_min_gap_seconds"
  | "stars.enabled"
  | "netplay.enabled"
  | "campaign.enabled"
  | "energy.regen_seconds"
  | "energy.purchase_price"
  | "bots.difficulty_profile"
  | "ftue.enabled"
  | "ftue.bot_count"
  | "ftue.step3_claims"
  | "ftue.step3_target_pct";

/**
 * Mặc định = SỰ THẬT khi không có gì khác. Đây chính là fallback của nguyên tắc 1.
 * Con số quảng cáo lấy từ quyết định đã chốt ở doc 35 (5 lượt/ngày, giãn ≥ 3 phút).
 */
export const REMOTE_CONFIG_DEFAULTS: Readonly<Record<RemoteConfigKey, RemoteConfigValue>> = {
  "ads.enabled": true,
  "ads.rewarded_daily_cap": 5,
  "ads.rewarded_min_gap_seconds": 180,
  "stars.enabled": true,
  "netplay.enabled": true,
  "campaign.enabled": true,
  "energy.regen_seconds": 180,
  "energy.purchase_price": 100,
  "bots.difficulty_profile": "normal",
  // FTUE (doc 35 §D1). Ba số này ĐO ĐƯỢC ra chứ không chọn theo cảm tính — xem phần đầu
  // `packages/client/src/components/ftueSteps.ts` để biết bảng đo. `bot_count: 0` vì chỉ cần
  // 1 bot là hơn nửa số kiểu lái của người mới chết trước giây thứ 90.
  "ftue.enabled": true,
  "ftue.bot_count": 0,
  "ftue.step3_claims": 2,
  "ftue.step3_target_pct": 0.3,
};

/** Danh sách chạy được (admin liệt kê, test đối chiếu) — suy từ chính bảng mặc định nên không lệch. */
export const REMOTE_CONFIG_KEYS = Object.keys(REMOTE_CONFIG_DEFAULTS) as RemoteConfigKey[];

export type RemoteConfigBundle = Record<RemoteConfigKey, RemoteConfigValue>;

/**
 * Điều kiện áp dụng một dòng cấu hình. Mọi trường đều TUỲ CHỌN; thiếu = không giới hạn.
 *
 * `rollout` là nền cho A/B test: 25 nghĩa là 25% người chơi thấy giá trị này, phần còn lại dùng
 * mặc định. Chia nhóm bằng hàm băm trên (khoá + id) nên cùng người luôn ở cùng nhánh, và hai khoá
 * khác nhau chia nhóm độc lập (không dồn tất cả thí nghiệm vào cùng 25% người xui).
 */
export interface RemoteConfigAudience {
  platforms?: ConfigPlatform[];
  /** 0–100. Ngoài khoảng này coi như không hợp lệ ⇒ bỏ dòng (nguyên tắc 2). */
  rollout?: number;
  /** Chỉ áp cho bản build này trở đi (so sánh chuỗi theo thứ tự từ điển; thiếu = mọi build). */
  minBuild?: string;
}

/** Một dòng trong bảng `remote_config`. */
export interface RemoteConfigRow {
  key: string;
  value: unknown;
  audience?: RemoteConfigAudience | null;
}

/** Bối cảnh của người đang hỏi — quyết định dòng nào áp được. */
export interface RemoteConfigRequest {
  platform: ConfigPlatform;
  buildId: string;
  /** `player_id` nếu đã đăng nhập, `anon_id` nếu chưa. Dùng để chia nhóm rollout. */
  unitId: string;
}

/**
 * Băm FNV-1a 32-bit. Chọn hàm này vì nó ngắn, không phụ thuộc thư viện, và cho KẾT QUẢ GIỐNG NHAU
 * ở client (trình duyệt) lẫn server (Node) — điều kiện bắt buộc để hai bên chia nhóm khớp nhau.
 * Không dùng cho mục đích bảo mật.
 */
export function stableHash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Vị trí 0–99 của một người trong nhóm rollout của MỘT khoá. Tất định, độc lập giữa các khoá. */
export function rolloutBucket(key: string, unitId: string): number {
  return stableHash32(`${key}:${unitId}`) % 100;
}

/** Dòng này có áp cho người đang hỏi không? `audience` rỗng/thiếu ⇒ áp cho tất cả. */
export function audienceMatches(
  key: string,
  audience: RemoteConfigAudience | null | undefined,
  req: RemoteConfigRequest,
): boolean {
  if (!audience) return true;

  if (Array.isArray(audience.platforms) && audience.platforms.length > 0) {
    if (!audience.platforms.includes(req.platform)) return false;
  }

  if (typeof audience.minBuild === "string" && audience.minBuild.length > 0) {
    if (req.buildId < audience.minBuild) return false;
  }

  if (audience.rollout !== undefined) {
    const pct = audience.rollout;
    // Số vô lý (âm, > 100, NaN, không phải số) ⇒ coi như dòng hỏng, KHÔNG áp. Thà giữ mặc định
    // còn hơn bật một thí nghiệm cho 100% người chơi vì gõ nhầm.
    if (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100) return false;
    if (pct === 0) return false;
    if (pct < 100 && rolloutBucket(key, req.unitId) >= pct) return false;
  }

  return true;
}

/**
 * Ép giá trị từ database về ĐÚNG KIỂU của mặc định. Sai kiểu ⇒ `undefined` (gọi bên ngoài sẽ dùng
 * mặc định). Cố ý KHÔNG tự đổi kiểu ("true" → true, "5" → 5): tự đoán ý người nhập là cách chắc
 * chắn nhất để một hôm nào đó đoán sai mà không ai biết.
 */
export function coerceToTypeOf(
  expected: RemoteConfigValue,
  raw: unknown,
): RemoteConfigValue | undefined {
  if (typeof expected === "boolean") return typeof raw === "boolean" ? raw : undefined;
  if (typeof expected === "number") {
    return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
  }
  return typeof raw === "string" ? raw : undefined;
}

/**
 * Trộn các dòng database lên trên mặc định, chỉ nhận dòng hợp lệ và đúng đối tượng.
 * Khoá lạ (còn sót sau khi đổi tên) bị bỏ qua — không làm hỏng cả bundle.
 */
export function resolveRemoteConfig(rows: RemoteConfigRow[], req: RemoteConfigRequest): RemoteConfigBundle {
  const out = { ...REMOTE_CONFIG_DEFAULTS } as RemoteConfigBundle;
  for (const row of rows) {
    if (!(row.key in REMOTE_CONFIG_DEFAULTS)) continue;
    const key = row.key as RemoteConfigKey;
    if (!audienceMatches(key, row.audience, req)) continue;
    const value = coerceToTypeOf(REMOTE_CONFIG_DEFAULTS[key], row.value);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * ETag của một bundle. Chuỗi hoá theo THỨ TỰ KHOÁ CỐ ĐỊNH rồi băm: hai bundle giống nhau về nội
 * dung phải cho cùng ETag dù thứ tự dòng trong database khác nhau, nếu không client sẽ tải lại
 * cấu hình y hệt mỗi lần và ETag mất hết tác dụng.
 */
export function remoteConfigEtag(bundle: RemoteConfigBundle): string {
  const canonical = REMOTE_CONFIG_KEYS.map((k) => `${k}=${String(bundle[k])}`).join("&");
  return `"rc1-${stableHash32(canonical).toString(36)}"`;
}
