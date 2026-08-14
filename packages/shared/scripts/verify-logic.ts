// Kiểm chứng logic thuần (không cần render): hex math, hex line-draw, flood fill,
// capture khi di chuyển liên tục, và tự cắt đuôi → chết.
import {
  mapCells,
  mapRect,
  key,
  axialToPixel,
  hexLinedraw,
  keyOf,
  cubeDistance,
  parseKey,
  pixelToAxial,
} from "../src/hex";
import { captureEnclosed } from "../src/floodfill";
import { GameState, Entity, Phase } from "../src/state";
import { CONFIG, PLAYER_COLORS } from "../src/config";
import { insideArena, ARENA_INRADIUS, ARENA_R, WALL_LIMIT } from "../src/arena";

/** Cho game qua hết pha chuẩn bị (đứng yên 3s) để bắt đầu di chuyển. */
function skipPrep(g: GameState) {
  const steps = Math.ceil(CONFIG.PREP_TIME / (1 / 60)) + 2;
  for (let i = 0; i < steps; i++) g.update(1 / 60);
}

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
// Dùng CONFIG.HEX_SIZE để điểm world khớp đúng ô dưới hệ toạ độ thực (không hardcode 1).
function go(g: GameState, q: number, r: number) {
  const p = axialToPixel({ q, r }, CONFIG.HEX_SIZE);
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
  const g = new GameState({ q: 0, r: 0 }, 0); // spawn cố định tại gốc cho test
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

console.log("[5] GameState: tự cắt đuôi → chết (mất đất, chờ hồi sinh)");
{
  const g = new GameState({ q: 0, r: 0 }, 0);
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
  check("vào trạng thái chết", g.phase === "dead");
  check("mất toàn bộ đất khi chết", g.owned.size === 0);
  check("đuôi rỗng sau khi chết", g.trailHexes.length === 0);
  // Hồi sinh → cụm 7 ô, vào pha chuẩn bị.
  g.revive();
  check("hồi sinh: cụm spawn đúng 7 ô", g.owned.size === 7);
  check("hồi sinh: vào pha chuẩn bị", g.phase === "prep");
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

console.log("[7] GameState: chạm biên LỤC GIÁC → trượt mượt, không lọt/đứng");
{
  const g = new GameState({ q: 0, r: 0 }, 0);
  g.setHeadingTarget(0.3); // chếch lên phải → ép vào 1 cạnh rồi trượt dọc cạnh
  skipPrep(g);
  // Chạy tới khi VỪA chạm biên (còn sống). Ngân sách bước co giãn theo bán kính sân
  // (đi ~SPEED/60 world mỗi bước) để không phụ thuộc ARENA_RADIUS.
  const maxSteps = Math.ceil(
    (ARENA_INRADIUS / (CONFIG.SPEED.BY_KING_PCT.MIN / 60)) * 1.4,
  ) + 300;
  let reached = false;
  for (let i = 0; i < maxSteps && !reached; i++) {
    g.update(1 / 60);
    if (g.phase === "playing" && !insideArena(g.pos.x, g.pos.y, -0.8)) {
      reached = true;
    }
  }
  check("tới sát biên khi còn sống", reached);
  // Vài bước kế: vẫn di chuyển (trượt, không đứng) và không lọt ra ngoài.
  let movedTotal = 0;
  let insideOK = true;
  for (let j = 0; j < 20 && g.phase === "playing"; j++) {
    const a = { x: g.pos.x, y: g.pos.y };
    g.update(1 / 60);
    movedTotal += Math.hypot(g.pos.x - a.x, g.pos.y - a.y);
    if (!insideArena(g.pos.x, g.pos.y, 1e-6)) insideOK = false;
  }
  check("vẫn trượt dọc biên (không đứng yên)", movedTotal > 0.05);
  check("không lọt ra ngoài lục giác", insideOK);
}

console.log("[8] GameState: pha chuẩn bị đứng yên, chỉ xoay hướng");
{
  const g = new GameState({ q: 0, r: 0 }, 0);
  const p0 = { x: g.pos.x, y: g.pos.y };
  g.setHeadingTarget(1.2);
  for (let i = 0; i < 30; i++) g.update(1 / 60); // 0.5s trong pha prep
  check("đang ở pha chuẩn bị", g.phase === "prep");
  check(
    "không di chuyển khi chuẩn bị",
    Math.hypot(g.pos.x - p0.x, g.pos.y - p0.y) < 1e-9
  );
  check("nhưng có xoay hướng", Math.abs(g.heading) > 0.05);
  skipPrep(g);
  check("hết giờ chuẩn bị → vào trận", g.phase === "playing");
}

console.log("[9] Bots: khởi tạo & hoạt động (đa thực thể)");
{
  const g = new GameState(undefined, 3);
  check("tổng 4 thực thể (1 người + 3 bot)", g.players.length === 4);
  check("players[0] là người", !g.players[0].isBot);
  check(
    "3 thực thể còn lại là bot",
    g.players.slice(1).every((e) => e.isBot)
  );
  check(
    "mỗi thực thể khởi đầu đúng 7 ô",
    g.players.every((e) => e.owned.size === 7)
  );
  check("scores() có 4 dòng", g.scores().length === 4);
  const before = g.players.map((e) => ({ x: e.pos.x, y: e.pos.y }));
  for (let i = 0; i < 600; i++) g.update(1 / 60); // ~10s: qua prep + chơi
  const active = g.players
    .slice(1)
    .some(
      (e, idx) =>
        Math.hypot(e.pos.x - before[idx + 1].x, e.pos.y - before[idx + 1].y) >
          1 || e.deaths > 0
    );
  check("bot có hoạt động (di chuyển / chết-hồi sinh)", active);
  check(
    "không lọt biên: mọi thực thể trong sân",
    g.players.every((e) => insideArena(e.pos.x, e.pos.y, 1e-3))
  );
}

console.log("[10] Spawn tránh xa lãnh thổ đã chiếm (SPAWN_CLEARANCE)");
{
  const g = new GameState({ q: 0, r: 0 }, 0); // người chơi giữ cụm 7 ô quanh gốc
  const e = new Entity(9, true, PLAYER_COLORS[1]);
  let ok = true;
  for (let t = 0; t < 20; t++) {
    const s = (g as any).pickSpawnHex(e) as { q: number; r: number } | null;
    if (!s || cubeDistance(s, { q: 0, r: 0 }) <= CONFIG.SPAWN_CLEARANCE) {
      ok = false;
      break;
    }
  }
  check("mọi lần spawn cách cụm đã chiếm > SPAWN_CLEARANCE", ok);
}

console.log("[11] Khoá phòng khi có KING (không cho hồi sinh tới khi mất ngôi)");
{
  // 2 bot: hạ 1 bot vẫn còn bot khác sống → KHÔNG kích hoạt thắng-đấu-loại,
  // để kiểm tra riêng luật khoá/​mở phòng.
  const g = new GameState({ q: 0, r: 0 }, 2);
  const bot = g.players[1];
  const half = [...g.playable].slice(0, Math.ceil(g.playable.size * 0.5));
  g.owned = new Set(half); // người chơi thành KING
  check("có KING → phòng khoá", g.roomLocked());
  check("kingId = 0 (người chơi)", g.kingId() === 0);

  (g as any).kill(bot); // bot chết
  const frames = Math.ceil((CONFIG.BOT.RESPAWN_DELAY + 1) / (1 / 60));
  for (let i = 0; i < frames; i++) g.update(1 / 60);
  check("bot KHÔNG hồi sinh khi phòng khoá", bot.phase === "dead");

  g.owned = new Set([...g.owned].slice(0, 3)); // người chơi tụt dưới ngưỡng
  check("mất KING → phòng mở lại", !g.roomLocked());
  for (let i = 0; i < frames; i++) g.update(1 / 60);
  check("phòng mở → bot được hồi sinh lại", bot.phase !== "dead");
}

console.log("[12] Người chơi bị chặn hồi sinh khi đối thủ đang là KING");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const human = g.players[0];
  const bot = g.players[1];
  for (const k of [...g.playable].slice(0, Math.ceil(g.playable.size * 0.5))) {
    (g as any).claimCell(k, bot); // bot thành KING
  }
  check("bot là KING", g.kingId() === 1);
  g.die(); // người chơi chết
  g.revive(); // cố hồi sinh khi phòng bị khoá
  check("revive() bị chặn khi phòng khoá", human.phase === "dead");
}

console.log("[13] Đâm đuôi đối thủ nằm TRONG đất của mình → đối thủ chết");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const human = g.players[0];
  const bot = g.players[1];
  const K = key(1, 0); // ô người chơi sở hữu (thuộc cụm 7 ô quanh gốc)
  check("(1,0) là đất của người chơi", human.owned.has(K));
  // Đặt 1 ô đuôi của bot ĐÈ lên ô đất của người chơi.
  (g as any).cellTrail.set(K, bot.id);
  bot.trailHexes.push(K);
  bot.trailSet.add(K);
  const before = bot.deaths;
  go(g, 1, 0); // đầu người chơi bước vào (1,0)
  check("đâm đuôi địch trong đất mình → địch chết", bot.phase === "dead");
  check("người chơi KHÔNG chết", human.phase !== "dead");
  check("bot deaths tăng", bot.deaths === before + 1);
}

console.log("[14] Va chạm ĐẦU: kẻ xâm nhập đứng trên đất mình bị hạ");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const human = g.players[0];
  const bot = g.players[1];
  human.phase = "playing" as Phase;
  bot.phase = "playing" as Phase;
  const p = axialToPixel({ q: 1, r: 0 }, CONFIG.HEX_SIZE); // ô đất của người chơi
  bot.pos = { x: p.x, y: p.y };
  bot.currentHex = { q: 1, r: 0 };
  human.pos = { x: p.x + 0.1, y: p.y }; // đầu người sát đầu bot (< KILL_RADIUS)
  human.currentHex = { q: 1, r: 0 };
  const before = bot.deaths;
  g.update(1 / 60);
  check("kẻ xâm nhập trên đất mình bị hạ (va đầu)", bot.phase === "dead");
  check("chủ đất KHÔNG chết", human.phase !== "dead");
  check("bot deaths tăng", bot.deaths === before + 1);
}

console.log("[15] Hạ đối thủ → toàn bộ đất của đối thủ về tay người hạ");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const human = g.players[0];
  const bot = g.players[1];
  const humanBefore = human.owned.size; // 7
  const botLand = bot.owned.size; // 7 (ở cụm xa)
  const K = key(3, 0); // ô trung lập
  (g as any).cellTrail.set(K, bot.id);
  bot.trailHexes.push(K);
  bot.trailSet.add(K);
  go(g, 3, 0); // người chơi đi tới (3,0), cắt đuôi bot
  check("bot bị hạ", bot.phase === "dead");
  check("bot mất sạch đất", bot.owned.size === 0);
  check(
    "đất bot chuyển cho người hạ",
    human.owned.size >= humanBefore + botLand
  );
}

console.log("[16] Thắng do ĐẤU LOẠI: có KING và chỉ còn 1 người sống");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const bot = g.players[1];
  g.owned = new Set([...g.playable].slice(0, Math.ceil(g.playable.size * 0.5)));
  check("phòng có KING", g.roomLocked());
  (g as any).kill(bot); // hạ bot → chỉ còn người chơi sống
  g.update(1 / 60);
  check("chỉ còn 1 người + có KING → thắng ngay", g.won === true);
  check("winnerId = 0 (người chơi)", g.winnerId === 0);
}

console.log("[17] Va đầu ở ô TRUNG LẬP → cả hai chết & mất sạch đất");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  const human = g.players[0];
  const bot = g.players[1];
  human.phase = "playing" as Phase;
  bot.phase = "playing" as Phase;
  const cell = { q: 5, r: 0 };
  (g as any).cellOwner.delete(key(cell.q, cell.r)); // đảm bảo ô trung lập
  const p = axialToPixel(cell, CONFIG.HEX_SIZE);
  human.pos = { x: p.x, y: p.y };
  human.currentHex = { ...cell };
  bot.pos = { x: p.x + 0.1, y: p.y }; // sát nhau (< KILL_RADIUS)
  bot.currentHex = { ...cell };
  check("trước va chạm cả hai còn đất", human.owned.size > 0 && bot.owned.size > 0);
  g.update(1 / 60);
  check("người chết", human.phase === "dead");
  check("bot chết", bot.phase === "dead");
  check("người mất sạch đất", human.owned.size === 0);
  check("bot mất sạch đất", bot.owned.size === 0);
}

console.log("[18] Hồi sinh strict: hết chỗ hợp lệ → không spawn; giải phóng → spawn lại");
{
  const g = new GameState(undefined, 1); // không fixedSpawn để test đúng logic
  const bot = g.players[1];
  for (const k of g.playable) (g as any).claimCell(k, bot); // lấp đầy bản đồ
  check("bản đồ đầy → pickSpawnHex = null", (g as any).pickSpawnHex(g.human) === null);
  g.die();
  check("bản đồ đầy → revive() bị chặn", g.revive() === false);
  check("→ người chơi vẫn chết", g.human.phase === "dead");
  // Chọn một tâm nằm đủ sâu trong sân và ngoài vùng cấm quanh totem, rồi giải phóng
  // đúng bán kính spawn. Không cố định (0,0): sau khi có totem, tâm bản đồ có thể
  // chủ động bị loại khỏi tập spawn hợp lệ.
  const inset = (CONFIG.START_RADIUS + 1) * CONFIG.HEX_SIZE * Math.sqrt(3);
  const spawnCenter = [...g.playable]
    .map(parseKey)
    .find((candidate) => {
      const cp = axialToPixel(candidate, CONFIG.HEX_SIZE);
      if (!insideArena(cp.x, cp.y, -inset)) return false;
      return g.totemStates().every((totem) => {
        const tp = axialToPixel(totem, CONFIG.HEX_SIZE);
        return Math.hypot(cp.x - tp.x, cp.y - tp.y) >= CONFIG.TOTEMS.SPAWN_CLEARANCE;
      });
    });
  if (!spawnCenter) throw new Error("Không tìm được tâm spawn hợp lệ cho fixture");
  for (const k of [...g.playable]) {
    if (cubeDistance(parseKey(k), spawnCenter) <= CONFIG.SPAWN_CLEARANCE) {
      (g as any).cellOwner.delete(k);
    }
  }
  check(
    "giải phóng đủ chỗ → lại có ô spawn hợp lệ",
    (g as any).pickSpawnHex(g.human) !== null
  );
}

console.log("[19] Khán giả: chọn XEM → không hồi sinh nữa; restart mới chơi lại");
{
  const g = new GameState({ q: 0, r: 0 }, 1);
  g.die(); // người chơi chết
  check("trước khi xem: có thể hồi sinh", g.canRevive() === true);
  g.spectate();
  check("đã chọn XEM", g.spectating === true);
  check("khi xem: canRevive = false", g.canRevive() === false);
  check("khi xem: revive() bị chặn", g.revive() === false);
  check("vẫn ở trạng thái chết", g.human.phase === "dead");
  g.restart(); // hết ván → chơi lại
  check("restart: hết chế độ xem", g.spectating === false);
  check("restart: người chơi sống lại (chuẩn bị)", g.human.phase === "prep");
  // leaderId trả về thực thể còn sống có nhiều đất nhất
  const lid = g.leaderId();
  check("leaderId hợp lệ (0..n) khi có người sống", lid >= 0);
}

console.log("[20] Đường line bắt đầu TRONG ô trung lập đầu tiên (không phải ô đất)");
{
  // (a) Bước nhảy nhiều ô một lần → lùi về tâm ô trung lập đầu (fallback an toàn).
  const g = new GameState({ q: 0, r: 0 }, 0);
  // human giữ cụm dist≤1 quanh gốc → đi sang (3,0): (1,0)=đất, (2,0)=ô trung lập đầu.
  go(g, 3, 0);
  const first = g.trailPoints[0];
  check("có điểm line đầu tiên", !!first);
  check(
    "điểm đầu NẰM TRONG ô trung lập (2,0)",
    !!first && keyOf(pixelToAxial(first.x, first.y, CONFIG.HEX_SIZE)) === key(2, 0)
  );
  const c1 = axialToPixel({ q: 1, r: 0 }, CONFIG.HEX_SIZE);
  check(
    "KHÔNG bắt đầu từ ô đất (1,0)",
    !first || Math.hypot(first.x - c1.x, first.y - c1.y) > 1e-6
  );

  // (b) Di chuyển LIÊN TỤC bước nhỏ ra ô trung lập đầu → điểm neo là vị trí đầu thực
  //     (bắt đầu "bình thường"), vẫn nằm trong ô trung lập đầu và KHÔNG snap về tâm.
  const g2 = new GameState({ q: 0, r: 0 }, 0);
  const c2 = axialToPixel({ q: 2, r: 0 }, CONFIG.HEX_SIZE);
  const step = CONFIG.HEX_SIZE * 0.25;
  for (let x = step; x <= c2.x + 1e-6; x += step) g2.moveTo(x, 0);
  const f2 = g2.trailPoints[0];
  check("(liên tục) có điểm line đầu tiên", !!f2);
  check(
    "(liên tục) điểm đầu nằm trong ô trung lập (2,0)",
    !!f2 && keyOf(pixelToAxial(f2.x, f2.y, CONFIG.HEX_SIZE)) === key(2, 0)
  );
  check(
    "(liên tục) điểm đầu KHÔNG bị snap về tâm ô (2,0)",
    !!f2 && Math.hypot(f2.x - c2.x, f2.y - c2.y) > 1e-6
  );
}

console.log("[21] Ghi LÝ DO CHẾT + ảnh chụp lãnh thổ");
{
  // (a) Tự cắt đuôi → "self". Đặt đầu ở ô trung lập (2,0), đuôi mình ở (3,0), bước vào.
  const g = new GameState({ q: 0, r: 0 }, 0);
  const human = g.players[0];
  human.phase = "playing" as Phase;
  const start = axialToPixel({ q: 2, r: 0 }, CONFIG.HEX_SIZE);
  human.pos = { x: start.x, y: start.y };
  human.currentHex = { q: 2, r: 0 };
  const K = key(3, 0);
  // Cắt vào một đoạn CŨ hơn grace window. Chỉ một ô đuôi mới nhất không còn là ca tự-cắt
  // hợp lệ vì SELF_TRAIL_GRACE chủ đích bỏ qua dao động hex sát đầu.
  const ownTrail = [K, key(4, 0), key(5, 0)];
  for (const trailKey of ownTrail) {
    (g as any).cellTrail.set(trailKey, human.id);
    human.trailHexes.push(trailKey);
    human.trailSet.add(trailKey);
  }
  const pctBefore = g.territoryPct();
  const p3 = axialToPixel({ q: 3, r: 0 }, CONFIG.HEX_SIZE);
  (g as any).stepEntity(human, p3.x, p3.y); // đầu bước vào chính ô đuôi của mình
  check("tự cắt đuôi → chết", human.phase === "dead");
  check("deathCause = self", human.deathCause === "self");
  check("killerId = -1 (tự chết)", human.killerId === -1);
  check("lastPct chụp đúng % trước khi chết", Math.abs(human.lastPct - pctBefore) < 1e-6);
  check("lastTerritory có ô (ảnh chụp đất)", human.lastTerritory.length > 0);

  // (b) Bị đối thủ cắt đuôi → "cut" + killerId là kẻ cắt.
  const g2 = new GameState({ q: 0, r: 0 }, 1);
  const h2 = g2.players[0];
  const bot = g2.players[1];
  const K2 = key(1, 0); // đuôi người chơi đặt trên đất mình
  (g2 as any).cellTrail.set(K2, h2.id);
  h2.trailHexes.push(K2);
  h2.trailSet.add(K2);
  // bot bước vào ô đuôi người chơi.
  const p = axialToPixel({ q: 1, r: 0 }, CONFIG.HEX_SIZE);
  (g2 as any).stepEntity(bot, p.x, p.y);
  check("bị cắt đuôi → chết", h2.phase === "dead");
  check("deathCause = cut", h2.deathCause === "cut");
  check("killerId = id bot cắt đuôi", h2.killerId === bot.id);

  // (c) Va đầu ngoài sân nhà → "headMutual".
  const g3 = new GameState({ q: 0, r: 0 }, 1);
  const h3 = g3.players[0];
  const b3 = g3.players[1];
  h3.phase = "playing" as Phase;
  b3.phase = "playing" as Phase;
  const cell = { q: 5, r: 0 };
  (g3 as any).cellOwner.delete(key(cell.q, cell.r));
  const pc = axialToPixel(cell, CONFIG.HEX_SIZE);
  h3.pos = { x: pc.x, y: pc.y };
  h3.currentHex = { ...cell };
  b3.pos = { x: pc.x + 0.1, y: pc.y };
  b3.currentHex = { ...cell };
  g3.update(1 / 60);
  check("va đầu trung lập → cả hai chết", h3.phase === "dead" && b3.phase === "dead");
  check("deathCause = headMutual", h3.deathCause === "headMutual");
}

console.log("[22] Húc thẳng vào TƯỜNG/GÓC (đang mang đuôi) → KHÔNG chết oan 'tự đâm đuôi'");
{
  const g = new GameState({ q: 0, r: 0 }, 0);
  const human = g.players[0];
  human.phase = "playing" as Phase;
  // Đặt đầu sát ĐỈNH phải (góc 0°, nơi 2 tường gặp nhau) và 1 ô đuôi ngay phía sau.
  const headX = ARENA_R - 0.6;
  human.pos = { x: headX, y: 0 };
  human.currentHex = pixelToAxial(headX, 0, CONFIG.HEX_SIZE);
  const bcell = pixelToAxial(headX - 1.6, 0, CONFIG.HEX_SIZE);
  const bk = keyOf(bcell);
  (g as any).cellTrail.set(bk, human.id);
  human.trailHexes.push(bk);
  human.trailSet.add(bk);
  human.heading = 0; // húc thẳng vào góc phải
  human.targetHeading = 0;
  for (let i = 0; i < 180; i++) g.update(1 / 60);
  check("húc góc: KHÔNG chết", human.phase !== "dead");
  check("húc góc: KHÔNG bị gán lý do 'self'", human.deathCause !== "self");
  // Đầu vẫn ÁP SÁT tường (trượt dọc tường) chứ không bị hất ngược vào trong.
  const maxDot = Math.max(
    ...Array.from({ length: 6 }, (_, k) => {
      const ang = Math.PI / 6 + k * (Math.PI / 3);
      return human.pos.x * Math.cos(ang) + human.pos.y * Math.sin(ang);
    })
  );
  // So với biên VA CHẠM thật (đã nhân WALL_SCALE), không phải inradius hình học dùng render.
  check("húc góc: đầu vẫn áp sát tường (trượt, không lùi)", maxDot >= WALL_LIMIT - 0.5);
}

console.log("");
console.log(`KẾT QUẢ: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
