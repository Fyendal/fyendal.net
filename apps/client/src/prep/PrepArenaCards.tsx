import { useIntl } from "react-intl";
import type { RevealedArena } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardArtwork } from "../game/Card.js";
import { EQUIPMENT_SLOTS } from "../domain.js";

export function PrepArenaCards({ arena, owner }: {
  arena: RevealedArena;
  owner: "you" | "opponent";
}) {
  const intl = useIntl();
  const cards = [...arena.weaponIds, ...EQUIPMENT_SLOTS.flatMap((slot) => {
    const id = arena.equipment[slot];
    return id === undefined ? [] : [id];
  })];
  return (
    <div className="prep-section">
      <h4>{intl.formatMessage({ id: owner === "you" ? "prep.arena.yours" : "prep.arena.opponent" })}</h4>
      <div className="prep-cardrow">
        {cards.map((id, index) =>
          id ? <CardArtwork
            key={index} className="prep-card" cardId={id}
            alt={cardData[id]?.name ?? id} width={105} height={147}
          /> : <span key={index} className="prep-card prep-cloaked-card">
            {intl.formatMessage({ id: "prep.arena.cloaked" })}
          </span>,
        )}
      </div>
    </div>
  );
}
