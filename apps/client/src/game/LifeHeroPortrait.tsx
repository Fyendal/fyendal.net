import { heroImageUrl } from "../lobby/heroImage.js";
import { resolveCardImageUrls } from "./cardImageUrl.js";

export function LifeHeroPortrait({ heroName, heroCardId }: {
  heroName: string;
  heroCardId: string;
}) {
  const fallbacks = resolveCardImageUrls(heroCardId);
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
        const next = fallbacks[fallbacks.indexOf(image.src) + 1];
        if (next) image.src = next;
        else image.hidden = true;
      }}
    />
  );
}
