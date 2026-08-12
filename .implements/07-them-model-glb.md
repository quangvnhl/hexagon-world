# Hướng dẫn thêm model GLB

Tài liệu này mô tả quy trình thêm một nhân vật GLB vào màn Welcome và sử dụng model đó
trong cả chế độ chơi đơn lẫn nhiều người.

## 1. Chuẩn bị model

- Dùng định dạng `.glb` (binary glTF), ưu tiên một file duy nhất đã nhúng texture.
- Tối ưu số polygon và kích thước texture trước khi đưa vào game. Nên giữ file dưới vài MB để
  màn Welcome và trận đấu tải nhanh trên thiết bị di động.
- Đặt tên file bằng chữ thường, không dấu và không có khoảng trắng, ví dụ `dragonfly.glb`.
- Model có thể dùng trục Y-up theo chuẩn glTF. Renderer hiện tại sẽ xoay sang mặt phẳng Z-up của game,
  tự căn tâm, đưa đáy model về `z = 0` và scale vừa một ô lục giác.
- Material gốc và texture vẫn được giữ; màu nhân vật sẽ tint lên material để đồng bộ màu nhân vật,
  lãnh thổ và vệt đuôi.

## 2. Chép file vào thư mục public

Đặt model tại:

```text
packages/client/public/models/dragonfly.glb
```

Sau khi chạy client, file phải truy cập được bằng URL `/models/dragonfly.glb`. Tên file và chữ
hoa/chữ thường phải khớp tuyệt đối vì máy chủ Linux phân biệt hoa thường.

## 3. Đăng ký shape trong shared contract

Mở `packages/shared/src/config.ts`, thêm khóa mới vào cuối `PLAYER_SHAPES`:

```ts
export const PLAYER_SHAPES = [
  "cube",
  "cylinder",
  "sphere",
  "cone",
  "fly",
  "bee",
  "ladybug",
  "dragonfly",
] as const;
```

Quan trọng: chỉ nối shape mới ở cuối danh sách. Không đổi thứ tự hoặc xóa shape cũ vì vị trí trong
`PLAYER_SHAPES` chính là `shapeIndex` được truyền trong binary protocol multiplayer. Đổi thứ tự sẽ làm
client và server hiểu sai model của người chơi.

## 4. Ánh xạ khóa shape sang file GLB

Mở `packages/client/src/components/PlayerCube.tsx`, thêm URL vào `MODEL_URLS`:

```ts
const MODEL_URLS = {
  fly: "/models/low_poly_house_fly_diptera.glb",
  bee: "/models/bee.glb",
  ladybug: "/models/ladybug.glb",
  dragonfly: "/models/dragonfly.glb",
} as const satisfies Partial<Record<PlayerShape, string>>;
```

Nạp scene mới trong component:

```ts
const { scene: dragonflySource } = useGLTF(MODEL_URLS.dragonfly);
```

Sau đó thêm scene vào `modelSources`:

```ts
const modelSources: Record<ModelShape, THREE.Object3D> = {
  fly: flySource,
  bee: beeSource,
  ladybug: ladybugSource,
  dragonfly: dragonflySource,
};
```

Vòng lặp cuối file tự preload toàn bộ URL trong `MODEL_URLS`, nên không cần thêm lệnh preload riêng
hoặc viết component render riêng cho model mới.

## 5. Thêm tên và biểu tượng ở màn Welcome

Mở `packages/client/src/components/StartPanel.tsx`:

1. Thêm nhãn vào `SHAPE_LABEL`:

   ```ts
   dragonfly: "Dragonfly",
   ```

2. Nếu muốn có biểu tượng riêng trong nút chọn, thêm vào `insectGlyph` của `ShapeGlyph`:

   ```ts
   dragonfly: "🦋",
   ```

Nếu không thêm glyph, Welcome sẽ dùng hình khối preview mặc định. Model GLB thật vẫn được render trong
trận đấu.

## 6. Build và kiểm thử

Từ thư mục gốc repository chạy:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Sau đó chạy client, chọn model mới ở Welcome và kiểm tra:

- Model tải được, không có lỗi 404 trong console.
- Model đứng đúng mặt sân, không bị lộn ngược hoặc lệch xa tâm.
- Kích thước phù hợp với một ô hex.
- Texture/material hiển thị đúng và nhận tint màu nhân vật.
- Người chơi khác nhìn thấy đúng model trong chế độ multiplayer.

## 7. Lỗi thường gặp

### Model không xuất hiện

Kiểm tra tên khóa có giống nhau trong `PLAYER_SHAPES`, `MODEL_URLS` và `SHAPE_LABEL`; kiểm tra URL file
và chữ hoa/chữ thường.

### Model quá nặng hoặc giật khi vào game

Giảm polygon, nén texture và loại bỏ animation/mesh/material không dùng trước khi export. Mỗi entity
trong trận sẽ clone scene và material của model, nên model càng phức tạp càng tốn GPU và bộ nhớ.

### Model quay sai hướng

Pipeline hiện tại áp dụng cùng phép xoay cho mọi GLB. Nếu một model có forward-axis khác biệt, thêm cấu
hình rotation riêng theo shape trong `makeModelObject()` thay vì sửa rotation chung làm ảnh hưởng các
model đang hoạt động.

### Multiplayer hiện sai model

Đảm bảo client và server được build từ cùng phiên bản `@hexagon/shared`, và shape mới chỉ được nối vào
cuối `PLAYER_SHAPES`.
