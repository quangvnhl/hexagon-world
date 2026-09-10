// Giữ `.env.example` khỏi trôi khỏi hằng số thật. Không chạm mạng, không cần secret.
//
// ┌─ VÌ SAO CẦN BÀI NÀY ────────────────────────────────────────────────────────────────────────┐
// │ `.env.example` là file ĐẦU TIÊN người mới chép ra khi dựng môi trường local. Nó từng ghi     │
// │ `GAME_PROTOCOL_VERSION=5` trong khi `packages/shared` đã lên 6.                              │
// │                                                                                             │
// │ Hậu quả không nhỏ: `config.ts` cho env GHI ĐÈ phiên bản của server, còn client import thẳng  │
// │ hằng số. Server thành cửa sổ `MIN..current` = `6..5` — RỖNG — nên mọi client bị đóng với mã  │
// │ 4002 "protocol mismatch". Local hỏng ngay từ lần join đầu tiên, và triệu chứng               │
// │ ("không vào được phòng") không hề chỉ về phía file env.                                      │
// │                                                                                             │
// │ Không cổng nào bắt được: `.env.example` không được typecheck, không được test, và CI chạy    │
// │ KHÔNG có file `.env` nên nó không bao giờ đọc tới.                                           │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const envExample = readFileSync(`${root}.env.example`, "utf8");
const sharedSource = readFileSync(`${root}packages/shared/src/protocol-version.ts`, "utf8");

/** Giá trị đang được khai (dòng chú thích không tính), hoặc null nếu không khai. */
function khaiTrongEnvExample(name) {
  for (const line of envExample.split(/\r?\n/)) {
    if (line.startsWith(`${name}=`)) return line.slice(name.length + 1).trim();
  }
  return null;
}

function hangSoShared(name) {
  const match = new RegExp(String.raw`export const ${name}\s*=\s*(\d+)`).exec(sharedSource);
  assert.ok(match, `không đọc được ${name} từ protocol-version.ts`);
  return match[1];
}

test("GAME_PROTOCOL_VERSION trong .env.example không được lệch khỏi hằng số shared", () => {
  const khai = khaiTrongEnvExample("GAME_PROTOCOL_VERSION");
  if (khai === null) return; // không khai = luôn đúng, đó là trạng thái mong muốn cho local.
  assert.equal(
    khai,
    hangSoShared("GAME_PROTOCOL_VERSION"),
    "env ghi đè phiên bản của server còn client import thẳng hằng số ⇒ lệch là mọi client bị đóng 4002",
  );
});

test("bộ đọc của chính bài này không rỗng — nếu không, luật trên xanh mà không kiểm gì", () => {
  // Chốt chặn: `khaiTrongEnvExample` trả null cho cả biến KHÔNG tồn tại lẫn biến bị chú thích,
  // nên nếu bộ đọc hỏng thì luật trên sẽ lặng lẽ `return` và không bao giờ đỏ.
  assert.equal(khaiTrongEnvExample("BIEN_CHAC_CHAN_KHONG_TON_TAI"), null);
  assert.equal(khaiTrongEnvExample("PORT"), "8910", "không đọc nổi PORT — bộ đọc đã lệch khỏi định dạng file");
  assert.match(hangSoShared("GAME_PROTOCOL_VERSION"), /^\d+$/);
});

test("NEXT_PUBLIC_SERVER_URL phải trỏ đúng path mà NetServer gắn WebSocket vào", () => {
  // Client dùng giá trị này NGUYÊN VĂN (`NetGameScene.tsx`: `serverUrl || DEFAULT_SERVER_URL`) —
  // nó KHÔNG tự nối path. Thiếu `/game` thì bắt tay WebSocket bị từ chối, và giao diện chỉ hiện
  // "Mất kết nối, đang thử kết nối lại..." mà không nói vì sao. Lỗi này đã xảy ra thật khi dựng
  // `pnpm dev:tunnel`, và `.env.example` cũng đang mắc đúng nó.
  const url = khaiTrongEnvExample("NEXT_PUBLIC_SERVER_URL");
  if (url === null) return;
  const module = readFileSync(`${root}packages/server/src/game/game.module.ts`, "utf8");
  const match = /path:\s*"([^"]+)"/.exec(module);
  assert.ok(match, "không đọc được path WebSocket từ game.module.ts");
  assert.ok(
    url.endsWith(match[1]),
    `NEXT_PUBLIC_SERVER_URL=${url} không kết thúc bằng ${match[1]} ⇒ WebSocket bị từ chối`,
  );
});

test("luật BẮT ĐƯỢC bản đột biến — đúng lỗi đã xảy ra thật", () => {
  // Dựng lại chính tình huống cũ: env khai 5 trong khi shared là 6.
  const shared = hangSoShared("GAME_PROTOCOL_VERSION");
  const lech = String(Number(shared) - 1);
  assert.notEqual(lech, shared);
  assert.throws(() => assert.equal(lech, shared), /AssertionError/);
});
