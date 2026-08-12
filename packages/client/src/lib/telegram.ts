"use client";

import { useEffect, useState } from "react";

type HapticNotification = "error" | "success" | "warning";
type HapticImpact = "light" | "medium" | "heavy" | "rigid" | "soft";

export const TELEGRAM_BACKGROUND_COLOR = "#0a0e16";

interface TelegramUser {
  first_name?: string;
  last_name?: string;
  username?: string;
}

interface TelegramBackButton {
  show(): TelegramBackButton;
  hide(): TelegramBackButton;
  onClick(callback: () => void): TelegramBackButton;
  offClick(callback: () => void): TelegramBackButton;
}

export interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: TelegramUser };
  ready(): void;
  expand(): void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  isVersionAtLeast?: (version: string) => boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  openInvoice?: (url: string, callback?: (status: "paid" | "cancelled" | "failed" | "pending") => void) => void;
  safeAreaInset?: { top: number; right: number; bottom: number; left: number };
  contentSafeAreaInset?: { top: number; right: number; bottom: number; left: number };
  onEvent?: (event: TelegramViewportEvent, callback: () => void) => void;
  offEvent?: (event: TelegramViewportEvent, callback: () => void) => void;
  BackButton?: TelegramBackButton;
  HapticFeedback?: {
    notificationOccurred(type: HapticNotification): void;
    impactOccurred(style: HapticImpact): void;
  };
}

type TelegramViewportEvent =
  | "contentSafeAreaChanged"
  | "safeAreaChanged"
  | "fullscreenChanged"
  | "viewportChanged";

const TELEGRAM_VIEWPORT_EVENTS: TelegramViewportEvent[] = [
  "contentSafeAreaChanged",
  "safeAreaChanged",
  "fullscreenChanged",
  "viewportChanged",
];

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = window.Telegram?.WebApp;
  // telegram-web-app.js also creates a stub in a normal browser. initData is the
  // reliable client-side signal that this page was launched as a Mini App.
  return app?.initData ? app : null;
}

export function getTelegramUserName(): string | null {
  const user = getTelegramWebApp()?.initDataUnsafe?.user;
  if (!user) return null;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || user.username || null;
}

function supports(app: TelegramWebApp, version: string): boolean {
  return app.isVersionAtLeast?.(version) ?? true;
}

function safely(action: (() => void) | undefined): void {
  try {
    action?.();
  } catch {
    // Old/unsupported Telegram clients must keep the normal web fallback working.
  }
}

export function notifyTelegramHaptic(type: HapticNotification): void {
  const app = getTelegramWebApp();
  if (!app || !supports(app, "6.1")) return;
  safely(() => app.HapticFeedback?.notificationOccurred(type));
}

export function impactTelegramHaptic(style: HapticImpact = "light"): void {
  const app = getTelegramWebApp();
  if (!app || !supports(app, "6.1")) return;
  safely(() => app.HapticFeedback?.impactOccurred(style));
}

/** Khởi tạo Mini App và điều khiển BackButton theo màn Welcome/Game. */
export function useTelegramWebApp(inGame: boolean, onBack: () => void): boolean {
  const [isTelegram, setIsTelegram] = useState(false);

  useEffect(() => {
    const app = getTelegramWebApp();
    setIsTelegram(Boolean(app));
    if (!app) return;

    const syncSafeArea = () => {
      const content = app.contentSafeAreaInset;
      const system = app.safeAreaInset;
      const root = document.documentElement.style;
      root.setProperty(
        "--telegram-hud-portrait-offset",
        window.matchMedia("(orientation: portrait)").matches ? "30px" : "0px"
      );
      for (const side of ["top", "right", "bottom", "left"] as const) {
        root.setProperty(
          `--telegram-safe-${side}`,
          `${Math.max(content?.[side] ?? 0, system?.[side] ?? 0)}px`
        );
      }
    };

    for (const event of TELEGRAM_VIEWPORT_EVENTS)
      safely(() => app.onEvent?.(event, syncSafeArea));
    safely(() => app.setHeaderColor?.(TELEGRAM_BACKGROUND_COLOR));
    safely(() => app.setBackgroundColor?.(TELEGRAM_BACKGROUND_COLOR));
    if (supports(app, "7.10"))
      safely(() => app.setBottomBarColor?.(TELEGRAM_BACKGROUND_COLOR));
    safely(() => app.ready());
    safely(() => app.expand());
    if (supports(app, "7.7")) safely(() => app.disableVerticalSwipes?.());
    if (supports(app, "8.0")) safely(() => app.requestFullscreen?.());
    syncSafeArea();
    window.addEventListener("resize", syncSafeArea);
    window.addEventListener("orientationchange", syncSafeArea);

    return () => {
      for (const event of TELEGRAM_VIEWPORT_EVENTS)
        safely(() => app.offEvent?.(event, syncSafeArea));
      window.removeEventListener("resize", syncSafeArea);
      window.removeEventListener("orientationchange", syncSafeArea);
    };
  }, []);

  useEffect(() => {
    const backButton = getTelegramWebApp()?.BackButton;
    if (!backButton) return;

    backButton.offClick(onBack);
    if (inGame) {
      backButton.onClick(onBack).show();
    } else {
      backButton.hide();
    }

    return () => {
      backButton.offClick(onBack);
      backButton.hide();
    };
  }, [inGame, onBack]);

  return isTelegram;
}
