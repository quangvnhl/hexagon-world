// FTUE — 90 giây đầu (doc 35 §D1). Phần THUẦN: nội dung 3 bước + luật "đạt" của từng bước.
//
// Vì sao tách khỏi `Ftue.tsx`: luật vượt bước là thứ duy nhất trong FTUE có thể SAI một cách âm
// thầm (bước không bao giờ đạt ⇒ người mới kẹt vĩnh viễn, và không ai biết cho tới lúc đọc số
// `ftue_step`). Tách ra thì test được bằng dữ liệu, không phải bằng mắt.
//
// NỘI DUNG 3 BƯỚC ĐƯỢC CHỐT BẰNG ĐO, KHÔNG BẰNG CẢM TÍNH (doc 35 §10 cho phép tự chốt).
// Mô phỏng 9 kiểu lái "người mới lóng ngóng" trong 90 giây trên `packages/shared/dist`:
//
//   số bot | chiếm được đất | chạm 0.3% | có ván chết
//   -------+----------------+-----------+------------
//        1 |      4/9       |    3/9    |    5/9      ← quá nửa số kiểu lái CHẾT trong 90 giây
//        3 |      3/8       |    2/8    |    5/8
//       24 |      0/2       |    0/2    |    2/2      ← xoá sổ
//        0 |      5/9       |    4/9    |    2/9
//
// Hai kết luận, và cả hai đều trái với dự đoán ban đầu:
//
//  1. **Sân FTUE phải KHÔNG có bot.** Chỉ cần 1 bot là hơn nửa số kiểu lái chết trước 90 giây.
//     Một hướng dẫn mà người học bị xoá sổ giữa chừng thì không dạy được gì.
//  2. **Thứ giết người mới không phải bot, mà là ĐUÔI CỦA CHÍNH HỌ.** Ở sân 0 bot vẫn còn 2/9
//     kiểu lái chết, và `deathCause` của cả hai đều là `"self"` (cắt vào đuôi mình). Nên bước 3
//     dạy đúng chuyện đó, thay vì "hạ 1 bot" như bản nháp của doc 35 — sân không có bot để hạ.
//
//  3. **Bước 3 KHÔNG được là một mốc % đơn thuần.** Bản nháp đầu đặt bước 3 = "đạt 0.3% đất", và
//     đo ra là 3/4 kiểu lái nhảy thẳng từ 0.042% lên 0.55–2.7% **trong đúng một nhịp**: vòng khép
//     đầu tiên bao giờ cũng to hơn mốc đó rất nhiều. Nghĩa là bước 3 gần như không bao giờ hiện
//     ra — hướng dẫn 3 bước trên giấy, 2 bước trên máy, và bài học đắt nhất (đừng cắt vào đuôi
//     mình) không bao giờ được nói. Nên bước 3 đòi **khép vòng lần thứ hai**: không có cách nào
//     làm xong nó cùng lúc với bước 2.
//
// Mốc % vẫn giữ làm SÀN cho trường hợp hai vòng đều tí xíu. Cả hai ngưỡng đọc từ remote config
// (`ftue.step3_claims`, `ftue.step3_target_pct`) — doc 35 §10 dặn chốt số khởi điểm rồi chỉnh
// bằng dữ liệu thật, không chôn hằng số vào build.

/** Id bước — cũng chính là giá trị `step` gửi lên trong sự kiện `ftue_step` (doc 35 §A1). */
export type FtueStepId = "move" | "claim" | "survive";

export const FTUE_STEP_IDS: readonly FtueStepId[] = ["move", "claim", "survive"];

export interface FtueStepCopy {
  id: FtueStepId;
  /** Việc cần làm — câu mệnh lệnh ngắn, đọc trong 1 giây. */
  title: string;
  /** Vì sao/làm thế nào — một câu, chỉ hiện khi bước đang mở. */
  hint: string;
  /** Câu khen khi vượt bước. */
  done: string;
}

export const FTUE_STEPS: readonly FtueStepCopy[] = [
  {
    id: "move",
    title: "Kéo trên màn hình để lái",
    hint: "Bạn chạy liên tục, không dừng lại được — chỉ đổi được hướng.",
    done: "Đúng rồi!",
  },
  {
    id: "claim",
    title: "Đi một vòng rồi quay về đất của mình",
    hint: "Khép kín vòng thì toàn bộ phần bên trong thành đất của bạn.",
    done: "Bạn vừa chiếm được đất!",
  },
  {
    id: "survive",
    title: "Chiếm thêm đất, đừng cắt vào đuôi mình",
    hint: "Chạm phải chính đuôi của mình là mất hết — đây là cách thua phổ biến nhất.",
    done: "Xong! Bạn đã biết chơi.",
  },
];

/** Ngưỡng "đạt" — đến từ remote config để chỉnh được mà không cần deploy (doc 35 §A2). */
export interface FtueThresholds {
  /** Số lần khép vòng chiếm đất cần có để vượt bước 3. */
  claims: number;
  /** SÀN % lãnh thổ cho bước 3 — chặn trường hợp hai vòng đều bé xíu. */
  targetPct: number;
}

/** Dữ kiện thô đọc được từ ván đang chạy. Không có thời gian ⇒ luật vượt bước là TẤT ĐỊNH. */
export interface FtueSignals {
  /** Người chơi đã ra lệnh lái ít nhất một lần chưa. */
  steered: boolean;
  /** % lãnh thổ hiện tại. */
  pct: number;
  /** % lãnh thổ lúc ván bắt đầu (đất sinh ra sẵn ở chỗ hồi sinh — KHÔNG tính là "đã chiếm"). */
  startPct: number;
  /** Số lần đã khép vòng và chiếm được THÊM đất trong ván này. */
  claims: number;
}

/**
 * Bước đang mở, tính từ dữ kiện. Trả về `null` nghĩa là **xong cả ba**.
 *
 * Cố ý viết dạng "tính lại từ đầu mỗi lần" thay vì máy trạng thái tăng dần: một ván có thể bị
 * tua lại (hồi sinh, thoát rồi vào lại) và một máy trạng thái nhớ sẽ kẹt ở bước cũ. Hàm thuần
 * thì trạng thái hiển thị luôn khớp với thứ đang thật sự diễn ra trên sân.
 *
 * Bước 2 và 3 KHÔNG tự đạt theo thời gian: nếu người chơi không bao giờ khép được vòng thì
 * bước 2 ở nguyên đó. Đó là chủ ý — số `ftue_step` phải phản ánh người chơi có làm được thật
 * không, chứ không phải họ đã chờ đủ lâu chưa.
 */
export function currentFtueStep(signals: FtueSignals, thresholds: FtueThresholds): FtueStepId | null {
  if (!signals.steered) return "move";
  // "Đã chiếm được đất" = khép được ít nhất một vòng có lời. Kiểm CẢ `claims` lẫn `pct` vì hai
  // dữ kiện này đến từ hai đường khác nhau: `claims` đếm sự KIỆN, `pct` là trạng thái hiện tại.
  // Chết xong `pct` tụt về ~0 nhưng `claims` vẫn giữ ⇒ phải nói "đi chiếm lại đi", nên `pct`
  // mới là điều kiện quyết định ở đây.
  if (signals.claims < 1 || !(signals.pct > signals.startPct + CLAIM_EPSILON_PCT)) return "claim";
  if (signals.claims < thresholds.claims || !(signals.pct >= thresholds.targetPct)) return "survive";
  return null;
}

/**
 * Sai số tối thiểu để coi là "đã chiếm thêm đất". Đặt lớn hơn 0 vì `territoryPct()` là số thực:
 * một ô lẻ do làm tròn không nên được tính là người chơi đã hiểu cách khép vòng.
 */
export const CLAIM_EPSILON_PCT = 0.005;

/** Số thứ tự (1-based) của một bước — để hiện "Bước 2/3" và gửi kèm sự kiện đo. */
export function ftueStepIndex(id: FtueStepId): number {
  return FTUE_STEP_IDS.indexOf(id) + 1;
}

export function ftueStepCopy(id: FtueStepId): FtueStepCopy {
  const found = FTUE_STEPS.find((s) => s.id === id);
  // Không thể xảy ra vì `FtueStepId` là union đóng; ném ra thay vì trả bừa để test bắt được
  // ngay nếu ai đó thêm id mới mà quên viết nội dung.
  if (!found) throw new Error(`Thiếu nội dung cho bước FTUE: ${id}`);
  return found;
}
