import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DATA_COLLECTED,
  DATA_NOT_COLLECTED,
  LEGAL,
  LEGAL_EMAIL_PLACEHOLDER,
  LEGAL_OPERATOR_PLACEHOLDER,
  contactEmail,
  legalIsPublishable,
  operatorName,
  type LegalFacts,
} from "../legal";

// doc 35 §C4 — trang pháp lý sai thì không có test đơn vị nào kêu, vì "sai" ở đây là NỘI DUNG
// không khớp thực tế chứ không phải mã ném lỗi. Ba thứ dưới đây là những phần CÓ THỂ kiểm bằng
// máy, và cả ba đều là loại trôi âm thầm.

function facts(over: Partial<LegalFacts>): LegalFacts {
  return { ...LEGAL, ...over };
}

describe("cổng phát hành", () => {
  it("thiếu tên đơn vị HOẶC email ⇒ chưa phát hành được", () => {
    expect(legalIsPublishable(facts({ operator: "", contactEmail: "a@b.c" }))).toBe(false);
    expect(legalIsPublishable(facts({ operator: "Công ty X", contactEmail: "" }))).toBe(false);
    // Khoảng trắng không tính là đã điền — đây là cách người ta "điền cho xong".
    expect(legalIsPublishable(facts({ operator: "   ", contactEmail: "  " }))).toBe(false);
  });

  it("điền đủ hai ô ⇒ phát hành được", () => {
    expect(legalIsPublishable(facts({ operator: "Công ty X", contactEmail: "ho-tro@x.vn" }))).toBe(true);
  });

  it("chưa điền ⇒ trang hiện chỗ trống RÕ RÀNG, không hiện tên nghe như thật", () => {
    // Nếu chỗ này trả về "Hexagon World" hay "Nhà phát hành" thì trang chưa điền vẫn trông như
    // trang thật và sẽ được gửi đi duyệt như thế. Chỗ trống phải xấu để không ai bỏ sót.
    expect(operatorName(facts({ operator: "" }))).toBe(LEGAL_OPERATOR_PLACEHOLDER);
    expect(contactEmail(facts({ contactEmail: "" }))).toBe(LEGAL_EMAIL_PLACEHOLDER);
    expect(LEGAL_OPERATOR_PLACEHOLDER).toMatch(/CHƯA ĐIỀN/);
  });

  it("điền rồi thì dùng đúng giá trị đã điền", () => {
    expect(operatorName(facts({ operator: " Công ty X " }))).toBe("Công ty X");
    expect(contactEmail(facts({ contactEmail: " ho-tro@x.vn " }))).toBe("ho-tro@x.vn");
  });
});

describe("hạn lưu dữ liệu phải khớp DATABASE", () => {
  it("analyticsRetentionDays bằng đúng mặc định của purge_old_analytics_events", () => {
    // Đây là lời HỨA với người chơi in trên trang riêng tư. Đổi hạn trong database mà quên đổi ở
    // đây (hoặc ngược lại) là nói một đằng làm một nẻo — và không có gì khác bắt được việc đó.
    const sql = readFileSync(
      path.resolve(__dirname, "../../../../../supabase/migrations/202609030001_analytics_events.sql"),
      "utf8",
    );
    const match = sql.match(/purge_old_analytics_events\(p_keep_days integer default (\d+)\)/);
    expect(match, "không tìm thấy hàm purge trong migration — đổi tên hàm thì sửa test này").not.toBeNull();
    expect(LEGAL.analyticsRetentionDays).toBe(Number(match![1]));
  });
});

describe("bảng dữ liệu thu thập", () => {
  it("mọi mục có đủ ba cột — cột rỗng in ra là một ô trống trên trang thật", () => {
    expect(DATA_COLLECTED.length).toBeGreaterThan(0);
    for (const item of DATA_COLLECTED) {
      expect(item.what.trim()).not.toBe("");
      expect(item.why.trim()).not.toBe("");
      expect(item.keptFor.trim()).not.toBe("");
    }
  });

  it("không có mục nào trùng nhau", () => {
    expect(new Set(DATA_COLLECTED.map((d) => d.what)).size).toBe(DATA_COLLECTED.length);
  });

  it("nêu đủ bốn nhóm mà game THẬT SỰ lưu, theo schema database", () => {
    const all = DATA_COLLECTED.map((d) => d.what.toLowerCase()).join(" | ");
    // players/player_identities · campaign+wallet · analytics_events · purchase_orders
    expect(all).toMatch(/telegram/);
    expect(all).toMatch(/tiến độ|coin|năng lượng/);
    expect(all).toMatch(/sự kiện/);
    expect(all).toMatch(/stars|giao dịch/);
  });

  it("giữ nguyên bốn lời hứa phủ định — bỏ một dòng ở đây là âm thầm mở rộng phạm vi thu thập", () => {
    const all = DATA_NOT_COLLECTED.join(" ").toLowerCase();
    expect(all).toMatch(/không bán/);
    expect(all).toMatch(/vị trí|danh bạ/);
    expect(all).toMatch(/thẻ/);
    expect(all).toMatch(/quảng cáo/);
  });
});
