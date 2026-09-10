// doc 35 §B9 (lát b9-bang-kinh-te) — bảng theo dõi kinh tế.
//
// ┌─ THỨ BÀI NÀY GIỮ ───────────────────────────────────────────────────────────────────────────┐
// │ Một bảng kinh tế bỏ sót nguồn phát coin vẫn hiện tỉ lệ lạm phát trông LÀNH MẠNH. Đó là kiểu  │
// │ sai nguy hiểm nhất, vì nó không giống lỗi — không có gì đỏ lên, con số vẫn đẹp, và người đọc │
// │ yên tâm đúng vào lúc coin đang chảy ra ngoài tầm nhìn.                                        │
// │                                                                                              │
// │ Pha 7 sắp mở BỐN nguồn phát mới (quảng cáo, điểm danh, nhiệm vụ, thưởng cấp). Nên `days`,     │
// │ `currency` và cách gộp không phải thứ đáng giữ ở đây — thứ đáng giữ là: một nguồn tiền chưa   │
// │ khai PHẢI nổi lên tận đầu ra, không nằm im trong một cột mà không ai đọc.                     │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Phần SQL (view, phép gộp, chia 0) đã được kiểm trực tiếp trên database dev bằng một giao dịch
// rồi ROLLBACK: thêm `ad_impression` chưa khai ⇒ `unclassified_entries` 0 → 1 và tiền VẪN nằm
// trong `issued` dưới nhóm `chua_khai`; khai vào `economy_flow_kinds` ⇒ về 0. Bài này giữ tầng
// HTTP ở trên nó.
import { describe, expect, it } from "vitest";
import { AdminController } from "../src/admin/admin.controller";
import type { OpsKeysService } from "../src/admin/ops-keys.service";
import type { SupabaseService } from "../src/database/supabase.service";

interface Hang { unclassified_entries: number; [k: string]: unknown }

/** DB giả trả `summary` cho view tổng hợp và `detail` cho view chi tiết. Ghi lại mọi filter. */
function db(summary: Hang[], detail: unknown[] = []) {
  const goi: { bang: string; gte?: string; eq?: [string, string] }[] = [];
  const service = {
    from: (bang: string) => {
      const ghi: { bang: string; gte?: string; eq?: [string, string] } = { bang };
      goi.push(ghi);
      const api: Record<string, unknown> = {};
      const ketQua = { data: bang === "economy_daily_summary" ? summary : detail, error: null };
      Object.assign(api, {
        select: () => api,
        order: () => api,
        gte: (_c: string, v: string) => { ghi.gte = v; return api; },
        eq: (c: string, v: string) => { ghi.eq = [c, v]; return api; },
        then: (resolve: (v: typeof ketQua) => unknown) => Promise.resolve(ketQua).then(resolve),
      });
      return api;
    },
  } as unknown as SupabaseService;
  return { service, goi };
}

const controller = (summary: Hang[], detail: unknown[] = []) => {
  const { service, goi } = db(summary, detail);
  return { c: new AdminController(service, {} as OpsKeysService), goi };
};

describe("GET economy/daily", () => {
  it("cộng dồn unclassified_entries lên tận đầu ra, không để nó nằm im trong một cột", async () => {
    const { c } = controller([
      { day: "2026-09-10", currency_code: "coin", issued: 500, spent: 0, unclassified_entries: 1 },
      { day: "2026-09-09", currency_code: "coin", issued: 6250, spent: 700, unclassified_entries: 3 },
    ]);
    const kq = await c.economyDaily();
    // 1 + 3. Người đọc (và agent) không phải tự cộng mới biết có nguồn tiền lạ.
    expect(kq.unclassifiedEntries).toBe(4);
  });

  it("bằng 0 khi mọi nguồn đều đã khai — cổng phải im đúng lúc, không chỉ kêu đúng lúc", async () => {
    const { c } = controller([
      { day: "2026-09-10", currency_code: "coin", issued: 500, spent: 100, unclassified_entries: 0 },
    ]);
    expect((await c.economyDaily()).unclassifiedEntries).toBe(0);
  });

  it("không có dữ liệu thì trả 0 chứ không NaN", async () => {
    // `reduce` trên mảng rỗng với giá trị khởi đầu 0; nếu ai đó bỏ giá trị khởi đầu thì bài này đỏ.
    const { c } = controller([]);
    const kq = await c.economyDaily();
    expect(kq.unclassifiedEntries).toBe(0);
    expect(Number.isNaN(kq.unclassifiedEntries)).toBe(false);
  });

  it("chịu được cột thiếu hoặc null mà không biến tổng thành NaN", async () => {
    // Một NaN lọt vào đây làm cả con số cảnh báo thành vô nghĩa — và `NaN > 0` là false, tức là
    // cảnh báo sẽ IM LẶNG thay vì kêu. Đúng kiểu hỏng mà lát này sinh ra để chặn.
    const { c } = controller([
      { day: "2026-09-10", currency_code: "coin", unclassified_entries: null as unknown as number },
      { day: "2026-09-09", currency_code: "coin" } as unknown as Hang,
      { day: "2026-09-08", currency_code: "coin", unclassified_entries: 2 },
    ]);
    expect((await c.economyDaily()).unclassifiedEntries).toBe(2);
  });

  it("giới hạn cửa sổ ngày vào [1, 365] và đọc đúng hai view", async () => {
    const { c, goi } = controller([]);
    expect((await c.economyDaily("9999")).days).toBe(365);
    expect((await c.economyDaily("0")).days).toBe(30);      // 0 là falsy ⇒ về mặc định
    expect((await c.economyDaily("-5")).days).toBe(1);
    expect((await c.economyDaily("abc")).days).toBe(30);
    expect(goi.map((g) => g.bang)).toContain("economy_daily_summary");
    expect(goi.map((g) => g.bang)).toContain("economy_daily");
  });

  it("lọc theo currency áp lên CẢ hai view, không chỉ bảng tổng hợp", async () => {
    // Lọc lệch nhau giữa hai view cho ra một trang mà phần tổng và phần chi tiết nói khác nhau.
    const { c, goi } = controller([]);
    await c.economyDaily("30", "coin");
    const coEq = goi.filter((g) => g.eq?.[0] === "currency_code" && g.eq?.[1] === "coin");
    expect(coEq.map((g) => g.bang).sort()).toEqual(["economy_daily", "economy_daily_summary"]);
  });
});
