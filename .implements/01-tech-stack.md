# 01 — Tech Stack (đã chọn)

Quyết định đã chốt với chủ dự án. Ưu tiên: (a) khớp tầm nhìn WebGL/3D top-down,
(b) tái sử dụng code giữa MVP và bản full, (c) tách logic khỏi render.

## Frontend / Client

| Hạng mục | Lựa chọn | Lý do |
|----------|----------|-------|
| Framework UI | **Next.js (App Router) + React 19** | Lobby, Store, Auth dùng chung React; SSR cho trang tĩnh |
| Render 3D | **Three.js** qua **React Three Fiber (R3F) v9** | WebGL bắt buộc; R3F cho phép trộn UI HTML + Canvas 3D đồng bộ |
| Helper 3D | **@react-three/drei** | OrthographicCamera, helpers, performance utils |
| Ngôn ngữ | **TypeScript** (strict) | An toàn kiểu cho hex math & protocol |
| State (UI) | Zustand (nhẹ) — thêm ở giai đoạn HUD phức tạp | Tránh re-render Canvas |
| Camera | Orthographic, top-down | Nhìn từ trên xuống như hexanaut |
| Render lưới | **InstancedMesh** + per-instance color | Hàng nghìn hex vẫn 1 draw call |

> **Ghi chú hiệu năng:** logic game **không** đặt trong React state (sẽ gây re-render).
> Dùng một `GameState` thuần TS + vòng lặp `useFrame`, chỉ đẩy dữ liệu tối thiểu ra HUD.

## Backend (giai đoạn multiplayer — chưa dùng trong MVP)

| Hạng mục | Lựa chọn | Lý do |
|----------|----------|-------|
| Runtime | Node.js + **NestJS** | Chia module rõ: Matchmaking, GameRoom, PlayerState |
| Realtime | **`ws` thuần** (không Socket.io) | Ít overhead; sau nâng lên **WebRTC DataChannel (UDP-like)** để bỏ HOL blocking của TCP |
| Serialization | **Binary** — bắt đầu bằng bit-packing thủ công, cân nhắc **FlatBuffers** | Toạ độ vài byte thay vì JSON; FlatBuffers zero-copy đọc nhanh hơn Protobuf |
| Game loop | Tick **20–30 Hz**, authoritative | Server tính va chạm & phát snapshot |
| Realtime store | **Redis** | Matchmaking, leaderboard trong RAM |
| Persistent DB | **PostgreSQL** (Prisma) | Account, XP, skin, tiến trình |
| Spatial index | **Spatial hashing** trên lưới lớn | Tránh O(n²) khi kiểm tra cắt đuôi |

## Monorepo (khi lên multiplayer)

```
packages/
  shared/   # hex math, luật flood fill, định nghĩa protocol — DÙNG CHUNG client+server
  client/   # Next.js + R3F
  server/   # NestJS + ws
```

MVP hiện tại là **client-only** trong repo gốc (Next.js). Khi bắt đầu server, tách
`src/game/*` sang `packages/shared` (đã viết dạng thuần TS, deterministic để tách dễ).

## Vì sao không dùng Socket.io / JSON / Canvas2D cho bản full?
- **Socket.io:** thêm framing/room overhead, khó kiểm soát băng thông; game .io cần tối giản.
- **JSON:** tốn byte & CPU parse ở 20–30 Hz × N người chơi.
- **Canvas 2D:** không tận dụng GPU cho hàng nghìn hex + hiệu ứng; chủ dự án yêu cầu WebGL.

## Rủi ro & lưu ý
- R3F v9 yêu cầu **React 19**; drei v10 yêu cầu R3F v9 — giữ 3 phiên bản đồng bộ.
- WebRTC cần signaling server + TURN/STUN cho NAT; để giai đoạn sau, mặc định `ws` trước.
- FlatBuffers có bước codegen; MVP protocol có thể bắt đầu bằng `DataView` thủ công.
