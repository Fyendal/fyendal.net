export type AuroraStance = "beatdown" | "defensive";

export interface AuroraMatchup {
  /** Beatdown: Flittering Charge with six +3 instants. Defensive: six defense
   * reactions with Rush of Power and the third Scar for a Scar. */
  stance: AuroraStance;
  /** Opponent deals arcane damage, so arcane barrier armor is worn. */
  arcane: boolean;
}

const RACING_HEROES =
  /\b(?:cindra|fai|kayo|rhinar|katsu|dash|ira|levia|boltyn|fang|kassai|zen|briar|aurora|marlynn|azalea)\b|arakni, marionette/;
const ARCANE_HEROES = /\b(?:kano|blaze|iyslander|oscilio|briar|viserai|aurora|vynnset|chane|florian)\b/;

/** Shared classification for Aurora's presentation and live policy. */
export function auroraMatchupForHeroName(heroName: string, classes: readonly string[] = []): AuroraMatchup {
  const name = heroName.trim().toLowerCase();
  return {
    stance: RACING_HEROES.test(name) ? "defensive" : "beatdown",
    arcane: classes.includes("wizard") || classes.includes("runeblade") || ARCANE_HEROES.test(name),
  };
}
