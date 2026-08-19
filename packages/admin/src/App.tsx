import { CAMPAIGN_LEVELS } from "@hexagon/shared";

// L6a — vỏ app admin: xác nhận wiring Vite + React + @hexagon/shared.
// L6b sẽ thay bằng LevelEditor (trình vẽ cấp).
export function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 24, color: "#e8eefc", background: "#0a0e16", minHeight: "100vh" }}>
      <h1>🛠️ Hexagon Admin</h1>
      <p style={{ opacity: 0.7 }}>Trình vẽ cấp Campaign — app admin riêng (doc 30).</p>
      <p style={{ opacity: 0.5, fontSize: 13 }}>Seed shared: {CAMPAIGN_LEVELS.length} cấp mẫu.</p>
    </div>
  );
}
