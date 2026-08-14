"use client";

import { memo, useEffect, useRef } from "react";
import { CONFIG } from "@hexagon/shared";

/**
 * Đồng hồ FPS + thời gian khung (ms) — overlay DOM góc dưới-trái, KHÔNG re-render React
 * (ghi thẳng textContent trong vòng rAF riêng). Dùng để đo tụt khung khi đông bot. Màu
 * đổi theo mức: ≥50 xanh, ≥30 vàng, <30 đỏ. Bật/tắt qua CONFIG.DISPLAY.FPS.
 */
export const FpsMeter = memo(function FpsMeter({
  statusText = "Local",
}: {
  statusText?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const statusRef = useRef(statusText);
  statusRef.current = statusText;

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let acc = 0;
    let last = performance.now();
    let worst = 0; // ms khung tệ nhất trong cửa sổ đo

    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      frames++;
      acc += dt;
      if (dt > worst) worst = dt;

      // Cập nhật hiển thị ~2 lần/giây cho ổn định số.
      if (acc >= 500) {
        const fps = Math.round((frames * 1000) / acc);
        const el = ref.current;
        if (el) {
          const color = fps >= 50 ? "#7CFFB0" : fps >= 30 ? "#ffd23f" : "#ff6b6b";
          el.style.color = color;
          el.textContent = `${fps} FPS · ${worst.toFixed(1)} ms · ${statusRef.current}`;
        }
        frames = 0;
        acc = 0;
        worst = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left:
          "max(10px, env(safe-area-inset-left, 0px), var(--tg-safe-area-inset-left, 0px), var(--tg-content-safe-area-inset-left, 0px), var(--telegram-safe-left, 0px))",
        bottom:
          "max(10px, env(safe-area-inset-bottom, 0px), var(--tg-safe-area-inset-bottom, 0px), var(--tg-content-safe-area-inset-bottom, 0px))",
        padding: "3px 7px",
        borderRadius: 999,
        background: "rgba(10,14,22,0.72)",
        color: "#7CFFB0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "clamp(7px, 2.25vw, 10px)",
        fontWeight: 700,
        letterSpacing: 0.2,
        pointerEvents: "none",
        backdropFilter: "blur(6px)",
        zIndex: 20,
      }}
    >
      — FPS · {statusText}
    </div>
  );
});

/** Tiện: chỉ render khi cờ bật (giữ JSX gọi gọn ở scene). */
export function FpsMeterIfEnabled({ statusText }: { statusText?: string }) {
  return CONFIG.DISPLAY.FPS ? <FpsMeter statusText={statusText} /> : null;
}
