"use client";

import { useEffect, useMemo, useState } from "react";
import { createCoinPackageStarsInvoice, createStarsInvoice, equipItem, getCatalog, getCoinPackages, getPaymentOrder, purchaseWithCoin, type BackendMe, type CatalogItem, type CoinPackage } from "@/lib/backend";
import { getTelegramWebApp } from "@/lib/telegram";
import { canShowTelegramCoinPackages, pollCoinOrderFulfillment } from "@/lib/telegramCoinPurchase";

export function ShopPanel({ account, onClose, onChanged }: { account: BackendMe; onClose: () => void; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [coinPackages, setCoinPackages] = useState<CoinPackage[]>([]);
  const [coinPackagesLoading, setCoinPackagesLoading] = useState(false);
  const [coinPurchaseMessage, setCoinPurchaseMessage] = useState("");
  const [coinPurchaseError, setCoinPurchaseError] = useState("");
  const [telegramCoinEnabled, setTelegramCoinEnabled] = useState(false);
  const owned = useMemo(() => new Set(account.inventory.map((entry) => entry.shop_items.id)), [account.inventory]);
  const coin = account.wallets.find((wallet) => wallet.currency_code === "coin")?.balance ?? 0;

  useEffect(() => { let active = true; void getCatalog().then((data) => { if (active) setItems(data); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Không tải được shop"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);

  useEffect(() => {
    const enabled = canShowTelegramCoinPackages(account.player.platform, getTelegramWebApp());
    setTelegramCoinEnabled(enabled);
    if (!enabled) {
      setCoinPackages([]);
      setCoinPackagesLoading(false);
      return;
    }

    let active = true;
    setCoinPackagesLoading(true);
    setCoinPurchaseError("");
    void getCoinPackages()
      .then((packages) => {
        if (active) setCoinPackages([...packages].sort((a, b) => a.sortOrder - b.sortOrder));
      })
      .catch((e) => {
        if (active) setCoinPurchaseError(e instanceof Error ? e.message : "Không tải được các gói coin");
      })
      .finally(() => {
        if (active) setCoinPackagesLoading(false);
      });
    return () => { active = false; };
  }, [account.player.platform]);

  const buyCoinPackage = async (coinPackage: CoinPackage) => {
    const busyKey = `coin:${coinPackage.id}`;
    setBusy(busyKey);
    setCoinPurchaseError("");
    setCoinPurchaseMessage("");
    try {
      // Re-check the canonical gate immediately before calling Telegram-only code.
      const telegram = getTelegramWebApp();
      if (!canShowTelegramCoinPackages(account.player.platform, telegram) || !telegram?.openInvoice) {
        throw new Error("Mua coin bằng Stars chỉ khả dụng trong Telegram");
      }

      const invoice = await createCoinPackageStarsInvoice(coinPackage.id);
      if (invoice.status === "fulfilled") {
        await onChanged();
        setCoinPurchaseMessage("Giao dịch này đã được hoàn tất trước đó.");
        return;
      }
      const invoiceUrl = invoice.invoiceUrl;
      if (!invoiceUrl) throw new Error("Máy chủ không trả về hóa đơn Telegram hợp lệ");
      const invoiceTelegram = getTelegramWebApp();
      const openInvoice = invoiceTelegram?.openInvoice?.bind(invoiceTelegram);
      if (!canShowTelegramCoinPackages(account.player.platform, invoiceTelegram) || !openInvoice) {
        throw new Error("Telegram không còn khả dụng để mở hóa đơn");
      }
      const invoiceStatus = await new Promise<"paid" | "cancelled" | "failed" | "pending">((resolve) => {
        openInvoice(invoiceUrl, resolve);
      });

      if (invoiceStatus === "cancelled") {
        setCoinPurchaseMessage("Bạn đã đóng hóa đơn. Không có coin nào được cộng.");
        return;
      }
      if (invoiceStatus === "failed") throw new Error("Thanh toán Telegram Stars thất bại");

      setCoinPurchaseMessage("Đang xác nhận giao dịch với máy chủ…");
      await pollCoinOrderFulfillment(() => getPaymentOrder(invoice.orderId));
      await onChanged();
      setCoinPurchaseMessage(`Đã cộng ${coinPackage.coinAmount} coin vào tài khoản.`);
    } catch (e) {
      setCoinPurchaseError(e instanceof Error ? e.message : "Không thể mua gói coin");
    } finally {
      setBusy("");
    }
  };

  const buy = async (item: CatalogItem) => {
    setBusy(item.id); setError("");
    try {
      const prices = item.shop_prices.filter((price) => price.platform === account.player.platform && (!price.ends_at || Date.parse(price.ends_at) > Date.now()));
      const stars = prices.find((price) => price.currency_code === "XTR");
      const coinPrice = prices.find((price) => price.currency_code === "coin");
      const telegram = getTelegramWebApp();
      if (stars && canShowTelegramCoinPackages(account.player.platform, telegram)) {
        const url = await createStarsInvoice(item.id);
        const invoiceTelegram = getTelegramWebApp();
        if (!invoiceTelegram?.openInvoice) throw new Error("Telegram hiện tại không hỗ trợ mở hóa đơn");
        await new Promise<void>((resolve, reject) => invoiceTelegram.openInvoice?.(url, (status) => status === "failed" ? reject(new Error("Thanh toán thất bại")) : resolve()));
        await new Promise((resolve) => setTimeout(resolve, 1200));
      } else if (coinPrice) await purchaseWithCoin(item.id);
      else throw new Error("Item chưa có giá phù hợp");
      await onChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Không thể mua item"); }
    finally { setBusy(""); }
  };

  const equip = async (item: CatalogItem) => {
    setBusy(item.id); setError("");
    try { await equipItem(item); await onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : "Không thể trang bị item"); }
    finally { setBusy(""); }
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="Shop" style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(2,5,10,.76)", display: "grid", placeItems: "center", padding: 14 }}>
      <section style={{ width: "min(720px,100%)", maxHeight: "min(720px,90dvh)", overflow: "auto", borderRadius: 18, padding: 16, color: "#e8eefc", background: "#101722", border: "1px solid rgba(255,255,255,.1)", boxShadow: "0 24px 90px #000" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div><strong style={{ fontSize: 20 }}>Shop</strong><div style={{ fontSize: 11, opacity: .65 }}>{account.player.displayName} · {coin} coin</div></div>
          <button onClick={onClose} style={{ border: 0, borderRadius: 9, padding: "7px 11px", background: "rgba(255,255,255,.08)", color: "white", cursor: "pointer" }}>Đóng</button>
        </header>
        {error && <div role="alert" style={{ color: "#ff8b9a", fontSize: 12, marginBottom: 10 }}>{error}</div>}
        {telegramCoinEnabled && (
          <section aria-label="Mua Coin bằng Telegram Stars" style={{ marginBottom: 16, padding: 12, borderRadius: 14, background: "rgba(36,127,202,.12)", border: "1px solid rgba(79,169,255,.22)" }}>
            <div style={{ marginBottom: 9 }}>
              <strong>Mua Coin</strong>
              <div style={{ fontSize: 11, opacity: .65 }}>Thanh toán an toàn bằng Telegram Stars</div>
            </div>
            {coinPurchaseError && <div role="alert" style={{ color: "#ff8b9a", fontSize: 12, marginBottom: 9 }}>{coinPurchaseError}</div>}
            {coinPurchaseMessage && <div role="status" style={{ color: "#a8d7ff", fontSize: 12, marginBottom: 9 }}>{coinPurchaseMessage}</div>}
            {coinPackagesLoading ? <div style={{ fontSize: 12, opacity: .7 }}>Đang tải các gói coin…</div> : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 9 }}>
                {coinPackages.map((coinPackage) => {
                  const busyKey = `coin:${coinPackage.id}`;
                  return (
                    <article key={coinPackage.id} style={{ padding: 11, textAlign: "center", borderRadius: 12, background: "rgba(255,255,255,.055)", border: "1px solid rgba(255,255,255,.09)" }}>
                      <strong style={{ display: "block" }}>{coinPackage.name}</strong>
                      <div style={{ margin: "5px 0 9px", color: "#ffd86a", fontSize: 18 }}>{coinPackage.coinAmount.toLocaleString("vi-VN")} coin</div>
                      <button disabled={Boolean(busy)} onClick={() => void buyCoinPackage(coinPackage)} style={{ width: "100%", border: 0, borderRadius: 9, padding: "8px", color: "white", background: "#247fca", opacity: busy ? .6 : 1, cursor: busy ? "wait" : "pointer" }}>
                        {busy === busyKey ? "Đang xử lý…" : `⭐ ${coinPackage.starsAmount}`}
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        )}
        {loading ? <div>Đang tải catalog…</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(145px,1fr))", gap: 9 }}>
            {items.map((item) => {
              const prices = item.shop_prices.filter((price) => price.platform === account.player.platform);
              const preferred = telegramCoinEnabled ? prices.find((p) => p.currency_code === "XTR") ?? prices.find((p) => p.currency_code === "coin") : prices.find((p) => p.currency_code === "coin");
              const has = owned.has(item.id);
              const selected = item.type === "color" ? account.loadout?.color_item_id === item.id : item.type === "shape" ? account.loadout?.shape_item_id === item.id : account.loadout?.trail_item_id === item.id;
              return <article key={item.id} style={{ padding: 11, borderRadius: 13, background: "rgba(255,255,255,.045)", border: "1px solid rgba(255,255,255,.08)" }}>
                <div style={{ fontSize: 10, opacity: .5, textTransform: "uppercase" }}>{item.type} · {item.rarity}</div>
                <strong style={{ display: "block", margin: "3px 0 9px" }}>{item.name}</strong>
                <button disabled={selected || busy === item.id || (!has && !preferred)} onClick={() => void (has ? equip(item) : buy(item))} style={{ width: "100%", border: 0, borderRadius: 9, padding: "7px", color: "white", background: selected ? "rgba(65,200,120,.25)" : "#247fca", opacity: busy === item.id ? .6 : 1, cursor: selected ? "default" : "pointer" }}>
                  {selected ? "Đang sử dụng" : busy === item.id ? "Đang xử lý…" : has ? "Trang bị" : preferred ? `${preferred.amount} ${preferred.currency_code}` : "Chưa mở bán"}
                </button>
              </article>;
            })}
          </div>
        )}
      </section>
    </div>
  );
}
