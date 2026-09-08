// doc 35 §A3 lớp 3 (lát a3.3) — xác minh sâu bằng cách chạy lại input của client.
//
// Engine chạy lại được kiểm ở `packages/shared/src/__tests__/replay.test.ts`. File này kiểm phần
// QUYẾT ĐỊNH: cái gì thành `mismatch`, cái gì chỉ là `skipped`, và seed nào được dùng.
//
// Hai bài đầu tiên là hai bài đắt nhất nếu sai:
//   • dùng seed của trace thay vì seed của server ⇒ kẻ gian chỉ cần gửi kèm seed khớp với ván giả
//     của mình, và cả lớp 3 trở thành trang trí;
//   • gộp "không xác minh được" vào `mismatch` ⇒ những lần lệch THẬT bị chôn giữa một đống nhiễu.
import { describe, expect, it, vi } from "vitest";
import type { SupabaseService } from "../src/database/supabase.service";
import { REPLAY_FRAME_BUDGET, ReplayService } from "../src/campaign/replay.service";
import { GameState, TraceRecorder, type InputTrace } from "@hexagon/shared";

const LEVEL = { win: { kind: "none" as const }, bots: { count: 2 } };

/** Mô phỏng đúng cách client sẽ làm: mô phỏng bằng CHÍNH giá trị mà `record()` trả về. */
function honestPlay(seed: number, frames = 600) {
  const rec = new TraceRecorder(seed);
  const game = new GameState({ config: { ...LEVEL, seed } });
  for (let i = 0; i < frames; i++) {
    const q = rec.record(1 / 60 + Math.sin(i * 0.37) * 0.0031, i * 0.02);
    game.setHeadingTarget(q.heading!);
    game.update(q.dt);
  }
  return {
    trace: rec.build() as InputTrace,
    facts: {
      deaths: game.human.deaths,
      territoryPct: game.territoryPct(),
      totemsCaptured: game.human.totemsCaptured,
      kingHeldSec: 0,
    },
  };
}

function dbStub() {
  const updates: Record<string, unknown>[] = [];
  const service = {
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: async () => ({ data: [], error: null }) };
      },
    }),
  } as unknown as SupabaseService;
  return { service, updates };
}

describe("ReplayService — seed của SERVER, không phải seed trong trace", () => {
  it("người chơi trung thực ⇒ ok", async () => {
    const { trace, facts } = honestPlay(31337);
    const svc = new ReplayService(dbStub().service);
    const r = await svc.evaluate({ playId: "p1", seed: 31337, config: LEVEL, trace, claimed: facts });
    expect(r.status).toBe("ok");
    expect(r.frames).toBe(trace.dt.length);
  });

  it("trace mang seed KHÁC ⇒ vẫn chạy lại bằng seed của server", async () => {
    // Đây là luật quan trọng nhất của lát này. Trace do client gửi, nên seed trong đó cũng do
    // client chọn. Nếu server tin nó, kẻ gian dựng một ván giả rồi gửi kèm seed của ván giả đó và
    // mọi thứ khớp hoàn hảo.
    const { trace, facts } = honestPlay(31337);
    const svc = new ReplayService(dbStub().service);
    const forged = { ...trace, seed: 999999 };
    const r = await svc.evaluate({ playId: "p1", seed: 31337, config: LEVEL, trace: forged, claimed: facts });
    expect(r.status, "seed trong trace phải bị bỏ qua").toBe("ok");
  });

  it("khai 90% trong khi ván chạy lại ra ít hơn nhiều ⇒ mismatch", async () => {
    const { trace, facts } = honestPlay(31337);
    const svc = new ReplayService(dbStub().service);
    const r = await svc.evaluate({
      playId: "p1", seed: 31337, config: LEVEL, trace,
      claimed: { ...facts, territoryPct: 90 },
    });
    expect(r.status).toBe("mismatch");
    expect(r.diffs?.[0]?.field).toBe("territoryPct");
  });
});

describe("ReplayService — 'không xác minh được' KHÔNG phải 'gian lận'", () => {
  const svc = () => new ReplayService(dbStub().service);
  const { trace, facts } = honestPlay(31337, 120);

  it("lượt chơi CŨ chưa có seed ⇒ skipped/no_seed, không phải mismatch", async () => {
    // Mọi lượt chơi trước migration `202609080001` có `seed = 0`. Chúng không xác minh được, và
    // gọi chúng là gian lận sẽ tạo ra một làn sóng báo động giả đúng ngày phát hành.
    const r = await svc().evaluate({ playId: "p1", seed: 0, config: LEVEL, trace, claimed: facts });
    expect(r).toMatchObject({ status: "skipped", reason: "no_seed" });
  });

  it("client CŨ không gửi trace ⇒ skipped/no_trace", async () => {
    // doc 35 §A8: Telegram Mini App không ép cập nhật được, nên sẽ luôn có người ở bản cũ.
    const r = await svc().evaluate({ playId: "p1", seed: 5, config: LEVEL, trace: undefined, claimed: facts });
    expect(r).toMatchObject({ status: "skipped", reason: "no_trace" });
  });

  it("trace hỏng ⇒ skipped/bad_trace", async () => {
    for (const bad of [{ v: 99 }, { v: 1, seed: 1, dt: [1], hdg: [] }, "khong-phai-object", 42]) {
      expect(await svc().evaluate({ playId: "p1", seed: 5, config: LEVEL, trace: bad, claimed: facts }))
        .toMatchObject({ status: "skipped", reason: "bad_trace" });
    }
  });
});

describe("ReplayService — không được làm hỏng gì khác", () => {
  it("ghi kết quả vào campaign_plays", async () => {
    const db = dbStub();
    const { trace, facts } = honestPlay(31337, 120);
    await new ReplayService(db.service).verify({ playId: "p1", seed: 31337, config: LEVEL, trace, claimed: facts });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]).toMatchObject({ verify_status: "ok" });
  });

  it("database hỏng ⇒ verify() vẫn trả kết quả, KHÔNG ném", async () => {
    // Xác minh sâu chạy sau khi phần thưởng đã cấp. Một lỗi ghi log ở đây không được phép nổi lên
    // thành lỗi chưa bắt trong tiến trình server.
    const boom = { from: () => ({ update: () => { throw new Error("mat ket noi"); } }) } as unknown as SupabaseService;
    const { trace, facts } = honestPlay(31337, 120);
    await expect(new ReplayService(boom).verify({ playId: "p1", seed: 31337, config: LEVEL, trace, claimed: facts }))
      .resolves.toMatchObject({ status: "ok" });
  });

  it("schedule() trả về NGAY, không chờ chạy lại", () => {
    // Người chơi không phải đợi một phép kiểm mà kết quả của nó không đổi được gì cho lượt này.
    const db = dbStub();
    const svc = new ReplayService(db.service);
    const spy = vi.spyOn(svc, "verify");
    const { trace, facts } = honestPlay(31337, 120);
    svc.schedule({ playId: "p1", seed: 31337, config: LEVEL, trace, claimed: facts });
    expect(spy, "verify không được gọi đồng bộ").not.toHaveBeenCalled();
    expect(db.updates, "chưa ghi gì khi schedule() trả về").toHaveLength(0);
  });
});

describe("ReplayService — không được làm khựng vòng lặp game", () => {
  it("chạy lại TRẢ QUYỀN giữa các đoạn, không chiếm vòng lặp sự kiện", async () => {
    // Đo được: chạy lại 5.400 khung (ván 90 giây) tốn 91,8 ms, trong khi một tick của server game
    // 24 Hz là 41,7 ms — và `main.ts` gắn NetServer vào CÙNG tiến trình khi SERVER_ROLE khác
    // "control". Chạy liền một mạch nghĩa là mỗi lần có người hoàn thành cấp thì cả phòng online
    // khựng hơn hai tick.
    //
    // Cách đo: đặt một timer 0 ms lặp lại và đếm số lần nó chạy được TRONG khi replay đang chạy.
    // Chiếm vòng lặp thì con số đó là 0.
    const { trace, facts } = honestPlay(31337, REPLAY_FRAME_BUDGET * 4);
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 0);
    try {
      await new ReplayService(dbStub().service).evaluate({
        playId: "p1", seed: 31337, config: LEVEL, trace, claimed: facts,
      });
    } finally {
      clearInterval(timer);
    }
    expect(ticks, "vòng lặp sự kiện phải chạy được trong lúc chạy lại").toBeGreaterThan(0);
  });
});
