import type { ReactNode } from "react";
import Link from "next/link";
import { LEGAL, legalIsPublishable } from "@/lib/legal";

/**
 * doc 35 §C4 — khung chung của ba trang pháp lý.
 *
 * Hai thứ khung này giải quyết, và cả hai đều là lỗi CHỈ lộ ra trên máy thật:
 *
 * 1. **Cuộn được.** `globals.css` đặt `body { position: fixed; overflow: hidden }` cho khung game
 *    (chặn kéo-để-refresh trong Telegram). Trang chữ dài mà nằm trong body đó thì đọc được đúng
 *    một màn hình rồi tắc — và chỉ phát hiện ra khi mở trên điện thoại. Nên trang pháp lý tự dựng
 *    tầng cuộn riêng.
 * 2. **Vùng an toàn.** Mini App của Telegram bị thanh điều khiển của app che mép trên/dưới;
 *    `env(safe-area-inset-*)` đẩy nội dung ra khỏi vùng bị che.
 *
 * KHÔNG phải "use client": ba trang này là chữ tĩnh. Để mặc server component thì chúng không kéo
 * theo React runtime nào và tải được cả khi phần game hỏng — đúng lúc người ta cần trang hỗ trợ
 * nhất là lúc game không chạy.
 */
export function LegalPage({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main style={styles.scroller}>
      <div style={styles.sheet}>
        {!legalIsPublishable() && <UnfilledWarning />}

        <Link href="/" style={styles.back}>← Về game</Link>

        <h1 style={styles.h1}>{title}</h1>
        {subtitle && <p style={styles.subtitle}>{subtitle}</p>}

        {children}

        <hr style={styles.hr} />
        <nav style={styles.nav}>
          <Link href="/terms" style={styles.navLink}>Điều khoản</Link>
          <Link href="/privacy" style={styles.navLink}>Riêng tư</Link>
          <Link href="/paysupport" style={styles.navLink}>Hỗ trợ thanh toán</Link>
        </nav>
        <p style={styles.updated}>Cập nhật lần cuối: {LEGAL.updatedAt}</p>
      </div>
    </main>
  );
}

/**
 * Băng cảnh báo khi hai ô bắt buộc trong `legal.ts` còn trống.
 *
 * Có mặt vì kịch bản hỏng ở đây là IM LẶNG: trang chưa điền vẫn render đẹp, vẫn trông như một
 * trang điều khoản thật, và sẽ được gửi cho Telegram duyệt như thế. Băng này khiến chuyện đó không
 * xảy ra được — ai mở trang cũng thấy ngay.
 */
function UnfilledWarning() {
  return (
    <div style={styles.warn} role="alert">
      <strong style={styles.warnTitle}>⚠️ BẢN NHÁP — CHƯA PHÁT HÀNH ĐƯỢC</strong>
      <p style={styles.warnBody}>
        Chưa điền <code>operator</code> và <code>contactEmail</code> trong{" "}
        <code>packages/client/src/lib/legal.ts</code>. Nội dung bên dưới đã soạn xong, nhưng chưa
        nêu được ai chịu trách nhiệm vận hành nên chưa dùng làm cam kết pháp lý và chưa nộp cho
        Telegram được.
      </p>
    </div>
  );
}

/** Khối một mục có tiêu đề — dùng chung cho cả ba trang. */
export function Section({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section style={styles.section}>
      <h2 style={styles.h2}>{heading}</h2>
      {children}
    </section>
  );
}

export const legalStyles = {
  p: { margin: "0 0 10px", lineHeight: 1.65, color: "#c6d2ea" } as const,
  ul: { margin: "0 0 10px", paddingLeft: 20, lineHeight: 1.65, color: "#c6d2ea" } as const,
  strong: { color: "#e8eefc" } as const,
  table: { width: "100%", borderCollapse: "collapse", margin: "0 0 10px", fontSize: 13 } as const,
  th: { textAlign: "left", padding: "7px 8px", borderBottom: "1px solid rgba(255,255,255,.16)", color: "#8fa6cc", fontWeight: 600, whiteSpace: "nowrap" } as const,
  td: { padding: "7px 8px", borderBottom: "1px solid rgba(255,255,255,.07)", verticalAlign: "top", lineHeight: 1.55, color: "#c6d2ea" } as const,
  a: { color: "#5fc0ff" } as const,
};

const styles = {
  // Tầng cuộn riêng — xem ghi chú 1 ở đầu file.
  scroller: {
    position: "fixed",
    inset: 0,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    background: "#0a0e16",
  } as const,
  sheet: {
    maxWidth: 720,
    margin: "0 auto",
    padding: "calc(18px + env(safe-area-inset-top)) 18px calc(40px + env(safe-area-inset-bottom))",
    color: "#e8eefc",
    fontSize: 14,
  } as const,
  back: { display: "inline-block", marginBottom: 14, color: "#8fa6cc", fontSize: 13, textDecoration: "none" } as const,
  h1: { margin: "0 0 6px", fontSize: 21, letterSpacing: 0.2 } as const,
  subtitle: { margin: "0 0 18px", color: "#8fa6cc", fontSize: 13, lineHeight: 1.6 } as const,
  section: { margin: "0 0 20px" } as const,
  h2: { margin: "0 0 8px", fontSize: 15, color: "#ffe27a" } as const,
  hr: { margin: "26px 0 14px", border: 0, borderTop: "1px solid rgba(255,255,255,.12)" } as const,
  nav: { display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 10, fontSize: 13 } as const,
  navLink: { color: "#5fc0ff" } as const,
  updated: { margin: 0, color: "#6c7f9e", fontSize: 12 } as const,
  warn: { margin: "0 0 18px", padding: "11px 13px", border: "1px solid rgba(255,120,120,.45)", borderRadius: 10, background: "rgba(255,80,80,.1)" } as const,
  warnTitle: { display: "block", marginBottom: 5, color: "#ff9a9a", fontSize: 13 } as const,
  warnBody: { margin: 0, fontSize: 12.5, lineHeight: 1.6, color: "#e4c4c4" } as const,
};
