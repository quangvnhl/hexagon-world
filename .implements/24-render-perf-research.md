# 24 — Tổng hợp nghiên cứu hiệu năng render

> **Phạm vi:** tài liệu tổng hợp các kết luận đã **thống nhất** trong buổi nghiên cứu
> hiệu năng render (chỉ phân tích, **CHƯA sửa code**). Dùng làm nguồn tham chiếu khi
> triển khai. Dành cho: Frontend + Gameplay + Design.

## Bối cảnh

Rà soát kiến trúc render hiện tại (Next.js + React-Three-Fiber v9 + Three.js) để trả
lời hai câu hỏi lớn: (1) đổi bản đồ sang assets 2D + nhân vật 3D có cải thiện hiệu năng
/ giảm nóng máy mobile không; (2) có cần đổi framework WebGL, gộp hết UI/text vào canvas
không. Kết quả: **không** cho cả hai — thay vào đó là các tối ưu *bên trong* kiến trúc lai
hiện tại.

## Ảnh chụp kiến trúc render hiện tại

- **Lưới hex:** 1 `InstancedMesh` cho toàn bộ ~50.000 ô (`HexGridView.tsx`), có
  view-culling theo camera → **1 draw call**, nhưng đang dùng `meshStandardMaterial` (PBR).
- **Nhân vật / totem / viền:** vài `InstancedMesh` + `meshStandardMaterial`.
- **Vệt đuôi:** ribbon **2D phẳng** dọc `CatmullRomCurve3` (`trailRibbonGeometry.ts`),
  `meshBasicMaterial` blending **thường** (không additive), 1 mesh/thực thể, texture SVG.
- **Viền lãnh thổ:** 2 lớp quad `meshBasicMaterial transparent`, lõi **additive**
  (`TerritoryBorders.tsx`).
- **UI:** HTML/CSS (HUD, StartPanel, ShopPanel) + MiniMap canvas 2D riêng.
- **Không** có post-processing (không EffectComposer/Bloom). DPR cap `[1, 1.5]`.

## Quyết định đã CHỐT

| # | Quyết định | Ghi chú kỹ thuật |
|---|------------|------------------|
| 1 | **Đổi material lưới hex** `meshStandardMaterial` (PBR) → `meshBasicMaterial`/`meshLambertMaterial` | PBR phủ kín màn hình = chi phí fragment lớn nhất & nguồn nóng máy #1. `HexGridView.tsx:188`. |
| 2 | **UI giữ HTML/CSS** (không nhồi vào WebGL, không đổi framework) | Thêm Lottie/Rive khi cần animation UI. Kiến trúc lai chuẩn. |
| 3 | **Vệt đuôi giữ nguyên** (ribbon 2D + CatmullRom + không additive + không chồng lớp) | Đã đúng thiết kế mong muốn — không cần đổi. |
| 4 | **Không** chuyển `transparent` → `opaque+alphaTest` cho đuôi | Chấp nhận giữ mép mềm; bỏ qua overdraw blend nhỏ của đuôi. |
| 5 | **Skin ô đất = tính năng PREMIUM** | Texture ô đất tùy biến từ thiết lập, áp cho skin premium. Kỹ thuật: material mới (basic/lambert + `map`) × `instanceColor`; đa dạng theo TỪNG ô cần **texture atlas + UV-offset theo instance**. |

### Chi tiết #1 — đổi material mở khóa thiết kế

`meshBasicMaterial`/`meshLambertMaterial` đều nhận `map` (texture base color). Với lưới
đang là InstancedMesh + màu theo instance (`setColorAt`), kết quả = `instanceColor × map`.
Cách sạch nhất để đa dạng: texture **xám** (vân/vát cạnh) × màu chủ sở hữu → mỗi người một
màu nhưng có hoa văn, vẫn 1 draw call. Đây là nền cho quyết định #5 (skin premium).

## Phát hiện đã làm rõ (không cần hành động / ưu tiên thấp)

- **Viền lãnh thổ KHÔNG rebuild mỗi frame.** `TerritoryBorders.tsx:57` early-return khi
  `territoryRevision` không đổi; buffer tái dùng (`DynamicDrawUsage` + `setDrawRange`), GC
  thấp. (Đính chính nhận định ban đầu.)
- **Quét lại toàn bộ ô sở hữu khi đổi 1 ô** (`game.forEachOwned` trong flood fill/viền):
  O(số ô đất) **một lần mỗi lần đổi chủ** = spike CPU <1ms, **KHÔNG gây nóng máy** (nóng do
  việc nặng *liên tục mỗi frame*, không phải spike). Chỉ jank khi lãnh thổ cực lớn + đổi chủ
  dồn dập. Ưu tiên **thấp**; nếu cần thì tối ưu tăng dần (chỉ tính cạnh quanh ô đổi).
- **Flood fill (`captureEnclosed`) ĐÚNG — không chiếm oan vùng khác.** Barrier = owned∪trail
  của *riêng* thực thể; chỉ chiếm ô thực sự bị vây (không với tới "outside"). Kịch bản "khép
  vòng 1 vùng → các vùng trung lập khác cũng bị fill" **không** xảy ra (đã kiểm chứng: các ô
  xa đều không bị chiếm). Một vòng bao **nhiều túi** thì chiếm hết các túi bên trong — đúng,
  không phải bug. Tối ưu bbox (hộp bao owned∪trail nới 1 vành) **tương đương** quét toàn map;
  chi phí chỉ tăng khi thực thể giữ lãnh thổ **rời rạc trải rộng** → bbox to (khớp điểm perf
  ở trên, ưu tiên thấp).
- **Overdraw do transparent** là vấn đề *số lớp blend + diện tích*, **không** phải *định
  dạng nguồn*. Đổi sang ảnh/SVG **không** giảm overdraw (thậm chí nặng hơn do lấy mẫu
  texture). Muốn giảm: giảm số lớp trong suốt, hoặc **bake** viền vào nền đục (mất glow
  additive). Overdraw additive+chồng lớp thuộc **VIỀN lãnh thổ**, KHÔNG phải đuôi.

## Nguồn nóng máy mobile (xếp theo mức tác động)

1. 🔴 Fragment shader PBR của **lưới sân** phủ kín màn hình → **quyết định #1** giải quyết.
2. 🟠 Overdraw lớp transparent (viền lãnh thổ) — giảm số lớp / bake nếu cần.
3. 🟠 DPR (đã cap 1.5; máy yếu có thể hạ 1.25) + chạy 60fps liên tục (cap 30–45 trên mobile).
4. 🟠 Cập nhật React HUD mỗi frame (dùng ref/throttle, không setState mỗi frame).

## Sơ đồ kiến trúc render lai

Canvas WebGL + UI DOM + Asset pipeline, cùng nguồn `GameState` (shared):
- Artifact: https://claude.ai/code/artifact/aa2ff13c-a006-40a1-b197-b977ab850b08

Nguyên tắc: **logic** ở shared (deterministic) → **scene 3D** ở canvas WebGL (đồng bộ mỗi
frame qua `useFrame`) → **UI** ở DOM (throttle/ref). UI DOM ở tầng compositor riêng nên UI
nhiều ảnh **không** đè chi phí lên fragment shader của scene. UI casual nhiều ảnh → trọng
tâm là **asset pipeline**: sprite atlas, WebP/AVIF, lazy-load, `image-set` theo DPR.

## Hạng mục còn mở (bàn khi triển khai)

- **Atlas + UV-offset theo instance** cho skin ô đất premium (mỗi ô/vùng texture khác nhau).
- Tối ưu **tăng dần** flood-fill/viền cho trường hợp lãnh thổ rời rạc trải rộng (ưu tiên thấp).
