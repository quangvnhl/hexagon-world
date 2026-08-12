# 04 — MVP Tasks (chia việc cho sub-agents)

Mục tiêu MVP: **single-player, local**, chứng minh cơ chế chiếm đất + đuôi + biên.
Stack: Next.js (App Router) + React 19 + React Three Fiber v9 + Three.js + TypeScript.

> Trạng thái: **scaffold đã dựng sẵn** trong repo. Các task dưới đây mô tả ranh giới để
> mở rộng/hoàn thiện. Mỗi task có Định nghĩa hoàn thành (DoD).

## Task A — Hex math (`src/game/hex.ts`)
- Axial `(q,r)`, cube round, `axialToPixel`, `pixelToAxial`, `neighbors`, `distance`,
  `key`/`parseKey`, `mapCells(radius)`, `DIRECTIONS`.
- **DoD:** round-trip `axialToPixel → pixelToAxial → round` ổn định; `mapCells(R)` đúng số ô.

## Task B — Flood fill (`src/game/floodfill.ts`)
- Hàm `captureEnclosed(mapSet, owned, trail): Set<key>` trả về tập ô cần thêm vào owned
  (interior + trail) theo thuật toán ở [03-hex-math.md](03-hex-math.md).
- **DoD:** với một vòng đơn giản bao quanh vài ô, trả đúng các ô bên trong.

## Task C — Game state (`src/game/state.ts`, `src/game/config.ts`)
- **Di chuyển liên tục:** `GameState` có `pos`, `heading`, `owned`, `trailHexes`,
  `trailPoints`, `update(dt)`, `moveTo(x,y)`, `reset()`, `setHeadingTarget(angle)`,
  `territoryPct()`, `isKing`.
- Xử lý: nội suy `hexLinedraw` khi đổi ô; khép vòng → capture; tự cắt đuôi → chết.
- **DoD:** đi ra ngoài vẽ vòng rồi về → owned tăng đúng; đâm đuôi → reset
  (xem `scripts/verify-logic.ts`).

## Task D — Render R3F (`src/components/*`)
- `GameScene`: `<Canvas>` + **PerspectiveCamera** (rotation KHOÁ cố định, chỉ **pan**
  theo người chơi — không xoay theo chuột) + `ambient/directionalLight` + `GameLoop`
  (`useFrame` gọi `game.update(dt)`). Tham số camera & sân trong `config.ts`.
- `HexGridView`: `InstancedMesh` lục giác; tô `instanceColor` theo owned / hex-đuôi /
  neutral, chỉ khi `gridRevision` đổi.
- `PlayerCube`: cube 3D (`meshStandardMaterial`), `rotation.z = heading` (camera nghiêng
  tự lộ khối 3D).
- `TrailLine`: đuôi là ỐNG 3D phát sáng (`TubeGeometry` dựng lại mỗi frame từ `trailPoints`).
- Input chuột: **raycast** NDC con trỏ xuống mặt phẳng z=0 → điểm world → `targetHeading`
  (chính xác dưới camera perspective).
- **DoD:** thấy lưới, cube xoay theo chuột, ống đuôi + hex-đuôi hiện khi ra ngoài, vùng
  đổi màu khi chiếm; chạm biên trượt không dừng; camera perspective bám mượt.

## Task E — App shell & HUD (`app/*`)
- `/` trang start đơn giản → nút "Chơi" sang `/play`.
- `HUD`: hiển thị `% diện tích`, banner **KING** khi ≥ 20%, hướng dẫn điều khiển.
- **DoD:** vào `/play` chơi được ngay; HUD cập nhật realtime.

## Lệnh chạy
```bash
npm install
npm run dev   # http://localhost:3890  → bấm Chơi
```

## Ranh giới & quy ước
- Không đưa logic vào React state. `GameState` là TS thuần; component chỉ đọc để render.
- Giữ `src/game/*` không import Three/React (để sau bê sang `packages/shared`).
- Màu, kích thước, tốc độ nằm trong `src/game/config.ts` — chỉnh ở đây, không rải khắp nơi.

## Ngoài phạm vi MVP (đừng làm ở pha này)
- Multiplayer, server, socket, bot, totem, DB, mobile joystick, đồng hồ King 3 phút.
  → xem [05-roadmap.md](05-roadmap.md).
