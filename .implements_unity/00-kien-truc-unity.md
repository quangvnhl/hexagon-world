# 00 — Kiến trúc bản Unity và các bẫy kỹ thuật đã dính

## Môi trường

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| Unity | `6000.5.9f1` | |
| Render pipeline | URP 17.5.0 | |
| Color space | **Linear** | là nguồn của bẫy số 3 |
| Input | **Input System mới** | `UnityEngine.Input` cũ sẽ ném lỗi lúc chạy |
| Package thêm | `com.unity.cloud.gltfast` 6.19.0 | bắt buộc để import `.glb` |

## Cây thư mục

```
Assets/
  Scenes/Practice.unity
  Shaders/HexTile.shader          shader riêng: màu per-instance + blendshape Rise
  Materials/HexTile.mat
  Models/
    Hexagon/Hexagon.fbx           ô lục giác, CÓ blendshape "Rise"
    Ladybug/ladybug.glb           nhân vật người chơi
    Bee/bee.glb                   bot
    Fly/low_poly_house_fly_diptera.glb   bot
  Scripts/
    Config/GameConfig.cs          toàn bộ hằng số, port từ packages/shared/src/config.ts
    Hex/HexCoord.cs               toạ độ axial/cube, ToPixel, PixelToAxial, Linedraw
    Hex/ArenaGeometry.cs          sân lục giác 6 tường, SlideMove / ClampInside / InsideArena
    Simulation/GameState.cs       LÕI mô phỏng — C# thuần, không phải MonoBehaviour
    Simulation/Entity.cs          một thực thể (người chơi hoặc bot)
    Simulation/Totem.cs
    Simulation/FloodFill.cs       CaptureEnclosed — port floodfill.ts
    Game/PracticeGameController.cs   tạo GameState, tick mỗi frame, đọc input
    Rendering/HexGridRenderer.cs     lưới hex (GPU instancing) — file nặng nhất
    Rendering/PlayerMarker.cs        model nhân vật/bot + vòng collider
    Rendering/TrailRibbon.cs         dải đuôi cong Catmull-Rom
    Rendering/TotemRenderer.cs
    Rendering/CaptureParticles.cs    hạt khi ô đổi chủ
    Rendering/ArenaBorder.cs         viền tường + đường giới hạn tâm thân
    CameraControl/TopDownCamera.cs
    UI/PracticeHud.cs                dựng toàn bộ cây uGUI bằng code
    UI/TouchJoystick.cs
```

Namespace theo thư mục: `HexagonWorld.Config`, `.Hex`, `.Simulation`, `.Game`,
`.Rendering`, `.CameraControl`, `.UI`.

## Nguyên tắc kiến trúc

**`GameState` là C# thuần.** Không kế thừa `MonoBehaviour`, không gọi API render.
Toàn bộ luật chơi nằm trong đó nên chạy được trong test / editor / server. Renderer
chỉ *đọc* state và so `Revision` / `GridRevision` để biết khi nào phải vẽ lại.

**Quyền sở hữu ô nằm ở state, không nằm ở entity.** `cellOwner` và `cellTrail`
(`Dictionary<HexCoord,int>`) là nguồn sự thật duy nhất; `Entity.Owned` chỉ là chỉ
mục ngược. Nhờ vậy khép được vòng nào là **cướp luôn** ô của đối thủ nằm trong vòng
đó, và `ClaimCell` là chỗ DUY NHẤT ghi `cellOwner` để hai chiều không lệch nhau.

<a id="gameconfig"></a>
**`GameConfig` là chỗ duy nhất chứa hằng số.** Port từ `packages/shared/src/config.ts`.
Vài giá trị đang lệch bản web có chủ đích:

| Hằng số | Unity | Bản web | Lý do |
|---|---|---|---|
| `BodyRadius` | `1.0` | `0.6` | cỡ model ladybug ở `modelSize` 2.2 ⇒ nửa thân ≈ 1.0, không phải cube cũ |
| `TotemsEnabled` | `true` | `false` ở chế độ Luyện tập | bật để có nội dung chơi; đổi `false` là về đúng bản gốc |

---

## 14 cái bẫy đã dính

Phần lớn là lỗi **im lặng** — không ném exception, chỉ ra sai hình. Ghi lại để không
mất thêm lần nữa.

### 1. Backface culling xoá sạch lưới hex
Unity coi tam giác quấn **thuận chiều kim đồng hồ trên màn hình** là mặt trước. Mesh
lăng trụ dựng tay ban đầu quấn mặt trên ngược chiều nhìn từ trên xuống ⇒ camera
top-down cull sạch, màn hình đen, không có lỗi nào. Đã sửa winding của cả mặt trên
lẫn quad mặt bên.

### 2. Shader URP dựng sẵn không tô riêng từng ô được
`Universal Render Pipeline/Lit` và `Unlit` **không khai báo `_BaseColor` trong
instancing buffer**, nên `MaterialPropertyBlock` đặt màu chỉ đổi được cả lô. Phải
viết shader riêng `HexagonWorld/HexTile` với
`UNITY_INSTANCING_BUFFER_START` / `UNITY_DEFINE_INSTANCED_PROP`.

### 3. sRGB → linear: hai chiều ngược nhau
- `Material.SetColor` **tự đổi** sang linear khi project ở Linear color space.
- `MaterialPropertyBlock.SetVectorArray` **KHÔNG đổi** (chỉ nhận số thô) ⇒ phải gọi
  `.linear` bằng tay, không thì màu ô ra bệch.
- `ParticleSystem` (`EmitParams.startColor`) **lại tự đổi** ⇒ đổi tay nữa là chuyển
  hai lần, hạt ra tối xịt.

Nói gọn: lưới hex phải đổi tay, hạt thì không.

### 4. Blendshape không dùng chung với GPU instancing
Blendshape thật chỉ chạy trên `SkinnedMeshRenderer`, mà lưới có hàng chục nghìn ô
nên bắt buộc phải instancing. Giải pháp: **nướng delta của blendshape "Rise" thành
một luồng đỉnh phụ (UV1)** bằng `GetBlendShapeFrameVertices`, rồi shader tự cộng
`riseOS * _Rise` vào vị trí, với `_Rise` là thuộc tính per-instance.

### 5. Model có blendshape import thành SkinnedMeshRenderer
Ngay khi thêm blendshape "Rise" vào `Hexagon.fbx`, file chuyển từ `MeshFilter` sang
`SkinnedMeshRenderer`. `GetComponentInChildren<MeshFilter>()` trả null và lưới **âm
thầm rơi về mesh lăng trụ dựng tay** — model của dự án không còn được dùng mà không
có lỗi nào. `BuildTileMeshFromModel` giờ xét `SkinnedMeshRenderer` trước.

### 6. Giá trị serialize trong scene đè giá trị mặc định trong code
Sửa `[SerializeField] float pitch = 73f;` trong `.cs` **không có tác dụng** với scene
đã lưu (scene giữ 62). Muốn đổi thì phải ghi vào scene:

```csharp
var so = new SerializedObject(component);
so.FindProperty("pitch").floatValue = 73f;
so.ApplyModifiedProperties();
EditorSceneManager.SaveScene(component.gameObject.scene);
```

Đã dính hai lần: `pitch`/`orthoSize` của camera, và `shakeAmplitude`/`shakeDuration`.

### 7. Model hex là flat-top, hệ toạ độ là pointy-top
`BuildTileMeshFromModel` tự phát hiện: `size.x > size.z` ⇒ hex đỉnh-ngang ⇒ xoay 30°.
Bán kính đo bằng **cạnh-đối-cạnh** (`min(size.x, size.z) / √3`) chứ không đo qua đỉnh
— đỉnh model có vát góc nên đo qua đỉnh sẽ sai.

### 8. Xoay bàn chơi thì xoay camera, đừng xoay từng ô
Yêu cầu "xoay khối lục giác 90°" **không** làm bằng cách xoay mesh từng ô — hệ toạ độ
hex là đỉnh-nhọn nên các ô sẽ hở/chồng lên nhau. Đặt `yaw = 90` trên camera, cả lưới
xoay theo mà vẫn khít.

### 9. Hướng đầu của mỗi model khác nhau, phải đo bằng thực nghiệm
Ép cả ba cùng `heading = 0` rồi chụp màn hình mới biết: ladybug và bee quay đầu theo
**−X** (bù 90°), fly theo **+X** (bù 0°). Vì thế `PlayerMarker` có mảng
`botModelYawOffsets` riêng chứ không dùng chung một hằng số.

### 10. `%` của C# giữ dấu
`BotModelIndex => (e.Id - 1) % botModels.Length` cho **chỉ số âm** khi `Id < 1` và ném
`IndexOutOfRangeException`. Lúc chơi thật không chạm tới (chỉ bot mới vào nhánh đó)
nhưng đã kẹp lại `((x % n) + n) % n`.

### 11. `ParticleSystem` do `AddComponent` tạo ra đã ở trạng thái đang chạy
Sửa `main.duration` lúc đang chạy là lỗi runtime. Phải
`ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear)` trước khi cấu hình,
rồi `ps.Play()` sau — hệ vẫn phải chạy thì hạt `Emit` tay mới được mô phỏng.

### 12. Hạt bị chính khối đã nổi che mất
Hạt sinh ở cao độ cố định sẽ nằm **bên trong** ô đã nổi theo blendshape. `HexGridRenderer`
tự đọc chiều cao Rise tối đa từ luồng UV1 (`tileTopY`) và truyền đúng cao độ mặt ô cho
`CaptureParticles.Burst`, nên đổi `popRise` bao nhiêu hạt vẫn nằm trên mặt.

### 13. `.glb` không import được nếu thiếu glTFast
Unity nhận `.glb` bằng `DefaultImporter` (nhị phân thô, vô dụng). Cài
`com.unity.cloud.gltfast` qua `UnityEditor.PackageManager.Client.Add`.

### 14. Ràng buộc của Unity MCP
- Script phải là `internal class CommandScript : IRunCommand`; `public` sẽ lỗi
  "Inconsistent Accessibility".
- **Namespace `System.Reflection` bị chặn** — tham chiếu thẳng type của project thay vì reflect.
- `Mesh` bị namespace của wrapper che ⇒ viết `UnityEngine.Mesh`.
- `EditorSceneManager.OpenScene` không dùng được trong play mode.
- `"Unity not detected (no fresh discovery files found)"` là lỗi **tạm thời** lúc
  domain reload — chờ ~15–20s rồi chạy lại là được.
- **Sửa file `.cs` khi đang play mode ⇒ domain reload ⇒ mất sạch `GameState`**
  (field không serialize bị null, `Awake` không chạy lại). Thoát play trước khi sửa code.

---

## Vòng lặp kiểm chứng đang dùng

Không có test tự động, nên kiểm chứng bằng cách chạy thật và đo:

1. `EditorApplication.isPlaying = true`
2. `ScreenCapture.CaptureScreenshot(<scratchpad>/x.png)` rồi đọc file PNG.
3. Truy vấn `GameState` sống bằng script `Unity_RunCommand` có type thật.

Hai mẹo đã dùng nhiều lần:

**Bắt đúng khoảnh khắc.** Mỗi lượt gọi MCP mất vài giây nên hiệu ứng 0.4s luôn kết
thúc trước khi kịp chụp. Cài một bẫy vào `EditorApplication.update`, tự phát hiện sự
kiện (ví dụ số ô sở hữu nhảy > 8 = vừa khép vòng) rồi chụp ở đúng số frame sau đó:

```csharp
static void Tick() {
    if (frames < 0) { if (n > lastCount + 8) frames = 0; lastCount = n; return; }
    frames++;
    if (frames == 6) ScreenCapture.CaptureScreenshot(Dir + "a.png");
    ...
}
```

**Tự lái nhân vật.** Ép `Human.IsBot = true` là AI lái thay người chơi — `BotThink`
chạy TRONG `Tick`, tức là SAU `ReadSteering`, nên hướng do AI đặt thắng input chuột.
Cho bot khác `Phase.Dead` + `RespawnTimer = 9999` để nhân vật chạy liền mạch.

**Đo thay vì nhìn.** Ảnh tĩnh không cho biết camera có rung không. Đo độ giật giữa hai
frame liên tiếp: yên = 0.066, rung = 0.65 world unit ⇒ gấp 10 lần, kết luận chắc chắn.
