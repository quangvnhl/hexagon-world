/**
 * metrics.mjs — scrape `/health/network` (JSON, ĐÃ CÓ) và `/metrics` (Prometheus text,
 * do agent khác thêm) rồi ÁNH XẠ vào SLO §2 của doc 26.
 *
 * `/metrics` có thể CHƯA tồn tại trong cây làm việc hiện tại → scrape best-effort: nếu
 * thiếu thì các dòng SLO nguồn-server (tick/lag) hiện "n/a (cần /metrics)". Các dòng
 * downstream/drop luôn tính được từ /health/network.
 *
 * Hợp đồng tên metric mong đợi (khớp brief): hexworld_tick_step_ms,
 * hexworld_eventloop_lag_ms, hexworld_rooms_active, hexworld_ws_input_dropped_total.
 */

const SNAPSHOT_KINDS = ["snapshot", "territory_keyframe", "territory_delta", "territory_minimap"];

export async function scrapeHealthNetwork(baseUrl) {
  const res = await fetch(new URL("/health/network", baseUrl), { signal: timeout(4000) });
  if (!res.ok) throw new Error(`/health/network -> HTTP ${res.status}`);
  return res.json();
}

export async function scrapeMetrics(baseUrl) {
  try {
    const res = await fetch(new URL("/metrics", baseUrl), { signal: timeout(4000) });
    if (!res.ok) return { available: false, reason: `HTTP ${res.status}`, series: {} };
    const text = await res.text();
    return { available: true, series: parsePrometheus(text), raw: text };
  } catch (err) {
    return { available: false, reason: String(err?.message ?? err), series: {} };
  }
}

/**
 * Parse Prometheus text tối giản: gom mọi sample thành map name -> [{labels, value}].
 * Hỗ trợ gauge/counter và histogram (_bucket/_sum/_count) + summary (quantile label).
 */
export function parsePrometheus(text) {
  const series = {};
  for (const line of text.split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("#")) continue;
    const m = s.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+([-+]?[0-9.eE+]+|NaN|[-+]?Inf)$/);
    if (!m) continue;
    const [, name, labelBlock, rawVal] = m;
    const value = Number(rawVal);
    const labels = {};
    if (labelBlock) {
      for (const pair of labelBlock.slice(1, -1).split(",")) {
        const idx = pair.indexOf("=");
        if (idx === -1) continue;
        labels[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim().replace(/^"|"$/g, "");
      }
    }
    (series[name] ??= []).push({ labels, value });
  }
  return series;
}

/** Lấy 1 quantile từ histogram Prometheus (xấp xỉ tuyến tính trong bucket chứa quantile). */
export function histogramQuantile(series, name, q) {
  const buckets = (series[`${name}_bucket`] ?? [])
    .map((s) => ({ le: parseLe(s.labels.le), count: s.value }))
    .sort((a, b) => a.le - b.le);
  const count = single(series, `${name}_count`);
  if (!buckets.length || !Number.isFinite(count) || count <= 0) return NaN;
  const target = q * count;
  let prevLe = 0;
  let prevCount = 0;
  for (const b of buckets) {
    if (b.count >= target) {
      if (!Number.isFinite(b.le)) return prevLe; // +Inf bucket
      const frac = (target - prevCount) / (b.count - prevCount || 1);
      return prevLe + (b.le - prevLe) * frac;
    }
    prevLe = Number.isFinite(b.le) ? b.le : prevLe;
    prevCount = b.count;
  }
  return prevLe;
}

function parseLe(le) {
  return le === "+Inf" || le === "Inf" ? Infinity : Number(le);
}

/**
 * Lấy 1 quantile từ Prometheus SUMMARY: series `name{quantile="q"}` (giá trị trực tiếp).
 * Nhánh B3 expose tick/lag dạng summary (không phải histogram) để tránh nổ cardinality.
 */
export function summaryQuantile(series, name, q) {
  const arr = series[name];
  if (!arr || !arr.length) return NaN;
  const want = String(q);
  const hit = arr.find((s) => s.labels.quantile === want || s.labels.quantile === `${q}`);
  return hit ? hit.value : NaN;
}

/** Giá trị đơn của một series không nhãn (hoặc tổng nếu nhiều). */
export function single(series, name) {
  const arr = series[name];
  if (!arr || !arr.length) return NaN;
  if (arr.length === 1) return arr[0].value;
  return arr.reduce((a, s) => a + s.value, 0);
}

/** Percentile của một mảng số. */
export function percentile(arr, p) {
  if (!arr.length) return NaN;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/**
 * Dựng báo cáo SLO §2 từ số đo. Trả mảng dòng { key, slo, target, measured, verdict }.
 * @param {object} args
 * @param {object} args.health  snapshot /health/network
 * @param {object} args.metrics kết quả scrapeMetrics
 * @param {number} args.clients số client active
 * @param {number[]} args.ackLatencies ms (client-side proxy cho input→snapshot)
 */
export function buildSloReport({ health, metrics, clients, ackLatencies }) {
  const rows = [];
  const bps = health?.bytesPerSecond ?? {};
  const totals = health?.totals ?? {};
  const downstreamBps = SNAPSHOT_KINDS.reduce((a, k) => a + (bps[k] ?? 0), 0);
  const perClient = clients > 0 ? downstreamBps / clients : NaN;

  const snapTotal = totals.snapshot ?? { frames: 0, dropped: 0 };
  const dropRate = snapTotal.frames > 0 ? (snapTotal.dropped / snapTotal.frames) * 100 : 0;

  const series = metrics?.series ?? {};
  const hasMetrics = metrics?.available;

  // stepRoom p95 — B3 expose dạng summary; fallback histogram nếu đổi sau này.
  const stepP95 = hasMetrics ? firstFinite(
    summaryQuantile(series, "hexworld_tick_step_ms", 0.95),
    histogramQuantile(series, "hexworld_tick_step_ms", 0.95),
  ) : NaN;
  rows.push(row("stepRoom p95 / room", "< 5 ms", stepP95, (v) => v < 5, "ms", hasMetrics));

  // event-loop lag p95
  const lagP95 = hasMetrics ? firstFinite(
    summaryQuantile(series, "hexworld_eventloop_lag_ms", 0.95),
    histogramQuantile(series, "hexworld_eventloop_lag_ms", 0.95),
  ) : NaN;
  rows.push(row("event-loop lag p95", "< 10 ms", lagP95, (v) => v < 10, "ms", hasMetrics));

  // tick behind ratio (§2.1: < 0,5 %)
  const behind = hasMetrics ? single(series, "hexworld_tick_behind_total") : NaN;
  const tickTotal = hasMetrics ? single(series, "hexworld_tick_total") : NaN;
  const behindPct = Number.isFinite(behind) && tickTotal > 0 ? (behind / tickTotal) * 100 : NaN;
  rows.push({
    key: "tick behind ratio",
    target: "< 0,5 %",
    measured: Number.isFinite(behindPct) ? `${behindPct.toFixed(3)} %` : "n/a (cần /metrics)",
    verdict: verdict(behindPct, (v) => v < 0.5),
    note: Number.isFinite(behind) ? `${behind}/${tickTotal} tick` : undefined,
  });

  // input→snapshot p95 (client-side proxy; server-side chính xác cần histogram /metrics)
  const inSnap = percentile(ackLatencies, 95);
  rows.push({
    key: "input→snapshot p95 (client-side*)",
    target: "< 60 ms",
    measured: fmt(inSnap, "ms"),
    verdict: verdict(inSnap, (v) => v < 60),
    note: "*đo phía client (gồm RTT localhost ~0). Số server-side chuẩn = histogram /metrics.",
  });

  // downstream / client
  rows.push({
    key: "downstream p95 / client",
    target: "< 60 KB/s",
    measured: Number.isFinite(perClient) ? `${(perClient / 1024).toFixed(1)} KB/s` : "n/a",
    verdict: verdict(perClient, (v) => v < 60 * 1024),
    note: `tổng downstream ${(downstreamBps / 1024).toFixed(1)} KB/s / ${clients} client`,
  });

  // drop rate snapshot
  rows.push({
    key: "snapshot drop rate",
    target: "< 1 %",
    measured: `${dropRate.toFixed(3)} %`,
    verdict: verdict(dropRate, (v) => v < 1),
    note: `${snapTotal.dropped}/${snapTotal.frames} khung`,
  });

  // rooms active (dung lượng §2.2)
  const rooms = hasMetrics ? single(series, "hexworld_rooms_active") : NaN;
  rows.push({
    key: "rooms active",
    target: "≥ 8 (trần 1 node)",
    measured: Number.isFinite(rooms) ? String(rooms) : "n/a (cần /metrics)",
    verdict: "info",
  });

  // input dropped (B1)
  const inputDropped = hasMetrics ? single(series, "hexworld_ws_input_dropped_total") : NaN;
  rows.push({
    key: "ws input dropped total (B1)",
    target: "quan sát",
    measured: Number.isFinite(inputDropped) ? String(inputDropped) : "n/a (cần /metrics)",
    verdict: "info",
  });

  return {
    rows,
    downstreamBps,
    perClientBps: perClient,
    dropRate,
    metricsAvailable: hasMetrics,
    metricsReason: metrics?.reason,
  };
}

function row(key, target, measured, pass, unit, available) {
  if (!available) {
    return { key, target, measured: "n/a (cần /metrics)", verdict: "n/a" };
  }
  return { key, target, measured: fmt(measured, unit), verdict: verdict(measured, pass) };
}

function fmt(v, unit) {
  if (!Number.isFinite(v)) return "n/a";
  return `${v.toFixed(2)} ${unit}`.trim();
}

function verdict(v, pass) {
  if (!Number.isFinite(v)) return "n/a";
  return pass(v) ? "PASS" : "FAIL";
}

function firstFinite(...vals) {
  for (const v of vals) if (Number.isFinite(v)) return v;
  return NaN;
}

function timeout(ms) {
  return AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
}
