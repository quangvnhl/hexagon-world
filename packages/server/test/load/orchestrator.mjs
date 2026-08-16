/**
 * orchestrator.mjs — bộ điều phối load/soak cho harness (Pha 5 · B3).
 *
 * Dựng nhiều CLIENT NGƯỜI THẬT ảo (virtual-client.mjs), gom thành phòng (server tự xếp
 * 8 ghế/phòng), cho tất cả READY để server startGame, rồi phát input ở nhịp thực. Trong
 * lúc chạy: scrape `/health/network` (+ `/metrics` nếu có) định kỳ, tùy chọn RECONNECT
 * CHURN. Kết thúc: in báo cáo ánh xạ SLO §2 của `.implements/26-phase-5-plan.md`.
 *
 * CHẠY (từ packages/server):
 *   node test/load/orchestrator.mjs                       # smoke: 1 phòng, 8 người, 20s
 *   ROOMS=4 DURATION=120 node test/load/orchestrator.mjs  # 4 phòng × 8 người, 2 phút
 *   ROOMS=8 DURATION=1800 CHURN=1 INTEREST=1 node test/load/orchestrator.mjs  # soak 30'
 *
 * Biến môi trường:
 *   WS_URL     (ws://localhost:8910/game)   endpoint WebSocket game
 *   BASE_URL   (http://localhost:8910)      gốc HTTP để scrape metrics
 *   ROOMS      (1)                          số phòng mục tiêu
 *   HUMANS     (8)                          người thật/phòng (cap server = 8)
 *   DURATION   (20)                         thời lượng chạy (giây); ≥1800 = soak
 *   INPUT_RATE (24)                         khung input/giây/người
 *   RAMP       (0)                          giây rải đều lúc kết nối (0 = cùng lúc)
 *   CHURN      (0)                          1 = bật reconnect churn
 *   CHURN_EVERY(5)                          giây giữa mỗi lần churn
 *   CHURN_FRAC (0.1)                        tỉ lệ client bị drop mỗi đợt churn
 *   INTEREST   (0)                          1 = gửi territory/entity interest (biến thể AoI)
 *   SCRAPE_EVERY(5)                         giây giữa mỗi lần scrape metrics
 */
import { VirtualClient } from "./virtual-client.mjs";
import { scrapeHealthNetwork, scrapeMetrics, buildSloReport } from "./metrics.mjs";

const env = process.env;
const CFG = {
  wsUrl: env.WS_URL ?? "ws://localhost:8910/game",
  baseUrl: env.BASE_URL ?? "http://localhost:8910",
  rooms: int(env.ROOMS, 1),
  humans: int(env.HUMANS, 8),
  durationS: int(env.DURATION, 20),
  inputRate: int(env.INPUT_RATE, 24),
  rampS: num(env.RAMP, 0),
  churn: env.CHURN === "1",
  churnEveryS: num(env.CHURN_EVERY, 5),
  churnFrac: num(env.CHURN_FRAC, 0.1),
  interest: env.INTEREST === "1",
  scrapeEveryS: num(env.SCRAPE_EVERY, 5),
};

const TOTAL = CFG.rooms * CFG.humans;
const clients = [];
let stopping = false;
const scrapeLog = [];

async function main() {
  banner();

  // 1) Kết nối tất cả client (tùy chọn ramp để tránh burst mở phiên đụng B1 IP-cap).
  const perClientDelay = CFG.rampS > 0 ? (CFG.rampS * 1000) / TOTAL : 0;
  const connectResults = await Promise.allSettled(
    Array.from({ length: TOTAL }, (_, i) => connectOne(i, perClientDelay * i)),
  );
  const connected = connectResults.filter((r) => r.status === "fulfilled").length;
  const failed = connectResults.length - connected;
  console.log(`\n[connect] thành công ${connected}/${TOTAL}${failed ? `, lỗi ${failed}` : ""}`);
  if (connected === 0) {
    console.error("Không client nào kết nối được — server chạy chưa? (WS_URL)");
    process.exit(2);
  }

  // 2) Cho settle rồi READY toàn bộ → server startGame khi mọi conn trong phòng ready.
  await sleep(800);
  for (const c of clients) c.ready();
  console.log(`[ready]   đã gửi lobby_ready cho ${clients.length} client → chờ startGame`);

  // 3) Chạy trong DURATION, scrape định kỳ + churn tùy chọn.
  const scrapeTimer = setInterval(() => { void scrapeOnce(); }, CFG.scrapeEveryS * 1000);
  scrapeTimer.unref();
  let churnTimer = null;
  if (CFG.churn) {
    churnTimer = setInterval(() => { void churnOnce(); }, CFG.churnEveryS * 1000);
    churnTimer.unref();
  }

  await sleep(CFG.durationS * 1000);

  // 4) Dừng + báo cáo.
  stopping = true;
  clearInterval(scrapeTimer);
  if (churnTimer) clearInterval(churnTimer);
  await scrapeOnce(); // scrape cuối
  for (const c of clients) c.close();
  await sleep(200);
  report();
  process.exit(0);
}

async function connectOne(i, delayMs) {
  if (delayMs > 0) await sleep(delayMs);
  const c = new VirtualClient({
    wsUrl: CFG.wsUrl,
    inputRate: CFG.inputRate,
    interest: CFG.interest,
    onEnded: (cl) => onClientEnded(cl),
  });
  clients.push(c);
  await c.connect();
  return c;
}

/** Ván kết thúc / phòng đóng → rejoin fresh để giữ tải liên tục (soak). */
function onClientEnded(c) {
  if (stopping) return;
  setTimeout(() => {
    if (stopping) return;
    c.rejoin().then(() => c.ready()).catch(() => {});
  }, 500 + Math.random() * 500);
}

/** Reconnect churn: drop một phần client rồi resume trong grace 30s. */
async function churnOnce() {
  if (stopping) return;
  const alive = clients.filter((c) => c.ws && !c.expectResume);
  const n = Math.max(1, Math.floor(alive.length * CFG.churnFrac));
  const victims = shuffle(alive).slice(0, n);
  for (const v of victims) v.drop();
  await sleep(500 + Math.random() * 1500); // trong grace 30s
  for (const v of victims) {
    if (stopping) return;
    v.resume().catch(() => v.rejoin().catch(() => {}));
  }
  console.log(`[churn]   drop+resume ${victims.length} client`);
}

async function scrapeOnce() {
  try {
    const health = await scrapeHealthNetwork(CFG.baseUrl);
    const metrics = await scrapeMetrics(CFG.baseUrl);
    const activeClients = clients.filter((c) => c.playerId !== null).length;
    scrapeLog.push({ t: Date.now(), health, metrics, clients: activeClients });
    const bps = health?.bytesPerSecond ?? {};
    const snapBps = ((bps.snapshot ?? 0) / 1024).toFixed(1);
    const mflag = metrics.available ? "metrics✓" : "metrics✗";
    console.log(`[scrape]  clients=${activeClients} snapshot=${snapBps}KB/s ${mflag}`);
  } catch (err) {
    console.log(`[scrape]  lỗi: ${err?.message ?? err}`);
  }
}

function report() {
  console.log("\n" + "=".repeat(72));
  console.log("BÁO CÁO SLO — Pha 5 §2 (doc 26)");
  console.log("=".repeat(72));

  // Tổng hợp thống kê client.
  const agg = clients.reduce(
    (a, c) => {
      a.connects += c.stats.connects;
      a.resumes += c.stats.resumes;
      a.rejoins += c.stats.rejoins;
      a.snapshots += c.stats.snapshots;
      a.inputsSent += c.stats.inputsSent;
      a.started += c.stats.started ? 1 : 0;
      a.radar += c.stats.radarSeen ? 1 : 0;
      a.ack.push(...c.stats.ackLatencies);
      return a;
    },
    { connects: 0, resumes: 0, rejoins: 0, snapshots: 0, inputsSent: 0, started: 0, radar: 0, ack: [] },
  );

  console.log(
    `\nClient: mục tiêu ${TOTAL} (${CFG.rooms}×${CFG.humans}) · vào trận ${agg.started} · ` +
      `connect ${agg.connects} · resume ${agg.resumes} · rejoin ${agg.rejoins}`,
  );
  console.log(
    `Traffic: snapshot nhận ${agg.snapshots} · input gửi ${agg.inputsSent}` +
      (CFG.interest ? ` · radar thấy ${agg.radar} client` : ""),
  );

  // Dùng lần scrape cuối để dựng bảng SLO.
  const last = scrapeLog[scrapeLog.length - 1];
  if (!last) {
    console.log("\n(không có mẫu scrape — bỏ qua bảng SLO)");
    return;
  }
  const slo = buildSloReport({
    health: last.health,
    metrics: last.metrics,
    clients: last.clients,
    ackLatencies: agg.ack,
  });

  console.log("\n" + pad("Chỉ số", 34) + pad("Mục tiêu", 18) + pad("Đo được", 14) + "KL");
  console.log("-".repeat(72));
  for (const r of slo.rows) {
    console.log(pad(r.key, 34) + pad(r.target, 18) + pad(String(r.measured), 14) + verdictMark(r.verdict));
    if (r.note) console.log("  ↳ " + r.note);
  }

  if (!slo.metricsAvailable) {
    console.log(
      `\n⚠ /metrics chưa dùng được (${slo.metricsReason ?? "?"}). Các dòng tick/lag/room ` +
        "hiện 'n/a' — cần merge nhánh B1+B3 (agent backend) để có endpoint /metrics.",
    );
  }
  console.log("\nGhi chú: input→snapshot đo phía CLIENT (localhost RTT≈0). Số server-side chuẩn");
  console.log("nằm ở histogram /metrics sau khi merge B3.\n");
}

// ---- tiện ích --------------------------------------------------------------
function banner() {
  console.log("Hexagon World — Load/Soak harness (Pha 5 · B3)");
  console.log(
    `Cấu hình: ${CFG.rooms} phòng × ${CFG.humans} người = ${TOTAL} client · ` +
      `${CFG.durationS}s · input ${CFG.inputRate}/s` +
      `${CFG.churn ? ` · churn mỗi ${CFG.churnEveryS}s (${Math.round(CFG.churnFrac * 100)}%)` : ""}` +
      `${CFG.interest ? " · interest ON" : ""}`,
  );
  console.log(`WS_URL=${CFG.wsUrl}  BASE_URL=${CFG.baseUrl}`);
}
function int(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function num(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n - 1) + " " : s + " ".repeat(n - s.length); }
function verdictMark(v) { return v === "PASS" ? "✅ PASS" : v === "FAIL" ? "❌ FAIL" : v === "info" ? "ℹ️" : "—"; }
function shuffle(a) { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [b[i], b[j]] = [b[j], b[i]]; } return b; }

process.on("SIGINT", () => { stopping = true; for (const c of clients) c.close(); report(); process.exit(0); });

main().catch((err) => { console.error("Harness lỗi:", err); process.exit(1); });
