import { BadRequestException, Body, Controller, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { SERVER_ONLY_EVENTS, sanitizeProps, validateEvent, type AnalyticsEvent } from "@hexagon/shared";
import { SlidingWindowCounter } from "../net/rate-limit";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/**
 * doc 35 §A1 — nhận lô sự kiện phân tích từ client.
 *
 * Ba quyết định định hình cả endpoint này:
 *
 * 1. **Một sự kiện hỏng KHÔNG được giết cả lô.** Client đệm lô lỗi vào localStorage rồi gửi lại
 *    mãi. Nếu server trả 400 cho cả lô vì một sự kiện sai định dạng, cái lô đó sẽ kẹt vĩnh viễn và
 *    người chơi mất toàn bộ sự kiện về sau. Nên: bỏ riêng sự kiện sai, ghi phần còn lại, trả về
 *    số lượng nhận/bỏ.
 * 2. **Không tin client.** `props` được `sanitizeProps` lại ở server (chặn PII, cắt chuỗi dài,
 *    bỏ giá trị lồng nhau) dù client đã lọc. `player_id` lấy từ session của request, KHÔNG lấy từ
 *    body — nếu không thì ai cũng gắn sự kiện cho người khác được.
 * 3. **Session là TUỲ CHỌN.** Phần lớn funnel xảy ra trước khi đăng nhập (`app_open`, `ftue_step`).
 *    Bắt buộc session ở đây là tự bịt mắt đúng đoạn cần nhìn nhất.
 */

/** Trần số sự kiện mỗi lô. Client tự giới hạn 20/lô + đệm tối đa 200 ⇒ 500 là dư sức cho mọi tình
 *  huống thật (gửi lại sau khi offline lâu), vượt nữa là bất thường. */
export const MAX_EVENTS_PER_BATCH = 500;
/** Số lô tối đa mỗi IP trong 1 phút (doc 35 §A1). Một người chơi bình thường ~12 lô/phút. */
export const MAX_BATCHES_PER_MINUTE = 60;
/** Sự kiện có `ts` xa hơn mốc này ở TƯƠNG LAI là đồng hồ sai hoặc dữ liệu bịa ⇒ bỏ. Quá khứ thì
 *  nhận (lô đệm khi offline có thể cũ nhiều ngày). */
export const MAX_CLOCK_SKEW_MS = 2 * 24 * 60 * 60 * 1000;
/** Ngưỡng dọn bảng đếm rate-limit — chặn Map phình vô hạn theo số IP đã từng gặp. */
const RATE_LIMIT_MAX_KEYS = 10_000;

/** Đếm lô theo IP trong cửa sổ trượt. Tách ra để test được mà không cần dựng HTTP. */
export class BatchRateLimiter {
  private readonly perKey = new Map<string, SlidingWindowCounter>();

  constructor(
    private readonly max: number = MAX_BATCHES_PER_MINUTE,
    private readonly windowMs: number = 60_000,
  ) {}

  /** true = cho qua, false = vượt trần. */
  allow(key: string, now: number = Date.now()): boolean {
    // Dọn thô: bảng đầy thì xoá sạch. Chấp nhận "tha" một nhịp cho vài IP đang bị chặn — đổi lại
    // bộ nhớ có trần cứng. Rate-limit sai một nhịp rẻ hơn rất nhiều so với rò bộ nhớ.
    if (this.perKey.size >= RATE_LIMIT_MAX_KEYS) this.perKey.clear();
    let counter = this.perKey.get(key);
    if (!counter) {
      counter = new SlidingWindowCounter(this.max, this.windowMs);
      this.perKey.set(key, counter);
    }
    return counter.record(now);
  }
}

interface EventRow {
  event_id: string;
  occurred_at: string;
  name: string;
  schema: number;
  session_id: string;
  anon_id: string;
  platform: string;
  build_id: string;
  player_id: string | null;
  props: Record<string, unknown>;
}

/** Đổi sự kiện đã hợp lệ thành hàng database. `playerId` lấy từ session, không từ body. */
export function toRow(event: AnalyticsEvent, playerId: string | null): EventRow {
  return {
    event_id: event.eventId,
    occurred_at: new Date(event.ts).toISOString(),
    name: event.name,
    schema: event.schema,
    session_id: event.sessionId,
    anon_id: event.anonId,
    platform: event.platform,
    build_id: event.buildId,
    player_id: playerId,
    props: sanitizeProps(event.props as Record<string, unknown> | undefined),
  };
}

@Controller("v1")
export class AnalyticsController {
  private readonly limiter = new BatchRateLimiter();

  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  @Post("events")
  async ingest(
    @Req() req: Request,
    @Body() body: { events?: unknown },
  ): Promise<{ accepted: number; rejected: number }> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
    if (!this.limiter.allow(ip)) throw new BadRequestException("rate_limited");

    const events = body?.events;
    if (!Array.isArray(events)) throw new BadRequestException("missing_events");
    if (events.length === 0) return { accepted: 0, rejected: 0 };
    if (events.length > MAX_EVENTS_PER_BATCH) throw new BadRequestException("batch_too_large");

    // Session TUỲ CHỌN: không có/hết hạn thì vẫn nhận, chỉ là sự kiện không gắn player_id.
    let playerId: string | null = null;
    try {
      playerId = (await this.sessions.resolve(req)).id;
    } catch {
      playerId = null;
    }

    const now = Date.now();
    const rows: EventRow[] = [];
    let rejected = 0;
    for (const raw of events) {
      if (validateEvent(raw).length > 0) { rejected++; continue; }
      const event = raw as AnalyticsEvent;
      if (event.ts > now + MAX_CLOCK_SKEW_MS) { rejected++; continue; }
      // doc 35 §A1.4 — ba sự kiện tiền/tài nguyên chỉ server được phát. Không chặn ở đây thì bất
      // kỳ ai cũng ghi được `purchase_fulfilled` vào bảng. Cột `source` khiến chúng vô hại với
      // báo cáo doanh thu (truy vấn lọc `source='server'`), nhưng vẫn làm bẩn bảng và đủ để một
      // người đọc nhanh kết luận sai. Bỏ RIÊNG sự kiện đó, không giết cả lô — nguyên tắc 1.
      if (SERVER_ONLY_EVENTS.includes(event.name)) { rejected++; continue; }
      rows.push(toRow(event, playerId));
    }

    if (rows.length > 0) {
      // Khử trùng ở tầng database: client gửi lại nguyên lô khi mạng chập chờn, cùng `event_id`
      // và cùng `ts` ⇒ đụng unique (event_id, occurred_at) ⇒ bỏ qua, không nhân đôi số liệu.
      const { error } = await this.db
        .from("analytics_events")
        .upsert(rows, { onConflict: "event_id,occurred_at", ignoreDuplicates: true });
      if (error) throw new BadRequestException(error.message);
    }

    return { accepted: rows.length, rejected };
  }
}
