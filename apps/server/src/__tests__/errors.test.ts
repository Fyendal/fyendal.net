import { describe, expect, it } from "vitest";
import { encodeWireMessage } from "../errors.js";

describe("typed wire errors", () => {
  it.each([
    ["room not found", "ROOM_NOT_FOUND"],
    ["room is busy, try again", "ROOM_BUSY"],
    ["log in to play", "AUTH_REQUIRED"],
    ["invalid message", "INVALID_MESSAGE"],
    ["stale room version", "RESYNC_REQUIRED"],
  ] as const)("codes %s independently of client text behavior", (message, code) => {
    expect(encodeWireMessage({ type: "error", message })).toEqual({ type: "error", code, message });
  });
});
