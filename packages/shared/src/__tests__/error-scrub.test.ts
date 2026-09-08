// doc 35 §A4 (lát a4.2) — làm sạch PII trước khi báo cáo lỗi rời khỏi máy.
//
// Đây là loại test mà "xanh" không đủ: cái giá của một lần lọt là `initData` của Telegram hoặc một
// token nằm vĩnh viễn trong hệ thống của bên thứ ba, ngoài tầm xoá của chúng ta. Nên mỗi bài dưới
// đây mô tả một đường mà dữ liệu THẬT SỰ đi ra: query string, thân request, biến trong ngăn xếp.
import { describe, expect, it } from "vitest";
import { REDACTED, scrubErrorEvent, scrubUrl, scrubValue } from "../error-scrub";

describe("scrubValue — khoá nghi PII bị xoá, khớp theo CHUỖI CON", () => {
  it("xoá email/token/initData ở mọi kiểu viết", () => {
    // Khớp chuỗi con và không phân biệt hoa thường, nên biến thể đặt tên nào cũng dính. Nếu chỗ
    // này chuyển sang so khớp CHÍNH XÁC thì `userEmail` sẽ lọt, và không có gì báo.
    const out = scrubValue({
      email: "a@b.c", userEmail: "a@b.c", user_email: "a@b.c",
      TOKEN: "abc", accessToken: "abc",
      initData: "query_id=...", initDataRaw: "query_id=...",
      password: "x",
    }) as Record<string, unknown>;
    for (const k of Object.keys(out)) expect(out[k], k).toBe(REDACTED);
  });

  it("giữ nguyên thứ KHÔNG nghi ngờ — xoá quá tay thì báo cáo lỗi vô dụng", () => {
    const out = scrubValue({ level_id: "c3", deaths: 2, ok: true, nothing: null }) as Record<string, unknown>;
    expect(out).toEqual({ level_id: "c3", deaths: 2, ok: true, nothing: null });
  });

  it("đi ĐỆ QUY vào object và mảng", () => {
    const out = scrubValue({ req: { headers: { authorization: "Bearer x" } }, list: [{ token: "t" }] }) as
      { req: { headers: { authorization: string } }; list: { token: string }[] };
    expect(out.req.headers.authorization).toBe(REDACTED);
    expect(out.list[0].token).toBe(REDACTED);
  });

  it("quá sâu ⇒ cắt, không treo", () => {
    let deep: Record<string, unknown> = { end: "x" };
    for (let i = 0; i < 30; i++) deep = { next: deep };
    expect(() => scrubValue(deep)).not.toThrow();
  });

  it("hàm/symbol ⇒ xoá: không chẩn đoán được gì và không tuần tự hoá đáng tin", () => {
    expect(scrubValue(() => 1)).toBe(REDACTED);
  });
});

describe("scrubUrl — query string là chỗ PII lọt nhiều nhất", () => {
  it("cắt query, GIỮ đường dẫn", () => {
    // Giữ đường dẫn vì đó mới là thứ cần để biết lỗi xảy ra ở đâu.
    expect(scrubUrl("https://api.example.com/v1/config?anonId=abc&token=xyz"))
      .toBe(`https://api.example.com/v1/config?${REDACTED}`);
  });

  it("cắt cả fragment", () => {
    expect(scrubUrl("https://a.b/c#initData=xyz")).toBe(`https://a.b/c?${REDACTED}`);
  });

  it("không có query ⇒ giữ nguyên", () => {
    expect(scrubUrl("https://a.b/c")).toBe("https://a.b/c");
  });

  it("URL nằm trong một trường bất kỳ cũng bị cắt", () => {
    const out = scrubValue({ where: "https://a.b/c?token=1" }) as { where: string };
    expect(out.where).toBe(`https://a.b/c?${REDACTED}`);
  });
});

describe("scrubErrorEvent — không bao giờ để lọt nguyên bản", () => {
  it("sự kiện rỗng ⇒ null", () => {
    expect(scrubErrorEvent(null)).toBeNull();
    expect(scrubErrorEvent(undefined)).toBeNull();
  });

  it("một sự kiện Sentry điển hình được làm sạch xuyên suốt", () => {
    const event = {
      message: "loi that",
      request: { url: "https://a.b/play?token=secret", headers: { cookie: "sid=1", authorization: "Bearer t" } },
      extra: { initData: "query_id=x", levelId: "c1" },
    };
    const out = scrubErrorEvent(event)!;
    expect(out.message).toBe("loi that");
    expect((out.request as { url: string }).url).toBe(`https://a.b/play?${REDACTED}`);
    expect((out.request as { headers: Record<string, string> }).headers.authorization).toBe(REDACTED);
    expect((out.extra as Record<string, unknown>).initData).toBe(REDACTED);
    expect((out.extra as Record<string, unknown>).levelId).toBe("c1");
  });
});

describe("khoá CHỈ nguy hiểm trong báo cáo lỗi", () => {
  it("xoá authorization/cookie/secret/apikey/admin-key/signature", () => {
    // `FORBIDDEN_PROP_KEYS` viết cho props analytics — thứ do CHÍNH TA đặt tên, nơi header HTTP
    // không bao giờ xuất hiện. Bản đầu của lát này dùng lại y nguyên danh sách đó và `authorization`
    // lọt qua; bài test này chính là thứ bắt được.
    const out = scrubValue({
      authorization: "Bearer x", cookie: "sid=1", "x-admin-key": "hxops_...",
      clientSecret: "s", apiKey: "k", api_key: "k", credentials: "c", signature: "sig",
    }) as Record<string, unknown>;
    for (const k of Object.keys(out)) expect(out[k], k).toBe(REDACTED);
  });

  it("KHÔNG xoá các khoá vô hại chỉ vì chúng chứa chữ 'key'", () => {
    // Xoá quá tay làm báo cáo lỗi vô dụng, và một báo cáo vô dụng thì người ta ngừng đọc.
    const out = scrubValue({ asset_key: "cube", level_key: "c1", idempotency_key: "u-1" }) as Record<string, unknown>;
    expect(out).toEqual({ asset_key: "cube", level_key: "c1", idempotency_key: "u-1" });
  });
});
