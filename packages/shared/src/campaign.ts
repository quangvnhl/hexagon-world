// Campaign (Cấp độ) — catalog cấp độ là DỮ LIỆU THUẦN (doc 25 §2.3, doc 28 E1).
//
// Mỗi cấp = một `MatchConfigInput` (map/obstacle/bot/rules + objective ở `win`) cộng metadata
// mở khóa/thưởng. Import ĐƯỢC ở cả client (chọn/chơi) lẫn server (verify thưởng/mở khóa) nên
// KHÔNG phụ thuộc React/Nest — chỉ toán + type từ gói shared.
//
// PHẠM VI P2 (chủ ý): catalog HARDCODE ~5 cấp mẫu. Schema Level trên Supabase + trình vẽ admin
// là P3 (doc 25 §4) — khi đó chỉ cần thay nguồn `CAMPAIGN_LEVELS` bằng dữ liệu fetch, giữ nguyên
// type `CampaignLevel` + các helper thuần bên dưới.

import { CONFIG } from "./config";
import { key } from "./hex";
import { resolveMatchConfig, type MatchConfigInput } from "./match-config";

/** Power-up chọn trước trận (doc 25 §2.3). MVP P2: 3 loại ánh xạ được vào modifier khởi tạo
 *  (doc 28 E2). `speed` tái dùng totem/tốc độ; `head_start` lãnh thổ khởi đầu lớn hơn;
 *  `extra_life` một mạng phụ. Mở rộng (shield/radar…) là hậu P2. */
export type PowerupKind = "speed" | "head_start" | "extra_life";

export interface CampaignLevel {
  /** Định danh ổn định (dùng cho progress/ticket, KHÔNG đổi khi sắp xếp lại). */
  id: string;
  /** Thứ tự hiển thị (duy nhất, tăng dần). */
  order: number;
  name: string;
  /** Cấu hình ván — objective nằm ở `config.win`. */
  config: MatchConfigInput;
  /** Loại power-up được phép chọn ở cấp này. */
  powerups: PowerupKind[];
  /** Điều kiện mở khóa: id cấp phải hoàn thành trước (null = mở sẵn từ đầu). */
  unlock: { requires: string | null };
  /** Thưởng khi qua màn (server đối chiếu catalog, KHÔNG nhận số từ client). */
  rewards: { coin: number; xp: number; energy: number };
}

// Vài cụm ô chướng ngại nhỏ quanh tâm cho cấp dùng obstacle (S7 — barrier nội bộ, biên vẫn lồi).
const wallColumn = [key(2, -1), key(2, 0), key(2, 1)];
const pillars = [key(-3, 1), key(3, -1), key(0, 3), key(0, -3)];

/** Số mạng mặc định mỗi cấp Campaign (mô hình "hết mạng = thua" — doc 28 §E2b). */
const CAMPAIGN_LIVES = 3;

/** Catalog Campaign P2 — 5 cấp mẫu, độ khó tăng dần, phủ đủ 3 loại objective + obstacle. */
export const CAMPAIGN_LEVELS: readonly CampaignLevel[] = [
  {
    id: "c1",
    order: 1,
    name: "Khởi đầu",
    config: { bots: { count: 6 }, rules: { maxLives: CAMPAIGN_LIVES, totemsEnabled: false }, win: { kind: "territory_pct", targetPct: 0.3 } },
    powerups: ["head_start"],
    unlock: { requires: null },
    rewards: { coin: 50, xp: 40, energy: 0 },
  },
  {
    id: "c2",
    order: 2,
    name: "Cầm cự",
    config: { bots: { count: 8 }, rules: { maxLives: CAMPAIGN_LIVES, totemsEnabled: false }, win: { kind: "survive", durationSec: 60 } },
    powerups: ["head_start", "speed"],
    unlock: { requires: "c1" },
    rewards: { coin: 60, xp: 55, energy: 0 },
  },
  {
    id: "c3",
    order: 3,
    name: "Săn totem",
    config: {
      bots: { count: 10 },
      // Totem tác giả đặt tường minh (doc 32) — KHÔNG sinh ngẫu nhiên. Đủ ≥ totemGoal.
      map: { totems: [
        { kind: "speed", q: 4, r: 0 }, { kind: "slow", q: -4, r: 0 },
        { kind: "radar", q: 0, r: 4 }, { kind: "speed", q: 0, r: -4 },
      ] },
      rules: { totemsEnabled: false, maxLives: CAMPAIGN_LIVES },
      win: { kind: "capture_totems", totemGoal: 3 },
    },
    powerups: ["speed", "extra_life"],
    unlock: { requires: "c2" },
    rewards: { coin: 80, xp: 70, energy: 1 },
  },
  {
    id: "c4",
    order: 4,
    name: "Mê cung",
    config: {
      bots: { count: 10 },
      map: { obstacles: [...wallColumn] },
      rules: { maxLives: CAMPAIGN_LIVES, totemsEnabled: false },
      win: { kind: "territory_pct", targetPct: 0.35 },
    },
    powerups: ["head_start", "speed", "extra_life"],
    unlock: { requires: "c3" },
    rewards: { coin: 100, xp: 90, energy: 1 },
  },
  {
    id: "c5",
    order: 5,
    name: "Chung kết",
    config: {
      bots: { count: 14 },
      map: { obstacles: [...pillars] },
      rules: { maxLives: CAMPAIGN_LIVES, totemsEnabled: false },
      win: { kind: "territory_pct", targetPct: 0.45 },
    },
    powerups: ["head_start", "speed", "extra_life"],
    unlock: { requires: "c4" },
    rewards: { coin: 150, xp: 140, energy: 2 },
  },
] as const;

// ---- Power-up → modifier khởi tạo (doc 28 §E2) ------------------------------------------------
//
// `applyPowerups` là hàm THUẦN: nhận config gốc của cấp + power-up đã chọn, trả config MỚI đã
// áp modifier. KHÔNG chạm code chết/hồi sinh nóng ⇒ dùng chung client (dựng ván) lẫn server
// (đối chiếu/kiểm). Không chọn gì ⇒ trả config TƯƠNG ĐƯƠNG gốc (bất biến).

/** Hệ số power-up (đặt ở đây để chỉnh một chỗ; tương lai có thể đưa vào catalog). */
export const POWERUP_TUNING = {
  /** `speed`: nhân dải tốc độ nền lên. */
  speedFactor: 1.15,
  /** `head_start`: cộng thêm vào bán kính cụm lãnh thổ khởi đầu (START_RADIUS). */
  headStartRadiusBonus: 1,
  /** `extra_life`: cộng thêm vào số mạng của cấp (rules.maxLives). */
  extraLifeBonus: 1,
} as const;

/**
 * Áp power-up đã chọn lên config gốc của cấp. MVP P2 hiện thực 2 loại có ánh xạ config sạch:
 * - `speed`: nhân `rules.speed.{min,max}` với `speedFactor`.
 * - `head_start`: cộng `headStartRadiusBonus` vào `rules.startRadius` (cụm khởi đầu lớn hơn).
 * - `extra_life`: cộng `extraLifeBonus` vào `rules.maxLives` (thêm mạng — chỉ có tác dụng ở cấp
 *   có `maxLives > 0`; doc 28 §E2b). Cấp vô hạn mạng (maxLives=0) thì +1 vẫn là mạng hữu hạn.
 */
export function applyPowerups(
  base: MatchConfigInput,
  picks: readonly PowerupKind[],
): MatchConfigInput {
  let out: MatchConfigInput = base;
  for (const p of picks) {
    if (p === "head_start") {
      const cur = out.rules?.startRadius ?? CONFIG.START_RADIUS;
      out = { ...out, rules: { ...out.rules, startRadius: cur + POWERUP_TUNING.headStartRadiusBonus } };
    } else if (p === "speed") {
      const min = out.rules?.speed?.min ?? CONFIG.SPEED.BY_KING_PCT.MIN;
      const max = out.rules?.speed?.max ?? CONFIG.SPEED.BY_KING_PCT.MAX;
      out = {
        ...out,
        rules: {
          ...out.rules,
          speed: { min: min * POWERUP_TUNING.speedFactor, max: max * POWERUP_TUNING.speedFactor },
        },
      };
    } else if (p === "extra_life") {
      const cur = out.rules?.maxLives ?? 0;
      out = { ...out, rules: { ...out.rules, maxLives: cur + POWERUP_TUNING.extraLifeBonus } };
    }
  }
  return out;
}

/** Tính SAO cho một lượt QUA MÀN theo số lần chết (0 chết = 3⭐, ≤1 = 2⭐, còn lại = 1⭐).
 *  Chỉ gọi khi đã thắng — thua thì không có sao. Thuần → server có thể tự tính lại để không tin client. */
export function campaignStars(deaths: number): number {
  if (deaths <= 0) return 3;
  if (deaths <= 1) return 2;
  return 1;
}

// ---- Kết luận một lượt Campaign (doc 35 §A3 lớp 1) -----------------------------------------
//
// TRƯỚC: client tự khai `objectiveMet`/`stars`/`score`, server nhận thẳng rồi phát thưởng ⇒ sửa
// client là farm được coin/XP/năng lượng vô hạn.
// NAY: client chỉ gửi DỮ KIỆN THÔ; server tự kết luận bằng hàm dưới đây, đối chiếu cấu hình cấp
// lấy từ database. Hàm THUẦN nên client dùng lại được để hiện kết quả — cùng một chuẩn hai phía,
// không từ chối oan.

/** Dữ kiện thô của một lượt chơi. Cố ý KHÔNG có "đã thắng chưa" và "mấy sao". */
export interface CampaignOutcomeFacts {
  /** Số lần chết trong lượt. */
  deaths: number;
  /** % lãnh thổ đạt được, thang 0..100. */
  territoryPct: number;
  /** Số totem đã thu. */
  totemsCaptured: number;
  /** Số giây đã giữ ngôi King (chỉ dùng cho objective `king_hold`). */
  kingHeldSec: number;
}

export interface CampaignOutcome {
  objectiveMet: boolean;
  /** 0 khi không đạt. */
  stars: number;
  /** 0 khi không đạt. */
  score: number;
  /** Mã lý do khi không đạt (để log/khiếu nại). Rỗng khi đạt. */
  reason: string;
}

/** Kẹp dữ kiện thô về khoảng hợp lệ. Không phải số hữu hạn ⇒ 0 (không ném lỗi: dữ liệu bẩn
 *  chỉ nên làm KHÔNG ĐẠT, chứ không nên làm sập request). */
function clampFact(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return Math.min(max, Math.max(min, n));
}

/** Trần số totem một cấp có thể thu được — dùng để chặn khai khống `totemsCaptured`. */
function totemCapOf(config: MatchConfigInput): number {
  const resolved = resolveMatchConfig(config);
  const authored = resolved.map.totems;
  if (authored && authored.length > 0) return authored.length;
  if (!resolved.rules.totemsEnabled) return 0;
  const t = resolved.rules.totems;
  return t.speedCount + t.slowCount + t.radarCount;
}

/**
 * Kết luận một lượt Campaign từ dữ kiện thô + cấu hình cấp.
 *
 * `elapsedSec` phải do **server** đo (từ `campaign_plays.created_at`), KHÔNG nhận của client —
 * đó là dữ kiện duy nhất server tự biết chắc, và là thứ chặn objective `survive`.
 *
 * Mọi dữ kiện còn lại đều bị KẸP theo cấu hình cấp trước khi xét: `totemsCaptured` không vượt số
 * totem cấp đó thực sự có, `kingHeldSec` không vượt thời gian đã chơi, `territoryPct` trong 0..100.
 */
export function evaluateCampaignOutcome(
  config: MatchConfigInput,
  facts: Partial<CampaignOutcomeFacts>,
  elapsedSec: number,
): CampaignOutcome {
  const resolved = resolveMatchConfig(config);
  const win = resolved.win;
  const elapsed = clampFact(elapsedSec, 0, Number.MAX_SAFE_INTEGER);

  const deaths = Math.floor(clampFact(facts.deaths, 0, 9999));
  const territoryPct = clampFact(facts.territoryPct, 0, 100);
  const totemsCaptured = Math.floor(clampFact(facts.totemsCaptured, 0, totemCapOf(config)));
  const kingHeldSec = clampFact(facts.kingHeldSec, 0, elapsed);

  const fail = (reason: string): CampaignOutcome => ({ objectiveMet: false, stars: 0, score: 0, reason });

  // Hết mạng thì THUA, bất kể objective — chặn việc vừa chết sạch vừa khai đã qua màn.
  const maxLives = resolved.rules.maxLives;
  if (maxLives > 0 && deaths >= maxLives) return fail("out_of_lives");

  let met = false;
  switch (win.kind) {
    case "territory_pct":
      // `targetPct` là PHÂN SỐ 0..1 (trình vẽ/catalog), `territoryPct` là thang 0..100 — doc 33 §4c.
      // Thiếu `targetPct` thì lùi về `kingPct` — PHẢI giống hệt engine (state.ts, nhánh
      // territory_pct). `resolveMatchConfig` không đặt mặc định cho `targetPct`, nên nếu ở đây
      // lùi về vô cực trong khi engine lùi về kingPct thì client tuyên bố thắng còn server từ chối
      // MỌI lần nộp: người chơi mất năng lượng mỗi lượt và không bao giờ mở khoá được cấp kế.
      met = territoryPct >= (win.targetPct !== undefined ? win.targetPct * 100 : win.kingPct);
      break;
    case "survive":
      met = elapsed >= (win.durationSec ?? Number.POSITIVE_INFINITY);
      break;
    case "capture_totems":
      met = totemsCaptured >= (win.totemGoal ?? Number.POSITIVE_INFINITY);
      break;
    case "king_hold":
      met = kingHeldSec >= win.winHoldTime;
      break;
    case "none":
      // Luyện tập endless — không có gì để "qua màn", không cấp thưởng.
      return fail("objective_none");
  }
  if (!met) return fail("objective_not_met");

  // GIỚI HẠN đã biết: `stars` suy từ `deaths` và `score` suy từ `territoryPct` — cả hai đều do
  // client khai và server KHÔNG có dữ kiện nào đối chiếu được (sim campaign chạy ở client). Ở đây
  // server KẸP BIÊN chứ không xác minh. Điều này chấp nhận được vì thưởng lấy từ cấu hình cấp và
  // `complete_campaign_level` chống replay bằng `completed_at` — tức là không farm được tiền.
  // Nhưng ĐỪNG xây bảng xếp hạng hay điều kiện mở khoá lên `stars`/`best_score` khi chưa có lớp
  // xác minh thật (doc 35 §A3 lớp 3 — replay input ở server).
  return {
    objectiveMet: true,
    stars: campaignStars(deaths),
    score: Math.round(territoryPct * 10),
    reason: "",
  };
}

/** Tra cấp theo id. */
export function levelById(id: string): CampaignLevel | undefined {
  return CAMPAIGN_LEVELS.find((l) => l.id === id);
}

/** Cấp đã MỞ KHÓA chưa, cho tập id đã hoàn thành `cleared`. Thuần → dùng chung client/server
 *  (client tô lưới; server chặn nộp cấp chưa mở). Cấp `requires=null` luôn mở. Dùng catalog HẰNG
 *  (fallback). Cho cấp lấy từ DB (P3), dùng [[isUnlockedIn]] với danh sách fetch. */
export function isUnlocked(id: string, cleared: ReadonlySet<string>): boolean {
  return isUnlockedIn(CAMPAIGN_LEVELS, id, cleared);
}

/** Như `isUnlocked` nhưng tra trong DANH SÁCH cấp truyền vào (nguồn từ Supabase — doc 29 L2/L3). */
export function isUnlockedIn(levels: readonly CampaignLevel[], id: string, cleared: ReadonlySet<string>): boolean {
  const lvl = levels.find((l) => l.id === id);
  if (!lvl) return false;
  const req = lvl.unlock.requires;
  return req === null || cleared.has(req);
}

// ---- Admin tạo/sửa cấp (doc 29 §L4/§L5) -------------------------------------------------------

const WIN_KINDS = ["king_hold", "territory_pct", "survive", "capture_totems", "none"];
const POWERUP_KINDS: PowerupKind[] = ["speed", "head_start", "extra_life"];
const TOTEM_KINDS = ["speed", "slow", "radar"];

/** Bản nháp cấp mà admin nhập (khớp payload API + form trình vẽ). Map 1-1 sang hàng `campaign_levels`. */
export interface CampaignLevelDraft {
  id: string;
  sortOrder: number;
  name: string;
  config: MatchConfigInput;
  powerups: PowerupKind[];
  unlockRequires: string | null;
  rewards: { coin: number; xp: number; energy: number };
  published: boolean;
}

/** Kiểm bản nháp cấp (thuần) → mảng lỗi (rỗng = hợp lệ). Dùng ở CẢ controller (chặn publish hỏng)
 *  lẫn trình vẽ (báo lỗi tức thì). KHÔNG kiểm unlock tồn tại/chu trình — cần toàn tập (làm ở server). */
export function validateLevelDraft(d: CampaignLevelDraft): string[] {
  const errs: string[] = [];
  if (!d.id || !/^[a-z0-9_-]+$/i.test(d.id)) errs.push("id phải chỉ gồm chữ/số/gạch (a-z0-9-_)");
  if (!Number.isInteger(d.sortOrder) || d.sortOrder < 1) errs.push("sortOrder phải là số nguyên ≥ 1");
  if (!d.name || d.name.trim().length === 0) errs.push("name không được rỗng");
  const kind = d.config?.win?.kind;
  if (!kind || !WIN_KINDS.includes(kind)) errs.push("win.kind không hợp lệ");
  for (const p of d.powerups ?? []) if (!POWERUP_KINDS.includes(p)) errs.push(`power-up lạ: ${p}`);
  for (const key of ["coin", "xp", "energy"] as const) {
    const v = d.rewards?.[key];
    if (!Number.isInteger(v) || v < 0) errs.push(`rewards.${key} phải là số nguyên ≥ 0`);
  }
  const totems = d.config?.map?.totems;
  if (totems !== undefined) {
    if (!Array.isArray(totems)) errs.push("map.totems phải là mảng");
    else {
      const seen = new Set<string>();
      for (const t of totems) {
        if (!t || !TOTEM_KINDS.includes(t.kind)) errs.push(`totem kind lạ: ${t?.kind}`);
        if (!Number.isInteger(t?.q) || !Number.isInteger(t?.r)) errs.push("totem q/r phải là số nguyên");
        const k = `${t?.q},${t?.r}`;
        if (seen.has(k)) errs.push(`totem trùng ô: ${k}`);
        seen.add(k);
      }
    }
  }
  try { resolveMatchConfig(d.config); } catch { errs.push("config không dựng được (resolveMatchConfig ném)"); }
  return errs;
}

/** Kiểm tra tính nhất quán catalog (dùng trong test + có thể gọi lúc boot server). Ném nếu hỏng. */
export function validateCampaignCatalog(levels: readonly CampaignLevel[] = CAMPAIGN_LEVELS): void {
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const l of levels) {
    if (ids.has(l.id)) throw new Error(`Campaign: trùng id ${l.id}`);
    ids.add(l.id);
    if (orders.has(l.order)) throw new Error(`Campaign: trùng order ${l.order}`);
    orders.add(l.order);
    // config phải hợp lệ (resolve không ném).
    resolveMatchConfig(l.config);
  }
  for (const l of levels) {
    const req = l.unlock.requires;
    if (req !== null && !ids.has(req)) throw new Error(`Campaign: ${l.id} yêu cầu id lạ ${req}`);
    if (req === l.id) throw new Error(`Campaign: ${l.id} tự yêu cầu chính nó`);
  }
}
