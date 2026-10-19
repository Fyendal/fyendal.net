import { consoleError } from "./logging.js";

const RESEND_API_URL = "https://api.resend.com/emails";
const REQUEST_TIMEOUT_MS = 10_000;

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Outbound transactional mail. Delivery is best-effort: callers send after
 * their transaction commits and a lost message is recovered by retrying. */
export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createResendSender(
  apiKey: string,
  from: string,
  fetcher: typeof fetch = fetch,
): EmailSender {
  return {
    async send(message) {
      const response = await fetcher(RESEND_API_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...message }),
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      // Never log the response body: it may echo the recipient address.
      if (!response.ok) throw new Error(`email provider rejected message (${response.status})`);
    },
  };
}

/** Development transport: prints the message so links can be opened locally. */
export function createLogSender(log: (line: string) => void = console.log): EmailSender {
  return {
    async send(message) {
      log(`[email] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
    },
  };
}

/** Selects the transport from EMAIL_PROVIDER (`resend`, `log`, or `none`).
 * Production must choose explicitly; `none` disables recovery email. */
export function configuredEmailSender(env: NodeJS.ProcessEnv = process.env): EmailSender | null {
  const production = env.NODE_ENV === "production";
  const provider = env.EMAIL_PROVIDER ?? (production ? undefined : "log");
  if (provider === undefined) throw new Error("EMAIL_PROVIDER is required in production");
  if (provider === "none") return null;
  if (provider === "log") {
    if (production) throw new Error("EMAIL_PROVIDER=log is not allowed in production");
    return createLogSender();
  }
  if (provider === "resend") {
    const apiKey = env.RESEND_API_KEY;
    const from = env.EMAIL_FROM;
    if (!apiKey) throw new Error("RESEND_API_KEY is required when EMAIL_PROVIDER=resend");
    if (!from) throw new Error("EMAIL_FROM is required when EMAIL_PROVIDER=resend");
    return createResendSender(apiKey, from);
  }
  throw new Error(`unknown EMAIL_PROVIDER: ${provider}`);
}

/** Send without delaying or failing the HTTP response that triggered it. */
export function sendInBackground(sender: EmailSender, message: EmailMessage): void {
  void sender.send(message).catch((error: unknown) => consoleError("email delivery failed", error));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(paragraphs: string[], links: Array<{ label: string; url: string }> = []): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  const buttons = links
    .map((link) => `<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`)
    .join("");
  return `<!doctype html><html><body style="font-family:sans-serif;line-height:1.5">${body}${buttons}</body></html>`;
}

const IGNORE = "If you did not request this, you can ignore this email.";

// Email copy is English by design: the server never renders a locale, and the
// pages these links open are localized by the client.

export function verificationEmail(to: string, username: string, url: string): EmailMessage {
  const intro = `Confirm this address as the recovery email for the Fyendal account ${username}.`;
  const expiry = "This link expires in 24 hours.";
  return {
    to,
    subject: "Confirm your Fyendal recovery email",
    text: [intro, url, expiry, IGNORE].join("\n\n"),
    html: layout([intro, expiry, IGNORE], [{ label: "Confirm email", url }]),
  };
}

export function passwordResetEmail(
  to: string,
  accounts: Array<{ username: string; url: string }>,
): EmailMessage {
  const intro = accounts.length === 1
    ? "Someone asked to reset the password for your Fyendal account."
    : "Someone asked to reset the password for the Fyendal accounts that use this email.";
  const expiry = "Each link works once and expires in 30 minutes.";
  return {
    to,
    subject: "Reset your Fyendal password",
    text: [
      intro,
      ...accounts.map((account) => `${account.username}: ${account.url}`),
      expiry,
      IGNORE,
    ].join("\n\n"),
    html: layout(
      [intro, expiry, IGNORE],
      accounts.map((account) => ({ label: `Reset password for ${account.username}`, url: account.url })),
    ),
  };
}

export function emailChangedNotice(to: string, username: string, removed: boolean): EmailMessage {
  const intro = removed
    ? `The recovery email for the Fyendal account ${username} was removed.`
    : `The recovery email for the Fyendal account ${username} was changed to another address.`;
  const warn = "If you did not make this change, sign in and change your recovery email, or contact support.";
  return {
    to,
    subject: "Your Fyendal recovery email changed",
    text: [intro, warn].join("\n\n"),
    html: layout([intro, warn]),
  };
}
