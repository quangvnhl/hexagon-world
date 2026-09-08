// Hợp đồng ĐO của FTUE (doc 35 §D1, lát d1.2).
//
// Vì sao file này tồn tại: phần đo là thứ hỏng mà KHÔNG ai thấy. Xoá lời gọi `track` trong
// `Ftue.tsx` đi thì game vẫn chạy đúng, `pnpm -r typecheck` vẫn xanh, smoke UI vẫn xanh — chỉ có
// con số "hoàn thành FTUE ≥ 70%" (doc 35 §8) lặng lẽ trở thành 0%, và không có gì nổ ra. Một chỉ
// số sai còn tệ hơn không có chỉ số, vì nó được đem ra quyết định.
//
// Nên mỗi bài dưới đây khoá một tính chất mà `analytics-queries.md` §Q2 ĐANG DỰA VÀO để chạy.
//
// GIỚI HẠN, nói rõ để không ai tin quá mức vào file này: nó khoá LUẬT phát sự kiện, không khoá được
// việc `Ftue.tsx` có thật sự gọi luật đó không. Xoá `track(...)` khỏi `Ftue.tsx` thì mọi bài dưới
// đây vẫn xanh. Bịt nốt khoảng đó cần dựng được component trong test (client chưa có
// jsdom/testing-library) hoặc một bài E2E chơi hết FTUE — mà smoke tầng 1 lại cố ý đặt sẵn
// `hexagon.ftue.done` để bỏ qua hướng dẫn. Thuộc tầng 2/3 của doc 36 §R2, không phải lát này.
import { describe, expect, it } from "vitest";
import { FtueFunnel, elapsedSeconds } from "../ftueFunnel";
import { FTUE_STEP_IDS } from "../ftueSteps";

const T0 = 1_700_000_000_000;
const at = (sec: number) => T0 + sec * 1000;

describe("FtueFunnel — mỗi bậc phát đúng một lần", () => {
  it("vào bước 1 phát `enter` với đúng bậc và tổng", () => {
    const f = new FtueFunnel(T0);
    expect(f.observe("move", at(2))).toEqual({
      step: "move", index: 1, total: 3, outcome: "enter", seconds: 2,
    });
  });

  it("gọi lại cùng một bước KHÔNG phát thêm — `onStats` chạy 24 lần/giây", () => {
    // Đây là bài quan trọng nhất của file. Nếu nó đỏ thì mẫu số của funnel là số FRAME chứ không
    // phải số người, và mọi tỉ lệ phần trăm trong §Q2 trở thành vô nghĩa.
    const f = new FtueFunnel(T0);
    expect(f.observe("move", at(1))).not.toBeNull();
    for (let i = 0; i < 240; i++) expect(f.observe("move", at(1 + i / 24))).toBeNull();
  });

  it("đi hết ba bậc rồi xong ⇒ đúng 4 sự kiện, theo đúng thứ tự", () => {
    const f = new FtueFunnel(T0);
    const out = [
      f.observe("move", at(1)),
      f.observe("claim", at(20)),
      f.observe("survive", at(45)),
      f.observe(null, at(70)),
    ];
    expect(out.map((e) => e?.step)).toEqual(["move", "claim", "survive", "done"]);
    expect(out.map((e) => e?.outcome)).toEqual(["enter", "enter", "enter", "complete"]);
    expect(out.map((e) => e?.index)).toEqual([1, 2, 3, FTUE_STEP_IDS.length]);
  });

  it("lùi bước rồi tiến lại KHÔNG phát lần hai", () => {
    // `currentFtueStep` đọc từ `signals` sống, mà `pct` tụt xuống được (bị cắt mất đất). Funnel đếm
    // "đã từng tới bậc này", nên một thiết bị chỉ góp một lần vào mỗi bậc.
    const f = new FtueFunnel(T0);
    f.observe("move", at(1));
    f.observe("claim", at(10));
    expect(f.observe("move", at(12))).toBeNull();
    expect(f.observe("claim", at(15))).toBeNull();
  });
});

describe("FtueFunnel — các rổ LOẠI TRỪ NHAU", () => {
  it("bỏ qua giữa chừng ⇒ `skipped` ghi đúng bậc đang đứng", () => {
    const f = new FtueFunnel(T0);
    f.observe("move", at(1));
    f.observe("claim", at(9));
    expect(f.skip("claim", at(30))).toEqual({
      step: "claim", index: 2, total: 3, outcome: "skipped", seconds: 30,
    });
  });

  it("đã phát `complete` rồi thì `skip` KHÔNG phát nữa", () => {
    // Nếu bài này đỏ, một thiết bị đếm được ở CẢ `xong` lẫn `bo_qua` trong §Q2 — hai cột đó không
    // còn cộng lại thành tổng nào có nghĩa. Nút "Bỏ qua" hiện đang bị ẩn ngay khi hiện lời khen,
    // nhưng đó là tính chất của CSS và thứ tự render, không phải của phép đo.
    const f = new FtueFunnel(T0);
    f.observe("move", at(1));
    expect(f.observe(null, at(50))?.outcome).toBe("complete");
    expect(f.skip(null, at(51))).toBeNull();
    expect(f.isClosed).toBe(true);
  });

  it("đã bỏ qua rồi thì mọi `observe` sau đó im lặng", () => {
    const f = new FtueFunnel(T0);
    f.observe("move", at(1));
    expect(f.skip("move", at(5))?.outcome).toBe("skipped");
    expect(f.observe("claim", at(6))).toBeNull();
    expect(f.observe(null, at(9))).toBeNull();
  });

  it("bỏ qua ngay bậc đầu vẫn được đếm — mẫu số phải chứa cả người rời sớm nhất", () => {
    const f = new FtueFunnel(T0);
    expect(f.observe("move", at(0))?.outcome).toBe("enter");
    expect(f.skip("move", at(3))?.outcome).toBe("skipped");
  });
});

describe("elapsedSeconds — `seconds` phải dùng được cho percentile", () => {
  it("làm tròn về giây", () => {
    expect(elapsedSeconds(T0, at(12.4))).toBe(12);
    expect(elapsedSeconds(T0, at(12.6))).toBe(13);
  });

  it("đồng hồ đi LÙI ⇒ 0, không phải số âm", () => {
    // `Date.now()` nhảy ngược được (đồng bộ NTP, người dùng chỉnh giờ, máy ngủ dậy). Số âm vẫn là
    // số hữu hạn nên `sanitizeProps` cho qua, rồi nó phá mọi phép trung bình ở phía truy vấn.
    expect(elapsedSeconds(T0, T0 - 5000)).toBe(0);
  });

  it("mốc hỏng ⇒ 0, không phải NaN", () => {
    // NaN bị `sanitizeProps` loại, nên trường `seconds` sẽ BIẾN MẤT khỏi sự kiện thay vì sai —
    // im lặng hơn nữa. Trả 0 giữ được cột, và 0 giây thì nhìn ra ngay là bất thường.
    expect(elapsedSeconds(Number.NaN, at(10))).toBe(0);
    expect(elapsedSeconds(T0, Number.NaN)).toBe(0);
  });
});
