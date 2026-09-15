import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "@fyendal/shared";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { PlayerHalf } from "./PlayerHalf.js";

const player: PlayerView = {
  seat: 0,
  heroCardId: "TST-HERO",
  heroInstanceId: 1,
  heroName: "Test Hero",
  life: 40,
  actionPoints: 1,
  resources: 0,
  hand: [],
  handCount: 0,
  deckCount: 0,
  arsenal: [],
  arsenalCount: 0,
  pitch: [],
  pitchCount: 0,
  graveyard: [],
  banish: [],
  soul: [],
  equipment: {},
  weapons: [],
  board: [
    { instanceId: 2, cardId: "TST-UPRIGHT", owner: 0 },
    { instanceId: 3, cardId: "TST-TAPPED", owner: 0, tapped: true },
  ],
};

function renderPlayerHalf(
  playerView: PlayerView,
  mine = true,
  visibleDeckTop?: PlayerView["visibleDeckTop"],
  stageableDefenderId?: number,
  locale: "en" | "zh-Hans" = "en",
): string {
  return renderToStaticMarkup(
    <TestI18nProvider locale={locale}>
      <PlayerHalf
      player={playerView}
      mine={mine}
      mirrored={false}
      ongoing={[]}
      gameOver={false}
      replaying={false}
      visibleDeckTop={visibleDeckTop}
      deckShuffling={false}
      interaction={{
        legal: {
          playableHand: new Set(),
          playableArsenal: new Set(),
          playableZones: new Map(),
          activatable: new Set(),
          stageableDefenders: new Set(stageableDefenderId === undefined ? [] : [stageableDefenderId]),
          canPass: false,
          canCloseChain: false,
        },
        selection: { kind: "none" },
        preStackSelectedInstanceId: null,
        stagedIds: new Set(),
        committedDefenderIds: new Set(),
        optimisticallyHiddenIds: new Set(),
        defending: stageableDefenderId !== undefined,
        onStage: () => undefined,
        onActivate: () => undefined,
        onSelect: () => undefined,
      }}
      latestEmote={null}
      canSendEmote={false}
      mobileFloatViewport={false}
      onSendEmote={() => undefined}
      onOpenOverlay={() => undefined}
      />
    </TestI18nProvider>,
  );
}

describe("PlayerHalf", () => {
  it("localizes board zone labels in Chinese", () => {
    const html = renderPlayerHalf(player, true, undefined, undefined, "zh-Hans");

    expect(html).toContain('title="牌库"');
    expect(html).toContain('title="Arsenal"');
    expect(html).toContain('title="墓地"');
    expect(html).toContain('title="放逐区"');
    expect(html).toContain('title="武器"');
  });

  it("marks tapped board-card wrappers with a landscape layout footprint", () => {
    const html = renderPlayerHalf(player);

    expect(html).toContain('class="board-card-stack" data-cardid="TST-UPRIGHT"');
    expect(html).toContain(
      'class="board-card-stack board-card-stack-tapped" data-cardid="TST-TAPPED"',
    );
    expect(html).toMatch(
      /board-card-stack board-card-stack-tapped[^>]*>.*equipment-stack.*card-tapped/,
    );
    expect(html).toContain('data-motion-zone="0:board"');
    expect(html).toContain('data-motion-zone="0:deck"');
    expect(html).toContain('data-motion-zone-anchor="0:deck"');
    expect(html).toContain('data-motion-zone="0:pitch"');
    expect(html).toContain('data-motion-zone="0:arsenal"');
    expect(html).toContain('data-motion-zone="0:graveyard"');
    expect(html).toContain('data-motion-zone="0:banish"');
    expect(html).toContain('data-motion-card="0:board:2"');
    expect(html).toContain('data-motion-card="0:board:3"');
    expect(html).not.toContain("soul-pip");
  });

  it("shows the hero's soul count with the permanent soul icon", () => {
    const html = renderPlayerHalf({
      ...player,
      soul: [
        { instanceId: 10, cardId: "TST-SOUL-1", owner: 0 },
        { instanceId: 11, cardId: "TST-SOUL-2", owner: 0 },
      ],
    });

    expect(html).toContain('aria-label="2 cards in soul"');
    expect(html).toContain('src="/icons/soul.svg" width="24" height="24"');
    expect(html).toContain('class="soul-pip-count">2</span>');
  });

  it("stacks bindings under their tapped ally with a bound indicator", () => {
    const html = renderPlayerHalf({
      ...player,
      board: [
        { instanceId: 2, cardId: "IAR059", owner: 0, tapped: true },
        { instanceId: 10, cardId: "IAR066", owner: 0, boundToInstanceId: 2 },
        { instanceId: 11, cardId: "IAR067", owner: 0, boundToInstanceId: 2 },
      ],
    });

    expect(html).toContain(
      'class="board-card-stack board-card-stack-tapped" data-cardid="IAR059"',
    );
    expect(html).toContain(
      'class="equipment-stack equipment-stack-bound equipment-stack-bound-tapped"',
    );
    expect(html).toContain('aria-label="2 bound cards"');
    expect(html.match(/data-motion-card="0:board:/g)).toHaveLength(3);
    expect(html.match(/class="board-card-stack/g)).toHaveLength(1);
  });

  it("uses a visible deck-top card as the exact deck motion endpoint", () => {
    const top = { instanceId: 20, cardId: "TST-TOP", owner: 0 };
    const html = renderPlayerHalf({
      ...player,
      deckCount: 3,
    }, true, top);

    expect(html).toMatch(
      /data-motion-card="0:deck:20"[^>]*data-motion-zone-anchor="0:deck"/,
    );
    expect(html).toContain(
      'class="zone-card-pile zone-card-pile-multiple" data-stack-depth="3"',
    );
  });

  it("adds depth layers only to multi-card deck, graveyard, and banish piles", () => {
    const html = renderPlayerHalf({
      ...player,
      deckCount: 2,
      graveyard: [
        { instanceId: 21, cardId: "TST-GRAVE-1", owner: 0 },
        { instanceId: 22, cardId: "TST-GRAVE-2", owner: 0 },
      ],
      banish: [
        { instanceId: 23, cardId: "TST-BANISH-1", owner: 0 },
      ],
    });

    expect(html.match(/zone-card-pile-multiple/g)).toHaveLength(2);
    expect(html.match(/data-stack-depth="2"/g)).toHaveLength(2);
    expect(html).toMatch(/title="Graveyard".*pitch-top zone-card-pile zone-card-pile-multiple/);
    expect(html).toMatch(/title="Banished".*pitch-top zone-card-pile"/);
  });

  it("anchors every grouped copy to the wrapper that also owns its count badge", () => {
    const html = renderPlayerHalf({
      ...player,
      board: [
        { instanceId: 2, cardId: "TST-UPRIGHT", owner: 0 },
        { instanceId: 4, cardId: "TST-UPRIGHT", owner: 0 },
      ],
    });

    expect(html).toMatch(
      /class="board-card-stack board-card-stack-multiple" data-stack-depth="2"[^>]*data-motion-card="0:board:2"[^>]*data-motion-card-aliases="0:board:4"[^>]*>.*board-card-count" aria-label="2 stacked cards">×2</,
    );
    expect(html.match(/data-motion-card="0:board:/g)).toHaveLength(1);
  });

  it("renders a card back from the public count for any non-owned hidden arsenal", () => {
    const html = renderPlayerHalf({
      ...player,
      seat: 1,
      arsenalCount: 1,
    }, false);

    expect(html).toContain('<div class="c-backlabel">Arsenal</div>');
    expect(html).toContain('data-motion-card="1:arsenal:opaque"');
  });

  it("renders New Horizon's two arsenal slots and both owned cards", () => {
    const html = renderPlayerHalf({
      ...player,
      arsenal: [
        { instanceId: 30, cardId: "TST-ARROW-1", owner: 0, arsenalSlot: 0 },
        { instanceId: 31, cardId: "TST-ARROW-2", owner: 0, faceDown: true, arsenalSlot: 1 },
      ],
      arsenalCount: 2,
      arsenalCapacity: 2,
    });

    expect(html).toContain("zone-arsenal-multiple");
    expect(html).toContain('data-arsenal-slot="0"');
    expect(html).toContain('data-arsenal-slot="1"');
    expect(html).toContain('aria-label="Arsenal 1"');
    expect(html).toContain('aria-label="Arsenal 2"');
    expect(html).toContain('data-cardid="TST-ARROW-1"');
    expect(html).toContain('data-cardid="TST-ARROW-2"');
    expect(html).not.toContain("arsenal-slot-index");
  });

  it("shows New Horizon's empty additional arsenal slot", () => {
    const html = renderPlayerHalf({
      ...player,
      arsenal: [{ instanceId: 30, cardId: "TST-ARROW-1", owner: 0, arsenalSlot: 0 }],
      arsenalCount: 1,
      arsenalCapacity: 2,
    });

    expect(html).toMatch(
      /class="arsenal-slot arsenal-slot-empty" data-arsenal-slot="1"[^>]*aria-label="Arsenal 2"/,
    );
  });

  it("renders an opponent's public and hidden arsenal cards in separate slots", () => {
    const html = renderPlayerHalf({
      ...player,
      seat: 1,
      arsenal: [{ instanceId: 30, cardId: "TST-FACE-UP", owner: 1, arsenalSlot: 1 }],
      arsenalCount: 2,
      arsenalCapacity: 2,
    }, false);

    expect(html).toContain('data-cardid="TST-FACE-UP"');
    expect(html).toContain('<div class="c-backlabel">Arsenal</div>');
    expect(html).not.toContain('<div class="c-backlabel">Arsenal 1</div>');
    expect(html).toContain('data-motion-card="1:arsenal:opaque:1"');
  });

  it("makes the second arsenal card independently stageable", () => {
    const secondArsenalCard = {
      instanceId: 31,
      cardId: "TST-AMBUSH-2",
      owner: 0,
      faceDown: true,
      arsenalSlot: 1,
    };
    const html = renderPlayerHalf({
      ...player,
      arsenal: [
        { instanceId: 30, cardId: "TST-ARROW-1", owner: 0, arsenalSlot: 0 },
        secondArsenalCard,
      ],
      arsenalCount: 2,
      arsenalCapacity: 2,
    }, true, undefined, secondArsenalCard.instanceId);

    expect(html).toMatch(
      /card-highlight[^>]*data-cardid="TST-AMBUSH-2"|data-cardid="TST-AMBUSH-2"[^>]*card-highlight/,
    );
  });

  it("makes a stageable arsenal defender highlighted and clickable", () => {
    const arsenalCard = {
      instanceId: 30,
      cardId: "TST-AMBUSH",
      owner: 0,
      faceDown: true,
    };
    const html = renderPlayerHalf({
      ...player,
      arsenal: [arsenalCard],
      arsenalCount: 1,
    }, true, undefined, arsenalCard.instanceId);

    expect(html).toMatch(
      /class="card card-zone [^"]*card-highlight[^"]*card-clickable"[^>]*data-cardid="TST-AMBUSH"/,
    );
  });

  it("makes a stageable arena permanent highlighted and clickable", () => {
    const html = renderPlayerHalf(player, true, undefined, 2);

    expect(html).toMatch(
      /class="card card-zone [^"]*card-highlight[^"]*card-clickable"[^>]*data-cardid="TST-UPRIGHT"/,
    );
  });

  it("shows how many cards remain under an arena construct", () => {
    const html = renderPlayerHalf({
      ...player,
      board: [{
        instanceId: 40,
        cardId: "DYN092B",
        owner: 0,
        subcards: [
          { instanceId: 41, cardId: "DYN111", owner: 0 },
          { instanceId: 42, cardId: "DYN111", owner: 0 },
          { instanceId: 43, cardId: "DYN111", owner: 0 },
        ],
      }],
    });

    expect(html).toContain('aria-label="3 cards underneath"');
    expect(html).toContain('class="under-pip-count">×3</span>');
  });
});
