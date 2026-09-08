// Engine chạy lại input (doc 35 §A3 lớp 3, lát a3.3).
//
// Bài quan trọng nhất ở đây là bài ĐẦU TIÊN: mô phỏng một ván y như client làm, rồi chạy lại trace
// và đòi kết quả TRÙNG KHỚP. Nếu nó đỏ thì mọi người chơi lương thiện đều bị đánh dấu nghi vấn —
// tức là lớp 3 tệ hơn hẳn việc không có lớp 3.
import { describe, it, expect } from "vitest";
import { GameState } from "../state";
import {
  MAX_TRACE_FRAMES,
  NO_INPUT,
  REPLAY_VERSION,
  TraceRecorder,
  compareFacts,
  parseTrace,
  replayTrace,
  type InputTrace,
} from "../replay";

const LEVEL = { win: { kind: "none" as const }, bots: { count: 2 } };

/**
 * Mô phỏng đúng cách client sẽ dùng: mỗi khung ghi (dt, heading) rồi mô phỏng bằng CHÍNH giá trị
 * đã làm tròn mà `record()` trả về. `dt` cố ý KHÔNG đều và không tròn — hệt rAF thật.
 */
function playLikeClient(seed: number, frames = 900) {
  const rec = new TraceRecorder(seed);
  const game = new GameState({ config: { ...LEVEL, seed } });
  for (let i = 0; i < frames; i++) {
    const dtRaw = 1 / 60 + Math.sin(i * 0.37) * 0.0031;
    // Lái vòng tròn để người chơi THẬT SỰ khép vòng và chiếm đất. Bản đầu lái lung tung và
    // `territoryPct` đứng nguyên ở 0,042% (đúng cụm xuất phát) — chạy lại một ván mà người chơi
    // không làm gì thì không chứng minh được engine tái dựng đúng.
    const heading = i * 0.02;
    const q = rec.record(dtRaw, heading);
    if (q.heading !== null) game.setHeadingTarget(q.heading);
    game.update(q.dt);
  }
  return {
    trace: rec.build()!,
    facts: {
      deaths: game.human.deaths,
      territoryPct: game.territoryPct(),
      totemsCaptured: game.human.totemsCaptured,
      kingHeldSec: 0,
    },
  };
}

describe("replayTrace — chạy lại phải ra ĐÚNG ván cũ", () => {
  // Bài này cũng chính là bài chứng minh `trace.seed` ĐƯỢC DÙNG: `playLikeClient` dựng ván bằng
  // seed 4242, nên nếu `replayTrace` bỏ qua seed (rơi về `Math.random`) thì nó không thể khớp.
  //
  // Đã THỬ viết thêm một bài "đổi seed ⇒ ván khác" và bỏ đi, vì tính chất đó KHÔNG đúng: người chơi
  // lái vòng tròn khép được diện tích như nhau dù spawn ở đâu, và với 8 bot trong 20 giây chúng vẫn
  // chưa kịp chạm tới. Hệ quả đáng nhớ: **lớp này không phát hiện được seed bị giả qua dữ kiện của
  // người chơi**, nên server phải chạy lại bằng seed của CHÍNH NÓ (`campaign_plays.seed`), không
  // bao giờ bằng seed trong trace. Chỗ đó được khoá ở `packages/server/test/replay.spec.ts`.
  it("ván mô phỏng như client ⇒ chạy lại khớp tuyệt đối", () => {
    const { trace, facts } = playLikeClient(4242);
    const out = replayTrace(LEVEL, trace);
    expect(out.facts.territoryPct).toBe(facts.territoryPct);
    expect(out.facts.deaths).toBe(facts.deaths);
    expect(out.facts.totemsCaptured).toBe(facts.totemsCaptured);
    expect(out.frames).toBe(trace.dt.length);
  });

  it("chạy lại HAI lần cùng một trace ⇒ cùng kết quả", () => {
    const { trace } = playLikeClient(99);
    expect(replayTrace(LEVEL, trace).facts).toEqual(replayTrace(LEVEL, trace).facts);
  });

  it("elapsedSec cộng lại đúng tổng dt đã ghi", () => {
    const { trace } = playLikeClient(7, 300);
    const expected = trace.dt.reduce((a, b) => a + b, 0) / 1_000_000;
    expect(replayTrace(LEVEL, trace).elapsedSec).toBeCloseTo(expected, 9);
  });
});

describe("compareFacts — lệch nghĩa là ĐÁNG XEM LẠI", () => {
  const replayed = { deaths: 1, territoryPct: 12.5, totemsCaptured: 2, kingHeldSec: 0 };

  it("khai đúng ⇒ ok", () => {
    expect(compareFacts({ ...replayed }, replayed).ok).toBe(true);
  });

  it("khai 90% trong khi ván chạy lại ra 12.5% ⇒ bắt được", () => {
    const r = compareFacts({ ...replayed, territoryPct: 90 }, replayed);
    expect(r.ok).toBe(false);
    expect(r.diffs[0]).toMatchObject({ field: "territoryPct", claimed: 90, replayed: 12.5 });
  });

  it("lệch nhỏ hơn sai số ⇒ KHÔNG báo — client đọc trước server đúng một khung", () => {
    expect(compareFacts({ ...replayed, territoryPct: 13.2 }, replayed).ok).toBe(true);
  });

  it("số ĐẾM thì so bằng, không có sai số", () => {
    expect(compareFacts({ ...replayed, deaths: 0 }, replayed).ok).toBe(false);
    expect(compareFacts({ ...replayed, totemsCaptured: 3 }, replayed).ok).toBe(false);
  });
});

describe("parseTrace — trace hỏng KHÔNG phải bằng chứng gian lận", () => {
  const good: InputTrace = { v: REPLAY_VERSION, seed: 5, dt: [16667, 16666], hdg: [NO_INPUT, 100] };

  it("trace hợp lệ đi qua", () => {
    expect(parseTrace(good)).toEqual(good);
  });

  it("mọi thứ hỏng đều trả null, không ném", () => {
    for (const bad of [
      null,
      undefined,
      "chuoi",
      { ...good, v: 99 },
      { ...good, seed: 1.5 },
      { ...good, dt: [16667] },
      { ...good, dt: [16667, 0] },
      { ...good, dt: [16667, -1] },
      { ...good, dt: [16667, 2_000_000] },
      { ...good, hdg: [NO_INPUT, 1.5] },
      { ...good, dt: [], hdg: [] },
    ]) {
      expect(parseTrace(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("vượt trần số khung ⇒ null (chặn payload làm kiệt CPU server)", () => {
    const n = MAX_TRACE_FRAMES + 1;
    expect(parseTrace({ v: REPLAY_VERSION, seed: 1, dt: new Array(n).fill(16667), hdg: new Array(n).fill(NO_INPUT) })).toBeNull();
  });
});

describe("TraceRecorder — bên ghi và bên chạy lại phải dùng chung một hiện thực", () => {
  it("record() trả về giá trị ĐÃ làm tròn để bên gọi mô phỏng bằng đúng nó", () => {
    // Nếu client mô phỏng bằng `dtRaw` rồi ghi bản làm tròn, sai lệch tích luỹ qua hàng nghìn khung.
    const rec = new TraceRecorder(1);
    const q = rec.record(0.0166666666666, 1.2345678);
    expect(q.dt).toBe(0.016667);
    expect(q.heading).toBe(1.234568);
  });

  it("không có khung nào ⇒ build() trả null", () => {
    expect(new TraceRecorder(1).build()).toBeNull();
  });

  it("vượt trần ⇒ build() trả null: thà không có trace còn hơn có trace sai", () => {
    const rec = new TraceRecorder(1);
    for (let i = 0; i < MAX_TRACE_FRAMES + 5; i++) rec.record(1 / 60, null);
    expect(rec.frames).toBe(MAX_TRACE_FRAMES);
    expect(rec.build()).toBeNull();
  });
});
