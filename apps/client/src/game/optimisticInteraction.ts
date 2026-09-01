import type { CardView, GameView, PlayerView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import type { PendingInteraction } from "../store/types.js";
import { heroCard } from "./board/BoardPrimitives.js";
import { optDecisionCards } from "./decisionPresentation.js";

export interface OptimisticInteractionProjection {
  view: GameView | null;
  key: string;
  /** True when the projection already presents a card movement or stack
   * arrival contained in the upcoming authoritative semantic transition. */
  predictsSemanticTransition: boolean;
}

function withoutFaceDown(card: CardView): CardView {
  const { faceDown: _faceDown, ...visible } = card;
  return visible;
}

function cardInPlayer(player: PlayerView, instanceId: number): CardView | undefined {
  if (player.heroInstanceId === instanceId) return heroCard(player);
  return [
    ...player.hand,
    ...player.arsenal,
    ...player.pitch,
    ...player.graveyard,
    ...player.banish,
    ...player.soul,
    ...player.weapons,
    ...Object.values(player.equipment).flatMap((card) => card ? [card] : []),
    ...player.board,
    ...(player.visibleDeckTop ? [player.visibleDeckTop] : []),
  ].find((card) => card.instanceId === instanceId);
}

function cardAnywhere(view: GameView, instanceId: number): CardView | undefined {
  for (const player of view.players) {
    const card = cardInPlayer(player, instanceId);
    if (card) return card;
  }
  return view.chain.flatMap((link) => [
    link.attackingCard,
    ...link.defendingCards,
    ...link.reactions,
    ...(link.targetAlly ? [link.targetAlly] : []),
  ]).find((card) => card.instanceId === instanceId);
}

function removeFromPlayer(player: PlayerView, instanceId: number): PlayerView {
  const hand = player.hand.filter((card) => card.instanceId !== instanceId);
  const arsenal = player.arsenal.filter((card) => card.instanceId !== instanceId);
  const pitch = player.pitch.filter((card) => card.instanceId !== instanceId);
  const graveyard = player.graveyard.filter((card) => card.instanceId !== instanceId);
  const banish = player.banish.filter((card) => card.instanceId !== instanceId);
  const soul = player.soul.filter((card) => card.instanceId !== instanceId);
  const board = player.board.filter((card) => card.instanceId !== instanceId);
  const weapons = player.weapons.filter((card) => card.instanceId !== instanceId);
  const equipment = Object.fromEntries(
    Object.entries(player.equipment).filter(([, card]) => card?.instanceId !== instanceId),
  ) as PlayerView["equipment"];
  const removedDeckTop = player.visibleDeckTop?.instanceId === instanceId;
  return {
    ...player,
    hand,
    handCount: Math.max(0, player.handCount - (hand.length < player.hand.length ? 1 : 0)),
    arsenal,
    arsenalCount: Math.max(0, player.arsenalCount - (arsenal.length < player.arsenal.length ? 1 : 0)),
    pitch,
    pitchCount: Math.max(0, player.pitchCount - (pitch.length < player.pitch.length ? 1 : 0)),
    graveyard,
    banish,
    soul,
    board,
    weapons,
    equipment,
    ...(removedDeckTop
      ? { visibleDeckTop: undefined, deckCount: Math.max(0, player.deckCount - 1) }
      : {}),
  };
}

function removeCard(players: GameView["players"], instanceId: number): GameView["players"] {
  return players.map((player) => removeFromPlayer(player, instanceId)) as GameView["players"];
}

function movePitches(
  players: GameView["players"],
  seat: number,
  pitchInstanceIds: readonly number[],
): GameView["players"] {
  if (pitchInstanceIds.length === 0) return [...players] as GameView["players"];
  const actor = players[seat];
  if (!actor) return [...players] as GameView["players"];
  const pitchCards = pitchInstanceIds.flatMap((instanceId) => {
    const card = actor.hand.find((candidate) => candidate.instanceId === instanceId);
    return card ? [card] : [];
  });
  const moved = new Set(pitchCards.map((card) => card.instanceId));
  return players.map((player) => player.seat === seat
    ? {
        ...player,
        hand: player.hand.filter((card) => !moved.has(card.instanceId)),
        handCount: Math.max(0, player.handCount - pitchCards.length),
        pitch: [...player.pitch, ...pitchCards],
        pitchCount: player.pitchCount + pitchCards.length,
      }
    : player
  ) as GameView["players"];
}

function projectCardPlay(
  view: GameView,
  seat: number,
  intent: Extract<PendingInteraction["intent"], { kind: "play-card" | "play-from-arsenal" | "play-from-zone" }>,
): GameView | null {
  const source = cardAnywhere(view, intent.instanceId);
  if (!source) return null;
  let players = removeCard(view.players, source.instanceId);
  players = movePitches(players, seat, intent.pitchInstanceIds);
  const playedCard = withoutFaceDown(source);
  const data = cardData[playedCard.cardId];
  const isAttack = data?.cardType === "action" && (data.subtypes ?? []).includes("attack");
  if (isAttack) {
    const attack = playedCard.attack ?? data.attack ?? 0;
    return {
      ...view,
      players,
      chain: [...view.chain, {
        attackingCard: { ...playedCard, attack },
        defendingCards: [],
        attackValue: attack,
        defenseValue: 0,
        damage: attack,
        resolved: false,
        onStack: true,
        reactions: [],
      }],
    };
  }
  return {
    ...view,
    players,
    stack: [{
      card: playedCard,
      seat,
      label: data?.name ?? playedCard.name ?? "Played card",
      optional: false,
    }, ...view.stack],
  };
}

function projectActivation(
  view: GameView,
  seat: number,
  intent: Extract<PendingInteraction["intent"], { kind: "activate-ability" }>,
): GameView | null {
  const source = cardAnywhere(view, intent.sourceInstanceId);
  if (!source) return null;
  const sourceLeavesHand = view.players[seat]?.hand.some(
    (card) => card.instanceId === source.instanceId,
  ) === true;
  const players = movePitches(
    sourceLeavesHand ? removeCard(view.players, source.instanceId) : view.players,
    seat,
    intent.pitchInstanceIds,
  );
  const player = view.players.find((candidate) => candidate.seat === source.owner);
  const abilityIndex = intent.abilityIndex ?? 0;
  const labels = source.instanceId === player?.heroInstanceId
    ? player.heroAbilityLabels
    : source.activatedAbilityLabels;
  return {
    ...view,
    players,
    stack: [{
      card: source,
      seat,
      label: labels?.[abilityIndex] ?? cardData[source.cardId]?.name ?? source.name ?? "Activated ability",
      optional: false,
    }, ...view.stack],
  };
}

function projectDecision(
  view: GameView,
  seat: number,
  intent: Extract<PendingInteraction["intent"], { kind: "choose" | "order-triggers" | "pass" }>,
): { view: GameView; predictsSemanticTransition: boolean } | null {
  const decision = view.pendingDecision;
  if (!decision || decision.player !== seat) return null;
  // A defend decision owns the staged-card presentation. Removing the whole
  // decision while its resource-payment choice is in flight would falsely
  // animate every staged defender back to its source.
  if (decision.kind === "defend") return null;

  if (intent.kind === "choose") {
    const optChoice = /^(?:top|bottom):(\d+)$/.exec(intent.optionId);
    const optCards = optDecisionCards(decision);
    const selectedOptCard = optChoice && optCards
      ? optCards.find(({ id }) => id === optChoice[1])
      : undefined;
    if (selectedOptCard) {
      const keepOption = (option: string) => !option.endsWith(`:${selectedOptCard.id}`);
      const keptIndices = (decision.options ?? []).flatMap((option, index) =>
        keepOption(option) ? [index] : []
      );
      const options = keptIndices.map((index) => decision.options![index]!);
      const remainingOptCards = options.some((option) => /^(?:top|bottom):\d+$/.test(option));
      return {
        view: {
          ...view,
          pendingDecision: remainingOptCards
            ? {
                ...decision,
                options,
                ...(decision.optionLabels
                  ? { optionLabels: keptIndices.map((index) => decision.optionLabels![index]!) }
                  : {}),
                ...(decision.optionCounts
                  ? { optionCounts: keptIndices.map((index) => decision.optionCounts![index]!) }
                  : {}),
                ...(decision.optionCards
                  ? { optionCards: keptIndices.map((index) => decision.optionCards![index]!) }
                  : {}),
                ...(decision.lookedCards
                  ? {
                      lookedCards: decision.lookedCards.filter(
                        (card) => card.instanceId !== selectedOptCard.card.instanceId,
                      ),
                    }
                  : {}),
              }
            : null,
        },
        predictsSemanticTransition: false,
      };
    }
  }

  // Ordering is submitted only after the entire local ordering is complete.
  // Other scripted choices can be incremental (Opt and mode-allocation
  // decisions, for example), so keep their authoritative decision mounted
  // unless the client can prove that this interaction completes it.
  if (intent.kind === "order-triggers") {
    return { view: { ...view, pendingDecision: null }, predictsSemanticTransition: false };
  }
  if (decision.kind !== "arsenal" || intent.kind !== "choose") return null;
  if (intent.optionId === "pass") {
    return { view: { ...view, pendingDecision: null }, predictsSemanticTransition: false };
  }
  const instanceId = Number(intent.optionId);
  if (!Number.isSafeInteger(instanceId)) return null;
  const player = view.players[seat];
  const card = player?.hand.find((candidate) => candidate.instanceId === instanceId);
  if (!player || !card) return null;
  const players = view.players.map((candidate) => candidate.seat === seat
    ? {
        ...candidate,
        hand: candidate.hand.filter((entry) => entry.instanceId !== instanceId),
        handCount: Math.max(0, candidate.handCount - 1),
        arsenal: [...candidate.arsenal, { ...card, faceDown: true as const }],
        arsenalCount: candidate.arsenalCount + 1,
      }
    : candidate
  ) as GameView["players"];
  return {
    view: { ...view, players, pendingDecision: null },
    predictsSemanticTransition: true,
  };
}

export function optimisticInteractionView(
  view: GameView | null,
  yourSeat: number | null,
  pending: PendingInteraction | null,
): OptimisticInteractionProjection {
  const authoritative = {
    view,
    key: "interaction:authoritative",
    predictsSemanticTransition: false,
  };
  if (!view || yourSeat === null || !pending) return authoritative;
  const { intent } = pending;
  const projected = intent.kind === "play-card"
    || intent.kind === "play-from-arsenal"
    || intent.kind === "play-from-zone"
      ? projectCardPlay(view, yourSeat, intent)
      : intent.kind === "activate-ability"
        ? projectActivation(view, yourSeat, intent)
        : projectDecision(view, yourSeat, intent);
  if (!projected) return authoritative;
  if ("view" in projected) {
    return {
      view: projected.view,
      key: `interaction:${pending.commandId}`,
      predictsSemanticTransition: projected.predictsSemanticTransition,
    };
  }
  return {
    view: projected,
    key: `interaction:${pending.commandId}`,
    predictsSemanticTransition: true,
  };
}
