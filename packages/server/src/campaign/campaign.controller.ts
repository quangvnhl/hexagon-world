import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { isUnlockedIn, type CampaignLevel } from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

interface ProgressRow { level_id: string; status: string; stars: number; best_score: number; completed_at: string }
interface LevelRow { id: string; sort_order: number; name: string; config: unknown; powerups: string[]; unlock_requires: string | null; rewards: { coin: number; xp: number; energy: number } }

/** Map hàng DB `campaign_levels` → `CampaignLevel` (đúng type shared, client dùng thẳng). */
function toLevel(r: LevelRow): CampaignLevel {
  return {
    id: r.id, order: r.sort_order, name: r.name,
    config: (r.config ?? {}) as CampaignLevel["config"],
    powerups: (r.powerups ?? []) as CampaignLevel["powerups"],
    unlock: { requires: r.unlock_requires },
    rewards: r.rewards,
  };
}

@Controller("v1")
export class CampaignController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  /** Danh sách cấp ĐÃ PUBLISH (nguồn Supabase — doc 29 L2). Public, không cần session. */
  @Get("campaign/levels") async levels(): Promise<{ levels: CampaignLevel[] }> {
    return { levels: await this.publishedLevels() };
  }

  /** Tiến độ các cấp của người chơi. Client tô khóa/sao + tự tính mở khóa bằng `isUnlockedIn`. */
  @Get("campaign/progress") async progress(@Req() req: Request): Promise<{ progress: ProgressRow[] }> {
    const player = await this.sessions.resolve(req);
    const { data, error } = await this.db.from("player_level_progress")
      .select("level_id,status,stars,best_score,completed_at").eq("player_id", player.id);
    if (error) throw new BadRequestException(error.message);
    return { progress: (data ?? []) as ProgressRow[] };
  }

  /** Bắt đầu cấp: kiểm MỞ KHÓA (cấp DB + progress) → trừ 1 năng lượng + tạo play (RPC). */
  @Post("campaign/start") async start(@Req() req: Request, @Body() body: { levelId?: string; idempotencyKey?: string }) {
    const player = await this.sessions.resolve(req);
    if (!body.levelId || !body.idempotencyKey) throw new BadRequestException("missing_start_fields");

    const levels = await this.publishedLevels();
    if (!levels.some((l) => l.id === body.levelId)) throw new BadRequestException("unknown_level");

    const cleared = await this.clearedSet(player.id);
    if (!isUnlockedIn(levels, body.levelId, cleared)) throw new ForbiddenException("level_locked");

    return this.db.rpc("start_campaign_level", {
      p_player_id: player.id, p_level_id: body.levelId, p_idempotency_key: body.idempotencyKey,
    });
  }

  /** Hoàn tất cấp: xác minh play thuộc người chơi + đạt objective → mở khóa + thưởng (từ DB cấp). */
  @Post("campaign/complete") async complete(@Req() req: Request, @Body() body: { playId?: string; objectiveMet?: boolean; stars?: number; score?: number }) {
    const player = await this.sessions.resolve(req);
    if (!body.playId) throw new BadRequestException("missing_play_id");
    if (body.objectiveMet !== true) throw new BadRequestException("objective_not_met");

    const { data: play, error } = await this.db.from("campaign_plays")
      .select("id,level_id,completed_at").eq("id", body.playId).eq("player_id", player.id).single();
    if (error || !play) throw new BadRequestException("play_not_found");

    const { data: level } = await this.db.from("campaign_levels")
      .select("rewards").eq("id", (play as { level_id: string }).level_id).single();
    if (!level) throw new BadRequestException("unknown_level");

    return this.db.rpc("complete_campaign_level", {
      p_play_id: body.playId,
      p_player_id: player.id,
      p_stars: Math.max(0, Math.min(3, Math.floor(body.stars ?? 1))),
      p_score: Math.max(0, Math.floor(body.score ?? 0)),
      p_rewards: (level as { rewards: unknown }).rewards,
    });
  }

  private async publishedLevels(): Promise<CampaignLevel[]> {
    const { data, error } = await this.db.from("campaign_levels")
      .select("id,sort_order,name,config,powerups,unlock_requires,rewards").eq("published", true).order("sort_order");
    if (error) throw new BadRequestException(error.message);
    return ((data ?? []) as LevelRow[]).map(toLevel);
  }

  private async clearedSet(playerId: string): Promise<Set<string>> {
    const { data } = await this.db.from("player_level_progress").select("level_id").eq("player_id", playerId).eq("status", "cleared");
    return new Set((data ?? []).map((r) => (r as { level_id: string }).level_id));
  }
}
