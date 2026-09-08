import { Injectable } from "@nestjs/common";
import {
  Replay,
  compareFacts,
  parseTrace,
  type CampaignOutcomeFacts,
  type FactDiff,
  type MatchConfigInput,
} from "@hexagon/shared";
import { SupabaseService } from "../database/supabase.service";
import { createLogger } from "../logging";

/**
 * doc 35 §A3 lớp 3 (lát a3.3) — chạy lại input của client để đối chiếu kết quả campaign.
 *
 * ┌─ HAI LUẬT KHÔNG ĐƯỢC PHÁ ────────────────────────────────────────────────────────────────┐
 * │ 1. Chạy lại bằng seed của SERVER (`campaign_plays.seed`), không bao giờ bằng seed trong   │
 * │    trace. Trace do client gửi, nên seed trong đó cũng do client chọn — chạy lại bằng nó là │
 * │    chạy lại đúng ván giả mà kẻ gian đã dựng.                                              │
 * │ 2. Lệch ⇒ ĐÁNH DẤU NGHI VẤN, không thu hồi gì. doc 35 §A3 nói rõ như vậy, và §9 rủi ro #6 │
 * │    nhắc lại: từ chối oan ở campaign lấy mất năng lượng và khoá đường mở cấp kế tiếp.      │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Chạy BẤT ĐỒNG BỘ, sau khi người chơi đã nhận phần thưởng. Không dựng hàng đợi cho việc này:
 * mất một lượt xác minh khi tiến trình khởi động lại là mất một dòng ghi chú, còn dựng hàng đợi là
 * thêm một hệ thống phải vận hành. Khi nào lớp 4 (điểm rủi ro) cần độ phủ chắc chắn thì thay.
 */

/** `pending` không bao giờ được ghi ra DB — nó chỉ là trạng thái trong bộ nhớ trước khi có kết quả. */
export type VerifyStatus = "ok" | "mismatch" | "skipped" | "error";

/** Số khung chạy mỗi đoạn trước khi trả quyền cho vòng lặp sự kiện. ~8,5 ms mỗi đoạn. */
export const REPLAY_FRAME_BUDGET = 500;

export interface VerifyInput {
  playId: string;
  /** Seed đọc từ `campaign_plays.seed`. `0` = lượt chơi có TRƯỚC lát a3.3 ⇒ không xác minh được. */
  seed: number;
  config: MatchConfigInput;
  /** Trace thô do client gửi. `undefined` khi client chưa cập nhật (doc 35 §A8). */
  trace: unknown;
  claimed: Partial<CampaignOutcomeFacts>;
}

export interface VerifyResult {
  status: VerifyStatus;
  reason?: string;
  diffs?: FactDiff[];
  frames?: number;
}

@Injectable()
export class ReplayService {
  private readonly log = createLogger().child({ component: "campaign-replay" });

  constructor(private readonly db: SupabaseService) {}

  /**
   * Xếp lịch xác minh và trả về NGAY. Không `await`: người chơi không phải chờ một phép kiểm mà
   * kết quả của nó không đổi được điều gì cho lượt chơi này.
   */
  schedule(input: VerifyInput): void {
    setImmediate(() => {
      void this.verify(input).catch(() => {
        // `verify` đã tự nuốt mọi lỗi; đây chỉ là lưới cuối cho trường hợp không lường được.
      });
    });
  }

  /** Không bao giờ ném. Tách khỏi `schedule` để test gọi thẳng và đợi được. */
  async verify(input: VerifyInput): Promise<VerifyResult> {
    const result = await this.evaluate(input);
    await this.record(input.playId, result);
    if (result.status === "mismatch") {
      // Ghi log ở mức warn: đây là thứ cần người nhìn, và cũng là nguồn duy nhất để biết ngưỡng
      // sai số có đang báo động giả hàng loạt hay không.
      this.log.warn({ playId: input.playId, diffs: result.diffs, frames: result.frames }, "ket qua campaign lech khi chay lai");
    }
    return result;
  }

  /**
   * Phần THUẦN: quyết định trạng thái, không chạm database.
   *
   * Mọi lý do "không xác minh được" đều ra `skipped`, KHÔNG ra `mismatch`. Thiếu trace, trace hỏng,
   * lượt chơi cũ chưa có seed — không cái nào là bằng chứng gian lận, và gộp chúng vào `mismatch`
   * sẽ chôn vùi những lần lệch thật giữa một đống nhiễu.
   */
  async evaluate(input: VerifyInput): Promise<VerifyResult> {
    if (!Number.isInteger(input.seed) || input.seed === 0) {
      return { status: "skipped", reason: "no_seed" };
    }
    if (input.trace === undefined || input.trace === null) {
      return { status: "skipped", reason: "no_trace" };
    }
    const parsed = parseTrace(input.trace);
    if (!parsed) return { status: "skipped", reason: "bad_trace" };

    try {
      // LUẬT 1: seed của server, truyền tường minh; `parsed.seed` không được dùng ở đâu cả.
      const replay = new Replay(input.config, parsed, input.seed);
      // Chạy theo đoạn và TRẢ QUYỀN giữa các đoạn: 500 khung ~ 8,5 ms (đo được: 5.400 khung mất
      // 91,8 ms), đủ nhỏ để không lỡ một tick 41,7 ms của server game chạy chung tiến trình.
      while (!replay.step(REPLAY_FRAME_BUDGET)) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      const out = replay.result();
      const cmp = compareFacts(input.claimed, out.facts);
      return cmp.ok
        ? { status: "ok", frames: out.frames }
        : { status: "mismatch", diffs: cmp.diffs, frames: out.frames };
    } catch (err) {
      // Mô phỏng ném là LỖI CỦA TA, không phải của người chơi.
      return { status: "error", reason: err instanceof Error ? err.message.slice(0, 200) : "replay_failed" };
    }
  }

  /** Ghi kết quả. Hỏng thì thôi — mất một dòng ghi chú không được làm hỏng gì khác. */
  private async record(playId: string, result: VerifyResult): Promise<void> {
    try {
      await this.db.from("campaign_plays")
        .update({
          verify_status: result.status,
          verify_detail: {
            ...(result.reason ? { reason: result.reason } : {}),
            ...(result.diffs ? { diffs: result.diffs } : {}),
            ...(result.frames !== undefined ? { frames: result.frames } : {}),
            at: new Date().toISOString(),
          },
        })
        .eq("id", playId);
    } catch {
      // Có chủ ý.
    }
  }
}
