import { useState } from "react";
import LevelEditor from "./LevelEditor";
import RemoteConfig from "./RemoteConfig";

// App admin riêng (doc 30 L6): trình vẽ cấp Campaign + trang cấu hình từ xa (doc 35 §A2, lát a2.3).
//
// Khoá admin nằm ở ĐÂY chứ không phải trong từng trang: hai trang dùng chung một khoá, và bắt
// người dùng dán lại mỗi lần đổi tab là cách chắc chắn để họ dán nhầm.
//
// Lưu trong `sessionStorage` chứ không phải `localStorage`: đây là khoá vận hành có toàn quyền
// (hoặc gần thế). Đóng tab là mất — đúng như nó nên vậy.

const KEY_STORAGE = "hexagon.admin.key";

export function App() {
  const [tab, setTab] = useState<"levels" | "config">("levels");
  const [adminKey, setAdminKey] = useState(() => {
    try {
      return sessionStorage.getItem(KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  });

  const remember = (value: string) => {
    setAdminKey(value);
    try {
      sessionStorage.setItem(KEY_STORAGE, value);
    } catch {
      /* chế độ riêng tư: vẫn dùng được trong phiên này */
    }
  };

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={() => setTab("levels")} style={tabStyle(tab === "levels")}>Cấp Campaign</button>
        <button onClick={() => setTab("config")} style={tabStyle(tab === "config")}>Cấu hình từ xa</button>
        <input
          type="password"
          value={adminKey}
          onChange={(e) => remember(e.target.value)}
          placeholder="x-admin-key"
          aria-label="Khoá admin"
          style={{
            marginLeft: "auto", minWidth: 220, padding: "6px 10px", borderRadius: 6,
            border: "1px solid #2a3145", background: "#0d1220", color: "inherit", fontSize: 12,
          }}
        />
      </div>

      {tab === "levels" ? <LevelEditor /> : <RemoteConfig adminKey={adminKey} />}
    </div>
  );
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 6,
    border: "1px solid #2a3145",
    background: active ? "#1d2740" : "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: 13,
  };
}
