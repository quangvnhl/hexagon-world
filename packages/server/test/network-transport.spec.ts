import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { NetworkMetrics, NetworkTransport } from "../src/net/network-transport";

function socket(bufferedAmount: number) {
  const sent: unknown[] = [];
  const ws = {
    readyState: WebSocket.OPEN,
    bufferedAmount,
    send(data: unknown) { sent.push(data); },
  } as unknown as WebSocket;
  return { ws, sent };
}

describe("NetworkTransport", () => {
  it("drops hot-path frames for a slow client but keeps control and keyframes", () => {
    const metrics = new NetworkMetrics();
    const transport = new NetworkTransport(100, metrics);
    const slow = socket(100);

    expect(transport.send(slow.ws, new Uint8Array(20), "snapshot", { binary: true, droppable: true })).toBe(false);
    expect(transport.send(slow.ws, new Uint8Array(12), "territory_delta", { binary: true, droppable: true })).toBe(false);
    expect(transport.send(slow.ws, "control", "control")).toBe(true);
    expect(transport.send(slow.ws, new Uint8Array(30), "territory_keyframe", { binary: true })).toBe(true);

    expect(slow.sent).toHaveLength(2);
    const report = transport.snapshot();
    expect(report.totals.snapshot.dropped).toBe(1);
    expect(report.totals.territory_delta.dropped).toBe(1);
    expect(report.totals.control.frames).toBe(1);
    expect(report.totals.territory_keyframe.bytes).toBe(30);
  });

  it("reports frames, bytes/second and clears the buffered-client gauge", () => {
    const metrics = new NetworkMetrics();
    const transport = new NetworkTransport(100, metrics);
    const client = socket(0);
    transport.send(client.ws, new Uint8Array(25), "snapshot", { binary: true, droppable: true });
    transport.send(client.ws, "abc", "control");
    const report = transport.snapshot();
    expect(report.totals.snapshot).toMatchObject({ frames: 1, bytes: 25, dropped: 0 });
    expect(report.totals.control.bytes).toBe(3);
    expect(report.bytesPerSecond.snapshot).toBe(25);
    expect(report.currentBufferedConnections).toBe(0);
  });
});
