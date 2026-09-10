import { BadRequestException, Controller, Get, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/** Một nhiệm vụ kèm tiến độ của người chơi (khớp jsonb của RPC `read_quests`). */
export interface QuestRow {
  id: string;
  period: "daily" | "weekly";
  goal_kind: string;
  goal_value: number;
  coin: number;
  energy: number;
  label: string;
  period_key: string;
  progress: number;
  claimed: boolean;
  completed: boolean;
}

/** Kết quả nhận thưởng (khớp jsonb của RPC `claim_quest_reward`). */
export interface QuestClaimResult {
  ok: boolean;
  reason?: "quest_not_found" | "no_progress" | "not_completed" | "already_claimed";
  quest_id?: string;
  coin?: number;
  energy?: number;
  progress?: number;
  goal_value?: number;
}

/**
 * doc 35 §B3 — nhiệm vụ ngày/tuần.
 *
 * ┌─ KHÔNG CÓ ĐƯỜNG NÀO CHO CLIENT BÁO TIẾN ĐỘ ───────────────────────────────────────────────┐
 * │ Controller này chỉ có ĐỌC và NHẬN. Tiến độ được cộng bên trong `record_match_result` và     │
 * │ `complete_campaign_level` — hai chỗ mà server đã tự biết chuyện gì xảy ra.                   │
 * │ Thêm một endpoint kiểu `POST quests/progress` là mở lại đúng lỗ hổng mà A3 vừa bịt: nhiệm   │
 * │ vụ cấp coin, nên nhiệm vụ không được tin client.                                            │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Controller("v1")
export class QuestsController {
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  /** Danh sách nhiệm vụ đang bật kèm tiến độ của chu kỳ hiện tại. Không cấp gì. */
  @Get("quests") async list(@Req() req: Request): Promise<{ quests: QuestRow[] }> {
    const player = await this.sessions.resolve(req);
    const quests = await this.db.rpc<QuestRow[]>("read_quests", { p_player_id: player.id });
    return { quests: quests ?? [] };
  }

  /**
   * Nhận thưởng một nhiệm vụ đã hoàn thành.
   *
   * Trả `ok: false` kèm `reason` thay vì ném lỗi HTTP cho các trường hợp NGHIỆP VỤ (chưa đủ
   * tiến độ, đã nhận rồi). Đó không phải sự cố — người chơi bấm hai lần hoặc mạng chậm là
   * chuyện thường, và một màn hình lỗi đỏ cho hành động hợp lệ chỉ làm họ mất tin.
   */
  @Post("quests/:id/claim") async claim(
    @Req() req: Request,
    @Param("id") id: string,
  ): Promise<QuestClaimResult> {
    const player = await this.sessions.resolve(req);
    // Chặn ở đây chứ không để RPC nhận chuỗi rỗng: một `id` rỗng sẽ tra bảng và trả
    // `quest_not_found`, đúng nhưng che mất chuyện client đang gọi sai đường.
    if (!id?.trim()) throw new BadRequestException("missing_quest_id");
    return this.db.rpc<QuestClaimResult>("claim_quest_reward", {
      p_player_id: player.id,
      p_quest_id: id,
    });
  }
}
