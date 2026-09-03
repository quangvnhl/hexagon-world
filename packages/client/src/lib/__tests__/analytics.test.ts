import { describe, it, expect, vi } from "vitest";
import { createAnalytics, resolveAnonId, ANON_ID_KEY, BUFFER_KEY } from "../analytics";
import type { AnalyticsContext } from "@hexagon/shared";

const CTX: AnalyticsContext = { sessionId: "s1", anonId: "a1", platform: "telegram", buildId: "b1" };

/** localStorage giả, có thể ép ném lỗi để mô phỏng chế độ riêng tư. */
function memStorage(seed: Record<string, string> = {}, broken = false) {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (k: string) => { if (broken) throw new Error("blocked"); return map.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (broken) throw new Error("blocked"); map.set(k, v); },
    removeItem: (k: string) => { if (broken) throw new Error("blocked"); map.delete(k); },
  };
}

/** `send` giả: ghi lại các lô đã gửi, kết quả do `ok` quyết định. */
function recorder(ok = true) {
  const bodies: string[] = [];
  return {
    bodies,
    send: vi.fn(async (_url: string, body: string) => { bodies.push(body); return ok; }),
    events: () => bodies.flatMap((b) => (JSON.parse(b) as { events: unknown[] }).events),
  };
}

describe("Gom lô", () => {
  it("chưa đủ lô ⇒ CHƯA gửi", () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, batchSize: 5 });
    a.track("app_open");
    a.track("mode_select");
    expect(r.send).not.toHaveBeenCalled();
    expect(a.pending()).toBe(2);
  });

  it("đủ lô ⇒ gửi ngay, hàng đợi rỗng", async () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, batchSize: 3 });
    a.track("app_open");
    a.track("mode_select");
    a.track("match_start");
    await vi.waitFor(() => expect(r.send).toHaveBeenCalledTimes(1));
    expect(a.pending()).toBe(0);
    expect(r.events()).toHaveLength(3);
  });

  it("flush() thủ công gửi phần còn lại; hàng đợi rỗng thì không gọi mạng", async () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, batchSize: 100 });
    a.track("app_open");
    await a.flush();
    expect(r.events()).toHaveLength(1);

    await a.flush();
    expect(r.send).toHaveBeenCalledTimes(1); // không gửi lô rỗng
  });

  it("payload đúng dạng { events: [...] } và mang đủ bối cảnh", async () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, now: () => 1700 });
    a.track("match_end", { mode: "campaign" });
    await a.flush();
    const body = JSON.parse(r.bodies[0]) as { events: Array<Record<string, unknown>> };
    expect(Object.keys(body)).toEqual(["events"]);
    expect(body.events[0]).toMatchObject({
      name: "match_end", ts: 1700, sessionId: "s1", anonId: "a1", platform: "telegram", buildId: "b1",
      props: { mode: "campaign" },
    });
  });
});

describe("Không mất sự kiện khi mạng hỏng", () => {
  it("gửi thất bại ⇒ đệm vào storage", async () => {
    const store = memStorage();
    const r = recorder(false); // server từ chối
    const a = createAnalytics(CTX, { send: r.send, storage: store, batchSize: 100 });
    a.track("app_open");
    await a.flush();
    const buffered = JSON.parse(store.map.get(BUFFER_KEY) ?? "[]") as unknown[];
    expect(buffered).toHaveLength(1);
  });

  it("send NÉM LỖI cũng đệm lại, không vỡ ra ngoài", async () => {
    const store = memStorage();
    const a = createAnalytics(CTX, {
      send: vi.fn(async () => { throw new Error("mạng chết"); }),
      storage: store, batchSize: 100,
    });
    a.track("app_open");
    await expect(a.flush()).resolves.toBeUndefined();
    expect(JSON.parse(store.map.get(BUFFER_KEY) ?? "[]")).toHaveLength(1);
  });

  it("client MỚI nạp lại phần đã đệm và gửi được ở lần sau", async () => {
    const store = memStorage();
    const fail = recorder(false);
    const a1 = createAnalytics(CTX, { send: fail.send, storage: store, batchSize: 100 });
    a1.track("app_open");
    a1.track("mode_select");
    await a1.flush();

    const ok = recorder(true);
    const a2 = createAnalytics(CTX, { send: ok.send, storage: store, batchSize: 100 });
    expect(a2.pending()).toBe(2); // nạp lại từ đệm
    await a2.flush();
    expect(ok.events()).toHaveLength(2);
    expect(store.map.get(BUFFER_KEY)).toBeUndefined(); // đã dọn
  });

  it("vượt trần đệm ⇒ bỏ cái CŨ NHẤT, giữ cái mới", async () => {
    const store = memStorage();
    const r = recorder(false);
    const a = createAnalytics(CTX, { send: r.send, storage: store, batchSize: 100, maxBuffered: 3 });
    for (let i = 0; i < 5; i++) a.track("app_open", { i });
    await a.flush();
    const buffered = JSON.parse(store.map.get(BUFFER_KEY) ?? "[]") as Array<{ props: { i: number } }>;
    expect(buffered.map((e) => e.props.i)).toEqual([2, 3, 4]);
  });

  it("đệm JSON hỏng ⇒ bỏ qua, không chặn vĩnh viễn", () => {
    const store = memStorage({ [BUFFER_KEY]: "{không phải JSON" });
    const a = createAnalytics(CTX, { storage: store });
    expect(a.pending()).toBe(0);
  });
});

describe("Rời trang", () => {
  it("flushOnExit dùng beacon (đồng bộ), không đụng tới đường fetch", () => {
    const beacon = vi.fn(() => true);
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, sendBeacon: beacon, batchSize: 100 });
    a.track("session_end");
    a.flushOnExit();
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(r.send).not.toHaveBeenCalled();
    expect(a.pending()).toBe(0);
  });

  it("không có beacon (hoặc beacon từ chối) ⇒ đệm lại để phiên sau gửi", () => {
    const store = memStorage();
    const a = createAnalytics(CTX, { sendBeacon: null, storage: store, batchSize: 100 });
    a.track("session_end");
    a.flushOnExit();
    expect(JSON.parse(store.map.get(BUFFER_KEY) ?? "[]")).toHaveLength(1);

    const store2 = memStorage();
    const b = createAnalytics(CTX, { sendBeacon: () => false, storage: store2, batchSize: 100 });
    b.track("session_end");
    b.flushOnExit();
    expect(JSON.parse(store2.map.get(BUFFER_KEY) ?? "[]")).toHaveLength(1);
  });
});

describe("Không bao giờ làm hỏng game", () => {
  it("storage bị chặn (chế độ riêng tư) ⇒ vẫn ghi nhận và gửi bình thường", async () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, storage: memStorage({}, true), batchSize: 100 });
    expect(() => a.track("app_open")).not.toThrow();
    await expect(a.flush()).resolves.toBeUndefined();
    expect(r.events()).toHaveLength(1);
  });

  it("resolveAnonId: có sẵn thì dùng lại, chưa có thì tạo và lưu, storage hỏng thì vẫn trả id", () => {
    const store = memStorage({ [ANON_ID_KEY]: "cũ" });
    expect(resolveAnonId(store)).toBe("cũ");

    const fresh = memStorage();
    const created = resolveAnonId(fresh);
    expect(created.length).toBeGreaterThan(0);
    expect(fresh.map.get(ANON_ID_KEY)).toBe(created);

    expect(resolveAnonId(memStorage({}, true)).length).toBeGreaterThan(0);
    expect(resolveAnonId(null).length).toBeGreaterThan(0);
  });

  it("PII lọt vào lúc gọi track vẫn bị chặn (hợp đồng shared)", async () => {
    const r = recorder();
    const a = createAnalytics(CTX, { send: r.send, batchSize: 100 });
    a.track("login_success", { email: "a@b.com", provider: "telegram" });
    await a.flush();
    const ev = r.events()[0] as { props: Record<string, unknown> };
    expect(ev.props).toEqual({ provider: "telegram" });
  });
});
