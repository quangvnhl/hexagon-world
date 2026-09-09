/**
 * doc 35 §C1 — ba tín hiệu vận hành mà `/metrics` chưa có, và không suy ra được từ thứ đã có.
 *
 * `serverTelemetry` đo vòng lặp game (tick, lag, phòng); `gameNetworkMetrics` đo WebSocket. Cả hai
 * đều mù trước ba thứ dưới đây, mà đó lại là ba thứ hỏng theo kiểu **im lặng**:
 *
 *   1. `spool_pending` — số kết quả trận CHƯA ghi được vào control plane. Mỗi file tồn là XP và
 *      tiền của một người chơi đang nằm chờ. Không có số này thì control plane chết một đêm là
 *      mất trận của cả đêm mà không ai biết, vì game vẫn chạy bình thường.
 *   2. `telegram_webhook_failures_total` — webhook Stars lỗi. Người chơi ĐÃ bị trừ Stars; nếu
 *      webhook không tới thì họ mất tiền và không nhận coin. Không có gì trong game đỏ lên cả.
 *   3. `db_ready` — `/health/ready` đã có, nhưng nó là một lần hỏi. Alert cần một chuỗi thời gian.
 *
 * Cố ý KHÔNG dùng thư viện client Prometheus: `renderPrometheus` đã tự dựng text format, thêm một
 * phụ thuộc cho ba con số là đổi một thứ đang chạy lấy một thứ chưa cần.
 */

export interface OpsMetricsSnapshot {
  /** Số file kết quả trận đang tồn trong `GAME_RESULT_SPOOL_DIR`. */
  spoolPending: number;
  /** Đếm dồn số lần xử lý webhook Telegram thất bại. */
  telegramWebhookFailures: number;
  /** 1 = database trả lời được, 0 = không. `-1` = chưa từng kiểm. */
  dbReady: number;
}

class OpsMetrics {
  private spoolPending = 0;
  private telegramWebhookFailures = 0;
  // `-1` chứ không phải `0`: "chưa kiểm bao giờ" và "kiểm rồi, hỏng" là hai chuyện khác nhau, và
  // gộp chúng lại thì alert sẽ kêu ngay lúc server vừa khởi động, mỗi lần deploy.
  private dbReady = -1;

  /**
   * Đặt số file đang tồn. Bên gọi (`MatchResultReporter`) ĐẾM KHI GHI/XOÁ chứ không quét thư mục
   * mỗi lần scrape — quét đĩa trên đường scrape là tự tạo tải mỗi 15 giây, mãi mãi.
   */
  setSpoolPending(n: number): void {
    this.spoolPending = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }

  recordTelegramWebhookFailure(): void { this.telegramWebhookFailures++; }

  setDbReady(ok: boolean): void { this.dbReady = ok ? 1 : 0; }

  snapshot(): OpsMetricsSnapshot {
    return {
      spoolPending: this.spoolPending,
      telegramWebhookFailures: this.telegramWebhookFailures,
      dbReady: this.dbReady,
    };
  }

  /** Chỉ dùng trong test — đưa về trạng thái đầu. */
  reset(): void {
    this.spoolPending = 0;
    this.telegramWebhookFailures = 0;
    this.dbReady = -1;
  }
}

export const opsMetrics = new OpsMetrics();
