import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeAccountExportResponse } from "@fyendal/protocol";
import { createApiServer } from "../http.js";
import { login, register, sessionForToken } from "../auth.js";
import { exportAccount, getAccountCosmetics } from "../accounts.js";
import type { Queryable } from "../db.js";
import { recordKofiPayment, SUPPORTER_WINDOW_MS } from "../kofi.js";
import { normalizeEmail } from "../emailVerification.js";
import { removeEmail } from "../recovery.js";
import { freshDb } from "./testdb.js";

const TOKEN = "kofi-test-token";
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((res) => s.close(() => res()));
});

async function startApi(db: Queryable, kofiVerificationToken: string | null = TOKEN): Promise<string> {
  const server = createApiServer({ db, trustedProxyHops: 1, kofiVerificationToken, emailSender: null });
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, res));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    verification_token: TOKEN,
    message_id: "msg-1",
    timestamp: new Date().toISOString(),
    type: "Subscription",
    is_public: true,
    from_name: "Supporter",
    message: null,
    amount: "5.00",
    url: "https://ko-fi.com/Home/CoffeeShop?txid=1",
    email: "Supporter@Example.com",
    currency: "USD",
    is_subscription_payment: true,
    is_first_subscription_payment: true,
    kofi_transaction_id: "txn-1",
    shop_items: null,
    tier_name: "Monthly",
    shipping: null,
    ...overrides,
  };
}

function postWebhook(url: string, data: Record<string, unknown>): Promise<Response> {
  return fetch(`${url}/api/kofi/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ data: JSON.stringify(data) }).toString(),
  });
}

async function userWithEmail(db: Queryable, username: string, email: string): Promise<number> {
  await register(db, username, "password1", normalizeEmail(email)!);
  const session = await login(db, username.toLowerCase(), "password1");
  if (!session.ok) throw new Error("login failed");
  const user = await sessionForToken(db, session.token);
  if (!user) throw new Error("session missing");
  return user.id;
}

describe("Ko-fi webhook", () => {
  it("rejects a wrong token and is absent without a configured token", async () => {
    const db = await freshDb();
    const url = await startApi(db);
    expect((await postWebhook(url, payload({ verification_token: "wrong" }))).status).toBe(403);
    expect((await fetch(`${url}/api/kofi/webhook`, { method: "POST", body: "data=nope" })).status).toBe(400);
    const disabled = await startApi(db, null);
    expect((await postWebhook(disabled, payload())).status).toBe(404);
    expect((await db.query("SELECT 1 FROM kofi_subscription_payments")).rows).toEqual([]);
  });

  it("grants the supporter badge to the account whose recovery email paid monthly", async () => {
    const db = await freshDb();
    const userId = await userWithEmail(db, "Patron", "supporter@example.com");
    const otherId = await userWithEmail(db, "Bystander", "other@example.com");
    const url = await startApi(db);

    expect((await postWebhook(url, payload({ type: "Donation", is_subscription_payment: false, kofi_transaction_id: "tip" }))).status).toBe(200);
    expect(await getAccountCosmetics(db, userId)).toMatchObject({ availableBadges: [] });

    expect((await postWebhook(url, payload())).status).toBe(200);
    expect((await postWebhook(url, payload())).status).toBe(200);
    expect(await getAccountCosmetics(db, userId)).toMatchObject({
      availableBadges: ["supporter"],
      selectedBadge: "supporter",
    });
    expect(await getAccountCosmetics(db, otherId)).toMatchObject({ availableBadges: [], selectedBadge: null });
    expect((await db.query("SELECT transaction_id FROM kofi_subscription_payments")).rows)
      .toEqual([{ transaction_id: "txn-1" }]);

    const exported = await exportAccount(db, userId);
    expect(exported?.kofiPayments).toEqual([{ paidAt: expect.any(Number), tierName: "Monthly" }]);
    expect(decodeAccountExportResponse({ ok: true, export: JSON.parse(JSON.stringify(exported)) })).not.toBeNull();
  });

  it("keeps a chosen badge but stops showing it once the month lapses", async () => {
    const db = await freshDb();
    const userId = await userWithEmail(db, "Lapsed", "lapsed@example.com");
    const start = Date.now() - SUPPORTER_WINDOW_MS + 60_000;
    await recordKofiPayment(db, {
      verificationToken: TOKEN, type: "Subscription", isSubscriptionPayment: true, transactionId: "old",
      timestamp: new Date(start).toISOString(), email: "lapsed@example.com", tierName: null,
    }, start);
    expect(await getAccountCosmetics(db, userId)).toMatchObject({ selectedBadge: "supporter" });
    await db.query("UPDATE users SET supporter_until = $2 WHERE id = $1", [userId, Date.now() - 1]);
    expect(await getAccountCosmetics(db, userId)).toEqual({ availableBadges: [], selectedBadge: null, playmat: null });
    expect((await db.query("SELECT selected_badge FROM users WHERE id = $1", [userId])).rows)
      .toEqual([{ selected_badge: "supporter" }]);
  });

  it("matches payments made before the email was added and drops them on removal", async () => {
    const db = await freshDb();
    const url = await startApi(db);
    expect((await postWebhook(url, payload({ email: "early@example.com" }))).status).toBe(200);
    const userId = await userWithEmail(db, "Early", "early@example.com");
    expect(await getAccountCosmetics(db, userId)).toMatchObject({ availableBadges: ["supporter"] });
    await removeEmail(db, userId, "password1");
    expect(await getAccountCosmetics(db, userId)).toMatchObject({ availableBadges: [], selectedBadge: null });
  });
});
