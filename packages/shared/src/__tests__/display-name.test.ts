import { describe, expect, it } from "vitest";
import {
  BLOCKED_SUBSTRING,
  BLOCKED_WORD,
  MAX_DISPLAY_NAME,
  fallbackName,
  foldForMatch,
  hasBlockedWord,
  sanitizeDisplayName,
} from "../display-name";

/**
 * doc 35 §C3. Bài đắt nhất trong file là nhóm "lách" — không phải nhóm "chặn từ thẳng".
 *
 * Một bộ lọc chỉ so chuỗi thô thì chặn được đúng người không định lách, tức là chặn nhầm đối tượng.
 * Giá trị của lát này nằm ở phép CHUẨN HOÁ, nên đó là chỗ phải có test.
 */

describe("foldForMatch — chuẩn hoá để so khớp", () => {
  it("xoá ký tự VÔ HÌNH chèn giữa từ", () => {
    // Zero-width space / joiner: mắt người vẫn đọc ra từ, mà so chuỗi thô thì trượt.
    expect(foldForMatch("f​uc‍k")).toBe("fuck");
  });

  it("gộp chữ Kirin nhìn giống Latin", () => {
    // NFKC KHÔNG làm việc này — `а` (U+0430) và `a` (U+0061) là hai mã điểm khác nhau.
    expect(foldForMatch("ѕhіt")).toBe("shit");
  });

  it("gộp biến thể tương thích qua NFKC", () => {
    expect(foldForMatch("ｆｕｃｋ")).toBe("fuck");
    expect(foldForMatch("𝐟𝐮𝐜𝐤")).toBe("fuck");
  });

  it("bỏ dấu ngăn kiểu f.u.c.k và f-u-c-k", () => {
    expect(foldForMatch("f.u.c.k")).toBe("fuck");
    expect(foldForMatch("f-u-c-k")).toBe("fuck");
  });

  it("gộp chữ số thay chữ cái", () => {
    expect(foldForMatch("5h1t")).toBe("shit");
  });

  it("GIỮ chữ tiếng Việt có dấu — không được coi dấu là ký tự lạ", () => {
    expect(foldForMatch("Nguyễn Văn Ơn")).toBe("nguyễnvănơn");
  });
});

describe("sanitizeDisplayName", () => {
  it("tên bình thường đi qua nguyên vẹn", () => {
    const r = sanitizeDisplayName("Quang Nguyễn");
    expect(r).toEqual({ name: "Quang Nguyễn", changed: false, reason: null });
  });

  it("tên tiếng Việt có dấu KHÔNG bị đụng tới", () => {
    // Bài giữ cho một bộ lọc viết bằng tiếng Anh không vô tình đổi tên nửa số người chơi.
    for (const n of ["Đỗ Thị Hường", "Trần Bảo Ngọc", "Lê Hoàng Ưng"]) {
      expect(sanitizeDisplayName(n).name).toBe(n);
    }
  });

  it("rỗng / chỉ khoảng trắng / không phải chuỗi ⇒ tên thay thế", () => {
    for (const bad of ["", "   ", "​​", null, undefined, 42]) {
      const r = sanitizeDisplayName(bad as unknown, "seed-1");
      expect(r.reason).toBe("empty");
      expect(r.name.length).toBeGreaterThan(0);
    }
  });

  it("từ cấm — kể cả bản đã lách — ⇒ THAY tên, không ném lỗi", () => {
    for (const bad of ["fuck", "F​UCK", "ѕhіt", "5h1t", "xxfuckxx"]) {
      const r = sanitizeDisplayName(bad, "seed-2");
      expect(r.reason, bad).toBe("blocked");
      expect(hasBlockedWord(r.name), `tên thay thế cho "${bad}" lại dính chính bộ lọc`).toBe(false);
    }
  });

  it("cùng seed ⇒ cùng tên thay thế; khác seed ⇒ khác", () => {
    // Ổn định là điều kiện để người chơi nhận ra chính mình giữa hai ván.
    expect(fallbackName("abc")).toBe(fallbackName("abc"));
    expect(fallbackName("abc")).not.toBe(fallbackName("xyz"));
  });

  it("quá dài ⇒ CẮT chứ không thay — cắt vẫn giữ được ý người chơi", () => {
    const r = sanitizeDisplayName("x".repeat(100));
    expect(r.reason).toBe("trimmed");
    expect(r.name.length).toBe(MAX_DISPLAY_NAME);
  });

  it("gộp khoảng trắng thừa và cắt hai đầu", () => {
    expect(sanitizeDisplayName("  Quang   Nguyễn  ").name).toBe("Quang Nguyễn");
  });

  it("ký tự điều khiển hướng viết bị xoá — chuỗi lưu và chuỗi hiện phải là một", () => {
    // U+202E đảo chiều hiển thị: lưu "abc" mà hiện ra "cba". Không được để lọt vào roster.
    expect(sanitizeDisplayName("Quang‮Nguyen").name).toBe("QuangNguyen");
  });
});

describe("chặn nhầm — ranh giới phải giữ được", () => {
  it("KHÔNG có từ cấm nào ngắn tới mức dính vào tên thật", () => {
    // Danh sách dài không làm bộ lọc tốt hơn, chỉ làm tăng số lần chặn nhầm. Từ dưới 4 ký tự gần
    // như chắc chắn sẽ nằm lọt trong một cái tên hợp lệ nào đó.
    for (const w of [...BLOCKED_SUBSTRING, ...BLOCKED_WORD]) {
      expect(w.length, `từ cấm quá ngắn: "${w}"`).toBeGreaterThanOrEqual(3);
    }
  });

  it("tên thật phổ biến KHÔNG bị chặn", () => {
    for (const n of ["Hoàng Anh", "Minh Thư", "Scunthorpe", "Nguyễn An", "Kevin", "Sasha", "Cường"]) {
      expect(hasBlockedWord(n), n).toBe(false);
    }
  });
});

describe("hai mức chặn — ranh giới giữa chúng phải đúng", () => {
  it("mức CHUỖI CON bắt được cả khi nằm giữa tên", () => {
    expect(hasBlockedWord("xxfuckxx")).toBe(true);
  });

  it("mức NGUYÊN TỪ không dính tên thật chứa nó", () => {
    // Đây là bài đã bắt lỗi bản đầu: `includes()` trơn làm "Scunthorpe" và "Ad Minh" bị đổi tên.
    expect(hasBlockedWord("Scunthorpe")).toBe(false);
    expect(hasBlockedWord("Ad Minh")).toBe(false);
    expect(hasBlockedWord("grape")).toBe(false);
    expect(hasBlockedWord("Nazira")).toBe(false);
  });

  it("mức NGUYÊN TỪ vẫn chặn khi là nguyên một từ, hoặc là cả cái tên đã lách dấu", () => {
    expect(hasBlockedWord("admin")).toBe(true);
    expect(hasBlockedWord("Super Admin")).toBe(true);
    expect(hasBlockedWord("c.u.n.t")).toBe(true);
  });
});
