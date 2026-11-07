import { describe, expect, it, vi } from "vitest";
import { cardData } from "@fyendal/cards/client";
import {
  createdCardIds,
  createdCardNames,
  createdCardsFitBeside,
  preloadCreatedCardArt,
} from "./createdCards.js";

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

  it("skips token printings whose image is a half-card sheet", () => {
    const ids = createdCardIds("SUP217");
    expect(ids.map((id) => cardData[id]!.name)).toEqual(["Confidence", "Might", "Toughness", "Vigor"]);
    expect(ids.some((id) => id.startsWith("SUP"))).toBe(false);
  });

  it("is empty for a card that creates nothing", () => {
    expect(createdCardIds("WTR160")).toEqual([]);
  });
});

describe("preloadCreatedCardArt", () => {
  it("fetches the art of each created card once", () => {
    const requested: string[] = [];
    class FakeImage { set src(url: string) { requested.push(url); } }
    vi.stubGlobal("Image", FakeImage);
    try {
      preloadCreatedCardArt(["AMO013", "WTR160"]);
      preloadCreatedCardArt(["AMO013"]);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(requested).toEqual(createdCardIds("AMO013").map((id) => `https://content.fabrary.net/cards/${id}.webp`));
  });
});

describe("createdCardsFitBeside", () => {
  it("docks the column beside a preview when the window has room for it", () => {
    expect(createdCardsFitBeside(296, 1280)).toBe(true);
    expect(createdCardsFitBeside(296, 296 + 16 + 12 + 272)).toBe(true);
  });

  it("moves the column under the preview when the window is too narrow", () => {
    expect(createdCardsFitBeside(296, 296 + 16 + 12 + 271)).toBe(false);
    expect(createdCardsFitBeside(604, 800)).toBe(false);
  });
});
