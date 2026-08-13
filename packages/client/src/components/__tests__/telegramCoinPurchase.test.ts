import { describe, expect, it, vi } from "vitest";
import type { PaymentOrder } from "../../lib/backend";
import type { TelegramWebApp } from "../../lib/telegram";
import {
  canShowTelegramCoinPackages,
  pollCoinOrderFulfillment,
} from "../../lib/telegramCoinPurchase";

function telegramApp(openInvoice = vi.fn()): TelegramWebApp {
  return {
    initData: "auth_date=1&user=%7B%7D&hash=valid",
    ready: vi.fn(),
    expand: vi.fn(),
    openInvoice,
  };
}

function order(status: string, productKind = "coin_package"): PaymentOrder {
  return { orderId: "order-1", status, productKind };
}

describe("Telegram Stars coin packages gate", () => {
  it("chỉ hiển thị khi account là Telegram và WebApp hỗ trợ openInvoice", () => {
    expect(canShowTelegramCoinPackages("telegram", telegramApp())).toBe(true);
    expect(canShowTelegramCoinPackages("web", telegramApp())).toBe(false);
    expect(canShowTelegramCoinPackages("telegram", null)).toBe(false);
  });

  it("ẩn khi WebApp không hỗ trợ openInvoice", () => {
    const app = telegramApp();
    delete app.openInvoice;
    expect(canShowTelegramCoinPackages("telegram", app)).toBe(false);
  });
});

describe("Telegram Stars coin order polling", () => {
  it("chờ backend fulfilled rồi mới hoàn tất", async () => {
    const loadOrder = vi.fn()
      .mockResolvedValueOnce(order("pending"))
      .mockResolvedValueOnce(order("paid"))
      .mockResolvedValueOnce(order("fulfilled"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollCoinOrderFulfillment(loadOrder, { maxAttempts: 3, intervalMs: 5, sleep }))
      .resolves.toEqual(order("fulfilled"));
    expect(loadOrder).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(5);
  });

  it("dừng ngay với trạng thái thất bại", async () => {
    const loadOrder = vi.fn().mockResolvedValue(order("expired"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollCoinOrderFulfillment(loadOrder, { sleep })).rejects.toThrow("không được hoàn tất");
    expect(loadOrder).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("giới hạn số lần poll khi backend vẫn pending", async () => {
    const loadOrder = vi.fn().mockResolvedValue(order("pending"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollCoinOrderFulfillment(loadOrder, { maxAttempts: 2, sleep })).rejects.toThrow("đang được Telegram xác nhận");
    expect(loadOrder).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("không chấp nhận fulfilled của sản phẩm khác", async () => {
    await expect(pollCoinOrderFulfillment(() => Promise.resolve(order("fulfilled", "shop_item"))))
      .rejects.toThrow("không hợp lệ");
  });
});
