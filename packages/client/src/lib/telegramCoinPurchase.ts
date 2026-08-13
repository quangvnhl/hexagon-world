import type { PaymentOrder } from "./backend";
import type { TelegramWebApp } from "./telegram";

const FAILED_ORDER_STATUSES = new Set(["cancelled", "failed", "expired", "refunded"]);

export function canShowTelegramCoinPackages(
  accountPlatform: string,
  telegram: TelegramWebApp | null
): boolean {
  return accountPlatform === "telegram" && Boolean(telegram?.openInvoice);
}

export async function pollCoinOrderFulfillment(
  loadOrder: () => Promise<PaymentOrder>,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    sleep?: (milliseconds: number) => Promise<void>;
  } = {}
): Promise<PaymentOrder> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 20);
  const intervalMs = Math.max(0, options.intervalMs ?? 750);
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const order = await loadOrder();
    if (order.status === "fulfilled") {
      if (order.productKind !== "coin_package") throw new Error("Phản hồi giao dịch không hợp lệ");
      return order;
    }
    if (FAILED_ORDER_STATUSES.has(order.status)) {
      throw new Error("Thanh toán không được hoàn tất");
    }
    if (attempt < maxAttempts - 1) await sleep(intervalMs);
  }

  throw new Error("Giao dịch đang được Telegram xác nhận. Số dư sẽ cập nhật sau.");
}
