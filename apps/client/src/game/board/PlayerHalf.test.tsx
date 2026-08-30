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

describe("PlayerHalf", () => {
  it("marks tapped board-card wrappers with a landscape layout footprint", () => {
    const html = renderToStaticMarkup(
      <PlayerHalf
        player={player}
        mine
        mirrored={false}
        ongoing={[]}
        gameOver={false}
        replaying={false}
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

    expect(html).toContain('class="board-card-stack" data-cardid="TST-UPRIGHT"');
    expect(html).toContain(
      'class="board-card-stack board-card-stack-tapped" data-cardid="TST-TAPPED"',
    );
    expect(html).toMatch(
      /board-card-stack board-card-stack-tapped[^>]*>.*equipment-stack.*card-tapped/,
    );
    expect(html).toContain('data-motion-zone="0:board"');
    expect(html).toContain('data-motion-zone="0:deck"');
    expect(html).toContain('data-motion-zone="0:pitch"');
    expect(html).toContain('data-motion-zone="0:arsenal"');
    expect(html).toContain('data-motion-zone="0:graveyard"');
    expect(html).toContain('data-motion-zone="0:banish"');
    expect(html).toContain('data-motion-card="0:board:2"');
    expect(html).toContain('data-motion-card="0:board:3"');
  });
});
