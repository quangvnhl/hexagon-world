import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hexagon World",
  description: "Game chiếm đất lục giác — MVP local",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
