"use client";

// doc 35 §C4 (lát c4.2) — hai quyền mà trang `/privacy` đã hứa, đặt ở nơi người dùng với tới được.
//
// Telegram yêu cầu ba trang pháp lý phải với tới được từ trong app; cùng lý do đó áp cho hai
// quyền này. Một chính sách nói "bạn có quyền xuất và xoá" mà chỗ bấm chỉ tồn tại trong một email
// gửi cho bộ phận hỗ trợ thì là quyền trên giấy.
//
// Ba quyết định về giao diện, mỗi cái từ một cách hỏng:
//
//  1. **Xuất trước, xoá sau, và nút xuất đứng trước.** Xoá không lấy lại được; đường tải dữ liệu về
//     phải nằm ngay trên nó chứ không phải ở một trang khác.
//  2. **Bắt gõ đúng một chữ để xác nhận**, không phải một `confirm()`. Đây là hành động không hoàn
//     tác được trên một màn hình cảm ứng — một cú chạm nhầm không được đủ để thực hiện nó.
//  3. **Nói trước cái gì KHÔNG bị xoá.** Người dùng biết trước thì không thấy bị lừa khi phát hiện
//     chứng từ giao dịch vẫn còn. Câu chữ ở đây phải khớp `/privacy`.

import { useState } from "react";
import { LEGAL } from "@/lib/legal";
import { deleteMyAccount, exportMyData } from "@/lib/backend";

/** Chuỗi người dùng phải gõ đúng. Tiếng Việt không dấu để gõ được trên mọi bàn phím. */
const CONFIRM_WORD = "XOA";

export function AccountPanel({ onDeleted }: { onDeleted?: () => void }) {
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const doExport = async () => {
    setBusy("export");
    setError(null);
    try {
      const data = await exportMyData();
      // Tải về ngay tại máy, không gửi qua đâu cả. `URL.revokeObjectURL` trong `finally` của chính
      // nhánh này: giữ blob sống sau khi tải xong là rò bộ nhớ trong một Mini App chạy dài.
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `hexagon-world-du-lieu-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xuất được dữ liệu");
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async () => {
    if (confirm.trim().toUpperCase() !== CONFIRM_WORD) return;
    setBusy("delete");
    setError(null);
    try {
      await deleteMyAccount();
      setDone(true);
      onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không xoá được tài khoản");
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    return (
      <div style={box}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Đã nhận yêu cầu xoá</div>
        <p style={p}>
          Tài khoản đã bị vô hiệu. Dữ liệu chơi sẽ bị xoá hẳn sau {LEGAL.deletionGraceDays} ngày.
          Muốn đổi ý trong thời gian đó, liên hệ {LEGAL.contactEmail || "bộ phận hỗ trợ"}.
        </p>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Dữ liệu của bạn</div>

      <button onClick={() => void doExport()} disabled={busy !== null} style={btn}>
        {busy === "export" ? "Đang chuẩn bị…" : "Tải dữ liệu của tôi (.json)"}
      </button>
      <p style={p}>Tải xuống ngay tại máy bạn. Nên làm việc này trước khi xoá.</p>

      <div style={{ height: 1, background: "rgba(255,255,255,0.12)", margin: "14px 0" }} />

      <div style={{ fontWeight: 700, marginBottom: 6, color: "#f87171" }}>Xoá tài khoản</div>
      <p style={p}>
        Tài khoản bị vô hiệu ngay, dữ liệu chơi bị xoá hẳn sau {LEGAL.deletionGraceDays} ngày.
        <br />
        <strong>Không</strong> bị xoá theo: chứng từ giao dịch (pháp luật buộc lưu) và các sự kiện
        sử dụng vốn đã ẩn danh.
      </p>
      <label style={{ ...p, display: "block", marginBottom: 6 }}>
        Gõ <strong>{CONFIRM_WORD}</strong> để xác nhận:
      </label>
      <input
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        aria-label={`Gõ ${CONFIRM_WORD} để xác nhận xoá tài khoản`}
        style={input}
      />
      <button
        onClick={() => void doDelete()}
        disabled={busy !== null || confirm.trim().toUpperCase() !== CONFIRM_WORD}
        style={{ ...btn, background: "#7f1d1d", borderColor: "#b91c1c", marginTop: 8 }}
      >
        {busy === "delete" ? "Đang xoá…" : "Xoá tài khoản của tôi"}
      </button>

      {error && <p style={{ ...p, color: "#f87171" }}>{error}</p>}
    </div>
  );
}

const box: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 12,
  padding: 14,
  background: "rgba(12,14,22,0.55)",
  textAlign: "left",
};

const p: React.CSSProperties = { fontSize: 12, opacity: 0.75, lineHeight: 1.5, margin: "6px 0 0" };

const btn: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.06)",
  color: "inherit",
  fontSize: 13,
  cursor: "pointer",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(0,0,0,0.25)",
  color: "inherit",
  fontSize: 13,
};
