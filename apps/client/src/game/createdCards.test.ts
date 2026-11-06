import { describe, expect, it } from "vitest";
import { cardData } from "@fyendal/cards/client";
import { createdCardIds, createdCardNames, createdCardsLayout } from "./createdCards.js";

const idOf = (name: string) => Object.values(cardData).find((card) => card.name === name)!.id;
const createdBy = (name: string) => createdCardIds(idOf(name)).map((id) => cardData[id]!.name);

describe("createdCardNames", () => {
  it.each([
    ["When this hits, create a Blasmophet, the Insatiable Hunger token.", ["Blasmophet, the Insatiable Hunger"]],
    ["Create a Frailty, Inertia, or Bloodrot Pox token.", ["Frailty", "Inertia", "Bloodrot Pox"]],
    ["Create a Confidence and a Toughness token.", ["Confidence", "Toughness"]],
    ["Create an Agility, Might, and Vigor token.", ["Agility", "Might", "Vigor"]],
    ["Create 3 Crouching Tigers in your banished zone.", ["Crouching Tiger"]],
    ["If you've pitched a blue card this turn, create a Slither in your hand.", ["Slither"]],
    ["When this hits, create 2 Runechant tokens, then create a Gold token.", ["Runechant", "Gold"]],
    ["Banish a card. If you do create a Runechant token.", ["Runechant"]],
    ["Create twice that many Silver tokens.", ["Silver"]],
    ['Your next attack gets "When this hits, create a Corrupted Corpse in your banished zone."', ["Corrupted Corpse"]],
  ])("reads %s", (text, names) => {
    expect(createdCardNames(text)).toEqual(names);
  });

  it.each([
    "If you've created a Fealty token this turn, this gets go again.",
    "Whenever you create 1 or more Runechants, banish the top card of your deck.",
    "If one or more Frostbite tokens would be created under your control, instead destroy this.",
    "If you would create a Gold token, draw a card.",
    "Until end of turn, opponents can't create tokens under your control.",
    "Create a token that's a copy of target aura.",
  ])("ignores %s", (text) => {
    expect(createdCardNames(text)).toEqual([]);
  });
});

describe("createdCardIds", () => {
  it("prefers the token printing from the source's set", () => {
    const [id] = createdCardIds("IAR017");
    expect(id).toBe("IAR221");
  });

  it("never lists a card as creating itself", () => {
    expect(createdBy("Predatory Streak")).toEqual(["Crouching Tiger"]);
    for (const cardId of Object.keys(cardData)) {
      const name = cardData[cardId]!.name;
      expect(createdCardIds(cardId).map((id) => cardData[id]!.name)).not.toContain(name);
    }
  });

  it("is empty for a card that creates nothing", () => {
    expect(createdCardIds("WTR160")).toEqual([]);
  });
});

describe("createdCardsLayout", () => {
  it("fills the source card's height for a single created card", () => {
    const layout = createdCardsLayout(1, 413, 800)!;
    expect(layout.height).toBeLessThanOrEqual(413);
    expect(layout.cardHeight).toBeGreaterThan(413 * 0.85);
    expect(layout.columns).toBe(1);
  });

  it("keeps several created cards in one reduced row when there is room", () => {
    const layout = createdCardsLayout(3, 413, 900)!;
    expect(layout.columns).toBe(3);
    expect(layout.cardHeight).toBeLessThanOrEqual(413 * 0.72);
  });

  it("wraps into rows rather than overflow a narrow window", () => {
    const layout = createdCardsLayout(4, 413, 320)!;
    expect(layout.columns).toBe(2);
    expect(layout.width).toBeLessThanOrEqual(320);
    expect(layout.height).toBeLessThanOrEqual(413);
  });

  it("drops the panel when no legible size fits", () => {
    expect(createdCardsLayout(1, 413, 100)).toBeNull();
    expect(createdCardsLayout(0, 413, 800)).toBeNull();
  });
});
