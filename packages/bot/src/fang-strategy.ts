export type FangStance = "default" | "aggro" | "defensive";
export type FangHead = "crown" | "kabuto" | "balance" | "skullcap";

export interface FangMatchup {
  /** Aggro: Blaze Headlong and Sworn Vengeance replace Sink Below and Smoke
   * Out. Defensive: Fate Foreseen replaces Fire and Brimstone and Imperial
   * Intent. Default keeps the main list. */
  stance: FangStance;
  /** Parched Terrain against heroes that gain life. */
  parched: boolean;
  head: FangHead;
}

const DEFENSIVE_HEROES = /\b(?:cindra|kayo|katsu|kassai|fai|dash|levia|boltyn|zen|marlynn|azalea|aurora)\b/;
const AGGRO_HEROES =
  /\b(?:arakni|florian|gravy bones|jarl|verdance|oscilio|iyslander|kano|bravo|betsy|victor|olympia|dromai|prism|enigma|nuu|uzuri|teklovossen|vynnset|chane|oldhim)\b/;
const LIFE_GAIN_HEROES = /\b(?:arakni|jarl|verdance|oldhim|victor|prism)\b/;
const WEAPON_HEROES = /\b(?:cindra|fang|kassai|dorinthea|hala|ira)\b/;
const ARCANE_HEROES = /\b(?:verdance|oscilio|iyslander|kano|aurora|vynnset)\b/;
const DRAW_HEROES = /\b(?:gravy bones|jarl|kayo|rhinar|katsu|olympia|betsy)\b/;

/** Shared classification for Fang's presentation and live policy. */
export function fangMatchupForHeroName(heroName: string, classes: readonly string[] = []): FangMatchup {
  const name = heroName.trim().toLowerCase();
  const stance: FangStance = DEFENSIVE_HEROES.test(name)
    ? "defensive"
    : AGGRO_HEROES.test(name) || classes.includes("wizard") || classes.includes("guardian")
    ? "aggro"
    : "default";
  const head: FangHead = WEAPON_HEROES.test(name)
    ? "kabuto"
    : ARCANE_HEROES.test(name) || classes.includes("wizard")
    ? "skullcap"
    : DRAW_HEROES.test(name) || classes.includes("brute") || classes.includes("pirate")
    ? "balance"
    : "crown";
  return { stance, parched: LIFE_GAIN_HEROES.test(name), head };
}
