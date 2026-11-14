import { describe, expect, it } from "vitest";
import { createTestIntl } from "../i18n/TestI18nProvider.js";
import { playableZoneTooltip } from "./playableZoneTooltip.js";

const intl = createTestIntl("en");

describe("playable-zone tooltip", () => {
  it("names the card whose ability granted graveyard access", () => {
    expect(playableZoneTooltip(intl, {
      instanceId: 10,
      cardId: "AGB011",
      owner: 0,
      playableFromSourceCardId: "AGB001",
    }, "graveyard")).toBe(
      "Gravy Bones, Shipwrecked Looter’s ability allows this card to be played from your graveyard.",
    );
  });

  it("falls back safely when legacy state has no permission source", () => {
    expect(playableZoneTooltip(intl, {
      instanceId: 11,
      cardId: "WTR001",
      owner: 0,
    }, "banish")).toBe(
      "An active card effect allows this card to be played from your banished zone.",
    );
  });
});
