"use client";

import { useEffect, useMemo, useState } from "react";
import { createStarsInvoice, equipItem, getCatalog, purchaseWithCoin, type BackendMe, type CatalogItem } from "@/lib/backend";
import { getTelegramWebApp } from "@/lib/telegram";

export function ShopPanel({ account, onClose, onChanged }: { account: BackendMe; onClose: () => void; onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const owned = useMemo(() => new Set(account.inventory.map((entry) => entry.shop_items.id)), [account.inventory]);
  const coin = account.wallets.find((wallet) => wallet.currency_code === "coin")?.balance ?? 0;

  useEffect(() => { let active = true; void getCatalog().then((data) => { if (active) setItems(data); }).catch((e) => { if (active) setError(e instanceof Error ? e.message : "Không tải được shop"); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);

  const buy = async (item: CatalogItem) => {
    setBusy(item.id); setError("");
    try {
      const prices = item.shop_prices.filter((price) => price.platform === account.player.platform && (!price.ends_at || Date.parse(price.ends_at) > Date.now()));
      const stars = prices.find((price) => price.currency_code === "XTR");
      const coinPrice = prices.find((price) => price.currency_code === "coin");
      if (account.player.platform === "telegram" && stars) {
        const url = await createStarsInvoice(item.id);
        const telegram = getTelegramWebApp();
        if (!telegram?.openInvoice) throw new Error("Telegram hiện tại không hỗ trợ mở hóa đơn");
        await new Promise<void>((resolve, reject) => telegram.openInvoice?.(url, (status) => status === "failed" ? reject(new Error("Thanh toán thất bại")) : resolve()));
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
        {loading ? <div>Đang tải catalog…</div> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(145px,1fr))", gap: 9 }}>
            {items.map((item) => {
              const prices = item.shop_prices.filter((price) => price.platform === account.player.platform);
              const preferred = account.player.platform === "telegram" ? prices.find((p) => p.currency_code === "XTR") ?? prices.find((p) => p.currency_code === "coin") : prices.find((p) => p.currency_code === "coin");
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
