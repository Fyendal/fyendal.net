import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";
import type { AttackQueueEntryView, CardView, ChainLinkView, GameView, PlayerView } from "@fyendal/shared";
import en from "../i18n/catalogs/en.json";
import { ChainFloat } from "./ChainFloat.js";
import { StackFloat } from "./StackFloat.js";
import { detectGameMotionEvents } from "./motion/detectMotionEvents.js";
import { motionTimelinePhase } from "./motion/motionTimeline.js";

const ZERO_TO_SIXTY: CardView = { instanceId: 25, cardId: "ARC026", owner: 0 };
const KISS_OF_DEATH: CardView = { instanceId: 26, cardId: "HNT012", owner: 0 };
const queued = (...cards: CardView[]): AttackQueueEntryView[] => cards.map((card) => ({ card, seat: 0 }));

function player(seat: 0 | 1): PlayerView {
  return {
    seat, heroCardId: `HERO-${seat}`, heroInstanceId: 100 + seat, heroName: `Hero ${seat}`,
    life: 20, actionPoints: 0, resources: 0, hand: [], handCount: 0, deckCount: 0,
    arsenal: [], arsenalCount: 0, pitch: [], pitchCount: 0, graveyard: [], banish: [],
    soul: [], equipment: {}, weapons: [], board: [],
  };
}

function pendingAttack(card: CardView): ChainLinkView {
  return {
    attackingCard: card, defendingCards: [], attackValue: 3, defenseValue: 0,
    damage: 3, resolved: false, onStack: true, reactions: [],
  };
}

function view(overrides: Partial<GameView>): GameView {
  return {
    gameId: "game", turn: 1, phase: "layer", activePlayer: 0, priorityPlayer: 0,
    players: [player(0), player(1)], chain: [], stack: [], ongoing: [],
    pendingDecision: null, winner: null, log: [], ...overrides,
  };
}

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(createElement(IntlProvider, { locale: "en", messages: en }, element));
}

describe("attack queue presentation", () => {
  it("drops a resolved attack into the queue tray", () => {
    const before = view({
      chain: [pendingAttack(ZERO_TO_SIXTY)],
      stack: [{ card: KISS_OF_DEATH, seat: 0, label: "Kiss of Death", optional: false }],
    });
    const after = view({ chain: [pendingAttack(ZERO_TO_SIXTY)], attackQueue: queued(KISS_OF_DEATH) });

    const move = detectGameMotionEvents(before, after).find((event) => event.instanceId === 26);
    expect(move).toMatchObject({
      kind: "move",
      source: { kind: "stack-layer", index: 0 },
      destination: { kind: "attack-queue", index: 0 },
    });
    expect(motionTimelinePhase(move!)).toBe("resolution");
  });

  it("raises the next attack only after the resolving attack joins the queue", () => {
    const before = view({ chain: [pendingAttack(ZERO_TO_SIXTY)], attackQueue: queued(KISS_OF_DEATH) });
    const after = view({ chain: [pendingAttack(KISS_OF_DEATH)], attackQueue: queued(ZERO_TO_SIXTY) });

    const events = detectGameMotionEvents(before, after);
    const joins = events.find((event) => event.instanceId === 25)!;
    const rises = events.find((event) => event.instanceId === 26)!;
    expect(joins).toMatchObject({ source: { kind: "stack-layer" }, destination: { kind: "attack-queue", index: 0 } });
    expect(rises).toMatchObject({ source: { kind: "attack-queue", index: 0 }, destination: { kind: "stack-layer" } });
    expect(motionTimelinePhase(joins)).toBe("resolution");
    expect(motionTimelinePhase(rises)).toBe("queue-advance");
  });

  it("lists queued attacks in order beneath the stack", () => {
    const html = render(createElement(StackFloat, {
      layers: [{ card: KISS_OF_DEATH, seat: 0, label: "Attack layer", optional: false }],
      queue: queued(ZERO_TO_SIXTY),
    }));
    expect(html).toContain('stack-title">Stack</span>');
    expect(html).toContain('<section class="stack-queue" aria-label="Attack queue">');
    expect(html).toContain('data-motion-zone="stack:queue:0"');
    expect(html).toContain('class="stack-queue-order" aria-hidden="true">1</span>');
    expect(html).toContain("Zero to Sixty");
  });

  it("shrinks to a one-line queue strip when no layer is left", () => {
    const html = render(createElement(StackFloat, { layers: [], queue: queued(ZERO_TO_SIXTY, KISS_OF_DEATH) }));
    expect(html).toContain("stack-queue-strip");
    expect(html).not.toContain('stack-title">Stack</span>');
    expect(html).not.toContain("stack-layers");
    expect(html).toContain('data-motion-zone="stack:queue:1"');
  });

  it("leaves the queue out of the combat chain window", () => {
    const link: ChainLinkView = { ...pendingAttack(KISS_OF_DEATH), onStack: false };
    const html = render(createElement(ChainFloat, { links: [link], onRect: () => undefined }));
    expect(html).not.toContain("queue");
  });
});
