import type { CardView, GameView } from "@fyendal/shared";
import {
  motionLocationKey,
  motionPresentationKey,
  type CardPresentation,
  type MotionLocation,
  type MotionZoneCount,
} from "./motionTypes.js";

export interface GamePresentations {
  cards: CardPresentation[];
  counts: MotionZoneCount[];
}

export function extractGamePresentations(view: GameView): GamePresentations {
  const cards: CardPresentation[] = [];
  const counts: MotionZoneCount[] = [];
  const repeatedKeys = new Map<string, number>();
  const stagedCards = view.pendingDecision?.kind === "defend"
    ? (view.pendingDecision.stagedCards ?? [])
    : [];
  const stagedIds = new Set(stagedCards.map((card) => card.instanceId));

  const add = (
    card: CardView | null | undefined,
    location: MotionLocation,
    role: CardPresentation["role"],
    allowOpaqueInstanceId = false,
  ) => {
    if (
      !card
      || !Number.isSafeInteger(card.instanceId)
      || (card.instanceId < 0 && !allowOpaqueInstanceId)
    ) return;
    const baseKey = motionPresentationKey(location, card.instanceId);
    const occurrence = repeatedKeys.get(baseKey) ?? 0;
    repeatedKeys.set(baseKey, occurrence + 1);
    cards.push({
      key: motionPresentationKey(location, card.instanceId, occurrence),
      role,
      instanceId: card.instanceId,
      card,
      location,
    });
  };

  for (const player of view.players) {
    const seat = player.seat;
    player.hand.forEach((card) => {
      // Staged hand defenders are rendered on the chain immediately. Treat
      // that as their displayed location so confirmation does not replay the
      // original hand-to-chain travel.
      if (!stagedIds.has(card.instanceId)) {
        add(card, { kind: "hand", seat }, "canonical");
      }
    });
    player.arsenal.forEach((card) => add(card, { kind: "arsenal", seat }, "canonical"));
    player.pitch.forEach((card) => add(card, { kind: "pitch", seat }, "canonical"));
    player.graveyard.forEach((card) => add(card, { kind: "graveyard", seat }, "canonical"));
    player.banish.forEach((card) => add(card, { kind: "banish", seat }, "canonical"));
    player.soul.forEach((card) => add(card, { kind: "soul", seat }, "canonical"));
    player.board.forEach((card) => add(card, { kind: "board", seat }, "canonical"));
    player.weapons.forEach((card, index) => (
      add(card, { kind: "weapon", seat, index }, "canonical")
    ));
    for (const [slot, card] of Object.entries(player.equipment)) {
      add(card, {
        kind: "equipment",
        seat,
        slot: slot as keyof typeof player.equipment,
      }, "canonical");
    }
    add(player.visibleDeckTop, { kind: "deck", seat }, "canonical");
    counts.push(
      { location: { kind: "hand", seat }, count: player.handCount },
      { location: { kind: "deck", seat }, count: player.deckCount },
      { location: { kind: "arsenal", seat }, count: player.arsenalCount },
      { location: { kind: "pitch", seat }, count: player.pitchCount },
    );
  }

  view.stack.forEach((layer, index) => {
    // A resolving layer shifts every remaining array index. Keep its motion
    // identity stable so ordinary stack compaction is not presented as a move.
    add(layer.card, { kind: "stack-layer", index }, "display");
  });
  view.chain.forEach((link, linkIndex) => {
    add(
      link.attackingCard,
      link.onStack ? { kind: "stack-attack" } : { kind: "chain-attack", link: linkIndex },
      "display",
    );
    link.defendingCards.forEach((card, index) => {
      add(card, { kind: "chain-defender", link: linkIndex, index }, "display");
    });
    link.reactions.forEach((card, index) => {
      add(card, { kind: "chain-reaction", link: linkIndex, index }, "display");
    });
    add(link.targetAlly, { kind: "chain-target", link: linkIndex }, "display");
  });

  let stagedLinkIndex = -1;
  for (let index = view.chain.length - 1; index >= 0; index -= 1) {
    if (view.chain[index]?.onStack !== true) {
      stagedLinkIndex = index;
      break;
    }
  }
  if (stagedLinkIndex >= 0) {
    stagedCards.forEach((card, index) => {
      // Opponents receive projection-local negative ids for staged hidden
      // hand cards. They are safe only as ephemeral presentation keys and
      // must never be correlated with real card instances.
      add(
        card,
        { kind: "chain-staged", link: stagedLinkIndex, index },
        "display",
        true,
      );
    });
  }

  return { cards, counts };
}
