"use client";

// doc 35 §B4 — thưởng theo mốc cấp độ ở lobby.
//
// ┌─ VÌ SAO PANEL NÀY TỰ ẨN KHI KHÔNG CÓ GÌ ──────────────────────────────────────────────────┐
// │ Khác điểm danh (luôn có việc để làm mỗi ngày), thưởng cấp chỉ xuất hiện khi người chơi VỪA │
// │ vượt một mốc. Để một ô "không có gì để nhận" nằm thường trực ở lobby là dạy người chơi bỏ  │
// │ qua chỗ đó — và rồi họ sẽ bỏ qua cả lúc nó có thưởng thật.                                  │
// │ Nên: có mốc chờ thì hiện; không có thì chỉ còn một dòng nhỏ nói mốc kế tiếp.                │
// └──────────────────────────────────────────────────────────────────────────────────────────┘

import { useCallback, useEffect, useState } from "react";
import { claimLevelRewards, getLevelRewards, type LevelRewardStatus } from "@/lib/backend";

export function LevelRewardPanel() {
  const [trangThai, setTrangThai] = useState<LevelRewardStatus | null>(null);
  const [dangNhan, setDangNhan] = useState(false);
  const [thongBao, setThongBao] = useState<string | null>(null);

  useEffect(() => {
    let huy = false;
    // Người chưa đăng nhập bị từ chối — chuyện bình thường, không phải sự cố. Ẩn đi.
    getLevelRewards().then((t) => { if (!huy) setTrangThai(t); }).catch(() => {});
    return () => { huy = true; };
  }, []);

  const nhan = useCallback(async () => {
    setDangNhan(true);
    try {
      const kq = await claimLevelRewards();
      setThongBao(
        kq.claimed_levels.length === 0
          ? "Chưa có mốc nào để nhận."
          : `+${kq.coin} coin${kq.energy > 0 ? ` · +${kq.energy} năng lượng` : ""} · mốc ${kq.claimed_levels.join(", ")}`,
      );
      setTrangThai(await getLevelRewards());
    } catch {
      setThongBao("Chưa nhận được. Thử lại sau.");
    } finally {
      setDangNhan(false);
    }
  }, []);

  if (!trangThai) return null;

  const cho = trangThai.pending;
  const tongCoin = cho.reduce((a, m) => a + m.coin, 0);
  const tongNangLuong = cho.reduce((a, m) => a + m.energy, 0);

  if (cho.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
        Cấp {trangThai.level}
        {trangThai.next
          ? ` · mốc kế tiếp: cấp ${trangThai.next.level} (+${trangThai.next.coin} coin)`
          : " · đã qua hết mốc thưởng"}
      </p>
    );
  }

  return (
    <section style={{ display: "grid", gap: 8, padding: 12, borderRadius: 12, background: "rgba(74,222,128,.10)" }}>
      <header style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "space-between" }}>
        <strong>Thưởng cấp độ</strong>
        <span style={{ fontSize: 12, opacity: 0.75 }}>Cấp {trangThai.level}</span>
      </header>

      <p style={{ margin: 0, fontSize: 12 }}>
        {cho.length} mốc chờ nhận: {cho.map((m) => m.level).join(", ")} — tổng +{tongCoin} coin
        {tongNangLuong > 0 && ` · +${tongNangLuong}⚡`}
      </p>

      <button type="button" onClick={nhan} disabled={dangNhan} style={{ padding: "8px 12px", borderRadius: 8, cursor: "pointer" }}>
        {dangNhan ? "Đang nhận..." : `Nhận ${cho.length} mốc`}
      </button>

      {thongBao && <p style={{ margin: 0, fontSize: 12, opacity: 0.85 }}>{thongBao}</p>}
    </section>
  );
}
