import { useState } from "react";
import { useIntl } from "react-intl";
import type { PrepSeatView } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";

export function AcceptHeroMatchup({
  you,
  opponent,
}: {
  you: PrepSeatView | null;
  opponent: PrepSeatView | null;
}) {
  const intl = useIntl();
  const yourHero = you?.heroName ?? intl.formatMessage({ id: "prep.yourHero" });
  const opponentHero = opponent?.heroName ?? intl.formatMessage({ id: "prep.opponent" });
  return (
    <div
      className="accept-hero-matchup"
      aria-label={intl.formatMessage(
        { id: "prep.matchupAria" },
        { yourHero, opponentHero },
      )}
    >
      <AcceptHero
        key={you?.heroName ?? "you"}
        seat={you}
        label={intl.formatMessage({ id: "prep.you" })}
      />
      <span className="accept-hero-vs" aria-hidden="true">VS</span>
      <AcceptHero
        key={opponent?.heroName ?? "opponent"}
        seat={opponent}
        label={intl.formatMessage({ id: "prep.opponent" })}
      />
    </div>
  );
}

function AcceptHero({ seat, label }: { seat: PrepSeatView | null; label: string }) {
  const intl = useIntl();
  const [imageAvailable, setImageAvailable] = useState(true);

  return (
    <div className="accept-hero-side">
      {seat && imageAvailable ? (
        <img
          src={heroImageUrl(seat.heroName)}
          alt={seat.heroName}
          onError={() => setImageAvailable(false)}
        />
      ) : (
        <span className="accept-hero-fallback">{seat?.heroName.charAt(0) ?? "?"}</span>
      )}
      <span>{label}</span>
      <strong>{seat?.heroName ?? intl.formatMessage({ id: "prep.unknownHero" })}</strong>
    </div>
  );
}
