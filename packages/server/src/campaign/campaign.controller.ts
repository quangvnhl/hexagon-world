import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { isUnlocked, levelById } from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

interface ProgressRow { level_id: string; status: string; stars: number; best_score: number; completed_at: string }

@Controller("v1")
export class CampaignController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  /** Tiến độ các cấp của người chơi. Client tô khóa/sao + tự tính mở khóa bằng `isUnlocked`. */
  @Get("campaign/progress") async progress(@Req() req: Request): Promise<{ progress: ProgressRow[] }> {
    const player = await this.sessions.resolve(req);
    const { data, error } = await this.db.from("player_level_progress")
      .select("level_id,status,stars,best_score,completed_at").eq("player_id", player.id);
    if (error) throw new BadRequestException(error.message);
    return { progress: (data ?? []) as ProgressRow[] };
  }

  /** Bắt đầu cấp: kiểm MỞ KHÓA (catalog shared + progress) → trừ 1 năng lượng + tạo play (RPC). */
  @Post("campaign/start") async start(@Req() req: Request, @Body() body: { levelId?: string; idempotencyKey?: string }) {
    const player = await this.sessions.resolve(req);
    if (!body.levelId || !body.idempotencyKey) throw new BadRequestException("missing_start_fields");
    if (!levelById(body.levelId)) throw new BadRequestException("unknown_level");

    const cleared = await this.clearedSet(player.id);
    if (!isUnlocked(body.levelId, cleared)) throw new ForbiddenException("level_locked");

    return this.db.rpc("start_campaign_level", {
      p_player_id: player.id,
      p_level_id: body.levelId,
      p_idempotency_key: body.idempotencyKey,
    });
  }

  /** Hoàn tất cấp: xác minh play thuộc người chơi + đạt objective → mở khóa + thưởng (từ catalog). */
  @Post("campaign/complete") async complete(@Req() req: Request, @Body() body: { playId?: string; objectiveMet?: boolean; stars?: number; score?: number }) {
    const player = await this.sessions.resolve(req);
    if (!body.playId) throw new BadRequestException("missing_play_id");
    if (body.objectiveMet !== true) throw new BadRequestException("objective_not_met");

    const { data: play, error } = await this.db.from("campaign_plays")
      .select("id,level_id,completed_at").eq("id", body.playId).eq("player_id", player.id).single();
    if (error || !play) throw new BadRequestException("play_not_found");

    const level = levelById((play as { level_id: string }).level_id);
    if (!level) throw new BadRequestException("unknown_level");

    return this.db.rpc("complete_campaign_level", {
      p_play_id: body.playId,
      p_player_id: player.id,
      p_stars: Math.max(0, Math.min(3, Math.floor(body.stars ?? 1))),
      p_score: Math.max(0, Math.floor(body.score ?? 0)),
      p_rewards: level.rewards,
    });
  }

  private async clearedSet(playerId: string): Promise<Set<string>> {
    const { data } = await this.db.from("player_level_progress").select("level_id").eq("player_id", playerId);
    return new Set((data ?? []).map((r) => (r as { level_id: string }).level_id));
  }
}
