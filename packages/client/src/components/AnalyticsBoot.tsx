"use client";

import { useEffect } from "react";
import { startBrowserAnalytics, track } from "@/lib/analytics";

/**
 * Khởi động đường ống phân tích + phát `app_open` (doc 35 §A1, lát a1.6).
 *
 * Đặt trong `layout.tsx` để chạy đúng MỘT lần cho cả app, trước mọi trang. Không render gì.
 *
 * Vì sao `app_open` phát ở đây chứ không ở trang chủ: người chơi có thể vào thẳng `/campaign`
 * hoặc `/netplay` qua deep link của Telegram; nếu đo ở trang chủ thì những phiên đó biến mất
 * khỏi mẫu số và mọi tỉ lệ chuyển đổi đều sai theo hướng đẹp lên.
 */
export function AnalyticsBoot(): null {
  useEffect(() => {
    startBrowserAnalytics();
    track("app_open");
  }, []);
  return null;
}
