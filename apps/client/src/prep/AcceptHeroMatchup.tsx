import { useState } from "react";
import type { PrepSeatView } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";

export function AcceptHeroMatchup({
  you,
  opponent,
}: {
  you: PrepSeatView | null;
  opponent: PrepSeatView | null;
}) {
  return (
    <div className="accept-hero-matchup" aria-label={`${you?.heroName ?? "Your hero"} versus ${opponent?.heroName ?? "opponent"}`}>
      <AcceptHero key={you?.heroName ?? "you"} seat={you} label="You" />
      <span className="accept-hero-vs" aria-hidden="true">VS</span>
      <AcceptHero key={opponent?.heroName ?? "opponent"} seat={opponent} label="Opponent" />
    </div>
  );
}

function AcceptHero({ seat, label }: { seat: PrepSeatView | null; label: string }) {
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
      <strong>{seat?.heroName ?? "Unknown hero"}</strong>
    </div>
  );
}
