// doc 35 §C4 (lát c4.2) — tự xoá tài khoản + xuất dữ liệu.
//
// Bài đắt nhất trong file này là bài CUỐI CÙNG: nó khoá con số 30 ngày ở ba nơi lại với nhau —
// trang `/privacy` in ra cho người dùng đọc, hằng số trong controller, và mặc định của
// `purge_deleted_players()` trong migration. Ba nguồn cho cùng một lời hứa là ba cơ hội để hứa một
// đằng làm một nẻo, và chính sách riêng tư là chỗ đắt nhất để sai.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import type { Request } from "express";
import type { SessionService } from "../src/auth/session.service";
import type { SupabaseService } from "../src/database/supabase.service";
import { DELETION_GRACE_DAYS, PlayersController } from "../src/players/players.controller";

const PLAYER = { id: "11111111-1111-1111-1111-111111111111", displayName: "Ai Do" };

function sessions() {
  return { resolve: async () => PLAYER } as unknown as SessionService;
}

/** DB giả: ghi lại mọi lệnh update để kiểm THỨ TỰ, không chỉ kết quả. */
function db(opts: { sessionsError?: boolean; playersError?: string } = {}) {
  const calls: { table: string; op: string; patch?: Record<string, unknown> }[] = [];
  const service = {
    from: (table: string) => {
      const api: Record<string, unknown> = {};
      Object.assign(api, {
        select: () => api,
        eq: () => api,
        is: () => api,
        maybeSingle: async () => ({ data: null, error: null }),
        single: async () => ({ data: null, error: null }),
        update: (patch: Record<string, unknown>) => {
          calls.push({ table, op: "update", patch });
          return api;
        },
        then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
          const error =
            table === "player_sessions" && opts.sessionsError ? { message: "mat ket noi" }
            : table === "players" && opts.playersError ? { message: opts.playersError }
            : null;
          return Promise.resolve({ data: [], error }).then(resolve);
        },
      });
      return api;
    },
  } as unknown as SupabaseService;
  return { service, calls };
}

const REQ = {} as Request;

describe("DELETE /v1/me — vô hiệu NGAY, xoá hẳn sau thời gian chờ", () => {
  it("thu hồi phiên TRƯỚC khi đổi trạng thái", async () => {
    // Thứ tự là phần nội dung, không phải tiểu tiết: đổi trạng thái trước rồi thu hồi hỏng sẽ để
    // lại một tài khoản mang nhãn "đã xoá" mà phiên vẫn sống — đúng thứ người dùng vừa yêu cầu
    // chấm dứt.
    const d = db();
    await new PlayersController(sessions(), d.service).deleteAccount(REQ);
    expect(d.calls.map((c) => c.table)).toEqual(["player_sessions", "players"]);
  });

  it("đánh dấu deleted + deleted_at, KHÔNG xoá định danh ngay", async () => {
    // Thời gian chờ tồn tại để người dùng đổi ý. Xoá định danh ngay thì không còn cách nào nhận ra
    // họ để khôi phục, và lời hứa "khoảng chờ này để bạn đổi ý" thành vô nghĩa.
    const d = db();
    const res = await new PlayersController(sessions(), d.service).deleteAccount(REQ);
    const players = d.calls.find((c) => c.table === "players")!;
    expect(players.patch).toMatchObject({ status: "deleted" });
    expect(players.patch!.deleted_at).toEqual(expect.any(String));
    expect(d.calls.some((c) => c.table === "player_identities")).toBe(false);
    expect(res).toMatchObject({ ok: true, graceDays: DELETION_GRACE_DAYS });
  });

  it("thu hồi phiên HỎNG ⇒ dừng lại, KHÔNG đánh dấu đã xoá", async () => {
    const d = db({ sessionsError: true });
    await expect(new PlayersController(sessions(), d.service).deleteAccount(REQ))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(d.calls.some((c) => c.table === "players")).toBe(false);
  });

  it("cập nhật players HỎNG ⇒ báo lỗi, không im lặng trả ok", async () => {
    const d = db({ playersError: "khong ghi duoc" });
    await expect(new PlayersController(sessions(), d.service).deleteAccount(REQ))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("GET /v1/me/export — có đường tải về TRƯỚC khi xoá", () => {
  it("trả về mọi nhóm dữ liệu, kèm mốc thời gian xuất", async () => {
    const out = await new PlayersController(sessions(), db().service).exportData(REQ);
    expect(out.exportedAt).toEqual(expect.any(String));
    for (const k of ["player", "profile", "stats", "progression", "wallets", "inventory", "loadout", "identities", "campaignProgress", "energy"]) {
      expect(out, `thiếu nhóm ${k}`).toHaveProperty(k);
    }
  });

  it("có `identities` — id Telegram LÀ dữ liệu của người dùng", async () => {
    // Bỏ nhóm này khỏi bản xuất là giữ lại đúng thứ nhạy cảm nhất mà người ta có quyền lấy về, và
    // cũng là thứ sẽ bị xoá khi hết thời gian chờ.
    const out = await new PlayersController(sessions(), db().service).exportData(REQ);
    expect(Array.isArray(out.identities)).toBe(true);
  });
});

describe("30 ngày phải là MỘT con số, không phải ba", () => {
  const root = path.resolve(__dirname, "../../..");
  const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

  it("hằng số controller khớp `LEGAL.deletionGraceDays` mà trang /privacy in ra", () => {
    const legal = read("packages/client/src/lib/legal.ts");
    const m = /deletionGraceDays:\s*(\d+)/.exec(legal);
    expect(m, "không đọc được deletionGraceDays trong legal.ts").not.toBeNull();
    expect(Number(m![1])).toBe(DELETION_GRACE_DAYS);
  });

  it("mặc định của `purge_deleted_players` trong migration cũng khớp", () => {
    // Y hệt cách `analyticsRetentionDays` được khoá với `purge_old_analytics_events`. Không có bài
    // này thì một lần sửa vội ở SQL sẽ lặng lẽ biến trang /privacy thành một câu sai.
    const sql = read("supabase/migrations/202609080002_self_serve_privacy.sql");
    const m = /purge_deleted_players\(p_grace_days integer default (\d+)\)/.exec(sql);
    expect(m, "không đọc được mặc định trong migration").not.toBeNull();
    expect(Number(m![1])).toBe(DELETION_GRACE_DAYS);
  });

  it("migration GIỮ đúng ba bảng chứng từ mà /privacy đã hứa không xoá", () => {
    // `wallet_ledger`, `purchase_orders`, `player_energy_ledger` đều ON DELETE RESTRICT — lược đồ
    // đã mã hoá chính sách. Nếu một lần sửa thêm chúng vào danh sách xoá, bài này đỏ.
    const sql = read("supabase/migrations/202609080002_self_serve_privacy.sql");
    for (const t of ["wallet_ledger", "purchase_orders", "player_energy_ledger"]) {
      expect(sql, `${t} không được nằm trong lệnh delete`).not.toMatch(
        new RegExp(`delete\\s+from\\s+public\\.${t}\\b`, "i"),
      );
    }
  });
});
