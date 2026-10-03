import type { AchievementId } from "@fyendal/protocol";

export const ACHIEVEMENT_GROUPS: ReadonlyArray<{
  titleId: string;
  ids: readonly AchievementId[];
}> = [
  { titleId: "achievements.group.first", ids: ["first-victory", "first-pvp-win", "first-bot-win"] },
  { titleId: "achievements.group.challenges", ids: ["big-turn", "relentless-victory"] },
  { titleId: "achievements.group.bots", ids: [
    "beat-bravo", "beat-briar", "beat-kayo", "beat-cindra",
    "beat-ira", "beat-hala", "beat-jarl",
  ] },
];

export const ACHIEVEMENT_BOT_HEROES: Partial<Record<AchievementId, string>> = {
  "beat-bravo": "Bravo, Flattering Showman",
  "beat-briar": "Briar",
  "beat-kayo": "Kayo",
  "beat-cindra": "Cindra, Dracai of Retribution",
  "beat-ira": "Ira, Scarlet Revenger",
  "beat-hala": "Hala, Bladesaint of the Vow",
  "beat-jarl": "Jarl Vetreiði",
};

export function achievementMessageId(id: AchievementId, part: "name" | "description"): string {
  return `achievements.${id.replaceAll("-", "")}.${part}`;
}
