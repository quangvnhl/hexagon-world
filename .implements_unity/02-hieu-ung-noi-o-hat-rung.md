# 02 — Ô nổi, hạt khi chiếm ô, rung camera khi chết

Ba việc trong một lượt: sửa lỗi ô nổi không đều, thêm hạt khi chiếm được đất, và làm
cú rung khi chết thật sự thấy được.

---

## 1. Lỗi "có ô thì nổi, có ô thì không"

### Nguyên nhân

`HexGridRenderer.SyncColorsIfNeeded` quyết định ô nào cần nổi bằng cách hỏi tập
`painted` — nhưng `painted` là tập ô **đã được tô màu**, và nó gồm **cả ô đuôi**:

```csharp
foreach (var pair in state.OwnedCells) {
    SetColor(...);
    if (!painted.Contains(pair.Key)) QueuePop(pair.Key, head, 1f);  // ← sai ở đây
    paintedNext.Add(pair.Key);
}
foreach (var pair in state.TrailCells) { SetColor(...); paintedNext.Add(pair.Key); }
```

Ô đuôi lúc khép vòng biến thành đất, nhưng nó **đã nằm sẵn trong `painted` từ khi còn
là đuôi** ⇒ bị coi là "không có gì mới" ⇒ không bao giờ nổi. Kết quả: đúng cái viền
theo đường vừa đi thì phẳng, phần ruột bao trong thì nổi.

### Cách sửa

Tách hai thứ vốn khác nhau ra làm hai tập:

| Tập | Nội dung | Dùng cho |
|---|---|---|
| `painted` | ô đã tô màu = **đất ∪ đuôi** | trả ô về màu xám khi mất màu |
| `risenOwner` | `Dictionary<HexCoord,int>`: ô đất → **id chủ ô** | quyết định nổi lên / hạ xuống |

```csharp
bool had = risenOwner.TryGetValue(pair.Key, out int prevOwner);
if (had && prevOwner == pair.Value) continue;          // vẫn của chủ cũ → giữ nguyên độ cao
QueuePop(pair.Key, head, 1f, had ? stealDip : -1f);
Burst(pair.Key, owned, ref bursts);
```

Tách xong thì có thêm hai hành vi đúng theo:

- Ô đất bị địch **đi đuôi ngang qua** giờ chỉ đổi màu chứ không bị hạ xuống oan — vì
  nó đổi màu (rời `painted`) nhưng vẫn còn chủ (còn trong `risenOwner`).
- Ô **cướp** được từ đối thủ vốn đã nổi sẵn ở độ cao 1, bật lại từ đầu sẽ không thấy
  gì. Nay hụt xuống `stealDip = 0.55` rồi nảy lên, nên cướp đất cũng có phản hồi thị giác.

### Kiểm chứng

Cho nhân vật tự lái gom 28 ô rồi chụp với `popRise` tạm đặt 2.5 cho dễ nhìn: toàn bộ
vùng đất **cùng một độ cao**, kể cả đúng đoạn chữ U mà nhân vật vừa đi qua. Chỉ ô đuôi
hiện tại là phẳng — đúng như thiết kế. (`popRise` đã trả về 1 và lưu scene.)

---

## 2. Hạt khi chiếm được ô

[`Rendering/CaptureParticles.cs`] — **một** `ParticleSystem` duy nhất, tắt module
`emission` và `shape`, chỉ phát bằng `Emit(EmitParams, 1)`. Nhờ vậy mỗi ô chọn được
vị trí / vận tốc / màu riêng mà vẫn gộp chung một draw call, thay vì đẻ ra một hệ hạt
cho mỗi ô. Hệ hạt, material và cả texture chấm tròn đều dựng bằng code — không phải
nối asset trong scene.

| Thông số | Giá trị |
|---|---|
| Hạt mỗi ô | 7 |
| Vòng đời | 0.50 – 0.95s |
| Cỡ hạt | 0.22 – 0.50 (ô hex bán kính ~0.9) |
| Vận tốc lên / toè ngang | 2.4 – 4.6 / ≤ 1.6 |
| Gia tốc rơi | 7 |
| Pha trắng | 45% để hạt sáng hơn chính ô đất bên dưới |
| Trần mỗi lượt lưới đổi | 48 ô |

Bắn cho **mọi thực thể**, không riêng người chơi — nhìn ra được bot đang gặm đất ở
đâu. Bỏ qua ô ngoài tầm nhìn và cắt trần 48 ô/lượt, để cú giết cướp vài trăm ô không
đẻ ra hàng nghìn hạt.

`Burst` chỉ chạy khi **chủ ô đổi**, không chạy khi thêm ô đuôi — nên tuy `GridRevision`
tăng liên tục mỗi lần đi qua một ô mới, hạt vẫn chỉ nổ đúng lúc chiếm/cướp đất.

### Hai chỗ vướng

**Màu bị chuyển linear hai lần.** Ban đầu gọi `.linear` như đang làm với lưới hex thì
hạt ra **tối xịt** thay vì sáng hơn ô đất. `ParticleSystem` đã tự chuyển màu theo
color space rồi, khác `MaterialPropertyBlock.SetVectorArray`. Bỏ chuyển tay đi là đúng.

**Hạt bị chính khối đã nổi che.** Hạt sinh ở `y = 0.5` nằm **bên trong** ô đã nổi
theo blendshape ⇒ chỉ những ô chưa kịp nổi (còn đang chờ trong sóng lan) mới thấy hạt,
nhìn ra như "hạt chỉ bắn ở nửa vùng". Sửa bằng cách cho `HexGridRenderer` tự đọc chiều
cao Rise tối đa từ luồng UV1:

```csharp
tileTopY = hexMesh.bounds.max.y + MaxRiseHeight(hexMesh) * Mathf.Max(0f, popRise);
...
captureFx.Burst(new Vector3(p.x, tileTopY, p.z), color);
```

Nhờ vậy đổi `popRise` bao nhiêu thì hạt vẫn nằm đúng trên mặt ô.

---

<a id="3-rung-camera-khi-chết"></a>
## 3. Rung camera khi chết

### Nguyên nhân thật

Rung **vốn đã có và vẫn chạy**. Cái sai là bảng CHẾT hiện **tức khắc** với lớp phủ
tối 71% (`Shade = #0e1013b4`), nên cú rung diễn ra sau tấm màn — không ai thấy.

Hoãn bảng lại là xong:

```csharp
[SerializeField] float deathPanelDelay = 0.75f;
...
bool showDeath = dead && Time.time - deadSince >= deathPanelDelay;
```

### Làm cú rung đọc ra được

| | Trước | Sau |
|---|---|---|
| Biên độ | 0.9 | **1.6** |
| Thời lượng | 0.45s | **0.6s** |
| Dạng nhiễu | `Random.insideUnitCircle` mỗi frame | **Perlin theo thời gian**, 26 nhịp/giây |

Random mỗi frame phụ thuộc FPS: ở 138 fps nó ra **mờ nhoè** chứ không ra giật. Nhiễu
Perlin lấy mẫu theo thời gian cho quỹ đạo liên tục, mắt bắt được cú giật và biên độ
không đổi theo FPS.

Cũng sửa điều kiện kích hoạt:

```csharp
// So sánh LỚN HƠN chứ không phải khác: Restart() đưa Deaths về 0, khác nhau nhưng không phải cú chết.
if (lastDeaths >= 0 && human.Deaths > lastDeaths) Shake();
```

Và tách ra thành `public void Shake(float scale = 1f)` để chỗ khác gọi lại được.

### Kiểm chứng bằng số

Ảnh tĩnh không cho biết camera có rung hay không, nên đo độ giật **giữa hai frame
liên tiếp** (nhân vật đang đứng yên, mọi dịch chuyển đều là do rung):

```
giật LỚN NHẤT khi YÊN  = 0.0661 world units/frame
giật LỚN NHẤT khi RUNG = 0.6515 world units/frame
tỷ lệ rung/yên = 9.9 lần        (fps ~138, orthoSize 8)
```

Trên màn hình cao 16 world unit thì 0.65 unit/frame là cú giật rõ.

Thời điểm hiện bảng cũng đo bằng ảnh: **t = 0.25s** thấy sân + hạt, chưa có bảng;
**t = 1.5s** bảng `BẠN ĐÃ CHẾT` + nút `HỒI SINH (R)` đã hiện.

---

## Giá trị đã ghi vào scene

Các trường này serialize trong `Practice.unity` nên **sửa mặc định trong `.cs` không
có tác dụng** (bẫy số 6) — đã ghi thẳng vào scene và lưu:

```
shakeAmplitude: 1.6      popRise: 1
shakeDuration: 0.6       stealDip: 0.55
shakeFrequency: 26       maxCaptureBursts: 48
                         captureFx: <CaptureParticles trên GameController>
```

## Sửa kèm

`PlayerMarker.BotModelIndex` dùng `(e.Id - 1) % botModels.Length`, mà `%` của C# giữ
dấu nên `Id < 1` cho **chỉ số âm** và ném `IndexOutOfRangeException`. Lúc chơi thật
không chạm tới (chỉ bot mới vào nhánh đó, và bot luôn có `Id ≥ 1`) nhưng đã kẹp lại
`((x % n) + n) % n`.
