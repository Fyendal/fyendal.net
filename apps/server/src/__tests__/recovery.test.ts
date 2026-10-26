import { afterEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { decodeAccountEmailResponse, decodeLoginResponse } from "@fyendal/protocol";
import { createApiServer, createRateLimiter, type ApiDeps } from "../http.js";
import { login, register, sessionForToken } from "../auth.js";
import type { Queryable } from "../db.js";
import {
  configuredEmailSender,
  createLogSender,
  createResendSender,
  type EmailMessage,
  type EmailSender,
} from "../email.js";
import { sweepRecoveryTokens } from "../recovery.js";
import { hashToken } from "../tokenHash.js";
import { freshDb } from "./testdb.js";

const ORIGIN = "https://play.test";
const servers: Server[] = [];

afterEach(async () => {
  for (const s of servers.splice(0)) {
    await new Promise<void>((res) => s.close(() => res()));
  }
});

interface Harness {
  db: Queryable;
  url: string;
  sent: EmailMessage[];
  post(path: string, body: unknown, token?: string): Promise<Response>;
}

async function harness(deps: Partial<ApiDeps> = {}): Promise<Harness> {
  const db = deps.db ?? await freshDb();
  const sent: EmailMessage[] = [];
  const emailSender: EmailSender = { send: async (message) => { sent.push(message); } };
  const server = createApiServer({
    db,
    appOrigin: ORIGIN,
    trustedProxyHops: 1,
    emailSender,
    rateLimiter: createRateLimiter(1_000),
    recoveryRateLimiter: createRateLimiter(1_000),
    ...deps,
  });
  servers.push(server);
  await new Promise<void>((res) => server.listen(0, res));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, token?: string) => fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { db, url, sent, post };
}

function linkToken(message: EmailMessage, path: string): string {
  const match = new RegExp(`${ORIGIN}/${path}#([A-Za-z0-9_-]+)`).exec(message.text);
  if (!match) throw new Error(`no ${path} link in email`);
  return match[1]!;
}

async function loggedIn(h: Harness, username: string): Promise<string> {
  const result = await login(h.db, username, "password1");
  if (!result.ok) throw new Error("login failed");
  return result.token;
}

async function emailState(h: Harness, token: string) {
  const res = await fetch(`${h.url}/api/account/email`, { headers: { Authorization: `Bearer ${token}` } });
  return decodeAccountEmailResponse(await res.json());
}

/** Register with a recovery address, which sign-up stores without confirmation. */
async function accountWithEmail(h: Harness, username: string, email: string): Promise<void> {
  expect((await h.post("/api/register", { username, password: "password1", email })).status).toBe(200);
}

describe("recovery email", () => {
  it("keeps registration without an email unchanged", async () => {
    const h = await harness();
    expect((await h.post("/api/register", { username: "NoMail", password: "password1" })).status).toBe(200);
    const token = await loggedIn(h, "NoMail");
    expect(await emailState(h, token)).toEqual({ ok: true, available: true, email: null, pendingEmail: null });
    expect(h.sent).toEqual([]);
  });

  it("rejects an invalid registration email before creating the account", async () => {
    const h = await harness();
    const res = await h.post("/api/register", { username: "BadMail", password: "password1", email: "nope" });
    expect(res.status).toBe(400);
    expect((await h.db.query("SELECT * FROM users")).rows).toEqual([]);
  });

  it("stores a sign-up address immediately without sending a confirmation", async () => {
    const h = await harness();
    await h.post("/api/register", { username: "Verify", password: "password1", email: " Verify@Example.com " });
    const token = await loggedIn(h, "Verify");
    expect(await emailState(h, token)).toMatchObject({ email: "Verify@Example.com", pendingEmail: null });
    expect(h.sent).toEqual([]);
    expect(await (await h.post("/api/password/forgot", { identifier: "verify@example.com" })).json())
      .toEqual({ ok: true });
    await vi.waitFor(() => expect(h.sent.at(-1)!.subject).toBe("Reset your Fyendal password"));
  });

  it("stores a changed address only after its link is confirmed, and links are single-use", async () => {
    const h = await harness();
    await register(h.db, "Changing", "password1");
    const token = await loggedIn(h, "Changing");
    await h.post("/api/account/email", { password: "password1", email: "change@example.com" }, token);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    expect(await emailState(h, token)).toMatchObject({ email: null, pendingEmail: "change@example.com" });

    const link = linkToken(h.sent[0]!, "verify-email");
    expect((await h.post("/api/account/email/verify", { token: link })).status).toBe(200);
    expect(await emailState(h, token)).toMatchObject({ email: "change@example.com", pendingEmail: null });
    expect((await h.post("/api/account/email/verify", { token: link })).status).toBe(400);
  });

  it("rejects an expired verification link", async () => {
    const h = await harness();
    await register(h.db, "Late", "password1");
    const token = await loggedIn(h, "Late");
    await h.post("/api/account/email", { password: "password1", email: "late@example.com" }, token);
    await vi.waitFor(() => expect(h.sent).toHaveLength(1));
    const link = linkToken(h.sent[0]!, "verify-email");
    await h.db.query("UPDATE email_verifications SET expires_at = 1 WHERE token_hash = $1", [hashToken(link)]);
    expect((await h.post("/api/account/email/verify", { token: link })).status).toBe(400);
    expect((await h.db.query("SELECT email FROM users")).rows).toEqual([{ email: null }]);
  });

  it("requires the password to change or remove the address and notifies the old one", async () => {
    const h = await harness();
    await accountWithEmail(h, "Changer", "old@example.com");
    const token = await loggedIn(h, "Changer");

    expect((await h.post("/api/account/email", { password: "wrong-pass", email: "new@example.com" }, token)).status)
      .toBe(403);
    const changed = await h.post("/api/account/email", { password: "password1", email: "new@example.com" }, token);
    expect(decodeAccountEmailResponse(await changed.json()))
      .toEqual({ ok: true, available: true, email: "old@example.com", pendingEmail: "new@example.com" });
    await vi.waitFor(() => expect(h.sent.at(-1)!.to).toBe("new@example.com"));
    expect(await emailState(h, token)).toMatchObject({ email: "old@example.com", pendingEmail: "new@example.com" });
    await h.post("/api/account/email/verify", { token: linkToken(h.sent.at(-1)!, "verify-email") });
    await vi.waitFor(() => expect(h.sent.at(-1)).toMatchObject({
      to: "old@example.com",
      subject: "Your Fyendal recovery email changed",
    }));

    expect((await h.post("/api/account/email/remove", { password: "wrong-pass" }, token)).status).toBe(403);
    expect((await h.post("/api/account/email/remove", { password: "password1" }, token)).status).toBe(200);
    await vi.waitFor(() => expect(h.sent.at(-1)!.to).toBe("new@example.com"));
    expect(await emailState(h, token)).toMatchObject({ email: null, pendingEmail: null });
  });

  it("answers forgot requests identically whether or not an account matches", async () => {
    const h = await harness();
    await accountWithEmail(h, "Known", "known@example.com");
    await register(h.db, "NoAddress", "password1");
    const sentBefore = h.sent.length;
    for (const identifier of ["missing", "missing@example.com", "NoAddress"]) {
      const res = await h.post("/api/password/forgot", { identifier });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(h.sent).toHaveLength(sentBefore);
    expect((await h.db.query("SELECT * FROM password_resets")).rows).toEqual([]);
  });

  it("sends one email listing every account that shares an address", async () => {
    const h = await harness();
    await accountWithEmail(h, "Twin_A", "twins@example.com");
    await accountWithEmail(h, "Twin_B", "Twins@Example.com");
    const sentBefore = h.sent.length;
    expect((await h.post("/api/password/forgot", { identifier: "TWINS@example.com" })).status).toBe(200);
    await vi.waitFor(() => expect(h.sent).toHaveLength(sentBefore + 1));
    const message = h.sent.at(-1)!;
    expect(message.subject).toBe("Reset your Fyendal password");
    expect(message.text).toContain("Twin_A: https://play.test/reset-password#");
    expect(message.text).toContain("Twin_B: https://play.test/reset-password#");
  });

  it("resets the password once, revokes every session, and logs this browser in", async () => {
    const h = await harness();
    await accountWithEmail(h, "Resetter", "reset@example.com");
    const oldSession = await loggedIn(h, "Resetter");
    await h.post("/api/password/forgot", { identifier: "resetter" });
    await vi.waitFor(() => expect(h.sent.at(-1)!.subject).toBe("Reset your Fyendal password"));
    const link = linkToken(h.sent.at(-1)!, "reset-password");

    expect((await h.post("/api/password/reset", { token: link, password: "short" })).status).toBe(400);
    const res = await h.post("/api/password/reset", { token: link, password: "brand-new-pass" });
    expect(res.status).toBe(200);
    const body = decodeLoginResponse(await res.json());
    expect(body).toMatchObject({ ok: true, username: "Resetter" });
    expect(await sessionForToken(h.db, oldSession)).toBeNull();
    expect(await sessionForToken(h.db, body!.token)).toMatchObject({ username: "Resetter" });
    expect((await login(h.db, "Resetter", "password1")).ok).toBe(false);
    expect((await login(h.db, "Resetter", "brand-new-pass")).ok).toBe(true);

    const reused = await h.post("/api/password/reset", { token: link, password: "another-pass" });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toEqual({ ok: false, error: "invalid or expired link" });
  });

  it("rejects expired reset links and sweeps expired recovery tokens", async () => {
    const h = await harness();
    await accountWithEmail(h, "Expired", "expired@example.com");
    await h.post("/api/password/forgot", { identifier: "expired" });
    await vi.waitFor(() => expect(h.sent.at(-1)!.subject).toBe("Reset your Fyendal password"));
    const link = linkToken(h.sent.at(-1)!, "reset-password");
    await h.db.query("UPDATE password_resets SET expires_at = 1");
    expect((await h.post("/api/password/reset", { token: link, password: "brand-new-pass" })).status).toBe(400);
    expect(await sweepRecoveryTokens(h.db)).toBe(1);
  });

  it("throttles forgot requests per target", async () => {
    const h = await harness({ recoveryRateLimiter: createRateLimiter(2, 60_000) });
    for (const identifier of ["Target", "target "]) {
      expect((await h.post("/api/password/forgot", { identifier })).status).toBe(200);
    }
    expect((await h.post("/api/password/forgot", { identifier: "TARGET" })).status).toBe(429);
  });

  it("reports recovery as unavailable without a transport", async () => {
    const h = await harness({ emailSender: null });
    expect((await h.post("/api/password/forgot", { identifier: "anyone" })).status).toBe(503);
    await register(h.db, "Offline", "password1");
    const token = await loggedIn(h, "Offline");
    expect(await emailState(h, token)).toMatchObject({ available: false });
  });

  it("includes the recovery address in the account export", async () => {
    const h = await harness();
    await accountWithEmail(h, "Exporter", "export@example.com");
    const token = await loggedIn(h, "Exporter");
    const res = await fetch(`${h.url}/api/account/export`, { headers: { Authorization: `Bearer ${token}` } });
    expect(((await res.json()) as any).export.account).toMatchObject({
      email: "export@example.com",
      pendingEmail: null,
    });
  });
});

describe("email transport configuration", () => {
  it("defaults to the log transport outside production", () => {
    expect(configuredEmailSender({})).not.toBeNull();
    expect(configuredEmailSender({ EMAIL_PROVIDER: "none" })).toBeNull();
  });

  it("requires an explicit, complete production transport", () => {
    expect(() => configuredEmailSender({ NODE_ENV: "production" })).toThrow(/EMAIL_PROVIDER/);
    expect(() => configuredEmailSender({ NODE_ENV: "production", EMAIL_PROVIDER: "log" })).toThrow();
    expect(() => configuredEmailSender({ NODE_ENV: "production", EMAIL_PROVIDER: "resend" })).toThrow(/RESEND_API_KEY/);
    expect(configuredEmailSender({
      NODE_ENV: "production",
      EMAIL_PROVIDER: "resend",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "Fyendal <no-reply@fyendal.test>",
    })).not.toBeNull();
  });

  it("posts mail to Resend and surfaces rejected requests", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
    const sender = createResendSender("re_test", "Fyendal <no-reply@fyendal.test>", fetcher as typeof fetch);
    const message = { to: "a@b.io", subject: "Hi", text: "t", html: "<p>t</p>" };
    await sender.send(message);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers).toMatchObject({ Authorization: "Bearer re_test" });
    expect(JSON.parse(String(init.body))).toEqual({ from: "Fyendal <no-reply@fyendal.test>", ...message });

    fetcher.mockResolvedValueOnce(new Response("{}", { status: 422 }));
    await expect(sender.send(message)).rejects.toThrow("422");
  });

  it("logs development mail with its link", async () => {
    const lines: string[] = [];
    await createLogSender((line) => lines.push(line)).send({
      to: "dev@example.com", subject: "Hi", text: "https://play.test/reset-password#abc", html: "",
    });
    expect(lines[0]).toContain("https://play.test/reset-password#abc");
  });
});
