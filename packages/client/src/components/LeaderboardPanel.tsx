"use client";

// doc 35 §A5 — bảng xếp hạng ở lobby.
//
// ┌─ XEM ĐƯỢC KHI CHƯA ĐĂNG NHẬP, VÀ ĐÓ LÀ CHỦ Ý ─────────────────────────────────────────────┐
// │ Các panel khác của Pha 7 (điểm danh, nhiệm vụ, thưởng cấp) đều ẩn khi chưa đăng nhập, vì   │
// │ chúng CẤP thứ gì đó. Bảng xếp hạng không cấp gì — nó là lý do để đăng nhập. Ẩn nó với      │
// │ người chưa đăng nhập là giấu đi đúng thứ đang thuyết phục họ.                              │
// └───────────────────────────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useState } from "react";
import { LEADERBOARD_SCOPES, leaderboardPeriod, msToPeriodEnd, type LeaderboardScope } from "@hexagon/shared";
import { getLeaderboard, type LeaderboardResponse } from "@/lib/backend";

const NHAN: Record<LeaderboardScope, string> = {
  weekly_territory: "Ô chiếm được",
  weekly_wins: "Trận thắng",
  campaign_stars_total: "Sao chiến dịch",
};

function demNguoc(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const ngay = Math.floor(s / 86400);
  const gio = Math.floor((s % 86400) / 3600);
  const phut = Math.floor((s % 3600) / 60);
  if (ngay > 0) return `${ngay} ngày ${gio} giờ`;
  if (gio > 0) return `${gio} giờ ${phut} phút`;
  return `${phut} phút`;
}

export function LeaderboardPanel() {
  const [scope, setScope] = useState<LeaderboardScope>("weekly_territory");
  const [bang, setBang] = useState<LeaderboardResponse | null>(null);
  const [loi, setLoi] = useState(false);
  const [nhip, setNhip] = useState(() => Date.now());

  const tai = useCallback((s: LeaderboardScope) => {
    let huy = false;
    getLeaderboard(s, 10)
      .then((b) => { if (!huy) { setBang(b); setLoi(false); } })
      .catch(() => { if (!huy) { setBang(null); setLoi(true); } });
    return () => { huy = true; };
  }, []);

  useEffect(() => tai(scope), [scope, tai]);

  useEffect(() => {
    const id = setInterval(() => setNhip(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (loi) return null;

  const ky = leaderboardPeriod(scope);

  return (
    <section style={{ display: "grid", gap: 10, padding: 12, borderRadius: 12, background: "rgba(255,255,255,.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <strong>Bảng xếp hạng</strong>
        {/* Bảng tuần đếm ngược bằng CHÍNH hàm mà nhiệm vụ tuần dùng — cùng một mốc reset UTC. */}
        {ky === "weekly" && (
          <span style={{ fontSize: 12, opacity: 0.75 }}>đổi sau {demNguoc(msToPeriodEnd("weekly", nhip))}</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {LEADERBOARD_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            style={{
              padding: "3px 9px", borderRadius: 999, fontSize: 12, cursor: "pointer",
              border: "1px solid rgba(255,255,255,.18)",
              background: s === scope ? "rgba(74,222,128,.22)" : "transparent",
            }}
          >
            {NHAN[s]}
          </button>
        ))}
      </div>

      {bang === null ? (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.6 }}>Đang tải...</p>
      ) : bang.top.length === 0 ? (
        // Kỳ mới bắt đầu thì bảng rỗng thật. Nói ra, chứ không để một khoảng trống im lặng.
        <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Chưa ai ghi điểm ở kỳ này. Chơi một trận là có tên.</p>
      ) : (
        <div style={{ display: "grid", gap: 3 }}>
          {bang.top.map((d, i) => (
            <div
              key={`${d.rank}-${d.displayName}-${i}`}
              style={{
                display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, fontSize: 12,
                padding: "2px 6px", borderRadius: 6,
                background: d.isMe ? "rgba(74,222,128,.16)" : "transparent",
              }}
            >
              <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>#{d.rank}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.displayName}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{d.score.toLocaleString("vi-VN")}</span>
            </div>
          ))}

          {/* Hạng của mình nằm ngoài top thì vẫn phải thấy — nếu không, bảng chỉ có nghĩa với người đứng đầu. */}
          {bang.me !== null && !bang.top.some((d) => d.isMe) && (
            <div
              style={{
                display: "grid", gridTemplateColumns: "28px 1fr auto", gap: 8, fontSize: 12,
                padding: "2px 6px", marginTop: 4, borderRadius: 6,
                background: "rgba(74,222,128,.16)", borderTop: "1px solid rgba(255,255,255,.12)",
              }}
            >
              <span style={{ opacity: 0.7, fontVariantNumeric: "tabular-nums" }}>#{bang.me.rank}</span>
              <span>Bạn</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{bang.me.score.toLocaleString("vi-VN")}</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
