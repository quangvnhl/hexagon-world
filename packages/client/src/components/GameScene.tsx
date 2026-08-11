"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera } from "@react-three/drei";
import * as THREE from "three";
import { GameState } from "@hexagon/shared";
import { CONFIG } from "@hexagon/shared";
import { axialToPixel, parseKey } from "@hexagon/shared";
import { HexGridView } from "./HexGridView";
import { PlayerCube } from "./PlayerCube";
import { Effects } from "./Effects";
import { TrailLine } from "./TrailLine";
import { BorderRim } from "./BorderRim";
import { CollisionDebug } from "./CollisionDebug";
import { ArenaCollider } from "./ArenaCollider";
import { TerritoryBorders } from "./TerritoryBorders";
import { MiniMap } from "./MiniMap";
import { Joystick } from "./Joystick";
import { HUD, Stats } from "./HUD";
import { FpsMeterIfEnabled } from "./FpsMeter";

interface PointerRef {
  x: number;
  y: number;
  w: number;
  h: number;
  active: boolean;
}

/** Nút quay lại menu (góc dưới-trái). Dùng chung cho scene chơi đơn & online. */
export function MenuButton({ onExit }: { onExit: () => void }) {
  return (
    <button
      onClick={onExit}
      style={{
        position: "absolute",
        left: 16,
        bottom: 16,
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

/** Vòng lặp: đọc chuột → hướng mong muốn, cập nhật game liên tục, bám camera. */
function GameLoop({
  game,
  pointer,
  joystick,
  spectateTargetRef,
  onStats,
}: {
  game: GameState;
  pointer: React.MutableRefObject<PointerRef>;
  joystick: React.MutableRefObject<{ active: boolean; angle: number }>;
  spectateTargetRef: React.MutableRefObject<number>;
  onStats: (s: Stats) => void;
}) {
  const camera = useThree((s) => s.camera);
  const statAcc = useRef(0);
  const lastPhase = useRef(game.phase);
  // Hệ số zoom hiện tại (lerp mượt về target theo diện tích) — bắt đầu ở mức gần nhất.
  const zoom = useRef(CONFIG.CAMERA.ZOOM.MIN);
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
    const { MIN, MAX } = CONFIG.CAMERA.ZOOM;
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

    statAcc.current += dt;
    // Đẩy stats định kỳ; đẩy NGAY khi đổi phase (chết/hồi sinh/vào trận) để popup
    // & đếm ngược phản hồi tức thì.
    if (statAcc.current >= 0.2 || game.phase !== lastPhase.current) {
      statAcc.current = 0;
      lastPhase.current = game.phase;
      onStats({
        pct: game.territoryPct(),
        king: game.isKing,
        deaths: game.deaths,
        phase: game.phase,
        prep: game.prepRemaining,
        scores: game.scores(),
        won: game.won,
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
      });
    }
  });

  return null;
}

export default function GameScene({
  playerName,
  onExit,
}: {
  playerName?: string;
  onExit?: () => void;
} = {}) {
  const game = useMemo(() => new GameState(), []);
  // Gán tên người chơi vào ghế 0 (hiển thị ở xếp hạng / KING / thắng).
  useMemo(() => {
    if (playerName) game.setName(0, playerName);
  }, [game, playerName]);
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

  // Id thực thể ĐANG XEM khi khán giả (-1 = tự bám thực thể dẫn đầu). Nút ◀ ▶ đổi giá trị này.
  const spectateTargetRef = useRef(-1);

  const onStats = useCallback((s: Stats) => setStats(s), []);
  const onRevive = useCallback(() => game.revive(), [game]);
  const onRestart = useCallback(() => game.restart(), [game]);
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
        background: "#0a0e16",
        cursor: "crosshair",
        touchAction: "none",
      }}
    >
      <Canvas>
        <PerspectiveCamera
          makeDefault
          position={CONFIG.CAMERA.OFFSET}
          fov={CONFIG.CAMERA.FOV}
          near={0.1}
          far={1000}
        />
        <color attach="background" args={["#0a0e16"]} />
        <ambientLight intensity={0.8} />
        <directionalLight position={[4, 6, 12]} intensity={1.15} />

        <GameLoop
          game={game}
          pointer={pointer}
          joystick={joystick}
          spectateTargetRef={spectateTargetRef}
          onStats={onStats}
        />
        <HexGridView game={game} />
        {CONFIG.DISPLAY.TERRITORY_BORDERS && <TerritoryBorders game={game} />}
        <BorderRim game={game} />
        <TrailLine game={game} />
        <PlayerCube game={game} />
        {CONFIG.DISPLAY.PARTICLES && <Effects game={game} />}
        {CONFIG.DEBUG.COLLISION_VECTORS && (
          <>
            <ArenaCollider />
            <CollisionDebug game={game} />
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
        />
      )}
      {onExit && <MenuButton onExit={onExit} />}
      {CONFIG.DISPLAY.MINIMAP && <MiniMap game={game} />}
      <FpsMeterIfEnabled />
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
