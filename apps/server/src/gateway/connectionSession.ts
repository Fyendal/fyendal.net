import { randomBytes } from "node:crypto";
import type { AuthUser } from "../auth.js";
import type { WireServerMessage } from "../errors.js";

/** Mutable state owned by exactly one local WebSocket connection. */
export interface ClientCtx {
  closed: boolean;
  code: string | null;
  seat: number | null;
  token: string | null;
  presenceLeaseId: string | null;
  user: AuthUser | null;
  sessionToken: string | null;
  /** Process-local spam guard for ephemeral room emotes. */
  lastEmoteAt: number;
  close: (code: number, reason: string) => void;
  send: (msg: WireServerMessage) => void;
  sendRaw: (payload: string) => void;
}

/** Process-local socket ownership for one gateway. Durable authority is in Postgres. */
export class ConnectionRegistry {
  readonly all = new Set<ClientCtx>();
  readonly lobby = new Set<ClientCtx>();
  readonly byRoom = new Map<string, Set<ClientCtx>>();
  readonly bySessionToken = new Map<string, Set<ClientCtx>>();

  bindSession(ctx: ClientCtx, token: string): void {
    this.unbindSession(ctx);
    ctx.sessionToken = token;
    let clients = this.bySessionToken.get(token);
    if (!clients) this.bySessionToken.set(token, (clients = new Set()));
    clients.add(ctx);
  }

  unbindSession(ctx: ClientCtx): void {
    if (!ctx.sessionToken) return;
    const clients = this.bySessionToken.get(ctx.sessionToken);
    clients?.delete(ctx);
    if (clients?.size === 0) this.bySessionToken.delete(ctx.sessionToken);
    ctx.sessionToken = null;
  }

  attach(ctx: ClientCtx, code: string, seat: number | null, token: string): void {
    if (ctx.code !== null) throw new Error(`connection is already attached to room ${ctx.code}`);
    ctx.code = code;
    ctx.seat = seat;
    ctx.token = token;
    ctx.presenceLeaseId = randomBytes(12).toString("hex");
    ctx.lastEmoteAt = 0;
    this.lobby.delete(ctx);
    let clients = this.byRoom.get(code);
    if (!clients) this.byRoom.set(code, (clients = new Set()));
    clients.add(ctx);
  }

  detach(ctx: ClientCtx): void {
    if (ctx.code) {
      const clients = this.byRoom.get(ctx.code);
      clients?.delete(ctx);
      if (clients?.size === 0) this.byRoom.delete(ctx.code);
    }
    ctx.code = null;
    ctx.seat = null;
    ctx.token = null;
    ctx.presenceLeaseId = null;
  }
}
