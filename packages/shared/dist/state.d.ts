import { PlayerColor, PlayerAppearance, PlayerShape, TrailPattern } from "./config";
import { Axial, HexKey } from "./hex";
import { type MatchConfig, type MatchConfigInput } from "./match-config";
import type { EntitySnap, TerritoryCell } from "./protocol";
import { type EntityGameplayModifiers, type TotemState } from "./totems";
export interface Vec2 {
    x: number;
    y: number;
}
/** prep = 3s chuẩn bị (đứng yên, chỉ xoay); playing = đang chơi; dead = đã chết. */
export type Phase = "prep" | "playing" | "dead";
/** Lý do chết (để báo cho người chơi):
 *  - ""            : chưa chết / chưa rõ (vd chưa có chỗ hồi sinh).
 *  - "self"        : tự đâm vào đuôi của chính mình.
 *  - "cut"         : bị đối thủ cắt đuôi (killerId cho biết là ai).
 *  - "headIntruder": xâm nhập lãnh thổ đối thủ và bị chủ đất húc đầu hạ (killerId = chủ đất).
 *  - "headMutual"  : đâm đầu trực diện ngoài sân nhà → cả hai cùng chết. */
export type DeathCause = "" | "self" | "cut" | "headIntruder" | "headMutual";
/** Một thực thể chơi (người hoặc bot): vị trí, đuôi, lãnh thổ, trạng thái. */
export declare class Entity {
    readonly id: number;
    readonly isBot: boolean;
    color: PlayerColor;
    colorIndex: number;
    trailPattern: TrailPattern;
    shape: PlayerShape;
    /** Tên hiển thị (người chơi nhập ở màn hình đầu; rỗng → dùng `color.name`). */
    name: string;
    pos: Vec2;
    heading: number;
    targetHeading: number;
    currentHex: Axial;
    owned: Set<HexKey>;
    trailHexes: HexKey[];
    trailSet: Set<HexKey>;
    trailPoints: Vec2[];
    phase: Phase;
    prepRemaining: number;
    deaths: number;
    /** Số Totem đã thu được (cộng dồn trong ván) — cho điều kiện thắng `capture_totems`. */
    totemsCaptured: number;
    /** Lý do chết lần gần nhất (cho popup). */
    deathCause: DeathCause;
    /** Id kẻ đã hạ ở lần chết gần nhất (-1 nếu tự chết / cả hai chết). */
    killerId: number;
    /** Ảnh chụp lãnh thổ (danh sách ô playable) NGAY TRƯỚC lần chết gần nhất — để vẽ
     *  bản đồ "đất đã chiếm" trong popup chết (vì đất đã bị xoá/chuyển sau khi chết). */
    lastTerritory: HexKey[];
    /** % diện tích ngay trước lần chết gần nhất. */
    lastPct: number;
    home: Vec2;
    /** EXPAND = bành trướng; RETURN = về khép vòng; HUNT = săn cắt đuôi; FLEE = rút lui. */
    botState: "expand" | "return" | "hunt" | "flee";
    /** Chỉ số vào CONFIG.BOT_DIFFICULTY (độ khó). */
    botProfile: number;
    /** Đếm ngược tới lần ra quyết định kế (giây). */
    botDecisionTimer: number;
    /** Id con mồi đang săn (khi ở HUNT). */
    huntId: number;
    botOutHeading: number;
    botRange: number;
    respawnTimer: number;
    /** [doc 34 B] Cứ điểm chủ của bot (index vào strongholds); -1 = không gắn cứ điểm. */
    strongholdIndex: number;
    constructor(id: number, isBot: boolean, color: PlayerColor);
    get alive(): boolean;
}
/** Tuỳ chọn tạo GameState — GỘP các tham số rời cũ (botCount/humanCount/matchSeed) vào
 *  MỘT object cùng `config` (MatchConfig overrides). Không truyền gì ⇒ hành vi mặc định. */
export interface GameStateOptions {
    /** Số ghế NGƯỜI (players[0..humanCount-1]); mặc định 1 (single-player). */
    humanCount?: number;
    /** Ô spawn cố định cho người chơi (test/deterministic). */
    spawnAt?: Axial;
    /** Override cấu hình ván (map/bots/rules/win/seed). Số bot: `config.bots.count`. */
    config?: MatchConfigInput;
    /** CONTAINER quản lý điều kiện thắng bên ngoài (ONLINE: `GameRoom.stepTick` tự chạy
     *  countdown King theo vòng đời phòng). Khi bật, `update()` KHÔNG chạy `checkWin` nội bộ —
     *  tránh hai nguồn luật thắng song song. `config.win.kind` vẫn giữ đúng nghĩa (vd king_hold). */
    externalWinControl?: boolean;
}
/**
 * Trạng thái game thuần TypeScript, deterministic — không phụ thuộc render.
 *
 * ĐA THỰC THỂ: players[0] là người chơi, còn lại là bot. Mỗi thực thể di chuyển liên
 * tục (pixel), để lại đuôi khi ra ngoài lãnh thổ; khép vòng → chiếm đất (flood fill,
 * cướp cả ô của đối thủ nằm trong vòng); đầu đâm vào đuôi của ai đó → thực thể đó chết.
 */
export declare class GameState {
    readonly map: Set<HexKey>;
    /** Ô render/tính % (nằm trong tường) — vành biên ngoài KHÔNG thuộc tập này. */
    readonly playable: Set<HexKey>;
    /** Ô CHƯỚNG NGẠI (barrier nội bộ, doc 25 §1.3) — KHÔNG đi/chiếm/đếm được; chặn di chuyển &
     *  flood fill. Nằm TRONG `map` (để cạnh kề không bị coi là rìa thoát ra ngoài). Rỗng với map
     *  lục giác thường. Biên ngoài vẫn là lục giác lồi (chưa hỗ trợ hình lõm tùy biến). */
    readonly obstacles: Set<HexKey>;
    readonly players: Entity[];
    /** Số ghế NGƯỜI (không phải bot): players[0..humanCount-1]. Mặc định 1 (single-player).
     *  Server multiplayer đặt >1 và gán mỗi kết nối vào một ghế người. */
    readonly humanCount: number;
    /** Chủ sở hữu / chủ đuôi của từng ô (id thực thể) — cho render nhanh & va chạm. */
    private cellOwner;
    private cellTrail;
    /** Broad-phase va chạm đầu (spatial hash theo toạ độ liên tục). Cellsize theo killRadius
     *  của ván → gán trong constructor sau khi config resolve. */
    private headHash;
    /** Cấu hình VÁN NÀY (map/bots/rules/win) — thay cho việc đọc thẳng CONFIG (doc 25 §1.1). */
    readonly config: MatchConfig;
    /** Hình học sân PER-INSTANCE (bán kính/biên riêng cho ván) — thay hằng module arena.ts. */
    private readonly arena;
    /** Kích thước hex của ván (tiện đọc; = config.map.hexSize). */
    private readonly hexSize;
    /** CONTAINER tự quản luật thắng (xem `GameStateOptions.externalWinControl`). */
    private readonly externalWinControl;
    private fixedSpawn?;
    private rng;
    /** [doc 34 B] Cứ điểm bot: ô hợp lệ + số bot. `capturedStrongholds` = index đã bị người chơi chiếm
     *  (bot của nó ngừng hồi sinh). `strongholdCell` = HexKey ô → index (phát hiện chiếm). */
    readonly strongholds: Array<{
        q: number;
        r: number;
        botCount: number;
    }>;
    readonly capturedStrongholds: Set<number>;
    private readonly strongholdCell;
    /** [doc 34 D] Đoạn tường BIÊN admin vẽ (world) — va chạm collide-and-slide, không chặn flood-fill. */
    private readonly boundarySegs;
    /** Tăng khi thực thể đổi (vị trí/đuôi) — cho renderer cube/line. */
    revision: number;
    /** Tăng khi lưới cần tô lại (owned hoặc trail hex đổi). */
    gridRevision: number;
    /** Tăng CHỈ khi CHỦ SỞ HỮU ô đổi (không kể đuôi) — cho lớp vạch ranh giới tô lại HIẾM
     *  hơn nhiều (đuôi đổi ~56% frame nhưng KHÔNG ảnh hưởng vạch ranh). */
    territoryRevision: number;
    private totemItems;
    private reconciledTotemTerritoryRevision;
    private totemStateRevision;
    private readonly speedTotemsByOwner;
    private readonly radarOwners;
    private readonly playableOwnedByOwner;
    /** Thời gian (giây) còn lại phải giữ ngôi King liên tục để thắng (gán từ config). */
    kingHoldRemaining: number;
    /** [survive] Thời gian (giây) còn lại phải sống sót để thắng (gán từ config.win.durationSec). */
    surviveRemaining: number;
    /** Đã kết thúc chưa (có người thắng) → đóng băng game. */
    won: boolean;
    /** Id người thắng (-1 nếu chưa). */
    winnerId: number;
    /** [Campaign] Chủ thể đã THUA chưa (hết mạng khi `rules.maxLives > 0`) → đóng băng, chặn hồi
     *  sinh. `false` với mọi mode vô hạn mạng (maxLives=0) ⇒ bất biến /play, /netplay. */
    lost: boolean;
    /** Id chủ thể đã thua (-1 nếu chưa). */
    lostId: number;
    /** Id KING đang được tính giờ giữ ngôi (đổi King → reset đồng hồ). */
    private kingHolderId;
    /** Người chơi đã chọn XEM (khán giả): không hồi sinh nữa tới khi hết ván. */
    spectating: boolean;
    constructor(options?: GameStateOptions);
    get human(): Entity;
    get owned(): Set<HexKey>;
    set owned(v: Set<HexKey>);
    get trailHexes(): HexKey[];
    get trailPoints(): Vec2[];
    get pos(): Vec2;
    get heading(): number;
    get phase(): Phase;
    get prepRemaining(): number;
    get deaths(): number;
    setHeadingTarget(angle: number): void;
    /** Server authoritative: đặt hướng mong muốn cho thực thể theo id (input mạng). Chỉ
     *  áp cho ghế người còn sống — bot tự điều khiển bằng botThink. */
    setTargetHeading(id: number, angle: number): void;
    /** Liệt kê mọi ô lãnh thổ (đất + đuôi) để server gửi keyframe TERRITORY. */
    territoryCells(): TerritoryCell[];
    /** [ONLINE] Đặt trạng thái một thực thể từ snapshot mạng (không chạy mô phỏng). */
    applyEntity(id: number, x: number, y: number, heading: number, alive: boolean, hasTrail?: boolean): void;
    /**
     * [ONLINE] DỰ ĐOÁN Ô ĐUÔI cục bộ cho SELF: tô NGAY hex dưới đầu (đã dự đoán) thành ô đuôi
     * để MÀU Ô bám kịp đầu, không chờ keyframe TERRITORY (~4Hz + trễ mạng) — nếu không, di
     * chuyển lên ô trung lập bị trễ đổi màu dù đường line đã mượt. Chỉ tô ô TRUNG LẬP (không
     * đè chủ/đuôi của ai); keyframe sau đó GHI ĐÈ authoritative. Gọi cho self MỖI FRAME (sau
     * applyEntity + sau applyTerritory) → kể cả frame vừa reconcile keyframe cũng không nhấp
     * nháy vì ô đầu được tô lại ngay. Chỉ gọi khi self còn sống & đang có đuôi (hasTrail).
     */
    predictTrailCell(id: number): void;
    /**
     * [ONLINE] "Đỗ" một ghế: cho thực thể chết & trả toàn bộ đất/đuôi về trung lập, KHÔNG
     * tự hồi sinh. Dùng cho GHẾ CHƯA CÓ NGƯỜI ở phòng chờ → ghế trống không mô phỏng, không
     * để lại "bóng ma" trôi trên sân. Người vào (join) sẽ respawn ghế này.
     */
    park(id: number): void;
    /** [ONLINE] Dựng lại toàn bộ lưới đất/đuôi từ keyframe TERRITORY của server. */
    applyTerritory(cells: TerritoryCell[]): void;
    /** % lãnh thổ của một thực thể theo id (cho HUD online — human getter chỉ trỏ players[0]). */
    pctOf(id: number): number;
    /** [ONLINE] Gán TÊN hiển thị cho một ghế (từ JOIN / roster server). */
    setName(id: number, name: string): void;
    /** Gán ngoại hình đã chuẩn hoá; render local và snapshot online cùng đọc một nguồn này. */
    setAppearance(id: number, appearance?: Partial<PlayerAppearance> | null): void;
    /** Tên hiển thị của thực thể: ưu tiên tên người chơi, fallback tên màu. */
    nameOf(id: number): string;
    /** [ONLINE] Chốt NGƯỜI THẮNG (dùng khi phòng chỉ còn 1 người còn sống). */
    declareWinner(id: number): void;
    /** Ảnh chụp trạng thái thực thể để mã hoá SNAPSHOT (server→client). */
    snapshotEntities(): EntitySnap[];
    hasTrail(k: HexKey): boolean;
    /** Số ô người chơi đang sở hữu / tổng ô chơi được (%). */
    territoryPct(): number;
    /** Bán kính ngoại tiếp sân THẬT của ván (theo config.map.radius) — cho minimap/HUD (doc 34 C). */
    get arenaR(): number;
    /** Bán kính nội tiếp sân THẬT của ván — cho minimap. */
    get arenaInradius(): number;
    get isKing(): boolean;
    /** Id KING hiện tại: thực thể CÒN SỐNG có % cao nhất và ≥ KING_PCT; -1 nếu không có.
     *  King TẮT (kingEnabled=false, doc 34 A) ⇒ luôn -1 (không lên ngôi, không khoá phòng). */
    kingId(): number;
    /** Phòng bị KHOÁ khi đã có KING: không cho ai hồi sinh/tham gia (người còn sống thì
     *  đối kháng với nhau). Hết King → mở lại. */
    roomLocked(): boolean;
    /** Hai bot ĐỒNG MINH (doc 34 B): cùng là bot & `botsAllied` ⇒ KHÔNG sát thương nhau. */
    private allied;
    /** Bot còn được hồi sinh không: không gắn cứ điểm ⇒ có; gắn cứ điểm ⇒ chỉ khi CHƯA bị chiếm. */
    private botCanRespawn;
    /** Ô spawn tại CỨ ĐIỂM của bot (nếu hợp lệ & chưa bị chiếm); null ⇒ dùng pickSpawnHex thường. */
    private strongholdSpawnHex;
    /** Đánh dấu cứ điểm BỊ CHIẾM khi người chơi (id 0) sở hữu ô cứ điểm (doc 34 B). */
    private updateStrongholds;
    /** Id thực thể CÒN SỐNG có nhiều đất nhất (cho camera khán giả); -1 nếu không có. */
    leaderId(): number;
    /** [KHÁN GIẢ] Id thực thể CÒN SỐNG kế tiếp (dir=+1) / trước (dir=-1) theo thứ tự id — để
     *  chuyển tay xem thủ công. `from` = id đang xem (nếu đã chết/không có trong danh sách thì
     *  nhảy vào đầu/cuối). Trả -1 nếu không còn ai sống. */
    spectateCycle(from: number, dir: 1 | -1): number;
    /** % lãnh thổ của mọi thực thể (cho bảng xếp hạng). */
    scores(): {
        id: number;
        name: string;
        pct: number;
        alive: boolean;
        colorIndex: number;
    }[];
    private ownedPlayable;
    /** Id chủ sở hữu ô (owned), hoặc -1 nếu trung lập. */
    cellOwnerId(k: HexKey): number;
    get totemRevision(): number;
    /** Bản sao read-only cho server/protocol; authoritative state không bị lộ để sửa trực tiếp. */
    totemStates(): readonly TotemState[];
    speedTotemCountFor(entityId: number): number;
    radarActiveFor(entityId: number): boolean;
    /** Cấu hình sinh Totem của ván (từ rules) — dùng cho createTotems trong constructor. */
    private totemSpawnConfig;
    /** Cấu hình tốc độ hiệu dụng của ván (đường cong nền + bonus/slow từ rules). */
    private effectiveSpeedConfig;
    insideEnemySlowZoneFor(entityId: number): boolean;
    gameplayModifiersFor(entityId: number): EntityGameplayModifiers;
    effectiveSpeedFor(entityId: number): number;
    private reconcileTotems;
    /** Màu RGB của 1 ô để render lưới. */
    cellColor(k: HexKey): [number, number, number];
    /** Ô đang là đuôi; renderer dùng để tách nền lưới khỏi lớp pattern vector. */
    isTrailCell(k: HexKey): boolean;
    /** Duyệt các ô ĐẤT (owned) kèm id chủ sở hữu — cho minimap & vạch ranh giới. */
    forEachOwned(cb: (k: HexKey, ownerId: number) => void): void;
    private inMap;
    /** Spawn e nếu CÒN vị trí hợp lệ (cách mọi lãnh thổ ≥ SPAWN_CLEARANCE, không đè đất
     *  đã có). Trả về false nếu KHÔNG đủ chỗ → e nằm chờ (dead) chứ không spawn. */
    private spawn;
    /**
     * Chết: mất TOÀN BỘ đuôi. Nếu bị `killer` hạ → toàn bộ ĐẤT của nạn nhân **thuộc về
     * killer**; nếu tự chết (không killer) → đất trả về trung lập. Người chơi → chờ bấm
     * Hồi sinh; bot → tự hồi sinh (khi phòng chưa khoá).
     */
    private kill;
    /** Xoá mọi ô owned/trail của e khỏi bản đồ chia sẻ. */
    private clearOwnership;
    private claimCell;
    /** Người chơi tự chết (dùng cho test / debug). */
    die(): void;
    /** Hồi sinh người chơi. Trả về false nếu không thể (đang sống, phòng bị KING khoá,
     *  hoặc KHÔNG còn ô trống hợp lệ theo SPAWN_CLEARANCE). */
    revive(): boolean;
    /** Người chơi có thể hồi sinh ngay bây giờ không? (chưa chọn xem, không bị khoá, còn chỗ). */
    canRevive(): boolean;
    /** Người chơi chọn XEM (khán giả): từ bỏ hồi sinh, chờ đến khi hết ván mới chơi lại. */
    spectate(): void;
    /** [ONLINE] Server hồi sinh một GHẾ bất kỳ theo id (khi đang chết & phòng chưa khoá).
     *  Trả false nếu không thể (đang sống, phòng có KING, hoặc hết chỗ hợp lệ). */
    respawn(id: number): boolean;
    /**
     * Chơi lại từ đầu: xoá sạch bản đồ chia sẻ, đặt lại trạng thái thắng/đếm giữ
     * ngôi, rồi spawn lại toàn bộ thực thể (mỗi thực thể nhận lại cụm 7 ô + vào
     * lại giai đoạn chuẩn bị). Dùng cho nút "CHƠI LẠI" sau khi thắng.
     */
    restart(): void;
    private botRange;
    /**
     * Chọn ô spawn TUÂN THỦ TUYỆT ĐỐI khoảng cách: tâm đủ sâu trong sân và KHÔNG có ô đất
     * nào của ai trong bán kính `SPAWN_CLEARANCE` (⇒ cụm 7 ô chắc chắn trống, không đè đất
     * đã có). Trả về `null` nếu KHÔNG còn vị trí hợp lệ (bản đồ đã đầy) → không cho hồi sinh.
     * Người chơi có thể dùng `fixedSpawn` (test/deterministic).
     */
    private pickSpawnHex;
    /** Gọi mỗi frame với dt (giây). */
    update(dt: number): void;
    /**
     * Điều kiện thắng — theo `config.win.kind` (doc 25 §1.2). P0 hiện thực:
     *  - `none`      : Luyện tập, không bao giờ thắng/thua (endless).
     *  - `king_hold` : (mặc định) (a) đấu loại — có KING & chỉ còn 1 thực thể sống → thắng
     *                  ngay; hoặc (b) một KING giữ ngôi liên tục đủ winHoldTime giây.
     *  Các loại territory_pct/survive/capture_totems khai báo sẵn ở WinCondition, sẽ cắm
     *  evaluator ở P1 (khi làm Campaign) — hiện dùng nhánh king_hold làm mặc định an toàn.
     */
    /** Chủ thể được đánh giá điều kiện thắng: NGƯỜI chơi (entity 0) nếu ghế 0 là người; nếu
     *  không (vd phòng toàn bot) thì lấy KING hiện tại. -1 nếu không xác định. */
    private winSubjectId;
    private checkWin;
    private updateEntity;
    /** Điểm `(x,y)` có nằm trong HỘP CHỮ NHẬT (AABB) của một ô obstacle nào không (doc 33). AABB
     *  bao trọn ô lục thẳng đứng: nửa rộng = √3/2·size, nửa cao = size. Chỉ xét ô của điểm + 6 ô kề
     *  (AABB không vươn xa hơn) → O(1). */
    private insideObstacleRect;
    /**
     * Va chạm chướng ngại — chọn theo `map.colliderShape` (doc 33):
     * - `"hex"` (MẶC ĐỊNH): biên ĐA GIÁC theo mặt lục giác — góc lồi 120° (>90°) nên KHÔNG kẹt
     *   như hộp chữ nhật. Trượt = bỏ thành phần pháp tuyến của mặt BIÊN gần nhất, lặp cho góc.
     * - `"rect"`: AABB bao ô, giải theo từng trục (giữ như tuỳ chọn).
     * Trả điểm đã giải (đã clamp về trong sân), hoặc `null` khi hoàn toàn không bước được.
     */
    private slideAlongObstacles;
    /** RECT/AABB — giải theo từng trục (x rồi y). */
    private slideRectObstacles;
    /**
     * ĐA GIÁC hex (mặc định): trượt dọc mặt biên của ô obstacle. Bỏ thành phần vận tốc theo pháp
     * tuyến mặt BIÊN gần điểm đích nhất (giữ tiếp tuyến ở tốc độ đầy đủ), lặp tối đa 3 lần cho góc
     * lõm. Còn dính (residual/góc) → đẩy VUÔNG GÓC ra ngoài mặt gần nhất (giữ vị trí tiếp tuyến).
     * Góc lồi của biên là 120° nên không tạo bẫy như góc vuông 90° của hộp chữ nhật.
     */
    private slidePolyObstacles;
    /** [doc 34 D] TRƯỢT dọc tường BIÊN admin vẽ: nếu bước `pos→c` cắt một đoạn biên, bỏ thành phần
     *  vận tốc đi XUYÊN đoạn (giữ tiếp tuyến) → trượt dọc tường, không băng qua. Lặp cho nhiều đoạn. */
    private slideAlongBoundaries;
    /** Nếu `(x,y)` nằm TRONG một ô obstacle CÓ mặt biên: trả mặt biên (giáp ô mở) GẦN NHẤT + tâm
     *  mặt `(mx,my)`. Không trong obstacle, hoặc ô nội bộ đặc (không mặt biên) → `null`. */
    private nearestObstacleFace;
    /** API cho test: di chuyển người chơi tới (x,y) nếu ô đích hợp lệ (không phải chướng ngại). */
    moveTo(x: number, y: number): void;
    private stepEntity;
    /** Xử lý khi đầu e bước vào ô mới. Trả về true nếu e chết. */
    private enterHex;
    private captureFor;
    /**
     * Xử lý ngay một cụm đầu cùng nằm trên một ô trung lập. Không dùng khoảng cách vật lý:
     * chỉ cần pixelToAxial của các đầu cho ra cùng HexKey thì toàn bộ cụm chết đồng thời.
     */
    private resolveNeutralSameHex;
    /** Chủ đất hạ KẺ XÂM NHẬP: nếu đầu đối thủ b đang đứng trên ĐẤT của a và sát đầu a
     *  (≤ KILL_RADIUS) → b chết. Chủ đất bất khả xâm phạm trên sân nhà. */
    private resolveHeadCollisions;
    /** Đối thủ CÒN SỐNG gần e nhất trong bán kính r; onlyOutside=chỉ tính kẻ đang ở ngoài
     *  (đang có đuôi → có thể săn / là mối đe doạ). */
    private nearestEntity;
    /** Điểm trên đuôi của prey gần `from` nhất (để nhắm cắt). */
    private nearestTrailPoint;
    /** Ô ngay phía trước (theo `heading`, cách `dist`) có bị chặn không: ra ngoài sân, hoặc
     *  là ĐUÔI CỦA CHÍNH e (đâm vào = tự sát). */
    private aheadBlocked;
    /** Chọn hướng gần `desired` nhất mà phía trước KHÔNG bị chặn (né đuôi mình + tường).
     *  Bot kỹ năng cao nhìn xa hơn và quét nhiều hướng hơn. */
    private steerAvoiding;
    private botThink;
}
