# Kế hoạch tốc độ, Totem, room online và đồng hồ King

Ngày lập kế hoạch: 2026-08-14.

> Cập nhật triển khai 2026-08-14: phần quota bot tỷ lệ trong tài liệu này đã được thay thế. Room hiện dùng số bot cố định theo `MAX_PLAYERS` (clamp `12..16`) và chỉ stagger thời điểm kích hoạt; xem `20-online-room-bot-king-lifecycle.md`.

## 1. Mục tiêu

Lát cắt này bổ sung bốn nhóm tính năng có liên hệ trực tiếp với nhau:

1. Tốc độ tăng theo phần trăm tiến tới ngưỡng King, có `MIN`/`MAX` tương tự camera zoom.
2. Totem Speed, Slow và Radar là state gameplay authoritative, có thể bị chiếm/cướp theo lãnh thổ.
3. Minimap mặc định chỉ tiết lộ lãnh thổ và vị trí của chính người chơi; Radar mới mở thông tin toàn phòng.
4. Room online có tối đa 8 người thật, tối đa 16 bot, bot được đưa vào dần theo số người thật và room đầy được seal để matchmaking tạo room mới.
5. Đồng hồ kết thúc room bắt đầu từ lần xuất hiện King đầu tiên và dùng một deadline toàn room, không reset khi đổi King.

## 2. Nguyên tắc kiến trúc

- Server là nguồn sự thật duy nhất cho tốc độ hiệu lực, quyền sở hữu Totem, hiệu ứng Slow/Radar, bot quota và deadline King.
- Client prediction phải dùng đúng tốc độ server gửi; không tự tính từ Territory AoI vì scene chỉ chứa một phần bản đồ.
- Totem ownership được suy ra từ `cellOwner` toàn bản đồ trên server, không suy ra từ territory stream phía client.
- Minimap filtering phải thực hiện ở server đối với dữ liệu nhạy cảm. Chỉ ẩn bằng UI là không đủ vì client vẫn có thể đọc `world_ui` và full minimap territory.
- Thay đổi binary snapshot/control protocol phải tăng `GAME_PROTOCOL_VERSION` và có test mismatch.
- Single-player và multiplayer dùng chung gameplay primitive, nhưng room deadline/matchmaking chỉ áp dụng online.

## 3. Cấu hình đề xuất

### Shared gameplay config

```ts
SPEED: {
  BY_KING_PCT: { MIN: 5.5, MAX: 7.0 },
},

TOTEMS: {
  SPEED: {
    COUNT: 4,
    BONUS_PER_TOTEM: 0.5,
  },
  SLOW: {
    COUNT: 3,
    RADIUS: 8,
    ENEMY_SPEED: 1,
  },
  RADAR: {
    COUNT: 2,
  },
  MIN_SPAWN_DISTANCE: 18,
  SPAWN_CLEARANCE: 12,
}
```

Quy tắc tốc độ:

```ts
t = clamp(territoryPct / KING_PCT, 0, 1)
kingSpeed = lerp(SPEED.BY_KING_PCT.MIN, SPEED.BY_KING_PCT.MAX, t)
boostedSpeed = kingSpeed + ownedSpeedTotemCount * TOTEMS.SPEED.BONUS_PER_TOTEM
effectiveSpeed = insideEnemySlowZone ? TOTEMS.SLOW.ENEMY_SPEED : boostedSpeed
```

Slow là override cuối cùng, không cộng dồn giữa nhiều vùng Slow. Chủ Totem và đồng đội tương lai không bị Totem Slow của chính mình ảnh hưởng.

### Server/deployment config

```env
MAX_ONLINE_PLAYERS=8
ONLINE_BOTS=16
ONLINE_BOT_JOIN_INTERVAL_MS=1500
KING_ROOM_DURATION_SECONDS=180
```

- `MAX_ONLINE_PLAYERS` validate trong khoảng `1..8`; mặc định 8.
- `ONLINE_BOTS` validate trong khoảng `0..16`; mặc định theo deployment.
- Shared `BOT_COUNT` tiếp tục dành cho single-player, không dùng làm quota online.
- Các biến được thêm vào `.env.example`, `compose.yaml`, compose multi-region và runbook.

## 4. Mô hình Totem authoritative

### Kiểu dữ liệu

```ts
type TotemKind = "speed" | "slow" | "radar";

interface TotemState {
  id: number;
  kind: TotemKind;
  q: number;
  r: number;
  ownerId: number; // -1 nếu ô trung lập
}
```

- Totem được đặt deterministic từ match seed, chỉ trên ô playable, tránh vùng spawn/tường và đảm bảo khoảng cách tối thiểu.
- Totem không biến mất sau khi bị chiếm. `ownerId` luôn bằng chủ hiện tại của ô chứa Totem.
- Capture, cướp đất, chết và giải phóng lãnh thổ đều gọi một bước reconcile Totem sau khi `territoryRevision` đổi.
- State dẫn xuất theo entity: `speedTotemCount`, `radarActive`, `insideEnemySlowZone`, `effectiveSpeed`.
- Render Totem bằng instancing theo từng loại để không tăng draw call tuyến tính.

### Protocol

Thêm control frame nhịp thấp/reliable:

```ts
{ t: "totems"; revision: number; items: TotemState[] }
```

Snapshot self bổ sung dữ liệu gameplay cần cho prediction/UI:

```ts
effectiveSpeed
speedTotemCount
radarActive
```

Đề xuất encode `effectiveSpeed` dạng fixed-point `u16` để tránh float dư thừa. Totem chỉ gửi khi revision đổi; trạng thái self nằm trong snapshot thường xuyên để prediction reconcile ngay khi vào/ra vùng Slow.

## 5. Tốc độ và client prediction

### Shared/server

- Tách hàm thuần `speedForEntity(entityId)` và `baseSpeedForPct(pct)` để dùng trong `GameState.updateEntity` và unit test.
- Thay `CONFIG.SPEED * dt` bằng `effectiveSpeed * dt`.
- Cache số Totem theo owner theo `territoryRevision`; kiểm tra Slow zone bằng spatial index nhỏ hoặc danh sách Totem Slow vì số lượng thấp.
- Bot AI vẫn quyết định hướng như hiện tại nhưng quãng đường thực tế dùng cùng effective speed.

### Client

- `stepHead` nhận `speed` thay vì đọc trực tiếp config.
- Predictor lấy `effectiveSpeed` gần nhất từ self snapshot và reconcile khi modifier đổi.
- HUD có chip nhỏ hiển thị tốc độ hiện tại và số Totem Speed; hiệu ứng Slow/Radar có icon trạng thái, không thêm particle liên tục.
- Camera zoom vẫn chỉ dựa trên authoritative score và profile camera, không phụ thuộc Totem.

## 6. Quyền riêng tư minimap và Radar

### Mặc định chưa có Radar

Server chỉ gửi cho connection:

- Territory minimap có `ownerId === selfId`; không gửi đất/đuôi đối thủ.
- `world_ui` cho bảng xếp hạng chỉ giữ dữ liệu không gian ở một payload khác. Không gửi `x/y` đối thủ qua payload mà minimap có thể đọc.
- Minimap chỉ vẽ lãnh thổ của mình và chấm của mình.

### Khi sở hữu Radar

- Server gửi full minimap territory và vị trí toàn bộ entity sống ở nhịp khoảng 200 ms.
- Mất ô chứa Totem Radar thì quyền bị thu hồi ngay ở revision kế tiếp; client xóa cache full-map/full-entity trước khi vẽ frame tiếp theo.
- Entity AoI của scene 3D không thay đổi: Radar chỉ mở minimap, không làm render object ngoài camera.

### Tách contract để tránh rò rỉ

- Tách `scoreboard_ui` khỏi `minimap_entities`; scoreboard chỉ cần `id`, tên/appearance, `alive`, `score`.
- `minimap_entities` mới chứa `x/y` và chỉ gửi self hoặc gửi toàn bộ khi `radarActive=true`.
- Full-map `TERRITORY_MINIMAP` hiện tại phải được filter theo connection; không broadcast cùng một buffer cho cả phòng.
- Client reset minimap cache khi Radar đổi `true -> false`, reconnect, welcome hoặc đổi room.

## 7. Bot quota và vòng đời room

### Công thức quota khuyến nghị

Để vừa đạt đúng `ONLINE_BOTS` ở 8 người vừa tăng dần mượt, dùng:

```ts
maxBots = clamp(ONLINE_BOTS, 0, 16)
targetBots(realPlayers) =
  realPlayers === 0 || maxBots === 0
    ? 0
    : min(maxBots, max(1, round(realPlayers * maxBots / 8)))
```

Ví dụ:

| ONLINE_BOTS | 1 người | 4 người | 8 người |
|---:|---:|---:|---:|
| 16 | 2 | 8 | 16 |
| 8 | 1 | 4 | 8 |
| 3 | 1 | 2 | 3 |

Công thức này được ưu tiên hơn `round(ONLINE_BOTS / 8) * realPlayers`, vì công thức thứ hai có thể cho 0 bot với config thấp hoặc vượt `ONLINE_BOTS` với config như 12. Ngoại lệ `ONLINE_BOTS=0` luôn giữ 0 bot; còn khi config lớn hơn 0 và phòng có người thì luôn có tối thiểu 1 bot.

### Bot tham gia dần

- `GameRoom` tạo đủ slot bot capacity nhưng park toàn bộ bot khi tạo room.
- Room có `targetBotCount`, `activeBotCount` và hàng đợi activation.
- Mỗi `ONLINE_BOT_JOIN_INTERVAL_MS` chỉ spawn tối đa một bot cho tới target; không spawn toàn bộ cùng tick.
- Khi countdown King đang active, đóng băng hàng đợi activation và không cho bot mới tham gia hoặc bot đang chờ hồi sinh. Bot đang sống trong room vẫn tiếp tục chơi.
- Khi mất King hoàn toàn và countdown bị hủy, tính lại quota rồi tiếp tục activation theo interval; không spawn bù hàng loạt trong cùng tick.
- Khi người thật rời phòng, ưu tiên park bot đang chết/chờ spawn. Bot đang sống được đánh dấu retire và rời ở điểm an toàn hoặc sau timeout cấu hình để tránh biến mất/chớp nháy giữa scene.
- Roster/player count phân biệt `humanCount`, `activeBotCount`, `totalActive`.

### Matchmaking nhiều room

- Thay con trỏ `active` duy nhất bằng `findJoinableRoom()` trên tập room chưa `ended`, không bị khóa admission bởi King và còn ghế người.
- Tách rõ ba điều kiện không nhận join: `capacityFull`, `kingAdmissionLocked` và `ended`; không dùng một cờ `sealed` duy nhất vì room có thể mở lại sau khi mất King.
- Khi người thật thứ 8 vào, room đầy; join tiếp theo tạo room mới thay vì close code 4001. Nếu sau đó có người rời, room chỉ được nhận người mới khi countdown King không active.
- Room đã bắt đầu, chưa đủ 8 và chưa có countdown King vẫn nhận người mới và điều chỉnh bot quota.
- Ngay khi xuất hiện King đầu tiên, đặt `kingAdmissionLocked=true`: người mới được đưa sang room khác, không cấp ghế chết trong room đang khóa.
- Chuyển trực tiếp `King A -> King B` giữ countdown nên admission vẫn khóa.
- Chuyển `có King -> không có King` hủy countdown và mở admission trở lại nếu room còn ghế; bot admission cũng được tiếp tục.
- Room mới chỉ tạo lazy khi có join; không giữ room rỗng.
- Ticket vùng vẫn dùng như hiện tại; allocation room diễn ra trong game node. Khi chạy nhiều node, Redis matchmaking vẫn là hạng mục riêng.

## 8. Đồng hồ King toàn room

### State mới

```ts
kingCountdownStarted: boolean
kingDeadlineTick: number | null
kingRemaining: number
kingAdmissionLocked: boolean
```

- Trước khi có King lần đầu: `kingRemaining = KING_ROOM_DURATION_SECONDS`, countdown chưa chạy.
- Tick đầu tiên có King: chốt deadline cho chu kỳ King hiện tại.
- Chuyển trực tiếp `King A -> King B`: giữ nguyên deadline và tiếp tục đếm, không phụ thuộc người nào đang giữ ngôi.
- Chuyển `có King -> không có King` (ví dụ King tự đâm vào đuôi và không còn ai đạt ngưỡng): hủy deadline, trả `kingRemaining` về toàn bộ thời lượng và dừng đếm.
- Sau khi đã mất King, lần kế tiếp bất kỳ ai đạt King sẽ tạo deadline mới và đếm lại từ đầu.
- `kingAdmissionLocked` bằng trạng thái countdown active: khóa người mới, bot mới và bot hồi sinh khi countdown chạy; mở lại ngay khi countdown bị hủy.
- Snapshot tiếp tục gửi `kingHold`, nhưng đổi ngữ nghĩa thành thời gian còn lại của room; nên đổi tên protocol thành `kingRemaining` trong protocol version mới để tránh hiểu sai.
- Event `king` vẫn phát khi đổi chủ để HUD cập nhật tên/màu, không tác động deadline.
- Chỉ khi countdown đang active và về 0, King hiện tại mới thắng. Không có nhánh kết thúc vì hết giờ khi không có King, cũng không có nhánh lấy người nhiều đất nhất để thay thế.
- Phòng chỉ kết thúc khi một King hoàn thành countdown; bỏ điều kiện thắng sớm do chỉ còn một entity sống nếu countdown chưa hoàn thành.
- Khi King hoàn thành countdown, server phát `match_end`, dừng input và simulation, report match đúng một lần.

### Kết thúc trận và UI

- Thay event `win` tối giản bằng `match_end { winnerId, reason, finalScores }` hoặc bổ sung event mới tương thích protocol mới.
- Server seal room ngay khi kết thúc, giữ connection trong grace period để xem kết quả nhưng không nhận revive/input.
- HUD online hiển thị kết quả thắng/thua/xếp hạng và chỉ có nút **Quay về Lobby**.
- Bỏ callback/nút **Chơi lại** khỏi online; single-player vẫn giữ Chơi lại.
- Quay về Lobby phải disconnect sạch, xóa scene/interpolation/minimap/totem cache rồi gọi `onExit` về Welcome/Lobby. Không tự reconnect vào room cũ.
- Nút Menu Telegram vẫn theo rule platform hiện tại; BackButton dẫn về Lobby sau khi trận kết thúc.

## 9. Thứ tự triển khai

### Task A — Config và hàm tốc độ thuần

- Thêm config/schema validation.
- Viết `baseSpeedForPct`, modifier Totem và test biên min/max/Slow override.
- Đổi movement server và prediction API nhưng chưa bật Totem.

### Task B — Totem state và ownership

- Sinh Totem deterministic, reconcile owner theo territory revision.
- Thêm speed/slow/radar derived state và test capture/cướp/chết.
- Thêm render instanced và HUD status.

### Task C — Protocol version mới

- Thêm Totem frame, self effective speed, Radar flag, minimap entity payload và room countdown.
- Tăng protocol version, cập nhật encode/decode/truncated/backpressure tests.
- Control/totem state không được drop; minimap frame vẫn droppable/coalescible.

### Task D — Minimap privacy/Radar

- Filter territory per connection.
- Tách scoreboard khỏi vị trí minimap.
- Xóa cache ngay khi mất Radar và thêm test không rò `x/y`/enemy territory.

### Task E — Bot admission và multi-room

- Park bot capacity, quota proportional và stagger activation.
- Room selector xét capacity + King admission lock; người thứ 9 hoặc người join trong countdown được đưa sang room mới.
- Pause bot activation/respawn trong countdown và resume theo interval sau khi mất King.
- Cập nhật health/metrics: room count, capacity full, King admission locked và human/bot active.

### Task F — King deadline và match-end flow

- Thay timer theo người giữ King bằng deadline room một lần.
- Chốt winner/report/close lifecycle.
- UI kết quả online chỉ còn Quay về Lobby.

### Task G — Hồi quy và tải

- Full shared/server/client test và build.
- Integration 9 client chứng minh 8 client ở room A, client thứ 9 ở room B.
- Soak test 8 người + 16 bot, Radar on/off và backpressure.
- Mobile test nhiệt/FPS; Totem render dùng instancing và minimap giữ nhịp 200 ms.

## 10. Ma trận kiểm thử bắt buộc

- Speed tại 0%, giữa ngưỡng và đạt/vượt King cho đúng MIN/interpolation/MAX.
- N Totem Speed cộng đúng `N * BONUS_PER_TOTEM`.
- Enemy Slow override đúng 1; own Slow không ảnh hưởng; rời radius khôi phục đúng tốc độ.
- Prediction không drift khi snapshot đổi speed.
- Totem đổi owner khi capture/cướp và về trung lập khi owner chết mất đất.
- Không Radar: payload không chứa vị trí/đất đối thủ; minimap chỉ có self.
- Có Radar: hiện đủ người; mất Radar xóa ngay dữ liệu đã cache.
- `ONLINE_BOTS=0,3,8,16` không vượt cap và đạt đúng quota ở 8 người.
- Bot xuất hiện từng bước, không spawn/chớp nháy hàng loạt.
- 8 người vào room A; người thứ 9 nhận welcome ở room B, không bị `4001`.
- Room A còn ghế nhưng countdown King đang chạy: người mới vẫn vào room B và không có bot mới được activate ở room A.
- King A khởi động timer; chuyển trực tiếp sang King B nhưng deadline không đổi.
- King mất ngôi và không còn King thì timer bị hủy/reset; King kế tiếp nhận đủ toàn bộ thời lượng.
- Sau khi mất King, room còn ghế nhận người mới trở lại và bot quota tiếp tục tăng từng interval.
- Reconnect/spectate của người không làm thay đổi trạng thái King nên không reset countdown.
- Hết trận chỉ report một lần; room từ chối input/revive; UI chỉ có Quay về Lobby.

## 11. Definition of Done

- Không còn code movement online đọc trực tiếp một `CONFIG.SPEED` cố định.
- Totem và Radar authoritative, deterministic, không phụ thuộc camera/entity/territory AoI.
- Không Radar không thể đọc vị trí hoặc lãnh thổ đối thủ từ WebSocket payload.
- Room không vượt 8 người thật/16 bot và người thứ 9 tự vào room mới.
- Deadline King không reset khi đổi trực tiếp King, nhưng bị hủy/reset khi phòng chuyển sang trạng thái không có King.
- Shared/client/server test, typecheck, production build và runtime smoke đều đạt.
- `.env.example`, compose, runbook và roadmap được cập nhật trước khi bật production.

## 12. Quyết định sản phẩm đã chốt

1. **King countdown:** cướp/đổi trực tiếp King thì tiếp tục; mất King hoàn toàn thì hủy/reset; phòng chỉ kết thúc khi một King hoàn thành countdown.
2. **Radar:** có Radar mở vị trí, lãnh thổ và đuôi của toàn bộ đối thủ; không Radar chỉ có vị trí và lãnh thổ/đuôi của chính mình.
3. **Bot quota:** dùng quota proportional và bảo đảm tối thiểu 1 bot khi có ít nhất 1 người thật và `ONLINE_BOTS > 0`.
4. **Admission khi có King:** countdown active thì khóa người mới, bot mới và bot hồi sinh; đổi King vẫn khóa. Mất King làm countdown bị hủy và mở admission trở lại nếu room còn capacity.

Không còn câu hỏi sản phẩm bắt buộc trước khi bắt đầu triển khai.
