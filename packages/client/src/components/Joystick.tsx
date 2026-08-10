"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@hexagon/shared";

/**
 * Joystick ảo cho thiết bị cảm ứng.
 * - Base (vòng ngoài) cố định góc dưới-trái, knob (núm) kéo được bên trong.
 * - Dùng pointer events + setPointerCapture nên chạy cho cả chạm lẫn chuột.
 * - Báo hướng ra ngoài qua ref `dir` (không re-render mỗi frame): khi kéo quá
 *   vùng chết thì active=true & angle=<hướng world>; nhả tay/trong vùng chết → false.
 */
export function Joystick({
  dir,
}: {
  dir: React.MutableRefObject<{ active: boolean; angle: number }>;
}) {
  // Chỉ hiện trên thiết bị con trỏ "thô" (chạm). Tính trong useEffect để né SSR.
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    setCoarse(
      typeof window !== "undefined" &&
        window.matchMedia("(pointer: coarse)").matches
    );
  }, []);

  const { SIZE, KNOB, DEADZONE } = CONFIG.JOYSTICK;
  const R = SIZE / 2; // bán kính base (px)
  const baseRef = useRef<HTMLDivElement>(null);
  const activePointer = useRef<number | null>(null);
  // Vị trí núm (px) so với tâm base — dùng state để vẽ, ref để tính trong handler.
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const el = baseRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ox = clientX - cx;
    let oy = clientY - cy;
    const len = Math.hypot(ox, oy);
    // Kẹp offset về trong bán kính base để núm không văng ra ngoài.
    if (len > R) {
      ox = (ox / len) * R;
      oy = (oy / len) * R;
    }
    setKnob({ x: ox, y: oy });

    if (len < R * DEADZONE) {
      // Trong vùng chết → coi như không điều khiển.
      dir.current.active = false;
      return;
    }
    // Quy đổi màn hình → world: DOM có trục y hướng XUỐNG, nên đảo dấu oy để
    // "kéo LÊN" tương ứng world +y (giống di chuột ra xa). Xấp xỉ này đủ tốt cho
    // camera top-down nghiêng của MVP (không cần chiếu raycast thực sự).
    dir.current.angle = Math.atan2(-oy, ox);
    dir.current.active = true;
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== null) return;
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    update(e.clientX, e.clientY);
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId) return;
    update(e.clientX, e.clientY);
  };
  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointer.current !== e.pointerId) return;
    activePointer.current = null;
    dir.current.active = false;
    setKnob({ x: 0, y: 0 }); // núm bật về tâm (có transition)
  };

  // Không phải thiết bị chạm → không render gì, chuột desktop hoạt động như cũ.
  if (!coarse) return null;

  return (
    <>
      {/* Base + knob góc dưới-trái */}
      <div
        ref={baseRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          position: "fixed",
          left: "max(20px, env(safe-area-inset-left))",
          bottom: "max(20px, env(safe-area-inset-bottom))",
          width: SIZE,
          height: SIZE,
          borderRadius: "50%",
          background: "rgba(10,14,22,0.5)",
          border: "1px solid rgba(120,140,180,0.35)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          touchAction: "none",
          userSelect: "none",
          zIndex: 20,
        }}
      >
        {/* Núm */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: KNOB,
            height: KNOB,
            marginLeft: -KNOB / 2,
            marginTop: -KNOB / 2,
            borderRadius: "50%",
            background: "rgba(120,160,230,0.55)",
            border: "1px solid rgba(200,220,255,0.6)",
            transform: `translate(${knob.x}px, ${knob.y}px)`,
            transition:
              activePointer.current === null ? "transform 0.12s ease-out" : "none",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* Nút "kỹ năng" placeholder góc dưới-phải — CHƯA hoạt động.
          Dùng vật phẩm/kỹ năng (totem) sẽ thêm ở phase sau (totem là Phase 4). */}
      <div
        aria-disabled
        style={{
          position: "fixed",
          right: "max(20px, env(safe-area-inset-right))",
          bottom: "max(20px, env(safe-area-inset-bottom))",
          width: KNOB + 8,
          height: KNOB + 8,
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          background: "rgba(10,14,22,0.5)",
          border: "1px solid rgba(120,140,180,0.35)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          color: "rgba(200,215,240,0.6)",
          opacity: 0.6,
          userSelect: "none",
          zIndex: 20,
        }}
      >
        🔒
      </div>
    </>
  );
}
