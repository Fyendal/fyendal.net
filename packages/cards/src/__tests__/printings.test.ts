import { describe, expect, it, vi } from "vitest";
import { cardData, scripts, warnOnInconsistentPrintings } from "../index.js";

describe("printing consistency", () => {
  it("uses the correct defense for each Golden Company pitch", () => {
    const expectedDefenseByPitch = new Map([[1, 6], [2, 5], [3, 4]]);
    const printings = Object.values(cardData).filter((card) => card.name === "Golden Company");

    expect(printings.length).toBeGreaterThan(0);
    for (const printing of printings) {
      expect(printing.defense, printing.id).toBe(expectedDefenseByPitch.get(printing.pitch!));
    }
  });

  it("applies the September 2026 text errata to every affected printing", () => {
    const expectedText = new Map([
      [
        "Levia",
        "If a card with 6 or more {p} has been put into your banished zone this turn, you don't lose {h} from blood debt during the end phase.",
      ],
      [
        "Levia, Shadowborn Abomination",
        "If a card with 6 or more {p} has been put into your banished zone this turn, you don't lose {h} from blood debt during the end phase.",
      ],
      [
        "Line Crossers",
        "If you have the same {h} as another hero, it also counts as you having more {h} than them, and them having less {h} than you.\nBlade Break",
      ],
    ]);

    for (const [name, text] of expectedText) {
      const printings = Object.values(cardData).filter((card) => card.name === name);
      expect(printings.length, `${name} should have imported printings`).toBeGreaterThan(0);
      for (const printing of printings) expect(printing.text).toBe(text);
    }
  });

  it("reprints of the same functional card agree on functional fields", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      warnOnInconsistentPrintings(Object.values(cardData));
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("links every Transcend printing to an Inner Chi back face", () => {
    const transcendPrintings = Object.values(cardData).filter((card) =>
      (card.keywords ?? []).some((keyword) => keyword.trim().toLowerCase() === "transcend"),
    );

    expect(transcendPrintings.length).toBeGreaterThan(0);
    for (const front of transcendPrintings) {
      expect(scripts[front.id], `${front.id} (${front.name}) must have a functional script`)
        .toBeDefined();
      const back = front.backId ? cardData[front.backId] : undefined;
      expect(back, `${front.id} (${front.name}) must link to an Inner Chi back face`).toMatchObject({
        name: "Inner Chi",
        cardType: "resource",
        pitch: 3,
        subtypes: expect.arrayContaining(["chi"]),
      });
    }
  });
});
