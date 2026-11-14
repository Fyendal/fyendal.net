import type { CardView, GameView, PlayableZone, PlayerView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { canAddPaymentCard, canAddResourcePaymentPitch, isDiscardPayment } from "../legalSelection.js";
import type { PlayerHandInteraction } from "./PlayerHand.js";

export interface HandCardState {
  stageable: boolean;
  selected: boolean;
  pitched: boolean;
  actionable: boolean;
  dimmed: boolean;
}

const INERT: HandCardState = {
  stageable: false,
  selected: false,
  pitched: false,
  actionable: false,
  dimmed: false,
};

/** Click affordances of one hand card; a hand without interaction (not the acting seat) is inert. */
export function handCardState(
  card: CardView,
  player: Pick<PlayerView, "hand" | "resources" | "chi">,
  interaction: PlayerHandInteraction | null,
): HandCardState {
  if (!interaction) return INERT;
  const pitchValue = (instanceId: number) => {
    const held = player.hand.find((candidate) => candidate.instanceId === instanceId);
    return held ? (cardData[held.cardId]?.pitch ?? 0) : 0;
  };
  const discardPayment = isDiscardPayment(interaction.selectedPaymentVariants);
  const stageable = interaction.defending &&
    interaction.legalState.stageableDefenders.has(card.instanceId);
  const chosen =
    ((interaction.selection.kind === "play-hand" ||
      interaction.selection.kind === "choose-hand-action") &&
      interaction.selection.instanceId === card.instanceId) ||
    (interaction.selection.kind === "activate" &&
      interaction.selection.sourceInstanceId === card.instanceId) ||
    interaction.preStackSelectedInstanceId === card.instanceId ||
    (
      interaction.boundedHandPick?.has(card.instanceId) === true &&
      interaction.selectedBoundedChoiceOptionIds?.has(
        interaction.boundedHandPick.get(card.instanceId)!,
      ) === true
    );
  const resourcePitchable = interaction.resourcePayment !== undefined && (
    interaction.pitchSelection.includes(card.instanceId) ||
    canAddResourcePaymentPitch(
      interaction.resourcePayment,
      player.resources + (player.chi ?? 0),
      interaction.pitchSelection,
      card.instanceId,
      pitchValue,
    )
  );
  const pitchable = interaction.selection.kind !== "none" && !chosen && (
    interaction.pitchSelection.includes(card.instanceId) ||
    canAddPaymentCard(
      interaction.selectedPaymentVariants,
      interaction.pitchSelection,
      card.instanceId,
      pitchValue,
    )
  );
  const actionable = interaction.choosingPitch
    ? !chosen && (interaction.resourcePayment ? resourcePitchable : pitchable)
    : interaction.defending
      ? stageable
      : interaction.selection.kind !== "none"
        ? pitchable || chosen
        : resourcePitchable ||
          interaction.choosingArsenal ||
          interaction.handPick?.has(card.instanceId) === true ||
          interaction.boundedHandPick?.has(card.instanceId) === true ||
          interaction.legalState.playableHand.has(card.instanceId) ||
          interaction.legalState.activatable.has(card.instanceId);
  const inPitch = interaction.pitchSelection.includes(card.instanceId);
  return {
    stageable,
    selected: chosen || (discardPayment && inPitch),
    pitched: !discardPayment && inPitch,
    actionable,
    dimmed: interaction.defending && !stageable,
  };
}

export interface HandZoneCards {
  playable: { card: CardView; zone: Exclude<PlayableZone, "deck"> }[];
  activatable: CardView[];
}

const NO_ZONE_CARDS: HandZoneCards = { playable: [], activatable: [] };

/** Inactive-zone cards the acting hand surfaces as ghosts: plays an effect
 * allows from a graveyard or banished zone, and activatable cards there. */
export function handZoneCards(
  view: GameView,
  player: PlayerView,
  interaction: PlayerHandInteraction | null,
): HandZoneCards {
  if (!interaction) return NO_ZONE_CARDS;
  const hidden = interaction.optimisticallyHiddenIds;
  const { playableZones, activatable } = interaction.legalState;
  const playable = [...playableZones]
    .filter((entry): entry is [number, Exclude<PlayableZone, "deck">] => entry[1] !== "deck")
    .flatMap(([instanceId, zone]) => {
      if (hidden.has(instanceId)) return [];
      // Effects such as Red Lure Harpoon and Nuu let this player play an
      // opponent-owned card. The legal intent is authoritative, so search
      // every public inactive zone instead of assuming the card is owned by
      // the player whose hand strip surfaces the action.
      const card = view.players.flatMap((zoneOwner) => [...zoneOwner.banish, ...zoneOwner.graveyard])
        .find((candidate) => candidate.instanceId === instanceId);
      return card ? [{ card, zone }] : [];
    });
  const activatableCards = [...player.graveyard, ...player.banish].filter((card) =>
    !hidden.has(card.instanceId) && activatable.has(card.instanceId) && !playableZones.has(card.instanceId)
  );
  return { playable, activatable: activatableCards };
}
