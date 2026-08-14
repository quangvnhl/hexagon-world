# Thiết kế vệt đuôi bằng SVG 2D

Vệt đuôi trong game dùng ribbon phẳng 2D chạy theo đường cong di chuyển và lớp hex instanced cho dữ liệu authoritative. Cả hai lớp lấy hình/pattern từ cùng file SVG 2D. Material sẽ tự nhuộm SVG theo màu nhân vật; người chơi không thể đặt màu đuôi độc lập.

## Vị trí asset

```text
packages/client/public/trails/
├── stripes.svg
├── dots.svg
└── chevrons.svg
```

Registry ánh xạ pattern nằm tại:

```text
packages/client/src/components/trailVectorAssets.ts
```

`solid` không cần SVG vì sử dụng material màu đặc.

## Thay thiết kế có sẵn

Có thể thay trực tiếp nội dung một file SVG và giữ nguyên tên. Không cần sửa protocol hoặc gameplay.

Yêu cầu asset:

- Dùng `viewBox` và khai báo `width`/`height`; tỷ lệ ngang khuyến nghị từ 3:1 đến 4:1.
- Chỉ dùng màu trắng và alpha. Không đặt màu cố định vì màu cuối được nhân với màu nhân vật.
- Hai cạnh trái/phải phải nối liền để texture lặp không lộ đường ráp.
- Tránh filter SVG phức tạp, ảnh nhúng base64 và số lượng path quá lớn để giữ FPS mobile.
- Nền mờ có thể dùng `fill="white" fill-opacity=".18"`; họa tiết chính dùng trắng đục.

Sau khi thay asset, restart client dev server nếu HMR chưa cập nhật file public và hard refresh trình duyệt để xóa cache ảnh.

## Thêm một pattern mới

1. Thêm SVG vào `packages/client/public/trails/`.
2. Append tên mới vào `TRAIL_PATTERNS` trong `packages/shared/src/config.ts`. Không chèn vào giữa vì protocol dùng index.
3. Thêm đường dẫn vào `TRAIL_VECTOR_ASSETS`.
4. Thêm nhãn trong `PATTERN_LABEL` của `StartPanel.tsx`.
5. Nếu pattern bán trong shop, thêm catalog `asset_key` dạng `trail:<tên-pattern>`.
6. Tăng `GAME_PROTOCOL_VERSION`, build lại shared/client/server và chạy toàn bộ test khi pattern mới cần đồng bộ online.

SVG được sử dụng đồng thời ở lựa chọn Welcome, preview chuyển động và vệt đuôi trong màn chơi, nên thiết kế hiển thị nhất quán.
