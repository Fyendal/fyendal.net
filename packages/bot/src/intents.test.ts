import { describe, expect, it } from "vitest";
import { isAdvertisedBotIntent } from "./intents.js";

describe("advertised bot intents", () => {
  it("allows combined defender staging but rejects duplicate and unknown cards", () => {
    const legal = [
      { kind: "stage-defenders" as const, instanceIds: [1] },
      { kind: "stage-defenders" as const, instanceIds: [2] },
    ];
    expect(isAdvertisedBotIntent({ kind: "stage-defenders", instanceIds: [1, 2] }, legal)).toBe(true);
    for (const ids of [[1, 1], [1, 3], []]) {
      expect(isAdvertisedBotIntent({ kind: "stage-defenders", instanceIds: ids }, legal)).toBe(false);
    }
    expect(isAdvertisedBotIntent({ kind: "concede" }, legal)).toBe(false);
  });
});
