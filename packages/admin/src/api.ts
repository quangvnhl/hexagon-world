// Admin API client tối giản (doc 30 L6b) — KHÔNG phụ thuộc packages/client.
// Gọi xuyên origin tới server game, gửi header x-admin-key. Không dùng cookie ⇒
// không cần credentials (tránh ràng buộc CORS credentials cho origin admin).

import type { CampaignLevelDraft } from "@hexagon/shared";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8910";

export interface AdminLevelRow {
  id: string;
  sort_order: number;
  name: string;
  config: unknown;
  powerups: string[];
  unlock_requires: string | null;
  rewards: { coin: number; xp: number; energy: number };
  published: boolean;
  version: number;
  updated_at: string;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_URL}${path}`;
  let response: Response;
  try {
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has("content-type")) headers.set("content-type", "application/json");
    response = await fetch(url, { ...init, headers });
  } catch {
    throw new Error(`Không thể kết nối máy chủ API (lỗi mạng/CORS): ${url}`);
  }
  if (!response.ok) {
    throw new Error(((await response.json().catch(() => null)) as { message?: string } | null)?.message || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function adminHeaders(key: string): HeadersInit {
  return { "x-admin-key": key };
}

export async function adminListLevels(key: string): Promise<AdminLevelRow[]> {
  return (await json<{ levels: AdminLevelRow[] }>("/internal/v1/admin/levels", { headers: adminHeaders(key), cache: "no-store" })).levels;
}

export async function adminUpsertLevel(key: string, draft: CampaignLevelDraft): Promise<string> {
  return (await json<{ id: string }>("/internal/v1/admin/levels", { method: "POST", headers: adminHeaders(key), body: JSON.stringify(draft) })).id;
}

export async function adminPublishLevel(key: string, id: string, published: boolean): Promise<void> {
  await json(`/internal/v1/admin/levels/${encodeURIComponent(id)}/publish`, { method: "PUT", headers: adminHeaders(key), body: JSON.stringify({ published }) });
}
