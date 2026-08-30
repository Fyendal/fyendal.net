import type { ErrorCode, ServerMessage } from "@fyendal/shared";

export type WireServerMessage = ServerMessage | { type: "error"; message: string };

/** Compatibility classifier while store methods migrate to coded results. */
function errorCodeFor(message: string): ErrorCode {
  if (message === "room not found") return "ROOM_NOT_FOUND";
  if (message === "room is busy, try again") return "ROOM_BUSY";
  if (message === "leave your current room before joining another") return "ALREADY_IN_ROOM";
  if (message === "log in to play") return "AUTH_REQUIRED";
  if (message === "not in a room") return "NOT_IN_ROOM";
  if (message === "room session replaced") return "SESSION_REPLACED";
  if (message === "room state must be reloaded") return "RESYNC_REQUIRED";
  if (message === "stale room version") return "RESYNC_REQUIRED";
  if (message === "invalid message") return "INVALID_MESSAGE";
  if (message === "internal error") return "INTERNAL_ERROR";
  if (message.includes("presentation") || message.includes("main deck") || message.includes("weapon")) {
    return "INVALID_PRESENTATION";
  }
  if (message.includes("not a player") || message.includes("spectators cannot")) return "FORBIDDEN";
  return "CONFLICT";
}

export function encodeWireMessage(message: WireServerMessage): ServerMessage {
  return message.type === "error" && !("code" in message)
    ? { ...message, code: errorCodeFor(message.message) }
    : message;
}
