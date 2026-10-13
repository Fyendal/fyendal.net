import { cardData } from "@fyendal/cards/client";
import { heroImageUrl } from "../lobby/heroImage.js";

export function heroName(heroId: string): string {
  return cardData[heroId]?.name ?? heroId;
}

/** Short display name: the part before the first comma ("Levia"). */
export function heroShortName(heroId: string): string {
  return heroName(heroId).split(",")[0]!.trim();
}

export function HeroPortrait({ heroId, size }: { heroId: string; size: "lg" | "md" | "sm" }) {
  const name = heroName(heroId);
  return (
    <span className={`hero-portrait hero-portrait-${size}`} aria-hidden="true">
      <span>{name.slice(0, 1)}</span>
      <img
        src={heroImageUrl(name)}
        alt=""
        loading="lazy"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}
