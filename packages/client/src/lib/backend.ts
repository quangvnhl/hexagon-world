import type { PlayerAppearance } from "@hexagon/shared";
import { getTelegramWebApp } from "./telegram";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8910";

export interface BackendPlayer { id: string; displayName: string; platform: string; }
export interface BackendStats { matches: number; wins: number; kills: number; deaths: number; territory_captured: number; updated_at: string; }
export interface BackendProgression { total_xp: number; level: number; updated_at: string; }
export interface InventoryEntry { quantity: number; shop_items: { id: string; sku: string; type: "color" | "shape" | "trail"; asset_key: string; name: string; rarity: string }; }
export interface BackendMe { player: BackendPlayer; profile: { selected_color: string; selected_shape: string; selected_trail_pattern: string } | null; stats: BackendStats | null; progression: BackendProgression | null; wallets: { currency_code: string; balance: number }[]; inventory: InventoryEntry[]; loadout: { color_item_id: string | null; shape_item_id: string | null; trail_item_id: string | null } | null; }
export interface CatalogItem { id: string; sku: string; type: "color" | "shape" | "trail"; asset_key: string; name: string; rarity: string; is_default_free: boolean; shop_prices: { id: string; platform: string; currency_code: "coin" | "XTR"; amount: number; starts_at: string; ends_at: string | null }[]; }
export interface CoinPackage { id: string; sku: string; name: string; coinAmount: number; starsAmount: number; sortOrder: number; }
export interface StarsCoinInvoice { orderId: string; invoiceUrl: string | null; status: string; expiresAt: string | null; }
export interface PaymentOrder { orderId: string; status: string; productKind: string; }

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    // GET/HEAD khong co body khong can Content-Type. Tranh tao preflight CORS
    // khong can thiet trong Telegram WebView va cac trinh duyet mobile.
    if (init?.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
    response = await fetch(url, { ...init, credentials: "include", headers });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "quá thời gian chờ" : "lỗi mạng/CORS";
    throw new Error(`Không thể kết nối máy chủ API (${reason}): ${url}`);
  }
  if (!response.ok) throw new Error((await response.json().catch(() => null) as { message?: string } | null)?.message || `HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function loadRegions(): Promise<{ regions: { id: string; wsUrl: string; pingUrl: string }[] }> {
  try {
    return await json("/v1/regions", { cache: "no-store" });
  } catch (firstError) {
    // Mobile WebView có thể fail request đầu khi vừa resume/chuyển mạng. Retry đúng một lần.
    await new Promise((resolve) => setTimeout(resolve, 300));
    try { return await json("/v1/regions", { cache: "no-store" }); }
    catch { throw firstError; }
  }
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
export async function getCoinPackages(): Promise<CoinPackage[]> { return (await json<{ packages: CoinPackage[] }>("/v1/shop/coin-packages", { cache: "no-store" })).packages; }
export async function createCoinPackageStarsInvoice(packageId: string): Promise<StarsCoinInvoice> {
  return json<StarsCoinInvoice>("/v1/payments/telegram-stars/coin-invoice", {
    method: "POST",
    body: JSON.stringify({ packageId, idempotencyKey: crypto.randomUUID() }),
  });
}
export async function getPaymentOrder(orderId: string): Promise<PaymentOrder> {
  return json<PaymentOrder>(`/v1/payments/orders/${encodeURIComponent(orderId)}`, { cache: "no-store" });
}
export async function equipItem(item: CatalogItem): Promise<void> {
  const key = item.type === "color" ? "colorItemId" : item.type === "shape" ? "shapeItemId" : "trailItemId";
  await json("/v1/loadout", { method: "PUT", body: JSON.stringify({ [key]: item.id }) });
}

// ---- Năng lượng + Campaign (P2) ---------------------------------------------------------------

export interface EnergyStatus { current: number; max: number; regen_interval_seconds: number; next_at: string | null; }
export interface LevelProgress { level_id: string; status: string; stars: number; best_score: number; completed_at: string; }
export interface StartPlayResult { playId: string; energy: EnergyStatus; }

/** Đọc năng lượng hiện tại (server tính hồi lười). */
export async function getEnergy(): Promise<EnergyStatus> {
  return json<EnergyStatus>("/v1/energy", { cache: "no-store" });
}

/** Tiến độ các cấp Campaign của người chơi. */
export async function getCampaignProgress(): Promise<LevelProgress[]> {
  return (await json<{ progress: LevelProgress[] }>("/v1/campaign/progress", { cache: "no-store" })).progress;
}

/** Bắt đầu một cấp: server kiểm mở khóa + trừ 1 năng lượng, trả playId (nonce) + năng lượng mới. */
export async function startCampaignLevel(levelId: string): Promise<StartPlayResult> {
  return json<StartPlayResult>("/v1/campaign/start", {
    method: "POST",
    body: JSON.stringify({ levelId, idempotencyKey: crypto.randomUUID() }),
  });
}

/** Nộp kết quả cấp: server verify play + phát thưởng/mở khóa (thưởng lấy từ catalog). */
export async function completeCampaignLevel(playId: string, objectiveMet: boolean, stars: number, score: number): Promise<LevelProgress> {
  return json<LevelProgress>("/v1/campaign/complete", {
    method: "POST",
    body: JSON.stringify({ playId, objectiveMet, stars, score }),
  });
}

function guestId(): string {
  const key = "hexagon.guest-id";
  let value = localStorage.getItem(key);
  if (!value) { value = crypto.randomUUID().replaceAll("-", ""); localStorage.setItem(key, value); }
  return value;
}

export async function acquireGameAccess(name: string, appearance: PlayerAppearance): Promise<{ ticket: string; serverUrl: string }> {
  const me = await getMe();
  const { regions } = await loadRegions();
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
