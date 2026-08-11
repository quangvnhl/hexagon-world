// Hook React quản lý vòng đời NetClient và cung cấp trạng thái render mỗi frame.
// Sở hữu một NetClient duy nhất, tự connect khi mount và disconnect khi unmount.

"use client";

import { useEffect, useRef, useState } from "react";
import {
  ConnStatus,
  DEFAULT_SERVER_URL,
  NetClient,
  RenderState,
  WelcomeInfo,
} from "./NetClient";

export interface UseNetClient {
  /** Instance NetClient (để gọi sendInput từ vòng lặp điều khiển). */
  client: NetClient;
  status: ConnStatus;
  welcome: WelcomeInfo | null;
  /** Trạng thái render cập nhật theo requestAnimationFrame. */
  render: RenderState;
}

export function useNetClient(url: string = DEFAULT_SERVER_URL): UseNetClient {
  // Tạo NetClient một lần duy nhất.
  const clientRef = useRef<NetClient | null>(null);
  if (clientRef.current === null) {
    clientRef.current = new NetClient();
  }
  const client = clientRef.current;

  const [status, setStatus] = useState<ConnStatus>("idle");
  const [welcome, setWelcome] = useState<WelcomeInfo | null>(null);
  const [render, setRender] = useState<RenderState>({
    status: "idle",
    playerId: null,
    self: null,
    others: [],
    playerCount: 0,
    selfPrep: 0,
    kingHold: 0,
    ping: 0,
  });

  useEffect(() => {
    // Gắn callback rồi kết nối.
    client.handlers.onStatus = setStatus;
    client.handlers.onWelcome = setWelcome;
    client.connect(url);

    let raf = 0;
    const loop = () => {
      setRender(client.getRenderState());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      client.disconnect();
    };
    // Chỉ chạy lại khi URL đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { client, status, welcome, render };
}
