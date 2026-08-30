export type BriarMatchup =
  | "ninja"
  | "fatigue"
  | "wizard"
  | "runeblade"
  | "dominate"
  | "dromai"
  | "enigma"
  | "briar"
  | "iyslander"
  | "stock";

/** Shared matchup classification for Briar's presentation and live policy. */
export function briarMatchupForHeroName(heroName: string): BriarMatchup {
  const name = heroName.trim().toLowerCase();
  if (name.includes("fai") || name.includes("zen") || name.includes("cindra")) return "ninja";
  if (name.includes("terra") || name.includes("riptide") || name.includes("oldhim") || name.includes("dorinthea")) return "fatigue";
  if (name.includes("blaze") || name.includes("kano")) return "wizard";
  if (name.includes("chane") || name.includes("florian") || name.includes("viserai")) return "runeblade";
  if (name.includes("azalea") || name.includes("valda")) return "dominate";
  if (name.includes("dromai")) return "dromai";
  if (name.includes("enigma")) return "enigma";
  if (name.includes("briar")) return "briar";
  if (name.includes("iyslander")) return "iyslander";
  return "stock";
}
