import { Injectable } from "@nestjs/common";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { SupabaseService } from "../database/supabase.service";
import { runtimeConfig, sha256 } from "../runtime-config";

/**
 * doc 35 §C2.1 — tra khoá vận hành, kiểm phạm vi, kiểm hạn mức, ghi vết kiểm toán.
 *
 * Phần LOGIC ở file này cố ý tách khỏi phần chạm database và được export riêng: quyết định
 * "khoá này có được làm việc này không" là chỗ sai thì mất tiền, nên nó phải kiểm được bằng test
 * thuần, không cần dựng database.
 */

/** Phạm vi hợp lệ. Thêm phạm vi mới phải sửa mảng này ⇒ typecheck bắt mọi nơi dùng sai. */
export const OPS_SCOPES = [
  "players:read",
  "players:write",
  "wallet:write",
  "catalog:write",
  "config:write",
  "levels:read",
  "levels:write",
  "levels:publish",
  "bans:write",
  "analytics:read",
  "audit:read",
  "keys:read",
  "keys:write",
  "ops:admin",
] as const;
export type OpsScope = (typeof OPS_SCOPES)[number];

/** Phạm vi đặc biệt: mọi quyền. CHỈ dành cho khoá bootstrap, không gán được cho khoá thật. */
export const SCOPE_ALL = "*";

export interface OpsKeyRow {
  id: string;
  name: string;
  actor_kind: "human" | "agent";
  scopes: string[];
  daily_limits: Record<string, number>;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface OpsActor {
  keyId: string | null;
  name: string;
  actorKind: "human" | "agent";
  scopes: string[];
  dailyLimits: Record<string, number>;
  /** true = chuỗi `ADMIN_API_KEY_SHA256` cũ, chỉ còn sống khi chưa có khoá thật nào. */
  bootstrap: boolean;
}

export interface DailyUsage {
  calls: number;
  units: number;
}

// ---- Logic thuần ------------------------------------------------------------------------------

/** Sinh khoá mới. Tiền tố để nhận ra ngay khi nó lỡ lọt vào log hoặc một issue trên GitHub. */
export function generateOpsKey(): string {
  return `hxops_${randomBytes(24).toString("hex")}`;
}

/**
 * Băm ổn định một payload để so sánh hai lời gọi có giống nhau không.
 *
 * Khoá của object được SẮP XẾP trước khi tuần tự hoá: `JSON.stringify` giữ nguyên thứ tự chèn, nên
 * `{a:1,b:2}` và `{b:2,a:1}` sẽ ra hai hash khác nhau — và một client gửi lại cùng dữ liệu theo thứ
 * tự khác sẽ bị coi là lời gọi khác. Chống lặp mà phụ thuộc thứ tự khoá là chống lặp không dùng được.
 */
export function payloadHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** `null` = dùng được; chuỗi = mã lý do từ chối. */
export function keyUnusableReason(row: Pick<OpsKeyRow, "revoked_at" | "expires_at">, now = Date.now()): string | null {
  if (row.revoked_at) return "key_revoked";
  if (row.expires_at) {
    const at = Date.parse(row.expires_at);
    // Mốc hết hạn HỎNG ⇒ coi như đã hết hạn. Một giá trị không đọc được không được phép trở thành
    // "khoá sống mãi mãi".
    if (!Number.isFinite(at) || at <= now) return "key_expired";
  }
  return null;
}

export function hasScope(scopes: readonly string[], needed: OpsScope): boolean {
  return scopes.includes(SCOPE_ALL) || scopes.includes(needed);
}

/**
 * `null` = trong hạn mức; chuỗi = mã lý do bị chặn.
 *
 * Hai trần tách nhau có chủ ý: cấp 50.000 coin MỘT lần và 500 lần mỗi lần 100 coin gây thiệt hại
 * như nhau, nên đếm số lần thôi là chưa đủ.
 */
export function overDailyLimit(
  limits: Record<string, number>,
  usage: DailyUsage,
  opts: { isWrite: boolean; unitKind?: string; units?: number },
): string | null {
  const callCap = limits.calls;
  if (opts.isWrite && Number.isFinite(callCap) && usage.calls >= Number(callCap)) return "daily_call_limit";
  if (opts.unitKind) {
    const unitCap = limits[opts.unitKind];
    if (Number.isFinite(unitCap) && usage.units + Number(opts.units ?? 0) > Number(unitCap)) return "daily_unit_limit";
  }
  return null;
}

/** So sánh hash trong thời gian hằng định. Độ dài khác nhau ⇒ false, không ném. */
export function hashesEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Lọc phạm vi do người dùng gửi lên: bỏ tên không hợp lệ và chặn `*`. */
export function sanitizeScopes(input: unknown): OpsScope[] {
  if (!Array.isArray(input)) return [];
  const valid = new Set<string>(OPS_SCOPES);
  // `*` bị loại ở đây, không phải ở tầng gọi: nếu API cấp được `*` thì mọi giới hạn phạm vi bên
  // dưới chỉ còn là gợi ý.
  return [...new Set(input.map(String).filter((s) => valid.has(s)))] as OpsScope[];
}

export interface AuditEntry {
  keyId: string | null;
  actorKind: string;
  actorName: string;
  action: string;
  scope: string | null;
  targetId: string | null;
  payloadHash: string;
  idempotencyKey: string | null;
  isWrite: boolean;
  dryRun: boolean;
  status: "ok" | "error" | "denied" | "replay";
  result: Record<string, unknown>;
  units?: number;
  unitKind?: string | null;
}

// ---- Chạm database ----------------------------------------------------------------------------

@Injectable()
export class OpsKeysService {
  constructor(private readonly db: SupabaseService) {}

  /**
   * Đổi chuỗi khoá thô thành tác nhân, hoặc `null` nếu không nhận ra / không dùng được.
   *
   * CÁCH GỠ CHUỖI `x-admin-key` DÙNG CHUNG — đọc kỹ chỗ này:
   * Chuỗi cũ (`ADMIN_API_KEY_SHA256`) vẫn dùng được, nhưng CHỈ khi bảng `ops_api_keys` chưa có khoá
   * nào còn hiệu lực. Ngay khi khoá thật đầu tiên được tạo, chuỗi cũ chết — không cần ai nhớ đi tắt
   * nó, không có biến môi trường nào để quên. Đây là lý do lát này gỡ được chuỗi dùng chung mà
   * không tự khoá mình ra ngoài: phải có đường vào để tạo khoá đầu tiên, và đường đó phải tự đóng.
   */
  async resolve(rawKey: string): Promise<OpsActor | null> {
    const raw = String(rawKey || "");
    if (!raw) return null;
    const hash = sha256(raw);

    const { data } = await this.db.from("ops_api_keys")
      .select("id,name,actor_kind,scopes,daily_limits,expires_at,revoked_at")
      .eq("key_hash", hash)
      .maybeSingle();
    const row = data as OpsKeyRow | null;
    if (row) {
      if (keyUnusableReason(row)) return null;
      void this.touch(row.id);
      return {
        keyId: row.id,
        name: row.name,
        actorKind: row.actor_kind,
        scopes: row.scopes ?? [],
        dailyLimits: (row.daily_limits ?? {}) as Record<string, number>,
        bootstrap: false,
      };
    }

    const legacy = runtimeConfig().adminApiKeyHash;
    if (!legacy || !hashesEqual(hash, legacy)) return null;
    if (await this.hasActiveKey()) return null;
    return {
      keyId: null,
      name: "bootstrap (ADMIN_API_KEY_SHA256)",
      actorKind: "human",
      scopes: [SCOPE_ALL],
      dailyLimits: {},
      bootstrap: true,
    };
  }

  /** Có khoá thật nào còn sống không — quyết định chuỗi bootstrap còn hiệu lực hay không. */
  async hasActiveKey(now = new Date()): Promise<boolean> {
    const { data } = await this.db.from("ops_api_keys")
      .select("id")
      .is("revoked_at", null)
      .or(`expires_at.is.null,expires_at.gt.${now.toISOString()}`)
      .limit(1);
    return Array.isArray(data) && data.length > 0;
  }

  async dailyUsage(keyId: string | null, unitKind?: string | null): Promise<DailyUsage> {
    // Khoá bootstrap không có hàng nào trong bảng khoá nên không tra được mức tiêu dùng. Nó cũng
    // không có `daily_limits`, nên trả 0 là đúng chứ không phải là bỏ qua kiểm tra.
    if (!keyId) return { calls: 0, units: 0 };
    try {
      const raw = await this.db.rpc<{ calls: number; units: number }>("ops_daily_usage", {
        p_key_id: keyId,
        p_unit_kind: unitKind ?? null,
      });
      return { calls: Number(raw?.calls ?? 0), units: Number(raw?.units ?? 0) };
    } catch {
      // Không đọc được mức tiêu dùng ⇒ coi như ĐÃ CHẠM TRẦN, không phải "chưa dùng gì". Database
      // hỏng không được biến thành đường vòng qua hạn mức.
      return { calls: Number.MAX_SAFE_INTEGER, units: Number.MAX_SAFE_INTEGER };
    }
  }

  /** Tìm lời gọi trước có cùng `Idempotency-Key`. `null` nếu chưa từng chạy thành công. */
  async findReplay(keyId: string | null, idempotencyKey: string | null): Promise<{ result: Record<string, unknown>; payload_hash: string } | null> {
    if (!keyId || !idempotencyKey) return null;
    const { data } = await this.db.from("ops_audit_log")
      .select("result,payload_hash")
      .eq("key_id", keyId)
      .eq("idempotency_key", idempotencyKey)
      .eq("status", "ok")
      .maybeSingle();
    return (data as { result: Record<string, unknown>; payload_hash: string } | null) ?? null;
  }

  /** Ghi vết. KHÔNG BAO GIỜ ném: mất một dòng log không được làm hỏng thao tác đã thực hiện. */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.db.from("ops_audit_log").insert({
        key_id: entry.keyId,
        actor_kind: entry.actorKind,
        actor_name: entry.actorName,
        action: entry.action,
        scope: entry.scope,
        target_id: entry.targetId,
        payload_hash: entry.payloadHash,
        idempotency_key: entry.idempotencyKey,
        is_write: entry.isWrite,
        dry_run: entry.dryRun,
        status: entry.status,
        result: entry.result ?? {},
        units: entry.units ?? 0,
        unit_kind: entry.unitKind ?? null,
      });
    } catch {
      // Nuốt có chủ ý — xem chú thích trên.
    }
  }

  private async touch(keyId: string): Promise<void> {
    try {
      await this.db.from("ops_api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", keyId);
    } catch {
      // Mốc "dùng lần cuối" là tiện ích, không phải dữ liệu bắt buộc.
    }
  }

  // ---- Quản lý khoá ---------------------------------------------------------------------------

  /** Trả về khoá thô ĐÚNG MỘT LẦN — không có đường nào đọc lại nó về sau. */
  async createKey(input: { name: string; actorKind: "human" | "agent"; scopes: OpsScope[]; dailyLimits?: Record<string, number>; expiresAt?: string | null; createdBy: string }): Promise<{ id: string; key: string }> {
    const key = generateOpsKey();
    const { data, error } = await this.db.from("ops_api_keys").insert({
      name: input.name,
      actor_kind: input.actorKind,
      key_hash: sha256(key),
      scopes: input.scopes,
      daily_limits: input.dailyLimits ?? {},
      expires_at: input.expiresAt ?? null,
      created_by: input.createdBy,
    }).select("id").single();
    if (error) throw new Error(error.message);
    return { id: (data as { id: string }).id, key };
  }

  async listKeys(): Promise<unknown[]> {
    const { data } = await this.db.from("ops_api_keys")
      .select("id,name,actor_kind,scopes,daily_limits,expires_at,revoked_at,created_at,created_by,last_used_at")
      .order("created_at", { ascending: false });
    return (data as unknown[]) ?? [];
  }

  async revokeKey(id: string): Promise<boolean> {
    const { data } = await this.db.from("ops_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id).is("revoked_at", null).select("id");
    return Array.isArray(data) && data.length > 0;
  }

  async recentAudit(limit: number): Promise<unknown[]> {
    const { data } = await this.db.from("ops_audit_log")
      .select("id,created_at,actor_kind,actor_name,action,scope,target_id,status,dry_run,units,unit_kind")
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data as unknown[]) ?? [];
  }
}
