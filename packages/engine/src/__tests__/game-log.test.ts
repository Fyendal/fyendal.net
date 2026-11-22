import { describe, expect, it } from "vitest";
import { MAX_LOG_MESSAGE_VALUE_TEXT, gameLogMessage, logCardValue } from "../gameLog.js";

describe("gameLogMessage", () => {
  it("bounds text values to the persisted-state limit", () => {
    const payload = gameLogMessage("fallback", "engine.log.test", {
      cards: "x".repeat(MAX_LOG_MESSAGE_VALUE_TEXT + 50),
      short: "ok",
      card: logCardValue("WTR001"),
      count: 3,
    });
    const values = payload.message.values!;
    expect(values.cards).toHaveLength(MAX_LOG_MESSAGE_VALUE_TEXT);
    expect(String(values.cards).endsWith("…")).toBe(true);
    expect(values).toMatchObject({ short: "ok", card: { kind: "card", cardId: "WTR001" }, count: 3 });
  });
});
