/**
 * Fabrary hero headshots, slugged from the hero's full name
 * ("Levia, Shadowborn Abomination" → levia-shadowborn-abomination).
 */
export function heroImageUrl(heroName: string): string {
  const slug = heroName
    .toLowerCase()
    .replace(/ð/g, "d")
    .replace(/['’.,/!]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return `https://content.fabrary.net/heroes/${slug}.webp`;
}
