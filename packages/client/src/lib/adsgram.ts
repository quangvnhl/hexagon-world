"use client";

import { getTelegramWebApp } from "./telegram";

const SDK_URL = "https://sad.adsgram.ai/js/sad.min.js";
const SDK_TIMEOUT_MS = 10_000;
const SHOW_TIMEOUT_MS = 120_000;

export type AdsgramPlacement = "rewarded-lobby-random" | "interstitial-end-game";
export type AdsgramShowResult = "completed" | "unavailable" | "failed";

interface ShowPromiseResult {
  done: boolean;
  description: string;
  state: "load" | "render" | "playing" | "destroy";
  error: boolean;
}

interface AdController {
  show(): Promise<ShowPromiseResult>;
}

interface AdsgramSdk {
  init(params: { blockId: string }): AdController;
}

declare global {
  interface Window {
    Adsgram?: AdsgramSdk;
  }
}

let sdkPromise: Promise<AdsgramSdk> | null = null;
let inFlight: Promise<AdsgramShowResult> | null = null;
const controllers = new Map<string, AdController>();

export function adsgramBlockId(placement: AdsgramPlacement): string {
  if (placement === "rewarded-lobby-random")
    return process.env.NEXT_PUBLIC_ADSGRAM_REWARDED_LOBBY_RANDOM_BLOCK_ID?.trim() ?? "";
  return process.env.NEXT_PUBLIC_ADSGRAM_INTERSTITIAL_END_GAME_BLOCK_ID?.trim() ?? "";
}

export function isAdsgramPlacementAvailable(placement: AdsgramPlacement): boolean {
  const blockId = adsgramBlockId(placement);
  if (!getTelegramWebApp() || !blockId) return false;
  return placement !== "interstitial-end-game" || /^int-\d+$/.test(blockId);
}

function loadSdk(): Promise<AdsgramSdk> {
  if (window.Adsgram) return Promise.resolve(window.Adsgram);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<AdsgramSdk>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_URL}"]`);
    const script = existing ?? document.createElement("script");
    const timeout = window.setTimeout(
      () => reject(new Error("adsgram_sdk_timeout")),
      SDK_TIMEOUT_MS
    );

    const cleanup = () => {
      window.clearTimeout(timeout);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (window.Adsgram) resolve(window.Adsgram);
      else reject(new Error("adsgram_sdk_missing"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("adsgram_sdk_load_failed"));
    };

    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
    if (!existing) {
      script.src = SDK_URL;
      script.async = true;
      script.dataset.hexagonPlatform = "telegram";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

async function showWithTimeout(controller: AdController): Promise<ShowPromiseResult> {
  let timeout = 0;
  try {
    return await Promise.race([
      controller.show(),
      new Promise<never>((_, reject) => {
        timeout = window.setTimeout(
          () => reject(new Error("adsgram_show_timeout")),
          SHOW_TIMEOUT_MS
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Adapter duy nhất được phép tải/gọi AdsGram. Platform gate chạy trước cả việc
 * tạo thẻ script để web và platform khác không thực thi code Telegram-only.
 */
export async function showAdsgramAd(
  placement: AdsgramPlacement
): Promise<AdsgramShowResult> {
  if (!isAdsgramPlacementAvailable(placement)) return "unavailable";
  if (inFlight) return inFlight;

  const blockId = adsgramBlockId(placement);
  inFlight = (async () => {
    try {
      const sdk = await loadSdk();
      // Kiểm tra lại sau thời gian tải SDK: app có thể đã rời/resume platform.
      if (!getTelegramWebApp()) return "unavailable";
      let controller = controllers.get(blockId);
      if (!controller) {
        controller = sdk.init({ blockId });
        controllers.set(blockId, controller);
      }
      const result = await showWithTimeout(controller);
      return result.done && !result.error ? "completed" : "failed";
    } catch {
      return "failed";
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
