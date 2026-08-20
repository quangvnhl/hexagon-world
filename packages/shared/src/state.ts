import {
  CONFIG,
  COLORS,
  PLAYER_COLORS,
  PLAYER_SHAPES,
  TRAIL_PATTERNS,
  PlayerColor,
  PlayerAppearance,
  PlayerShape,
  TrailPattern,
  sanitizePlayerAppearance,
} from "./config";
import {
  Axial,
  HexKey,
  DIRECTIONS,
  keyOf,
  neighbors,
  cubeDistance,
  axialToPixel,
  pixelToAxial,
  hexLinedraw,
} from "./hex";
import { ArenaGeometry } from "./arena";
import {
  resolveMatchConfig,
  type MatchConfig,
  type MatchConfigInput,
} from "./match-config";
import { captureEnclosed } from "./floodfill";
import { SpatialHash } from "./spatialhash";
import type { EntitySnap, TerritoryCell } from "./protocol";
import {
  createTotems,
  effectiveSpeedWithTotems,
  type EntityGameplayModifiers,
  type TotemState,
} from "./totems";

/** 6 mặt của ô lục (pointy-top) cho va chạm obstacle đa giác (doc 33): pháp tuyến `n` (đơn vị,
 *  hướng RA tới ô kề) + tiếp tuyến `t` (⟂ n, dọc cạnh). Cố định, không theo hexSize. */
const HEX_FACES = DIRECTIONS.map((d) => {
  const p = axialToPixel(d, 1);
  const l = Math.hypot(p.x, p.y) || 1;
  const nx = p.x / l, ny = p.y / l;
  return { nx, ny, tx: -ny, ty: nx };
});

/** Hai đoạn (p1→p2) và (p3→p4) có CẮT nhau không (doc 34 D — va chạm biên). */
function segmentsCross(p1x: number, p1y: number, p2x: number, p2y: number, p3x: number, p3y: number, p4x: number, p4y: number): boolean {
  const d = (p2x - p1x) * (p4y - p3y) - (p2y - p1y) * (p4x - p3x);
  if (Math.abs(d) < 1e-12) return false; // song song
  const t = ((p3x - p1x) * (p4y - p3y) - (p3y - p1y) * (p4x - p3x)) / d;
  const u = ((p3x - p1x) * (p2y - p1y) - (p3y - p1y) * (p2x - p1x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

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
export class Entity {
  readonly id: number;
  readonly isBot: boolean;
  color: PlayerColor;
  colorIndex: number;
  trailPattern: TrailPattern = "solid";
  shape: PlayerShape = "cube";

  /** Tên hiển thị (người chơi nhập ở màn hình đầu; rỗng → dùng `color.name`). */
  name = "";

  pos: Vec2 = { x: 0, y: 0 };
  heading = 0;
  targetHeading = 0;
  currentHex: Axial = { q: 0, r: 0 };

  owned: Set<HexKey> = new Set();
  trailHexes: HexKey[] = [];
  trailSet: Set<HexKey> = new Set();
  trailPoints: Vec2[] = [];

  phase: Phase = "prep";
  prepRemaining: number = CONFIG.PREP_TIME;
  deaths = 0;

  /** Số Totem đã thu được (cộng dồn trong ván) — cho điều kiện thắng `capture_totems`. */
  totemsCaptured = 0;

  /** Lý do chết lần gần nhất (cho popup). */
  deathCause: DeathCause = "";
  /** Id kẻ đã hạ ở lần chết gần nhất (-1 nếu tự chết / cả hai chết). */
  killerId = -1;
  /** Ảnh chụp lãnh thổ (danh sách ô playable) NGAY TRƯỚC lần chết gần nhất — để vẽ
   *  bản đồ "đất đã chiếm" trong popup chết (vì đất đã bị xoá/chuyển sau khi chết). */
  lastTerritory: HexKey[] = [];
  /** % diện tích ngay trước lần chết gần nhất. */
  lastPct = 0;

  // Trạng thái AI bot (FSM).
  home: Vec2 = { x: 0, y: 0 };
  /** EXPAND = bành trướng; RETURN = về khép vòng; HUNT = săn cắt đuôi; FLEE = rút lui. */
  botState: "expand" | "return" | "hunt" | "flee" = "expand";
  /** Chỉ số vào CONFIG.BOT_DIFFICULTY (độ khó). */
  botProfile = 1;
  /** Đếm ngược tới lần ra quyết định kế (giây). */
  botDecisionTimer = 0;
  /** Id con mồi đang săn (khi ở HUNT). */
  huntId = -1;
  botOutHeading = 0;
  botRange = 10;
  respawnTimer = 0;
  /** [doc 34 B] Cứ điểm chủ của bot (index vào strongholds); -1 = không gắn cứ điểm. */
  strongholdIndex = -1;

  constructor(id: number, isBot: boolean, color: PlayerColor) {
    this.id = id;
    this.isBot = isBot;
    this.color = color;
    this.colorIndex = Math.max(0, PLAYER_COLORS.indexOf(color));
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }
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
export class GameState {
  readonly map: Set<HexKey>; // logic (gồm vành biên ngoài tường)
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
  private cellOwner: Map<HexKey, number> = new Map();
  private cellTrail: Map<HexKey, number> = new Map();
  /** Broad-phase va chạm đầu (spatial hash theo toạ độ liên tục). Cellsize theo killRadius
   *  của ván → gán trong constructor sau khi config resolve. */
  private headHash: SpatialHash<{ id: number; x: number; y: number }>;

  /** Cấu hình VÁN NÀY (map/bots/rules/win) — thay cho việc đọc thẳng CONFIG (doc 25 §1.1). */
  readonly config: MatchConfig;
  /** Hình học sân PER-INSTANCE (bán kính/biên riêng cho ván) — thay hằng module arena.ts. */
  private readonly arena: ArenaGeometry;
  /** Kích thước hex của ván (tiện đọc; = config.map.hexSize). */
  private readonly hexSize: number;
  /** CONTAINER tự quản luật thắng (xem `GameStateOptions.externalWinControl`). */
  private readonly externalWinControl: boolean;

  private fixedSpawn?: Axial;
  private rng: () => number = Math.random;

  /** [doc 34 B] Cứ điểm bot: ô hợp lệ + số bot. `capturedStrongholds` = index đã bị người chơi chiếm
   *  (bot của nó ngừng hồi sinh). `strongholdCell` = HexKey ô → index (phát hiện chiếm). */
  readonly strongholds: Array<{ q: number; r: number; botCount: number }> = [];
  readonly capturedStrongholds = new Set<number>();
  private readonly strongholdCell = new Map<HexKey, number>();

  /** [doc 34 D] Đoạn tường BIÊN admin vẽ (world) — va chạm collide-and-slide, không chặn flood-fill. */
  private readonly boundarySegs: { ax: number; ay: number; bx: number; by: number }[] = [];

  /** Tăng khi thực thể đổi (vị trí/đuôi) — cho renderer cube/line. */
  revision = 0;
  /** Tăng khi lưới cần tô lại (owned hoặc trail hex đổi). */
  gridRevision = 0;
  /** Tăng CHỈ khi CHỦ SỞ HỮU ô đổi (không kể đuôi) — cho lớp vạch ranh giới tô lại HIẾM
   *  hơn nhiều (đuôi đổi ~56% frame nhưng KHÔNG ảnh hưởng vạch ranh). */
  territoryRevision = 0;

  private totemItems: TotemState[] = [];
  private reconciledTotemTerritoryRevision = -1;
  private totemStateRevision = 0;
  private readonly speedTotemsByOwner = new Map<number, number>();
  private readonly radarOwners = new Set<number>();
  private readonly playableOwnedByOwner = new Map<number, number>();

  /** Thời gian (giây) còn lại phải giữ ngôi King liên tục để thắng (gán từ config). */
  kingHoldRemaining: number;
  /** [survive] Thời gian (giây) còn lại phải sống sót để thắng (gán từ config.win.durationSec). */
  surviveRemaining: number;
  /** Đã kết thúc chưa (có người thắng) → đóng băng game. */
  won = false;
  /** Id người thắng (-1 nếu chưa). */
  winnerId = -1;
  /** [Campaign] Chủ thể đã THUA chưa (hết mạng khi `rules.maxLives > 0`) → đóng băng, chặn hồi
   *  sinh. `false` với mọi mode vô hạn mạng (maxLives=0) ⇒ bất biến /play, /netplay. */
  lost = false;
  /** Id chủ thể đã thua (-1 nếu chưa). */
  lostId = -1;
  /** Id KING đang được tính giờ giữ ngôi (đổi King → reset đồng hồ). */
  private kingHolderId = -1;
  /** Người chơi đã chọn XEM (khán giả): không hồi sinh nữa tới khi hết ván. */
  spectating = false;

  constructor(options: GameStateOptions = {}) {
    // Cấu hình + hình học PER-INSTANCE (default = giá trị CONFIG ⇒ hành vi cũ y hệt).
    this.config = resolveMatchConfig(options.config);
    this.arena = new ArenaGeometry(
      this.config.map.radius,
      this.config.map.wallScale,
      this.config.map.hexSize,
    );
    this.hexSize = this.config.map.hexSize;
    this.externalWinControl = options.externalWinControl ?? false;
    this.headHash = new SpatialHash<{ id: number; x: number; y: number }>(
      this.config.rules.killRadius,
    );
    this.kingHoldRemaining = this.config.win.winHoldTime;
    this.surviveRemaining = this.config.win.durationSec ?? Number.POSITIVE_INFINITY;

    this.fixedSpawn = options.spawnAt;
    this.humanCount = Math.max(1, options.humanCount ?? 1);
    // Cứ điểm (doc 34 B): mỗi bot gắn 1 cứ điểm. Có cứ điểm ⇒ tổng bot = Σ botCount (bỏ bots.count);
    // `botStronghold[b]` = index cứ điểm của bot thứ b (0-index trong nhóm bot).
    const botStronghold: number[] = [];
    for (const s of this.config.map.strongholds ?? []) {
      const idx = this.strongholds.length;
      this.strongholds.push({ q: s.q, r: s.r, botCount: Math.max(0, Math.floor(s.botCount)) });
      this.strongholdCell.set(keyOf({ q: s.q, r: s.r }), idx);
      for (let b = 0; b < this.strongholds[idx].botCount; b++) botStronghold.push(idx);
    }
    const botCount = this.strongholds.length > 0 ? botStronghold.length : this.config.bots.count;
    // Tường BIÊN (doc 34 D): tách polyline thành các ĐOẠN cho va chạm.
    for (const b of this.config.map.boundaries ?? []) {
      for (let i = 0; i + 1 < b.points.length; i++) {
        this.boundarySegs.push({ ax: b.points[i][0], ay: b.points[i][1], bx: b.points[i + 1][0], by: b.points[i + 1][1] });
      }
    }
    // playable = ô có TÂM trong tường va chạm (wallLimit), TRỪ ô chướng ngại. Ô chướng ngại
    // (config.map.obstacles) chỉ tính nếu thực sự là ô hợp lệ trong sân.
    this.obstacles = new Set();
    this.playable = new Set();
    const obstacleInput = new Set(this.config.map.obstacles ?? []);
    for (const k of this.arena.mapArena(this.config.map.mapMargin)) {
      const p = axialToPixel(keyToAxial(k), this.hexSize);
      if (!this.arena.insideArena(p.x, p.y, 0)) continue;
      if (obstacleInput.has(k)) this.obstacles.add(k);
      else this.playable.add(k);
    }
    // map = playable ∪ obstacles ∪ ĐÚNG 1 VÀNH ô kề. Vành này = tường hiển thị (BorderRim) +
    // biên cho flood fill + đảm bảo đầu bị clamp luôn rơi vào ô hợp lệ. Ô chướng ngại NẰM TRONG
    // map (không bỏ ra) để ô kề nó KHÔNG bị coi là "rìa thoát ra ngoài" khi flood fill — hành xử
    // như tường NỘI BỘ (nhốt được vùng tựa vào nó), không phải lỗ thủng. Dựng theo ô KỀ (không
    // theo dải world-units mỏng) nên KHÔNG BAO GIỜ mất tường khi đổi WALL_SCALE.
    this.map = new Set(this.playable);
    for (const k of this.obstacles) this.map.add(k);
    for (const k of this.playable) {
      for (const nb of neighbors(keyToAxial(k))) this.map.add(keyOf(nb));
    }

    // Totem: cấp CHỈ ĐỊNH totem tường minh (map.totems — trình vẽ admin, doc 32) ⇒ dùng ĐÚNG
    // danh sách đó (bỏ trùng ô / ô ngoài sân chơi / trên obstacle), BỎ sinh ngẫu nhiên. Vắng ⇒
    // sinh ngẫu nhiên theo seed như cũ (cấp cũ + /play + /netplay bất biến).
    const authoredTotems = this.config.map.totems;
    if (authoredTotems && authoredTotems.length > 0) {
      const seen = new Set<HexKey>();
      this.totemItems = [];
      for (const t of authoredTotems) {
        const k = keyOf({ q: t.q, r: t.r });
        if (seen.has(k) || !this.playable.has(k)) continue;
        seen.add(k);
        this.totemItems.push({ id: this.totemItems.length, kind: t.kind, q: t.q, r: t.r, ownerId: -1 });
      }
    } else {
      this.totemItems = createTotems(
        this.playable,
        this.config.seed,
        [],
        this.totemSpawnConfig(),
      );
    }

    const mix = this.config.bots.difficultyMix;
    const allied = this.config.rules.botsAllied;
    const n = this.humanCount + Math.max(0, botCount);
    this.players = [];
    for (let i = 0; i < n; i++) {
      const isBot = i >= this.humanCount;
      // Bot ĐỒNG MINH (doc 34 B): mọi bot CÙNG màu (đội 1); người chơi giữ bảng màu như cũ.
      const color = isBot && allied ? PLAYER_COLORS[1 % PLAYER_COLORS.length] : PLAYER_COLORS[i % PLAYER_COLORS.length];
      const e = new Entity(i, isBot, color);
      if (isBot) {
        const b = i - this.humanCount;
        e.botProfile = mix && mix.length > 0
          ? mix[b % mix.length]
          : b % CONFIG.BOT_DIFFICULTY.length;
        if (b < botStronghold.length) e.strongholdIndex = botStronghold[b]; // gắn cứ điểm chủ
      }
      this.players.push(e);
    }
    for (const e of this.players) this.spawn(e);
  }

  get human(): Entity {
    return this.players[0];
  }

  // ---- API tương thích (người chơi) ---------------------------------------
  get owned(): Set<HexKey> {
    return this.human.owned;
  }
  set owned(v: Set<HexKey>) {
    // Đồng bộ cellOwner để enterHex/capture nhận đúng lãnh thổ (dùng cho test).
    for (const k of this.human.owned) {
      if (this.cellOwner.get(k) === this.human.id) this.cellOwner.delete(k);
    }
    this.human.owned = new Set();
    for (const k of v) this.claimCell(k, this.human);
  }
  get trailHexes(): HexKey[] {
    return this.human.trailHexes;
  }
  get trailPoints(): Vec2[] {
    return this.human.trailPoints;
  }
  get pos(): Vec2 {
    return this.human.pos;
  }
  get heading(): number {
    return this.human.heading;
  }
  get phase(): Phase {
    return this.human.phase;
  }
  get prepRemaining(): number {
    return this.human.prepRemaining;
  }
  get deaths(): number {
    return this.human.deaths;
  }

  setHeadingTarget(angle: number): void {
    this.human.targetHeading = angle;
  }

  /** Server authoritative: đặt hướng mong muốn cho thực thể theo id (input mạng). Chỉ
   *  áp cho ghế người còn sống — bot tự điều khiển bằng botThink. */
  setTargetHeading(id: number, angle: number): void {
    const e = this.players[id];
    if (e && !e.isBot && e.alive) e.targetHeading = angle;
  }

  // ---- API cho chế độ ONLINE (client dựng GameState-view từ mạng) ----------
  // Client tạo `new GameState(...)` (để có sân/map/players + màu khớp server) rồi CHỈ
  // đẩy trạng thái mạng vào — KHÔNG gọi update(). Nhờ vậy TÁI DÙNG toàn bộ renderer
  // (lưới, chiếm đất, minimap, cube) y hệt chơi đơn.

  /** Liệt kê mọi ô lãnh thổ (đất + đuôi) để server gửi keyframe TERRITORY. */
  territoryCells(): TerritoryCell[] {
    const out: TerritoryCell[] = [];
    for (const [k, oid] of this.cellOwner) {
      const a = keyToAxial(k);
      out.push({ q: a.q, r: a.r, owner: oid, kind: 0 });
    }
    for (const [k, tid] of this.cellTrail) {
      const a = keyToAxial(k);
      out.push({ q: a.q, r: a.r, owner: tid, kind: 1 });
    }
    return out;
  }

  /** [ONLINE] Đặt trạng thái một thực thể từ snapshot mạng (không chạy mô phỏng). */
  applyEntity(
    id: number,
    x: number,
    y: number,
    heading: number,
    alive: boolean,
    hasTrail = false
  ): void {
    const e = this.players[id];
    if (!e) return;
    e.pos = { x, y };
    e.heading = heading;
    e.phase = alive ? "playing" : "dead";
    e.currentHex = pixelToAxial(x, y, this.hexSize);
    // ĐUÔI MƯỢT: tích luỹ ĐÚNG đường ĐẦU đã đi qua (giống chơi đơn) — KHÔNG bám tâm ô lục
    // giác. Khi thực thể đang có đuôi (hasTrail) → thêm điểm tại vị trí đầu hiện tại (đầu
    // đã dự đoán/nội suy nên mượt), giãn cách theo TRAIL_POINT_DIST. Khi hết đuôi (khép
    // vòng chiếm đất / chết) → xoá đường. Ô đuôi TÔ MÀU vẫn dựng từ keyframe TERRITORY.
    if (alive && hasTrail) {
      const pts = e.trailPoints;
      const last = pts.length > 0 ? pts[pts.length - 1] : null;
      if (!last || Math.hypot(x - last.x, y - last.y) >= this.config.rules.trailPointDist) {
        pts.push({ x, y });
      }
    } else if (e.trailPoints.length > 0) {
      e.trailPoints = [];
    }
    this.revision++;
  }

  /**
   * [ONLINE] DỰ ĐOÁN Ô ĐUÔI cục bộ cho SELF: tô NGAY hex dưới đầu (đã dự đoán) thành ô đuôi
   * để MÀU Ô bám kịp đầu, không chờ keyframe TERRITORY (~4Hz + trễ mạng) — nếu không, di
   * chuyển lên ô trung lập bị trễ đổi màu dù đường line đã mượt. Chỉ tô ô TRUNG LẬP (không
   * đè chủ/đuôi của ai); keyframe sau đó GHI ĐÈ authoritative. Gọi cho self MỖI FRAME (sau
   * applyEntity + sau applyTerritory) → kể cả frame vừa reconcile keyframe cũng không nhấp
   * nháy vì ô đầu được tô lại ngay. Chỉ gọi khi self còn sống & đang có đuôi (hasTrail).
   */
  predictTrailCell(id: number): void {
    const e = this.players[id];
    if (!e || e.phase !== "playing") return;
    const hk = keyOf(e.currentHex);
    if (this.cellOwner.has(hk)) return; // ô đã có chủ (mình/đối thủ) → authoritative lo
    if (this.cellTrail.has(hk)) return; // đã là đuôi (mình/đối thủ) → không đè
    this.cellTrail.set(hk, id);
    e.trailHexes.push(hk);
    e.trailSet.add(hk);
    this.gridRevision++;
  }

  /**
   * [ONLINE] "Đỗ" một ghế: cho thực thể chết & trả toàn bộ đất/đuôi về trung lập, KHÔNG
   * tự hồi sinh. Dùng cho GHẾ CHƯA CÓ NGƯỜI ở phòng chờ → ghế trống không mô phỏng, không
   * để lại "bóng ma" trôi trên sân. Người vào (join) sẽ respawn ghế này.
   */
  park(id: number): void {
    const e = this.players[id];
    if (!e) return;
    this.clearOwnership(e);
    e.owned = new Set();
    e.trailHexes = [];
    e.trailSet = new Set();
    e.trailPoints = [];
    e.phase = "dead";
    e.respawnTimer = 0; // non-bot → updateEntity không tự hồi sinh
    this.revision++;
    this.gridRevision++;
  }

  /** [ONLINE] Dựng lại toàn bộ lưới đất/đuôi từ keyframe TERRITORY của server. */
  applyTerritory(cells: TerritoryCell[]): void {
    this.cellOwner.clear();
    this.cellTrail.clear();
    for (const e of this.players) {
      e.owned = new Set();
      e.trailHexes = [];
      e.trailSet = new Set();
    }
    for (const c of cells) {
      const owner = this.players[c.owner];
      if (!owner) continue;
      const hk = keyOf({ q: c.q, r: c.r });
      if (c.kind === 1) {
        this.cellTrail.set(hk, c.owner);
        owner.trailHexes.push(hk);
        owner.trailSet.add(hk);
      } else {
        this.cellOwner.set(hk, c.owner);
        owner.owned.add(hk);
      }
    }
    // KHÔNG dựng trailPoints từ tâm ô ở đây — đường đuôi MƯỢT do applyEntity tích luỹ theo
    // vị trí đầu thực tế (xem applyEntity). Keyframe chỉ dựng lại các Ô đuôi (tô màu nền).
    this.gridRevision++;
    // Keyframe thay TOÀN BỘ chủ ô → CHỦ ô có thể đã đổi. Bump territoryRevision để vạch ranh
    // (TerritoryBorders, gate theo revision này) dựng lại — ở NET MODE đây là đường DUY NHẤT
    // cập nhật lãnh thổ (client không chạy claimCell), thiếu bump ⇒ vạch ranh không bao giờ hiện.
    this.territoryRevision++;
  }

  /** % lãnh thổ của một thực thể theo id (cho HUD online — human getter chỉ trỏ players[0]). */
  pctOf(id: number): number {
    const e = this.players[id];
    if (!e) return 0;
    return (this.ownedPlayable(e) / this.playable.size) * 100;
  }

  /** [ONLINE] Gán TÊN hiển thị cho một ghế (từ JOIN / roster server). */
  setName(id: number, name: string): void {
    const e = this.players[id];
    if (e) e.name = name;
  }

  /** Gán ngoại hình đã chuẩn hoá; render local và snapshot online cùng đọc một nguồn này. */
  setAppearance(id: number, appearance?: Partial<PlayerAppearance> | null): void {
    const e = this.players[id];
    if (!e) return;
    const next = sanitizePlayerAppearance(appearance);
    if (
      e.colorIndex === next.colorIndex &&
      e.trailPattern === next.trailPattern &&
      e.shape === next.shape
    )
      return;
    e.colorIndex = next.colorIndex;
    e.trailPattern = next.trailPattern;
    e.shape = next.shape;
    e.color = PLAYER_COLORS[next.colorIndex];
    // Màu đất/đuôi đang hiển thị có thể đổi dù ownership không đổi.
    this.gridRevision++;
    this.revision++;
  }

  /** Tên hiển thị của thực thể: ưu tiên tên người chơi, fallback tên màu. */
  nameOf(id: number): string {
    const e = this.players[id];
    if (!e) return "";
    return e.name || e.color.name;
  }

  /** [ONLINE] Chốt NGƯỜI THẮNG (dùng khi phòng chỉ còn 1 người còn sống). */
  declareWinner(id: number): void {
    if (this.won) return;
    this.won = true;
    this.winnerId = id;
  }

  /** Ảnh chụp trạng thái thực thể để mã hoá SNAPSHOT (server→client). */
  snapshotEntities(): EntitySnap[] {
    return this.players.map((e) => {
      const modifiers = this.gameplayModifiersFor(e.id);
      return {
      id: e.id,
      alive: e.alive,
      hasTrail: e.trailHexes.length > 0,
      colorIndex: e.colorIndex,
      trailPatternIndex: Math.max(0, TRAIL_PATTERNS.indexOf(e.trailPattern)),
      shapeIndex: Math.max(0, PLAYER_SHAPES.indexOf(e.shape)),
      x: e.pos.x,
      y: e.pos.y,
      heading: e.heading,
      score: this.ownedPlayable(e),
      effectiveSpeed: modifiers.effectiveSpeed,
      speedTotemCount: modifiers.speedTotemCount,
      radarActive: modifiers.radarActive,
    };
    });
  }

  hasTrail(k: HexKey): boolean {
    return this.cellTrail.has(k);
  }

  /** Số ô người chơi đang sở hữu / tổng ô chơi được (%). */
  territoryPct(): number {
    return (this.ownedPlayable(this.human) / this.playable.size) * 100;
  }

  /** Bán kính ngoại tiếp sân THẬT của ván (theo config.map.radius) — cho minimap/HUD (doc 34 C). */
  get arenaR(): number { return this.arena.arenaR; }
  /** Bán kính nội tiếp sân THẬT của ván — cho minimap. */
  get arenaInradius(): number { return this.arena.inradius; }

  get isKing(): boolean {
    return this.config.rules.kingEnabled && this.territoryPct() >= this.config.win.kingPct;
  }

  /** Id KING hiện tại: thực thể CÒN SỐNG có % cao nhất và ≥ KING_PCT; -1 nếu không có.
   *  King TẮT (kingEnabled=false, doc 34 A) ⇒ luôn -1 (không lên ngôi, không khoá phòng). */
  kingId(): number {
    if (!this.config.rules.kingEnabled) return -1;
    let id = -1;
    let max = -1;
    for (const e of this.players) {
      if (!e.alive) continue;
      const pct = (this.ownedPlayable(e) / this.playable.size) * 100;
      if (pct > max) {
        max = pct;
        id = e.id;
      }
    }
    return max >= this.config.win.kingPct ? id : -1;
  }

  /** Phòng bị KHOÁ khi đã có KING: không cho ai hồi sinh/tham gia (người còn sống thì
   *  đối kháng với nhau). Hết King → mở lại. */
  roomLocked(): boolean {
    return this.kingId() !== -1;
  }

  /** Hai bot ĐỒNG MINH (doc 34 B): cùng là bot & `botsAllied` ⇒ KHÔNG sát thương nhau. */
  private allied(a: Entity, b: Entity): boolean {
    return this.config.rules.botsAllied && a.isBot && b.isBot;
  }

  /** Hai id CÙNG ĐỘI: trùng id, hoặc `botsAllied` và cả hai là bot (doc 34: Bot đồng đội). Dùng cho
   *  render viền (không vẽ ngăn cách giữa ô đồng đội) + logic đất/đuôi CHUNG. */
  sameTeam(idA: number, idB: number): boolean {
    if (idA === idB) return true;
    const a = this.players[idA], b = this.players[idB];
    return !!a && !!b && this.config.rules.botsAllied && a.isBot && b.isBot;
  }

  /** Ô `hk` thuộc ĐỘI của `e` (owner là e hoặc đồng đội). Bot đi trên ô ĐỘI = "về nhà" ⇒ không đuôi. */
  private teamOwns(hk: HexKey, e: Entity): boolean {
    const owner = this.cellOwner.get(hk);
    return owner !== undefined && this.sameTeam(owner, e.id);
  }

  /** Bot còn được hồi sinh không: không gắn cứ điểm ⇒ có; gắn cứ điểm ⇒ chỉ khi CHƯA bị chiếm. */
  private botCanRespawn(e: Entity): boolean {
    if (!e.isBot) return true;
    if (this.strongholds.length === 0 || e.strongholdIndex < 0) return true;
    return !this.capturedStrongholds.has(e.strongholdIndex);
  }

  /** Ô spawn tại CỨ ĐIỂM của bot (nếu hợp lệ & chưa bị chiếm); null ⇒ dùng pickSpawnHex thường. */
  private strongholdSpawnHex(e: Entity): Axial | null {
    if (!e.isBot || e.strongholdIndex < 0 || this.strongholds.length === 0) return null;
    if (this.capturedStrongholds.has(e.strongholdIndex)) return null;
    const s = this.strongholds[e.strongholdIndex];
    return this.playable.has(keyOf({ q: s.q, r: s.r })) ? { q: s.q, r: s.r } : null;
  }

  /** Đánh dấu cứ điểm BỊ CHIẾM khi người chơi (id 0) sở hữu ô cứ điểm (doc 34 B). */
  private updateStrongholds(): void {
    if (this.strongholds.length === 0) return;
    for (const [k, idx] of this.strongholdCell) {
      if (!this.capturedStrongholds.has(idx) && this.cellOwner.get(k) === 0) this.capturedStrongholds.add(idx);
    }
  }

  /** Id thực thể CÒN SỐNG có nhiều đất nhất (cho camera khán giả); -1 nếu không có. */
  leaderId(): number {
    let id = -1;
    let max = -1;
    for (const e of this.players) {
      if (!e.alive) continue;
      const c = this.ownedPlayable(e);
      if (c > max) {
        max = c;
        id = e.id;
      }
    }
    return id;
  }

  /** [KHÁN GIẢ] Id thực thể CÒN SỐNG kế tiếp (dir=+1) / trước (dir=-1) theo thứ tự id — để
   *  chuyển tay xem thủ công. `from` = id đang xem (nếu đã chết/không có trong danh sách thì
   *  nhảy vào đầu/cuối). Trả -1 nếu không còn ai sống. */
  spectateCycle(from: number, dir: 1 | -1): number {
    const alive = this.players
      .filter((e) => e.alive)
      .map((e) => e.id)
      .sort((a, b) => a - b);
    if (alive.length === 0) return -1;
    const idx = alive.indexOf(from);
    if (idx < 0) return dir > 0 ? alive[0] : alive[alive.length - 1];
    return alive[(idx + dir + alive.length) % alive.length];
  }

  /** % lãnh thổ của mọi thực thể (cho bảng xếp hạng). */
  scores(): { id: number; name: string; pct: number; alive: boolean; colorIndex: number }[] {
    return this.players.map((e) => ({
      id: e.id,
      name: e.name || e.color.name,
      pct: (this.ownedPlayable(e) / this.playable.size) * 100,
      alive: e.alive,
      colorIndex: e.colorIndex,
    }));
  }

  private ownedPlayable(e: Entity): number {
    let c = 0;
    for (const k of e.owned) if (this.playable.has(k)) c++;
    return c;
  }

  /** Id chủ sở hữu ô (owned), hoặc -1 nếu trung lập. */
  cellOwnerId(k: HexKey): number {
    const oid = this.cellOwner.get(k);
    return oid === undefined ? -1 : oid;
  }

  get totemRevision(): number {
    this.reconcileTotems();
    return this.totemStateRevision;
  }

  /** Bản sao read-only cho server/protocol; authoritative state không bị lộ để sửa trực tiếp. */
  totemStates(): readonly TotemState[] {
    this.reconcileTotems();
    return this.totemItems.map((item) => ({ ...item }));
  }

  speedTotemCountFor(entityId: number): number {
    this.reconcileTotems();
    return this.speedTotemsByOwner.get(entityId) ?? 0;
  }

  radarActiveFor(entityId: number): boolean {
    this.reconcileTotems();
    return this.radarOwners.has(entityId);
  }

  /** Cấu hình sinh Totem của ván (từ rules) — dùng cho createTotems trong constructor. */
  private totemSpawnConfig() {
    const t = this.config.rules.totems;
    return {
      hexSize: this.hexSize,
      speedCount: t.speedCount,
      slowCount: t.slowCount,
      radarCount: t.radarCount,
      minSpawnDistance: t.minSpawnDistance,
      spawnClearance: t.spawnClearance,
      enabled: this.config.rules.totemsEnabled,
      insideArena: (x: number, y: number, slack: number) =>
        this.arena.insideArena(x, y, slack),
    };
  }

  /** Cấu hình tốc độ hiệu dụng của ván (đường cong nền + bonus/slow từ rules). */
  private effectiveSpeedConfig() {
    const t = this.config.rules.totems;
    return {
      curve: {
        min: this.config.rules.speed.min,
        max: this.config.rules.speed.max,
        kingPct: this.config.win.kingPct,
      },
      speedBonus: t.speedBonus,
      slowEnemySpeed: t.slowEnemySpeed,
    };
  }

  insideEnemySlowZoneFor(entityId: number): boolean {
    this.reconcileTotems();
    const entity = this.players[entityId];
    if (!entity) return false;
    const radiusSq = this.config.rules.totems.slowRadius ** 2;
    return this.totemItems.some((totem) => {
      if (totem.kind !== "slow" || totem.ownerId < 0 || totem.ownerId === entityId) return false;
      const p = axialToPixel(totem, this.hexSize);
      return (entity.pos.x - p.x) ** 2 + (entity.pos.y - p.y) ** 2 <= radiusSq;
    });
  }

  gameplayModifiersFor(entityId: number): EntityGameplayModifiers {
    const speedTotemCount = this.speedTotemCountFor(entityId);
    const radarActive = this.radarActiveFor(entityId);
    const insideEnemySlowZone = this.insideEnemySlowZoneFor(entityId);
    return {
      effectiveSpeed: effectiveSpeedWithTotems(
        ((this.playableOwnedByOwner.get(entityId) ?? 0) / this.playable.size) * 100,
        speedTotemCount,
        insideEnemySlowZone,
        this.effectiveSpeedConfig(),
      ),
      speedTotemCount,
      radarActive,
      insideEnemySlowZone,
    };
  }

  effectiveSpeedFor(entityId: number): number {
    return this.gameplayModifiersFor(entityId).effectiveSpeed;
  }

  private reconcileTotems(): void {
    if (this.reconciledTotemTerritoryRevision === this.territoryRevision) return;
    this.reconciledTotemTerritoryRevision = this.territoryRevision;
    this.speedTotemsByOwner.clear();
    this.radarOwners.clear();
    this.playableOwnedByOwner.clear();
    for (const [cell, ownerId] of this.cellOwner) {
      if (this.playable.has(cell)) {
        this.playableOwnedByOwner.set(ownerId, (this.playableOwnedByOwner.get(ownerId) ?? 0) + 1);
      }
    }
    let changed = false;
    this.totemItems = this.totemItems.map((totem) => {
      const ownerId = this.cellOwner.get(keyOf(totem)) ?? -1;
      if (ownerId >= 0 && totem.kind === "speed") {
        this.speedTotemsByOwner.set(ownerId, (this.speedTotemsByOwner.get(ownerId) ?? 0) + 1);
      } else if (ownerId >= 0 && totem.kind === "radar") {
        this.radarOwners.add(ownerId);
      }
      if (ownerId === totem.ownerId) return totem;
      changed = true;
      // Totem vừa đổi sang một chủ mới (ownerId >= 0) ⇒ đó là một lần "thu" Totem → cộng dồn
      // cho chủ mới (dùng cho điều kiện thắng capture_totems). Chủ trước mất quyền sở hữu
      // KHÔNG trừ ngược (đếm cộng dồn số lần thu được).
      if (ownerId >= 0) {
        const owner = this.players[ownerId];
        if (owner) owner.totemsCaptured++;
      }
      return { ...totem, ownerId };
    });
    if (changed) this.totemStateRevision++;
  }

  /** Màu RGB của 1 ô để render lưới. */
  cellColor(k: HexKey): [number, number, number] {
    const tid = this.cellTrail.get(k);
    if (tid !== undefined) return this.players[tid].color.trail;
    const oid = this.cellOwner.get(k);
    if (oid !== undefined) return this.players[oid].color.owned;
    return COLORS.neutral;
  }

  /** Ô đang là đuôi; renderer dùng để tách nền lưới khỏi lớp pattern vector. */
  isTrailCell(k: HexKey): boolean {
    return this.cellTrail.has(k);
  }

  /** Duyệt các ô ĐẤT (owned) kèm id chủ sở hữu — cho minimap & vạch ranh giới. */
  forEachOwned(cb: (k: HexKey, ownerId: number) => void): void {
    for (const [k, oid] of this.cellOwner) cb(k, oid);
  }

  private inMap(x: number, y: number): boolean {
    return this.map.has(keyOf(pixelToAxial(x, y, this.hexSize)));
  }

  // ---- Vòng đời thực thể ---------------------------------------------------
  /** Spawn e nếu CÒN vị trí hợp lệ (cách mọi lãnh thổ ≥ SPAWN_CLEARANCE, không đè đất
   *  đã có). Trả về false nếu KHÔNG đủ chỗ → e nằm chờ (dead) chứ không spawn. */
  private spawn(e: Entity): boolean {
    const spawnHex = this.strongholdSpawnHex(e) ?? this.pickSpawnHex(e);
    if (!spawnHex) {
      // Không còn ô trống hợp lệ → không hồi sinh; nằm chờ tới khi có chỗ.
      e.phase = "dead";
      e.respawnTimer = e.isBot ? CONFIG.BOT.RESPAWN_DELAY : 0;
      return false;
    }
    this.clearOwnership(e);
    e.trailHexes = [];
    e.trailSet = new Set();
    e.trailPoints = [];
    e.owned = new Set();
    e.phase = "prep";
    e.prepRemaining = this.config.rules.prepTime;
    e.respawnTimer = 0;
    e.deathCause = "";
    e.killerId = -1;

    e.currentHex = spawnHex;
    const p = axialToPixel(spawnHex, this.hexSize);
    e.pos = { x: p.x, y: p.y };
    e.home = { x: p.x, y: p.y };
    e.heading = e.isBot ? this.rng() * Math.PI * 2 : 0;
    e.targetHeading = e.heading;
    e.botState = "expand";
    e.botOutHeading = e.heading;
    e.botRange = this.botRange();
    e.botDecisionTimer = 0;
    e.huntId = -1;

    // Ô spawn + các ô kề trong cube distance ≤ START_RADIUS → cụm khởi đầu thuộc về e.
    // Sinh trực tiếp đĩa hex quanh spawnHex (O(R²)) thay vì quét cả bản đồ (O(map)) —
    // quan trọng khi bản đồ rất lớn.
    const R = this.config.rules.startRadius;
    for (let dq = -R; dq <= R; dq++) {
      const lo = Math.max(-R, -dq - R);
      const hi = Math.min(R, -dq + R);
      for (let dr = lo; dr <= hi; dr++) {
        const hk = keyOf({ q: spawnHex.q + dq, r: spawnHex.r + dr });
        if (this.map.has(hk)) this.claimCell(hk, e);
      }
    }
    this.revision++;
    this.gridRevision++;
    return true;
  }

  /**
   * Chết: mất TOÀN BỘ đuôi. Nếu bị `killer` hạ → toàn bộ ĐẤT của nạn nhân **thuộc về
   * killer**; nếu tự chết (không killer) → đất trả về trung lập. Người chơi → chờ bấm
   * Hồi sinh; bot → tự hồi sinh (khi phòng chưa khoá).
   */
  private kill(e: Entity, killer?: Entity, cause: DeathCause = "self"): void {
    e.deaths++;
    // Ghi lý do chết + ảnh chụp lãnh thổ (playable) TRƯỚC khi xoá/chuyển đất, để popup
    // báo "vì sao chết" và vẽ bản đồ đất đã chiếm.
    e.deathCause = cause;
    e.killerId = killer && killer !== e ? killer.id : -1;
    e.lastPct = (this.ownedPlayable(e) / this.playable.size) * 100;
    e.lastTerritory = [];
    for (const k of e.owned) if (this.playable.has(k)) e.lastTerritory.push(k);
    // Bot ĐỒNG ĐỘI chết (doc 34): KHÔNG trao đất cho killer. Đất chuyển cho một đồng đội còn sống
    // (giữ nguyên màu đội); không còn đồng đội thì GIỮ NGUYÊN ô của bot đã chết. Người chơi phải
    // DI CHUYỂN để chiếm — giết bot không tự chiếm ô.
    if (this.config.rules.botsAllied && e.isBot) {
      const mate = this.players.find((p) => p !== e && p.isBot && p.alive);
      if (mate) { for (const k of [...e.owned]) this.claimCell(k, mate); e.owned = new Set(); }
      for (const t of e.trailHexes) if (this.cellTrail.get(t) === e.id) this.cellTrail.delete(t);
      e.trailHexes = []; e.trailSet = new Set(); e.trailPoints = [];
      e.phase = "dead";
      e.respawnTimer = CONFIG.BOT.RESPAWN_DELAY;
      this.territoryRevision++; this.revision++; this.gridRevision++;
      return;
    }
    let releasedTerritory = false;
    if (killer && killer !== e && killer.alive) {
      // Cướp toàn bộ đất của nạn nhân cho kẻ đã hạ.
      for (const k of [...e.owned]) this.claimCell(k, killer);
    } else {
      for (const k of e.owned) {
        if (this.cellOwner.get(k) === e.id) {
          this.cellOwner.delete(k);
          releasedTerritory = true;
        }
      }
    }
    if (releasedTerritory) this.territoryRevision++;
    // Dọn đuôi của nạn nhân.
    for (const t of e.trailHexes) {
      if (this.cellTrail.get(t) === e.id) this.cellTrail.delete(t);
    }
    e.owned = new Set();
    e.trailHexes = [];
    e.trailSet = new Set();
    e.trailPoints = [];
    e.phase = "dead";
    e.respawnTimer = e.isBot ? CONFIG.BOT.RESPAWN_DELAY : 0;
    this.revision++;
    this.gridRevision++;
  }

  /** Xoá mọi ô owned/trail của e khỏi bản đồ chia sẻ. */
  private clearOwnership(e: Entity): void {
    for (const k of e.owned) {
      if (this.cellOwner.get(k) === e.id) {
        this.cellOwner.delete(k);
        this.territoryRevision++;
      }
    }
    for (const t of e.trailHexes) {
      if (this.cellTrail.get(t) === e.id) this.cellTrail.delete(t);
    }
  }

  private claimCell(k: HexKey, e: Entity): void {
    const prev = this.cellOwner.get(k);
    if (prev === e.id) return; // đã thuộc e → không có gì đổi (khỏi bump revision)
    if (prev !== undefined) this.players[prev].owned.delete(k);
    this.cellOwner.set(k, e.id);
    e.owned.add(k);
    this.territoryRevision++; // CHỦ ô đổi → vạch ranh có thể phải vẽ lại
  }

  /** Người chơi tự chết (dùng cho test / debug). */
  die(): void {
    this.kill(this.human);
  }

  /** Hồi sinh người chơi. Trả về false nếu không thể (đang sống, phòng bị KING khoá,
   *  hoặc KHÔNG còn ô trống hợp lệ theo SPAWN_CLEARANCE). */
  revive(): boolean {
    if (this.human.phase !== "dead") return false;
    if (this.lost) return false; // [Campaign] hết mạng → không hồi sinh nữa
    if (this.spectating) return false; // đã chọn XEM → chờ hết ván
    if (this.roomLocked()) return false; // phòng có KING → chờ mất ngôi mới vào lại
    return this.spawn(this.human); // false nếu bản đồ đã đầy (không đủ chỗ hợp lệ)
  }

  /** Người chơi có thể hồi sinh ngay bây giờ không? (chưa chọn xem, không bị khoá, còn chỗ). */
  canRevive(): boolean {
    if (this.human.phase !== "dead") return false;
    if (this.lost) return false; // [Campaign] hết mạng → không hồi sinh nữa
    if (this.spectating) return false;
    if (this.roomLocked()) return false;
    return this.pickSpawnHex(this.human) !== null;
  }

  /** Người chơi chọn XEM (khán giả): từ bỏ hồi sinh, chờ đến khi hết ván mới chơi lại. */
  spectate(): void {
    if (this.human.phase === "dead") this.spectating = true;
  }

  /** [ONLINE] Server hồi sinh một GHẾ bất kỳ theo id (khi đang chết & phòng chưa khoá).
   *  Trả false nếu không thể (đang sống, phòng có KING, hoặc hết chỗ hợp lệ). */
  respawn(id: number): boolean {
    const e = this.players[id];
    if (!e || e.phase !== "dead") return false;
    if (this.roomLocked()) return false;
    return this.spawn(e);
  }

  /**
   * Chơi lại từ đầu: xoá sạch bản đồ chia sẻ, đặt lại trạng thái thắng/đếm giữ
   * ngôi, rồi spawn lại toàn bộ thực thể (mỗi thực thể nhận lại cụm 7 ô + vào
   * lại giai đoạn chuẩn bị). Dùng cho nút "CHƠI LẠI" sau khi thắng.
   */
  restart(): void {
    this.cellOwner.clear();
    this.cellTrail.clear();
    this.won = false;
    this.winnerId = -1;
    this.lost = false;
    this.lostId = -1;
    this.kingHolderId = -1;
    this.spectating = false;
    this.kingHoldRemaining = this.config.win.winHoldTime;
    this.surviveRemaining = this.config.win.durationSec ?? Number.POSITIVE_INFINITY;
    for (const e of this.players) {
      e.deaths = 0;
      e.totemsCaptured = 0;
      this.spawn(e);
    }
    this.revision++;
    this.gridRevision++;
  }

  private botRange(): number {
    const { RANGE_MIN, RANGE_MAX } = CONFIG.BOT;
    return RANGE_MIN + this.rng() * (RANGE_MAX - RANGE_MIN);
  }

  /**
   * Chọn ô spawn TUÂN THỦ TUYỆT ĐỐI khoảng cách: tâm đủ sâu trong sân và KHÔNG có ô đất
   * nào của ai trong bán kính `SPAWN_CLEARANCE` (⇒ cụm 7 ô chắc chắn trống, không đè đất
   * đã có). Trả về `null` nếu KHÔNG còn vị trí hợp lệ (bản đồ đã đầy) → không cho hồi sinh.
   * Người chơi có thể dùng `fixedSpawn` (test/deterministic).
   */
  private pickSpawnHex(e: Entity): Axial | null {
    if (e === this.human && this.fixedSpawn) return this.fixedSpawn;
    const inset = (this.config.rules.startRadius + 1) * this.hexSize * Math.sqrt(3);
    const lim = this.arena.wallLimit - inset; // biên lấy mẫu (theo tường va chạm thật đã co wallScale)
    const clearance = this.config.rules.spawnClearance;

    // Không có ĐẤT (owned) của ai trong bán kính `clearance` quanh c. QUÉT ĐĨA hex bán kính
    // `clearance` quanh c (O(clearance²), ĐỘC LẬP với diện tích đã chiếm) thay vì duyệt TOÀN
    // BỘ ô owned (O(owned)) — bản cũ khiến bước quét dự phòng tốn ~29 TRIỆU phép/​lần lúc bản
    // đồ đông ⇒ đơ ~500 ms mỗi lần bot hồi sinh / mỗi 0.2s khi người chơi đang chết.
    const clearAround = (c: Axial): boolean => {
      const cp = axialToPixel(c, this.hexSize);
      if (this.totemItems.some((totem) => {
        const tp = axialToPixel(totem, this.hexSize);
        return Math.hypot(cp.x - tp.x, cp.y - tp.y) < this.config.rules.totems.spawnClearance;
      })) return false;
      for (let dq = -clearance; dq <= clearance; dq++) {
        const lo = Math.max(-clearance, -dq - clearance);
        const hi = Math.min(clearance, -dq + clearance);
        for (let dr = lo; dr <= hi; dr++) {
          if (this.cellOwner.has(keyOf({ q: c.q + dq, r: c.r + dr }))) return false;
        }
      }
      return true;
    };

    // 1) Lấy mẫu điểm ngẫu nhiên (nhanh khi còn nhiều chỗ).
    for (let i = 0; i < 60; i++) {
      const x = (this.rng() * 2 - 1) * lim;
      const y = (this.rng() * 2 - 1) * lim;
      if (!this.arena.insideArena(x, y, -inset)) continue;
      const a = pixelToAxial(x, y, this.hexSize);
      if (this.playable.has(keyOf(a)) && clearAround(a)) return a;
    }
    // BOT: bỏ qua bước quét xác định (tốn) — nếu lấy mẫu ngẫu nhiên trượt thì thôi, chờ lần
    // hồi sinh sau (đằng nào cũng có RESPAWN_DELAY). Chỉ NGƯỜI chơi mới cần câu trả lời chắc
    // chắn "còn chỗ không" (cho nút Hồi sinh) → mới quét toàn bộ.
    if (e.isBot) return null;
    // 2) Quét xác định toàn bộ ô đủ sâu → khẳng định CÒN chỗ hợp lệ hay KHÔNG (null).
    for (const k of this.playable) {
      const a = keyToAxial(k);
      const p = axialToPixel(a, this.hexSize);
      if (this.arena.insideArena(p.x, p.y, -inset) && clearAround(a)) return a;
    }
    return null; // bản đồ đã đầy — không còn vị trí hợp lệ
  }

  // ---- Cập nhật ------------------------------------------------------------
  /** Gọi mỗi frame với dt (giây). */
  update(dt: number): void {
    if (this.won || this.lost) return;
    for (const e of this.players) {
      if (e.isBot && e.phase === "playing") this.botThink(e, dt);
    }
    for (const e of this.players) this.updateEntity(e, dt);
    this.resolveHeadCollisions();
    this.updateStrongholds(); // doc 34 B: cập nhật cứ điểm bị chiếm
    // ONLINE: container (GameRoom) tự quản luật thắng ⇒ bỏ qua checkWin nội bộ (§S4).
    if (!this.externalWinControl) this.checkWin(dt);
  }

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
  private winSubjectId(): number {
    const self = this.players[0];
    if (self && !self.isBot) return self.id;
    return this.kingId();
  }

  private checkWin(dt: number): void {
    // [Campaign] THUA khi hết mạng: chủ thể chết đủ `maxLives` lần (maxLives=0 ⇒ vô hạn, không
    // bao giờ thua — bất biến /play, /netplay). Đánh trước điều kiện thắng để chết-lần-cuối
    // không lỡ khép vòng thắng cùng tick.
    const maxLives = this.config.rules.maxLives;
    if (maxLives > 0 && !this.lost) {
      const lid = this.winSubjectId();
      const loser = lid >= 0 ? this.players[lid] : undefined;
      if (loser && loser.deaths >= maxLives) {
        this.lost = true;
        this.lostId = lid;
        return;
      }
    }

    switch (this.config.win.kind) {
      case "none":
        return; // Luyện tập: không phân định thắng thua.
      case "territory_pct": {
        // Chủ thể đạt targetPct lãnh thổ ⇒ thắng. `targetPct` là PHÂN SỐ 0–1 (trình vẽ/catalog);
        // `pctOf` và `kingPct` tính theo % 0–100 → quy targetPct về % trước khi so.
        const target = this.config.win.targetPct !== undefined
          ? this.config.win.targetPct * 100
          : this.config.win.kingPct;
        const sid = this.winSubjectId();
        if (sid >= 0 && this.pctOf(sid) >= target) {
          this.won = true;
          this.winnerId = sid;
        }
        return;
      }
      case "survive": {
        // Đếm ngược durationSec; hết giờ mà chủ thể CÒN SỐNG ⇒ thắng.
        this.surviveRemaining -= dt;
        if (this.surviveRemaining <= 0) {
          this.surviveRemaining = 0;
          const sid = this.winSubjectId();
          const subject = sid >= 0 ? this.players[sid] : undefined;
          if (subject && subject.alive) {
            this.won = true;
            this.winnerId = sid;
          }
        }
        return;
      }
      case "capture_totems": {
        // Chủ thể thu đủ totemGoal Totem (đếm cộng dồn trong ván) ⇒ thắng.
        this.reconcileTotems(); // đảm bảo counter cập nhật theo territory revision hiện tại
        const goal = this.config.win.totemGoal ?? 0;
        const sid = this.winSubjectId();
        const subject = sid >= 0 ? this.players[sid] : undefined;
        if (subject && goal > 0 && subject.totemsCaptured >= goal) {
          this.won = true;
          this.winnerId = sid;
        }
        return;
      }
    }

    // king_hold (mặc định) — (a) đấu loại + (b) giữ ngôi.
    // (a) Đấu loại: chỉ còn 1 người sống trong phòng đã có KING → thắng NGAY.
    if (this.players.length > 1 && this.roomLocked()) {
      const aliveList = this.players.filter((e) => e.alive);
      if (aliveList.length === 1) {
        this.won = true;
        this.winnerId = aliveList[0].id;
        return;
      }
    }

    // (b) Giữ ngôi: cùng một KING giữ liên tục → đếm ngược; đổi/​mất King → reset.
    const kid = this.kingId();
    if (kid !== -1) {
      if (kid === this.kingHolderId) {
        this.kingHoldRemaining -= dt;
        if (this.kingHoldRemaining <= 0) {
          this.kingHoldRemaining = 0;
          this.won = true;
          this.winnerId = kid;
        }
      } else {
        this.kingHolderId = kid;
        this.kingHoldRemaining = this.config.win.winHoldTime;
      }
    } else {
      this.kingHolderId = -1;
      this.kingHoldRemaining = this.config.win.winHoldTime;
    }
  }

  private updateEntity(e: Entity, dt: number): void {
    if (e.phase === "dead") {
      // Phòng bị KING khoá → bot nằm chờ (không hồi sinh) cho tới khi mất ngôi.
      if (e.isBot && !this.roomLocked() && this.botCanRespawn(e) && e.respawnTimer > 0) {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) this.spawn(e);
      }
      return;
    }

    // Quay đầu mượt về targetHeading (cả khi chuẩn bị). Bot dùng TURN_RATE RIÊNG (tách
    // khỏi người chơi) để nhanh nhẹn hơn mà không đổi cảm giác lái của người.
    const maxTurn = (e.isBot ? this.config.rules.botTurnRate : this.config.rules.turnRate) * dt;
    let diff = normalizeAngle(e.targetHeading - e.heading);
    if (diff > maxTurn) diff = maxTurn;
    else if (diff < -maxTurn) diff = -maxTurn;
    e.heading += diff;

    if (e.phase === "prep") {
      e.prepRemaining -= dt;
      if (e.prepRemaining <= 0) {
        e.prepRemaining = 0;
        e.phase = "playing";
      }
      this.revision++;
      return;
    }

    const dist = this.effectiveSpeedFor(e.id) * dt;

    // Va chạm tường: dịch theo hướng nhìn rồi TRƯỢT dọc biên ở TỐC ĐỘ ĐẦY ĐỦ (slideMove).
    // Không sinh vận tốc LÙI (tránh đầu bị đẩy ngược vào ô đuôi của chính mình → chết oan).
    let c: { x: number; y: number } = this.arena.slideMove(e.pos.x, e.pos.y, e.heading, dist);
    // Chướng ngại (tường NỘI BỘ): TRƯỢT dọc mặt hex thay vì kẹt cứng — bỏ thành phần pháp tuyến
    // (hướng đi VÀO obstacle), giữ tiếp tuyến. Đâm thẳng vào góc lõm không có hướng thoát → đứng.
    if (this.obstacles.size > 0) {
      const slid = this.slideAlongObstacles(e.pos.x, e.pos.y, c.x, c.y);
      if (!slid) return;
      c = slid;
    }
    // Tường BIÊN admin vẽ (doc 34 D) — trượt dọc, không băng qua.
    if (this.boundarySegs.length > 0) c = this.slideAlongBoundaries(e.pos.x, e.pos.y, c.x, c.y);
    const mdx = c.x - e.pos.x;
    const mdy = c.y - e.pos.y;
    const moved = Math.hypot(mdx, mdy);
    if (moved > 1e-7) {
      // slideMove KHÔNG bao giờ sinh vận tốc LÙI (chỉ tiến/trượt tiếp tuyến) → an toàn bước
      // thẳng: nếu ô đích đúng là đuôi CỦA CHÍNH MÌNH thì đó là tự cắt đuôi THẬT (enterHex
      // xử lý chết), không còn phải chặn "chết oan" như thời clamp đẩy lùi.
      this.stepEntity(e, c.x, c.y);
      // Xoay đầu theo hướng DI CHUYỂN THỰC (trượt dọc tường); xa tường thì trùng heading.
      e.heading = Math.atan2(mdy, mdx);
    }
  }

  /** Điểm `(x,y)` có nằm trong HỘP CHỮ NHẬT (AABB) của một ô obstacle nào không (doc 33). AABB
   *  bao trọn ô lục thẳng đứng: nửa rộng = √3/2·size, nửa cao = size. Chỉ xét ô của điểm + 6 ô kề
   *  (AABB không vươn xa hơn) → O(1). */
  private insideObstacleRect(x: number, y: number): boolean {
    const size = this.hexSize;
    const halfW = (Math.sqrt(3) / 2) * size;
    const halfH = size;
    const base = pixelToAxial(x, y, size);
    for (const cand of [base, ...neighbors(base)]) {
      if (!this.obstacles.has(keyOf(cand))) continue;
      const c = axialToPixel(cand, size);
      if (Math.abs(x - c.x) <= halfW && Math.abs(y - c.y) <= halfH) return true;
    }
    return false;
  }

  /**
   * Va chạm chướng ngại — chọn theo `map.colliderShape` (doc 33):
   * - `"hex"` (MẶC ĐỊNH): biên ĐA GIÁC theo mặt lục giác — góc lồi 120° (>90°) nên KHÔNG kẹt
   *   như hộp chữ nhật. Trượt = bỏ thành phần pháp tuyến của mặt BIÊN gần nhất, lặp cho góc.
   * - `"rect"`: AABB bao ô, giải theo từng trục (giữ như tuỳ chọn).
   * Trả điểm đã giải (đã clamp về trong sân), hoặc `null` khi hoàn toàn không bước được.
   */
  private slideAlongObstacles(px: number, py: number, cx: number, cy: number): { x: number; y: number } | null {
    if (this.config.map.colliderShape === "rect") return this.slideRectObstacles(px, py, cx, cy);
    return this.slidePolyObstacles(px, py, cx, cy);
  }

  /** RECT/AABB — giải theo từng trục (x rồi y). */
  private slideRectObstacles(px: number, py: number, cx: number, cy: number): { x: number; y: number } {
    if (!this.insideObstacleRect(cx, cy)) { const i = this.arena.clampInside(cx, cy); return { x: i.x, y: i.y }; }
    const dx = cx - px, dy = cy - py;
    const nx = this.insideObstacleRect(px + dx, py) ? px : px + dx;
    const ny = this.insideObstacleRect(nx, py + dy) ? py : py + dy;
    const inside = this.arena.clampInside(nx, ny);
    return { x: inside.x, y: inside.y };
  }

  /**
   * ĐA GIÁC hex (mặc định): trượt dọc mặt biên của ô obstacle. Bỏ thành phần vận tốc theo pháp
   * tuyến mặt BIÊN gần điểm đích nhất (giữ tiếp tuyến ở tốc độ đầy đủ), lặp tối đa 3 lần cho góc
   * lõm. Còn dính (residual/góc) → đẩy VUÔNG GÓC ra ngoài mặt gần nhất (giữ vị trí tiếp tuyến).
   * Góc lồi của biên là 120° nên không tạo bẫy như góc vuông 90° của hộp chữ nhật.
   */
  private slidePolyObstacles(px: number, py: number, cx: number, cy: number): { x: number; y: number } | null {
    const size = this.hexSize;
    let vx = cx - px, vy = cy - py;
    for (let iter = 0; iter < 3; iter++) {
      const face = this.nearestObstacleFace(px + vx, py + vy);
      if (!face) break;                        // đích không còn trong obstacle (hoặc ô nội bộ)
      const f = HEX_FACES[face.i];
      const vn = vx * f.nx + vy * f.ny;
      if (vn >= 0) break;                       // đang đi RA khỏi mặt gần nhất → thôi
      vx -= vn * f.nx; vy -= vn * f.ny;         // bỏ phần đi VÀO → trượt dọc mặt
    }
    let x = px + vx, y = py + vy;
    if (this.obstacles.has(keyOf(pixelToAxial(x, y, size)))) {
      const face = this.nearestObstacleFace(x, y);
      if (!face) return null;                   // ô nội bộ đặc → chặn
      const f = HEX_FACES[face.i];
      const pen = (x - face.mx) * f.nx + (y - face.my) * f.ny; // <0 = đang trong sân obstacle
      x += (1e-3 - pen) * f.nx; y += (1e-3 - pen) * f.ny;      // đẩy vuông góc ra ngoài mặt
      if (this.obstacles.has(keyOf(pixelToAxial(x, y, size)))) return null;
    }
    const inside = this.arena.clampInside(x, y);
    return { x: inside.x, y: inside.y };
  }

  /** [doc 34 D] TRƯỢT dọc tường BIÊN admin vẽ: nếu bước `pos→c` cắt một đoạn biên, bỏ thành phần
   *  vận tốc đi XUYÊN đoạn (giữ tiếp tuyến) → trượt dọc tường, không băng qua. Lặp cho nhiều đoạn. */
  private slideAlongBoundaries(px: number, py: number, cx: number, cy: number): { x: number; y: number } {
    if (this.boundarySegs.length === 0) return { x: cx, y: cy };
    let vx = cx - px, vy = cy - py;
    for (let iter = 0; iter < 3; iter++) {
      let hit = false;
      for (const s of this.boundarySegs) {
        if (!segmentsCross(px, py, px + vx, py + vy, s.ax, s.ay, s.bx, s.by)) continue;
        let nx = -(s.by - s.ay), ny = s.bx - s.ax; // pháp tuyến đoạn
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if ((px - s.ax) * nx + (py - s.ay) * ny < 0) { nx = -nx; ny = -ny; } // hướng RA phía pos
        const vn = vx * nx + vy * ny;
        if (vn < 0) { vx -= vn * nx; vy -= vn * ny; hit = true; } // bỏ phần đi XUYÊN tường
      }
      if (!hit) break;
    }
    return { x: px + vx, y: py + vy };
  }

  /** Nếu `(x,y)` nằm TRONG một ô obstacle CÓ mặt biên: trả mặt biên (giáp ô mở) GẦN NHẤT + tâm
   *  mặt `(mx,my)`. Không trong obstacle, hoặc ô nội bộ đặc (không mặt biên) → `null`. */
  private nearestObstacleFace(x: number, y: number): { i: number; mx: number; my: number } | null {
    const size = this.hexSize;
    const hex = pixelToAxial(x, y, size);
    if (!this.obstacles.has(keyOf(hex))) return null;
    const inr = (Math.sqrt(3) / 2) * size, half = size / 2;
    const oc = axialToPixel(hex, size);
    let bi = -1, bd = Infinity, bmx = 0, bmy = 0;
    for (let i = 0; i < 6; i++) {
      const nb = { q: hex.q + DIRECTIONS[i].q, r: hex.r + DIRECTIONS[i].r };
      if (this.obstacles.has(keyOf(nb))) continue; // mặt nội bộ (giữa 2 obstacle)
      const f = HEX_FACES[i];
      const mx = oc.x + f.nx * inr, my = oc.y + f.ny * inr;
      let t = (x - mx) * f.tx + (y - my) * f.ty;
      if (t > half) t = half; else if (t < -half) t = -half;
      const qx = mx + f.tx * t, qy = my + f.ty * t;
      const d2 = (x - qx) ** 2 + (y - qy) ** 2;
      if (d2 < bd) { bd = d2; bi = i; bmx = mx; bmy = my; }
    }
    return bi < 0 ? null : { i: bi, mx: bmx, my: bmy };
  }

  /** API cho test: di chuyển người chơi tới (x,y) nếu ô đích hợp lệ (không phải chướng ngại). */
  moveTo(x: number, y: number): void {
    if (!this.inMap(x, y)) return;
    if (this.obstacles.has(keyOf(pixelToAxial(x, y, this.hexSize)))) return;
    this.stepEntity(this.human, x, y);
  }

  private stepEntity(e: Entity, x: number, y: number): void {
    const nextHex = pixelToAxial(x, y, this.hexSize);
    e.pos.x = x;
    e.pos.y = y;

    if (nextHex.q !== e.currentHex.q || nextHex.r !== e.currentHex.r) {
      const line = hexLinedraw(e.currentHex, nextHex);
      for (let i = 1; i < line.length; i++) {
        if (this.enterHex(e, line[i])) break; // true = e chết → dừng
      }
      e.currentHex = nextHex;
      this.revision++;
    }

    if (e.trailHexes.length > 0) {
      const pts = e.trailPoints;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) >= this.config.rules.trailPointDist) {
        // Điểm neo đầu đã nằm tại đầu nhân vật (trong ô trung lập đầu tiên) → các điểm
        // sau luôn tiến theo hướng đi, không cần chặn "đi ngược".
        pts.push({ x, y });
        this.revision++;
      }
    }
  }

  /** Xử lý khi đầu e bước vào ô mới. Trả về true nếu e chết. */
  private enterHex(e: Entity, h: Axial): boolean {
    const hk = keyOf(h);

    // Hai đầu cùng nằm trên MỘT ô trung lập phải được phân xử TRƯỚC va chạm với đuôi. Nếu không,
    // entity được update sau có thể cắt đuôi entity kia trước khi resolveHeadCollisions()
    // chạy, biến một va chạm hòa thành kết quả một sống/một chết phụ thuộc thứ tự update.
    if (this.resolveNeutralSameHex(e)) return true;

    // 1. Bước lên 1 ô ĐUÔI — xét TRƯỚC cả đất của mình: đâm đuôi đối thủ ở BẤT KỲ ô nào
    //    (kể cả khi ô đó nằm trong lãnh thổ của mình) đều khiến đối thủ chết.
    const trailOwner = this.cellTrail.get(hk);
    if (trailOwner !== undefined) {
      if (trailOwner === e.id) {
        // MIỄN tự-cắt cho vài ô đuôi MỚI NHẤT (sát đầu): tránh chết oan khi làm tròn hex
        // dao động lúc đi dọc đúng ranh giới cột hex / men theo tường (đầu bật qua-lại
        // giữa 2 ô kề). Cắt vào đoạn đuôi CŨ hơn → vẫn tự cắt đuôi = chết.
        const tail = e.trailHexes;
        const graceFrom = Math.max(0, tail.length - this.config.rules.selfTrailGrace);
        for (let i = graceFrom; i < tail.length; i++) {
          if (tail[i] === hk) return false; // ô đuôi sát đầu → bỏ qua, không chết
        }
        this.kill(e, undefined, "self"); // tự cắt đuôi (đoạn cũ) → chết
        return true;
      }
      // Cắt đuôi đối thủ → đối thủ chết & MẤT ĐẤT về tay e; kill() dọn cellTrail của họ.
      // Bot đồng minh (doc 34 B): KHÔNG cắt đuôi nhau.
      if (!this.allied(e, this.players[trailOwner])) this.kill(this.players[trailOwner], e, "cut");
    }

    // 2. Về lãnh thổ của mình (hoặc ĐỒNG ĐỘI — ô chung) → khép vòng, chiếm đất. Đi trên ô đội ⇒
    //    KHÔNG thêm đuôi (bot đồng đội không hiện đuôi trên ô chung — doc 34).
    if (this.teamOwns(hk, e)) {
      if (e.trailHexes.length > 0) this.captureFor(e);
      return false;
    }

    // 3. Ô trung lập / đất đối thủ → thêm vào đuôi (barrier).
    if (e.trailHexes.length === 0) {
      // Đường line bắt đầu NGAY tại vị trí đầu nhân vật (không kéo về tâm ô) MIỄN là đầu
      // đang thực sự nằm TRONG ô trung lập đầu tiên h — đúng với di chuyển liên tục
      // thường thấy. Chỉ khi một bước nhảy qua nhiều ô (đầu đã ở ô xa hơn) mới lùi về
      // tâm h để điểm neo luôn nằm trong ô trung lập đầu tiên, không thò ngược vào đất.
      const a = pixelToAxial(e.pos.x, e.pos.y, this.hexSize);
      if (a.q === h.q && a.r === h.r) {
        e.trailPoints = [{ x: e.pos.x, y: e.pos.y }];
      } else {
        const p = axialToPixel(h, this.hexSize);
        e.trailPoints = [{ x: p.x, y: p.y }];
      }
    }
    e.trailHexes.push(hk);
    e.trailSet.add(hk);
    this.cellTrail.set(hk, e.id);
    this.gridRevision++;
    return false;
  }

  private captureFor(e: Entity): void {
    const captured = captureEnclosed(this.map, e.owned, e.trailHexes, this.obstacles);
    // Gán mọi ô chiếm được cho e (cướp khỏi đối thủ nếu nằm trong vòng).
    for (const k of captured) this.claimCell(k, e);
    // Dọn đuôi.
    for (const t of e.trailHexes) {
      if (this.cellTrail.get(t) === e.id) this.cellTrail.delete(t);
    }
    e.trailHexes = [];
    e.trailSet = new Set();
    e.trailPoints = [];
    this.gridRevision++;
  }

  // ---- Va chạm đầu ---------------------------------------------------------
  /**
   * Xử lý ngay một cụm đầu cùng nằm trên một ô trung lập. Không dùng khoảng cách vật lý:
   * chỉ cần pixelToAxial của các đầu cho ra cùng HexKey thì toàn bộ cụm chết đồng thời.
   */
  private resolveNeutralSameHex(trigger: Entity): boolean {
    if (trigger.phase !== "playing") return false;
    const triggerKey = keyOf(pixelToAxial(trigger.pos.x, trigger.pos.y, this.hexSize));
    if (this.cellOwner.has(triggerKey)) return false;

    const victims: Entity[] = [trigger];
    for (const other of this.players) {
      if (other === trigger || other.phase !== "playing") continue;
      const otherKey = keyOf(pixelToAxial(other.pos.x, other.pos.y, this.hexSize));
      if (otherKey === triggerKey) victims.push(other);
    }
    if (victims.length < 2) return false;

    // Chỉ chết nếu trong nhóm có kẻ KHÔNG đồng minh (bot đồng minh chồng ô nhau không sao — doc 34 B).
    let any = false;
    for (const victim of victims) {
      if (victims.some((o) => o !== victim && !this.allied(victim, o))) { this.kill(victim, undefined, "headMutual"); any = true; }
    }
    return any;
  }

  /** Chủ đất hạ KẺ XÂM NHẬP: nếu đầu đối thủ b đang đứng trên ĐẤT của a và sát đầu a
   *  (≤ KILL_RADIUS) → b chết. Chủ đất bất khả xâm phạm trên sân nhà. */
  private resolveHeadCollisions(): void {
    const R = this.config.rules.killRadius;
    const R2 = R * R;

    // Luật ô trung lập là luật theo GRID, không phải collider: nhóm tất cả đầu theo HexKey
    // hiện tại rồi loại đồng thời mọi nhóm có từ hai người trở lên trên cùng ô trung lập.
    const neutralGroups = new Map<HexKey, Entity[]>();
    for (const e of this.players) {
      if (e.phase !== "playing") continue;
      const hk = keyOf(pixelToAxial(e.pos.x, e.pos.y, this.hexSize));
      if (this.cellOwner.has(hk)) continue;
      const group = neutralGroups.get(hk);
      if (group) group.push(e);
      else neutralGroups.set(hk, [e]);
    }
    for (const group of neutralGroups.values()) {
      if (group.length < 2) continue;
      for (const victim of group) {
        if (group.some((o) => o !== victim && !this.allied(victim, o))) this.kill(victim, undefined, "headMutual");
      }
    }

    // BROAD-PHASE (spatial hash): đưa đầu mọi thực thể đang chơi vào hash, lấy các CẶP
    // ứng viên cách nhau ≤ KILL_RADIUS thay vì quét O(n²). Với cellSize = KILL_RADIUS
    // mọi cặp trong tầm chắc chắn được sinh ra.
    const hash = this.headHash;
    hash.clear();
    for (const e of this.players) {
      if (e.phase === "playing")
        hash.insert({ id: e.id, x: e.pos.x, y: e.pos.y });
    }
    // Gom cặp (i<j) rồi SẮP XẾP để xử lý theo thứ tự TẤT ĐỊNH như bản quét lồng cũ.
    const pairs: [number, number][] = [];
    hash.forEachPair(R, (a, b) => {
      pairs.push([Math.min(a.id, b.id), Math.max(a.id, b.id)]);
    });
    pairs.sort((p, q) => p[0] - q[0] || p[1] - q[1]);

    // NARROW-PHASE: kiểm tra lại khoảng cách + phase (một thực thể có thể đã chết ở cặp
    // trước) rồi phân xử — logic y hệt trước đây.
    for (const [i, j] of pairs) {
      const a = this.players[i];
      const b = this.players[j];
      if (a.phase !== "playing" || b.phase !== "playing") continue;
      if (this.allied(a, b)) continue; // bot đồng minh — bỏ mọi sát thương đầu-đầu/xâm nhập (doc 34 B)
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      if (dx * dx + dy * dy > R2) continue;

      const aCell = this.cellOwner.get(keyOf(a.currentHex));
      const bCell = this.cellOwner.get(keyOf(b.currentHex));
      const bOnA = bCell === a.id; // b đang trên đất của a
      const aOnB = aCell === b.id; // a đang trên đất của b

      if (bOnA && aOnB) {
        // Xâm nhập lẫn nhau → cả hai chết (đất về trung lập).
        this.kill(a, undefined, "headMutual");
        this.kill(b, undefined, "headMutual");
      } else if (bOnA) {
        this.kill(b, a, "headIntruder"); // b xâm nhập sân nhà a → b chết, đất về a
      } else if (aOnB) {
        this.kill(a, b, "headIntruder");
      } else if (
        aCell !== undefined &&
        bCell !== undefined &&
        aCell !== a.id &&
        bCell !== b.id
      ) {
        // Cả hai ở trên đất bên thứ ba vẫn dùng collider cũ. Va chạm trên ô trung lập đã
        // được xử lý riêng hoàn toàn theo HexKey ở đầu hàm, không xét khoảng cách vật lý.
        this.kill(a, undefined, "headMutual");
        this.kill(b, undefined, "headMutual");
      }
    }
  }

  // ---- AI bot (FSM: EXPAND / RETURN / HUNT / FLEE) -------------------------
  /** Đối thủ CÒN SỐNG gần e nhất trong bán kính r; onlyOutside=chỉ tính kẻ đang ở ngoài
   *  (đang có đuôi → có thể săn / là mối đe doạ). */
  private nearestEntity(e: Entity, r: number, onlyOutside: boolean): Entity | null {
    let best: Entity | null = null;
    let bestD = r * r;
    for (const o of this.players) {
      if (o === e || o.phase !== "playing") continue;
      if (onlyOutside && o.trailHexes.length === 0) continue;
      const dx = o.pos.x - e.pos.x;
      const dy = o.pos.y - e.pos.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Điểm trên đuôi của prey gần `from` nhất (để nhắm cắt). */
  private nearestTrailPoint(prey: Entity, from: Vec2): Vec2 | null {
    let best: Vec2 | null = null;
    let bestD = Infinity;
    for (const p of prey.trailPoints) {
      const dx = p.x - from.x;
      const dy = p.y - from.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Ô ngay phía trước (theo `heading`, cách `dist`) có bị chặn không: ra ngoài sân, hoặc
   *  là ĐUÔI CỦA CHÍNH e (đâm vào = tự sát). */
  private aheadBlocked(e: Entity, heading: number, dist: number): boolean {
    const x = e.pos.x + Math.cos(heading) * dist;
    const y = e.pos.y + Math.sin(heading) * dist;
    if (!this.arena.insideArena(x, y, 0.25)) return true;
    const hk = keyOf(pixelToAxial(x, y, this.hexSize));
    return this.cellTrail.get(hk) === e.id;
  }

  /** Chọn hướng gần `desired` nhất mà phía trước KHÔNG bị chặn (né đuôi mình + tường).
   *  Bot kỹ năng cao nhìn xa hơn và quét nhiều hướng hơn. */
  private steerAvoiding(e: Entity, desired: number, skill: number): number {
    // CHẶN chi phí: skill lớn (hồ sơ "Khó" đặt cao) từng làm dist vượt xa bán kính sân →
    // điểm quét luôn NGOÀI sân ⇒ né vô nghĩa mà vẫn lặp cả nghìn lần/​bot/​tick ⇒ tốn CPU
    // khi đông bot. Kẹp dist ≤ ~1/3 sân và maxK ≤ 18 (đủ quét ±180° ở bước 0.35 rad).
    const sk = Math.min(Math.max(skill, 0), 1.5);
    const dist = Math.min(CONFIG.BOT.AVOID_DIST * (0.7 + sk * 0.8), this.arena.arenaR * 0.33);
    if (!this.aheadBlocked(e, desired, dist)) return desired;
    const step = 0.35;
    const maxK = Math.min(18, Math.round(3 + sk * 6));
    for (let k = 1; k <= maxK; k++) {
      for (const s of [1, -1]) {
        const hd = desired + s * step * k;
        if (!this.aheadBlocked(e, hd, dist)) return hd;
      }
    }
    return desired; // bí lối → giữ hướng (wall-slide sẽ xử lý ở updateEntity)
  }

  private botThink(e: Entity, dt: number): void {
    const prof =
      CONFIG.BOT_DIFFICULTY[e.botProfile] ?? CONFIG.BOT_DIFFICULTY[0];
    const homeDist = Math.hypot(e.pos.x - e.home.x, e.pos.y - e.home.y);
    const outside = e.trailHexes.length > 0;
    e.botDecisionTimer -= dt;
    // Giữ chuyển động/va chạm ở nhịp render nhưng giới hạn phần AI tốn CPU (quét đối thủ,
    // quét đuôi và né chướng ngại) ở tối đa 20 Hz. 20 bot không còn chạy khối này mỗi frame.
    if (e.botDecisionTimer > 0) return;
    e.botDecisionTimer = Math.max(prof.reaction, CONFIG.BOT.THINK_INTERVAL_MIN);

    // FLEE tức thời: đang ở ngoài (dễ tổn thương) mà có đối thủ áp sát → rút lui.
    if (outside && this.nearestEntity(e, prof.vision * 0.55, false)) {
      e.botState = "flee";
    }

    // Ra quyết định định kỳ (nhịp theo reaction; bot giỏi phản ứng nhanh hơn).
    if (e.botState === "flee") {
      if (!outside) e.botState = "expand"; // đã về đất an toàn
    } else {
      const prey = this.nearestEntity(e, prof.vision, true);
      if (prey && this.rng() < prof.aggression) {
        e.botState = "hunt";
        e.huntId = prey.id;
      } else if (e.botState === "hunt") {
        e.botState = "expand"; // hết mục tiêu / không còn máu liều → bành trướng lại
      }
    }

    // Thực thi theo trạng thái → tính hướng mong muốn.
    let desired = e.botOutHeading;
    switch (e.botState) {
      case "flee": {
        desired = Math.atan2(e.home.y - e.pos.y, e.home.x - e.pos.x);
        if (!outside) {
          e.botState = "expand";
          e.botOutHeading = this.rng() * Math.PI * 2;
          e.botRange = this.botRange();
        }
        break;
      }
      case "hunt": {
        const prey = this.players[e.huntId];
        if (!prey || prey.phase !== "playing" || prey.trailHexes.length === 0) {
          e.botState = "expand";
          e.botOutHeading = e.heading;
          desired = e.heading;
          break;
        }
        const t = this.nearestTrailPoint(prey, e.pos) ?? prey.pos;
        desired = Math.atan2(t.y - e.pos.y, t.x - e.pos.x);
        // Săn quá xa nhà (đang mang đuôi) → thôi, rút về khép vòng cho an toàn.
        if (outside && homeDist > e.botRange * 1.6) e.botState = "return";
        break;
      }
      case "return": {
        desired = Math.atan2(e.home.y - e.pos.y, e.home.x - e.pos.x);
        if (!outside) {
          e.botState = "expand";
          e.botOutHeading = this.rng() * Math.PI * 2;
          e.botRange = this.botRange();
        }
        break;
      }
      case "expand":
      default: {
        if (outside && homeDist > e.botRange) {
          e.botState = "return";
          desired = Math.atan2(e.home.y - e.pos.y, e.home.x - e.pos.x);
          break;
        }
        e.botOutHeading += (this.rng() - 0.5) * CONFIG.BOT.WANDER;
        desired = e.botOutHeading;
        break;
      }
    }

    // Né đuôi mình + tường theo kỹ năng, rồi chốt hướng.
    e.targetHeading = this.steerAvoiding(e, desired, prof.skill);
  }
}

function keyToAxial(k: HexKey): Axial {
  const i = k.indexOf(",");
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

/** Đưa góc về khoảng (-π, π]. */
function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}
