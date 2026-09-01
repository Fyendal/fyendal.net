import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlayerView } from "@fyendal/shared";
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
): string {
  return renderToStaticMarkup(
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
          stageableDefenders: new Set(),
          canPass: false,
          canCloseChain: false,
        },
        selection: { kind: "none" },
        preStackSelectedInstanceId: null,
        stagedIds: new Set(),
        committedDefenderIds: new Set(),
        optimisticallyHiddenIds: new Set(),
        defending: false,
        onStage: () => undefined,
        onActivate: () => undefined,
        onSelect: () => undefined,
      }}
      latestEmote={null}
      canSendEmote={false}
      mobileFloatViewport={false}
      onSendEmote={() => undefined}
      onOpenOverlay={() => undefined}
    />,
  );
}

describe("PlayerHalf", () => {
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

  it("gives a hidden opponent arsenal card a maskable motion anchor", () => {
    const html = renderPlayerHalf({
      ...player,
      seat: 1,
      arsenalCount: 1,
    }, false);

    expect(html).toContain('data-motion-card="1:arsenal:opaque"');
  });
});
