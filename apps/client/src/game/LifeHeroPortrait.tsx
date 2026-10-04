import { heroImageUrl } from "../lobby/heroImage.js";
import { resolveCardImageUrl } from "./cardImageUrl.js";

export function LifeHeroPortrait({ heroName, heroCardId }: {
  heroName: string;
  heroCardId: string;
}) {
  const fallback = resolveCardImageUrl(heroCardId);
  return (
    <img
      key={`${heroName}:${heroCardId}`}
      className="life-hero"
      src={heroImageUrl(heroName)}
      alt=""
      width={32}
      height={32}
      aria-hidden="true"
      onError={(event) => {
        const image = event.currentTarget;
        // Transformed heroes may have card art but no dedicated headshot.
        if (image.src !== fallback) image.src = fallback;
        else image.hidden = true;
      }}
    />
  );
}
