import { Controller, Get, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import {
  REMOTE_CONFIG_DEFAULTS,
  remoteConfigEtag,
  resolveRemoteConfig,
  type ConfigPlatform,
  type RemoteConfigBundle,
  type RemoteConfigRow,
} from "@hexagon/shared";
import { SessionService } from "../auth/session.service";
import { SupabaseService } from "../database/supabase.service";

/**
 * doc 35 §A2 — `GET /v1/config`. Trả bundle đã giải quyết cho ĐÚNG người đang hỏi (nền tảng, build,
 * nhóm rollout) kèm `ETag` để client hỏi lại rẻ.
 *
 * Ba điều endpoint này phải giữ bằng mọi giá:
 *
 * 1. **Không bao giờ trả lỗi.** Đây là thứ client gọi lúc khởi động. Database chết mà endpoint trả
 *    500 thì kill-switch biến từ công cụ cứu hoả thành nguyên nhân cháy. Hỏng ⇒ trả mặc định.
 * 2. **Cache có trần.** Cấu hình đọc mỗi lần mở app; hỏi database mỗi lần là tự tạo điểm nghẽn.
 *    Cache trong tiến trình 30 giây — đủ để chịu tải, đủ ngắn để kill-switch có tác dụng gần như
 *    tức thì (client cache 5 phút là lớp riêng ở a2.2).
 * 3. **Chia nhóm rollout tất định.** Dùng `player_id` nếu có session, không thì `anonId` client gửi
 *    lên. Cùng người phải luôn cùng nhánh, nếu không A/B test sẽ đo ra rác.
 */

/** Cache trong tiến trình. Ngắn có chủ ý — xem lý do 2 ở trên. */
export const CONFIG_CACHE_MS = 30_000;
/** Client được phép giữ 5 phút (doc 35 §A2). */
export const CLIENT_CACHE_SECONDS = 300;

/** Chỉ nhận đúng hai nền tảng; giá trị lạ ⇒ `web` (mặc định an toàn, không ném lỗi). */
export function parsePlatform(raw: unknown): ConfigPlatform {
  return raw === "telegram" ? "telegram" : "web";
}

/** Đọc `anonId` từ query. Cắt ngắn để không ai nhét payload vào khoá chia nhóm. */
export function parseUnitId(raw: unknown): string {
  return typeof raw === "string" && raw.length > 0 ? raw.slice(0, 64) : "anonymous";
}

@Controller("v1")
export class RemoteConfigController {
  private cache: { rows: RemoteConfigRow[]; at: number } | null = null;

  constructor(
    private readonly sessions: SessionService,
    private readonly db: SupabaseService,
  ) {}

  /**
   * Đọc bảng, có cache. Lỗi database ⇒ trả mảng RỖNG (⇒ toàn bộ mặc định) chứ không ném:
   * xem lý do 1 ở trên. Cache cũ vẫn dùng được thì dùng — thà cấu hình trễ 30 giây còn hơn không có.
   */
  private async rows(): Promise<RemoteConfigRow[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CONFIG_CACHE_MS) return this.cache.rows;

    const { data, error } = await this.db.from("remote_config").select("key,value,audience");
    if (error) return this.cache?.rows ?? [];

    const rows = (data ?? []) as RemoteConfigRow[];
    this.cache = { rows, at: now };
    return rows;
  }

  @Get("config")
  async config(
    @Req() req: Request,
    @Res() res: Response,
    @Query("platform") platform?: string,
    @Query("build") build?: string,
    @Query("anonId") anonId?: string,
  ): Promise<void> {
    // Session TUỲ CHỌN — cấu hình phải đọc được trước cả khi đăng nhập.
    let unitId = parseUnitId(anonId);
    try {
      unitId = (await this.sessions.resolve(req)).id;
    } catch {
      /* khách: giữ anonId */
    }

    let bundle: RemoteConfigBundle;
    try {
      bundle = resolveRemoteConfig(await this.rows(), {
        platform: parsePlatform(platform),
        buildId: typeof build === "string" ? build : "",
        unitId,
      });
    } catch {
      bundle = { ...REMOTE_CONFIG_DEFAULTS };
    }

    const etag = remoteConfigEtag(bundle);
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", `public, max-age=${CLIENT_CACHE_SECONDS}`);

    // Client giữ đúng bản này rồi ⇒ 304, không tốn băng thông và không tốn parse.
    if (req.headers["if-none-match"] === etag) {
      res.status(304).end();
      return;
    }

    res.status(200).json({ config: bundle, etag });
  }
}
