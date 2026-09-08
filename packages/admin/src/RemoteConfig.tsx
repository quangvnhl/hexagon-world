// doc 35 §A2 (lát a2.3) — trang sửa cấu hình từ xa trong app admin.
//
// Trước lát này, đổi một tham số kinh tế phải vào SQL Editor của Supabase. Gate đóng Pha 6 đòi
// "đổi 1 tham số kinh tế không cần deploy" — vào database bằng tay thì đúng chữ mà sai tinh thần:
// không có xác nhận, không thấy giá trị cũ, và người bấm lúc 2 giờ sáng là người dễ gõ nhầm nhất.
//
// Ba thứ trang này bắt buộc phải có, mỗi thứ vì một cách hỏng thật:
//
//  1. **Khoá lạc quan theo `version`.** Hai người cùng mở trang trong một sự cố là chuyện thường.
//     "Ai ghi sau thắng" làm mất một thay đổi kill-switch mà không ai truy ra được. Cột `version`
//     có từ lát a2.1 với đúng ghi chú "để trang admin phát hiện ghi đè lẫn nhau" — đây là chỗ nó
//     được dùng.
//  2. **Kiểm JSON TRƯỚC khi gửi.** Server cũng kiểm, nhưng bắt lỗi ngay lúc gõ thì người ta sửa
//     được; bắt lỗi sau một vòng mạng thì người ta chỉ thấy "HTTP 400".
//  3. **Xem trước bằng `?dry_run=true`.** Lát c2.2 đã dựng sẵn; ở đây nó trả lời đúng câu hỏi
//     người bấm đang lo: *giá trị hiện tại là gì, và khoá này có thật không.*

import { useCallback, useEffect, useState } from "react";
import {
  adminConfigHistory,
  adminListConfig,
  adminPreviewConfig,
  adminSetConfig,
  type AdminConfigAudit,
  type AdminConfigRow,
} from "./api";

export default function RemoteConfig({ adminKey }: { adminKey: string }) {
  const [rows, setRows] = useState<AdminConfigRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [audience, setAudience] = useState("");
  const [history, setHistory] = useState<AdminConfigAudit[]>([]);
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setRows(await adminListConfig(adminKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không đọc được cấu hình");
    }
  }, [adminKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const open = async (row: AdminConfigRow) => {
    setSelected(row.key);
    setDraft(JSON.stringify(row.value, null, 2));
    setAudience(row.audience === null ? "" : JSON.stringify(row.audience, null, 2));
    setPreview(null);
    setNotice(null);
    try {
      setHistory(await adminConfigHistory(adminKey, row.key));
    } catch {
      setHistory([]);
    }
  };

  /** `null` = hợp lệ; chuỗi = thông điệp lỗi để hiện ngay dưới ô nhập. */
  const jsonError = (text: string, allowEmpty: boolean): string | null => {
    if (allowEmpty && text.trim() === "") return null;
    try {
      JSON.parse(text);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : "JSON không hợp lệ";
    }
  };

  const valueError = jsonError(draft, false);
  const audienceError = jsonError(audience, true);
  const current = rows.find((r) => r.key === selected) ?? null;
  const canSubmit = selected !== null && !valueError && !audienceError && !busy;

  const parsed = () => ({
    value: JSON.parse(draft) as unknown,
    audience: audience.trim() === "" ? null : (JSON.parse(audience) as unknown),
  });

  const doPreview = async () => {
    if (!current || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const { value, audience: aud } = parsed();
      setPreview(await adminPreviewConfig(adminKey, current.key, value, aud, current.version));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Xem trước thất bại");
    } finally {
      setBusy(false);
    }
  };

  const doSave = async () => {
    if (!current || !canSubmit) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { value, audience: aud } = parsed();
      const res = await adminSetConfig(adminKey, current.key, value, aud, current.version);
      setNotice(`Đã lưu ${current.key} → version ${res.version}`);
      setPreview(null);
      await refresh();
      setHistory(await adminConfigHistory(adminKey, current.key));
    } catch (err) {
      // Xung đột version là trường hợp ĐÁNG NÓI RIÊNG: người dùng không làm gì sai, chỉ là có
      // người khác vừa ghi. Bảo họ tải lại rồi làm lại, đừng để họ đoán.
      const message = err instanceof Error ? err.message : "Lưu thất bại";
      setError(message.includes("version") ? `${message} — tải lại trang rồi sửa trên bản mới.` : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, alignItems: "start" }}>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong>Khoá cấu hình</strong>
          <button onClick={() => void refresh()} style={btnSmall}>Tải lại</button>
        </div>
        <div style={{ border: "1px solid #2a3145", borderRadius: 8, overflow: "hidden" }}>
          {rows.length === 0 && <div style={{ padding: 10, opacity: 0.6, fontSize: 12 }}>Chưa có khoá nào.</div>}
          {rows.map((r) => (
            <button
              key={r.key}
              onClick={() => void open(r)}
              style={{
                display: "block", width: "100%", textAlign: "left", padding: "8px 10px",
                background: r.key === selected ? "#1d2740" : "transparent",
                border: "none", borderBottom: "1px solid #222a3c", color: "inherit", cursor: "pointer", fontSize: 12,
              }}
            >
              <div style={{ fontFamily: "monospace" }}>{r.key}</div>
              <div style={{ opacity: 0.5, fontSize: 11 }}>v{r.version} · {r.updated_by ?? "?"}</div>
            </button>
          ))}
        </div>
      </div>

      <div>
        {!current && <p style={{ opacity: 0.6 }}>Chọn một khoá bên trái.</p>}
        {current && (
          <>
            <h3 style={{ margin: "0 0 4px", fontFamily: "monospace" }}>{current.key}</h3>
            <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 10 }}>
              version {current.version} · sửa lần cuối {new Date(current.updated_at).toLocaleString()} bởi {current.updated_by ?? "?"}
            </div>

            <label style={label}>Giá trị (JSON)</label>
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={8} style={area} spellCheck={false} />
            {valueError && <div style={errText}>JSON không hợp lệ: {valueError}</div>}

            <label style={label}>Đối tượng áp dụng (JSON, để trống = tất cả)</label>
            <textarea value={audience} onChange={(e) => setAudience(e.target.value)} rows={4} style={area} spellCheck={false} />
            {audienceError && <div style={errText}>JSON không hợp lệ: {audienceError}</div>}

            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => void doPreview()} disabled={!canSubmit} style={btn}>Xem trước (dry run)</button>
              <button onClick={() => void doSave()} disabled={!canSubmit} style={{ ...btn, background: "#1e3a5f" }}>Lưu</button>
            </div>

            {preview && (
              <pre style={pre}>{JSON.stringify(preview, null, 2)}</pre>
            )}
            {notice && <div style={{ ...errText, color: "#4ade80" }}>{notice}</div>}
            {error && <div style={errText}>{error}</div>}

            <h4 style={{ margin: "18px 0 6px" }}>Lịch sử (20 lần gần nhất)</h4>
            {history.length === 0 && <div style={{ fontSize: 12, opacity: 0.6 }}>Chưa có thay đổi nào được ghi.</div>}
            {history.map((h) => (
              <div key={h.id} style={{ borderTop: "1px solid #222a3c", padding: "6px 0", fontSize: 12 }}>
                <div style={{ opacity: 0.6 }}>{new Date(h.changed_at).toLocaleString()} · {h.changed_by ?? "?"}</div>
                <div style={{ fontFamily: "monospace", opacity: 0.85 }}>
                  {JSON.stringify(h.old_value)} → {JSON.stringify(h.new_value)}
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

const label: React.CSSProperties = { display: "block", fontSize: 12, opacity: 0.7, margin: "10px 0 4px" };
const area: React.CSSProperties = {
  width: "100%", fontFamily: "monospace", fontSize: 12, padding: 8,
  background: "#0d1220", color: "inherit", border: "1px solid #2a3145", borderRadius: 6,
};
const btn: React.CSSProperties = {
  padding: "8px 12px", borderRadius: 6, border: "1px solid #2a3145",
  background: "#161d2e", color: "inherit", cursor: "pointer", fontSize: 13,
};
const btnSmall: React.CSSProperties = { ...btn, padding: "4px 8px", fontSize: 11 };
const errText: React.CSSProperties = { marginTop: 8, fontSize: 12, color: "#f87171" };
const pre: React.CSSProperties = {
  marginTop: 10, padding: 10, background: "#0d1220", border: "1px solid #2a3145",
  borderRadius: 6, fontSize: 11, overflowX: "auto",
};
