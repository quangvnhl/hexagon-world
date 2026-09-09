import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { minPlausibleSeconds, SAFETY_FACTOR } from "../../packages/server/src/campaign/campaign-sanity";

/**
 * doc 36 §R2 tầng 2 — luồng TIỀN xuyên HTTP thật (lát r2.2).
 *
 * ┌─ THỨ TẦNG NÀY BẮT ĐƯỢC MÀ UNIT TEST KHÔNG ──────────────────────────────────────────────────┐
 * │ Mọi lát tiền trước đây đều kiểm bằng database GIẢ. Database giả luôn trả cái ta bảo nó trả,  │
 * │ nên nó không bao giờ bắt được: RPC đặt sai tên tham số, `on conflict` không khớp ràng buộc   │
 * │ thật, quyền RLS chặn, hay một khoá idempotency được coi là duy nhất ở TS mà không duy nhất ở │
 * │ Postgres. Tất cả những thứ đó chỉ lộ ra khi chạm database thật.                               │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─ HAI PHÉP ĐO ĐẮT NHẤT TRONG FILE ───────────────────────────────────────────────────────────┐
 * │ Không phải "mua được năng lượng" hay "qua được màn" — hai cái đó hỏng thì thấy ngay. Đắt     │
 * │ nhất là hai phép GỌI LẠI:                                                                    │
 * │   • mua năng lượng lần hai với CÙNG khoá idempotency ⇒ không trừ thêm đồng nào;              │
 * │   • nộp lại CÙNG một lượt chơi ⇒ không thưởng thêm đồng nào.                                 │
 * │ Đó là hai chỗ tiền tự sinh ra hoặc tự mất đi mà không ai thấy, vì lần gọi lại nào cũng trông │
 * │ y hệt lần đầu trong log.                                                                     │
 * └──────────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * KHÔNG GÁN CỨNG MỘT CON SỐ TIỀN NÀO. Phần thưởng đọc từ `campaign_levels.rewards`, giá nạp đọc từ
 * `GET /v1/energy`, thời gian phải chờ tính bằng CHÍNH hàm server dùng để chặn. Gán cứng thì bài
 * test sẽ đỏ mỗi lần admin đổi cấu hình — mà đổi cấu hình là việc hợp lệ, nên loại đỏ đó dạy người
 * ta sửa test cho khớp thay vì đọc xem có gì hỏng thật.
 *
 * Người chơi: `seed-e2e-money` do `supabase/seed.sql` dựng (lát r3.2). Đăng nhập dev đặt
 * provider_user_id là `dev:<tên viết thường>` nên tên này rơi đúng vào hàng đã seed.
 */

const DB_URL = process.env.SUPABASE_DB_URL ?? "";
const PLAYER = "seed-e2e-money";
const LEVEL = "c1";

// Thiếu `SUPABASE_DB_URL` ⇒ ĐỎ NGAY, không bỏ qua.
//
// Bản đầu dùng `test.skip(!DB_URL, …)` và cổng review của repo chặn đúng — nó chặn mọi `test.skip`.
// Ở đây cổng nói đúng chứ không phải chặn nhầm: file này KHÔNG nằm trong CI mỗi PR (nó chỉ chạy
// qua `pnpm test:e2e:money`, tức job thủ công), nên không có tình huống nào mà bỏ qua im lặng giúp
// được ai. Ngược lại: quên gắn secret sẽ cho ra một job XANH không kiểm một đồng nào — mà "xanh"
// là tín hiệu người ta dùng để quyết định phát hành. Với một bài kiểm TIỀN, im lặng không kiểm gì
// còn tệ hơn đỏ, vì đỏ thì có người đi sửa.
if (!DB_URL) {
  throw new Error("Thiếu SUPABASE_DB_URL. Bài này kiểm tiền trên database thật; chạy mà không có database thì nó không kiểm gì. Đặt biến trong .env hoặc trong secret của môi trường CI.");
}

let db: pg.Client;
test.beforeAll(async () => {
  db = new pg.Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await db.connect();
});
test.afterAll(async () => { await db?.end(); });

/** id của người chơi seed — TÍNH ĐƯỢC, đúng sơ đồ `md5(khoá tự nhiên)::uuid` của seed.sql. */
async function seedPlayerId(): Promise<string> {
  const r = await db.query("select md5($1)::uuid as id", [PLAYER]);
  return r.rows[0].id as string;
}

/** Số dư coin đọc TỪ DATABASE — nguồn cuối cùng, không qua lớp trình bày nào. */
async function coinBalance(playerId: string): Promise<number> {
  const r = await db.query(
    "select balance from player_wallets where player_id = $1 and currency_code = 'coin'", [playerId]);
  return Number(r.rows[0]?.balance ?? 0);
}

/** Số dòng sổ cái của người chơi. Sổ cái là thứ giải thích VÌ SAO số dư đổi. */
async function ledgerCount(playerId: string): Promise<number> {
  const r = await db.query("select count(*)::int as n from wallet_ledger where player_id = $1", [playerId]);
  return r.rows[0].n as number;
}

/** Dòng sổ cái mới nhất. */
async function lastLedger(playerId: string) {
  const r = await db.query(
    `select delta::int, reason, reference_type, balance_after::int
     from wallet_ledger where player_id = $1 order by created_at desc limit 1`, [playerId]);
  return r.rows[0] as { delta: number; reason: string; reference_type: string; balance_after: number } | undefined;
}

async function login(request: APIRequestContext): Promise<void> {
  const res = await request.post("/v1/auth/dev", { data: { name: PLAYER } });
  expect(res.ok(), `đăng nhập dev thất bại: ${res.status()} ${await res.text()}`).toBeTruthy();
}

test("luồng tiền: nạp năng lượng bằng coin → chơi c1 → nhận thưởng, và gọi lại KHÔNG sinh tiền", async ({ request }) => {
  const playerId = await seedPlayerId();

  // Cấu hình + phần thưởng đọc từ database, giống hệt nguồn server chấm điểm.
  const lvl = await db.query("select config, rewards from campaign_levels where id = $1 and published = true", [LEVEL]);
  expect(lvl.rows.length, `cấp ${LEVEL} phải tồn tại và đã publish`).toBe(1);
  const config = lvl.rows[0].config as Record<string, unknown>;
  const rewardCoin = Number((lvl.rows[0].rewards as { coin?: number }).coin ?? 0);
  expect(rewardCoin, "cấp dùng để kiểm luồng tiền phải có thưởng coin > 0").toBeGreaterThan(0);

  await login(request);

  await test.step("mua năng lượng bằng coin: ví giảm ĐÚNG giá, sổ cái ghi đúng một dòng", async () => {
    // Tự dựng tiền đề, KHÔNG tin vào giá trị seed. Hai lý do, cái thứ hai quan trọng hơn:
    //  1. Năng lượng hồi theo thời gian, nên giá trị seed trôi ngay sau lần chạy đầu.
    //  2. Ở BÌNH ĐẦY, `purchase_energy_with_coin` vẫn trừ coin nhưng `grant_energy` cộng được 0 —
    //     người chơi trả tiền và không nhận gì. Đo được: 50/50 ⇒ coin −100, năng lượng +0.
    //     Đó là một lỗi THẬT (xem PR của lát này), không phải thứ bước này đang kiểm. Bước này
    //     kiểm đường mua BÌNH THƯỜNG, nên nó phải bắt đầu từ chỗ còn dư địa để nhận.
    await db.query("update player_energy set energy_current = 0, last_refill_at = now() where player_id = $1", [playerId]);

    const status = await (await request.get("/v1/energy")).json();
    const cost = Number(status.refill_coin_cost);
    const grant = Number(status.refill_energy_amount);
    expect(cost, "giá nạp phải > 0, nếu không thì phép đo dưới đây vô nghĩa").toBeGreaterThan(0);

    const coinBefore = await coinBalance(playerId);
    const ledgerBefore = await ledgerCount(playerId);
    expect(coinBefore, `${PLAYER} phải có đủ coin để mua — chạy lại db-seed nếu thiếu`).toBeGreaterThanOrEqual(cost);

    const key = randomUUID();
    const bought = await request.post("/v1/energy/purchase", { data: { idempotencyKey: key } });
    expect(bought.ok(), `mua năng lượng thất bại: ${bought.status()} ${await bought.text()}`).toBeTruthy();
    const after = await bought.json();

    expect(await coinBalance(playerId), "ví phải giảm đúng bằng giá nạp").toBe(coinBefore - cost);
    expect(Number(after.current) - Number(status.current), "năng lượng phải tăng đúng bằng gói").toBe(grant);

    // Sổ cái: đúng MỘT dòng mới, và nó phải giải thích được số dư mới. Chỉ kiểm số dư thôi thì một
    // lỗi ghi thiếu sổ sẽ lọt — mà sổ cái mới là thứ dùng để đối soát khi có tranh chấp.
    expect(await ledgerCount(playerId), "một lần mua = đúng một dòng sổ cái").toBe(ledgerBefore + 1);
    const row = await lastLedger(playerId);
    expect(row?.delta, "dòng sổ phải ghi khoản trừ đúng bằng giá").toBe(-cost);
    expect(row?.balance_after, "balance_after phải khớp số dư thật").toBe(coinBefore - cost);

    await test.step("GỌI LẠI cùng khoá idempotency ⇒ không trừ thêm đồng nào", async () => {
      const coinNow = await coinBalance(playerId);
      const ledgerNow = await ledgerCount(playerId);
      const again = await request.post("/v1/energy/purchase", { data: { idempotencyKey: key } });
      expect(again.ok()).toBeTruthy();
      expect(await coinBalance(playerId), "mua lại cùng khoá KHÔNG được trừ thêm").toBe(coinNow);
      expect(await ledgerCount(playerId), "mua lại cùng khoá KHÔNG được ghi thêm dòng sổ").toBe(ledgerNow);
    });
  });

  let playId = "";
  await test.step("bắt đầu c1: trừ đúng 1 năng lượng, trả về playId", async () => {
    const before = Number((await (await request.get("/v1/energy")).json()).current);
    const res = await request.post("/v1/campaign/start", { data: { levelId: LEVEL, idempotencyKey: randomUUID() } });
    expect(res.ok(), `start thất bại: ${res.status()} ${await res.text()}`).toBeTruthy();
    const started = await res.json();
    playId = String(started.playId);
    expect(playId, "start phải trả playId").toBeTruthy();
    expect(Number(started.energy.current), "bắt đầu một cấp tốn đúng 1 năng lượng").toBe(before - 1);
  });

  // Chờ THẬT. `checkElapsed` từ chối kết quả nộp sớm hơn cận vật lý của cấp; tính lại bằng CHÍNH
  // hàm đó thay vì gán cứng, để đổi cấu hình c1 không biến bài test thành đỏ giả.
  const floorSec = minPlausibleSeconds(config) * SAFETY_FACTOR;
  await new Promise((r) => setTimeout(r, Math.ceil(floorSec * 1000) + 1_500));

  await test.step("hoàn tất c1: ví tăng đúng thưởng, sổ cái ghi, tiến độ mở", async () => {
    const coinBefore = await coinBalance(playerId);
    const ledgerBefore = await ledgerCount(playerId);

    const res = await request.post("/v1/campaign/complete", {
      data: { playId, facts: { territoryPct: 100, deaths: 0, totemsCaptured: 0, kingHeldSec: 0 } },
    });
    expect(res.ok(), `complete thất bại: ${res.status()} ${await res.text()}`).toBeTruthy();

    expect(await coinBalance(playerId), "ví phải tăng đúng bằng thưởng của cấp trong DB").toBe(coinBefore + rewardCoin);
    expect(await ledgerCount(playerId), "một lần thưởng = đúng một dòng sổ cái").toBe(ledgerBefore + 1);
    expect((await lastLedger(playerId))?.delta, "dòng sổ phải ghi khoản cộng đúng bằng thưởng").toBe(rewardCoin);

    const progress = await (await request.get("/v1/campaign/progress")).json();
    const row = (progress.progress as Array<{ level_id: string; status: string }>).find((p) => p.level_id === LEVEL);
    expect(row, `player_level_progress phải có hàng cho ${LEVEL}`).toBeTruthy();
    expect(row?.status).toBe("cleared");
  });

  await test.step("NỘP LẠI cùng lượt chơi ⇒ không thưởng thêm đồng nào", async () => {
    // Đây là phép đo đắt nhất trong file. Nếu nó đỏ, người chơi farm được coin vô hạn bằng cách
    // bấm nút gửi kết quả nhiều lần — và mỗi lần gọi trông y hệt lần đầu trong log.
    const coinNow = await coinBalance(playerId);
    const ledgerNow = await ledgerCount(playerId);
    const again = await request.post("/v1/campaign/complete", {
      data: { playId, facts: { territoryPct: 100, deaths: 0, totemsCaptured: 0, kingHeldSec: 0 } },
    });
    expect(again.ok(), `nộp lại phải được chấp nhận (idempotent), không phải bị từ chối: ${await again.text()}`).toBeTruthy();
    expect(await coinBalance(playerId), "nộp lại KHÔNG được thưởng thêm").toBe(coinNow);
    expect(await ledgerCount(playerId), "nộp lại KHÔNG được ghi thêm dòng sổ").toBe(ledgerNow);
  });
});

test("ví rỗng: mua năng lượng bị TỪ CHỐI, và không đồng nào bị ghi", async ({ request }) => {
  // Đường TỪ CHỐI là đường dễ hỏng âm thầm nhất trong một hệ thống tiền: nó hiếm khi được bấm tay,
  // và khi nó hỏng thì hỏng theo hướng có lợi cho người chơi — tức không ai đi báo lỗi.
  const playerId = (await db.query("select md5('seed-e2e-empty')::uuid as id")).rows[0].id as string;

  // KHÔNG đăng nhập bằng đường dev cho người chơi này: đăng nhập dev TẶNG 1000 coin
  // (dev-auth.controller.ts:44), tức nó sẽ tự tay phá mất điều kiện "ví rỗng" mà bài này cần.
  // Ép ví về 0 rồi gọi RPC trực tiếp — vẫn là RPC thật trên database thật, chỉ bỏ lớp HTTP mà lớp
  // đó không nói gì thêm về tính đúng của việc trừ tiền.
  await db.query(
    "update player_wallets set balance = 0 where player_id = $1 and currency_code = 'coin'", [playerId]);
  const ledgerBefore = await ledgerCount(playerId);

  let refused = false;
  try {
    await db.query("select purchase_energy_with_coin($1, $2)", [playerId, randomUUID()]);
  } catch {
    refused = true;
  }
  expect(refused, "mua năng lượng khi ví rỗng phải bị TỪ CHỐI").toBeTruthy();
  expect(await coinBalance(playerId), "ví rỗng phải vẫn là 0, không âm").toBe(0);
  expect(await ledgerCount(playerId), "lần mua bị từ chối KHÔNG được để lại dòng sổ nào").toBe(ledgerBefore);
});
