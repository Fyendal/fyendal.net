import type { CardView, EmoteMessage, PlayerView } from "@fyendal/shared";
import { useIntl } from "react-intl";
import type { EmoteEvent } from "../../store/types.js";
import { BloodDebtCounter } from "../BloodDebtCounter.js";
import { CardBack, CardFace, InactiveZoneCard } from "../Card.js";
import { EffectChips } from "../EffectChips.js";
import { EquipmentStack } from "../EquipmentStack.js";
import { HeroEmote } from "../HeroEmote.js";
import { PitchStack } from "../PitchStack.js";
import {
  motionLocationKey,
  opaqueMotionPresentationKey,
  motionPresentationKey,
  type MotionLocation,
} from "../motion/motionTypes.js";
import {
  arrangeBoundBoardCards,
  boardCardInEquipmentZone,
  boardCardsOutsideEquipmentZones,
  equipmentStackCards,
  groupBoardCards,
} from "../boardGroups.js";
import type { Sel } from "../useActionAnnouncement.js";
import type { BoardLegalState } from "./boardModel.js";
import { heroCard, MatZone, type BoardOverlay } from "./BoardPrimitives.js";

const EMPTY_INSTANCE_IDS: ReadonlySet<number> = new Set();

interface ArsenalSlotView {
  card?: CardView;
  hidden: boolean;
  opaqueOccurrence?: number;
}

function arsenalSlotViews(
  player: PlayerView,
  mine: boolean,
  optimisticallyHiddenIds: ReadonlySet<number>,
): ArsenalSlotView[] {
  const visibleCards = player.arsenal.filter(
    (card) => !card.hidden && !optimisticallyHiddenIds.has(card.instanceId),
  );
  const capacity = player.arsenalCapacity === 2 || player.arsenalCount > 1 ||
      visibleCards.some((card) => card.arsenalSlot === 1)
    ? 2
    : 1;
  const slots = Array.from({ length: capacity }, (): ArsenalSlotView => ({ hidden: false }));

  for (const card of visibleCards) {
    const requestedSlot = card.arsenalSlot;
    const fallbackSlot = slots.findIndex((slot) => slot.card === undefined && !slot.hidden);
    const slot = requestedSlot !== undefined && requestedSlot < slots.length &&
        slots[requestedSlot]?.card === undefined && slots[requestedSlot]?.hidden === false
      ? requestedSlot
      : fallbackSlot;
    if (slot >= 0) slots[slot] = { card, hidden: false };
  }

  let hiddenCards = mine ? 0 : Math.max(0, player.arsenalCount - visibleCards.length);
  let opaqueOccurrence = visibleCards.length;
  for (let slot = 0; slot < slots.length && hiddenCards > 0; slot++) {
    if (slots[slot]?.card !== undefined) continue;
    slots[slot] = { hidden: true, opaqueOccurrence };
    hiddenCards--;
    opaqueOccurrence++;
  }

  return slots;
}

interface PlayerHalfInteraction {
  legal: BoardLegalState;
  selection: Sel;
  preStackSelectedInstanceId: number | null;
  stagedIds: ReadonlySet<number>;
  committedDefenderIds: ReadonlySet<number>;
  optimisticallyHiddenIds: ReadonlySet<number>;
  defending: boolean;
  onStage: (instanceIds: number[]) => void;
  onActivate: (instanceId: number) => void;
  onSelect: (selection: Sel) => void;
}

export function PlayerHalf({
  player,
  mine,
  mirrored,
  ongoing,
  gameOver,
  replaying,
  visibleDeckTop,
  deckShuffling,
  interaction,
  latestEmote,
  canSendEmote,
  mobileFloatViewport,
  onSendEmote,
  onOpenOverlay,
}: {
  player: PlayerView;
  mine: boolean;
  mirrored: boolean;
  ongoing: Parameters<typeof EffectChips>[0]["effects"];
  gameOver: boolean;
  replaying: boolean;
  visibleDeckTop?: CardView;
  deckShuffling: boolean;
  interaction: PlayerHalfInteraction;
  latestEmote: EmoteEvent | null;
  canSendEmote: boolean;
  mobileFloatViewport: boolean;
  onSendEmote: (message: EmoteMessage) => void;
  onOpenOverlay: (overlay: BoardOverlay) => void;
}) {
  const intl = useIntl();
  const row = (value: number) => (mirrored ? 4 - value : value);
  const zoneLabel = (zone: string) => intl.formatMessage({ id: `game.zone.${zone}` });
  const ownedZoneTitle = (zone: string) => intl.formatMessage(
    { id: mine ? "game.zone.mine" : "game.zone.opponent" },
    { zone: zoneLabel(zone) },
  );
  const optimisticallyHiddenIds = mine ? interaction.optimisticallyHiddenIds : EMPTY_INSTANCE_IDS;
  const arsenalSlots = arsenalSlotViews(player, mine, optimisticallyHiddenIds);
  const hasAdditionalArsenal = arsenalSlots.length === 2;
  const visibleReplayDeck = replaying || gameOver ? player.deck : undefined;
  const presentedDeckTop = visibleDeckTop && !optimisticallyHiddenIds.has(visibleDeckTop.instanceId)
    ? visibleDeckTop
    : undefined;
  const deckTopPlayable =
    presentedDeckTop !== undefined && interaction.legal.playableZones.get(presentedDeckTop.instanceId) === "deck";
  const arenaBoard = boardCardsOutsideEquipmentZones(
    player.board.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
  );
  const arrangedBoard = arrangeBoundBoardCards(arenaBoard);

  const activate = (instanceId: number) => () => interaction.onActivate(instanceId);
  const equipmentZone = (slot: "head" | "chest" | "arms" | "legs", area: string) => {
    const equippedCard = player.equipment[slot];
    const candidate = equippedCard ?? boardCardInEquipmentZone(player.board, slot);
    const card = candidate && !optimisticallyHiddenIds.has(candidate.instanceId) ? candidate : undefined;
    const zoneLocation = { kind: "equipment" as const, seat: player.seat, slot };
    const cardLocation: MotionLocation = equippedCard
      ? zoneLocation
      : { kind: "board", seat: player.seat };
    if (!card) {
      return (
        <MatZone
          key={slot}
          area={area}
          label={zoneLabel(slot)}
          className={`zone-${slot}`}
          motionZone={motionLocationKey(zoneLocation)}
        />
      );
    }
    if (!mine) {
      return (
        <MatZone
          key={slot}
          area={area}
          label={zoneLabel(slot)}
          className={`zone-${slot}`}
          motionZone={motionLocationKey(zoneLocation)}
        >
          <EquipmentStack
            card={card}
            motionLocation={cardLocation}
            dimmed={interaction.stagedIds.has(card.instanceId) ||
              interaction.committedDefenderIds.has(card.instanceId)}
          />
        </MatZone>
      );
    }
    const blocking = interaction.stagedIds.has(card.instanceId) ||
      interaction.committedDefenderIds.has(card.instanceId);
    const canBlock = interaction.defending && !blocking &&
      interaction.legal.stageableDefenders.has(card.instanceId);
    const canActivate = !interaction.defending && interaction.legal.activatable.has(card.instanceId);
    return (
      <MatZone
        key={slot}
        area={area}
        label={zoneLabel(slot)}
        className={`zone-${slot}`}
        motionZone={motionLocationKey(zoneLocation)}
      >
        <EquipmentStack
          card={card}
          motionLocation={cardLocation}
          highlighted={canActivate || canBlock}
          selected={interaction.selection.kind === "activate" &&
            interaction.selection.sourceInstanceId === card.instanceId}
          dimmed={blocking || (interaction.defending && !canBlock)}
          onClick={canBlock
            ? () => interaction.onStage([...interaction.stagedIds, card.instanceId])
            : canActivate
              ? activate(card.instanceId)
              : undefined}
        />
      </MatZone>
    );
  };

  const weaponZone = (index: number, area: string) => {
    const candidate = player.weapons[index];
    const card = candidate && !optimisticallyHiddenIds.has(candidate.instanceId) ? candidate : undefined;
    const blocking = card !== undefined && (
      interaction.stagedIds.has(card.instanceId) || interaction.committedDefenderIds.has(card.instanceId)
    );
    const canBlock = mine && card !== undefined && interaction.defending && !blocking &&
      interaction.legal.stageableDefenders.has(card.instanceId);
    const canActivate = mine && card !== undefined && !interaction.defending &&
      interaction.legal.activatable.has(card.instanceId);
    const location = { kind: "weapon" as const, seat: player.seat, index };
    return (
      <MatZone
        key={area}
        area={area}
        label={zoneLabel("weapon")}
        className={`zone-weapon-${index}`}
        motionZone={motionLocationKey(location)}
      >
        {card ? (
          <EquipmentStack
            card={card}
            motionLocation={location}
            showActivationDots
            highlighted={canActivate || canBlock}
            selected={mine && interaction.selection.kind === "activate" &&
              interaction.selection.sourceInstanceId === card.instanceId}
            dimmed={blocking || (mine && interaction.defending && !canBlock)}
            onClick={canBlock
              ? () => interaction.onStage([...interaction.stagedIds, card.instanceId])
              : canActivate
                ? activate(card.instanceId)
                : undefined}
          />
        ) : undefined}
      </MatZone>
    );
  };

  const hero = heroCard(player);
  const heroBlocking = interaction.stagedIds.has(hero.instanceId) ||
    interaction.committedDefenderIds.has(hero.instanceId);
  const heroCanBlock = mine && interaction.defending && !heroBlocking &&
    interaction.legal.stageableDefenders.has(hero.instanceId);
  const heroCanActivate = mine && !interaction.defending && interaction.legal.activatable.has(hero.instanceId);
  const pileZone = (
    area: string,
    kind: "graveyard" | "banished",
    cards: CardView[],
    title: string,
  ) => {
    const location = {
      kind: kind === "graveyard" ? "graveyard" as const : "banish" as const,
      seat: player.seat,
    };
    return (
      <MatZone
      area={area}
      label={zoneLabel(kind)}
      className={`zone-${kind}`}
      motionZone={motionLocationKey(location)}
      onClick={cards.length
        ? () => onOpenOverlay({
            title,
            cards,
            inactiveZone: true,
            showOwnedFaceDownIdentities: mine,
          })
        : undefined}
    >
      {cards.length > 0 ? (
        <div
          className={`pitch-top zone-card-pile${cards.length > 1 ? " zone-card-pile-multiple" : ""}`}
          data-stack-depth={cards.length > 1 ? Math.min(cards.length, 3) : undefined}
        >
          <InactiveZoneCard
            card={cards[cards.length - 1]!}
            showOverlays={false}
            motionKey={motionPresentationKey(location, cards[cards.length - 1]!.instanceId)}
          />
          <span className="pip pile-pip">{cards.length}</span>
        </div>
      ) : null}
      {kind === "banished" ? <BloodDebtCounter cards={cards} /> : null}
    </MatZone>
    );
  };

  return (
    <div className={`mat-half ${mirrored ? "mat-opp" : ""}`}>
      {equipmentZone("head", `${row(1)} / 1`)}
      <MatZone
        area={`${row(1)} / 2 / span 1 / span 7`}
        label={zoneLabel("board")}
        className="zone-board"
        motionZone={motionLocationKey({ kind: "board", seat: player.seat })}
      >
        {arenaBoard.length > 0 ? (
          <div className="board-strip board-cards">
            {groupBoardCards(
              arrangedBoard.cards,
              mine ? interaction.legal.activatable : undefined,
              arrangedBoard.boundAllyIds,
            ).map((group) => {
              const boundCards = arrangedBoard.boundCardsByAlly.get(group.card.instanceId) ?? [];
              const underCardCount = equipmentStackCards(group.card).length - 1;
              const blocking = group.instanceIds.some((instanceId) =>
                interaction.stagedIds.has(instanceId) ||
                interaction.committedDefenderIds.has(instanceId)
              );
              const stageableDefenderId = mine && interaction.defending && !blocking
                ? group.instanceIds.find((instanceId) =>
                    interaction.legal.stageableDefenders.has(instanceId)
                  )
                : undefined;
              const canBlock = stageableDefenderId !== undefined;
              const canActivate = mine && !interaction.defending && group.activatable;
              return (
                <div
                  key={group.card.instanceId}
                  className={`board-card-stack${group.count > 1 ? " board-card-stack-multiple" : ""}${group.card.tapped ? " board-card-stack-tapped" : ""}`}
                  data-stack-depth={group.count > 1 ? Math.min(group.count, 3) : undefined}
                  data-cardid={group.card.cardId}
                  data-motion-card={motionPresentationKey(
                    { kind: "board", seat: player.seat },
                    group.card.instanceId,
                  )}
                  data-motion-card-aliases={group.instanceIds.slice(1).map((instanceId) => (
                    motionPresentationKey({ kind: "board", seat: player.seat }, instanceId)
                  )).join(" ") || undefined}
                >
                  <EquipmentStack
                    card={group.card}
                    underCards={boundCards}
                    underCardMotionLocation={{ kind: "board", seat: player.seat }}
                    boundCount={boundCards.length || undefined}
                    boundCountLabel={boundCards.length > 0
                      ? intl.formatMessage(
                          { id: "game.bound.count" },
                          { count: boundCards.length },
                        )
                      : undefined}
                    underCardCountLabel={underCardCount > 0
                      ? intl.formatMessage(
                          { id: "game.under.count" },
                          { count: underCardCount },
                        )
                      : undefined}
                    highlighted={canActivate || canBlock}
                    selected={mine && interaction.selection.kind === "activate" &&
                      interaction.selection.sourceInstanceId === group.card.instanceId}
                    dimmed={blocking || (mine && interaction.defending && !canBlock)}
                    onClick={canBlock
                      ? () => interaction.onStage([...interaction.stagedIds, stageableDefenderId])
                      : canActivate
                        ? activate(group.card.instanceId)
                        : undefined}
                  />
                  {group.count > 1 ? (
                    <span
                      className="board-card-count"
                      aria-label={intl.formatMessage(
                        { id: "game.zone.stackedCards" },
                        { count: group.count },
                      )}
                    >
                      ×{group.count}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : undefined}
      </MatZone>
      {pileZone(
        `${row(1)} / 9`,
        "graveyard",
        player.graveyard.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
        ownedZoneTitle("graveyard"),
      )}
      {equipmentZone("chest", "2 / 1")}
      {equipmentZone("arms", "2 / 2")}
      {weaponZone(0, "2 / 4")}
      <MatZone area="2 / 5" label={zoneLabel("hero")} className="zone-hero">
        <div
          className="mat-hero"
          data-motion-zone={motionLocationKey({ kind: "soul", seat: player.seat })}
        >
          <HeroEmote
            seat={player.seat}
            event={replaying ? null : latestEmote}
            canSend={mine && canSendEmote && !mobileFloatViewport}
            onSend={onSendEmote}
          >
            <EquipmentStack
              card={hero}
              underCards={player.soul}
              underCardMotionLocation={{ kind: "soul", seat: player.seat }}
              highlighted={heroCanActivate || heroCanBlock}
              selected={mine && interaction.selection.kind === "activate" &&
                interaction.selection.sourceInstanceId === hero.instanceId}
              dimmed={heroBlocking || (mine && interaction.defending && !heroCanBlock)}
              soulCount={player.soul.length}
              soulCountLabel={intl.formatMessage(
                { id: "game.soul.count" },
                { count: player.soul.length },
              )}
              onClick={heroCanBlock
                ? () => interaction.onStage([...interaction.stagedIds, hero.instanceId])
                : heroCanActivate
                  ? activate(hero.instanceId)
                  : undefined}
            />
          </HeroEmote>
        </div>
      </MatZone>
      {weaponZone(1, "2 / 6")}
      <MatZone
        area="2 / 8"
        label={zoneLabel("pitch")}
        className="zone-pitch"
        motionZone={motionLocationKey({ kind: "pitch", seat: player.seat })}
        onClick={player.pitchCount
          ? () => onOpenOverlay({ title: ownedZoneTitle("pitch"), cards: player.pitch })
          : undefined}
      >
        <PitchStack
          cards={player.pitch}
          resources={player.resources}
          motionSeat={player.seat}
        />
      </MatZone>
      <MatZone
        area="2 / 9"
        label={zoneLabel("deck")}
        className={`zone-deck${deckShuffling ? " deck-shuffling" : ""}`}
        motionZone={motionLocationKey({ kind: "deck", seat: player.seat })}
        count={presentedDeckTop ? player.deckCount : undefined}
        onClick={visibleReplayDeck?.length
          ? () => onOpenOverlay({
              title: intl.formatMessage(
                { id: mine ? "game.zone.deckMineOrder" : "game.zone.deckOpponentOrder" },
              ),
              cards: visibleReplayDeck,
            })
          : undefined}
      >
        <div
          className={`zone-card-pile${player.deckCount > 1 ? " zone-card-pile-multiple" : ""}`}
          data-stack-depth={player.deckCount > 1 ? Math.min(player.deckCount, 3) : undefined}
        >
          {presentedDeckTop ? (
            <CardFace
              card={presentedDeckTop}
              size="zone"
              motionZoneAnchor={motionLocationKey({ kind: "deck", seat: player.seat })}
              motionKey={motionPresentationKey(
                { kind: "deck", seat: player.seat },
                presentedDeckTop.instanceId,
              )}
              highlighted={deckTopPlayable}
              selected={
                (interaction.selection.kind === "play-zone" &&
                  interaction.selection.instanceId === presentedDeckTop.instanceId) ||
                interaction.preStackSelectedInstanceId === presentedDeckTop.instanceId
              }
              onClick={deckTopPlayable
                ? () => {
                    if (interaction.selection.kind !== "none") return;
                    interaction.onSelect({
                      kind: "play-zone",
                      instanceId: presentedDeckTop.instanceId,
                      zone: "deck",
                    });
                  }
                : undefined}
            />
          ) : (
            <CardBack
              label={zoneLabel("deck")}
              count={player.deckCount}
              motionZoneAnchor={motionLocationKey({ kind: "deck", seat: player.seat })}
            />
          )}
        </div>
        {deckShuffling ? (
          <>
            <div className="deck-shuffle-copy deck-shuffle-copy-left" aria-hidden="true">
              <CardBack label="" />
            </div>
            <div className="deck-shuffle-copy deck-shuffle-copy-right" aria-hidden="true">
              <CardBack label="" />
            </div>
          </>
        ) : null}
      </MatZone>
      {equipmentZone("legs", `${row(3)} / 1`)}
      <EffectChips effects={ongoing} area={`${row(3)} / 2 / span 1 / span 3`} />
      <MatZone
        area={`${row(3)} / 5 / span 1 / span ${arsenalSlots.length}`}
        label={zoneLabel("arsenal")}
        className={`zone-arsenal${hasAdditionalArsenal ? " zone-arsenal-multiple" : ""}`}
        motionZone={motionLocationKey({ kind: "arsenal", seat: player.seat })}
      >
        <div className="arsenal-slots" role="group" aria-label={zoneLabel("arsenal")}>
          {arsenalSlots.map((slot, slotIndex) => {
            const card = slot.card;
            const slotLabel = hasAdditionalArsenal
              ? intl.formatMessage({ id: "game.zone.arsenalSlot" }, { slot: slotIndex + 1 })
              : zoneLabel("arsenal");
            const blocking = card !== undefined && interaction.stagedIds.has(card.instanceId);
            const canBlock = mine && card !== undefined && interaction.defending && !blocking &&
              interaction.legal.stageableDefenders.has(card.instanceId);
            const playable = card !== undefined && interaction.legal.playableArsenal.has(card.instanceId);

            return (
              <div
                key={slotIndex}
                className={`arsenal-slot${card === undefined && !slot.hidden ? " arsenal-slot-empty" : ""}`}
                data-arsenal-slot={slotIndex}
                role="group"
                aria-label={slotLabel}
              >
                {card ? (
                  <CardFace
                    card={card}
                    size="zone"
                    motionKey={motionPresentationKey(
                      { kind: "arsenal", seat: player.seat },
                      card.instanceId,
                    )}
                    dimmed={mine && (blocking || (card.faceDown && !playable && !canBlock))}
                    highlighted={playable || canBlock}
                    selected={
                      (interaction.selection.kind === "play-arsenal" &&
                        interaction.selection.instanceId === card.instanceId) ||
                      interaction.preStackSelectedInstanceId === card.instanceId
                    }
                    onClick={canBlock
                      ? () => interaction.onStage([...interaction.stagedIds, card.instanceId])
                      : playable
                        ? () => interaction.onSelect({ kind: "play-arsenal", instanceId: card.instanceId })
                        : undefined}
                    showFaceUp={!card.faceDown}
                  />
                ) : slot.hidden ? (
                  <CardBack
                    label={zoneLabel("arsenal")}
                    motionKey={opaqueMotionPresentationKey(
                      { kind: "arsenal", seat: player.seat },
                      slot.opaqueOccurrence,
                    )}
                  />
                ) : (
                  <span className="mat-zone-label">{zoneLabel("arsenal")}</span>
                )}
              </div>
            );
          })}
        </div>
      </MatZone>
      {pileZone(
        `${row(3)} / 9`,
        "banished",
        player.banish.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
        ownedZoneTitle("banished"),
      )}
    </div>
  );
}
