import type { OngoingEffectView } from "@fyendal/shared";
import { createElement, type ReactElement } from "react";
import { createIntl } from "react-intl";
import englishMessages from "../../i18n/catalogs/en.json" with { type: "json" };
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { EffectHeroesContext, effectHeroes, type EffectHero } from "./effectHeroes.js";
import { EffectLedger } from "./EffectLedger.js";
import { EffectPins, EffectSlot, chipGridFor } from "./EffectSlot.js";

const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(TestI18nProvider, null, element));

const nextAttack: OngoingEffectView = {
  seat: 0,
  cardId: "WTR160",
  label: "+1 attack · next attack",
  sourceSeat: 0,
  summary: "+1 attack",
  lifetime: "once",
  duration: "next attack",
  durationMessage: { id: "engine.effect.duration.next.attack" },
};
const restriction: OngoingEffectView = {
  seat: 0,
  cardId: "",
  label: "can't draw cards · next action phase",
  sourceSeat: 1,
  summary: "can't draw cards",
  summaryMessage: { id: "engine.effect.summary.cannot.draw" },
  lifetime: "later",
  duration: "next action phase",
  durationMessage: { id: "engine.effect.duration.next.action.phase" },
};
const infection: OngoingEffectView = {
  seat: 0,
  cardId: "",
  sourceHidden: true,
  label: "Create a token · each of their end phases",
  sourceSeat: 1,
  summary: "Create a token",
  lifetime: "game",
  duration: "each of their end phases",
  durationMessage: { id: "engine.effect.duration.each.end.phase" },
  recurring: true,
};

const slot = (effects: OngoingEffectView[], compact = false) => render(createElement(EffectSlot, {
  effects,
  area: "3 / 2 / span 1 / span 3",
  heroName: "Azalea",
  compact,
  onOpen: vi.fn(),
}));

describe("EffectSlot", () => {
  it("renders desktop chips with localized text, a written lifetime, and a stack count", () => {
    const html = slot([nextAttack, nextAttack, restriction]);

    expect(html).toContain('aria-label="Azalea: 3 lingering effects. Show effects."');
    expect(html).toContain('data-cardid="WTR160"');
    expect(html).toContain('data-effect-label="+1 attack\nNext attack ×2"');
    expect(html).toContain("×2");
    expect(html).toContain("Can&#x27;t draw cards");
    // The written lifetime needs no glyph beside it.
    expect(html).toContain('<span class="effect-life">Next attack</span>');
    expect(html).not.toContain("/icons/ui/effect-once.svg");
    // Without a source card the glyph stands in for the art.
    expect(html).toContain("/icons/ui/effect-later.svg");
    expect(html).toMatch(/class="effect-chip effect-imposed"/);
  });

  it("fills every cell with an effect and attaches the hidden count to the last chip", () => {
    const many = Array.from({ length: 8 }, (_, index) => ({ ...nextAttack, label: `+${index} · next attack` }));
    const html = slot(many);

    expect(html.match(/class="effect-chip[" ]/g)).toHaveLength(6);
    expect(html.match(/class="effect-more"/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="effect-more">\+2<\/span><\/span><\/button>$/);
  });

  it("shows phone effects as mat-sized card tiles with a lifetime badge", () => {
    const html = slot([nextAttack, nextAttack, restriction], true);

    expect(html.match(/class="effect-card[ "]/g)).toHaveLength(2);
    expect(html).toContain("card-zone");
    expect(html).toContain('<span class="effect-card-count">×2</span>');
    expect(html).toMatch(/class="effect-card effect-imposed".*Can&#x27;t draw cards/);
    expect(html).toContain("/icons/ui/effect-once.svg");
    expect(html).toContain("/icons/ui/effect-later.svg");
    expect(html).not.toContain("effect-card-more");
  });

  it("turns the last phone tile into an overflow pile", () => {
    const many = Array.from({ length: 4 }, (_, index) => ({ ...nextAttack, label: `+${index} · next attack` }));
    const html = slot(many, true);

    expect(html.match(/class="effect-card[ "]/g)).toHaveLength(1);
    expect(html).toContain('<span class="effect-card-more-count">+3</span>');
    expect(html).toContain("more");
  });

  it("leaves rest-of-game effects out of the slot", () => {
    expect(slot([infection])).toBe("");
  });
});

describe("chipGridFor", () => {
  const slotBox = { left: 100, top: 600, right: 420, bottom: 708 };

  it("uses up to three rows of the full slot when nothing covers it", () => {
    expect(chipGridFor(slotBox, [])).toEqual({ columns: 2, rows: 3, obstructed: false });
    // A hand card beside the slot does not reduce it.
    expect(chipGridFor(slotBox, [{ left: 430, top: 640, right: 580, bottom: 850 }]).rows).toBe(3);
  });

  it("keeps only the rows clear above an overlapping hand card", () => {
    expect(chipGridFor(slotBox, [{ left: 240, top: 657, right: 390, bottom: 863 }]))
      .toEqual({ columns: 2, rows: 1, obstructed: true });
    expect(chipGridFor(slotBox, [{ left: 240, top: 680, right: 390, bottom: 863 }]).rows).toBe(2);
    // Even a fully covered slot keeps one row so the effects stay reachable.
    expect(chipGridFor(slotBox, [{ left: 0, top: 500, right: 900, bottom: 900 }]).rows).toBe(1);
  });
});

describe("EffectPins", () => {
  it("pins rest-of-game effects to the hero with a recurring glyph", () => {
    const html = render(createElement(EffectPins, { effects: [infection, nextAttack], onOpen: vi.fn() }));

    expect(html.match(/class="effect-pin[ "]/g)).toHaveLength(1);
    expect(html).toContain("effect-imposed");
    expect(html).toContain("/icons/ui/effect-recurring.svg");
    expect(html).toContain('aria-label="Create a token, each of their end phases"');
    expect(html).not.toContain("effect-pin-count");
  });

  it("adds how many more identical effects share a pin to its tooltip", () => {
    const html = render(createElement(EffectPins, { effects: [infection, infection, infection], onOpen: vi.fn() }));

    expect(html.match(/class="effect-pin[ "]/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Create a token, each of their end phases +2"');
  });
});

describe("effectHeroes", () => {
  const intl = createIntl({ locale: "en", messages: englishMessages });
  const players = [
    { seat: 0, heroCardId: "HNT054", heroName: "Cindra, Dracai of Retribution" },
    { seat: 1, heroCardId: "HNT054", heroName: "Cindra, Dracai of Retribution" },
  ];

  it("labels heroes by name, adding the player only in a mirror match", () => {
    expect(effectHeroes(intl, [players[0]!, { ...players[1]!, heroName: "Azalea" }], ["alice", "bob"])
      .map((hero) => hero.label)).toEqual(["Cindra, Dracai of Retribution", "Azalea"]);
    expect(effectHeroes(intl, players, ["alice", null]).map((hero) => hero.label)).toEqual([
      "Cindra, Dracai of Retribution (alice)",
      "Cindra, Dracai of Retribution (Player 2)",
    ]);
  });
});

describe("EffectLedger", () => {
  const heroes: EffectHero[] = [
    { seat: 0, heroCardId: "AAZ001", label: "Azalea" },
    { seat: 1, heroCardId: "HNT054", label: "Cindra" },
  ];
  const ledger = (props: Omit<Parameters<typeof EffectLedger>[0], "onClose" | "onInspectCard">) => render(
    createElement(EffectHeroesContext.Provider, { value: heroes }, createElement(EffectLedger, {
      ...props,
      onClose: vi.fn(),
      onInspectCard: vi.fn(),
    })),
  );

  it("groups the selected hero's effects by when they end", () => {
    const html = ledger({
      effects: [infection, restriction, nextAttack, { ...nextAttack, seat: 1 }],
      target: { seat: 0 },
    });

    const headings = [...html.matchAll(/<h3 class="effect-ledger-heading">.*?<\/span><\/span>([^<]+)<\/h3>/g)]
      .map((match) => match[1]);
    expect(headings).toEqual(["Next use", "Coming up", "Rest of game"]);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('<span class="effect-ledger-tab-count">3</span>');
    expect(html).toContain('data-cardid="WTR160"');
    expect(html).toContain('<span class="effect-ledger-source">Tome of Fyendal</span>');
    expect(html).toContain('<span class="effect-ledger-duration">Next attack</span>');
    // A face-down source still needs the imposer spelled out, and is not
    // styled as a card name.
    expect(html).toContain('<span class="effect-ledger-source effect-ledger-source-generic">Face-down card</span>');
    expect(html.match(/Imposed by Cindra/g)).toHaveLength(1);
  });

  it("shows the source hero for an effect without a source card", () => {
    const html = ledger({ effects: [restriction], target: { seat: 0 } });

    expect(html).toContain('data-cardid="HNT054"');
    expect(html).toContain("cards/HNT054");
    expect(html).toContain('<span class="effect-ledger-source">Cindra</span>');
    expect(html).not.toContain("Imposed by");
    expect(html).not.toContain("Hero effect");
  });

  it("omits a duration that only repeats its section heading", () => {
    const thisTurn: OngoingEffectView = {
      ...nextAttack,
      lifetime: "turn",
      duration: "this turn",
      durationMessage: { id: "engine.effect.duration.this.turn" },
    };
    const html = ledger({ effects: [thisTurn], target: { seat: 0 } });

    expect(html).toContain(">This turn</h3>");
    expect(html).not.toContain("effect-ledger-duration");
  });

  it("explains an empty hero", () => {
    const html = ledger({ effects: [nextAttack], target: { seat: 1 } });

    expect(html).toContain("No lingering effects on Cindra.");
  });
});
