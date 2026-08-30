import type { CardData, CardView } from "@fyendal/shared";
import type { BotPolicyInput } from "./policy.js";

export type CardRoleTag =
  | "attack"
  | "attack-reaction"
  | "defense-reaction"
  | "prevention"
  | "setup"
  | "red-offense"
  | "blue-block-3"
  | `hero:${string}`;

/** Projection-only opportunity costs used to order and collapse planner
 * candidates. They never replace simulated damage or completed-turn value. */
export interface CardRoles {
  playValue: number;
  pitchCost: number;
  blockCost: number;
  retainValue: number;
  arsenalValue: number;
  tags: readonly CardRoleTag[];
}

export type CardRoleEvaluator = (card: CardView, input: BotPolicyInput) => CardRoles;

function includesText(data: CardData, pattern: RegExp): boolean {
  return pattern.test(data.text);
}

/** Conservative cross-hero defaults. Hero profiles may override individual
 * values and add protected synergy tags before enabling candidate collapse. */
export function defaultCardRoles(card: CardView, input: BotPolicyInput): CardRoles {
  const data = input.cards[card.cardId];
  if (!data) {
    return {
      playValue: 0,
      pitchCost: 0,
      blockCost: 0,
      retainValue: 0,
      arsenalValue: 0,
      tags: [],
    };
  }

  const pitch = Number(data.pitch ?? 0);
  const defense = Number(card.defense ?? data.defense ?? 0);
  const attack = Number(card.attack ?? data.attack ?? 0);
  const isAttack = data.cardType === "action" && data.subtypes?.includes("attack") === true;
  const tags: CardRoleTag[] = [];
  if (isAttack) tags.push("attack");
  if (data.cardType === "attack-reaction") tags.push("attack-reaction");
  if (data.cardType === "defense-reaction") tags.push("defense-reaction");
  if (includesText(data, /prevent(?:s|ed|ing)?\b/i)) tags.push("prevention");
  if (pitch === 1 && (isAttack || data.cardType === "attack-reaction")) tags.push("red-offense");
  if (pitch === 3 && defense >= 3) tags.push("blue-block-3");

  const colorPlayValue = Math.max(0, 3 - pitch) * 2;
  const reactionValue = data.cardType === "defense-reaction"
    ? defense + 7
    : data.cardType === "attack-reaction"
    ? attack + 6
    : 0;
  const preventionValue = tags.includes("prevention") ? 8 : 0;
  const playValue = Math.max(
    isAttack ? attack + colorPlayValue : 0,
    reactionValue,
    preventionValue,
    pitch,
  );
  const retainValue = playValue + (
    tags.includes("defense-reaction") || tags.includes("prevention") ? 4 : 0
  );
  return {
    playValue,
    pitchCost: retainValue + (pitch === 3 ? -2 : pitch === 1 ? 3 : 0),
    blockCost: retainValue + (defense >= 3 ? -1 : 2),
    retainValue,
    arsenalValue: retainValue + (
      tags.includes("defense-reaction") || tags.includes("attack-reaction") ? 4 : 0
    ),
    tags,
  };
}

export function hasCardRole(roles: CardRoles, tag: CardRoleTag): boolean {
  return roles.tags.includes(tag);
}
