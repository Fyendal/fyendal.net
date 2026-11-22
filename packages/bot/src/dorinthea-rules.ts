import type { CardData } from "@fyendal/shared";
import { lifeGainAlternative } from "./bravo-policy.js";
import type { HeroSolverRules, SolverCardPatch } from "./card-model.js";
import type { PendingEffect, SolverCard } from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";
import { hasType } from "@fyendal/shared";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

/** Share of weapon attacks the opponent defends with a card from hand. */
const REPRISE_RATE = 0.5;
/** Share of weapon attacks defended by an attack action card. */
const ATTACK_ACTION_DEFENDS_RATE = 0.4;

const isWeapon = (card: SolverCard): boolean => card.kind === "weapon";
const isAxe = (card: SolverCard): boolean => isWeapon(card) && card.traits.includes("axe");

/** First "+N{p}" printed on the card. */
export function printedPump(data: CardData): number {
  return Number(/\+(\d+)\{p\}/.exec(data.text)?.[1] ?? 0);
}

function weaponPump(patch: SolverCardPatch, power: number): void {
  patch.reactionPower = power;
  patch.reactionTarget = isWeapon;
  patch.uses = { ...patch.uses, pump: power };
}

/** Hand-value rules for Dorinthea: weapon-only pumps and reactions, Reprise,
 * and the additional weapon attack her first weapon hit grants. */
export function dorintheaSolverRules(input: BotPolicyInput): HeroSolverRules {
  const heroAbility = input.view.players[input.seat].heroAbilitiesLost !== true;
  return {
    name: "dorinthea",
    trackedTraits: [],
    startFlags(observed, nextTurn): Record<string, number> {
      const swung = !nextTurn && (observed.view.turnFacts?.players[observed.seat].weaponAttacks ?? 0) > 0;
      return swung ? { weaponSwung: 1 } : {};
    },
    card(data, card, context) {
      const patch: SolverCardPatch = {};
      const pump = printedPump(data);
      const next = (effect: Omit<PendingEffect, "key" | "uses">): void => {
        patch.replaceAfter = true;
        patch.after = () => ({ pending: [{ key: `${card.cardId}#${card.instanceId}`, uses: 1, ...effect }] });
      };
      if (hasType(data, "weapon")) {
        if (!heroAbility) return patch;
        const power = card.attack ?? data.attack ?? 0;
        // The second swing exists only if the first one hit.
        patch.powerIn = (view) => view.flag("weaponSwung") > 0 ? power * context.hitChance : power;
        patch.after = (view) => view.flag("weaponSwung") > 0
          ? undefined
          : { flags: { weaponSwung: 1, [`extraUse:${card.instanceId}`]: 1 } };
        return patch;
      }
      switch (named(data)) {
        case "felling swing":
          next({ power: pump, appliesTo: isAxe });
          break;
        case "sharpen steel":
          next({ power: pump, appliesTo: isWeapon });
          break;
        case "hit and run":
          next({ grantsGoAgain: true, appliesTo: isWeapon });
          break;
        case "overpower":
          weaponPump(patch, pump + 2 * REPRISE_RATE);
          break;
        case "ironsong response":
          weaponPump(patch, pump * REPRISE_RATE);
          break;
        case "biting blade":
        case "display of craftsmanship":
          weaponPump(patch, pump);
          break;
        case "fatal engagement":
          patch.reactionPower = pump * ATTACK_ACTION_DEFENDS_RATE;
          patch.uses = { pump: pump * ATTACK_ACTION_DEFENDS_RATE };
          break;
        default: {
          const alternative = lifeGainAlternative(data, input);
          if (alternative > 0) patch.uses = { alternative };
        }
      }
      return patch;
    },
  };
}
