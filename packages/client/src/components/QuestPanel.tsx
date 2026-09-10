"use client";

// doc 35 §B3 — nhiệm vụ ngày/tuần ở lobby.
//
// ┌─ HAI ĐỒNG HỒ, KHÔNG PHẢI MỘT ─────────────────────────────────────────────────────────────┐
// │ Nhiệm vụ ngày đổi lúc 00:00 UTC; nhiệm vụ tuần đổi cuối Chủ nhật UTC. Gộp thành một đồng   │
// │ hồ sẽ nói dối về một trong hai — và người chơi sẽ mất một nhiệm vụ tuần vì tưởng còn thời  │
// │ gian. Cả hai phép tính lấy từ `msToPeriodEnd` trong `@hexagon/shared`, đúng hàm mà server   │
// │ dùng để chọn `period_key`.                                                                  │
// └──────────────────────────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useState } from "react";
import { msToPeriodEnd, type QuestPeriod } from "@hexagon/shared";
import { claimQuest, getQuests, type QuestRow } from "@/lib/backend";

function demNguoc(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const ngay = Math.floor(s / 86400);
  const gio = Math.floor((s % 86400) / 3600);
  const phut = Math.floor((s % 3600) / 60);
  if (ngay > 0) return `${ngay} ngày ${gio} giờ`;
  if (gio > 0) return `${gio} giờ ${phut} phút`;
  return `${phut} phút`;
}

const TEN_CHU_KY: Record<QuestPeriod, string> = { daily: "Hằng ngày", weekly: "Hằng tuần" };

export function QuestPanel() {
  const [quests, setQuests] = useState<QuestRow[] | null>(null);
  const [dangNhan, setDangNhan] = useState<string | null>(null);
  const [thongBao, setThongBao] = useState<string | null>(null);
  const [nhip, setNhip] = useState(() => Date.now());

  useEffect(() => {
    let huy = false;
    // Chưa đăng nhập thì bị từ chối — chuyện bình thường, ẩn panel đi.
    getQuests().then((q) => { if (!huy) setQuests(q); }).catch(() => {});
    return () => { huy = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNhip(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const nhan = useCallback(async (id: string) => {
    setDangNhan(id);
    try {
      const kq = await claimQuest(id);
      if (kq.ok) {
        setThongBao(`+${kq.coin} coin${kq.energy ? ` · +${kq.energy}⚡` : ""}`);
      } else {
        // `reason` là kết quả nghiệp vụ chứ không phải sự cố — nói bằng tiếng người.
        setThongBao(
          kq.reason === "already_claimed" ? "Nhiệm vụ này đã nhận rồi."
          : kq.reason === "quest_not_found" ? "Nhiệm vụ không còn hiệu lực."
          : `Chưa đủ tiến độ (${kq.progress ?? 0}/${kq.goal_value ?? "?"}).`,
        );
      }
      setQuests(await getQuests());
    } catch {
      setThongBao("Chưa nhận được. Thử lại sau.");
    } finally {
      setDangNhan(null);
    }
  }, []);

  if (!quests || quests.length === 0) return null;

  const theoChuKy = (p: QuestPeriod) => quests.filter((q) => q.period === p);

  return (
    <section style={{ display: "grid", gap: 10, padding: 12, borderRadius: 12, background: "rgba(255,255,255,.06)" }}>
      <strong>Nhiệm vụ</strong>

      {(["daily", "weekly"] as QuestPeriod[]).map((chuKy) => {
        const nhom = theoChuKy(chuKy);
        if (nhom.length === 0) return null;
        return (
          <div key={chuKy} style={{ display: "grid", gap: 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, opacity: 0.75 }}>
              <span>{TEN_CHU_KY[chuKy]}</span>
              <span>đổi sau {demNguoc(msToPeriodEnd(chuKy, nhip))}</span>
            </div>
            {nhom.map((q) => {
              const tiLe = Math.min(100, Math.round((q.progress / q.goal_value) * 100));
              return (
                <div key={q.id} style={{ display: "grid", gap: 3 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                    <span style={{ opacity: q.claimed ? 0.55 : 1 }}>{q.label}</span>
                    <span style={{ opacity: 0.7, whiteSpace: "nowrap" }}>
                      {Math.min(q.progress, q.goal_value)}/{q.goal_value} · +{q.coin}
                      {q.energy > 0 && ` · +${q.energy}⚡`}
                    </span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,.10)" }}>
                    <div style={{ width: `${tiLe}%`, height: "100%", borderRadius: 2, background: q.claimed ? "rgba(255,255,255,.25)" : "rgba(74,222,128,.75)" }} />
                  </div>
                  {q.completed && !q.claimed && (
                    <button
                      type="button"
                      onClick={() => nhan(q.id)}
                      disabled={dangNhan === q.id}
                      style={{ padding: "4px 10px", borderRadius: 6, fontSize: 12, cursor: "pointer", justifySelf: "start" }}
                    >
                      {dangNhan === q.id ? "Đang nhận..." : "Nhận"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {thongBao && <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>{thongBao}</p>}
    </section>
  );
}
