import type { PlayerAppearance } from "@hexagon/shared";
import { getTelegramWebApp } from "./telegram";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8910";

export interface BackendPlayer { id: string; displayName: string; platform: string; }
export interface InventoryEntry { quantity: number; shop_items: { id: string; sku: string; type: "color" | "shape" | "trail"; asset_key: string; name: string; rarity: string }; }
export interface BackendMe { player: BackendPlayer; profile: { selected_color: string; selected_shape: string; selected_trail_pattern: string } | null; wallets: { currency_code: string; balance: number }[]; inventory: InventoryEntry[]; loadout: { color_item_id: string | null; shape_item_id: string | null; trail_item_id: string | null } | null; }
export interface CatalogItem { id: string; sku: string; type: "color" | "shape" | "trail"; asset_key: string; name: string; rarity: string; is_default_free: boolean; shop_prices: { id: string; platform: string; currency_code: "coin" | "XTR"; amount: number; starts_at: string; ends_at: string | null }[]; }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { message?: string } | null)?.message || `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function ensureTelegramSession(): Promise<void> {
  const initData = getTelegramWebApp()?.initData;
  if (!initData) return;
  await json("/v1/auth/telegram", { method: "POST", body: JSON.stringify({ initData }) });
}

export async function getMe(): Promise<BackendMe | null> {
  try { return await json<BackendMe>("/v1/me"); } catch { return null; }
}

export function startGoogleLogin(): void { window.location.assign(`${API_URL}/v1/auth/web/google/start`); }

export async function getCatalog(): Promise<CatalogItem[]> { return (await json<{ items: CatalogItem[] }>("/v1/shop/catalog")).items; }
export async function purchaseWithCoin(itemId: string): Promise<void> { await json("/v1/shop/purchases", { method: "POST", body: JSON.stringify({ itemId, idempotencyKey: crypto.randomUUID() }) }); }
export async function createStarsInvoice(itemId: string): Promise<string> { return (await json<{ invoiceUrl: string }>("/v1/payments/telegram-stars/invoice", { method: "POST", body: JSON.stringify({ itemId, idempotencyKey: crypto.randomUUID() }) })).invoiceUrl; }
export async function equipItem(item: CatalogItem): Promise<void> {
  const key = item.type === "color" ? "colorItemId" : item.type === "shape" ? "shapeItemId" : "trailItemId";
  await json("/v1/loadout", { method: "PUT", body: JSON.stringify({ [key]: item.id }) });
}

function guestId(): string {
  const key = "hexagon.guest-id";
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID().replaceAll("-", ""); localStorage.setItem(key, value); }
  return value;
}

export async function acquireGameAccess(name: string, appearance: PlayerAppearance): Promise<{ ticket: string; serverUrl: string }> {
  const me = await getMe();
  const { regions } = await json<{ regions: { id: string; wsUrl: string; pingUrl: string }[] }>("/v1/regions");
  if (!regions.length) throw new Error("Không có game region khả dụng");
  const measurements = await Promise.all(regions.map(async (region) => {
    const start = performance.now();
    try { await fetch(region.pingUrl, { cache: "no-store", signal: AbortSignal.timeout(2000) }); return { region, ping: performance.now() - start }; }
    catch { return { region, ping: Number.POSITIVE_INFINITY }; }
  }));
  measurements.sort((a, b) => a.ping - b.ping);
  const selected = measurements[0].region;
  const endpoint = me ? "/v1/game-tickets" : "/v1/game-tickets/guest";
  const result = await json<{ ticket: string }>(endpoint, { method: "POST", body: JSON.stringify({ region: selected.id, guestId: me ? undefined : guestId(), displayName: name, appearance }) });
  return { ticket: result.ticket, serverUrl: selected.wsUrl };
}
