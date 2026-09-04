// FTUE có ĐI ĐẾN ĐÍCH ĐƯỢC trên engine THẬT không? (doc 35 §D1: "90 giây đầu", mục tiêu hoàn
// thành ≥ 70%).
//
// Vì sao cần file này bên cạnh `ftueSteps.test.ts`: file kia kiểm luật trên số do TEST tự bịa ra,
// nên nó xanh kể cả khi ngưỡng đặt ở mức không ai với tới. Đây đúng là kiểu lỗi mà `AGENTS.md`
// gọi là "hai lớp cùng tính một thứ rồi trôi khỏi nhau": ngưỡng ở remote config và sân chơi thật
// tiến hoá độc lập, và không có gì nổ ra khi chúng lệch — người mới chỉ lặng lẽ bỏ game.
//
// Nên file này chạy `GameState` thật, lái nó bằng vài kiểu "người mới lóng ngóng", rồi hỏi bộ luật
// FTUE xem đã tới bước mấy. Ngưỡng mặc định đọc thẳng từ `REMOTE_CONFIG_DEFAULTS` — đổi số ở đó mà
// làm FTUE bất khả thi thì test này đỏ ngay, không đợi tới lúc đọc báo cáo.
import { describe, expect, it } from "vitest";
import { GameState, REMOTE_CONFIG_DEFAULTS } from "@hexagon/shared";
import { CLAIM_EPSILON_PCT, currentFtueStep, type FtueSignals, type FtueStepId } from "../ftueSteps";

const TICK = 1 / 24;
/** Tâm sân — ĐÚNG ô mà trang chủ đặt cho ván FTUE. Test phải chơi trên cùng điều kiện với người
 *  chơi thật, nếu không nó chỉ đang nghiệm thu một trò chơi khác. */
const FTUE_SPAWN = { q: 0, r: 0 };
const FTUE_SECONDS = 90;
const BOT_COUNT = Number(REMOTE_CONFIG_DEFAULTS["ftue.bot_count"]);
const THRESHOLDS = {
  claims: Number(REMOTE_CONFIG_DEFAULTS["ftue.step3_claims"]),
  targetPct: Number(REMOTE_CONFIG_DEFAULTS["ftue.step3_target_pct"]),
};

/** Chạy một ván FTUE mô phỏng; trả về bước đạt xa nhất và giây đạt được. */
function playFtue(steer: (t: number) => number, seconds = FTUE_SECONDS) {
  const game = new GameState({ config: { win: { kind: "none" }, bots: { count: BOT_COUNT } }, spawnAt: FTUE_SPAWN });
  const signals: FtueSignals = { steered: false, pct: 0, startPct: -1, claims: 0 };
  const reachedAt: Partial<Record<FtueStepId | "done", number>> = {};
  // Bản sao ĐÚNG cách `app/page.tsx` đếm số lần khép vòng: vượt mốc % cao nhất từng đạt.
  let peakPct = -1;
  let deaths = 0;

  for (let i = 0; i < Math.round(seconds / TICK); i++) {
    const t = i * TICK;
    if (game.phase !== "prep") {
      // Cùng một cú chạm vừa lái game vừa bật cờ `steered` — y hệt `GameScene` làm ở 24 Hz.
      signals.steered = true;
      game.setHeadingTarget(steer(t));
    }
    game.update(TICK);
    signals.pct = game.territoryPct();
    if (signals.startPct < 0 && game.phase !== "prep") signals.startPct = signals.pct;
    if (peakPct < 0 && signals.startPct >= 0) peakPct = signals.startPct;
    if (peakPct >= 0 && signals.pct > peakPct + CLAIM_EPSILON_PCT) {
      signals.claims += 1;
      peakPct = signals.pct;
    }
    deaths = game.human.deaths;

    const step = currentFtueStep(signals, THRESHOLDS);
    const key = step ?? "done";
    if (reachedAt[key] === undefined) reachedAt[key] = t;
  }
  return { reachedAt, deaths, finalPct: game.territoryPct(), claims: signals.claims };
}

/** Người mới được bảo "đi một vòng rồi quay về" thì lái đại khái như thế này. */
const CIRCLING: [string, (t: number) => number][] = [
  ["vòng ω=0.3", (t) => t * 0.3],
  ["vòng ω=0.5", (t) => t * 0.5],
  ["vòng ω=0.7", (t) => t * 0.7],
  ["vòng ω=0.9", (t) => t * 0.9],
];

describe("FTUE đi tới đích được trên engine thật", () => {
  it.each(CIRCLING)("%s: xong cả 3 bước trong 90 giây", (_label, steer) => {
    const { reachedAt } = playFtue(steer);
    expect(reachedAt.done).toBeDefined();
    expect(reachedAt.done!).toBeLessThanOrEqual(FTUE_SECONDS);
  });

  it("sân FTUE không có bot ⇒ người học không bị xoá sổ giữa chừng", () => {
    // Đo được: chỉ cần 1 bot là quá nửa số kiểu lái của người mới chết trước giây 90. Nếu ai đó
    // đặt `ftue.bot_count` > 0 trong code mặc định, test này chỉ ra cái giá phải trả.
    expect(BOT_COUNT).toBe(0);
    for (const [, steer] of CIRCLING) expect(playFtue(steer).deaths).toBe(0);
  });

  it("ngưỡng bước 3 nằm TRONG tầm với, không phải con số trang trí", () => {
    // Chặn trên: nếu ai nâng `ftue.step3_target_pct` / `ftue.step3_claims` lên quá tay thì đây
    // là chỗ nổ, chứ không phải bảng số liệu ba tuần sau.
    for (const [, steer] of CIRCLING) {
      const { finalPct, claims } = playFtue(steer);
      expect(finalPct).toBeGreaterThanOrEqual(THRESHOLDS.targetPct);
      expect(claims).toBeGreaterThanOrEqual(THRESHOLDS.claims);
    }
  });

  it("người chơi ĐI QUA cả ba bước, không bước nào bị nhảy cóc", () => {
    // Chính bài test này bắt được lỗi thiết kế của bản nháp: khi bước 3 chỉ là mốc 0.3%, vòng
    // khép đầu tiên (0.55–2.7%) vượt luôn cả hai bước trong MỘT nhịp và bước 3 không bao giờ
    // hiện ra. Nên đây kiểm cả sự TỒN TẠI lẫn thứ tự.
    for (const [, steer] of CIRCLING) {
      const { reachedAt } = playFtue(steer);
      expect(reachedAt.move).toBeDefined();
      expect(reachedAt.claim).toBeDefined();
      expect(reachedAt.survive).toBeDefined();
      expect(reachedAt.done).toBeDefined();
      expect(reachedAt.claim!).toBeGreaterThanOrEqual(reachedAt.move!);
      expect(reachedAt.survive!).toBeGreaterThan(reachedAt.claim!);
      expect(reachedAt.done!).toBeGreaterThan(reachedAt.survive!);
    }
  });
});
