"use client";

import { useEffect, useRef, useState } from "react";
import { CONFIG } from "@hexagon/shared";

type DirectionRef = React.MutableRefObject<{ active: boolean; angle: number }>;

/**
 * Joystick nổi cho mobile: chạm vào bất kỳ vùng trống nào của màn chơi để đặt tâm joystick.
 * Touch không đi xuyên sang mouse steering và các control tương tác (Menu/HUD/button/input) được bỏ qua.
 */
export function Joystick({ dir }: { dir: DirectionRef }) {
  const [coarse, setCoarse] = useState(false);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const originRef = useRef<{ x: number; y: number } | null>(null);
  const activePointer = useRef<number | null>(null);
  const { SIZE, KNOB, DEADZONE } = CONFIG.JOYSTICK;
  const radius = SIZE / 2;

  useEffect(() => {
    const media = window.matchMedia("(pointer: coarse)");
    const sync = () => setCoarse(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!coarse) return;

    const reset = () => {
      activePointer.current = null;
      originRef.current = null;
      dir.current.active = false;
      setKnob({ x: 0, y: 0 });
      setOrigin(null);
    };

    const update = (clientX: number, clientY: number) => {
      const center = originRef.current;
      if (!center) return;
      let ox = clientX - center.x;
      let oy = clientY - center.y;
      const length = Math.hypot(ox, oy);
      if (length > radius) {
        ox = (ox / length) * radius;
        oy = (oy / length) * radius;
      }
      setKnob({ x: ox, y: oy });
      if (length < radius * DEADZONE) {
        dir.current.active = false;
        return;
      }
      dir.current.angle = Math.atan2(-oy, ox);
      dir.current.active = true;
    };

    const isInteractive = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest("button,input,textarea,select,a,[role='button']") !== null;

    const onPointerDown = (event: PointerEvent) => {
      if (
        event.pointerType === "mouse" ||
        activePointer.current !== null ||
        isInteractive(event.target)
      )
        return;
      activePointer.current = event.pointerId;
      const nextOrigin = { x: event.clientX, y: event.clientY };
      originRef.current = nextOrigin;
      setOrigin(nextOrigin);
      setKnob({ x: 0, y: 0 });
      dir.current.active = false;
      event.preventDefault();
    };

    const onPointerMove = (event: PointerEvent) => {
      if (activePointer.current !== event.pointerId) return;
      update(event.clientX, event.clientY);
      event.preventDefault();
    };

    const onPointerEnd = (event: PointerEvent) => {
      if (activePointer.current !== event.pointerId) return;
      reset();
      event.preventDefault();
    };

    window.addEventListener("pointerdown", onPointerDown, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointermove", onPointerMove, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointerup", onPointerEnd, {
      capture: true,
      passive: false,
    });
    window.addEventListener("pointercancel", onPointerEnd, {
      capture: true,
      passive: false,
    });
    window.addEventListener("blur", reset);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointermove", onPointerMove, true);
      window.removeEventListener("pointerup", onPointerEnd, true);
      window.removeEventListener("pointercancel", onPointerEnd, true);
      window.removeEventListener("blur", reset);
      activePointer.current = null;
      originRef.current = null;
      dir.current.active = false;
    };
  }, [DEADZONE, coarse, dir, radius]);

  if (!coarse || !origin) return null;

  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: origin.x - radius,
        top: origin.y - radius,
        width: SIZE,
        height: SIZE,
        borderRadius: "50%",
        background: "rgba(10,14,22,0.5)",
        border: "1px solid rgba(120,140,180,0.4)",
        boxShadow: "0 8px 28px rgba(0,0,0,0.28)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents: "none",
        userSelect: "none",
        zIndex: 20,
      }}
    >
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
          background: "rgba(120,160,230,0.62)",
          border: "1px solid rgba(220,232,255,0.72)",
          transform: `translate(${knob.x}px, ${knob.y}px)`,
        }}
      />
    </div>
  );
}
