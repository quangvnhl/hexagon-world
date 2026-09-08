import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";

/**
 * doc 36 §R2 tầng 1 — smoke UI, không cần database, không cần secret.
 *
 * Vì sao tầng này tồn tại dù đã có 446 unit test: **không có unit test nào dựng một canvas WebGL
 * thật**. Cả bộ test hiện tại vẫn xanh trong khi trang thực tế hiện một màn đen — đó chính là loại
 * lỗi hay gặp nhất khi sửa render, và cũng là loại tốn nhiều thời gian nhất để phát hiện bằng mắt.
 *
 * Bốn thứ được kiểm, theo đúng doc 36 §R2:
 *   1. Canvas dựng được — và **có ngữ cảnh WebGL sống**, không chỉ là một thẻ `<canvas>` rỗng.
 *   2. HUD có mặt.
 *   3. Console KHÔNG có lỗi.
 *   4. Vòng lặp render còn chạy sau vài giây (FPS > 0).
 */

interface Collected {
  errors: string[];
  pageErrors: string[];
}

/**
 * LUẬT LỌC TIẾNG ỒN: bỏ qua lỗi console phát sinh từ tài nguyên **khác origin**, giữ lại tất cả
 * những gì đến từ chính trang của mình.
 *
 * Vì sao là luật này chứ không phải một danh sách regex:
 *   • Tầng 1 cố ý chạy KHÔNG có server game, nên mọi lời gọi tới `localhost:8910` đều
 *     `ERR_CONNECTION_REFUSED`. Đó là môi trường, không phải sản phẩm.
 *   • SDK Telegram không tải được ngoài Telegram — doc 15 đã chốt fail-open.
 *   • Một danh sách regex theo chuỗi lỗi sẽ mục: thông điệp của Chromium là
 *     "Failed to load resource: net::ERR_CONNECTION_REFUSED" — KHÔNG kèm URL. Bản đầu của bài này
 *     lọc theo cổng 8910 và không khớp gì cả, nên nó "xanh nhờ may mắn" hoặc đỏ vô cớ.
 *
 * Luật origin không có hai nhược điểm đó, và vẫn bắt đúng thứ cần bắt: lỗi JS của chính mình, và
 * chunk của chính mình 404 — cả hai đều cùng origin.
 */
function isOurOrigin(url: string, baseURL: string): boolean {
  try {
    return new URL(url).origin === new URL(baseURL).origin;
  } catch {
    // URL rỗng/không phân tích được (thông điệp console do JS tự in) ⇒ coi là của mình, giữ lại.
    return true;
  }
}

/** Gắn bộ thu lỗi TRƯỚC khi điều hướng, nếu không sẽ bỏ sót lỗi lúc tải trang. */
function collect(page: Page, baseURL: string): Collected {
  const out: Collected = { errors: [], pageErrors: [] };
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const from = m.location()?.url ?? "";
    if (from && !isOurOrigin(from, baseURL)) return;
    out.errors.push(`${m.text()} @ ${from || "(khong ro nguon)"}`);
  });
  // `pageerror` = ngoại lệ JS chưa bắt. Đây là thứ nghiêm trọng nhất và KHÔNG bao giờ được bỏ qua.
  page.on("pageerror", (err) => out.pageErrors.push(String(err?.message ?? err)));
  return out;
}

/**
 * Chuẩn bị trang trước khi bất kỳ script nào của app chạy:
 *   - Đánh dấu FTUE đã xong, nếu không thì `/` sẽ vào thẳng ván hướng dẫn (lát d1.1) và bài kiểm
 *     màn hình chính sẽ đo nhầm thứ.
 *   - Đếm khung hình bằng `requestAnimationFrame` — đây là phép đo FPS trung thực nhất mà không
 *     phải thêm UI chỉ để test nhìn vào.
 */
async function prepare(page: Page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem("hexagon.ftue.done", "1"); } catch { /* private mode */ }
    (window as unknown as { __frames: number }).__frames = 0;
    const tick = () => {
      (window as unknown as { __frames: number }).__frames++;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  });
  // CHỈ chặn ống đo. Đã thử chặn cả `**/v1/**`: khi đó `/v1/me` trả 200 rỗng và màn chính kẹt ở
  // "Đang kiểm tra tài khoản…" mãi — tức là bài kiểm đo một trạng thái KHÔNG có thật. Để các lời
  // gọi khác hỏng tự nhiên đúng như khi không có server, và lọc tiếng ồn ở `IGNORED`.
  await page.route("**/v1/events", (route) => route.fulfill({ status: 200, body: "{}" }));
}

function assertClean(c: Collected) {
  expect(c.pageErrors, "ngoại lệ JS chưa bắt").toEqual([]);
  expect(c.errors, "lỗi console").toEqual([]);
}

test.describe("smoke UI (tầng 1 — không cần database)", () => {
  test("/ — màn hình chính dựng được, không lỗi console", async ({ page, baseURL }) => {
    const c = collect(page, baseURL!);
    await prepare(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Hexagon World/i })).toBeVisible();
    // Ô tên LUÔN có, không phụ thuộc trạng thái đăng nhập — màn chính render nhưng không nhập được
    // gì cũng là hỏng.
    await expect(page.getByPlaceholder(/Nhập tên/i)).toBeVisible();
    // Không có server ⇒ kiểm tra tài khoản phải THẤT BẠI và rơi về đường khách. Kẹt ở
    // "Đang kiểm tra tài khoản…" là một cách hỏng im lặng: trang trông vẫn ổn mà không vào chơi được.
    await expect(page.getByText(/Đang kiểm tra tài khoản/i)).toBeHidden({ timeout: 20_000 });
    assertClean(c);
  });

  test("/play — canvas WebGL sống, HUD có mặt, vòng lặp render còn chạy", async ({ page, baseURL }) => {
    const c = collect(page, baseURL!);
    await prepare(page);
    await page.goto("/play", { waitUntil: "domcontentloaded" });

    // 1–2. Canvas dựng được VÀ có kích thước thật.
    //
    // Chờ bằng `expect.poll` trên kích thước chứ không phải `toBeVisible`: `app/loading.tsx` để lại
    // một màn tải, và React giữ nhánh nội dung trong một wrapper `display:none` cho tới khi
    // stylesheet tải xong. Trong khoảng đó `<canvas>` ĐÃ có trong DOM và Playwright coi là
    // "visible", nhưng `boundingBox()` là 0 — bản đầu của bài này vì thế chập chờn: xanh hay đỏ tuỳ
    // máy chạy nhanh chậm. Chờ đúng thứ mình cần đo thì hết chập chờn.
    const canvas = page.locator("canvas").first();
    await expect
      .poll(async () => (await canvas.boundingBox())?.width ?? 0, { timeout: 30_000, message: "chiều rộng canvas" })
      .toBeGreaterThan(100);
    const box = await canvas.boundingBox();
    expect(box?.height ?? 0, "chiều cao canvas").toBeGreaterThan(100);

    // 3. NGỮ CẢNH WebGL sống. Đây là phần mà không unit test nào chạm tới được.
    const gl = await page.evaluate(() => {
      const el = document.querySelector("canvas");
      if (!el) return { ok: false, why: "khong co canvas" };
      // R3F đã giữ ngữ cảnh; xin lại đúng loại đó sẽ trả về CHÍNH ngữ cảnh đang dùng.
      const ctx = (el.getContext("webgl2") ?? el.getContext("webgl")) as WebGLRenderingContext | null;
      if (!ctx) return { ok: false, why: "khong lay duoc ngu canh webgl" };
      if (ctx.isContextLost()) return { ok: false, why: "ngu canh webgl da mat" };
      return { ok: true, why: "", w: ctx.drawingBufferWidth, h: ctx.drawingBufferHeight };
    });
    expect(gl.ok, `WebGL: ${gl.why}`).toBe(true);
    expect(gl.w ?? 0, "drawingBufferWidth").toBeGreaterThan(0);

    // 4. HUD có mặt.
    await expect(page.getByTestId("hud-stats")).toBeVisible({ timeout: 30_000 });

    // 5. Vòng lặp render CÒN CHẠY. Đo mức tăng trong một cửa sổ, không đo tổng: tổng > 0 chỉ chứng
    //    minh trang đã từng vẽ một lần, còn thứ ta cần biết là nó có đang treo hay không.
    const before = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
    await page.waitForTimeout(5_000);
    const after = await page.evaluate(() => (window as unknown as { __frames: number }).__frames);
    expect(after - before, "khung hình vẽ được trong 5 giây").toBeGreaterThan(0);

    assertClean(c);
  });
});
