import { type MatchConfigInput } from "./match-config";
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
    unlock: {
        requires: string | null;
    };
    /** Thưởng khi qua màn (server đối chiếu catalog, KHÔNG nhận số từ client). */
    rewards: {
        coin: number;
        xp: number;
        energy: number;
    };
}
/** Catalog Campaign P2 — 5 cấp mẫu, độ khó tăng dần, phủ đủ 3 loại objective + obstacle. */
export declare const CAMPAIGN_LEVELS: readonly CampaignLevel[];
/** Hệ số power-up (đặt ở đây để chỉnh một chỗ; tương lai có thể đưa vào catalog). */
export declare const POWERUP_TUNING: {
    /** `speed`: nhân dải tốc độ nền lên. */
    readonly speedFactor: 1.15;
    /** `head_start`: cộng thêm vào bán kính cụm lãnh thổ khởi đầu (START_RADIUS). */
    readonly headStartRadiusBonus: 1;
    /** `extra_life`: cộng thêm vào số mạng của cấp (rules.maxLives). */
    readonly extraLifeBonus: 1;
};
/**
 * Áp power-up đã chọn lên config gốc của cấp. MVP P2 hiện thực 2 loại có ánh xạ config sạch:
 * - `speed`: nhân `rules.speed.{min,max}` với `speedFactor`.
 * - `head_start`: cộng `headStartRadiusBonus` vào `rules.startRadius` (cụm khởi đầu lớn hơn).
 * - `extra_life`: cộng `extraLifeBonus` vào `rules.maxLives` (thêm mạng — chỉ có tác dụng ở cấp
 *   có `maxLives > 0`; doc 28 §E2b). Cấp vô hạn mạng (maxLives=0) thì +1 vẫn là mạng hữu hạn.
 */
export declare function applyPowerups(base: MatchConfigInput, picks: readonly PowerupKind[]): MatchConfigInput;
/** Tính SAO cho một lượt QUA MÀN theo số lần chết (0 chết = 3⭐, ≤1 = 2⭐, còn lại = 1⭐).
 *  Chỉ gọi khi đã thắng — thua thì không có sao. Thuần → server có thể tự tính lại để không tin client. */
export declare function campaignStars(deaths: number): number;
/** Tra cấp theo id. */
export declare function levelById(id: string): CampaignLevel | undefined;
/** Cấp đã MỞ KHÓA chưa, cho tập id đã hoàn thành `cleared`. Thuần → dùng chung client/server
 *  (client tô lưới; server chặn nộp cấp chưa mở). Cấp `requires=null` luôn mở. Dùng catalog HẰNG
 *  (fallback). Cho cấp lấy từ DB (P3), dùng [[isUnlockedIn]] với danh sách fetch. */
export declare function isUnlocked(id: string, cleared: ReadonlySet<string>): boolean;
/** Như `isUnlocked` nhưng tra trong DANH SÁCH cấp truyền vào (nguồn từ Supabase — doc 29 L2/L3). */
export declare function isUnlockedIn(levels: readonly CampaignLevel[], id: string, cleared: ReadonlySet<string>): boolean;
/** Kiểm tra tính nhất quán catalog (dùng trong test + có thể gọi lúc boot server). Ném nếu hỏng. */
export declare function validateCampaignCatalog(levels?: readonly CampaignLevel[]): void;
