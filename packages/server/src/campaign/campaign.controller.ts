import { BadRequestException, Body, Controller, ForbiddenException, Get, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import {
  isUnlockedIn,
  evaluateCampaignOutcome,
  type CampaignLevel,
  type CampaignOutcomeFacts,
  type MatchConfigInput,
} from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";
import { ServerAnalyticsService } from "../analytics/server-analytics.service";
import { KeyedSlidingWindow } from "../net/rate-limit";
import { createLogger } from "../logging";
import {
  COMPLETE_CALLS_PER_MINUTE,
  DAILY_COMPLETIONS_PER_LEVEL,
  checkElapsed,
  startOfUtcDay,
} from "./campaign-sanity";

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
  /**
   * doc 35 §A3 lớp 2 — trần theo NGƯỜI CHƠI, không theo IP.
   *
   * Theo IP thì một mạng chung (ký túc xá, quán net, NAT của nhà mạng di động) sẽ khoá lẫn nhau,
   * còn kẻ farm chỉ cần đổi IP. Ở đây danh tính đã xác thực, nên dùng thẳng nó.
   */
  private readonly completeLimiter = new KeyedSlidingWindow(COMPLETE_CALLS_PER_MINUTE, 60_000);
  private readonly log = createLogger().child({ component: "campaign-sanity" });

  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
    private readonly analytics: ServerAnalyticsService,
  ) {}

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

    const started = await this.db.rpc("start_campaign_level", {
      p_player_id: player.id, p_level_id: body.levelId, p_idempotency_key: body.idempotencyKey,
    });

    // doc 35 §A1.4 — năng lượng bị TRỪ ở đây (RPC trừ 1 điểm). Đây là nguồn duy nhất đáng tin để
    // biết người chơi tiêu năng lượng vào đâu; client chỉ biết mình đã bấm nút.
    //
    // `dedupe` dùng khoá idempotency của chính RPC: gọi lại cùng khoá thì RPC không trừ thêm lần
    // nào, và ở đây cũng ra đúng một `event_id`. Nhưng RPC không trả về mốc thời gian, nên
    // `occurred_at` là giờ request ⇒ gọi lại CÓ THỂ sinh hàng thứ hai. Mọi truy vấn tổng hợp phải
    // `count(distinct event_id)` — xem `202609040001_analytics_source.sql`.
    void this.analytics.emit({
      name: "energy_spend",
      dedupe: [player.id, body.idempotencyKey],
      playerId: player.id,
      props: { reason: "campaign_start", level_id: body.levelId, amount: 1 },
    });
    return started;
  }

  /**
   * Hoàn tất cấp: xác minh play thuộc người chơi, **server tự kết luận** đạt/không rồi mở khóa +
   * thưởng (thưởng lấy từ DB).
   *
   * doc 35 §A3 lớp 1 — trước đây endpoint này nhận thẳng `objectiveMet`/`stars`/`score` do client
   * khai, nên sửa client là farm được coin/XP/năng lượng vô hạn. Nay client chỉ gửi DỮ KIỆN THÔ
   * (`facts`); server đo thời gian bằng `campaign_plays.created_at` của CHÍNH NÓ và chấm bằng
   * `evaluateCampaignOutcome` với cấu hình cấp đọc từ database.
   *
   * ⚠️ ĐỔI HỢP ĐỒNG: client cũ (gửi `objectiveMet`) sẽ bị từ chối — client và server phải deploy
   * cùng nhau.
   */
  // review-guard: bỏ qua write-endpoint-idempotency — chống lặp nằm ở khoá tự nhiên
  // `campaign_plays.completed_at`: RPC complete_campaign_level khoá hàng rồi trả progress cũ
  // nếu play đã tiêu, nên gọi lại không thưởng thêm lần nào.
  @Post("campaign/complete") async complete(@Req() req: Request, @Body() body: { playId?: string; facts?: Partial<CampaignOutcomeFacts> }) {
    const player = await this.sessions.resolve(req);
    // Chặn trước MỌI thứ khác: một vòng lặp farm không được phép làm ta tốn một truy vấn database
    // nào. Đây cũng là lớp duy nhất còn tác dụng khi kẻ tấn công gửi `playId` rác hàng loạt.
    if (!this.completeLimiter.allow(player.id)) {
      throw new ForbiddenException({ code: "rate_limited", message: "gửi kết quả quá nhanh", retryable: true });
    }
    if (!body.playId) throw new BadRequestException("missing_play_id");
    if (!body.facts || typeof body.facts !== "object") {
      // Client CŨ gửi `objectiveMet`/`stars`/`score`. Trả mã riêng thay vì gộp chung vào
      // `missing_outcome_facts`: doc 35 §A8 — Telegram Mini App không ép cập nhật được, nên khi
      // deploy sẽ có người còn ở bản cũ, và trong log phải phân biệt được "client lỗi thời" với
      // "payload hỏng". Vẫn TỪ CHỐI: nhận payload cũ chính là để nguyên lỗ hổng mà lát này vá.
      const legacy = body as { objectiveMet?: unknown };
      throw new BadRequestException(legacy.objectiveMet !== undefined ? "client_outdated" : "missing_outcome_facts");
    }

    const { data: play, error } = await this.db.from("campaign_plays")
      .select("id,level_id,created_at,completed_at").eq("id", body.playId).eq("player_id", player.id).single();
    if (error || !play) throw new BadRequestException("play_not_found");
    const row = play as { level_id: string; created_at: string; completed_at: string | null };

    const { data: level } = await this.db.from("campaign_levels")
      .select("config,rewards").eq("id", row.level_id).single();
    if (!level) throw new BadRequestException("unknown_level");
    const lvl = level as { config: MatchConfigInput | null; rewards: unknown };

    // Thời gian đã chơi do SERVER đo — không nhận của client. Đây là dữ kiện duy nhất server tự
    // biết chắc, và là thứ chấm objective `survive`.
    const startedMs = Date.parse(row.created_at);
    const elapsedSec = Number.isFinite(startedMs) ? Math.max(0, (Date.now() - startedMs) / 1000) : 0;

    const outcome = evaluateCampaignOutcome(lvl.config ?? {}, body.facts, elapsedSec);
    if (!outcome.objectiveMet) throw new BadRequestException(outcome.reason);

    // doc 35 §A3 lớp 2 — thời gian là dữ kiện DUY NHẤT client không nói dối được, vì server đo nó.
    //
    // Chạy SAU evaluator có chủ ý. Một lượt chơi thất bại thật (mới sống 5 giây trong cấp cần 60)
    // phải nhận đúng lý do "chưa đạt mục tiêu", không phải một cáo buộc gian lận. Bảo mật không
    // mất gì: cả hai đều chặn trước khi RPC cấp thưởng chạy.
    const verdict = checkElapsed(lvl.config ?? {}, elapsedSec);
    if (!verdict.ok) {
      // Ghi lại MỌI lần chặn. doc 35 §9 rủi ro #6 cảnh báo "từ chối oan khi siết A3"; không có
      // dòng log này thì không có cách nào biết ngưỡng đang chặn nhầm người chơi thật.
      this.log.warn({ playerId: player.id, levelId: row.level_id, code: verdict.code, ...verdict.detail }, "chan ket qua campaign phi ly");
      throw new ForbiddenException({ code: verdict.code, message: verdict.message, retryable: false, ...verdict.detail });
    }

    // Trần theo NGÀY, chỉ áp cho lượt chưa hoàn thành. Nộp lại một lượt đã xong là idempotent —
    // tính nó vào trần sẽ biến việc thử lại sau lỗi mạng thành một hình phạt.
    if (!row.completed_at) {
      const done = await this.countCompletionsToday(player.id, row.level_id);
      if (done >= DAILY_COMPLETIONS_PER_LEVEL) {
        this.log.warn({ playerId: player.id, levelId: row.level_id, done }, "cham tran hoan thanh/ngay");
        throw new ForbiddenException({
          code: "daily_level_cap",
          message: "đã đạt trần số lần hoàn thành cấp này trong ngày",
          retryable: true, done, cap: DAILY_COMPLETIONS_PER_LEVEL,
        });
      }
    }


    const progress = await this.db.rpc("complete_campaign_level", {
      p_play_id: body.playId,
      p_player_id: player.id,
      p_stars: outcome.stars,
      p_score: outcome.score,
      p_rewards: lvl.rewards,
    });

    // doc 35 §A1.4 — bản TIN CẬY của `campaign_level_complete`. Client cũng phát một sự kiện cùng
    // tên, nhưng cột `source` tách hai nguồn: funnel đọc `client`, còn liêm chính và kinh tế đọc
    // `server` — vì sao/số sao ở đây là do `evaluateCampaignOutcome` chấm, không phải client khai.
    //
    // `occurred_at` đọc lại `campaign_plays.completed_at` sau RPC thay vì dùng `Date.now()`: RPC
    // idempotent nên gọi lại trả đúng mốc cũ ⇒ `(event_id, occurred_at)` lặp y hệt ⇒ database khử
    // trùng thật sự. Một truy vấn thêm trên khoá chính, và không nằm ở đường nóng.
    void this.emitCampaignComplete(player.id, body.playId, row.level_id, outcome, lvl.rewards);
    return progress;
  }

  /**
   * Đếm số lần đã HOÀN THÀNH cấp này trong ngày UTC hôm nay.
   *
   * Đọc hỏng ⇒ trả 0 (cho qua), KHÔNG phải chặn. Khác hẳn hướng của hạn mức Ops API: ở đó chặn
   * nhầm chỉ làm phiền một người vận hành, còn ở đây chặn nhầm là **lấy mất năng lượng của người
   * chơi và khoá đường mở cấp kế tiếp**. Trần này chống farm hàng loạt, không phải chống một lượt
   * chơi thật — nên khi không chắc thì nghiêng về phía người chơi.
   */
  private async countCompletionsToday(playerId: string, levelId: string): Promise<number> {
    try {
      const { count, error } = await this.db.from("campaign_plays")
        .select("id", { count: "exact", head: true })
        .eq("player_id", playerId).eq("level_id", levelId)
        .gte("completed_at", startOfUtcDay());
      if (error) return 0;
      return Number(count ?? 0);
    } catch {
      return 0;
    }
  }

  /** Tách khỏi `complete` để phần đo không làm dài thêm luồng nghiệp vụ. Không bao giờ ném. */
  private async emitCampaignComplete(
    playerId: string,
    playId: string,
    levelId: string,
    outcome: { stars: number; score: number },
    rewards: unknown,
  ): Promise<void> {
    let completedAt: string | null = null;
    try {
      const { data } = await this.db.from("campaign_plays").select("completed_at").eq("id", playId).single();
      completedAt = (data as { completed_at: string | null } | null)?.completed_at ?? null;
    } catch {
      // Đọc lại hỏng thì vẫn phát, chỉ là mốc thời gian dùng giờ hiện tại.
    }
    const r = (rewards ?? {}) as { coin?: number; xp?: number; energy?: number };
    await this.analytics.emit({
      name: "campaign_level_complete",
      dedupe: [playId],
      playerId,
      occurredAt: completedAt,
      props: {
        level_id: levelId,
        stars: outcome.stars,
        score: outcome.score,
        reward_coin: Number(r.coin ?? 0),
        reward_xp: Number(r.xp ?? 0),
        reward_energy: Number(r.energy ?? 0),
      },
    });
    // Năng lượng ĐI VÀO ví người chơi. Tách khỏi sự kiện trên để một truy vấn duy nhất trả lời
    // được "năng lượng vào/ra từ đâu" mà không phải đọc props của bốn loại sự kiện khác nhau.
    const energy = Number(r.energy ?? 0);
    if (energy > 0) {
      await this.analytics.emit({
        name: "energy_grant",
        dedupe: [playId, "reward"],
        playerId,
        occurredAt: completedAt,
        props: { reason: "campaign_reward", level_id: levelId, amount: energy },
      });
    }
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
