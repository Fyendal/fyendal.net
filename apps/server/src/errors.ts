import type { ErrorCode, ServerMessage } from "@fyendal/shared";

/** A deck switch lost the race with an opponent taking the open seat. */
export const DECKS_LOCKED = "decks lock once an opponent joins";

export const SANDBOX_REQUIRED = "manual edits are only available in sandbox games";
export const SANDBOX_SEAT_FORBIDDEN = "you cannot edit that seat";
/** Prefix for edits the engine or game phase refuses; the reason follows. */
export const SANDBOX_EDIT_UNAVAILABLE = "sandbox edit unavailable";

export type WireServerMessage = ServerMessage | { type: "error"; message: string };

/** Compatibility classifier while store methods migrate to coded results. */
function errorCodeFor(message: string): ErrorCode {
  if (message === "room not found") return "ROOM_NOT_FOUND";
  if (message === "room is busy, try again") return "ROOM_BUSY";
  if (message === "this connection is already in a room") return "ALREADY_IN_ROOM";
  if (message === "log in to play") return "AUTH_REQUIRED";
  if (message === "not in a room") return "NOT_IN_ROOM";
  if (message === "room session replaced") return "SESSION_REPLACED";
  if (message === "room state must be reloaded") return "RESYNC_REQUIRED";
  if (message === "stale room version") return "RESYNC_REQUIRED";
  if (message === "invalid message") return "INVALID_MESSAGE";
  if (message === DECKS_LOCKED) return "DECK_LOCKED";
  if (message === SANDBOX_REQUIRED) return "SANDBOX_REQUIRED";
  if (message === SANDBOX_SEAT_FORBIDDEN) return "SANDBOX_SEAT_FORBIDDEN";
  if (message.startsWith(SANDBOX_EDIT_UNAVAILABLE)) return "SANDBOX_EDIT_UNAVAILABLE";
  if (message === "internal error") return "INTERNAL_ERROR";
  if (message.includes("presentation") || message.includes("main deck") || message.includes("weapon")) {
    return "INVALID_PRESENTATION";
  }
  if (message.includes("not a player") || message.includes("spectators cannot")
    || message.includes("not a spectator") || message.includes("only spectators")) return "FORBIDDEN";
  return "CONFLICT";
}

export function encodeWireMessage(message: WireServerMessage): ServerMessage {
  return message.type === "error" && !("code" in message)
    ? { ...message, code: errorCodeFor(message.message) }
    : message;
}
