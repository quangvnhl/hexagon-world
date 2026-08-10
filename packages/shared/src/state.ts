import { CONFIG, COLORS, PLAYER_COLORS, PlayerColor } from "./config";
import {
  Axial,
  HexKey,
  keyOf,
  cubeDistance,
  axialToPixel,
  pixelToAxial,
  hexLinedraw,
} from "./hex";
import {
  ARENA_INRADIUS,
  insideArena,
  clampInside,
  mapArena,
} from "./arena";
import { captureEnclosed } from "./floodfill";
import { SpatialHash } from "./spatialhash";
import type { EntitySnap, TerritoryCell } from "./protocol";

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
  readonly color: PlayerColor;

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

  constructor(id: number, isBot: boolean, color: PlayerColor) {
    this.id = id;
    this.isBot = isBot;
    this.color = color;
  }

  get alive(): boolean {
    return this.phase !== "dead";
  }
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

  readonly players: Entity[];
  /** Số ghế NGƯỜI (không phải bot): players[0..humanCount-1]. Mặc định 1 (single-player).
   *  Server multiplayer đặt >1 và gán mỗi kết nối vào một ghế người. */
  readonly humanCount: number;

  /** Chủ sở hữu / chủ đuôi của từng ô (id thực thể) — cho render nhanh & va chạm. */
  private cellOwner: Map<HexKey, number> = new Map();
  private cellTrail: Map<HexKey, number> = new Map();
  /** Broad-phase va chạm đầu (spatial hash theo toạ độ liên tục). */
  private headHash = new SpatialHash<{ id: number; x: number; y: number }>(
    CONFIG.KILL_RADIUS
  );

  private fixedSpawn?: Axial;
  private rng: () => number = Math.random;

  /** Tăng khi thực thể đổi (vị trí/đuôi) — cho renderer cube/line. */
  revision = 0;
  /** Tăng khi lưới cần tô lại (owned hoặc trail hex đổi). */
  gridRevision = 0;

  /** Thời gian (giây) còn lại phải giữ ngôi King liên tục để thắng. */
  kingHoldRemaining: number = CONFIG.WIN_HOLD_TIME;
  /** Đã kết thúc chưa (có người thắng) → đóng băng game. */
  won = false;
  /** Id người thắng (-1 nếu chưa). */
  winnerId = -1;
  /** Id KING đang được tính giờ giữ ngôi (đổi King → reset đồng hồ). */
  private kingHolderId = -1;
  /** Người chơi đã chọn XEM (khán giả): không hồi sinh nữa tới khi hết ván. */
  spectating = false;

  constructor(
    spawnAt?: Axial,
    botCount: number = CONFIG.BOT_COUNT,
    humanCount = 1
  ) {
    this.fixedSpawn = spawnAt;
    this.humanCount = Math.max(1, humanCount);
    this.map = mapArena(CONFIG.MAP_MARGIN);
    this.playable = new Set();
    for (const k of this.map) {
      const p = axialToPixel(keyToAxial(k), CONFIG.HEX_SIZE);
      if (insideArena(p.x, p.y, 0)) this.playable.add(k);
    }

    const n = this.humanCount + Math.max(0, botCount);
    this.players = [];
    for (let i = 0; i < n; i++) {
      const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
      const isBot = i >= this.humanCount;
      const e = new Entity(i, isBot, color);
      // Gán độ khó luân phiên cho các bot (dễ / thường / khó / …).
      if (isBot) e.botProfile = (i - this.humanCount) % CONFIG.BOT_DIFFICULTY.length;
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
    e.currentHex = pixelToAxial(x, y, CONFIG.HEX_SIZE);
    // ĐUÔI MƯỢT: tích luỹ ĐÚNG đường ĐẦU đã đi qua (giống chơi đơn) — KHÔNG bám tâm ô lục
    // giác. Khi thực thể đang có đuôi (hasTrail) → thêm điểm tại vị trí đầu hiện tại (đầu
    // đã dự đoán/nội suy nên mượt), giãn cách theo TRAIL_POINT_DIST. Khi hết đuôi (khép
    // vòng chiếm đất / chết) → xoá đường. Ô đuôi TÔ MÀU vẫn dựng từ keyframe TERRITORY.
    if (alive && hasTrail) {
      const pts = e.trailPoints;
      const last = pts.length > 0 ? pts[pts.length - 1] : null;
      if (!last || Math.hypot(x - last.x, y - last.y) >= CONFIG.TRAIL_POINT_DIST) {
        pts.push({ x, y });
      }
    } else if (e.trailPoints.length > 0) {
      e.trailPoints = [];
    }
    this.revision++;
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
    return this.players.map((e) => ({
      id: e.id,
      alive: e.alive,
      hasTrail: e.trailHexes.length > 0,
      colorIndex: e.id % PLAYER_COLORS.length,
      x: e.pos.x,
      y: e.pos.y,
      heading: e.heading,
      score: this.ownedPlayable(e),
    }));
  }

  hasTrail(k: HexKey): boolean {
    return this.cellTrail.has(k);
  }

  /** Số ô người chơi đang sở hữu / tổng ô chơi được (%). */
  territoryPct(): number {
    return (this.ownedPlayable(this.human) / this.playable.size) * 100;
  }

  get isKing(): boolean {
    return this.territoryPct() >= CONFIG.KING_PCT;
  }

  /** Id KING hiện tại: thực thể CÒN SỐNG có % cao nhất và ≥ KING_PCT; -1 nếu không có. */
  kingId(): number {
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
    return max >= CONFIG.KING_PCT ? id : -1;
  }

  /** Phòng bị KHOÁ khi đã có KING: không cho ai hồi sinh/tham gia (người còn sống thì
   *  đối kháng với nhau). Hết King → mở lại. */
  roomLocked(): boolean {
    return this.kingId() !== -1;
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

  /** % lãnh thổ của mọi thực thể (cho bảng xếp hạng). */
  scores(): { id: number; name: string; pct: number; alive: boolean }[] {
    return this.players.map((e) => ({
      id: e.id,
      name: e.name || e.color.name,
      pct: (this.ownedPlayable(e) / this.playable.size) * 100,
      alive: e.alive,
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

  /** Màu RGB của 1 ô để render lưới. */
  cellColor(k: HexKey): [number, number, number] {
    const tid = this.cellTrail.get(k);
    if (tid !== undefined) return this.players[tid].color.trail;
    const oid = this.cellOwner.get(k);
    if (oid !== undefined) return this.players[oid].color.owned;
    return COLORS.neutral;
  }

  /** Duyệt các ô ĐẤT (owned) kèm id chủ sở hữu — cho minimap & vạch ranh giới. */
  forEachOwned(cb: (k: HexKey, ownerId: number) => void): void {
    for (const [k, oid] of this.cellOwner) cb(k, oid);
  }

  private inMap(x: number, y: number): boolean {
    return this.map.has(keyOf(pixelToAxial(x, y, CONFIG.HEX_SIZE)));
  }

  // ---- Vòng đời thực thể ---------------------------------------------------
  /** Spawn e nếu CÒN vị trí hợp lệ (cách mọi lãnh thổ ≥ SPAWN_CLEARANCE, không đè đất
   *  đã có). Trả về false nếu KHÔNG đủ chỗ → e nằm chờ (dead) chứ không spawn. */
  private spawn(e: Entity): boolean {
    const spawnHex = this.pickSpawnHex(e);
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
    e.prepRemaining = CONFIG.PREP_TIME;
    e.respawnTimer = 0;
    e.deathCause = "";
    e.killerId = -1;

    e.currentHex = spawnHex;
    const p = axialToPixel(spawnHex, CONFIG.HEX_SIZE);
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
    const R = CONFIG.START_RADIUS;
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
    if (killer && killer !== e && killer.alive) {
      // Cướp toàn bộ đất của nạn nhân cho kẻ đã hạ.
      for (const k of [...e.owned]) this.claimCell(k, killer);
    } else {
      for (const k of e.owned) {
        if (this.cellOwner.get(k) === e.id) this.cellOwner.delete(k);
      }
    }
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
      if (this.cellOwner.get(k) === e.id) this.cellOwner.delete(k);
    }
    for (const t of e.trailHexes) {
      if (this.cellTrail.get(t) === e.id) this.cellTrail.delete(t);
    }
  }

  private claimCell(k: HexKey, e: Entity): void {
    const prev = this.cellOwner.get(k);
    if (prev !== undefined && prev !== e.id) this.players[prev].owned.delete(k);
    this.cellOwner.set(k, e.id);
    e.owned.add(k);
  }

  /** Người chơi tự chết (dùng cho test / debug). */
  die(): void {
    this.kill(this.human);
  }

  /** Hồi sinh người chơi. Trả về false nếu không thể (đang sống, phòng bị KING khoá,
   *  hoặc KHÔNG còn ô trống hợp lệ theo SPAWN_CLEARANCE). */
  revive(): boolean {
    if (this.human.phase !== "dead") return false;
    if (this.spectating) return false; // đã chọn XEM → chờ hết ván
    if (this.roomLocked()) return false; // phòng có KING → chờ mất ngôi mới vào lại
    return this.spawn(this.human); // false nếu bản đồ đã đầy (không đủ chỗ hợp lệ)
  }

  /** Người chơi có thể hồi sinh ngay bây giờ không? (chưa chọn xem, không bị khoá, còn chỗ). */
  canRevive(): boolean {
    if (this.human.phase !== "dead") return false;
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
    this.kingHolderId = -1;
    this.spectating = false;
    this.kingHoldRemaining = CONFIG.WIN_HOLD_TIME;
    for (const e of this.players) {
      e.deaths = 0;
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
    const inset = (CONFIG.START_RADIUS + 1) * CONFIG.HEX_SIZE * Math.sqrt(3);
    const lim = ARENA_INRADIUS - inset; // biên lấy mẫu (đủ sâu để cụm khởi đầu lọt trong)
    const clearance = CONFIG.SPAWN_CLEARANCE;

    // Không có ĐẤT (owned) của ai trong bán kính `clearance` quanh c — chỉ duyệt ô đã
    // chiếm (cellOwner), O(owned).
    const clearAround = (c: Axial): boolean => {
      for (const k of this.cellOwner.keys()) {
        if (cubeDistance(keyToAxial(k), c) <= clearance) return false;
      }
      return true;
    };

    // 1) Lấy mẫu điểm ngẫu nhiên (nhanh khi còn nhiều chỗ).
    for (let i = 0; i < 60; i++) {
      const x = (this.rng() * 2 - 1) * lim;
      const y = (this.rng() * 2 - 1) * lim;
      if (!insideArena(x, y, -inset)) continue;
      const a = pixelToAxial(x, y, CONFIG.HEX_SIZE);
      if (this.map.has(keyOf(a)) && clearAround(a)) return a;
    }
    // 2) Quét xác định toàn bộ ô đủ sâu → khẳng định CÒN chỗ hợp lệ hay KHÔNG (null).
    for (const k of this.playable) {
      const a = keyToAxial(k);
      const p = axialToPixel(a, CONFIG.HEX_SIZE);
      if (insideArena(p.x, p.y, -inset) && clearAround(a)) return a;
    }
    return null; // bản đồ đã đầy — không còn vị trí hợp lệ
  }

  // ---- Cập nhật ------------------------------------------------------------
  /** Gọi mỗi frame với dt (giây). */
  update(dt: number): void {
    if (this.won) return;
    for (const e of this.players) {
      if (e.isBot && e.phase === "playing") this.botThink(e, dt);
    }
    for (const e of this.players) this.updateEntity(e, dt);
    this.resolveHeadCollisions();
    this.checkWin(dt);
  }

  /** Điều kiện thắng: (a) đấu loại — có KING và chỉ còn 1 thực thể sống; hoặc (b) một
   *  KING giữ ngôi liên tục đủ WIN_HOLD_TIME giây. */
  private checkWin(dt: number): void {
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
        this.kingHoldRemaining = CONFIG.WIN_HOLD_TIME;
      }
    } else {
      this.kingHolderId = -1;
      this.kingHoldRemaining = CONFIG.WIN_HOLD_TIME;
    }
  }

  private updateEntity(e: Entity, dt: number): void {
    if (e.phase === "dead") {
      // Phòng bị KING khoá → bot nằm chờ (không hồi sinh) cho tới khi mất ngôi.
      if (e.isBot && !this.roomLocked() && e.respawnTimer > 0) {
        e.respawnTimer -= dt;
        if (e.respawnTimer <= 0) this.spawn(e);
      }
      return;
    }

    // Quay đầu mượt về targetHeading (cả khi chuẩn bị).
    const maxTurn = CONFIG.TURN_RATE * dt;
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

    const dist = CONFIG.SPEED * dt;
    const vx = Math.cos(e.heading);
    const vy = Math.sin(e.heading);

    // Va chạm tường kiểu "ĐẨY rồi KÉO về trong sân" (move-then-clamp): dịch theo hướng
    // đang nhìn rồi clamp điểm đích về trong lục giác lồi. Cách này TỰ trượt dọc tường
    // và DỪNG HẲN ở góc, và QUAN TRỌNG: không bao giờ sinh vận tốc LÙI. Cách chiếu pháp
    // tuyến tường thủ công trước đây, tại GÓC lồi (2 tường), để lại vận tốc dư hướng
    // NGƯỢC vào trong → đầu bị đẩy lùi vào ô đuôi của chính mình → chết oan "tự đâm đuôi".
    const c = clampInside(e.pos.x + vx * dist, e.pos.y + vy * dist);
    const mdx = c.x - e.pos.x;
    const mdy = c.y - e.pos.y;
    const moved = Math.hypot(mdx, mdy);
    if (moved > 1e-7) {
      // Bị TƯỜNG chặn phần lớn bước đi (moved < nửa bước dự định) và ô kế tiếp lại là ĐUÔI
      // CỦA CHÍNH MÌNH → KHÔNG bước vào: chỉ đứng/trượt sát tường. Tránh cái chết "tự đâm
      // đuôi" OAN khi đầu bị GHIM ở góc/tường (clamp làm đầu giật lùi vào ô đuôi vừa vẽ).
      const wallBlocked = moved < dist - 1e-6;
      const intoOwnTrail =
        this.cellTrail.get(keyOf(pixelToAxial(c.x, c.y, CONFIG.HEX_SIZE))) === e.id;
      if (!(wallBlocked && intoOwnTrail)) {
        this.stepEntity(e, c.x, c.y);
      }
      // Xoay đầu theo hướng DI CHUYỂN THỰC (trượt dọc tường); xa tường thì trùng heading.
      e.heading = Math.atan2(mdy, mdx);
    }
  }

  /** API cho test: di chuyển người chơi tới (x,y) nếu ô đích hợp lệ. */
  moveTo(x: number, y: number): void {
    if (!this.inMap(x, y)) return;
    this.stepEntity(this.human, x, y);
  }

  private stepEntity(e: Entity, x: number, y: number): void {
    const nextHex = pixelToAxial(x, y, CONFIG.HEX_SIZE);
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
      if (last && Math.hypot(x - last.x, y - last.y) >= CONFIG.TRAIL_POINT_DIST) {
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

    // 1. Bước lên 1 ô ĐUÔI — xét TRƯỚC cả đất của mình: đâm đuôi đối thủ ở BẤT KỲ ô nào
    //    (kể cả khi ô đó nằm trong lãnh thổ của mình) đều khiến đối thủ chết.
    const trailOwner = this.cellTrail.get(hk);
    if (trailOwner !== undefined) {
      if (trailOwner === e.id) {
        this.kill(e, undefined, "self"); // tự cắt đuôi → chết
        return true;
      }
      // Cắt đuôi đối thủ → đối thủ chết & MẤT ĐẤT về tay e; kill() dọn cellTrail của họ.
      this.kill(this.players[trailOwner], e, "cut");
    }

    // 2. Về lãnh thổ của mình → khép vòng, chiếm đất.
    if (this.cellOwner.get(hk) === e.id) {
      if (e.trailHexes.length > 0) this.captureFor(e);
      return false;
    }

    // 3. Ô trung lập / đất đối thủ → thêm vào đuôi (barrier).
    if (e.trailHexes.length === 0) {
      // Đường line bắt đầu NGAY tại vị trí đầu nhân vật (không kéo về tâm ô) MIỄN là đầu
      // đang thực sự nằm TRONG ô trung lập đầu tiên h — đúng với di chuyển liên tục
      // thường thấy. Chỉ khi một bước nhảy qua nhiều ô (đầu đã ở ô xa hơn) mới lùi về
      // tâm h để điểm neo luôn nằm trong ô trung lập đầu tiên, không thò ngược vào đất.
      const a = pixelToAxial(e.pos.x, e.pos.y, CONFIG.HEX_SIZE);
      if (a.q === h.q && a.r === h.r) {
        e.trailPoints = [{ x: e.pos.x, y: e.pos.y }];
      } else {
        const p = axialToPixel(h, CONFIG.HEX_SIZE);
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
    const captured = captureEnclosed(this.map, e.owned, e.trailHexes);
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
  /** Chủ đất hạ KẺ XÂM NHẬP: nếu đầu đối thủ b đang đứng trên ĐẤT của a và sát đầu a
   *  (≤ KILL_RADIUS) → b chết. Chủ đất bất khả xâm phạm trên sân nhà. */
  private resolveHeadCollisions(): void {
    const R = CONFIG.KILL_RADIUS;
    const R2 = R * R;

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
      } else if (aCell !== a.id && bCell !== b.id) {
        // CẢ HAI đang ở ngoài sân nhà (ô trung lập / đất bên thứ ba) mà đâm đầu vào
        // nhau → cả hai chết, mất sạch đất.
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
    if (!insideArena(x, y, 0.25)) return true;
    const hk = keyOf(pixelToAxial(x, y, CONFIG.HEX_SIZE));
    return this.cellTrail.get(hk) === e.id;
  }

  /** Chọn hướng gần `desired` nhất mà phía trước KHÔNG bị chặn (né đuôi mình + tường).
   *  Bot kỹ năng cao nhìn xa hơn và quét nhiều hướng hơn. */
  private steerAvoiding(e: Entity, desired: number, skill: number): number {
    const dist = CONFIG.BOT.AVOID_DIST * (0.7 + skill * 0.8);
    if (!this.aheadBlocked(e, desired, dist)) return desired;
    const step = 0.35;
    const maxK = Math.round(3 + skill * 6);
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

    // FLEE tức thời: đang ở ngoài (dễ tổn thương) mà có đối thủ áp sát → rút lui.
    if (outside && this.nearestEntity(e, prof.vision * 0.55, false)) {
      e.botState = "flee";
    }

    // Ra quyết định định kỳ (nhịp theo reaction; bot giỏi phản ứng nhanh hơn).
    if (e.botDecisionTimer <= 0) {
      e.botDecisionTimer = prof.reaction;
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
