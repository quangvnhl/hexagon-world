import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { AnalyticsBoot } from "@/components/AnalyticsBoot";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hexagon World",
  description: "Game chiếm đất lục giác — MVP local",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <Script
        src="https://telegram.org/js/telegram-web-app.js"
        strategy="beforeInteractive"
      />
      <body>
        <AnalyticsBoot />
        {children}
      </body>
    </html>
  );
}
