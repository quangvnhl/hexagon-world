import { Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/** Một ngày trong vòng 7, đọc từ `daily_rewards_config`. */
export interface DailyRewardDay {
  cycle_day: number;
  coin: number;
  energy: number;
  label: string;
}

/** Trạng thái điểm danh (khớp jsonb của RPC `read_daily_reward`). */
export interface DailyRewardStatus {
  claimed_today: boolean;
  streak: number;
  /** Ngày trong vòng 7 mà lần nhận KẾ TIẾP sẽ rơi vào. */
  next_cycle_day: number;
  /** ISO mốc reset kế tiếp (00:00 UTC) — client đếm ngược tới đây. */
  next_reset_at: string;
  config: DailyRewardDay[];
}

/** Kết quả một lần điểm danh (khớp jsonb của RPC `claim_daily_reward`). */
export interface DailyClaimResult {
  already_claimed: boolean;
  streak: number;
  cycle_day: number;
  coin: number;
  energy: number;
  next_reset_at: string;
}

/**
 * doc 35 §B2 — điểm danh hằng ngày.
 *
 * ┌─ VÌ SAO HAI ENDPOINT CHỨ KHÔNG MỘT ───────────────────────────────────────────────────────┐
 * │ ĐỌC và NHẬN tách hẳn. Gộp lại thì mỗi lần client mở màn hình là một lần phát coin — và      │
 * │ client sẽ gọi lại khi người chơi quay lại tab, khi mạng chập chờn, khi React StrictMode     │
 * │ chạy effect hai lần. Một endpoint đọc mà có tác dụng phụ là cái bẫy không ai nhìn thấy.     │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG cần `Idempotency-Key` như đường mua năng lượng: khoá chính `(player_id, claim_date)` của
 * `player_daily_claims` đã LÀ khoá idempotency, và nó là khoá tự nhiên nên client không thể gửi
 * sai. Thêm một khoá thứ hai chỉ tạo thêm chỗ để lệch.
 */
@Controller("v1")
export class DailyController {
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  /** Trạng thái + cấu hình 7 ngày. Không cấp gì. */
  @Get("daily") async status(@Req() req: Request): Promise<DailyRewardStatus> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<DailyRewardStatus>("read_daily_reward", { p_player_id: player.id });
  }

  /**
   * Nhận thưởng hôm nay. Gọi lại trong cùng ngày UTC trả `already_claimed: true` với đúng con số
   * của lần nhận thật — client vẽ được cùng một màn hình mà không phải phân biệt hai đường.
   */
  @Post("daily/claim") async claim(@Req() req: Request): Promise<DailyClaimResult> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<DailyClaimResult>("claim_daily_reward", { p_player_id: player.id });
  }
}
