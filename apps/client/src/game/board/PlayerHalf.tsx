import type { CardView, EmoteMessage, PlayerView } from "@fyendal/shared";
import type { EmoteEvent } from "../../store/types.js";
import { BloodDebtCounter } from "../BloodDebtCounter.js";
import { CardBack, CardFace, InactiveZoneCard } from "../Card.js";
import { EffectChips } from "../EffectChips.js";
import { EquipmentStack } from "../EquipmentStack.js";
import { HeroEmote } from "../HeroEmote.js";
import { PitchStack } from "../PitchStack.js";
import {
  motionLocationKey,
  motionPresentationKey,
  type MotionLocation,
} from "../motion/motionTypes.js";
import {
  boardCardInEquipmentZone,
  boardCardsOutsideEquipmentZones,
  groupBoardCards,
} from "../boardGroups.js";
import type { Sel } from "../useActionAnnouncement.js";
import type { BoardLegalState } from "./boardModel.js";
import { heroCard, MatZone, type BoardOverlay } from "./BoardPrimitives.js";

const EMPTY_INSTANCE_IDS: ReadonlySet<number> = new Set();

interface PlayerHalfInteraction {
  legal: BoardLegalState;
  selection: Sel;
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
  const row = (value: number) => (mirrored ? 4 - value : value);
  const side = mine ? "Your" : "Opponent's";
  const optimisticallyHiddenIds = mine ? interaction.optimisticallyHiddenIds : EMPTY_INSTANCE_IDS;
  const arsenalCard = player.arsenal.find((card) => !optimisticallyHiddenIds.has(card.instanceId));
  const visibleReplayDeck = replaying || gameOver ? player.deck : undefined;
  const presentedDeckTop = visibleDeckTop && !optimisticallyHiddenIds.has(visibleDeckTop.instanceId)
    ? visibleDeckTop
    : undefined;
  const deckTopPlayable =
    presentedDeckTop !== undefined && interaction.legal.playableZones.get(presentedDeckTop.instanceId) === "deck";
  const arenaBoard = boardCardsOutsideEquipmentZones(
    player.board.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
  );

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
          label={slot}
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
          label={slot}
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
        label={slot}
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
        label="Weapon"
        className={`zone-weapon-${index}`}
        motionZone={motionLocationKey(location)}
      >
        {card ? (
          <EquipmentStack
            card={card}
            motionLocation={location}
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
    label: "Graveyard" | "Banished",
    cards: CardView[],
    title: string,
  ) => {
    const location = {
      kind: label === "Graveyard" ? "graveyard" as const : "banish" as const,
      seat: player.seat,
    };
    return (
      <MatZone
      area={area}
      label={label}
      className={`zone-${label.toLowerCase().replaceAll(" ", "-")}`}
      motionZone={motionLocationKey(location)}
      onClick={cards.length ? () => onOpenOverlay({ title, cards, inactiveZone: true }) : undefined}
    >
      {cards.length > 0 ? (
        <div className="pitch-top">
          <InactiveZoneCard
            card={cards[cards.length - 1]!}
            showOverlays={false}
            motionKey={motionPresentationKey(location, cards[cards.length - 1]!.instanceId)}
          />
          <span className="pip pile-pip">{cards.length}</span>
        </div>
      ) : null}
      {label === "Banished" ? <BloodDebtCounter cards={cards} /> : null}
    </MatZone>
    );
  };

  return (
    <div className={`mat-half ${mirrored ? "mat-opp" : ""}`}>
      {equipmentZone("head", `${row(1)} / 1`)}
      <MatZone
        area={`${row(1)} / 2 / span 1 / span 7`}
        label="Board"
        className="zone-board"
        motionZone={motionLocationKey({ kind: "board", seat: player.seat })}
      >
        {arenaBoard.length > 0 ? (
          <div className="board-strip board-cards">
            {groupBoardCards(arenaBoard, mine ? interaction.legal.activatable : undefined).map((group) => (
              <div
                key={group.card.instanceId}
                className={`board-card-stack${group.card.tapped ? " board-card-stack-tapped" : ""}`}
                data-cardid={group.card.cardId}
              >
                <EquipmentStack
                  card={group.card}
                  motionLocation={{ kind: "board", seat: player.seat }}
                  highlighted={group.activatable}
                  selected={mine && interaction.selection.kind === "activate" &&
                    interaction.selection.sourceInstanceId === group.card.instanceId}
                  onClick={group.activatable ? activate(group.card.instanceId) : undefined}
                />
                {group.count > 1 ? <span className="board-card-count">×{group.count}</span> : null}
              </div>
            ))}
          </div>
        ) : undefined}
      </MatZone>
      {pileZone(
        `${row(1)} / 9`,
        "Graveyard",
        player.graveyard.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
        `${side} Graveyard`,
      )}
      {equipmentZone("chest", "2 / 1")}
      {equipmentZone("arms", "2 / 2")}
      {weaponZone(0, "2 / 4")}
      <MatZone area="2 / 5" label="Hero" className="zone-hero">
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
        label="Pitch"
        className="zone-pitch"
        motionZone={motionLocationKey({ kind: "pitch", seat: player.seat })}
        onClick={player.pitchCount
          ? () => onOpenOverlay({ title: `${side} Pitch`, cards: player.pitch })
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
        label="Deck"
        className={`zone-deck${deckShuffling ? " deck-shuffling" : ""}`}
        motionZone={motionLocationKey({ kind: "deck", seat: player.seat })}
        count={presentedDeckTop ? player.deckCount : undefined}
        onClick={visibleReplayDeck?.length
          ? () => onOpenOverlay({
              title: `${side} Deck — draw order, next card first`,
              cards: visibleReplayDeck,
            })
          : undefined}
      >
        {presentedDeckTop ? (
          <CardFace
            card={presentedDeckTop}
            size="zone"
            motionKey={motionPresentationKey(
              { kind: "deck", seat: player.seat },
              presentedDeckTop.instanceId,
            )}
            highlighted={deckTopPlayable}
            selected={interaction.selection.kind === "play-zone" &&
              interaction.selection.instanceId === presentedDeckTop.instanceId}
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
          <CardBack label="Deck" count={player.deckCount} />
        )}
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
        area={`${row(3)} / 5`}
        label="Arsenal"
        className="zone-arsenal"
        motionZone={motionLocationKey({ kind: "arsenal", seat: player.seat })}
      >
        {mine ? (
          arsenalCard ? (
            <CardFace
              card={arsenalCard}
              size="zone"
              motionKey={motionPresentationKey(
                { kind: "arsenal", seat: player.seat },
                arsenalCard.instanceId,
              )}
              dimmed={arsenalCard.faceDown && !interaction.legal.playableArsenal.has(arsenalCard.instanceId)}
              highlighted={interaction.legal.playableArsenal.has(arsenalCard.instanceId)}
              selected={interaction.selection.kind === "play-arsenal" &&
                interaction.selection.instanceId === arsenalCard.instanceId}
              onClick={interaction.legal.playableArsenal.has(arsenalCard.instanceId)
                ? () => interaction.onSelect({ kind: "play-arsenal", instanceId: arsenalCard.instanceId })
                : undefined}
              showFaceUp={!arsenalCard.faceDown}
            />
          ) : undefined
        ) : arsenalCard ? (
          <CardFace
            card={arsenalCard}
            size="zone"
            motionKey={motionPresentationKey(
              { kind: "arsenal", seat: player.seat },
              arsenalCard.instanceId,
            )}
          />
        ) : player.arsenalCount > 0 ? (
          <CardBack label="Arsenal" />
        ) : undefined}
      </MatZone>
      {pileZone(
        `${row(3)} / 9`,
        "Banished",
        player.banish.filter((card) => !optimisticallyHiddenIds.has(card.instanceId)),
        `${side} Banish`,
      )}
    </div>
  );
}
