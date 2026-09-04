import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { SupabaseService } from "../database/supabase.service";
import { ServerAnalyticsService, type ServerEventInput } from "../analytics/server-analytics.service";
import { runtimeConfig } from "../runtime-config";

/** Đúng phần envelope mà lát này cần đọc — không nhân bản cả `MatchResultEnvelope` của node game. */
interface MatchResultBody {
  eventId?: unknown;
  matchId?: unknown;
  region?: unknown;
  mode?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  winnerPlayerId?: unknown;
  players?: unknown;
}

interface MatchPlayerRow {
  playerId?: unknown;
  participantKey?: unknown;
  platform?: unknown;
  isGuest?: unknown;
  kills?: unknown;
  deaths?: unknown;
  territoryCaptured?: unknown;
  deathCause?: unknown;
  finalScore?: unknown;
  placement?: unknown;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * doc 35 §A1.4 — dựng sự kiện `match_end` TIN CẬY, mỗi người chơi một sự kiện.
 *
 * Hàm thuần, tách khỏi controller để test được toàn bộ luật mà không cần HMAC hay database.
 *
 * Hai điều quyết định tính đúng đắn:
 *  - `occurred_at` lấy `endedAt` của envelope, KHÔNG lấy đồng hồ server. Node game gửi lại kết quả
 *    theo cấp số nhân khi control plane hỏng (xem `match-result-reporter.service.ts`), nên nếu
 *    dùng đồng hồ thì mỗi lần gửi lại là một hàng mới với cùng `event_id` — unique
 *    `(event_id, occurred_at)` không cứu được.
 *  - `dedupe` gồm `eventId` của envelope + khoá người tham gia. `eventId` là id của KẾT QUẢ VÁN
 *    (node game sinh một lần rồi lưu ra đĩa), nên nó bền qua mọi lần gửi lại.
 *
 * Bỏ qua khách (`playerId` rỗng): sự kiện không gắn được ai thì không dùng được cho retention hay
 * doanh thu, mà vẫn tốn một hàng trong bảng ghi nhiều nhất hệ thống.
 */
export function matchEndEvents(body: MatchResultBody): ServerEventInput[] {
  const players = Array.isArray(body.players) ? (body.players as MatchPlayerRow[]) : [];
  const eventId = str(body.eventId) || str(body.matchId);
  if (!eventId) return [];
  const endedAt = str(body.endedAt);
  const startedMs = Date.parse(str(body.startedAt));
  const endedMs = Date.parse(endedAt);
  const durationSec =
    Number.isFinite(startedMs) && Number.isFinite(endedMs) && endedMs >= startedMs
      ? Math.round((endedMs - startedMs) / 1000)
      : null;
  const winner = str(body.winnerPlayerId);

  const events: ServerEventInput[] = [];
  for (const p of players) {
    const playerId = str(p.playerId);
    if (!playerId || p.isGuest === true) continue;
    events.push({
      name: "match_end",
      dedupe: [eventId, str(p.participantKey) || playerId],
      playerId,
      occurredAt: endedAt,
      platform: str(p.platform),
      props: {
        mode: str(body.mode) || "online",
        region: str(body.region),
        match_id: str(body.matchId),
        won: winner !== "" && winner === playerId,
        placement: num(p.placement),
        kills: num(p.kills),
        deaths: num(p.deaths),
        territory_captured: num(p.territoryCaptured),
        final_score: num(p.finalScore),
        death_cause: str(p.deathCause),
        duration_sec: durationSec,
      },
    });
  }
  return events;
}

@Controller("internal/v1")
export class MatchesController {
  constructor(
    private readonly db: SupabaseService,
    private readonly analytics: ServerAnalyticsService,
  ) {}

  @Post("match-results") async result(@Headers("x-game-signature") signature: string, @Body() body: Record<string, unknown>) {
    const secret = runtimeConfig().gameResultSecret;
    const expected = createHmac("sha256", secret).update(JSON.stringify(body)).digest();
    const actual = Buffer.from(String(signature || ""), "hex");
    if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new UnauthorizedException("invalid_game_signature");
    const inserted = await this.db.rpc<boolean>("record_match_result", { p_payload: body });

    // Chỉ phát khi RPC nói ĐÂY LÀ LẦN GHI ĐẦU. Node game gửi lại kết quả cho tới khi được nhận, và
    // `record_match_result` vốn đã idempotent — dùng lại chính cờ đó cho phép đo thì "đúng một lần"
    // là thuộc tính có sẵn, không phải thứ phải tự dựng thêm và tự làm sai.
    if (inserted) void this.analytics.emitMany(matchEndEvents(body as MatchResultBody));
    return { inserted };
  }
}
