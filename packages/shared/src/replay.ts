// doc 35 §A3 lớp 3 — server chạy lại input của client để đối chiếu kết quả campaign (lát a3.3).
//
// Lớp 1 bỏ việc nhận `stars` từ client; lớp 2 chặn kết quả phi lý bằng thời gian server tự đo.
// Cả hai vẫn chấm trên **dữ kiện thô do client khai** (`territoryPct`, `deaths`, …). Lớp này là
// thứ đầu tiên không cần tin lời khai nào: server dựng lại chính ván đó và tự đọc kết quả.
//
// ┌─ HAI ĐIỀU KIỆN, VÀ CẢ HAI ĐỀU KHÔNG CÓ SẴN TRƯỚC LÁT NÀY ────────────────────────────────┐
// │ 1. Ván phải TẤT ĐỊNH. `t1-seeded-rng` vừa nối `config.seed` vào `GameState.rng`; trước đó │
// │    spawn và bot gọi thẳng `Math.random`, nên chạy lại là ra ván khác.                      │
// │ 2. Client phải mô phỏng bằng ĐÚNG những con số nó ghi lại. Vòng lặp client dùng `dt` biến  │
// │    thiên từ `useFrame`, nên trace chỉ có (seq, heading) như doc 35 phác thảo là KHÔNG đủ — │
// │    thiếu `dt` thì không có cách nào dựng lại cùng một ván.                                 │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// Cách giải: LƯỢNG TỬ HOÁ ở ranh giới. Client làm tròn `dt` về micro giây và `heading` về micro
// radian, rồi **mô phỏng bằng chính giá trị đã làm tròn đó**. Nhờ vậy:
//   • trace là mảng số nguyên (nén tốt) thay vì mảng float64 in ra ~20 ký tự mỗi số;
//   • chạy lại khớp TUYỆT ĐỐI — cùng mã, cùng thứ tự, cùng bit.
// Đây KHÔNG phải đổi sang bước thời gian cố định: `dt` vẫn biến thiên, chỉ là tròn tới 1 µs —
// dưới 0,003% của một khung hình 60fps.

import { GameState } from "./state";
import type { MatchConfigInput } from "./match-config";
import type { CampaignOutcomeFacts } from "./campaign";

/** Đổi số này khi ĐỔI Ý NGHĨA của một trường; server từ chối trace phiên bản lạ. */
export const REPLAY_VERSION = 1;

/** `dt` giây → micro giây. */
export const DT_SCALE = 1_000_000;
/** `heading` radian → micro radian. */
export const HEADING_SCALE = 1_000_000;

/** Khung không có input lái (người chơi không chạm/không di chuột). */
export const NO_INPUT = -2_147_483_648;

/**
 * Trần số khung một trace được phép mang. Con số này ĐO ĐƯỢC chứ không chọn cho tròn.
 *
 * Một ván 90 giây ở 60fps là 5.400 khung, và thân request `campaign/complete` khi đó nặng
 * **79,1 KB**. Giới hạn mặc định của body-parser trong Express là 100 KB, nên bản đầu của lát này
 * làm mọi ván dài hơn ~115 giây nhận HTTP 413: người chơi hoàn thành cấp và KHÔNG được thưởng.
 * Đó là hồi quy nặng hơn hẳn thứ mà lớp 3 định bịt.
 *
 * 20.000 khung ~ 5,6 phút ở 60fps => thân request tối đa 307,2 KB (đo được), nằm dưới trần 512 KB mà
 * `main.ts` đặt tường minh. Ván dài hơn thế thì KHÔNG gửi trace (`build()` trả `null`) và server
 * ghi `skipped/no_trace` — mất một lượt xác minh, không mất phần thưởng của ai.
 */
export const MAX_TRACE_FRAMES = 20_000;

export interface InputTrace {
  v: number;
  /** Seed server cấp lúc `campaign/start`, cũng là seed đã lưu ở `campaign_plays.seed`. */
  seed: number;
  /** `dt` từng khung, đơn vị micro giây. */
  dt: number[];
  /** `heading` mong muốn từng khung, đơn vị micro radian, hoặc `NO_INPUT`. */
  hdg: number[];
}

// ---- Lượng tử hoá ------------------------------------------------------------------------------
//
// Client PHẢI mô phỏng bằng giá trị đã đi qua cặp hàm này, nếu không server chạy lại sẽ ra ván
// khác và mọi người chơi lương thiện đều bị đánh dấu nghi vấn.

export function quantizeDt(dtSec: number): number {
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  return Math.round(dtSec * DT_SCALE);
}

export function dequantizeDt(micros: number): number {
  return micros / DT_SCALE;
}

export function quantizeHeading(rad: number): number {
  if (!Number.isFinite(rad)) return NO_INPUT;
  return Math.round(rad * HEADING_SCALE);
}

export function dequantizeHeading(microRad: number): number {
  return microRad / HEADING_SCALE;
}

// ---- Ghi trace ---------------------------------------------------------------------------------

/**
 * Bộ ghi trace. Đặt ở `shared` chứ không ở client vì bên GHI và bên CHẠY LẠI phải dùng chung một
 * hiện thực — hai bản chép tay lệch nhau một khung là đủ để mọi ván đều bị coi là gian lận.
 */
export class TraceRecorder {
  private readonly dt: number[] = [];
  private readonly hdg: number[] = [];
  private overflow = false;

  constructor(private readonly seed: number) {}

  /**
   * Ghi một khung và trả về CẶP GIÁ TRỊ ĐÃ LÀM TRÒN để bên gọi mô phỏng bằng đúng chúng.
   *
   * Trả về giá trị thay vì chỉ ghi lại là có chủ ý: nếu client mô phỏng bằng `dtRaw` rồi ghi bản
   * làm tròn, sai lệch tích luỹ qua hàng nghìn khung và ván chạy lại sẽ khác hẳn. Ép bên gọi dùng
   * đúng thứ đã ghi là cách duy nhất khiến chuyện đó không xảy ra được.
   */
  record(dtSec: number, headingRad: number | null): { dt: number; heading: number | null } {
    const qd = quantizeDt(dtSec);
    const qh = headingRad === null ? NO_INPUT : quantizeHeading(headingRad);
    if (this.dt.length < MAX_TRACE_FRAMES) {
      this.dt.push(qd);
      this.hdg.push(qh);
    } else {
      this.overflow = true;
    }
    return { dt: dequantizeDt(qd), heading: qh === NO_INPUT ? null : dequantizeHeading(qh) };
  }

  get frames(): number {
    return this.dt.length;
  }

  /** `null` khi trace không dùng được (vượt trần) — thà không có trace còn hơn có trace sai. */
  build(): InputTrace | null {
    if (this.overflow || this.dt.length === 0) return null;
    return { v: REPLAY_VERSION, seed: this.seed, dt: [...this.dt], hdg: [...this.hdg] };
  }
}

// ---- Đọc trace ---------------------------------------------------------------------------------

/** `null` = không dùng được. Mọi lý do đều trả `null`: trace hỏng KHÔNG phải bằng chứng gian lận. */
export function parseTrace(raw: unknown): InputTrace | null {
  if (typeof raw !== "object" || raw === null) return null;
  const t = raw as Partial<InputTrace>;
  if (t.v !== REPLAY_VERSION) return null;
  if (!Number.isInteger(t.seed)) return null;
  if (!Array.isArray(t.dt) || !Array.isArray(t.hdg)) return null;
  if (t.dt.length !== t.hdg.length) return null;
  if (t.dt.length === 0 || t.dt.length > MAX_TRACE_FRAMES) return null;
  for (let i = 0; i < t.dt.length; i++) {
    if (!Number.isInteger(t.dt[i]) || !Number.isInteger(t.hdg[i])) return null;
    // `dt` âm hoặc 0 làm vòng lặp mô phỏng vô nghĩa; `dt` quá lớn là cách rẻ nhất để bắt server
    // mô phỏng hàng giờ trong một khung.
    if (t.dt[i] <= 0 || t.dt[i] > 1_000_000) return null;
  }
  return { v: t.v, seed: t.seed as number, dt: t.dt as number[], hdg: t.hdg as number[] };
}

// ---- Chạy lại ----------------------------------------------------------------------------------

export interface ReplayResult {
  facts: CampaignOutcomeFacts;
  /** Tổng thời gian mô phỏng, giây — so được với `elapsed` mà server tự đo. */
  elapsedSec: number;
  frames: number;
}

/**
 * Ván đang được dựng lại, chạy được THEO TỪNG ĐOẠN.
 *
 * Vì sao không chỉ là một vòng lặp: chạy lại 5.400 khung tốn **91,8 ms** đo được, trong khi một
 * tick của server game 24 Hz là 41,7 ms — và `main.ts` gắn NetServer vào CÙNG tiến trình với tầng
 * HTTP khi `SERVER_ROLE` không phải `control`. Chạy liền một mạch nghĩa là mỗi lần có người hoàn
 * thành một cấp campaign thì cả phòng online khựng hơn hai tick. Một phép kiểm chống gian lận
 * không được phép làm hỏng trải nghiệm của những người không gian lận.
 */
export class Replay {
  private readonly game: GameState;
  private cursor = 0;
  private elapsed = 0;

  constructor(config: MatchConfigInput, private readonly trace: InputTrace, seed: number) {
    this.game = new GameState({ config: { ...config, seed } });
  }

  get done(): boolean {
    return this.cursor >= this.trace.dt.length;
  }

  /** Chạy tối đa `budget` khung rồi TRẢ QUYỀN. `true` khi đã hết trace. */
  step(budget: number): boolean {
    const end = Math.min(this.cursor + Math.max(1, budget), this.trace.dt.length);
    for (; this.cursor < end; this.cursor++) {
      const h = this.trace.hdg[this.cursor];
      if (h !== NO_INPUT) this.game.setHeadingTarget(dequantizeHeading(h));
      const dt = dequantizeDt(this.trace.dt[this.cursor]);
      this.game.update(dt);
      this.elapsed += dt;
    }
    return this.done;
  }

  result(): ReplayResult {
    return {
      facts: {
        deaths: this.game.human.deaths,
        territoryPct: this.game.territoryPct(),
        totemsCaptured: this.game.human.totemsCaptured,
        kingHeldSec: 0,
      },
      elapsedSec: this.elapsed,
      frames: this.cursor,
    };
  }
}

/**
 * Dựng lại trọn ván trong một lượt. Tiện cho test; ở server dùng `Replay` theo từng đoạn.
 *
 * `seed` truyền RIÊNG chứ không lấy từ `trace.seed`: trace do client gửi. Bắt bên gọi nói rõ seed
 * mình tin là cách khiến không ai lỡ tin nhầm seed của client.
 */
export function replayTrace(config: MatchConfigInput, trace: InputTrace, seed: number = trace.seed): ReplayResult {
  const r = new Replay(config, trace, seed);
  while (!r.step(4096));
  return r.result();
}

// ---- Đối chiếu ---------------------------------------------------------------------------------

export interface FactDiff {
  field: string;
  claimed: number;
  replayed: number;
}

/**
 * Sai số cho phép khi so lời khai với ván chạy lại.
 *
 * KHÔNG phải 0 dù chạy lại khớp tuyệt đối: client đọc `territoryPct` ở khoảnh khắc kết thúc ván
 * của NÓ, còn server đọc sau khung cuối của trace — hai mốc lệch nhau đúng một khung. Đặt 0 ở đây
 * là biến một chênh lệch cơ học thành một cáo buộc.
 */
export const PCT_TOLERANCE = 1.0;

/**
 * `ok = false` nghĩa là ĐÁNG XEM LẠI, không phải "đã gian lận". doc 35 §A3 lớp 3 nói rõ: lệch thì
 * đánh dấu nghi vấn, KHÔNG thu hồi tự động.
 */
export function compareFacts(
  claimed: Partial<CampaignOutcomeFacts>,
  replayed: CampaignOutcomeFacts,
): { ok: boolean; diffs: FactDiff[] } {
  const diffs: FactDiff[] = [];
  const pct = Number(claimed.territoryPct ?? 0);
  if (Math.abs(pct - replayed.territoryPct) > PCT_TOLERANCE) {
    diffs.push({ field: "territoryPct", claimed: pct, replayed: replayed.territoryPct });
  }
  // Số lần chết và số totem là số ĐẾM — không có lý do gì để lệch, nên so bằng.
  const deaths = Number(claimed.deaths ?? 0);
  if (deaths !== replayed.deaths) {
    diffs.push({ field: "deaths", claimed: deaths, replayed: replayed.deaths });
  }
  const totems = Number(claimed.totemsCaptured ?? 0);
  if (totems !== replayed.totemsCaptured) {
    diffs.push({ field: "totemsCaptured", claimed: totems, replayed: replayed.totemsCaptured });
  }
  return { ok: diffs.length === 0, diffs };
}
