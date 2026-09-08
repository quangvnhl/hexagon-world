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

// ---- Remote config (doc 35 §A2 — lát a2.3) ------------------------------------------------------

export interface AdminConfigRow {
  key: string;
  value: unknown;
  audience: unknown;
  version: number;
  updated_at: string;
  updated_by: string | null;
}

export interface AdminConfigAudit {
  id: number;
  key: string;
  old_value: unknown;
  new_value: unknown;
  old_audience: unknown;
  new_audience: unknown;
  changed_at: string;
  changed_by: string | null;
}

export async function adminListConfig(key: string): Promise<AdminConfigRow[]> {
  return (await json<{ rows: AdminConfigRow[] }>("/internal/v1/admin/config", { headers: adminHeaders(key), cache: "no-store" })).rows;
}

export async function adminConfigHistory(key: string, configKey: string): Promise<AdminConfigAudit[]> {
  return (await json<{ history: AdminConfigAudit[] }>(
    `/internal/v1/admin/config/${encodeURIComponent(configKey)}/history`,
    { headers: adminHeaders(key), cache: "no-store" },
  )).history;
}

/**
 * `version` là bản người dùng ĐANG NHÌN. Server từ chối nếu nó không còn khớp — xem ghi chú khoá
 * lạc quan trong `RemoteConfig.tsx`.
 *
 * Mọi lời gọi ghi đều cần `Idempotency-Key` (lát c2.1 bắt buộc ở tầng guard).
 */
export async function adminSetConfig(
  key: string, configKey: string, value: unknown, audience: unknown, version: number,
): Promise<{ version: number }> {
  return json<{ version: number }>(`/internal/v1/admin/config/${encodeURIComponent(configKey)}`, {
    method: "PUT",
    headers: { ...adminHeaders(key), "idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({ value, audience, version }),
  });
}

/** Xem trước bằng `?dry_run=true` (lát c2.2). Không đổi gì; trả giá trị hiện tại để đối chiếu. */
export async function adminPreviewConfig(
  key: string, configKey: string, value: unknown, audience: unknown, version: number,
): Promise<Record<string, unknown>> {
  return json<Record<string, unknown>>(
    `/internal/v1/admin/config/${encodeURIComponent(configKey)}?dry_run=true`,
    {
      method: "PUT",
      headers: { ...adminHeaders(key), "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ value, audience, version }),
    },
  );
}
