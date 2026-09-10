"use client";

// doc 35 §B2 — bảng điểm danh hằng ngày ở lobby.
//
// ┌─ ĐỒNG HỒ ĐẾM NGƯỢC KHÔNG PHẢI TRANG TRÍ ───────────────────────────────────────────────────┐
// │ Mốc reset là 00:00 UTC (chốt #3). Người chơi ở Việt Nam thấy nó rơi vào 7 giờ sáng, người   │
// │ ở Mỹ thấy vào giữa chiều — không ai đoán được từ "ngày mai". Không có đếm ngược thì mỗi     │
// │ lần đổi ngày là một lần người chơi tưởng mình bị mất chuỗi.                                  │
// │ Phép tính lấy từ `msToNextReset` trong `@hexagon/shared`, ĐÚNG hàm mà server dùng để cắt     │
// │ ngày — nên đồng hồ không bao giờ về 0 sớm hơn hay muộn hơn quyết định của server.            │
// └──────────────────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ VÌ SAO KHÔNG TỰ NHẬN HỘ NGƯỜI CHƠI ──────────────────────────────────────────────────────┐
// │ Mở bảng ra thì chỉ ĐỌC (`/v1/daily`), phải bấm mới nhận (`/v1/daily/claim`). Tự gọi claim   │
// │ khi mở là biến việc mở app thành hành động cấp tiền — và effect của React chạy lại khi      │
// │ quay lại tab, khi HMR, khi StrictMode. Server vẫn chặn được nhờ khoá ngày, nhưng người chơi │
// │ sẽ không bao giờ THẤY phần thưởng của mình, và đó là mất trắng cả tác dụng giữ chân.        │
// └──────────────────────────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useState } from "react";
import { msToNextReset } from "@hexagon/shared";
import { claimDailyReward, getDailyReward, type DailyRewardStatus } from "@/lib/backend";

function demNguoc(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const gio = Math.floor(s / 3600);
  const phut = Math.floor((s % 3600) / 60);
  const giay = s % 60;
  return `${String(gio).padStart(2, "0")}:${String(phut).padStart(2, "0")}:${String(giay).padStart(2, "0")}`;
}

export function DailyRewardPanel() {
  const [trangThai, setTrangThai] = useState<DailyRewardStatus | null>(null);
  const [dangNhan, setDangNhan] = useState(false);
  const [thongBao, setThongBao] = useState<string | null>(null);
  const [conLai, setConLai] = useState(() => msToNextReset(Date.now()));

  useEffect(() => {
    let huy = false;
    // Lỗi ở đây KHÔNG được làm hỏng lobby: người chưa đăng nhập gọi endpoint này sẽ bị từ chối,
    // và đó là chuyện bình thường chứ không phải sự cố. Im lặng ẩn bảng đi.
    getDailyReward().then((t) => { if (!huy) setTrangThai(t); }).catch(() => {});
    return () => { huy = true; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setConLai(msToNextReset(Date.now())), 1000);
    return () => clearInterval(id);
  }, []);

  const nhan = useCallback(async () => {
    setDangNhan(true);
    try {
      const kq = await claimDailyReward();
      setThongBao(
        kq.already_claimed
          ? "Hôm nay đã nhận rồi."
          : `+${kq.coin} coin${kq.energy > 0 ? ` · +${kq.energy} năng lượng` : ""} · chuỗi ${kq.streak} ngày`,
      );
      setTrangThai(await getDailyReward());
    } catch {
      setThongBao("Chưa nhận được. Thử lại sau.");
    } finally {
      setDangNhan(false);
    }
  }, []);

  if (!trangThai) return null;

  return (
    <section style={{ display: "grid", gap: 8, padding: 12, borderRadius: 12, background: "rgba(255,255,255,.06)" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "space-between" }}>
        <strong>Điểm danh</strong>
        <span style={{ fontSize: 12, opacity: 0.75 }}>
          Chuỗi {trangThai.streak} ngày · đổi ngày sau {demNguoc(conLai)}
        </span>
      </header>

      <ol style={{ display: "flex", gap: 6, listStyle: "none", margin: 0, padding: 0 }}>
        {trangThai.config.map((ngay) => {
          const laHomNay = ngay.cycle_day === trangThai.next_cycle_day;
          return (
            <li
              key={ngay.cycle_day}
              title={ngay.label}
              style={{
                flex: 1, textAlign: "center", padding: "6px 2px", borderRadius: 8, fontSize: 11,
                background: laHomNay ? "rgba(255,226,122,.22)" : "rgba(255,255,255,.05)",
                outline: laHomNay ? "1px solid rgba(255,226,122,.55)" : "none",
              }}
            >
              <div style={{ opacity: 0.65 }}>{ngay.cycle_day}</div>
              <div style={{ fontWeight: 600 }}>{ngay.coin}</div>
              {ngay.energy > 0 && <div style={{ opacity: 0.75 }}>+{ngay.energy}⚡</div>}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={nhan}
        disabled={dangNhan || trangThai.claimed_today}
        style={{ padding: "8px 12px", borderRadius: 8, cursor: trangThai.claimed_today ? "default" : "pointer" }}
      >
        {trangThai.claimed_today ? "Đã nhận hôm nay" : dangNhan ? "Đang nhận..." : "Nhận thưởng"}
      </button>

      {thongBao && <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>{thongBao}</p>}
    </section>
  );
}
