import type { RefObject } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import { CardArtwork } from "./Card.js";
import { CREATED_PANEL_WIDTH, type CreatedCardsPlacement } from "./createdCards.js";
import { RulesText } from "./RulesText.js";

const STAT_ICONS = [
  ["attack", "/icons/attack.png"],
  ["defense", "/icons/defence.png"],
  ["life", "/icons/life.png"],
] as const;

/** The cards a previewed card creates, one row of art, name, type and rules text each. */
export function CreatedCardsPanel({
  created,
  pending = false,
  panelRef,
}: {
  created: CreatedCardsPlacement;
  /** Mounted early so its art loads, shown once the pointer has dwelt. */
  pending?: boolean;
  panelRef?: RefObject<HTMLElement>;
}) {
  const intl = useIntl();
  return (
    <section
      ref={panelRef}
      className={`created-cards-panel is-${created.dock}${pending ? " is-pending" : ""}`}
      aria-hidden={pending || undefined}
      style={created.dock === "below" ? undefined : { width: CREATED_PANEL_WIDTH }}
    >
      <h3 className="created-cards-title">
        {intl.formatMessage({ id: "game.createdCards.title" })}
      </h3>
      <ul className="created-cards-list">
        {created.ids.map((cardId) => <CreatedCardRow key={cardId} cardId={cardId} />)}
      </ul>
    </section>
  );
}

function CreatedCardRow({ cardId }: { cardId: string }) {
  const data = cardData[cardId];
  if (!data) return null;
  // The printed type line: "Generic Token - Aura", "Assassin Action - Attack".
  const typeLine = [...(data.classes ?? []), data.cardType.replace("-", " ")].join(" ") +
    (data.subtypes?.length ? ` - ${data.subtypes.join(" ")}` : "");
  return (
    <li className="created-card-row">
      <CardArtwork cardId={cardId} className="created-card-art" alt="" />
      <div className="created-card-body">
        <span className="created-card-name">{data.name}</span>
        <span className="created-card-type">
          {typeLine}
          {STAT_ICONS.map(([stat, icon]) =>
            data[stat] !== undefined ? (
              <span key={stat} className="created-card-stat">
                <img src={icon} alt="" draggable={false} />
                {data[stat]}
              </span>
            ) : null,
          )}
        </span>
        <RulesText text={data.text} className="created-card-text" />
      </div>
    </li>
  );
}
