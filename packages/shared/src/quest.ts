/**
 * doc 35 §B3 — nhiệm vụ ngày/tuần. Phần THUẦN, dùng chung client và server.
 *
 * ┌─ KHOÁ CHU KỲ LÀ THỨ PHẢI KHỚP TUYỆT ĐỐI GIỮA BA NƠI ──────────────────────────────────────┐
 * │ Client hiển thị "còn 3 giờ nữa đổi nhiệm vụ", server cộng tiến độ vào một chu kỳ, và SQL   │
 * │ lưu tiến độ theo một khoá. Lệch một chút thôi thì người chơi làm xong nhiệm vụ mà tiến độ  │
 * │ rơi vào chu kỳ khác — và không có gì đỏ lên, chỉ có một người chơi tưởng mình bị ăn gian.  │
 * │                                                                                            │
 * │ Nên khoá tuần ở đây phải khớp ĐÚNG `to_char(..., 'IYYY-"W"IW')` của Postgres. Đó là một     │
 * │ khẳng định kiểm được, và nó ĐƯỢC kiểm — bằng cách đối chiếu trực tiếp với database.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */
import { utcDayKey } from "./daily-reward";

export type QuestPeriod = "daily" | "weekly";

/** Loại mục tiêu khởi điểm (doc 35 §B3). Thêm loại mới phải sửa union ⇒ typecheck bắt được. */
export type QuestGoalKind =
  | "match_play"
  | "match_win"
  | "territory_capture"
  | "campaign_complete"
  | "ad_watch";

export interface QuestDefinition {
  id: string;
  period: QuestPeriod;
  goal_kind: QuestGoalKind;
  goal_value: number;
  coin: number;
  energy: number;
  label: string;
}

export interface QuestProgress {
  quest_id: string;
  progress: number;
  claimed: boolean;
}

/**
 * Khoá tuần ISO theo UTC, dạng `IYYY-Www` — ví dụ `2026-W37`.
 *
 * Dùng tuần ISO chứ không phải "7 ngày kể từ lúc nào đó": tuần ISO luôn bắt đầu thứ Hai và luôn
 * có đúng 52 hoặc 53 tuần trong năm, nên hai người ở hai thời điểm khác nhau vẫn tính ra cùng
 * một khoá. Một cửa sổ trượt thì phụ thuộc mốc bắt đầu, và mốc đó sẽ khác nhau giữa client và
 * server ngay ở lần đầu tiên có ai đó khởi động lại tiến trình.
 *
 * NĂM ISO KHÁC năm dương lịch ở vài ngày quanh giao thừa: 2027-01-01 thuộc tuần 53 của năm ISO
 * 2026. Lấy `getUTCFullYear()` ở đây là sai đúng vào tuần mà người chơi hay chơi nhất.
 */
export function utcIsoWeekKey(atMs: number): string {
  const d = new Date(atMs);
  // Chuẩn ISO: thứ Hai = 0. `getUTCDay()` trả Chủ nhật = 0 nên phải xoay.
  const thuTrongTuan = (d.getUTCDay() + 6) % 7;
  // Nhảy tới thứ Năm của chính tuần đó — thứ Năm quyết định NĂM ISO của cả tuần.
  const thuNam = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  thuNam.setUTCDate(thuNam.getUTCDate() - thuTrongTuan + 3);
  const namIso = thuNam.getUTCFullYear();
  const thuNamTuanMot = new Date(Date.UTC(namIso, 0, 4));
  const lechNgayTuanMot = (thuNamTuanMot.getUTCDay() + 6) % 7;
  thuNamTuanMot.setUTCDate(thuNamTuanMot.getUTCDate() - lechNgayTuanMot + 3);
  const tuan = 1 + Math.round((thuNam.getTime() - thuNamTuanMot.getTime()) / (7 * 86_400_000));
  return `${namIso}-W${String(tuan).padStart(2, "0")}`;
}

/** Khoá chu kỳ hiện tại của một loại nhiệm vụ. */
export function questPeriodKey(period: QuestPeriod, atMs: number): string {
  return period === "weekly" ? utcIsoWeekKey(atMs) : utcDayKey(atMs);
}

/** Mili giây còn lại tới khi chu kỳ đó đổi. Client dùng để đếm ngược. */
export function msToPeriodEnd(period: QuestPeriod, atMs: number): number {
  const MS_NGAY = 86_400_000;
  const conLaiTrongNgay = MS_NGAY - (((atMs % MS_NGAY) + MS_NGAY) % MS_NGAY);
  if (period === "daily") return conLaiTrongNgay;
  // Tuần ISO kết thúc cuối Chủ nhật UTC. Số ngày TRỌN còn lại sau hôm nay, cộng phần còn của hôm nay.
  const thuTrongTuan = (new Date(atMs).getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return conLaiTrongNgay + (6 - thuTrongTuan) * MS_NGAY;
}

/** Đã đạt mục tiêu chưa. Tách ra vì client và server phải trả lời giống hệt nhau. */
export function questCompleted(progress: number, goalValue: number): boolean {
  return progress >= goalValue;
}
