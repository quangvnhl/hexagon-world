// Luật vượt bước FTUE (doc 35 §D1). Đây là chỗ FTUE có thể hỏng ÂM THẦM: một bước không bao giờ
// đạt thì người mới kẹt vĩnh viễn, mà không có lỗi nào nổ ra để ai biết.
import { describe, expect, it } from "vitest";
import {
  CLAIM_EPSILON_PCT,
  currentFtueStep,
  FTUE_STEPS,
  FTUE_STEP_IDS,
  ftueStepCopy,
  ftueStepIndex,
  type FtueSignals,
} from "../ftueSteps";

const TH = { claims: 2, targetPct: 0.3 };
/** % đất sinh ra sẵn quanh chỗ xuất phát — số ĐO ĐƯỢC từ `packages/shared/dist`, không bịa. */
const SPAWN_PCT = 0.04;
const at = (o: Partial<FtueSignals>): FtueSignals => ({
  steered: true,
  pct: SPAWN_PCT,
  startPct: SPAWN_PCT,
  claims: 0,
  ...o,
});

describe("currentFtueStep", () => {
  it("chưa lái lần nào ⇒ đang ở bước 1", () => {
    expect(currentFtueStep(at({ steered: false }), TH)).toBe("move");
  });

  it("đã lái nhưng chưa khép được vòng nào ⇒ bước 2, KHÔNG tự nhảy", () => {
    // Bất biến quan trọng nhất của cả file: bước 2 chỉ vượt khi người chơi THẬT SỰ khép được một
    // vòng. Nếu nó vượt theo thời gian thì con số "hoàn thành FTUE ≥ 70%" (doc 35 §8) sẽ đo thời
    // gian chờ chứ không đo việc học được.
    expect(currentFtueStep(at({ pct: SPAWN_PCT }), TH)).toBe("claim");
  });

  it("bước 2 so với đất LÚC SINH RA, không so với 0", () => {
    // Nếu luật là `pct > 0` thì bước 2 tự vượt ngay khi vào ván, vì ai cũng có sẵn một mẩu đất.
    expect(currentFtueStep(at({ pct: 0.04, startPct: 0.04, claims: 0 }), TH)).toBe("claim");
    expect(currentFtueStep(at({ pct: 0.12, startPct: 0.04, claims: 1 }), TH)).toBe("survive");
  });

  it("nhích đúng bằng sai số làm tròn thì CHƯA tính là đã chiếm đất", () => {
    expect(currentFtueStep(at({ pct: SPAWN_PCT + CLAIM_EPSILON_PCT, claims: 1 }), TH)).toBe("claim");
    expect(currentFtueStep(at({ pct: SPAWN_PCT + CLAIM_EPSILON_PCT * 2, claims: 1 }), TH)).toBe("survive");
  });

  it("MỘT vòng lớn KHÔNG được vượt luôn cả bước 2 lẫn bước 3", () => {
    // Đây là lỗi mà bản nháp đầu mắc phải, và chỉ lộ ra khi chạy engine thật: vòng khép đầu tiên
    // đo được là 0.55–2.7%, tức luôn vượt xa mốc 0.3% — nên nếu bước 3 chỉ nhìn `pct` thì nó
    // không bao giờ hiện ra và câu cảnh báo "đừng cắt vào đuôi mình" không bao giờ được nói.
    expect(currentFtueStep(at({ pct: 2.7, claims: 1 }), TH)).toBe("survive");
    expect(currentFtueStep(at({ pct: 2.7, claims: 2 }), TH)).toBe(null);
  });

  it("hai vòng nhưng tổng đất vẫn dưới SÀN % ⇒ vẫn ở bước 3", () => {
    expect(currentFtueStep(at({ pct: 0.2, claims: 3 }), TH)).toBe("survive");
  });

  it("chết mất sạch đất ⇒ TỤT lại bước 2, không kẹt ở bước 3", () => {
    // Chết đưa `pct` về ~0. Luật tính-lại-mỗi-lần phải nói "đi chiếm đất lại đi", chứ không đứng
    // nguyên ở bước 3 với hướng dẫn vô nghĩa — dù `claims` đã đếm được vài lần trước đó.
    expect(currentFtueStep(at({ pct: 0, claims: 2 }), TH)).toBe("claim");
  });

  it("ngưỡng đọc từ tham số ⇒ chỉnh bằng remote config được, không cần deploy", () => {
    expect(currentFtueStep(at({ pct: 0.2, claims: 1 }), { claims: 1, targetPct: 0.1 })).toBe(null);
    expect(currentFtueStep(at({ pct: 0.2, claims: 1 }), { claims: 1, targetPct: 5 })).toBe("survive");
    expect(currentFtueStep(at({ pct: 9, claims: 2 }), { claims: 4, targetPct: 0.1 })).toBe("survive");
  });

  it("ngưỡng nới hết cỡ vẫn phải đi qua bước 1 và 2 — không cho nhảy cóc cả hướng dẫn", () => {
    const loose = { claims: 0, targetPct: 0 };
    expect(currentFtueStep(at({ steered: false, pct: 99, claims: 9 }), loose)).toBe("move");
    expect(currentFtueStep(at({ pct: SPAWN_PCT, claims: 0 }), loose)).toBe("claim");
  });
});

describe("nội dung bước", () => {
  it("mỗi id trong danh sách đều có nội dung — không có bước hiện ra trống", () => {
    for (const id of FTUE_STEP_IDS) {
      const copy = ftueStepCopy(id);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.hint.length).toBeGreaterThan(0);
      expect(copy.done.length).toBeGreaterThan(0);
    }
    expect(FTUE_STEPS).toHaveLength(FTUE_STEP_IDS.length);
  });

  it("ftueStepIndex là 1-based và khớp thứ tự hiển thị", () => {
    expect(ftueStepIndex("move")).toBe(1);
    expect(ftueStepIndex("claim")).toBe(2);
    expect(ftueStepIndex("survive")).toBe(3);
  });
});
