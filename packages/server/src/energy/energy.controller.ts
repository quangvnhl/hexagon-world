import { BadRequestException, Body, Controller, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";
import { ServerAnalyticsService } from "../analytics/server-analytics.service";

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
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
    private readonly analytics: ServerAnalyticsService,
  ) {}

  /** Đọc năng lượng hiện tại (server tính hồi lười). Client hiển thị thanh + đếm ngược `next_at`. */
  @Get("energy") async energy(@Req() req: Request): Promise<EnergyStatus> {
    const player = await this.sessions.resolve(req);
    return this.db.rpc<EnergyStatus>("read_energy", { p_player_id: player.id });
  }

  /** Mua 1 gói năng lượng bằng coin (idempotent). Server đọc giá từ energy_rules. */
  @Post("energy/purchase") async purchase(@Req() req: Request, @Body() body: { idempotencyKey?: string }): Promise<EnergyStatus> {
    const player = await this.sessions.resolve(req);
    if (!body.idempotencyKey) throw new BadRequestException("missing_idempotency_key");
    const before = await this.db.rpc<EnergyStatus>("read_energy", { p_player_id: player.id });
    const after = await this.db.rpc<EnergyStatus>("purchase_energy_with_coin", {
      p_player_id: player.id,
      p_idempotency_key: body.idempotencyKey,
    });

    // doc 35 §A1.4 — năng lượng ĐI VÀO ví, đổi bằng coin. Số điểm thật sự được cộng tính bằng
    // HIỆU hai lần đọc của server, không lấy `refill_energy_amount` trong cấu hình: gọi lại cùng
    // khoá idempotency thì RPC không cộng gì, và hiệu bằng 0 nói đúng điều đó. Lấy số cấu hình sẽ
    // báo cáo một lần nạp không hề xảy ra.
    const granted = Math.max(0, Number(after?.current ?? 0) - Number(before?.current ?? 0));
    void this.analytics.emit({
      name: "energy_grant",
      dedupe: [player.id, body.idempotencyKey],
      playerId: player.id,
      props: {
        reason: "coin_purchase",
        amount: granted,
        coin_cost: Number(after?.refill_coin_cost ?? 0),
        energy_after: Number(after?.current ?? 0),
      },
    });
    return after;
  }
}
