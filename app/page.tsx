import Link from "next/link";

export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        gap: 24,
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 14, letterSpacing: 4, opacity: 0.6 }}>MVP LOCAL</div>
      <h1
        style={{
          fontSize: 56,
          margin: 0,
          background: "linear-gradient(90deg,#31b0ff,#ffd23f)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        Hexagon World
      </h1>
      <p style={{ maxWidth: 520, opacity: 0.8, lineHeight: 1.6 }}>
        Điều khiển nhân vật, đi ra ngoài vùng của mình để tạo đuôi, rồi khép vòng
        quay về để chiếm các ô lục giác. Chiếm {">"} 20% bản đồ để thành Nhà Vua.
      </p>
      <Link
        href="/play"
        style={{
          marginTop: 8,
          padding: "14px 40px",
          borderRadius: 999,
          background: "linear-gradient(90deg,#31b0ff,#2b8be0)",
          color: "white",
          fontWeight: 700,
          fontSize: 18,
          textDecoration: "none",
          boxShadow: "0 8px 30px rgba(49,176,255,0.4)",
        }}
      >
        ▶ Chơi
      </Link>
    </main>
  );
}
