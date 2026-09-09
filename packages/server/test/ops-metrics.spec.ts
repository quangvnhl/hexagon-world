import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { opsMetrics } from "../src/ops-metrics";
import { renderPrometheus } from "../src/net/prometheus";
import { gameNetworkMetrics } from "../src/net/network-transport";
import { serverTelemetry } from "../src/net/telemetry";
import { collectProcessMetrics } from "../src/net/prometheus";
import { WS_BACKPRESSURE_BYTES } from "../src/config";

/**
 * doc 35 §C1. Ba tín hiệu này đo những thứ hỏng theo kiểu IM LẶNG — game vẫn chạy bình thường
 * trong khi tiền của người chơi kẹt lại. Nên bài đắt nhất ở đây là bài về `-1`: nếu "chưa kiểm bao
 * giờ" và "kiểm rồi, hỏng" cùng ra `0` thì alert sẽ kêu mỗi lần deploy, và một alert kêu sai vài
 * lần là một alert bị tắt.
 */
const render = () =>
  renderPrometheus(
    gameNetworkMetrics.snapshot(WS_BACKPRESSURE_BYTES),
    serverTelemetry.snapshot(),
    collectProcessMetrics(),
    opsMetrics.snapshot(),
  );

describe("opsMetrics", () => {
  beforeEach(() => opsMetrics.reset());

  it("db_ready khởi đầu là -1, KHÔNG phải 0", () => {
    expect(opsMetrics.snapshot().dbReady).toBe(-1);
    opsMetrics.setDbReady(true);
    expect(opsMetrics.snapshot().dbReady).toBe(1);
    opsMetrics.setDbReady(false);
    expect(opsMetrics.snapshot().dbReady).toBe(0);
  });

  it("spoolPending không nhận số âm hay giá trị rác", () => {
    // Bên gọi tự đếm nên trừ quá tay là chuyện có thể xảy ra; một gauge âm làm biểu thức alert
    // im lặng sai chứ không đỏ.
    for (const bad of [-5, NaN, Infinity]) {
      opsMetrics.setSpoolPending(bad);
      expect(opsMetrics.snapshot().spoolPending, String(bad)).toBe(0);
    }
    opsMetrics.setSpoolPending(7.9);
    expect(opsMetrics.snapshot().spoolPending).toBe(7);
  });

  it("đếm lỗi webhook chỉ tăng", () => {
    opsMetrics.recordTelegramWebhookFailure();
    opsMetrics.recordTelegramWebhookFailure();
    expect(opsMetrics.snapshot().telegramWebhookFailures).toBe(2);
  });
});

describe("/metrics phơi đủ ba tín hiệu", () => {
  beforeEach(() => opsMetrics.reset());

  it("có đủ tên metric, kèm HELP và TYPE", () => {
    // Thiếu HELP/TYPE thì Prometheus vẫn nhận, nhưng người trực mở dashboard lúc 2 giờ sáng sẽ
    // thấy một con số không có mô tả nào.
    const text = render();
    for (const name of ["hexworld_spool_pending", "hexworld_telegram_webhook_failures_total", "hexworld_db_ready"]) {
      expect(text, name).toContain(`# HELP ${name} `);
      expect(text, name).toContain(`# TYPE ${name} `);
      expect(text, name).toMatch(new RegExp(`^${name} `, "m"));
    }
  });

  it("giá trị đi thẳng ra text", () => {
    opsMetrics.setSpoolPending(3);
    opsMetrics.setDbReady(false);
    opsMetrics.recordTelegramWebhookFailure();
    const text = render();
    expect(text).toMatch(/^hexworld_spool_pending 3$/m);
    expect(text).toMatch(/^hexworld_db_ready 0$/m);
    expect(text).toMatch(/^hexworld_telegram_webhook_failures_total 1$/m);
  });
});

describe("deploy/alerts.yml — mỗi alert PHẢI có runbook", () => {
  // doc 35 §C1 nói "mỗi alert kèm runbook". Luật đó đáng được giữ bằng test chứ không bằng một
  // dòng chú thích: người thêm alert lúc đang xử lý sự cố là người ít có thời gian đọc chú thích
  // nhất, và một alert không có runbook sẽ bị tắt ở lần kêu thứ ba.
  const yml = readFileSync(new URL("../../../deploy/alerts.yml", import.meta.url), "utf8");
  const alerts = [...yml.matchAll(/^\s*- alert: (\S+)/gm)].map((m) => m[1]);

  it("có đủ các alert mà doc 35 §C1 gọi tên", () => {
    expect(alerts).toContain("SpoolBacklogGrowing");
    expect(alerts).toContain("TelegramWebhookFailing");
    expect(alerts).toContain("DatabaseUnreachable");
  });

  it("mỗi khối alert có annotations.runbook", () => {
    // Cắt file theo từng khối `- alert:` rồi soi từng khối, thay vì chỉ đếm tổng số `runbook:` —
    // đếm tổng sẽ xanh ngay cả khi một alert có hai runbook còn alert bên cạnh không có cái nào.
    const blocks = yml.split(/^\s*- alert: /m).slice(1);
    expect(blocks.length).toBe(alerts.length);
    for (const [i, block] of blocks.entries()) {
      expect(block, `alert "${alerts[i]}" thiếu runbook`).toMatch(/^\s+runbook:/m);
    }
  });

  it("mọi metric alert tham chiếu đều thật sự được phơi ra /metrics", () => {
    // Một alert trỏ vào metric không tồn tại thì im lặng mãi mãi — nó không bao giờ đỏ, nên nhìn
    // vào danh sách alert người ta tưởng đã được che.
    const text = render();
    for (const name of new Set([...yml.matchAll(/hexworld_[a-z_]+/g)].map((m) => m[0]))) {
      expect(text, `${name} có trong alerts.yml nhưng KHÔNG có trong /metrics`).toContain(name);
    }
  });
});
