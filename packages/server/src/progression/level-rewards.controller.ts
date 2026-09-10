import { Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/** Một mốc thưởng theo cấp. */
export interface LevelRewardMilestone {
  level: number;
  coin: number;
  energy: number;
}

/** Trạng thái thưởng cấp (khớp jsonb của RPC `read_level_rewards`). */
export interface LevelRewardStatus {
  level: number;
  total_xp: number;
  /** Mốc đã ĐẠT nhưng CHƯA nhận. Rỗng nghĩa là không còn gì để bấm. */
  pending: LevelRewardMilestone[];
  /** Mốc có thưởng gần nhất phía trước; null nếu đã qua hết. */
  next: (LevelRewardMilestone & { xp_required: number }) | null;
}

/** Kết quả một lượt nhận (khớp jsonb của RPC `claim_level_rewards`). */
export interface LevelRewardClaimResult {
  claimed_levels: number[];
  coin: number;
  energy: number;
  level: number;
}

/**
 * doc 35 §B4 — thưởng khi đạt mốc cấp độ.
 *
 * ┌─ NHẬN TẤT MỘT LƯỢT, KHÔNG PHẢI TỪNG CẤP MỘT ──────────────────────────────────────────────┐
 * │ Client KHÔNG gửi `level`. Người chơi quay lại sau một thời gian dài có thể lên 6 cấp trong  │
 * │ một phiên, và bắt họ bấm 6 lần là tự tay làm hỏng đúng cái khoảnh khắc mà tính năng này     │
 * │ sinh ra để tạo.                                                                             │
 * │ Quan trọng hơn: nhận `level` từ client là mở đường tự chọn mốc. Server đọc cấp từ            │
 * │ `player_progression` và tự quét mốc chưa nhận — client không có tiếng nói nào ở đây.        │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ĐỌC và NHẬN tách hai endpoint, cùng lý do với điểm danh (b2): một endpoint đọc mà có tác dụng
 * phụ sẽ phát tiền mỗi lần client mở màn hình.
 */
@Controller("v1")
export class LevelRewardsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  /** Mốc đã đạt chưa nhận + mốc kế tiếp. Không cấp gì. */
  @Get("level-rewards") async status(@Req() req: Request): Promise<LevelRewardStatus> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<LevelRewardStatus>("read_level_rewards", { p_player_id: player.id });
  }

  /**
   * Nhận MỌI mốc đã đạt mà chưa nhận. Gọi lại khi không còn gì trả `claimed_levels: []` —
   * không phải lỗi, và client không cần phân biệt.
   */
  @Post("level-rewards/claim") async claim(@Req() req: Request): Promise<LevelRewardClaimResult> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<LevelRewardClaimResult>("claim_level_rewards", { p_player_id: player.id });
  }
}
