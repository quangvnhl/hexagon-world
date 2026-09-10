// Dựng môi trường local có URL HTTPS công khai, để DIỄN TẬP luồng Telegram Mini App trước khi
// thuê máy chủ. Một lệnh: `pnpm dev:tunnel`.
//
// ┌─ NÚT THẮT MÀ SCRIPT NÀY GỠ ────────────────────────────────────────────────────────────────┐
// │ Quick tunnel của Cloudflare cấp URL NGẪU NHIÊN và đổi mỗi lần khởi động. Có BA nơi phải     │
// │ khớp nhau, và làm tay thì cả ba đều dễ sai:                                                 │
// │                                                                                             │
// │   1. Client phải gọi server qua URL công khai — điện thoại mở Mini App KHÔNG phân giải      │
// │      được `localhost`. Đây là lỗi im lặng nhất: trang tải xong rồi treo ở màn chờ.          │
// │   2. Server phải cho origin của client qua CORS, mà origin đó chính là URL tunnel kia.      │
// │   3. Telegram cần URL client để đặt Mini App, và cần URL server để đặt webhook Stars.       │
// │                                                                                             │
// │ Thứ tự bắt buộc: mở CẢ HAI tunnel TRƯỚC, rồi mới khởi động server/client với URL đã biết.   │
// │ Khởi động trước rồi mới mở tunnel là rơi vào vòng luẩn quẩn: mỗi bên cần URL của bên kia.   │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// ┌─ KHÔNG ĐỤNG `.env` ────────────────────────────────────────────────────────────────────────┐
// │ AGENTS.md §1 cấm sửa `.env`. Script này không ghi vào đó: nó truyền biến qua MÔI TRƯỜNG     │
// │ TIẾN TRÌNH con. `main.ts` dùng `dotenv.config()`, mà dotenv KHÔNG ghi đè biến đã có sẵn     │
// │ trong `process.env` — nên biến truyền ở đây thắng, còn `.env` của bạn không suy suyển.      │
// └───────────────────────────────────────────────────────────────────────────────────────────┘
//
// Đây là công cụ DIỄN TẬP, không phải chỗ nhận tiền thật: URL đổi mỗi lần chạy, máy tắt là dịch
// vụ tắt, và database vẫn là project dev. Muốn nhận tiền thật thì xem doc 39 + deploy/.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import process from "node:process";

const root = fileURLToPath(new URL("..", import.meta.url));
const SERVER_PORT = Number(process.env.SERVER_PORT ?? 8910);
const CLIENT_PORT = Number(process.env.CLIENT_PORT ?? 3890);

/**
 * Host mà cloudflared TỰ nói tới trong log của nó (endpoint API, và cả trong thông báo lỗi).
 * Nó khớp mọi regex `*.trycloudflare.com` nhưng KHÔNG phải tunnel của ta.
 */
const HOST_KHONG_PHAI_TUNNEL = "api.trycloudflare.com";

/**
 * Phiên bản protocol ĐÚNG, đọc thẳng từ nguồn sự thật.
 *
 * Vì sao phải ép: `config.ts` cho env GHI ĐÈ phiên bản của server, còn client import thẳng hằng
 * số này. Một `.env` cũ ghi `=5` là server thành cửa sổ `6..5` — RỖNG — và mọi client bị đóng
 * 4002. Đã gặp thật khi dựng script này: `protocol mismatch client=6 server=6..5`.
 * Ép ở đây là cách sửa mà KHÔNG đụng `.env` của bạn (AGENTS.md §1).
 */
function protocolVersion() {
  const src = readFileSync(`${root}packages/shared/src/protocol-version.ts`, "utf8");
  const match = /export const GAME_PROTOCOL_VERSION\s*=\s*(\d+)/.exec(src);
  if (!match) throw new Error("không đọc được GAME_PROTOCOL_VERSION từ packages/shared");
  return match[1];
}

/** Mọi tiến trình con đã sinh, để dọn sạch khi thoát. */
const children = [];

function spawnChild(label, command, args, env) {
  // `shell: true` vì trên Windows `pnpm`/`cloudflared` là shim .cmd, spawn thẳng sẽ EINVAL.
  const child = spawn(command, args, { shell: true, env: { ...process.env, ...env } });
  children.push({ label, child });
  return child;
}

function inRaVoiNhan(label, buf) {
  const text = String(buf);
  process.stdout.write(text.split("\n").map((l) => (l ? `[${label}] ${l}` : l)).join("\n"));
  return text;
}

/**
 * Mở một quick tunnel và chờ tới khi Cloudflare cấp URL.
 *
 * ┌─ VÌ SAO PHẢI LOẠI `api.trycloudflare.com` VÀ BẮT CẢ DÒNG LỖI ─────────────────────────────┐
 * │ Lần chạy đầu của script này BÁO THÀNH CÔNG trong khi tunnel server đã hỏng thật:           │
 * │   failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": …           │
 * │ Regex `https://<gì đó>.trycloudflare.com` khớp phải URL nằm TRONG THÔNG BÁO LỖI, và script  │
 * │ lấy nó làm URL server. Kết quả: banner in ra một URL trông hợp lệ, client thì không bao giờ │
 * │ nối được, và không có gì nói rằng tunnel chưa từng được tạo.                                │
 * │ Im lặng trông y hệt thành công — nên phải bắt CẢ dòng lỗi, không chỉ chờ dòng đúng.         │
 * └──────────────────────────────────────────────────────────────────────────────────────────┘
 */
function moTunnelMotLan(label, port) {
  return new Promise((resolve, reject) => {
    const child = spawnChild(label, "cloudflared", [
      "tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate",
    ]);
    let xong = false;
    const dung = (err, url) => {
      if (xong) return;
      xong = true;
      clearTimeout(timer);
      if (err) reject(err); else resolve(url);
    };
    const timer = setTimeout(
      () => dung(new Error(`${label}: cloudflared không cấp URL sau 60 giây`)),
      60_000,
    );

    // cloudflared in URL ra STDERR chứ không phải stdout — nghe cả hai để khỏi phụ thuộc điều đó.
    const doc = (buf) => {
      const text = inRaVoiNhan(label, buf);
      if (/failed to request quick Tunnel/i.test(text)) {
        dung(new Error(`${label}: Cloudflare từ chối cấp quick tunnel (mạng chậm hoặc bị chặn)`));
        return;
      }
      for (const ungVien of text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g) ?? []) {
        if (new URL(ungVien).host !== HOST_KHONG_PHAI_TUNNEL) { dung(null, ungVien); return; }
      }
    };
    child.stdout.on("data", doc);
    child.stderr.on("data", doc);
    child.on("exit", (code) => dung(new Error(`${label}: cloudflared thoát sớm với mã ${code}`)));
  });
}

/** Quick tunnel hay hỏng vì mạng; thử lại vài lần trước khi bỏ cuộc. */
async function moTunnel(label, port, soLan = 3) {
  let loiCuoi;
  for (let lan = 1; lan <= soLan; lan++) {
    try {
      return await moTunnelMotLan(label, port);
    } catch (err) {
      loiCuoi = err;
      if (lan < soLan) console.log(`[${label}] lần ${lan} hỏng (${err.message}) — thử lại...`);
    }
  }
  throw loiCuoi;
}

function noiDuongOng(label, child) {
  child.stdout.on("data", (buf) => inRaVoiNhan(label, buf));
  child.stderr.on("data", (buf) => inRaVoiNhan(label, buf));
}

function donDep() {
  for (const { child } of children) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    // Trên Windows phải giết CẢ CÂY: `pnpm` sinh `node`, giết mỗi pnpm là bỏ lại server chạy mồ côi
    // giữ cổng 8910, và lần chạy sau sẽ hỏng với EADDRINUSE mà không rõ vì sao.
    if (process.platform === "win32") {
      spawn("taskkill", ["/F", "/T", "/PID", String(child.pid)], { shell: true, stdio: "ignore" });
    } else {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    }
  }
}

async function main() {
  console.log("Mở hai tunnel trước khi khởi động dịch vụ (thứ tự này là bắt buộc)...\n");
  const [urlServer, urlClient] = await Promise.all([
    moTunnel("tunnel:server", SERVER_PORT),
    moTunnel("tunnel:client", CLIENT_PORT),
  ]);

  const originClient = new URL(urlClient).origin;
  // `/game` là BẮT BUỘC: NetServer gắn WebSocket vào đúng path đó (game.module.ts), còn client
  // dùng NEXT_PUBLIC_SERVER_URL NGUYÊN VĂN — nó không tự nối path vào. Thiếu `/game` thì bắt tay
  // WebSocket bị từ chối và giao diện chỉ hiện "Mất kết nối", không nói vì sao.
  const wsServer = `wss://${new URL(urlServer).host}/game`;
  const protocol = protocolVersion();

  const envServer = {
    GAME_PROTOCOL_VERSION: protocol,
    // Server CÔNG BỐ hai URL này cho client qua `GET /v1/regions`, và đó mới là đường client dùng
    // thật (`backend.ts` lấy `wsUrl` của region; NEXT_PUBLIC_SERVER_URL chỉ là đường dự phòng).
    // Không đặt thì region vẫn nói `ws://localhost:8910/game` — vô nghĩa với một chiếc điện thoại.
    GAME_PUBLIC_WS_URL: wsServer,
    GAME_PUBLIC_PING_URL: `${urlServer}/health/ping`,
    // Chỉ THÊM origin của client. Giữ các origin local để bạn vẫn mở được http://localhost:3890
    // song song mà không phải chọn một trong hai.
    CORS_ALLOWED_ORIGINS: [
      originClient,
      "http://localhost:3890", "http://127.0.0.1:3890",
      "http://localhost:3899", "http://127.0.0.1:3899",
    ].join(","),
  };

  const envClient = {
    NEXT_PUBLIC_API_URL: urlServer,
    NEXT_PUBLIC_SERVER_URL: wsServer,
  };

  noiDuongOng("server", spawnChild("server", "pnpm", ["--filter", "@hexagon/server", "start:dev"], envServer));
  noiDuongOng("client", spawnChild("client", "pnpm", ["--filter", "@hexagon/client", "dev"], envClient));

  console.log([
    "",
    "═".repeat(78),
    "  MINI APP URL (dán vào @BotFather → Bot Settings → Menu Button)",
    `    ${urlClient}`,
    "",
    "  WEBHOOK STARS (đặt bằng setWebhook)",
    `    ${urlServer}/v1/webhooks/telegram`,
    "",
    "  API mà client đang gọi",
    `    ${urlServer}   ·   ${wsServer}`,
    "",
    "  Region mà server công bố (đường client dùng thật):",
    `    curl ${urlServer}/v1/regions`,
    "",
    "  Kiểm nhanh:",
    `    curl ${urlServer}/health/ready`,
    "",
    `  GAME_PROTOCOL_VERSION bị ép về ${protocol} (giá trị trong packages/shared).`,
    "  Nếu .env của bạn ghi số khác, script này đang ghi đè nó — và bạn NÊN sửa .env cho khớp,",
    "  vì `pnpm dev:server` chạy trực tiếp sẽ không có lớp ép này.",
    "",
    "  URL đổi MỖI LẦN chạy lại script này — phải đặt lại Mini App URL và webhook.",
    "  Ctrl+C để dừng cả tunnel lẫn dịch vụ.",
    "═".repeat(78),
    "",
  ].join("\n"));
}

for (const tin of ["SIGINT", "SIGTERM"]) {
  process.on(tin, () => { console.log("\nĐang dọn tiến trình con..."); donDep(); process.exit(0); });
}
process.on("exit", donDep);

main().catch((err) => {
  console.error(`\nHỏng: ${err.message}`);
  donDep();
  process.exit(1);
});
