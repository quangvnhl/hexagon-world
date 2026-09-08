import { BadRequestException, Body, Controller, Delete, Get, Patch, Req } from "@nestjs/common";
import type { Request } from "express";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/**
 * Số ngày giữ tài khoản ở trạng thái đã xoá trước khi `purge_deleted_players()` xoá hẳn.
 *
 * PHẢI khớp `LEGAL.deletionGraceDays` (trang `/privacy` in con số này ra cho người dùng đọc) và
 * mặc định của `purge_deleted_players(p_grace_days integer default 30)`. Có test khoá cả ba lại.
 */
export const DELETION_GRACE_DAYS = 30;

@Controller("v1")
export class PlayersController {
  constructor(private readonly sessions: SessionService, private readonly db: SupabaseService) {}

  @Get("me") async me(@Req() req: Request) {
    const player = await this.sessions.resolve(req);
    const [profile, stats, progression, wallets, inventory, loadout] = await Promise.all([
      this.db.from("player_profiles").select("*").eq("player_id", player.id).single(),
      this.db.from("player_stats").select("*").eq("player_id", player.id).single(),
      this.db.from("player_progression").select("total_xp,level,updated_at").eq("player_id", player.id).single(),
      this.db.from("player_wallets").select("currency_code,balance").eq("player_id", player.id),
      this.db.from("player_inventory").select("quantity,created_at,shop_items(id,sku,type,asset_key,name,rarity)").eq("player_id", player.id),
      this.db.from("player_loadouts").select("*").eq("player_id", player.id).single(),
    ]);
    return { player, profile: profile.data, stats: stats.data, progression: progression.data, wallets: wallets.data ?? [], inventory: inventory.data ?? [], loadout: loadout.data };
  }

  @Patch("me/profile") async profile(@Req() req: Request, @Body() body: { displayName?: string }) {
    const player = await this.sessions.resolve(req);
    const name = String(body.displayName ?? "").trim();
    if (name.length < 1 || name.length > 32) throw new BadRequestException("invalid_display_name");
    const { error } = await this.db.from("players").update({ display_name: name }).eq("id", player.id);
    if (error) throw new BadRequestException(error.message);
    return { ok: true, displayName: name };
  }

  /**
   * doc 35 §C4 (lát c4.2) — XUẤT dữ liệu của chính mình.
   *
   * Trước lát này chỉ có admin đọc được dữ liệu người chơi. Đây là vế "xuất" của cặp quyền mà
   * `/privacy` đã hứa, và nó cũng là thứ khiến vế "xoá" dùng được: xoá xong không lấy lại được,
   * nên phải có đường tải về TRƯỚC khi xoá.
   *
   * Trả về đúng những bảng gắn với người chơi. KHÔNG kèm chứng từ giao dịch dạng thô — chúng thuộc
   * hồ sơ kế toán và có đường riêng qua bộ phận hỗ trợ; ở đây chỉ đưa số dư hiện tại.
   */
  @Get("me/export") async exportData(@Req() req: Request) {
    const player = await this.sessions.resolve(req);
    const [profile, stats, progression, wallets, inventory, loadout, identities, levels, energy] = await Promise.all([
      this.db.from("player_profiles").select("*").eq("player_id", player.id).maybeSingle(),
      this.db.from("player_stats").select("*").eq("player_id", player.id).maybeSingle(),
      this.db.from("player_progression").select("*").eq("player_id", player.id).maybeSingle(),
      this.db.from("player_wallets").select("currency_code,balance").eq("player_id", player.id),
      this.db.from("player_inventory").select("quantity,created_at,item_id").eq("player_id", player.id),
      this.db.from("player_loadouts").select("*").eq("player_id", player.id).maybeSingle(),
      // `provider_user_id` LÀ dữ liệu của người dùng (id Telegram của chính họ) nên phải có trong
      // bản xuất. Đây cũng chính là thứ bị xoá khi hết thời gian chờ.
      this.db.from("player_identities").select("platform,provider,provider_user_id,provider_username,verified_at").eq("player_id", player.id),
      this.db.from("player_level_progress").select("*").eq("player_id", player.id),
      this.db.from("player_energy").select("*").eq("player_id", player.id).maybeSingle(),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      player,
      profile: profile.data ?? null,
      stats: stats.data ?? null,
      progression: progression.data ?? null,
      wallets: wallets.data ?? [],
      inventory: inventory.data ?? [],
      loadout: loadout.data ?? null,
      identities: identities.data ?? [],
      campaignProgress: levels.data ?? [],
      energy: energy.data ?? null,
    };
  }

  /**
   * doc 35 §C4 (lát c4.2) — TỰ XOÁ tài khoản.
   *
   * `/privacy` đã hứa nguyên văn: *"tài khoản bị vô hiệu ngay và dữ liệu chơi bị xoá hẳn sau 30
   * ngày"*. Endpoint này làm vế đầu; vế sau là `purge_deleted_players()` trong migration
   * `202609080002`, và nó cần một lịch chạy (doc 37 Việc 3c — `pg_cron`).
   *
   * VÔ HIỆU NGAY nghĩa là thu hồi phiên TRƯỚC khi đổi trạng thái: nếu đổi trạng thái trước rồi
   * việc thu hồi hỏng, tài khoản mang nhãn "đã xoá" mà vẫn còn phiên sống — đúng thứ mà người dùng
   * vừa yêu cầu chấm dứt.
   *
   * KHÔNG xoá định danh ngay: thời gian chờ tồn tại để người dùng đổi ý, và không còn định danh
   * thì không còn cách nào nhận ra họ để khôi phục.
   */
  @Delete("me") async deleteAccount(@Req() req: Request) {
    const player = await this.sessions.resolve(req);
    const now = new Date().toISOString();

    const revoked = await this.db.from("player_sessions")
      .update({ revoked_at: now }).eq("player_id", player.id).is("revoked_at", null);
    if ((revoked as { error?: { message?: string } }).error) {
      throw new BadRequestException("delete_failed_sessions");
    }

    const { error } = await this.db.from("players")
      .update({ status: "deleted", deleted_at: now }).eq("id", player.id);
    if (error) throw new BadRequestException(error.message);

    return { ok: true, deletedAt: now, graceDays: DELETION_GRACE_DAYS };
  }
}
