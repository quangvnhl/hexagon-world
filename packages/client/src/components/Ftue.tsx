"use client";

// Lớp phủ hướng dẫn 90 giây đầu (doc 35 §D1). Chỉ HIỂN THỊ + ĐO; toàn bộ luật vượt bước nằm ở
// `ftueSteps.ts` để test được bằng dữ liệu.
//
// Ba ràng buộc thiết kế, mỗi cái từ một cách hướng dẫn hay hỏng:
//
//  1. **Không chặn tay người chơi.** Overlay `pointer-events: none` toàn bộ trừ nút "Bỏ qua".
//     Một tutorial dạy "kéo để lái" mà lại nuốt mất cú kéo đầu tiên thì tự phá chính nó.
//  2. **Không bao giờ kẹt.** Luôn có nút "Bỏ qua", và bước cuối tự đóng sau khi khen. Người chơi
//     phải ra được sân thật kể cả khi luật vượt bước có sai.
//  3. **Đo cả lúc bỏ dở.** `ftue_step` phát khi VÀO mỗi bước và khi bỏ qua, nên tử số/mẫu số của
//     "tỉ lệ hoàn thành ≥ 70%" (doc 35 §8) đọc được từ cùng một bảng, không cần suy diễn.

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import {
  currentFtueStep,
  ftueStepCopy,
  ftueStepIndex,
  FTUE_STEP_IDS,
  type FtueSignals,
  type FtueStepId,
  type FtueThresholds,
} from "./ftueSteps";

/** Cờ đã xong/đã bỏ qua FTUE. Đặt ở localStorage vì FTUE chạy TRƯỚC khi đăng nhập (doc 35 §D1). */
export const FTUE_DONE_KEY = "hexagon.ftue.done";

/** Đã xong hoặc đã bỏ qua chưa. Đọc lỗi (Safari riêng tư, storage tắt) ⇒ coi như ĐÃ xong. */
export function ftueAlreadyDone(): boolean {
  try {
    return window.localStorage.getItem(FTUE_DONE_KEY) === "1";
  } catch {
    // Thà bỏ qua hướng dẫn còn hơn ép người quay lại xem lại mỗi lần mở app.
    return true;
  }
}

export function markFtueDone(): void {
  try {
    window.localStorage.setItem(FTUE_DONE_KEY, "1");
  } catch {
    // Không lưu được thì thôi — lần sau xem lại, không phải lỗi chặn.
  }
}

const HOLD_AFTER_LAST_MS = 1600;

export function Ftue({
  signals,
  thresholds,
  onFinish,
}: {
  signals: FtueSignals;
  thresholds: FtueThresholds;
  /** Gọi khi xong cả 3 bước HOẶC người chơi bấm "Bỏ qua". */
  onFinish: (reason: "done" | "skipped") => void;
}) {
  const step = currentFtueStep(signals, thresholds);
  const [closing, setClosing] = useState(false);
  // Bước đã phát sự kiện `ftue_step` rồi — chống phát lại mỗi frame (onStats chạy 24 lần/giây).
  const announced = useRef<Set<string>>(new Set());
  const finished = useRef(false);

  useEffect(() => {
    if (finished.current) return;
    const key = step ?? "__done__";
    if (announced.current.has(key)) return;
    announced.current.add(key);
    track("ftue_step", {
      step: step ?? "done",
      index: step ? ftueStepIndex(step) : FTUE_STEP_IDS.length,
      total: FTUE_STEP_IDS.length,
      outcome: step ? "enter" : "complete",
    });
  }, [step]);

  // Xong cả ba: giữ lời khen một nhịp rồi mới trả người chơi về sân thật.
  useEffect(() => {
    if (step !== null || finished.current) return;
    setClosing(true);
    const timer = setTimeout(() => {
      if (finished.current) return;
      finished.current = true;
      markFtueDone();
      onFinish("done");
    }, HOLD_AFTER_LAST_MS);
    return () => clearTimeout(timer);
  }, [step, onFinish]);

  const skip = () => {
    if (finished.current) return;
    finished.current = true;
    // Ghi rõ bỏ dở ở BƯỚC NÀO — "70% hoàn thành" chỉ hành động được khi biết người ta rơi ở đâu.
    track("ftue_step", {
      step: step ?? "done",
      index: step ? ftueStepIndex(step) : FTUE_STEP_IDS.length,
      total: FTUE_STEP_IDS.length,
      outcome: "skipped",
    });
    markFtueDone();
    onFinish("skipped");
  };

  const copy = step ? ftueStepCopy(step) : null;
  // Bước vừa vượt xong (để khen) — bước trước bước đang mở, hoặc bước cuối khi đã xong hết.
  const justDone: FtueStepId | null = step
    ? (FTUE_STEP_IDS[ftueStepIndex(step) - 2] ?? null)
    : FTUE_STEP_IDS[FTUE_STEP_IDS.length - 1];

  return (
    <div
      // pointer-events none: mọi cú chạm đi thẳng xuống sân (ràng buộc 1).
      style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 40 }}
      data-testid="ftue-overlay"
    >
      <div
        style={{
          position: "absolute",
          top: "max(12px, env(safe-area-inset-top))",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(440px, calc(100vw - 24px))",
          padding: "12px 14px",
          borderRadius: 14,
          background: "rgba(12,14,22,0.82)",
          backdropFilter: "blur(6px)",
          color: "#fff",
          textAlign: "center",
          boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 8 }}>
          {FTUE_STEP_IDS.map((id) => {
            const passed = step === null || ftueStepIndex(id) < ftueStepIndex(step);
            const active = id === step;
            return (
              <span
                key={id}
                style={{
                  width: active ? 26 : 18,
                  height: 4,
                  borderRadius: 2,
                  background: passed ? "#4ade80" : active ? "#fff" : "rgba(255,255,255,0.28)",
                  transition: "background 160ms, width 160ms",
                }}
              />
            );
          })}
        </div>

        {copy ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3 }}>{copy.title}</div>
            <div style={{ fontSize: 13, opacity: 0.78, marginTop: 4, lineHeight: 1.4 }}>{copy.hint}</div>
          </>
        ) : (
          <div style={{ fontSize: 16, fontWeight: 700, color: "#4ade80" }}>
            {ftueStepCopy(FTUE_STEP_IDS[FTUE_STEP_IDS.length - 1]).done}
          </div>
        )}

        {copy && justDone && (
          <div style={{ fontSize: 12, color: "#4ade80", marginTop: 6 }}>{ftueStepCopy(justDone).done}</div>
        )}
      </div>

      {!closing && (
        <button
          onClick={skip}
          style={{
            position: "absolute",
            top: "max(12px, env(safe-area-inset-top))",
            right: "max(12px, env(safe-area-inset-right))",
            pointerEvents: "auto",
            padding: "6px 12px",
            borderRadius: 999,
            border: "1px solid rgba(255,255,255,0.22)",
            background: "rgba(12,14,22,0.7)",
            color: "rgba(255,255,255,0.8)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Bỏ qua
        </button>
      )}
    </div>
  );
}
