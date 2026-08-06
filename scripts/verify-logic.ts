// Kiểm chứng logic thuần (không cần render): hex math, hex line-draw, flood fill,
// capture khi di chuyển liên tục, và tự cắt đuôi → chết.
import {
  mapCells,
  mapRect,
  key,
  axialToPixel,
  hexLinedraw,
  keyOf,
} from "../src/game/hex";
import { captureEnclosed } from "../src/game/floodfill";
import { GameState } from "../src/game/state";
import { CONFIG } from "../src/game/config";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    pass++;
    console.log("  ✓ " + name);
  } else {
    fail++;
    console.log("  ✗ " + name);
  }
}

// Đưa đầu tới tâm ô (q,r) qua API di chuyển liên tục.
function go(g: GameState, q: number, r: number) {
  const p = axialToPixel({ q, r }, 1);
  g.moveTo(p.x, p.y);
}

console.log("[1] mapCells: số ô đúng công thức 3R²+3R+1");
for (const R of [1, 2, 5, 26]) {
  const n = mapCells(R).size;
  check(`R=${R} → ${n}`, n === 3 * R * R + 3 * R + 1);
}

console.log("[2] hexLinedraw: nội suy đường thẳng hex liền mạch");
{
  const l1 = hexLinedraw({ q: 0, r: 0 }, { q: 3, r: 0 }).map(keyOf);
  check("(0,0)→(3,0) = 4 ô liên tiếp", l1.join(" ") === "0,0 1,0 2,0 3,0");
  const l2 = hexLinedraw({ q: 0, r: 0 }, { q: 0, r: 3 }).map(keyOf);
  check("(0,0)→(0,3) = 4 ô", l2.join(" ") === "0,0 0,1 0,2 0,3");
}

console.log("[3] captureEnclosed: bao vây 1 ô (1,0)");
{
  const map = mapCells(3);
  const owned = new Set([key(0, 0)]);
  const trail = [key(2, 0), key(2, -1), key(1, -1), key(0, 1), key(1, 1)];
  const res = captureEnclosed(map, owned, trail);
  check("chiếm ô bên trong (1,0)", res.has(key(1, 0)));
  check("tổng cộng 7 ô", res.size === 7);
  check("KHÔNG chiếm ô xa (0,-3)", !res.has(key(0, -3)));
}

console.log("[4] GameState (liên tục): đi vòng khép kín → chiếm đất");
{
  const g = new GameState();
  g.owned = new Set([key(0, 0)]); // ép về 1 ô để dựng vòng nhỏ
  // Đi vòng quanh ô (1,0) rồi về (0,0).
  for (const [q, r] of [
    [1, -1],
    [2, -1],
    [2, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ] as const) {
    go(g, q, r);
  }
  check("không chết", g.deaths === 0);
  check("đuôi đã dọn sau khi chiếm", g.trailHexes.length === 0);
  check("đường vẽ đuôi đã xoá", g.trailPoints.length === 0);
  check("chiếm được ô bị nhốt (1,0)", g.owned.has(key(1, 0)));
  check("owned = 7 ô", g.owned.size === 7);
}

console.log("[5] GameState (liên tục): tự cắt đuôi → chết & reset");
{
  const g = new GameState();
  g.owned = new Set([key(0, 0)]);
  const before = g.deaths;
  for (const [q, r] of [
    [1, 0],
    [2, 0],
    [3, 0],
    [3, -1],
    [2, 0], // (2,0) đang là đuôi → cắt vào chính mình
  ] as const) {
    go(g, q, r);
  }
  check("đâm đuôi → deaths tăng", g.deaths === before + 1);
  check("hồi sinh cụm spawn (owned > 7)", g.owned.size > 7);
  check("đuôi rỗng sau reset", g.trailHexes.length === 0);
}

console.log("[6] mapRect: sân chữ nhật có ô, biên trong khung");
{
  const m = mapRect(10, 6, 1);
  check("có ô", m.size > 0);
  let ok = true;
  for (const k of m) {
    const [q, r] = k.split(",").map(Number);
    const p = axialToPixel({ q, r }, 1);
    if (Math.abs(p.x) > 10 + 1e-9 || Math.abs(p.y) > 6 + 1e-9) ok = false;
  }
  check("mọi tâm ô nằm trong khung [±10, ±6]", ok);
}

console.log("[7] GameState: chạm biên thẳng → trượt mượt, không lọt/đứng");
{
  const g = new GameState();
  g.setHeadingTarget(0.4); // chếch lên phải → ép vào biên phải rồi trượt lên
  let maxX = 0;
  for (let i = 0; i < 650; i++) {
    g.update(1 / 60);
    maxX = Math.max(maxX, Math.abs(g.pos.x));
  }
  check("không lọt qua biên (|x| ≤ halfW)", maxX <= CONFIG.ARENA_HALF_W + 1e-6);
  check("đã chạm tới biên phải", g.pos.x > CONFIG.ARENA_HALF_W - 1);
  const a = { x: g.pos.x, y: g.pos.y };
  g.update(1 / 60);
  const moved = Math.hypot(g.pos.x - a.x, g.pos.y - a.y);
  check("vẫn trượt (không đứng yên ở biên)", moved > 1e-4);
}

console.log("");
console.log(`KẾT QUẢ: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
