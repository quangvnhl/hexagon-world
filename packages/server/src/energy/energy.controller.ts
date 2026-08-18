import { BadRequestException, Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/** Trạng thái năng lượng trả cho client (khớp jsonb của RPC `read_energy`). */
export interface EnergyStatus {
  current: number;
  max: number;
  regen_interval_seconds: number;
  /** ISO thời điểm điểm năng lượng kế xuất hiện; null nếu đã đầy. */
  next_at: string | null;
  /** Giá coin của 1 gói nạp năng lượng + số điểm mỗi gói (cho nút Mua). */
  refill_coin_cost: number;
  refill_energy_amount: number;
}

@Controller("v1")
export class EnergyController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  /** Đọc năng lượng hiện tại (server tính hồi lười). Client hiển thị thanh + đếm ngược `next_at`. */
  @Get("energy") async energy(@Req() req: Request): Promise<EnergyStatus> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<EnergyStatus>("read_energy", { p_player_id: player.id });
  }

  /** Mua 1 gói năng lượng bằng coin (idempotent). Server đọc giá từ energy_rules. */
  @Post("energy/purchase") async purchase(@Req() req: Request, @Body() body: { idempotencyKey?: string }): Promise<EnergyStatus> {
    const player = await this.sessions.resolve(req);
    if (!body.idempotencyKey) throw new BadRequestException("missing_idempotency_key");
    return this.db.rpc<EnergyStatus>("purchase_energy_with_coin", {
      p_player_id: player.id,
      p_idempotency_key: body.idempotencyKey,
    });
  }
}
