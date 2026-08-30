import type { ServerMessage } from "@fyendal/shared";
import type { ErrorLogger } from "./logging.js";
import {
  type PgRoomStore,
  prepViewFor,
  spectatorCount,
  stateMessage,
  type RoomRow,
} from "./store.js";

export type RoomBroadcastEvent =
  | { code: string; kind: "sync" | "created" | "joined" | "left" | "prep" | "game-started" | "state" | "spectators"; version: number }
  | { code: string; kind: "presence"; seat: number; connected: boolean; version: number }
  | { code: string; kind: "deleted"; version: number };

export interface RoomBroadcastClient {
  code: string | null;
  send(message: ServerMessage): void;
  sendRaw(payload: string): void;
  close(code: number, reason: string): void;
}

interface RoomBroadcasterDeps<Client extends RoomBroadcastClient> {
  rooms: PgRoomStore;
  clientsFor(code: string): Iterable<Client>;
  authorize(room: RoomRow, client: Client): number | null | undefined;
  detach(client: Client): void;
  broadcastLobby(): Promise<void>;
  logError?: ErrorLogger;
}

/**
 * Single-instance, post-commit room fan-out. Every authoritative reload and
 * projection cache belongs to one call; the broadcaster retains no room state.
 */
export class RoomBroadcaster<Client extends RoomBroadcastClient> {
  constructor(private readonly deps: RoomBroadcasterDeps<Client>) {}

  /** Broadcasting is deliberately best-effort: a committed mutation remains
   * successful even if its fan-out fails. Affected sockets are fenced and will
   * reload authoritative state through their normal reconnect flow. */
  async afterCommit(event: RoomBroadcastEvent): Promise<void> {
    try {
      await this.broadcast(event);
    } catch (error) {
      this.deps.logError?.(
        `post-commit room broadcast failed (${event.code} v${event.version})`,
        error,
      );
      for (const client of [...this.deps.clientsFor(event.code)]) {
        client.send({
          type: "error",
          code: "RESYNC_REQUIRED",
          message: "room state must be reloaded",
        });
        this.deps.detach(client);
        client.close(1012, "resync required");
      }
    }
  }

  private async broadcast(event: RoomBroadcastEvent): Promise<void> {
    const clients = [...this.deps.clientsFor(event.code)];
    const room = await this.deps.rooms.getRoom(event.code);
    if (!room) {
      for (const client of clients) {
        client.send({ type: "error", code: "ROOM_NOT_FOUND", message: "room not found" });
        this.deps.detach(client);
      }
      await this.deps.broadcastLobby();
      return;
    }
    if (room.version < event.version) {
      throw new Error(`authoritative room version ${room.version} precedes committed version ${event.version}`);
    }

    const refreshLobby = event.kind === "sync"
      || event.kind === "created"
      || event.kind === "joined"
      || event.kind === "left"
      || event.kind === "game-started"
      || event.kind === "deleted"
      || (event.kind === "state" && room.state?.winner != null);
    if (refreshLobby) await this.deps.broadcastLobby();

    const announcesGameStart = event.kind === "game-started"
      || ((event.kind === "prep" || event.kind === "sync") && !!room.state);
    const sendState = event.kind === "state" || (event.kind === "sync" && !!room.state) || announcesGameStart;
    const sendPrep = (event.kind === "prep" || event.kind === "sync") && !room.state;
    const payloads = new Map<string, string>();
    const encoded = (key: string, make: () => ServerMessage | null): string | null => {
      const cached = payloads.get(key);
      if (cached) return cached;
      const message = make();
      if (!message) return null;
      const payload = JSON.stringify(message);
      payloads.set(key, payload);
      return payload;
    };

    for (const client of clients) {
      if (client.code !== event.code) continue;
      const projectionSeat = this.deps.authorize(room, client);
      if (projectionSeat === undefined) continue;
      const projectionKey = projectionSeat === null ? "spectator" : `seat-${projectionSeat}`;
      if (announcesGameStart) {
        client.sendRaw(encoded("game-started", () => ({ type: "game-started", version: room.version }))!);
      }
      if (sendState) {
        const payload = encoded(`state-${projectionKey}`, () => stateMessage(room, projectionSeat));
        if (payload) client.sendRaw(payload);
      }
      if (sendPrep && projectionSeat !== null) {
        client.sendRaw(encoded(`prep-${projectionKey}`, () => ({
          type: "prep-state",
          prep: prepViewFor(room, projectionSeat),
          version: room.version,
        }))!);
      }
      if (event.kind === "spectators") {
        client.sendRaw(encoded("spectators", () => ({
          type: "spectators",
          count: spectatorCount(room),
          version: room.version,
        }))!);
      }
      if (event.kind === "presence" && projectionSeat !== null && projectionSeat !== event.seat) {
        client.sendRaw(encoded(`presence-${event.seat}-${event.connected}`, () => ({
          type: event.connected ? "opponent-reconnected" : "opponent-disconnected",
          version: room.version,
        }))!);
        if (!room.state) {
          client.sendRaw(encoded(`presence-prep-${projectionKey}`, () => ({
            type: "prep-state",
            prep: prepViewFor(room, projectionSeat),
            version: room.version,
          }))!);
        }
      }
    }
  }
}
