"use client";

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrthographicCamera, PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import type { PlayerAppearance, MatchConfigInput, CampaignOutcomeFacts, Axial } from "@hexagon/shared";
import { axialToPixel, parseKey } from "@hexagon/shared";
import { track } from "@/lib/analytics";
import { HexGridView } from "./HexGridView";
import { PlayerCube } from "./PlayerCube";
import { Effects } from "./Effects";
import { TrailLine } from "./TrailLine";
import { BorderRim } from "./BorderRim";
import { CollisionDebug } from "./CollisionDebug";
import { ArenaCollider } from "./ArenaCollider";
import { ObstacleCollider } from "./ObstacleCollider";
import { StrongholdInstances } from "./StrongholdInstances";
import { TerritoryBorders } from "./TerritoryBorders";
import { MiniMap } from "./MiniMap";
import { Joystick } from "./Joystick";
import { EndGameInterstitial } from "./EndGameInterstitial";
import { HUD, Stats } from "./HUD";
import type { EndScreenMode } from "./endAction";
import { FpsMeterIfEnabled } from "./FpsMeter";
import { TelegramGameHaptics } from "./TelegramGameHaptics";
import { cameraFov, useCameraProfile } from "./cameraProfile";
import { TotemInstances } from "./TotemInstances";

interface PointerRef {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

/** Chọn FOV theo profile desktop, mobile dọc hoặc mobile ngang. */
export function GameCamera() {
  const { width, height } = useThree((state) => state.size);
  const profile = useCameraProfile(width, height);
  const fov = cameraFov(profile.name, width, height);
  const aspect = width / Math.max(height, 1);
  const cameraDistance = Math.hypot(...CONFIG.CAMERA.OFFSET);
  const halfHeight = Math.tan((fov * Math.PI) / 360) * cameraDistance;

  if (CONFIG.CAMERA.TYPE === "ORTHOGRAPHIC") {
    return (
      <OrthographicCamera
        makeDefault
        position={CONFIG.CAMERA.OFFSET}
        left={-halfHeight * aspect}
        right={halfHeight * aspect}
        top={halfHeight}
        bottom={-halfHeight}
        near={0.1}
        far={1000}
      />
    );
  }

  return (
    <PerspectiveCamera
      makeDefault
      position={CONFIG.CAMERA.OFFSET}
      fov={fov}
      near={0.1}
      far={1000}
    />
  );
}

/** Nút quay lại menu, đặt ngay phía trên thống kê FPS ở góc dưới-trái. */
export function MenuButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      onClick={onExit}
      style={{
        position: "absolute",
        left: "max(16px, env(safe-area-inset-left))",
        bottom: "calc(max(10px, env(safe-area-inset-bottom, 0px)) + 34px)",
        padding: "8px 16px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.2)",
        background: "rgba(10,14,22,0.72)",
        color: "#cdd7ea",
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        fontWeight: 700,
        cursor: "pointer",
        backdropFilter: "blur(6px)",
        zIndex: 10,
      }}
    >
      ← Menu
    </button>
  );
}

/** Chuỗi mô tả tiến độ objective (Campaign) cho HUD. Rỗng với endless. */
export function objectiveProgress(game: GameState): string {
  const w = game.config.win;
  switch (w.kind) {
    case "territory_pct": {
      // targetPct là PHÂN SỐ 0–1 (×100 ra %); kingPct đã là % 0–100.
      const target = w.targetPct !== undefined ? w.targetPct * 100 : w.kingPct;
      return `Chiếm ${game.territoryPct().toFixed(1)}% / ${target.toFixed(0)}%`;
    }
    case "king_hold":
      // Là KING (đạt ngưỡng %) ⇒ đếm ngược giữ ngôi; chưa đạt ⇒ hiện % cần đạt.
      return game.isKing
        ? `Giữ King: còn ${Math.max(0, Math.ceil(game.kingHoldRemaining))}s`
        : `Lên King: ${game.territoryPct().toFixed(1)}% / ${w.kingPct}%`;
    case "survive":
      return `Sống sót còn ${Math.max(0, Math.ceil(game.surviveRemaining))}s`;
    case "capture_totems":
      return `Totem ${game.human.totemsCaptured} / ${w.totemGoal ?? 0}`;
    default:
      return "";
  }
}

/** Vòng lặp: đọc chuột → hướng mong muốn, cập nhật game liên tục, bám camera. */
function GameLoop({
  game,
  pointer,
  joystick,
  spectateTargetRef,
  steered,
  onStats,
}: {
  game: GameState;
  pointer: React.MutableRefObject<PointerRef>;
  joystick: React.MutableRefObject<{ active: boolean; angle: number }>;
  spectateTargetRef: React.MutableRefObject<number>;
  /** Bật lên ở lần lái ĐẦU TIÊN. Là ref chứ không phải state: đặt trong vòng lặp 24 Hz nên
   *  không được phép kéo theo một lần render. FTUE đọc nó qua `onStats`. */
  steered: React.MutableRefObject<boolean>;
  onStats: (s: Stats) => void;
}) {
  const camera = useThree((s) => s.camera);
  const { width, height } = useThree((s) => s.size);
  const cameraProfile = useCameraProfile(width, height);
  const statAcc = useRef(0);
  const lastPhase = useRef(game.phase);
  // [doc 35] Theo dõi CHỦ totem để báo khi người chơi (id 0) CHIẾM được / BỊ chiếm lại. seq tăng dần
  // để HUD khử trùng lặp thông báo.
  const totemOwners = useRef<Map<number, number>>(new Map());
  const noticeSeq = useRef(0);
  // Hệ số zoom hiện tại (lerp mượt về target theo diện tích) — bắt đầu ở mức gần nhất.
  const zoom = useRef(cameraProfile.settings.ZOOM.MIN);
  // Raycaster + mặt phẳng mặt đất (z=0) để quy đổi vị trí chuột → điểm world.
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const groundPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0),
    []
  );
  const hitPoint = useMemo(() => new THREE.Vector3(), []);
  const ndc = useMemo(() => new THREE.Vector2(), []);
  // Rotation camera KHOÁ cố định (chỉ pan, không xoay theo chuột/di chuyển).
  // Dùng dummy là CAMERA để lookAt đúng ngữ nghĩa (camera nhìn theo trục -Z);
  // nếu dùng Object3D thường, three.js đảo chiều → camera quay ra xa scene (đen).
  const camQuat = useMemo(() => {
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const dummy = new THREE.PerspectiveCamera();
    dummy.position.set(ox, oy, oz);
    dummy.lookAt(0, 0, 0);
    return dummy.quaternion.clone();
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); // chống nhảy vọt khi tab bị đóng băng

    // Joystick ảo (chạm) ưu tiên hơn chuột: khi đang giữ, dùng thẳng góc của nó
    // và BỎ QUA block chuột trong frame này.
    const j = joystick.current;
    if (j.active) {
      steered.current = true;
      game.setHeadingTarget(j.angle);
    } else {
      // Hướng mong muốn = góc từ đầu người chơi tới điểm con trỏ chiếu xuống mặt đất.
      const p = pointer.current;
      if (p.active) {
        ndc.set((p.x / p.w) * 2 - 1, -(p.y / p.h) * 2 + 1);
        ray.setFromCamera(ndc, camera);
        if (ray.ray.intersectPlane(groundPlane, hitPoint)) {
          const dx = hitPoint.x - game.pos.x;
          const dy = hitPoint.y - game.pos.y;
          if (Math.hypot(dx, dy) > 0.4) {
            steered.current = true;
            game.setHeadingTarget(Math.atan2(dy, dx));
          }
        }
      }
    }

    // CHẾT (chơi đơn, chưa chọn Xem) → DỪNG mô phỏng ngay tại khoảnh khắc chết để người
    // chơi xem lại tình huống (camera đứng yên, bot không chạy tiếp). Bấm Hồi sinh/Xem sẽ
    // chạy lại. Khoảnh khắc chết vẫn được xử lý xong ở frame cuối (frozen tính trước update).
    const frozen = game.human.phase === "dead" && !game.spectating;
    if (!frozen) game.update(dt);

    // Camera perspective: rotation cố định, chỉ PAN (tịnh tiến) theo người chơi.
    const [ox, oy, oz] = CONFIG.CAMERA.OFFSET;
    const k = CONFIG.CAMERA.LERP;
    // Zoom theo diện tích: pct càng gần ngưỡng King → hệ số càng tiến về MAX (xa hơn).
    const { MIN, MAX } = cameraProfile.settings.ZOOM;
    const t = Math.min(Math.max(game.territoryPct() / CONFIG.KING_PCT, 0), 1);
    const targetZoom = MIN + t * (MAX - MIN);
    zoom.current += (targetZoom - zoom.current) * k; // lerp mượt, không giật
    const z = zoom.current;
    // Tiêu điểm camera: người chơi; nếu đang XEM (khán giả) thì bám thực thể dẫn đầu.
    let fx = game.pos.x;
    let fy = game.pos.y;
    if (!game.human.alive && game.spectating) {
      // Bám thực thể ĐANG CHỌN xem nếu còn sống; nếu chưa chọn / đã chết → bám thực thể dẫn đầu.
      const want = spectateTargetRef.current;
      const tid =
        want >= 0 && game.players[want]?.alive ? want : game.leaderId();
      if (tid >= 0) {
        fx = game.players[tid].pos.x;
        fy = game.players[tid].pos.y;
      }
    }
    camera.quaternion.copy(camQuat);
    camera.position.x += (fx + ox - camera.position.x) * k;
    camera.position.y += (fy + oy * z - camera.position.y) * k;
    camera.position.z += (oz * z - camera.position.z) * k;
    if (camera instanceof THREE.OrthographicCamera) {
      const nextZoom = 1 / z;
      if (Math.abs(camera.zoom - nextZoom) > 0.0001) {
        camera.zoom = nextZoom;
        camera.updateProjectionMatrix();
      }
    }

    statAcc.current += dt;
    // Đẩy stats định kỳ; đẩy NGAY khi đổi phase (chết/hồi sinh/vào trận) để popup
    // & đếm ngược phản hồi tức thì.
    if (statAcc.current >= 0.2 || game.phase !== lastPhase.current) {
      statAcc.current = 0;
      lastPhase.current = game.phase;
      // Sự kiện TOTEM (doc 35): so CHỦ totem với lần trước → người chơi CHIẾM (owner 0) hoặc BỊ CHIẾM
      // LẠI (đang là 0 → sang chủ khác). Gắn nhãn theo loại; đẩy kèm stats cho HUD hiện toast.
      const totemEvents: { seq: number; tone: "gain" | "lose"; text: string }[] = [];
      const kindLabel: Record<string, string> = { speed: "Tốc ⚡", slow: "Chậm 🐌", radar: "Radar 📡" };
      for (const t of game.totemStates()) {
        const prev = totemOwners.current.get(t.id);
        if (prev === undefined) { totemOwners.current.set(t.id, t.ownerId); continue; }
        if (t.ownerId === prev) continue;
        totemOwners.current.set(t.id, t.ownerId);
        const label = kindLabel[t.kind] ?? t.kind;
        if (t.ownerId === 0) totemEvents.push({ seq: ++noticeSeq.current, tone: "gain", text: `Bạn chiếm được Totem ${label}` });
        else if (prev === 0 && t.ownerId > 0) totemEvents.push({ seq: ++noticeSeq.current, tone: "lose", text: `Đối thủ chiếm lại Totem ${label}` });
      }
      const modifiers = game.gameplayModifiersFor(0);
      onStats({
        steered: steered.current,
        pct: game.territoryPct(),
        king: game.isKing,
        kingId: game.kingId(),
        deaths: game.deaths,
        phase: game.phase,
        prep: game.prepRemaining,
        scores: game.scores(),
        colorIndex: game.human.colorIndex,
        won: game.won,
        lost: game.lost,
        lostReason: game.lostReason,
        // Ngưỡng MỤC TIÊU thật của cấp: territory_pct → targetPct×100; còn lại → kingPct.
        targetPct:
          game.config.win.kind === "territory_pct" && game.config.win.targetPct !== undefined
            ? game.config.win.targetPct * 100
            : game.config.win.kingPct,
        kingEnabled: game.config.rules.kingEnabled,
        maxLives: game.config.rules.maxLives,
        objective: objectiveProgress(game),
        endless: game.config.win.kind === "none",
        kingHold: game.kingHoldRemaining,
        locked: game.roomLocked(),
        kingName: game.kingId() >= 0 ? game.nameOf(game.kingId()) : "",
        winnerId: game.winnerId,
        winnerName: game.winnerId >= 0 ? game.nameOf(game.winnerId) : "",
        canRevive: game.phase === "dead" ? game.canRevive() : true,
        spectating: game.spectating,
        spectateName: (() => {
          if (!game.spectating) return "";
          const want = spectateTargetRef.current;
          const id =
            want >= 0 && game.players[want]?.alive ? want : game.leaderId();
          return id >= 0 ? game.nameOf(id) : "";
        })(),
        deathCause: game.human.deathCause,
        killerName:
          game.human.killerId >= 0 ? game.nameOf(game.human.killerId) : "",
        lastPct: game.human.lastPct,
        // Chỉ dựng danh sách ô khi đang chết (cho bản đồ popup) — tránh tính khi đang sống.
        deathCells:
          game.phase === "dead"
            ? game.human.lastTerritory.map((k) =>
                axialToPixel(parseKey(k), CONFIG.HEX_SIZE)
              )
            : [],
        effectiveSpeed: modifiers.effectiveSpeed,
        speedTotemCount: modifiers.speedTotemCount,
        radarActive: modifiers.radarActive,
        insideEnemySlowZone: modifiers.insideEnemySlowZone,
        totemEvents,
      });
    }
  });

  return null;
}

export default function GameScene({
  playerName,
  appearance,
  botCount,
  config,
  onOutcome,
  endMode,
  spawnAt,
  onStatsChange,
  onExit,
  showMenu = true,
}: {
  playerName?: string;
  appearance?: PlayerAppearance;
  /** Số bot cho ván Luyện tập (mặc định `CONFIG.BOT_COUNT` — hành vi cũ). */
  botCount?: number;
  /** [Campaign] Cấu hình ván đầy đủ (map/objective/power-up đã áp). Ưu tiên hơn `botCount`. */
  config?: MatchConfigInput;
  /** [Campaign] Gọi ĐÚNG MỘT LẦN khi phân định thắng/thua (để nộp kết quả lên server).
   *  `facts` là DỮ KIỆN THÔ đo được tại thời điểm kết — KHÔNG chứa "đã thắng chưa"/"mấy sao";
   *  server tự chấm lại (doc 35 §A3). `won` chỉ dùng cho hiển thị phía client. */
  onOutcome?: (won: boolean, facts: CampaignOutcomeFacts) => void;
  /** Kiểu hành động màn kết (mặc định "single" = Chơi lại; "campaign" = về danh sách cấp). */
  endMode?: EndScreenMode;
  /** Chuyển tiếp `Stats` của mỗi nhịp đo ra ngoài. Dùng cho lớp phủ FTUE (doc 35 §D1) — cố ý
   *  là prop TUỲ CHỌN và chỉ ĐỌC, để lớp phủ không phải len vào vòng lặp 24 Hz. */
  /** Ô xuất phát cố định. Vắng ⇒ ngẫu nhiên như cũ. FTUE (doc 35 §D1) đặt vào TÂM SÂN: đo được
   *  là spawn ngẫu nhiên khiến 27% người mới chết vào tường trong 90 giây đầu, còn spawn ở tâm
   *  thì 0% — chênh lệch này đủ để một mình nó quyết định có đạt mốc "hoàn thành ≥ 70%" hay không. */
  spawnAt?: Axial;
  onStatsChange?: (s: Stats) => void;
  onExit?: () => void;
  showMenu?: boolean;
} = {}) {
  // Luyện tập: endless (win.kind="none") + số bot chỉnh được. Không truyền botCount
  // ⇒ mặc định CONFIG.BOT_COUNT, hành vi y hệt bản cũ (chỉ khác ở chỗ không bao giờ thắng).
  const resolvedBotCount = botCount ?? CONFIG.BOT_COUNT;
  const game = useMemo(
    () =>
      new GameState({
        config: config ?? { win: { kind: "none" }, bots: { count: resolvedBotCount } },
        spawnAt,
      }),
    [config, resolvedBotCount, spawnAt]
  );
  // [Campaign] Bắn onOutcome đúng một lần khi won/lost lần đầu bật.
  const outcomeFired = useRef(false);
  // Tách khỏi `outcomeFired`: sự kiện đo và việc NỘP kết quả là hai chuyện, và chỉ campaign mới nộp.
  const outcomeSubmitted = useRef(false);
  // Gán tên người chơi vào ghế 0 (hiển thị ở xếp hạng / KING / thắng).
  useMemo(() => {
    if (playerName) game.setName(0, playerName);
    game.setAppearance(0, appearance);
  }, [appearance, game, playerName]);
  // Đã lái lần nào chưa (FTUE bước 1). Ref: đặt trong vòng lặp 24 Hz nên không được re-render.
  const steered = useRef(false);
  const pointer = useRef<PointerRef>({ x: 0, y: 0, w: 1, h: 1, active: false });
  // Hướng từ joystick ảo (chạm) — cập nhật trực tiếp qua ref, không re-render.
  const joystick = useRef<{ active: boolean; angle: number }>({
    active: false,
    angle: 0,
  });
  const [stats, setStats] = useState<Stats>({
    pct: 0,
    king: false,
    deaths: 0,
    phase: "prep",
    prep: CONFIG.PREP_TIME,
    scores: [],
    colorIndex: appearance?.colorIndex ?? 0,
    won: false,
    endless: true,
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

  // Id thực thể ĐANG XEM khi khán giả (-1 = tự bám thực thể dẫn đầu). Nút ◀ ▶ đổi giá trị này.
  const spectateTargetRef = useRef(-1);

  const onStats = useCallback(
    (s: Stats) => {
      setStats(s);
      onStatsChange?.(s);
      if (!outcomeFired.current && (s.won || s.lost)) {
        outcomeFired.current = true;
        // won với chủ thể là người chơi (winnerId 0) = thắng; lost = thua.
        const won = s.won && (s.winnerId === 0 || s.winnerId === -1);
        // doc 35 §A1 — `match_end` phát cho mọi ván CÓ phân định, không chỉ ván có nộp kết quả:
        // nếu chỉ đo chế độ nộp kết quả thì mọi so sánh giữa các chế độ đều lệch.
        // Lưu ý: Luyện tập dùng `win.kind = "none"` (endless) nên không bao giờ phân định ⇒ không
        // phát sự kiện này. Thời lượng phiên Luyện tập đọc qua `session_end` (lát a1.6).
        track("match_end", {
          mode: endMode === "campaign" ? "campaign" : "solo",
          won,
          deaths: s.deaths,
          territory_pct: Math.round(s.pct),
        });
      }
      if (onOutcome && !outcomeSubmitted.current && (s.won || s.lost)) {
        outcomeSubmitted.current = true;
        const won = s.won && (s.winnerId === 0 || s.winnerId === -1);
        // [doc 35 §A3] Chỉ gửi DỮ KIỆN THÔ. Không tự tính sao/điểm và không tự khai "đã thắng" —
        // server chấm lại bằng `evaluateCampaignOutcome` với cấu hình cấp lấy từ database.
        // `kingHold` là thời gian CÒN LẠI phải giữ ngôi ⇒ đã giữ = winHoldTime − còn lại.
        const winHoldTime = game.config.win.winHoldTime;
        onOutcome(won, {
          deaths: s.deaths,
          territoryPct: s.pct,
          totemsCaptured: game.players[0]?.totemsCaptured ?? 0,
          kingHeldSec: Math.max(0, winHoldTime - s.kingHold),
        });
      }
    },
    [onOutcome, endMode, onStatsChange]
  );
  const onRevive = useCallback(() => game.revive(), [game]);
  const onRestart = useCallback(() => {
    // Mở lại cửa đo: `game.restart()` chơi ván mới mà KHÔNG remount GameScene, nên không mở lại
    // hai cờ này thì mọi ván sau lần đầu đều biến mất khỏi số liệu (và campaign không nộp được).
    outcomeFired.current = false;
    outcomeSubmitted.current = false;
    game.restart();
  }, [game]);
  const onSpectate = useCallback(() => game.spectate(), [game]);
  const onSpectatePrev = useCallback(
    () => (spectateTargetRef.current = game.spectateCycle(spectateTargetRef.current, -1)),
    [game]
  );
  const onSpectateNext = useCallback(
    () => (spectateTargetRef.current = game.spectateCycle(spectateTargetRef.current, 1)),
    [game]
  );

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

  return (
    <div
      onPointerMove={handlePointer}
      style={{
        position: "fixed",
        inset: 0,
        background: CONFIG.MAP_COLORS.BACKGROUND,
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      <Canvas dpr={[1, 1.5]}>
        <GameCamera />
        <color attach="background" args={[CONFIG.MAP_COLORS.BACKGROUND]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 6, 12]} intensity={1.15} />

        <GameLoop
          game={game}
          pointer={pointer}
          joystick={joystick}
          spectateTargetRef={spectateTargetRef}
          steered={steered}
          onStats={onStats}
        />
        <HexGridView game={game} />
        {CONFIG.DISPLAY.TERRITORY_BORDERS && <TerritoryBorders game={game} />}
        <BorderRim game={game} />
        <TrailLine game={game} />
        <TotemInstances items={game.totemStates()} />
        <StrongholdInstances game={game} />
        <PlayerCube game={game} />
        {CONFIG.DISPLAY.PARTICLES && <Effects game={game} />}
        <TelegramGameHaptics game={game} playerId={0} />
        {/* Đường collider: bật theo cấp (map.showColliders — Campaign) HOẶC debug toàn cục. */}
        {(CONFIG.DEBUG.COLLISION_VECTORS || game.config.map.showColliders) && (
          <>
            <ArenaCollider />
            <ObstacleCollider game={game} />
            {CONFIG.DEBUG.COLLISION_VECTORS && <CollisionDebug game={game} />}
          </>
        )}
      </Canvas>
      {CONFIG.DISPLAY.HUD && (
        <HUD
          stats={stats}
          onRevive={onRevive}
          onRestart={onRestart}
          onSpectate={onSpectate}
          onSpectatePrev={onSpectatePrev}
          onSpectateNext={onSpectateNext}
          playerName={playerName}
          endMode={endMode}
          onReturnToLobby={endMode === "campaign" ? onExit : undefined}
        />
      )}
      <EndGameInterstitial
        won={stats.won}
        kingReached={stats.king || Boolean(stats.kingName)}
      />
      {showMenu && onExit && <MenuButton onExit={onExit} />}
      {CONFIG.DISPLAY.MINIMAP && (
        <MiniMap
          game={game}
          totems={game.totemStates()}
          privacy={{
            radarActive: stats.radarActive ?? false,
            territory: game.territoryCells(),
            entities: game.players.map((entity) => ({
              id: entity.id,
              x: entity.pos.x,
              y: entity.pos.y,
              alive: entity.alive,
            })),
          }}
        />
      )}
      <FpsMeterIfEnabled statusText={`Local · ${game.players.length} người`} />
      <Joystick dir={joystick} />
      {CONFIG.DEBUG.COLLISION_VECTORS && (
        <div
          style={{
            position: "absolute",
            left: 16,
            bottom: onExit ? 64 : 16,
            padding: "8px 12px",
            borderRadius: 10,
            background: "rgba(10,14,22,0.72)",
            color: "#cdd7ea",
            fontFamily: "system-ui, sans-serif",
            fontSize: 12,
            lineHeight: 1.7,
            pointerEvents: "none",
            backdropFilter: "blur(6px)",
          }}
        >
          <div style={{ opacity: 0.6, letterSpacing: 1, marginBottom: 2 }}>
            DEBUG VA CHẠM
          </div>
          <div>
            <span style={{ color: "#3fa9ff" }}>▮</span> Hướng đi ·{" "}
            <span style={{ color: "#ff4d4d" }}>▮</span> Pháp tuyến tường ·{" "}
            <span style={{ color: "#4dff88" }}>▮</span> Hướng trượt
          </div>
        </div>
      )}
    </div>
  );
}
