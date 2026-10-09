import type { CardData } from "@fyendal/shared";
import { BLOCK_USE_RATE, expectedTopPitch } from "./card-ev.js";
import { cardTraits, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import type { PendingEffect, SolverCard, SolverView } from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

/** Damage-equivalent value of a Fealty token (makes a later card Draconic)
 * and of marking the opposing hero. Both pay off beyond the evaluated turn,
 * so they are explicit, named values rather than solver rules. */
export const FEALTY_TOKEN_VALUE = 1;
export const MARK_VALUE = 1;
/** A drawn card, matching the on-hit draw value in value.ts. */
const CARD_DRAW_VALUE = 3;

const TWO_DRACONIC_LINKS = /if you control 2 or more draconic chain links, this gets go again/i;

function isDagger(card: SolverCard): boolean {
  return card.kind === "weapon" && card.traits.includes("dagger");
}

/** Draconic links once the (Draconic) attack being evaluated is on the chain. */
function draconicLinksWithThis(view: SolverView): number {
  return view.flag("links:draconic") + 1;
}

function draconicCostReduction(key: string, uses: number): PendingEffect {
  return {
    key,
    uses,
    costReduction: 1,
    scope: "card",
    appliesTo: (card, view) => view.hasTrait(card, "draconic"),
  };
}

/**
 * Hand-value rules for Cindra. Draconic-link conditions, Rupture, cost
 * reductions and dagger hits are modelled exactly, so preferences such as
 * "open with a Draconic go-again attack" emerge from the search instead of
 * being weighted by hand.
 */
export function cindraSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const daggers = me.weapons.filter((card) => input.cards[card.cardId]?.subtypes?.includes("dagger")).length;
  const daggersLeft = (view: SolverView) => Math.max(0, daggers - view.flag("daggersSpent"));
  const topPitch = expectedTopPitch(input);

  // Oath of Loyalty: after it, only Draconic cards may be played this turn.
  const withOathRestriction = (patch: SolverCardPatch): SolverCardPatch => {
    const own = patch.canPlay;
    return {
      ...patch,
      canPlay: (view, self) => {
        if (view.flag("onlyDraconic") > 0 && !view.hasTrait(self, "draconic")) return false;
        return own ? own(view, self) : true;
      },
    };
  };

  return {
    name: "cindra",
    trackedTraits: ["draconic", "red"],
    card(data, card) {
      const name = named(data);
      const power = card.attack ?? data.attack ?? 0;
      const patch: SolverCardPatch = {};
      const traits = cardTraits(data, card);
      if (data.cardType === "action" && traits.includes("attack") && !traits.includes("draconic")) {
        // Enflame the Firebrand at 3+ Draconic links makes every attack Draconic.
        const asDraconic = [...traits, "draconic"];
        patch.traitsIn = (view) => view.flag("allDraconic") > 0 ? asDraconic : traits;
      }
      if (TWO_DRACONIC_LINKS.test(data.text)) {
        patch.goAgainIn = (view) => draconicLinksWithThis(view) >= 2;
      }
      switch (name) {
        case "art of the dragon: blood":
          patch.goAgainIn = (view) => view.flag("allDraconic") > 0;
          patch.after = (view) => view.flag("allDraconic") > 0
            ? { pending: [draconicCostReduction(`art#${card.instanceId}`, 3)] }
            : undefined;
          break;
        case "blood runs deep":
          patch.costIn = (view) => Math.max(0, (data.cost ?? 2) - view.flag("links:draconic"));
          patch.powerIn = (view) => power + daggersLeft(view);
          patch.after = (view) => daggersLeft(view) > 0
            ? { flags: { daggersSpent: daggers, daggerHit: 1 } }
            : undefined;
          break;
        case "blaze headlong":
          patch.goAgainIn = (view) => view.flag("played:red") > 0;
          patch.uses = { reliableGoAgain: true };
          break;
        case "enflame the firebrand":
          patch.powerIn = (view) => power + (draconicLinksWithThis(view) >= 4 ? 2 : 0);
          patch.after = (view) => view.flag("links:draconic") >= 3 ? { flags: { allDraconic: 1 } } : undefined;
          break;
        case "burning blade dance":
          patch.onHitIn = (view) => draconicLinksWithThis(view) >= 2 && daggersLeft(view) > 0 ? 1 : 0;
          patch.after = (view) => view.flag("links:draconic") >= 2 && daggersLeft(view) > 0
            ? { flags: { daggerHit: 1, daggersSpent: view.flag("daggersSpent") + 1 } }
            : undefined;
          break;
        case "demonstrate devotion":
        case "display loyalty":
          patch.bonusIn = (view) => draconicLinksWithThis(view) >= 2 ? FEALTY_TOKEN_VALUE : 0;
          break;
        case "hot on their heels":
          patch.onHitIn = (view) => draconicLinksWithThis(view) >= 2 ? MARK_VALUE : 0;
          break;
        case "hunt the hunter":
          patch.bonusIn = (view) => view.flag("played:red") > 0 ? MARK_VALUE : 0;
          break;
        case "lava burst":
          patch.powerIn = (view) => power + (view.links >= 3 ? 3 : 0);
          break;
        case "breaking point":
          patch.onHitIn = (view) => view.links >= 3 && opponent.arsenalCount > 0 ? 4 : 0;
          break;
        case "cut through":
          patch.goAgainIn = (view) => view.flag("daggerHit") > 0;
          patch.powerIn = (view) => power + (view.flag("daggerHit") > 0 ? 1 : 0);
          break;
        case "ignite":
          patch.after = () => ({ pending: [draconicCostReduction(`ignite#${card.instanceId}`, 1)] });
          break;
        case "fire tenet: strike first":
          patch.after = () => ({
            pending: [{
              key: `tenet#${card.instanceId}`,
              uses: 1,
              power: 1,
              appliesTo: (target, view) => view.hasTrait(target, "draconic"),
            }],
          });
          break;
        case "oath of loyalty":
          patch.canPlay = (view) => view.flag("played") === 0 && view.flag("attacks") === 0;
          patch.after = () => ({ flags: { onlyDraconic: 1 } });
          break;
        case "ravenous rabble":
          patch.powerIn = () => Math.max(0, power - topPitch);
          patch.uses = { power: Math.max(0, power - topPitch) };
          break;
        case "ancestral empowerment":
          patch.bonusIn = () => CARD_DRAW_VALUE;
          break;
        case "throw dagger":
          // One dagger damage that hits, drawing a card.
          patch.reactionPower = 0;
          patch.bonusIn = () => 1 + CARD_DRAW_VALUE;
          patch.canPlay = (view) => daggersLeft(view) > 0 &&
            !(view.lastAttack !== undefined && isDagger(view.lastAttack) && daggersLeft(view) <= 1);
          patch.after = (view) => ({ flags: { daggerHit: 1, daggersSpent: view.flag("daggersSpent") + 1 } });
          patch.uses = { pump: 4 };
          break;
        case "kunai of retribution":
        case "claw of vynserakai":
          patch.canPlay = (view) => daggersLeft(view) > 0;
          patch.after = () => ({ flags: { daggerHit: 1 } });
          break;
        default:
          break;
      }
      return withOathRestriction(patch);
    },
    equipment(data, card) {
      if (named(data) !== "dragonscaler flight path") return undefined;
      return {
        kind: "equipment",
        speed: "instant",
        cost: 3,
        costIn: (view) => Math.max(0, 3 - view.flag("links:draconic")),
        consumeCost: Math.max(0, card.defense ?? data.defense ?? 0) * BLOCK_USE_RATE,
        canPlay: (view) => view.lastAttack !== undefined && view.hasTrait(view.lastAttack, "draconic") &&
          view.flag("lastAttackGoAgain") === 0,
        after: (view) => ({
          actionPoints: 1,
          flags: {
            lastAttackGoAgain: 1,
            ...(view.lastAttack?.kind === "weapon"
              ? { [`extraUse:${view.lastAttack.instanceId}`]: view.flag(`extraUse:${view.lastAttack.instanceId}`) + 1 }
              : {}),
          },
        }),
      };
    },
  };
}
