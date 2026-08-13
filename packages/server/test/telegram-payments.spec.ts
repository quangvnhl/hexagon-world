import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { TelegramPaymentsController } from "../src/payments/telegram-payments.controller";
import { resetRuntimeConfigForTests } from "../src/runtime-config";

const ENV_KEYS = [
  "SERVER_ROLE", "PORT", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "PLAYER_SESSION_SECRET",
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_STATE_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_STARS_ENABLED", "GAME_REGION",
];
const previous = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

function localEnv() {
  Object.assign(process.env, {
    SERVER_ROLE: "all",
    PORT: "8910",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "test-secret-key",
    PLAYER_SESSION_SECRET: "01234567890123456789012345678901",
    GOOGLE_OAUTH_CLIENT_ID: "test.apps.googleusercontent.com",
    GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
    GOOGLE_OAUTH_STATE_SECRET: "01234567890123456789012345678901",
    TELEGRAM_BOT_TOKEN: "123:bot-token",
    TELEGRAM_WEBHOOK_SECRET: "webhook-secret",
    TELEGRAM_STARS_ENABLED: "true",
    GAME_REGION: "local",
  });
  resetRuntimeConfigForTests();
}

type QueryResult = { data?: unknown; error?: { message: string; code?: string } | null };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "lte", "or", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.insert = vi.fn(async () => result);
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function createDb(tableQueries: Record<string, Array<ReturnType<typeof query>>>) {
  const rpc = vi.fn(async () => undefined);
  return {
    rpc,
    from: vi.fn((table: string) => {
      const next = tableQueries[table]?.shift();
      if (!next) throw new Error(`Unexpected query for ${table}`);
      return next;
    }),
  };
}

function telegramSession(platform = "telegram") {
  return { resolve: vi.fn(async () => ({ id: "player-1", displayName: "An", platform })) };
}

beforeEach(() => {
  localEnv();
  vi.stubGlobal("fetch", vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: "https://t.me/$invoice" }),
  })));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  resetRuntimeConfigForTests();
});

describe("Telegram Stars coin payments", () => {
  it("does not query packages or Telegram for a non-Telegram server session", async () => {
    const db = createDb({});
    const controller = new TelegramPaymentsController(telegramSession("web") as never, db as never);

    await expect(controller.coinInvoice({} as never, {
      packageId: "package-1",
      idempotencyKey: "attempt-1",
    })).rejects.toThrow("telegram_account_required");
    expect(db.from).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("snapshots package amounts and creates an XTR invoice with an expiry", async () => {
    const packageQuery = query({ data: {
      id: "package-1", sku: "coins_starter", name: "Starter", coin_amount: 100, stars_amount: 25,
    } });
    const existingQuery = query({ data: null });
    const insertQuery = query({ error: null });
    const db = createDb({ coin_packages: [packageQuery], purchase_orders: [existingQuery, insertQuery] });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    const result = await controller.coinInvoice({} as never, {
      packageId: "package-1",
      idempotencyKey: "attempt-1",
    });

    expect(result).toMatchObject({ invoiceUrl: "https://t.me/$invoice", status: "pending" });
    expect(Date.parse(result.expiresAt!)).toBeGreaterThan(Date.now());
    expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      player_id: "player-1",
      platform: "telegram",
      product_kind: "coin_package",
      coin_package_id: "package-1",
      coin_amount: 100,
      amount: 25,
      currency_code: "XTR",
      status: "pending",
      idempotency_key: "attempt-1",
    }));
    const telegramPayload = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(telegramPayload).toMatchObject({
      currency: "XTR",
      prices: [{ label: "100 Coin", amount: 25 }],
    });
  });

  it("returns an already fulfilled idempotent order without creating another invoice", async () => {
    const db = createDb({
      coin_packages: [query({ data: {
        id: "package-1", sku: "coins_starter", name: "Starter", coin_amount: 100, stars_amount: 25,
      } })],
      purchase_orders: [query({ data: {
        id: "order-1", status: "fulfilled", product_kind: "coin_package", coin_package_id: "package-1",
        coin_amount: 100, amount: 25, currency_code: "XTR", expires_at: "2099-01-01T00:00:00.000Z",
      } })],
    });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await expect(controller.coinInvoice({} as never, {
      packageId: "package-1",
      idempotencyKey: "attempt-1",
    })).resolves.toEqual({
      orderId: "order-1",
      invoiceUrl: null,
      status: "fulfilled",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an expired idempotent order instead of silently creating another one", async () => {
    const db = createDb({
      coin_packages: [query({ data: {
        id: "package-1", sku: "coins_starter", name: "Starter", coin_amount: 100, stars_amount: 25,
      } })],
      purchase_orders: [query({ data: {
        id: "order-1", status: "pending", product_kind: "coin_package", coin_package_id: "package-1",
        coin_amount: 100, amount: 25, currency_code: "XTR", expires_at: "2020-01-01T00:00:00.000Z",
      } })],
    });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await expect(controller.coinInvoice({} as never, {
      packageId: "package-1",
      idempotencyKey: "attempt-1",
    })).rejects.toThrow("invoice_order_not_pending");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers an expired pre-checkout query with ok=false", async () => {
    const orderQuery = query({ data: {
      id: "order-1",
      player_id: "player-1",
      platform: "telegram",
      product_kind: "coin_package",
      amount: 25,
      currency_code: "XTR",
      status: "pending",
      expires_at: "2020-01-01T00:00:00.000Z",
      players: { player_identities: [{ provider: "telegram", provider_user_id: "42" }] },
    } });
    const db = createDb({ purchase_orders: [orderQuery] });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await controller.webhook("webhook-secret", {
      pre_checkout_query: {
        id: "checkout-1", currency: "XTR", total_amount: 25, invoice_payload: "order-1", from: { id: 42 },
      },
    });

    const telegramPayload = JSON.parse(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body));
    expect(telegramPayload).toMatchObject({ pre_checkout_query_id: "checkout-1", ok: false });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["coin_package", "fulfill_telegram_stars_coin_order"],
    ["shop_item", "fulfill_telegram_stars_order"],
  ] as const)("routes successful %s payments to the server-side RPC", async (productKind, rpcName) => {
    const db = createDb({ purchase_orders: [query({ data: {
      id: "order-1",
      player_id: "player-1",
      platform: "telegram",
      product_kind: productKind,
      amount: 25,
      currency_code: "XTR",
      status: "pending",
      expires_at: "2099-01-01T00:00:00.000Z",
      players: { player_identities: [{ provider: "telegram", provider_user_id: "42" }] },
    } })] });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await controller.webhook("webhook-secret", {
      message: {
        from: { id: 42 },
        successful_payment: {
          currency: "XTR",
          total_amount: 25,
          invoice_payload: "order-1",
          telegram_payment_charge_id: "charge-1",
        },
      },
    });

    expect(db.rpc).toHaveBeenCalledOnce();
    expect(db.rpc).toHaveBeenCalledWith(rpcName, expect.objectContaining({
      p_order_id: "order-1",
      p_charge_id: "charge-1",
      p_amount: 25,
    }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["fulfilled", "2099-01-01T00:00:00.000Z", "duplicate fulfilled webhook"],
    ["pending", "2020-01-01T00:00:00.000Z", "payment confirmed after invoice expiry"],
  ])("passes %s order with expiry %s to RPC: %s", async (status, expiresAt, _scenario) => {
    const db = createDb({ purchase_orders: [query({ data: {
      id: "order-1",
      player_id: "player-1",
      platform: "telegram",
      product_kind: "coin_package",
      amount: 25,
      currency_code: "XTR",
      status,
      expires_at: expiresAt,
      players: { player_identities: [{ provider: "telegram", provider_user_id: "42" }] },
    } })] });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await controller.webhook("webhook-secret", {
      message: {
        from: { id: 42 },
        successful_payment: {
          currency: "XTR",
          total_amount: 25,
          invoice_payload: "order-1",
          telegram_payment_charge_id: "charge-1",
        },
      },
    });

    expect(db.rpc).toHaveBeenCalledWith("fulfill_telegram_stars_coin_order", expect.any(Object));
  });

  it("never fulfills from a client callback or an invalid successful payment", async () => {
    const db = createDb({ purchase_orders: [query({ data: {
      id: "order-1",
      player_id: "player-1",
      platform: "telegram",
      product_kind: "coin_package",
      amount: 25,
      currency_code: "XTR",
      status: "pending",
      expires_at: "2099-01-01T00:00:00.000Z",
      players: { player_identities: [{ provider: "telegram", provider_user_id: "42" }] },
    } })] });
    const controller = new TelegramPaymentsController(telegramSession() as never, db as never);

    await expect(controller.webhook("webhook-secret", {
      message: {
        from: { id: 999 },
        successful_payment: {
          currency: "XTR",
          total_amount: 25,
          invoice_payload: "order-1",
          telegram_payment_charge_id: "charge-1",
        },
      },
    })).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
