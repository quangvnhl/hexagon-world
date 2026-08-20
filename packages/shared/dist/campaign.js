"use strict";
// Campaign (Cấp độ) — catalog cấp độ là DỮ LIỆU THUẦN (doc 25 §2.3, doc 28 E1).
//
// Mỗi cấp = một `MatchConfigInput` (map/obstacle/bot/rules + objective ở `win`) cộng metadata
// mở khóa/thưởng. Import ĐƯỢC ở cả client (chọn/chơi) lẫn server (verify thưởng/mở khóa) nên
// KHÔNG phụ thuộc React/Nest — chỉ toán + type từ gói shared.
//
// PHẠM VI P2 (chủ ý): catalog HARDCODE ~5 cấp mẫu. Schema Level trên Supabase + trình vẽ admin
// là P3 (doc 25 §4) — khi đó chỉ cần thay nguồn `CAMPAIGN_LEVELS` bằng dữ liệu fetch, giữ nguyên
// type `CampaignLevel` + các helper thuần bên dưới.
Object.defineProperty(exports, "__esModule", { value: true });
exports.POWERUP_TUNING = exports.CAMPAIGN_LEVELS = void 0;
exports.applyPowerups = applyPowerups;
exports.campaignStars = campaignStars;
exports.levelById = levelById;
exports.isUnlocked = isUnlocked;
exports.isUnlockedIn = isUnlockedIn;
exports.validateLevelDraft = validateLevelDraft;
exports.validateCampaignCatalog = validateCampaignCatalog;
const config_1 = require("./config");
const hex_1 = require("./hex");
const match_config_1 = require("./match-config");
// Vài cụm ô chướng ngại nhỏ quanh tâm cho cấp dùng obstacle (S7 — barrier nội bộ, biên vẫn lồi).
const wallColumn = [(0, hex_1.key)(2, -1), (0, hex_1.key)(2, 0), (0, hex_1.key)(2, 1)];
const pillars = [(0, hex_1.key)(-3, 1), (0, hex_1.key)(3, -1), (0, hex_1.key)(0, 3), (0, hex_1.key)(0, -3)];
/** Số mạng mặc định mỗi cấp Campaign (mô hình "hết mạng = thua" — doc 28 §E2b). */
const CAMPAIGN_LIVES = 3;
/** Catalog Campaign P2 — 5 cấp mẫu, độ khó tăng dần, phủ đủ 3 loại objective + obstacle. */
exports.CAMPAIGN_LEVELS = [
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
];
// ---- Power-up → modifier khởi tạo (doc 28 §E2) ------------------------------------------------
//
// `applyPowerups` là hàm THUẦN: nhận config gốc của cấp + power-up đã chọn, trả config MỚI đã
// áp modifier. KHÔNG chạm code chết/hồi sinh nóng ⇒ dùng chung client (dựng ván) lẫn server
// (đối chiếu/kiểm). Không chọn gì ⇒ trả config TƯƠNG ĐƯƠNG gốc (bất biến).
/** Hệ số power-up (đặt ở đây để chỉnh một chỗ; tương lai có thể đưa vào catalog). */
exports.POWERUP_TUNING = {
    /** `speed`: nhân dải tốc độ nền lên. */
    speedFactor: 1.15,
    /** `head_start`: cộng thêm vào bán kính cụm lãnh thổ khởi đầu (START_RADIUS). */
    headStartRadiusBonus: 1,
    /** `extra_life`: cộng thêm vào số mạng của cấp (rules.maxLives). */
    extraLifeBonus: 1,
};
/**
 * Áp power-up đã chọn lên config gốc của cấp. MVP P2 hiện thực 2 loại có ánh xạ config sạch:
 * - `speed`: nhân `rules.speed.{min,max}` với `speedFactor`.
 * - `head_start`: cộng `headStartRadiusBonus` vào `rules.startRadius` (cụm khởi đầu lớn hơn).
 * - `extra_life`: cộng `extraLifeBonus` vào `rules.maxLives` (thêm mạng — chỉ có tác dụng ở cấp
 *   có `maxLives > 0`; doc 28 §E2b). Cấp vô hạn mạng (maxLives=0) thì +1 vẫn là mạng hữu hạn.
 */
function applyPowerups(base, picks) {
    let out = base;
    for (const p of picks) {
        if (p === "head_start") {
            const cur = out.rules?.startRadius ?? config_1.CONFIG.START_RADIUS;
            out = { ...out, rules: { ...out.rules, startRadius: cur + exports.POWERUP_TUNING.headStartRadiusBonus } };
        }
        else if (p === "speed") {
            const min = out.rules?.speed?.min ?? config_1.CONFIG.SPEED.BY_KING_PCT.MIN;
            const max = out.rules?.speed?.max ?? config_1.CONFIG.SPEED.BY_KING_PCT.MAX;
            out = {
                ...out,
                rules: {
                    ...out.rules,
                    speed: { min: min * exports.POWERUP_TUNING.speedFactor, max: max * exports.POWERUP_TUNING.speedFactor },
                },
            };
        }
        else if (p === "extra_life") {
            const cur = out.rules?.maxLives ?? 0;
            out = { ...out, rules: { ...out.rules, maxLives: cur + exports.POWERUP_TUNING.extraLifeBonus } };
        }
    }
    return out;
}
/** Tính SAO cho một lượt QUA MÀN theo số lần chết (0 chết = 3⭐, ≤1 = 2⭐, còn lại = 1⭐).
 *  Chỉ gọi khi đã thắng — thua thì không có sao. Thuần → server có thể tự tính lại để không tin client. */
function campaignStars(deaths) {
    if (deaths <= 0)
        return 3;
    if (deaths <= 1)
        return 2;
    return 1;
}
/** Tra cấp theo id. */
function levelById(id) {
    return exports.CAMPAIGN_LEVELS.find((l) => l.id === id);
}
/** Cấp đã MỞ KHÓA chưa, cho tập id đã hoàn thành `cleared`. Thuần → dùng chung client/server
 *  (client tô lưới; server chặn nộp cấp chưa mở). Cấp `requires=null` luôn mở. Dùng catalog HẰNG
 *  (fallback). Cho cấp lấy từ DB (P3), dùng [[isUnlockedIn]] với danh sách fetch. */
function isUnlocked(id, cleared) {
    return isUnlockedIn(exports.CAMPAIGN_LEVELS, id, cleared);
}
/** Như `isUnlocked` nhưng tra trong DANH SÁCH cấp truyền vào (nguồn từ Supabase — doc 29 L2/L3). */
function isUnlockedIn(levels, id, cleared) {
    const lvl = levels.find((l) => l.id === id);
    if (!lvl)
        return false;
    const req = lvl.unlock.requires;
    return req === null || cleared.has(req);
}
// ---- Admin tạo/sửa cấp (doc 29 §L4/§L5) -------------------------------------------------------
const WIN_KINDS = ["king_hold", "territory_pct", "survive", "capture_totems", "none"];
const POWERUP_KINDS = ["speed", "head_start", "extra_life"];
const TOTEM_KINDS = ["speed", "slow", "radar"];
/** Kiểm bản nháp cấp (thuần) → mảng lỗi (rỗng = hợp lệ). Dùng ở CẢ controller (chặn publish hỏng)
 *  lẫn trình vẽ (báo lỗi tức thì). KHÔNG kiểm unlock tồn tại/chu trình — cần toàn tập (làm ở server). */
function validateLevelDraft(d) {
    const errs = [];
    if (!d.id || !/^[a-z0-9_-]+$/i.test(d.id))
        errs.push("id phải chỉ gồm chữ/số/gạch (a-z0-9-_)");
    if (!Number.isInteger(d.sortOrder) || d.sortOrder < 1)
        errs.push("sortOrder phải là số nguyên ≥ 1");
    if (!d.name || d.name.trim().length === 0)
        errs.push("name không được rỗng");
    const kind = d.config?.win?.kind;
    if (!kind || !WIN_KINDS.includes(kind))
        errs.push("win.kind không hợp lệ");
    for (const p of d.powerups ?? [])
        if (!POWERUP_KINDS.includes(p))
            errs.push(`power-up lạ: ${p}`);
    for (const key of ["coin", "xp", "energy"]) {
        const v = d.rewards?.[key];
        if (!Number.isInteger(v) || v < 0)
            errs.push(`rewards.${key} phải là số nguyên ≥ 0`);
    }
    const totems = d.config?.map?.totems;
    if (totems !== undefined) {
        if (!Array.isArray(totems))
            errs.push("map.totems phải là mảng");
        else {
            const seen = new Set();
            for (const t of totems) {
                if (!t || !TOTEM_KINDS.includes(t.kind))
                    errs.push(`totem kind lạ: ${t?.kind}`);
                if (!Number.isInteger(t?.q) || !Number.isInteger(t?.r))
                    errs.push("totem q/r phải là số nguyên");
                const k = `${t?.q},${t?.r}`;
                if (seen.has(k))
                    errs.push(`totem trùng ô: ${k}`);
                seen.add(k);
            }
        }
    }
    try {
        (0, match_config_1.resolveMatchConfig)(d.config);
    }
    catch {
        errs.push("config không dựng được (resolveMatchConfig ném)");
    }
    return errs;
}
/** Kiểm tra tính nhất quán catalog (dùng trong test + có thể gọi lúc boot server). Ném nếu hỏng. */
function validateCampaignCatalog(levels = exports.CAMPAIGN_LEVELS) {
    const ids = new Set();
    const orders = new Set();
    for (const l of levels) {
        if (ids.has(l.id))
            throw new Error(`Campaign: trùng id ${l.id}`);
        ids.add(l.id);
        if (orders.has(l.order))
            throw new Error(`Campaign: trùng order ${l.order}`);
        orders.add(l.order);
        // config phải hợp lệ (resolve không ném).
        (0, match_config_1.resolveMatchConfig)(l.config);
    }
    for (const l of levels) {
        const req = l.unlock.requires;
        if (req !== null && !ids.has(req))
            throw new Error(`Campaign: ${l.id} yêu cầu id lạ ${req}`);
        if (req === l.id)
            throw new Error(`Campaign: ${l.id} tự yêu cầu chính nó`);
    }
}
