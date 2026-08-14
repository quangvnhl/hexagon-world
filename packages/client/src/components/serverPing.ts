const PING_TIMEOUT_MS = 2500;

/** Chuyển URL game WebSocket (host gốc hoặc `/game`) thành health ping cùng node. */
export function serverPingUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (url.protocol === "ws:") url.protocol = "http:";
  else if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("unsupported_server_protocol");
  }
  url.pathname = "/health/ping";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function measureServerPing(serverUrl: string): Promise<number> {
  const startedAt = performance.now();
  const response = await fetch(serverPingUrl(serverUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(PING_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ping_http_${response.status}`);
  return Math.max(0, Math.round(performance.now() - startedAt));
}
