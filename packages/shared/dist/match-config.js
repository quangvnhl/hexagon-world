"use strict";
// MatchConfig — cấu hình MỘT VÁN, truyền vào `GameState` lúc tạo ván (doc 25 §1.1).
//
// NÚT THẮT P0: trước đây mọi ván đọc thẳng singleton `CONFIG` + hình học sân bị đóng băng
// lúc load module (`arena.ts`). Tách thành object per-instance để mỗi mode (Luyện tập /
// Tournament / Cấp độ) dựng sân + luật + điều kiện thắng riêng.
//
// NGUYÊN TẮC: MỌI field có default = giá trị `CONFIG` hiện tại ⇒ `resolveMatchConfig()`
// không truyền gì cho ra hành vi Y HỆT bản cũ (đảm bảo P0 KHÔNG đổi trải nghiệm).
//
// PHẠM VI P0 (chủ ý): chỉ đưa vào MatchConfig phần GameState cần để tách sân + luật cơ bản
// + điều kiện thắng. Cấu hình TOTEM và profile TỐC ĐỘ/AI bot vẫn đọc từ CONFIG (còn chia sẻ
// với totems.ts) — mở rộng vào `rules` là việc P1 khi làm preset Practice, không cần cho nền.
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveMatchConfig = resolveMatchConfig;
const config_1 = require("./config");
/** Điền default từ CONFIG rồi ghép override. Không truyền gì ⇒ bằng hành vi hiện tại. */
function resolveMatchConfig(input = {}) {
    return {
        map: {
            shape: input.map?.shape ?? "hexagon",
            radius: input.map?.radius ?? config_1.CONFIG.ARENA_RADIUS,
            wallScale: input.map?.wallScale ?? config_1.CONFIG.WALL_SCALE,
            hexSize: input.map?.hexSize ?? config_1.CONFIG.HEX_SIZE,
            mapMargin: input.map?.mapMargin ?? config_1.CONFIG.MAP_MARGIN,
            cells: input.map?.cells,
            obstacles: input.map?.obstacles,
        },
        bots: {
            count: input.bots?.count ?? config_1.CONFIG.BOT_COUNT,
            difficultyMix: input.bots?.difficultyMix,
        },
        rules: {
            prepTime: input.rules?.prepTime ?? config_1.CONFIG.PREP_TIME,
            startRadius: input.rules?.startRadius ?? config_1.CONFIG.START_RADIUS,
            spawnClearance: input.rules?.spawnClearance ?? config_1.CONFIG.SPAWN_CLEARANCE,
            turnRate: input.rules?.turnRate ?? config_1.CONFIG.TURN_RATE,
            trailPointDist: input.rules?.trailPointDist ?? config_1.CONFIG.TRAIL_POINT_DIST,
            killRadius: input.rules?.killRadius ?? config_1.CONFIG.KILL_RADIUS,
            selfTrailGrace: input.rules?.selfTrailGrace ?? config_1.CONFIG.SELF_TRAIL_GRACE,
        },
        win: {
            kind: input.win?.kind ?? "king_hold",
            kingPct: input.win?.kingPct ?? config_1.CONFIG.KING_PCT,
            winHoldTime: input.win?.winHoldTime ?? config_1.CONFIG.WIN_HOLD_TIME,
            targetPct: input.win?.targetPct,
            durationSec: input.win?.durationSec,
            totemGoal: input.win?.totemGoal,
        },
        seed: input.seed ?? 0,
    };
}
