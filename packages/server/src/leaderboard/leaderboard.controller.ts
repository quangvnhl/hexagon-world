import { BadRequestException, Controller, Get, Query, Req } from "@nestjs/common";
import type { Request } from "express";
import { LEADERBOARD_SCOPES, isLeaderboardScope, type LeaderboardScope } from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/** Một dòng thô từ RPC `read_leaderboard`. */
interface HangThoRow {
  rank: number;
  playerId: string;
  displayName: string;
  score: number;
}

interface KetQuaThoRpc {
  scope: string;
  periodKey: string;
  top: HangThoRow[];
  me: { rank: number; score: number } | null;
}

/** Một dòng ĐƯA RA NGOÀI — cố ý không có `playerId`. */
export interface LeaderboardRow {
  rank: number;
  displayName: string;
  score: number;
  isMe: boolean;
}

export interface LeaderboardResponse {
  scope: LeaderboardScope;
  periodKey: string;
  top: LeaderboardRow[];
  /** Hạng của chính mình trên TOÀN bảng; `null` khi chưa đăng nhập hoặc chưa có điểm. */
  me: { rank: number; score: number } | null;
}

const LIMIT_MAC_DINH = 20;

/**
 * doc 35 §A5 — bảng xếp hạng.
 *
 * ┌─ CHỈ ĐỌC. KHÔNG CÓ ĐƯỜNG NÀO CHO CLIENT BÁO ĐIỂM ─────────────────────────────────────────┐
 * │ Điểm được cộng bên trong `record_match_result` / `complete_campaign_level`. Thêm một       │
 * │ endpoint ghi ở đây là mở lại đúng lỗ hổng mà A3 vừa bịt, lần này trên một bề mặt mà người  │
 * │ chơi nhìn thấy nhau — tức là kiểu gian lận sẽ được phát hiện bởi người chơi khác trước ta. │
 * └───────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ KHÔNG TRẢ `playerId` RA NGOÀI ───────────────────────────────────────────────────────────┐
 * │ Bảng xếp hạng là bề mặt CÔNG KHAI (xem được khi chưa đăng nhập). `playerId` là uuid dùng   │
 * │ làm khoá ở khắp các RPC; phát tán nó cho người lạ không đem lại gì cho giao diện, vốn chỉ  │
 * │ cần tên, điểm, hạng, và biết dòng nào là mình. Nên `isMe` được tính Ở ĐÂY rồi bỏ uuid đi.  │
 * └───────────────────────────────────────────────────────────────────────────────────────────┘
 */
@Controller("v1")
export class LeaderboardController {
  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  @Get("leaderboard") async read(
    @Req() req: Request,
    @Query("scope") scope?: string,
    @Query("limit") limit?: string,
  ): Promise<LeaderboardResponse> {
    // Whitelist chứ không truyền thẳng: một `scope` gõ sai mà đi tới database sẽ trả về bảng
    // rỗng — đúng về kỹ thuật, và che mất chuyện client đang gọi sai đường.
    if (!isLeaderboardScope(scope)) {
      throw new BadRequestException(`scope phải là một trong: ${LEADERBOARD_SCOPES.join(", ")}`);
    }

    const soDong = limit === undefined ? LIMIT_MAC_DINH : Number(limit);
    if (!Number.isInteger(soDong) || soDong < 1 || soDong > 100) {
      throw new BadRequestException("limit phải là số nguyên trong 1..100");
    }

    // Session TUỲ CHỌN: ai cũng XEM được bảng. Điều "guest không lên bảng" nói về việc CÓ MẶT
    // trên bảng (guest không có player_id nên chưa bao giờ được ghi điểm), không phải về việc xem.
    let playerId: string | null = null;
    try {
      playerId = (await this.sessions.resolve(req)).id;
    } catch {
      playerId = null;
    }

    const kq = await this.db.rpc<KetQuaThoRpc | null>("read_leaderboard", {
      p_scope: scope,
      p_limit: soDong,
      p_player_id: playerId,
    });

    const top = (kq?.top ?? []).map((r) => ({
      rank: r.rank,
      displayName: r.displayName,
      score: r.score,
      isMe: playerId !== null && r.playerId === playerId,
    }));

    return { scope, periodKey: kq?.periodKey ?? "", top, me: kq?.me ?? null };
  }
}
