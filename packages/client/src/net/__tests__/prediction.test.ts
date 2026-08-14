import { describe, it, expect } from "vitest";
import { stepHead } from "../stepHead";
import { predict, reconcile, Predictor, PendingInput } from "../prediction";

describe("reconcile", () => {
  const speed = 5.5;
  const serverState = { x: 3, y: -2, heading: 0.2 };
  const inputs: PendingInput[] = [
    { seq: 1, targetHeading: 0.5, dt: 0.05, speed },
    { seq: 2, targetHeading: 1.0, dt: 0.05, speed },
    { seq: 3, targetHeading: 0.8, dt: 0.05, speed },
    { seq: 4, targetHeading: -0.3, dt: 0.05, speed },
  ];

  it("bỏ input đã ack và cho kết quả GIỐNG hệt fold stepHead trên input còn lại", () => {
    const ackSeq = 2;
    const { state, pending } = reconcile(serverState, ackSeq, inputs);

    // Input còn lại phải là seq 3 và 4.
    expect(pending.map((p) => p.seq)).toEqual([3, 4]);

    // So khớp với việc tự fold stepHead trên serverState + input sống sót.
    const expected = predict(
      serverState,
      inputs.filter((i) => i.seq > ackSeq),
    );
    expect(state).toEqual(expected);
  });

  it("ackSeq >= mọi seq → không còn input, trạng thái = serverState", () => {
    const { state, pending } = reconcile(serverState, 99, inputs);
    expect(pending).toEqual([]);
    expect(state).toEqual(serverState);
  });

  it("ackSeq = 0 → giữ toàn bộ input, replay đầy đủ", () => {
    const { state, pending } = reconcile(serverState, 0, inputs);
    expect(pending.map((p) => p.seq)).toEqual([1, 2, 3, 4]);
    let s = serverState;
    for (const i of inputs) s = stepHead(s, i.targetHeading, i.dt, i.speed);
    expect(state).toEqual(s);
  });
});

describe("Predictor", () => {
  const speed = 5.5;
  it("respawn reset drops old-life inputs and renders exactly at spawn", () => {
    const p = new Predictor();
    p.reset({ x: 2, y: 3, heading: 0 });
    p.applyInput(1, 0.5, 0.05, speed);
    expect(p.pendingCount()).toBe(1);

    const spawn = { x: 35, y: -18, heading: 1.1 };
    p.reset(spawn);

    expect(p.pendingCount()).toBe(0);
    expect(p.getPredicted()).toEqual(spawn);
    expect(p.getRenderHead()).toEqual(spawn);
  });

  it("applyInput dự đoán tức thì; onServerState hòa giải khớp replay", () => {
    const p = new Predictor();
    const start = { x: 0, y: 0, heading: 0 };
    p.reset(start);

    // Người chơi bấm 3 input.
    p.applyInput(1, 0.5, 0.05, speed);
    p.applyInput(2, 0.7, 0.05, speed);
    const afterThree = p.applyInput(3, 0.9, 0.05, speed);
    expect(p.pendingCount()).toBe(3);

    // Kiểm tra dự đoán = fold stepHead từ start.
    const manual = predict(start, [
      { seq: 1, targetHeading: 0.5, dt: 0.05, speed },
      { seq: 2, targetHeading: 0.7, dt: 0.05, speed },
      { seq: 3, targetHeading: 0.9, dt: 0.05, speed },
    ]);
    expect(afterThree).toEqual(manual);

    // Server xác nhận tới seq 2, kèm một trạng thái server (giả lập).
    const serverState = { x: 0.4, y: 0.05, heading: 0.6 };
    const corrected = p.onServerState(serverState, 2);
    expect(p.pendingCount()).toBe(1); // chỉ còn seq 3

    const expected = stepHead(serverState, 0.9, 0.05, speed);
    expect(corrected).toEqual(expected);
  });

  it("replay giữ tốc độ của từng input khi modifier đổi", () => {
    const start = { x: 0, y: 0, heading: 0 };
    const inputs: PendingInput[] = [
      { seq: 1, targetHeading: 0, dt: 0.1, speed: 1 },
      { seq: 2, targetHeading: 0, dt: 0.1, speed: 8 },
    ];
    const predicted = predict(start, inputs);
    expect(predicted.x).toBeCloseTo(0.9, 6);
    expect(reconcile(start, 1, inputs).state.x).toBeCloseTo(0.8, 6);
  });
});
