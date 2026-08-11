# 03 — Hex Math (hệ toạ độ lục giác)

Tham chiếu chuẩn: Red Blob Games — "Hexagonal Grids".

## Quy ước dự án

- **Hướng:** pointy-top (đỉnh nhọn hướng lên).
- **Toạ độ lưu trữ:** **Axial** `(q, r)`.
- **Toạ độ tính toán khoảng cách / round:** **Cube** `(x, y, z)` với `x + y + z = 0`,
  trong đó `x = q`, `z = r`, `y = -x - z`.
- **Key trong Map/Set:** chuỗi `"q,r"` (hàm `key(q, r)`).

## Chuyển đổi Axial ↔ Pixel (pointy-top)

Với `size` = bán kính hex (tâm → đỉnh):

```
x = size * (√3 * q + √3/2 * r)
y = size * (3/2 * r)
```

Ngược lại (pixel → axial, chưa làm tròn):

```
q = (√3/3 * x - 1/3 * y) / size
r = (2/3 * y) / size
```

Sau đó **cube_round** để ra ô gần nhất (làm tròn từng trục cube rồi sửa trục có sai
số lớn nhất để giữ `x+y+z=0`).

## 6 hướng láng giềng (axial, pointy-top)

```
directions = [
  (+1,  0), (+1, -1), ( 0, -1),
  (-1,  0), (-1, +1), ( 0, +1),
]
```

Chỉ số hướng 0..5 dùng để: chọn hướng theo góc chuột, và chặn quay đầu 180°
(hướng ngược = `(dir + 3) % 6`).

## Khoảng cách (cube)

```
distance = (|x1-x2| + |y1-y2| + |z1-z2|) / 2
```

## Bản đồ

- `mapCells(R)` — sân hình lục giác theo cube distance: mọi `(q,r)` có
  `cubeDistance(center) <= R` (số ô ≈ `3R²+3R+1`). Dùng cho unit test toán hex.
- `mapRect(halfW, halfH, size)` — sân **hình chữ nhật**: mọi hex có TÂM nằm trong
  `[-halfW,halfW] × [-halfH,halfH]`. (Không còn dùng cho MVP; giữ cho test/tham chiếu.)
- **`mapArena(margin)`** trong `src/game/arena.ts` — sân **LỤC GIÁC đều (flat-top)**
  (MVP hiện dùng): mọi hex có TÂM nằm trong lục giác bán kính ngoại tiếp
  `CONFIG.ARENA_RADIUS`, nới thêm `margin`. Biên là **6 tường nghiêng 120°** → không
  còn góc vuông gây kẹt; vùng chơi = giao 6 nửa mặt phẳng `{ p : p·nₖ ≤ inradius }`.

### Va chạm & trượt tường (biên lồi tổng quát — `arena.ts`)

- `insideArena(x,y,slack)` — điểm có trong sân không (nới/thu biên `slack`).
- `clampInside(x,y)` — kéo điểm về trong lục giác lồi (chiếu lên các tường bị vượt).
- **`slideMove(x,y,heading,dist)` — trượt tường GIỮ TỐC ĐỘ ĐẦY ĐỦ (nguồn chân lý va
  chạm di chuyển, dùng chung server `updateEntity` + client `stepHead`):** dịch theo
  hướng rồi `clampInside`; nếu tường cắt bớt bước mà CÒN thành phần trượt (song song
  tường) đáng kể → KÉO DÀI phần trượt về đủ `dist` rồi clamp lại → men theo biên ở tốc
  độ đầy đủ, **hết crawl/kẹt**. Chỉ đứng lại khi đâm gần như VUÔNG GÓC tuyệt đối / ép
  đúng ĐỈNH lồi (không còn tiếp tuyến). Trả thêm `blocked` = bước bị tường cắt.
- **Không còn guard "chết oan tự đâm đuôi":** `slideMove` không bao giờ sinh vận tốc
  LÙI (chỉ tiến/tiếp tuyến), nên `updateEntity` bước thẳng — nếu ô đích là đuôi của
  chính mình thì đó là tự cắt đuôi THẬT (đúng luật), không phải giật lùi do clamp.

## Thuật toán chiếm đất (Flood Fill / "bao vây")

Khi đuôi khép kín về lãnh thổ:

1. **Barrier** = `owned ∪ trail` (các ô không cho loang qua).
2. Chạy **BFS từ mọi ô biên bản đồ** (ô có `cubeDistance == MAP_RADIUS`) **không** nằm
   trong barrier → tập `outside` (vùng thông ra "biển ngoài").
3. Với mỗi ô bản đồ **không** thuộc barrier và **không** thuộc `outside` → nó **bị nhốt
   bên trong** → chuyển thành `owned`.
4. Thêm toàn bộ `trail` vào `owned`. Xoá `trail`.

> Độ phức tạp O(số ô bản đồ). Với server nhiều người chơi, giới hạn BFS trong
> bounding-box của (đuôi + lãnh thổ) để tối ưu.

## Kiểm tra va chạm (giai đoạn multiplayer)

- Không duyệt O(n²). Dùng **spatial hashing**: chia bản đồ thành các bucket lớn
  (vd 8×8 ô). Mỗi tick chỉ so trail/đầu người chơi với các bucket lân cận.
- Va chạm "cắt đuôi": đầu người chơi A rơi vào ô thuộc `trail` của B → B chết.

## Bất biến (invariants) cần giữ
- `owned`, `trail` luôn là tập con của tập ô bản đồ hợp lệ.
- Một ô không đồng thời vừa `owned` vừa `trail`.
- Sau capture: `trail` rỗng, đầu người chơi nằm trong `owned`.
