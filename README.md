# Hexagon World

Game chiếm đất trên lưới lục giác (thể loại .io, tương tự hexanaut.io).
Đây là **MVP local, single-player** — chứng minh cơ chế: di chuyển, để lại đuôi/biên
khi ra ngoài, khép vòng để **flood fill** chiếm các ô bên trong.

## Chạy

```bash
npm install
npm run dev
```

Mở http://localhost:3890 → bấm **Chơi**.

- **Điều khiển:** di chuột để đổi hướng. Nhân vật đi từng ô theo hướng con trỏ.
- **Chiếm đất:** đi ra ngoài vùng của mình (hiện đuôi vàng = biên), rồi vòng về chạm
  lại vùng của mình → mọi ô bên trong đổi màu thành của bạn.
- **Chết:** tự đâm vào đuôi của mình → mất đuôi & lãnh thổ, hồi sinh cụm nhỏ.
- **King:** chiếm ≥ 20% bản đồ.

## Kiểm chứng logic (không cần trình duyệt)

```bash
npx tsx scripts/verify-logic.ts
```

## Cấu trúc

```
.implements/        # Kế hoạch & thiết kế (đọc trước khi code) — xem .implements/README.md
app/                # Next.js App Router: / (start), /play (game)
src/game/           # Logic thuần TS, deterministic (tách khỏi render)
  config.ts         #   hằng số gameplay & màu
  hex.ts            #   toán hex (axial, pixel, neighbors, mapCells)
  floodfill.ts      #   thuật toán bao vây (capture)
  state.ts          #   GameState: di chuyển, đuôi, chiếm, chết
src/components/      # Render R3F
  GameScene.tsx     #   Canvas + camera + vòng lặp + input chuột
  HexGridView.tsx   #   InstancedMesh vẽ toàn lưới
  HUD.tsx           #   % diện tích, banner King
scripts/verify-logic.ts   # test logic độc lập
```

## Công nghệ

Next.js 15 · React 19 · React Three Fiber 9 · Three.js · TypeScript.
Chi tiết & lý do: [.implements/01-tech-stack.md](.implements/01-tech-stack.md).

## Development

### Tunnel

```bash
cloudflared tunnel --url http://localhost:3890
```
### Debug Server
```bash
docker compose logs --no-color --tail=200 server
```


## Tiếp theo

Xem lộ trình multiplayer (server authoritative, `ws`/WebRTC, binary protocol, totem,
DB) trong [.implements/05-roadmap.md](.implements/05-roadmap.md).
