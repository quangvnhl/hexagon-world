"use client";

// Scene ONLINE: render ĐẦY ĐỦ bằng chính các component 3D của chơi đơn (lưới lục giác,
// chiếm đất, biên, cube), nhưng KHÔNG chạy mô phỏng cục bộ — thay vào đó đẩy trạng thái
// từ server (authoritative) vào một `GameState`-view:
//   - vị trí ĐẦU của mình: DỰ ĐOÁN cục bộ (Predictor) → mượt, không chờ mạng.
//   - thực thể khác: NỘI SUY (InterpolationBuffer).
//   - LÃNH THỔ: dựng lại từ keyframe TERRITORY (throttle ~4Hz).
// Đuôi hiển thị dạng ô màu (cellTrail) qua HexGridView; tube đuôi mượt là việc pha sau.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  GameState,
  CONFIG,
  GAME_PROTOCOL_VERSION,
  PLAYER_SHAPES,
  TRAIL_PATTERNS,
  axialToPixel,
  parseKey,
  type PlayerAppearance,
  type WorldUiEntity,
  type MinimapUiEntity,
  type TerritoryCell,
  type TotemWireState,
} from "@hexagon/shared";
import { HexGridView } from "./HexGridView";
import { TerritoryBorders } from "./TerritoryBorders";
import { BorderRim } from "./BorderRim";
import { TrailLine } from "./TrailLine";
import { PlayerCube } from "./PlayerCube";
import { Effects } from "./Effects";
import { CollisionDebug } from "./CollisionDebug";
import { ArenaCollider } from "./ArenaCollider";
import { MiniMap } from "./MiniMap";
import { Joystick } from "./Joystick";
import { HUD, Stats } from "./HUD";
import { FpsMeterIfEnabled } from "./FpsMeter";
import { GameCamera, MenuButton } from "./GameScene";
import { notifyTelegramHaptic } from "@/lib/telegram";
import { TelegramGameHaptics } from "./TelegramGameHaptics";
import { EndGameInterstitial } from "./EndGameInterstitial";
import { TotemInstances } from "./TotemInstances";
import { useCameraProfile } from "./cameraProfile";
import {
  NetClient,
  DEFAULT_SERVER_URL,
  type ConnStatus,
} from "@/net/NetClient";

/**
 * Dựng GameState-view khớp ĐÚNG số ghế/bot của server (lấy từ WELCOME) → id + màu +
 * SỐ LƯỢNG thực thể đồng nhất hai bên (không hardcode; đổi BOT_COUNT ở shared là khớp).
 * "Làm trống" mọi thực thể (dead) + xoá lãnh thổ để KHÔNG hiện bóng ma trước khi có dữ
 * liệu mạng; snapshot/keyframe đầu (gửi ngay khi JOIN) sẽ điền lại.
 */
function makeBlankView(maxPlayers: number, botCount: number): GameState {
  const g = new GameState(
    undefined,
    Math.max(0, botCount),
    Math.max(1, maxPlayers)
  );
  for (const e of g.players) e.phase = "dead";
  g.applyTerritory([]);
  return g;
}

interface PointerRef {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

interface DeathInfo {
  cause: Stats["deathCause"];
  killerName: string;
  lastPct: number;
  cells: { x: number; y: number }[];
}

/** Vòng lặp online: input → gửi server; render state → đẩy vào GameState-view; bám camera. */
function NetLoop({
  client,
  game,
  localIdRef,
  pointer,
  joystick,
  spectatingRef,
  spectateTargetRef,
  onStats,
  onPing,
  onPlayerCount,
  visibleEntityIdsRef,
  authoritativeScoresRef,
  captureHapticEnabledRef,
}: {
  client: NetClient;
  game: GameState;
  localIdRef: React.MutableRefObject<number>;
  pointer: React.MutableRefObject<PointerRef>;
  joystick: React.MutableRefObject<{ active: boolean; angle: number }>;
  spectatingRef: React.MutableRefObject<boolean>;
  spectateTargetRef: React.MutableRefObject<number>;
  onStats: (
    g: GameState,
    localId: number,
    alive: boolean,
    prepMs: number,
    kingHold: number,
    localScore: number,
    effectiveSpeed: number,
    speedTotemCount: number,
    radarActive: boolean,
    insideEnemySlowZone: boolean
  ) => void;
  onPing: (ms: number) => void;
  onPlayerCount: (count: number) => void;
  visibleEntityIdsRef: React.MutableRefObject<ReadonlySet<number>>;
  authoritativeScoresRef: React.MutableRefObject<ReadonlyMap<number, number>>;
  captureHapticEnabledRef: React.MutableRefObject<boolean>;
}) {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  const cameraProfile = useCameraProfile(width, height);
  const statAcc = useRef(0);
  const zoom = useRef(cameraProfile.settings.ZOOM.MIN);
  const lastTerr = useRef(-1);
  /** Hướng ngắm/đi gần nhất — giữ để dự đoán tiến ngay cả frame không có hướng mới. */
  const lastHeading = useRef<number | null>(null);
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    []
  );
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  const camQuat = useMemo(() => {
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const dummy = new THREE.PerspectiveCamera();
    dummy.position.set(ox, oy, oz);
    dummy.lookAt(0, 0, 0);
    return dummy.quaternion.clone();
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const localId = localIdRef.current;
    const rs = client.getRenderState();

    // Snapshot AoI là nguồn quyết định object nào được phép tồn tại trong scene ở frame này.
    // Entity biến mất khỏi AoI phải ẩn ngay, không được giữ tọa độ cuối cùng trong GameState-view.
    const visibleIds = new Set<number>();
    if (rs.self) visibleIds.add(rs.self.id);
    for (const o of rs.others) visibleIds.add(o.id);
    visibleEntityIdsRef.current = visibleIds;

    // 1) Dựng lại lưới đất/đuôi khi có keyframe TERRITORY mới.
    const terr = client.getTerritory();
    if (terr.version !== lastTerr.current) {
      lastTerr.current = terr.version;
      game.applyTerritory(terr.cells);
    }

    // 2) Đẩy trạng thái thực thể: self (dự đoán) + others (nội suy).
    if (rs.self) {
      game.setAppearance(rs.self.id, {
        colorIndex: rs.self.colorIndex,
        trailPattern: TRAIL_PATTERNS[rs.self.trailPatternIndex] ?? "solid",
        shape: PLAYER_SHAPES[rs.self.shapeIndex] ?? "cube",
      });
      game.applyEntity(
        rs.self.id,
        rs.self.x,
        rs.self.y,
        rs.self.heading,
        rs.self.alive,
        rs.self.hasTrail
      );
      // Dự đoán Ô ĐUÔI cục bộ cho self → màu ô bám kịp đầu (không chờ keyframe ~4Hz). Gọi
      // SAU applyTerritory (bước 1) + applyEntity nên frame vừa reconcile cũng không nhấp nháy.
      if (rs.self.alive && rs.self.hasTrail) game.predictTrailCell(rs.self.id);
    }
    for (const o of rs.others) {
      game.setAppearance(o.id, {
        colorIndex: o.colorIndex,
        trailPattern: TRAIL_PATTERNS[o.trailPatternIndex] ?? "solid",
        shape: PLAYER_SHAPES[o.shapeIndex] ?? "cube",
      });
      game.applyEntity(o.id, o.x, o.y, o.heading, o.alive, o.hasTrail);
    }

    const self = rs.self;
    const alive = self?.alive ?? false;
    const inPrep = rs.selfPrep > 0;
    captureHapticEnabledRef.current = alive && !inPrep;

    // 3) Input: chỉ khi có self, còn sống, không xem. Tính hướng mong muốn rồi gửi.
    //    Khi CHUẨN BỊ (prep) chỉ NGẮM (sendAim, không dự đoán tiến); khi chơi thì sendInput.
    if (self && alive && !spectatingRef.current) {
      let heading: number | null = null;
      const j = joystick.current;
      if (j.active) {
        heading = j.angle;
      } else {
        const p = pointer.current;
        if (p.active) {
          ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
          ray.setFromCamera(ndc, camera);
          if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
            const dx = hitPoint.x - self.x;
            const dy = hitPoint.y - self.y;
            if (Math.hypot(dx, dy) > 0.4) heading = Math.atan2(dy, dx);
          }
        }
      }
      if (inPrep) {
        // Chuẩn bị: chỉ NGẮM khi có hướng mới; KHÔNG dự đoán tiến (server còn đứng yên).
        if (heading !== null) {
          client.sendAim(heading);
          lastHeading.current = heading;
        }
      } else {
        // ĐANG CHƠI: server đi TIẾP mỗi tick theo heading cuối, nên client phải dự đoán
        // TIẾN MỖI FRAME (kể cả khi con trỏ nằm trong dead-zone → heading null). Dùng
        // hướng mới nếu có, không thì giữ hướng cuối / hướng đầu hiện tại. Nhờ vậy dự đoán
        // luôn khớp NHỊP server → hết giật do "bỏ frame dự đoán".
        const h = heading ?? lastHeading.current ?? self.heading;
        client.sendInput(h, dt);
        if (heading !== null) lastHeading.current = heading;
      }
    }

    // 4) Camera: bám self; nếu chết/xem thì bám thực thể dẫn đầu.
    let fx = self?.x ?? 0;
    let fy = self?.y ?? 0;
    // Khi vừa chết vẫn bám tọa độ self để xem hiệu ứng; chỉ đổi mục tiêu sau khi bấm Xem.
    if (spectatingRef.current) {
      // Bám thực thể ĐANG CHỌN xem nếu còn sống; nếu chưa chọn / đã chết → bám thực thể dẫn đầu.
      const want = spectateTargetRef.current;
      const tid =
        want >= 0 && game.players[want]?.alive ? want : game.leaderId();
      if (tid >= 0) {
        fx = game.players[tid].pos.x;
        fy = game.players[tid].pos.y;
      }
    }
    client.setTerritoryInterest(fx, fy);
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const k = CONFIG.CAMERA.LERP;
    const { MIN, MAX } = cameraProfile.settings.ZOOM;
    const localScore =
      authoritativeScoresRef.current.get(localId) ?? self?.score ?? 0;
    const authoritativePct = (localScore / game.playable.size) * 100;
    const t = Math.min(Math.max(authoritativePct / CONFIG.KING_PCT, 0), 1);
    const targetZoom = MIN + t * (MAX - MIN);
    zoom.current += (targetZoom - zoom.current) * k;
    const z = zoom.current;
    camera.quaternion.copy(camQuat);
    camera.position.x += (fx + ox - camera.position.x) * k;
    camera.position.y += (fy + oy * z - camera.position.y) * k;
    camera.position.z += (oz * z - camera.position.z) * k;

    statAcc.current += dt;
    if (statAcc.current >= 0.2) {
      statAcc.current = 0;
      onStats(
        game,
        localId,
        alive,
        rs.selfPrep,
        rs.kingHold,
        localScore,
        self?.effectiveSpeed ?? 0,
        self?.speedTotemCount ?? 0,
        self?.radarActive ?? false,
        (self?.effectiveSpeed ?? 0) === CONFIG.TOTEMS.SLOW.ENEMY_SPEED
      );
      onPing(client.getPing());
      onPlayerCount(rs.playerCount);
    }
  });

  return null;
}

export default function NetGameScene({
  playerName,
  appearance,
  serverUrl,
  gameTicket,
  onExit,
}: {
  playerName?: string;
  appearance?: PlayerAppearance;
  serverUrl?: string;
  gameTicket?: string;
  onExit?: () => void;
}) {
  const client = useMemo(() => new NetClient(), []);
  // View-state dựng theo WELCOME (số ghế/bot của server). Tạo khi nhận WELCOME.
  const [game, setGame] = useState<GameState | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [worldUi, setWorldUi] = useState<WorldUiEntity[]>([]);
  const [minimapEntities, setMinimapEntities] = useState<MinimapUiEntity[]>([]);
  const [minimapTerritory, setMinimapTerritory] = useState<TerritoryCell[]>([]);
  const [radarActive, setRadarActive] = useState(false);
  const [totems, setTotems] = useState<TotemWireState[]>([]);
  const gameRef = useRef<GameState | null>(null);
  const authoritativeScoresRef = useRef<ReadonlyMap<number, number>>(new Map());
  const captureHapticEnabledRef = useRef(false);

  const pointer = useRef<PointerRef>({ x: 0, y: 0, w: 1, h: 1, active: false });
  const joystick = useRef<{ active: boolean; angle: number }>({
    active: false,
    angle: 0,
  });
  const localIdRef = useRef(0);
  const visibleEntityIdsRef = useRef<ReadonlySet<number>>(new Set());
  const rosterIdsRef = useRef<Set<number>>(new Set());
  const spectatingRef = useRef(false);
  // Id thực thể ĐANG XEM khi khán giả (-1 = tự bám thực thể dẫn đầu). Nút ◀ ▶ đổi giá trị này.
  const spectateTargetRef = useRef(-1);
  const deathInfoRef = useRef<DeathInfo>({
    cause: "",
    killerName: "",
    lastPct: 0,
    cells: [],
  });
  const wonRef = useRef<{ won: boolean; winnerId: number }>({
    won: false,
    winnerId: -1,
  });
  const deathCountRef = useRef(0);
  const wasAliveRef = useRef(true);
  // Theo dõi chuyển CHỜ→VÀO TRẬN để reset trạng thái chết/thắng cho ván mới.
  const startedRef = useRef(false);

  const [status, setStatus] = useState<ConnStatus>("idle");
  const [playerId, setPlayerId] = useState<number>(-1);
  const [ping, setPing] = useState(0);
  const [spectating, setSpectating] = useState(false);
  // Phòng chờ: đã vào trận chưa + số người thật hiện có / cần để bắt đầu.
  const [started, setStarted] = useState(false);
  const [lobby, setLobby] = useState<{ present: number; needed: number }>({
    present: 1,
    needed: 2,
  });
  const [stats, setStats] = useState<Stats>({
    pct: 0,
    king: false,
    deaths: 0,
    phase: "playing",
    prep: 0,
    scores: [],
    colorIndex: appearance?.colorIndex ?? 0,
    won: false,
    kingHold: CONFIG.WIN_HOLD_TIME,
    locked: false,
    kingName: "",
    winnerId: -1,
    winnerName: "",
    canRevive: true,
    spectating: false,
    deathCause: "",
    killerName: "",
    lastPct: 0,
    deathCells: [],
  });

  const url = serverUrl || DEFAULT_SERVER_URL;

  const buildStats = useCallback(
    (
      g: GameState,
      localId: number,
      alive: boolean,
      prepMs: number,
      kingHold: number,
      localScore: number,
      effectiveSpeed: number,
      speedTotemCount: number,
      radarActiveNow: boolean,
      insideEnemySlowZone: boolean
    ) => {
      // Phát hiện chuyển sống→chết để chốt "ảnh lãnh thổ" cho bản đồ popup.
      if (wasAliveRef.current && !alive) {
        deathCountRef.current++;
        const cells: { x: number; y: number }[] = [];
        g.forEachOwned((key, oid) => {
          if (oid === localId)
            cells.push(axialToPixel(parseKey(key), CONFIG.HEX_SIZE));
        });
        deathInfoRef.current = {
          ...deathInfoRef.current,
          lastPct: (localScore / g.playable.size) * 100,
          cells,
        };
      }
      wasAliveRef.current = alive;

      const global = client.getWorldUi();
      const globalLeader = global
        .filter((entity) => entity.alive)
        .reduce<WorldUiEntity | null>(
          (best, entity) => (!best || entity.score > best.score ? entity : best),
          null
        );
      const kid = globalLeader &&
        (globalLeader.score / g.playable.size) * 100 >= CONFIG.KING_PCT
        ? globalLeader.id
        : global.length > 0 ? -1 : g.kingId();
      const won = wonRef.current.won;
      const winnerId = wonRef.current.winnerId;
      const inPrep = prepMs > 0;
      // Tên thực thể đang xem (khớp camera): mục tiêu đã chọn nếu còn sống, không thì dẫn đầu.
      const specWant = spectateTargetRef.current;
      const specId =
        specWant >= 0 && g.players[specWant]?.alive ? specWant : g.leaderId();
      setStats({
        pct: (localScore / g.playable.size) * 100,
        king: kid === localId,
        deaths: deathCountRef.current,
        phase: inPrep ? "prep" : alive ? "playing" : "dead",
        prep: prepMs / 1000,
        scores: (() => {
          if (global.length === 0) {
            const active = rosterIdsRef.current;
            return g.scores().filter((score) => active.has(score.id));
          }
          return global.map((e) => ({
            id: e.id,
            name: g.nameOf(e.id),
            pct: (e.score / g.playable.size) * 100,
            alive: e.alive,
            colorIndex: e.colorIndex,
          }));
        })(),
        colorIndex: g.players[localId]?.colorIndex ?? 0,
        won,
        kingHold, // đồng hồ giữ ngôi do server tính (đếm ngược 3 phút)
        locked: kid !== -1,
        kingName: kid >= 0 ? g.nameOf(kid) : "",
        winnerId,
        winnerName: winnerId >= 0 ? g.nameOf(winnerId) : "",
        canRevive: kid === -1, // phòng chưa bị KING khoá thì cho thử hồi sinh
        spectating: spectatingRef.current,
        spectateName: specId >= 0 ? g.nameOf(specId) : "",
        deathCause: deathInfoRef.current.cause,
        killerName: deathInfoRef.current.killerName,
        lastPct: deathInfoRef.current.lastPct,
        deathCells: deathInfoRef.current.cells,
        effectiveSpeed,
        speedTotemCount,
        radarActive: radarActiveNow,
        insideEnemySlowZone,
      });
    },
    []
  );

  // Kết nối khi mount; gắn handler sự kiện.
  useEffect(() => {
    client.handlers = {
      onStatus: (s) => setStatus(s),
      onWelcome: (w) => {
        localIdRef.current = w.playerId;
        setPlayerId(w.playerId);
        // Dựng view khớp số ghế/bot của server.
        const g = makeBlankView(w.maxPlayers, w.botCount);
        gameRef.current = g;
        setGame(g);
        setWorldUi([]);
        setMinimapEntities([]);
        setMinimapTerritory([]);
        setRadarActive(false);
        setTotems([]);
        authoritativeScoresRef.current = new Map();
        rosterIdsRef.current = new Set();
        // Reset trạng thái vòng chơi mới (quay lại phòng chờ).
        spectatingRef.current = false;
        spectateTargetRef.current = -1;
        setSpectating(false);
        startedRef.current = false;
        setStarted(false);
        wonRef.current = { won: false, winnerId: -1 };
        wasAliveRef.current = true;
        deathInfoRef.current = { cause: "", killerName: "", lastPct: 0, cells: [] };
      },
      onRoster: (players) => {
        // Áp TÊN người chơi vào view (hiển thị đúng tên ở bảng xếp hạng / popup).
        const g = gameRef.current;
        rosterIdsRef.current = new Set(players.map((p) => p.id));
        if (g) for (const p of players) g.setName(p.id, p.name);
      },
      onWorldUi: (entities) => {
        authoritativeScoresRef.current = new Map(
          entities.map((entity) => [entity.id, entity.score])
        );
        const g = gameRef.current;
        if (g) {
          for (const e of entities) {
            g.setAppearance(e.id, {
              colorIndex: e.colorIndex,
              trailPattern: TRAIL_PATTERNS[e.trailPatternIndex] ?? "solid",
              shape: PLAYER_SHAPES[e.shapeIndex] ?? "cube",
            });
          }
        }
        setWorldUi(entities);
      },
      onMinimapUi: (enabled, entities) => {
        setRadarActive(enabled);
        setMinimapEntities(entities);
      },
      onMinimapTerritory: (cells) => setMinimapTerritory(cells),
      onTotems: (_revision, items) => setTotems(items),
      onLobby: (l) => {
        // Chuyển CHỜ→VÀO TRẬN (ván mới) → dọn sạch trạng thái chết/thắng của ván trước.
        if (l.started && !startedRef.current) {
          wasAliveRef.current = true;
          deathCountRef.current = 0;
          deathInfoRef.current = { cause: "", killerName: "", lastPct: 0, cells: [] };
          wonRef.current = { won: false, winnerId: -1 };
          spectatingRef.current = false;
          setSpectating(false);
        }
        startedRef.current = l.started;
        setStarted(l.started);
        setLobby({ present: l.present, needed: l.needed });
      },
      onEvent: (ev) => {
        if (ev.kind === "death") {
          if (ev.id === localIdRef.current) {
            notifyTelegramHaptic("error");
            deathInfoRef.current = {
              ...deathInfoRef.current,
              cause: ev.cause,
              killerName:
                ev.killerId >= 0 ? gameRef.current?.nameOf(ev.killerId) ?? "" : "",
            };
          } else if (ev.killerId === localIdRef.current) {
            notifyTelegramHaptic("success");
          }
        } else if (ev.kind === "win" || ev.kind === "match_end") {
          wonRef.current = { won: true, winnerId: ev.winnerId };
        }
      },
    };
    client.connect(url, playerName || "Bạn", appearance, gameTicket);
    return () => client.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cập nhật ping độc lập với rAF (2 lần/giây) để chip luôn hiện dù khung hình chậm.
  useEffect(() => {
    const t = setInterval(() => setPing(client.getPing()), 500);
    return () => clearInterval(t);
  }, [client]);

  const handlePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Touch do joystick nổi quản lý; không lưu điểm thả tay thành hướng chuột.
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    pointer.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      w: rect.width,
      h: rect.height,
      active: true,
    };
  }, []);

  const onRevive = useCallback(() => client.sendRevive(), [client]);
  const onSpectate = useCallback(() => {
    spectatingRef.current = true;
    const target = gameRef.current?.leaderId() ?? -1;
    spectateTargetRef.current = target;
    client.sendSpectateTarget(target >= 0 ? target : null);
    setSpectating(true);
  }, [client]);
  // Chuyển thực thể đang xem sang người sống trước/sau (thủ công thay cho tự bám dẫn đầu).
  const onSpectatePrev = useCallback(() => {
    const g = gameRef.current;
    if (g) {
      const target = g.spectateCycle(spectateTargetRef.current, -1);
      spectateTargetRef.current = target;
      client.sendSpectateTarget(target >= 0 ? target : null);
    }
  }, [client]);
  const onSpectateNext = useCallback(() => {
    const g = gameRef.current;
    if (g) {
      const target = g.spectateCycle(spectateTargetRef.current, 1);
      spectateTargetRef.current = target;
      client.sendSpectateTarget(target >= 0 ? target : null);
    }
  }, [client]);
  const onRestart = useCallback(() => {
    // Online: chơi lại = kết nối lại (nhận ghế mới, spawn mới).
    wonRef.current = { won: false, winnerId: -1 };
    client.connect(url, playerName || "Bạn", appearance, gameTicket);
  }, [appearance, client, url, playerName, gameTicket]);
  const onReturnToLobby = useCallback(() => {
    client.disconnect();
    onExit?.();
  }, [client, onExit]);

  const connected = status === "open" && playerId >= 0;

  return (
    <div
      onPointerMove={handlePointer}
      style={{
        position: "fixed",
        inset: 0,
        background: "#0a0e16",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      <Canvas dpr={[1, 1.5]}>
        <GameCamera />
        <color attach="background" args={["#0a0e16"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 6, 12]} intensity={1.15} />

        {game && (
          <>
            <NetLoop
              client={client}
              game={game}
              localIdRef={localIdRef}
              pointer={pointer}
              joystick={joystick}
              spectatingRef={spectatingRef}
              spectateTargetRef={spectateTargetRef}
              onStats={buildStats}
              onPing={setPing}
              onPlayerCount={setPlayerCount}
              visibleEntityIdsRef={visibleEntityIdsRef}
              authoritativeScoresRef={authoritativeScoresRef}
              captureHapticEnabledRef={captureHapticEnabledRef}
            />
            <HexGridView game={game} activeEntityId={playerId} />
            {CONFIG.DISPLAY.TERRITORY_BORDERS && <TerritoryBorders game={game} />}
            <BorderRim game={game} />
            <TrailLine game={game} />
            <TotemInstances items={totems} />
            <PlayerCube game={game} visibleEntityIds={visibleEntityIdsRef} />
            {CONFIG.DISPLAY.PARTICLES && (
              <Effects
                game={game}
                visibleEntityIds={visibleEntityIdsRef}
                authoritativeScores={authoritativeScoresRef}
              />
            )}
            <TelegramGameHaptics
              game={game}
              playerId={playerId}
              trackDeaths={false}
              authoritativeScores={authoritativeScoresRef}
              captureEnabled={captureHapticEnabledRef}
            />
            {CONFIG.DEBUG.COLLISION_VECTORS && (
              <>
                <ArenaCollider />
                <CollisionDebug game={game} entityId={localIdRef.current} />
              </>
            )}
          </>
        )}
      </Canvas>

      {connected && game && started && (
        <>
          {CONFIG.DISPLAY.HUD && (
            <HUD
              stats={stats}
              onRevive={onRevive}
              onRestart={onRestart}
              onSpectate={onSpectate}
              onSpectatePrev={onSpectatePrev}
              onSpectateNext={onSpectateNext}
              localId={playerId}
              playerName={playerName}
              endMode="online"
              onReturnToLobby={onReturnToLobby}
            />
          )}
          {CONFIG.DISPLAY.MINIMAP && (
            <MiniMap
              game={game}
              localId={playerId}
              totems={totems}
              privacy={{
                radarActive,
                territory: minimapTerritory,
                entities: minimapEntities,
              }}
            />
          )}
          <Joystick dir={joystick} />
        </>
      )}
      <EndGameInterstitial
        won={stats.won}
        kingReached={stats.king || Boolean(stats.kingName)}
      />
      <FpsMeterIfEnabled
        statusText={
          connected
            ? `Online · ${ping} ms · ${playerCount || lobby.present} người`
            : status === "connecting"
              ? "Đang kết nối"
              : status === "error"
                ? "Lỗi kết nối"
                : status === "closed"
                  ? "Mất kết nối"
                  : "Offline"
        }
      />

      {onExit && <MenuButton onExit={onExit} />}

      {/* Phòng chờ: đã kết nối, đã có ghế, nhưng chưa đủ người để bắt đầu. */}
      {connected && game && !started && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 18,
            background:
              "radial-gradient(1200px 600px at 50% -10%, rgba(22,32,58,0.92) 0%, rgba(10,14,22,0.96) 60%)",
            color: "#e8eefc",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            padding: 24,
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              border: "3px solid rgba(49,176,255,0.25)",
              borderTopColor: "#31b0ff",
              animation: "hxspin 0.9s linear infinite",
            }}
          />
          <div style={{ fontSize: 22, fontWeight: 800 }}>Đang chờ người chơi…</div>
          <div style={{ fontSize: 16, opacity: 0.85 }}>
            <span style={{ color: "#31b0ff", fontWeight: 800, fontSize: 20 }}>
              {lobby.present}
            </span>{" "}
            / {lobby.needed} người · cần tối thiểu {lobby.needed} người thật để bắt đầu
          </div>
          <div style={{ fontSize: 13, opacity: 0.6, maxWidth: 420, lineHeight: 1.6 }}>
            Phòng đã được tạo. Mời thêm bạn bè mở{" "}
            <code>{url.replace(/^ws/, "http")}</code> để cùng vào — trận bắt đầu ngay khi
            đủ người.
          </div>
          <style>{`@keyframes hxspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Màn chờ khi chưa kết nối được */}
      {!connected && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            color: "#e8eefc",
            fontFamily: "system-ui, sans-serif",
            textAlign: "center",
            padding: 24,
          }}
        >
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {status === "protocol_mismatch"
              ? "Phiên bản client và server không tương thích"
              : status === "error" || status === "closed"
              ? "Không kết nối được server"
              : "Đang kết nối server…"}
          </div>
          <div style={{ fontSize: 13, opacity: 0.7, maxWidth: 420, lineHeight: 1.6 }}>
            {status === "protocol_mismatch" ? (
              <>
                Client đang dùng protocol v{GAME_PROTOCOL_VERSION}. Hãy đặt{" "}
                <code>GAME_PROTOCOL_VERSION={GAME_PROTOCOL_VERSION}</code> trên server rồi khởi động lại.
              </>
            ) : (
              <>
                Máy chủ online cần đang chạy tại <code>{url}</code>. Khởi động bằng:{" "}
                <code>pnpm --filter @hexagon/server start:dev</code>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
