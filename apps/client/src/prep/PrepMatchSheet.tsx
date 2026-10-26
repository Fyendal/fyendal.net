import type { ReactNode } from "react";
import { useIntl } from "react-intl";
import type { PrepPhase, PrepSeatView, RevealedArena } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardArtwork } from "../game/Card.js";

type OpponentPrepState = "arena-locked" | "ready" | "disconnected";

/** Both players are always on the same step, so only report the opponent
 *  when they have finished it ahead of you or dropped out. */
export function opponentPrepState(phase: PrepPhase, opponent: PrepSeatView): OpponentPrepState | null {
  if (!opponent.connected) return "disconnected";
  if (phase === "select-deck") return opponent.ready ? "ready" : null;
  if (phase === "select-arena" || phase === "choose-first") {
    return opponent.arenaLocked ? "arena-locked" : null;
  }
  return null;
}

type MatSlot = "head" | "chest" | "arms" | "legs" | "weapon";

/**
 * One arena zone, placed where the game board puts it. `id` is a card id,
 * null for a Cloaked card, or undefined for an empty zone.
 */
function MatZone({
  slot,
  id,
  hidden,
  className,
}: {
  slot: MatSlot;
  id: string | null | undefined;
  hidden: boolean;
  className: string;
}) {
  const intl = useIntl();
  const slotName = intl.formatMessage({ id: `prep.slot.${slot}` });
  if (!hidden && id) {
    const name = cardData[id]?.name ?? id;
    return (
      <span className={`prep-mat-zone ${className}`} data-cardid={id}>
        <CardArtwork cardId={id} alt={`${slotName}: ${name}`} />
      </span>
    );
  }
  if (!hidden && id === null) {
    const label = `${slotName}: ${intl.formatMessage({ id: "prep.arena.cloaked" })}`;
    return <span className={`prep-mat-zone prep-mat-cloaked ${className}`} role="img" aria-label={label} />;
  }
  return (
    <span
      className={`prep-mat-zone prep-mat-empty${hidden ? " prep-mat-hidden" : ""} ${className}`}
      role="img"
      aria-label={slotName}
    >
      <span className={`equipment-zone-icon equipment-zone-icon-${slot}`} aria-hidden="true" />
    </span>
  );
}

function PlayerMat({
  heroId,
  heroName,
  playerName,
  arena,
  status,
  side,
}: {
  heroId: string;
  heroName: string;
  playerName: string;
  /** Undefined while the opponent's arena is still hidden. */
  arena?: RevealedArena;
  status?: ReactNode;
  /** The opponent's row is mirrored so both heroes face the VS mark. */
  side: "yours" | "theirs";
}) {
  const hidden = arena === undefined;
  const zone = (slot: MatSlot, id: string | null | undefined, className: string) => (
    <MatZone slot={slot} id={id} hidden={hidden} className={className} />
  );
  return (
    <div className={`prep-mat ${side}`}>
      <div className="prep-mat-player">
        <div className="prep-mat-hero-name">{heroName}</div>
        <div className="prep-mat-owner">{playerName}</div>
        {status}
      </div>
      <div className="prep-mat-cards">
        <span className="prep-mat-zone prep-mat-hero at-hero" data-cardid={heroId}>
          <CardArtwork cardId={heroId} alt={heroName} />
        </span>
        {zone("weapon", arena?.weaponIds[0], "at-weapon-left")}
        {zone("weapon", arena?.weaponIds[1], "at-weapon-right")}
        {zone("head", arena?.equipment.head, "at-head")}
        {zone("chest", arena?.equipment.chest, "at-chest")}
        {zone("arms", arena?.equipment.arms, "at-arms")}
        {zone("legs", arena?.equipment.legs, "at-legs")}
      </div>
    </div>
  );
}

/**
 * Desktop preparation band: both players' arenas face each other across the
 * VS mark, with the single action that advances preparation at the end.
 */
export function PrepMatchSheet({
  phase,
  yourHeroId,
  yourHeroName,
  opponent,
  yourArena,
  opponentArena,
  notice,
  action,
}: {
  phase: PrepPhase;
  yourHeroId: string;
  yourHeroName: string;
  opponent: PrepSeatView;
  yourArena: RevealedArena;
  opponentArena?: RevealedArena;
  notice: ReactNode;
  action: ReactNode;
}) {
  const intl = useIntl();
  const state = opponentPrepState(phase, opponent);
  return (
    <section
      className="panel prep-opponent prep-sheet"
      aria-label={intl.formatMessage(
        { id: "prep.matchupAria" },
        { yourHero: yourHeroName, opponentHero: opponent.heroName },
      )}
    >
      <div className="prep-sheet-body">
        <PlayerMat
          heroId={opponent.heroId}
          heroName={opponent.heroName}
          playerName={opponent.username}
          arena={opponentArena}
          status={state ? (
            <div className={`prep-sheet-state ${state}`}>
              {intl.formatMessage({ id: `prep.opponentState.${state}` })}
            </div>
          ) : null}
          side="theirs"
        />
        <div className="prep-mat-divider" aria-hidden="true"><span className="prep-vs">VS</span></div>
        <PlayerMat
          heroId={yourHeroId}
          heroName={yourHeroName}
          playerName={intl.formatMessage({ id: "prep.you" })}
          arena={yourArena}
          side="yours"
        />
      </div>
      <div className="prep-sheet-action">
        {notice}
        {action}
      </div>
    </section>
  );
}
