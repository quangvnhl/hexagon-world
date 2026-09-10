/**
 * doc 35 §A5 — bảng xếp hạng. Phần THUẦN, dùng chung client và server.
 *
 * ┌─ MỘT DANH SÁCH TÊN, KHÔNG PHẢI HAI ────────────────────────────────────────────────────────┐
 * │ Server whitelist `scope` để một tham số gõ sai không âm thầm trả về bảng rỗng; client dựng  │
 * │ tab từ cùng danh sách đó. Nếu mỗi bên giữ một bản sao thì thêm một scope mới sẽ chạy được   │
 * │ ở một bên và im lặng hỏng ở bên kia. Thêm tên phải sửa union ⇒ typecheck bắt được.          │
 * └───────────────────────────────────────────────────────────────────────────────────────────┘
 */
import type { QuestPeriod } from "./quest";

export type LeaderboardScope = "weekly_territory" | "weekly_wins" | "campaign_stars_total";

export const LEADERBOARD_SCOPES: readonly LeaderboardScope[] = [
  "weekly_territory",
  "weekly_wins",
  "campaign_stars_total",
];

export function isLeaderboardScope(v: unknown): v is LeaderboardScope {
  return typeof v === "string" && (LEADERBOARD_SCOPES as readonly string[]).includes(v);
}

/**
 * Bảng nào đổi theo tuần, bảng nào cộng dồn mãi.
 *
 * Trả về `QuestPeriod` chứ không phải một union riêng: bảng tuần và nhiệm vụ tuần dùng CHUNG khoá
 * kỳ (`quest_period_key('weekly')` trong SQL), nên chúng cũng phải dùng chung phép đếm ngược —
 * hai đồng hồ cho cùng một mốc reset là hai cơ hội để nói dối người chơi.
 */
export function leaderboardPeriod(scope: LeaderboardScope): QuestPeriod | "all" {
  return scope.startsWith("weekly_") ? "weekly" : "all";
}
