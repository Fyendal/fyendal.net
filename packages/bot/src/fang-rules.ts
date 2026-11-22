import type { CardData, CardView } from "@fyendal/shared";
import { cardTraits, cardUses, combineEffects, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import { FEALTY_TOKEN_VALUE } from "./cindra-rules.js";
import { printedPump } from "./dorinthea-rules.js";
import type { SolverCard, SolverEffect, SolverView } from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";
import { hasType } from "@fyendal/shared";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

/** Fang's daggers cost nothing from this many Fealty tokens. */
export const ONLINE_FEALTY = 3;
/** A Fealty token below three is a third of the free swings that follow:
 * about two resources a turn over the four or five turns left. */
export const FEALTY_BUILD_VALUE = 3;
/** Share of a Fealty token a standing mark is worth: it lasts until the next
 * hit, and Fang swings every turn. */
const MARK_CONVERSION = 0.8;
/** A drawn card, matching cindra-rules. */
const CARD_DRAW_VALUE = 3;
/** Share of weapon attacks the opponent defends with a card from hand (Reprise). */
const REPRISE_RATE = 0.5;
/** Provoke strips or reveals one card from hand. */
const PROVOKE_VALUE = 1;

export function fealtyValue(fealty: number): number {
  return fealty < ONLINE_FEALTY ? FEALTY_BUILD_VALUE : FEALTY_TOKEN_VALUE;
}

export function markValue(fealty: number): number {
  return MARK_CONVERSION * fealtyValue(fealty);
}

export function fealtyTokens(input: BotPolicyInput): CardView[] {
  return input.view.players[input.seat].board.filter((card) => named(input.cards[card.cardId]) === "fealty");
}

export function opponentMarked(input: BotPolicyInput): boolean {
  return (input.view.players[1 - input.seat]!.heroCounters?.marked ?? 0) > 0;
}

/** A non-attack action, card or activation, closes the combat chain: later
 * swings start again from no Draconic links. */
const CHAIN_CLOSED: SolverEffect = { flags: { veinWaiting: 0, "links:draconic": 0, "links:red": 0 } };

/** Mark probabilities are kept to tenths so solver memo keys stay few. */
const tenth = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 10) / 10;

const isWeapon = (card: SolverCard): boolean => card.kind === "weapon";
const isDagger = (card: SolverCard): boolean => isWeapon(card) && card.traits.includes("dagger");

/** Obsidian Fire Vein's open link: a Draconic card played now gives it +1{p} and go again. */
function veinWaiting(view: SolverView): boolean {
  return view.flag("veinWaiting") > 0 && view.lastAttack?.kind === "weapon";
}

/** A rider that marks the opposing hero if the current link hits, from `minLinks` Draconic links. */
function addMarkRider(patch: SolverCardPatch, hitChance: number, minLinks = 0): void {
  const active = (view: SolverView) => view.flag("links:draconic") >= minLinks;
  patch.onHitIn = (view) => active(view) ? (1 - view.flag("mark")) * markValue(view.flag("fealty")) : 0;
  withAfter(patch, (view) => active(view)
    ? { flags: { mark: tenth(view.flag("mark") + (1 - view.flag("mark")) * hitChance) } }
    : undefined);
}

function withAfter(patch: SolverCardPatch, extra: (view: SolverView) => SolverEffect | undefined): void {
  const own = patch.after;
  patch.after = (view) => combineEffects(own?.(view), extra(view));
}

function withBonus(patch: SolverCardPatch, extra: (view: SolverView) => number): void {
  const own = patch.bonusIn;
  patch.bonusIn = (view) => (own?.(view) ?? 0) + extra(view);
}

/**
 * Hand-value rules for Fang: Obsidian Fire Vein's Draconic go again, free
 * dagger swings from three Fealty tokens, and the mark → Fealty loop. Fealty
 * and marks pay off beyond the turn, so they carry explicit values.
 */
export function fangSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const heroAbility = me.heroAbilitiesLost !== true;
  const daggers = me.weapons.filter((weapon) => input.cards[weapon.cardId]?.subtypes?.includes("dagger"));
  const otherAuraNames = new Set(
    [...me.board, ...input.view.players[1 - input.seat]!.board].flatMap((card) => {
      const data = input.cards[card.cardId];
      return data && hasType(data, "token") && data.subtypes?.includes("aura") && named(data) !== "fealty"
        ? [named(data)]
        : [];
    }),
  ).size;

  const cardPatch = (data: CardData, card: CardView, hitChance: number): SolverCardPatch => {
    const patch: SolverCardPatch = {};
    const pump = printedPump(data);
    const power = card.attack ?? data.attack ?? 0;
    switch (named(data)) {
      case "obsidian fire vein":
        if (heroAbility) patch.costIn = (view) => view.flag("fealty") >= ONLINE_FEALTY ? 0 : 1;
        break;
      case "affirm loyalty":
        patch.reactionPower = pump;
        withBonus(patch, (view) => view.flag("links:draconic") >= 2 ? fealtyValue(view.flag("fealty")) : 0);
        withAfter(patch, (view) => view.flag("links:draconic") >= 2
          ? { flags: { fealty: view.flag("fealty") + 1 } }
          : undefined);
        break;
      case "blistering blade":
        patch.reactionPowerIn = (view) => view.flag("links:draconic") >= 2 ? 3 : 2;
        break;
      case "searing gaze":
        patch.reactionPower = pump;
        addMarkRider(patch, hitChance, 2);
        break;
      case "long whisker loyalty":
        // One mode per Draconic link: +2{p}, then an extra swing, then the mark.
        patch.reactionPower = 2;
        patch.after = (view) => {
          const dagger = view.lastAttack;
          return view.flag("links:draconic") >= 2 && dagger
            ? { flags: { [`extraUse:${dagger.instanceId}`]: view.flag(`extraUse:${dagger.instanceId}`) + 1 } }
            : undefined;
        };
        addMarkRider(patch, hitChance, 3);
        break;
      case "imperial intent":
        patch.costIn = (view) => Math.max(0, (data.cost ?? 1) - view.flag("links:draconic"));
        break;
      case "hunt's end":
        patch.canPlay = (view) => view.flag("fealty") >= ONLINE_FEALTY;
        if (fealtyTokens(input).length < ONLINE_FEALTY) patch.uses = { pump: 0 };
        break;
      case "fire and brimstone":
        patch.costIn = (view) => Math.max(0, (data.cost ?? 2) - view.flag("links:draconic"));
        patch.reactionPower = 1;
        patch.after = (view) => ({
          flags: Object.fromEntries(daggers.map((dagger) =>
            [`extraUse:${dagger.instanceId}`, view.flag(`extraUse:${dagger.instanceId}`) + 1]
          )),
          pending: [{
            key: `brimstone#${card.instanceId}`,
            uses: Infinity,
            power: 1,
            appliesTo: isDagger,
          }],
        });
        break;
      case "scar tissue":
        patch.reactionPower = pump;
        addMarkRider(patch, hitChance);
        break;
      case "blade flurry":
        patch.reactionPower = 2;
        patch.replaceAfter = true;
        patch.after = () => ({
          pending: [{ key: `flurry#${card.instanceId}`, uses: 1, power: 2, appliesTo: isWeapon }],
        });
        break;
      case "glint the quicksilver":
        patch.reactionPower = 0;
        patch.bonusIn = () => REPRISE_RATE * CARD_DRAW_VALUE;
        patch.after = (view) => view.lastAttack && view.flag("lastAttackGoAgain") === 0
          ? { actionPoints: 1, flags: { lastAttackGoAgain: 1 } }
          : undefined;
        patch.uses = { pump: 0, pumpRider: 2 };
        break;
      case "overpower":
        patch.reactionPower = pump + 2 * REPRISE_RATE;
        patch.uses = { pump: pump + 2 * REPRISE_RATE };
        break;
      case "provoke":
        patch.reactionPower = 0;
        patch.bonusIn = () => PROVOKE_VALUE;
        patch.uses = { pump: 0, pumpRider: PROVOKE_VALUE };
        break;
      case "relentless pursuit":
        patch.bonusIn = (view) => (1 - view.flag("mark")) * markValue(view.flag("fealty"));
        patch.after = () => ({ flags: { mark: 1 } });
        break;
      case "savor bloodshed":
        patch.replaceAfter = true;
        patch.after = (view) => ({
          pending: [{
            key: `savor#${card.instanceId}`,
            uses: 1,
            power: 4,
            onHit: view.flag("mark") * CARD_DRAW_VALUE,
            appliesTo: isDagger,
          }],
        });
        break;
      case "sworn vengeance":
        patch.replaceAfter = true;
        patch.after = (view) => ({
          pending: [{
            key: `sworn#${card.instanceId}`,
            uses: 1,
            power: pump,
            onHit: (1 - view.flag("mark")) * markValue(view.flag("fealty")),
            appliesTo: isDagger,
          }],
        });
        break;
      case "pledge fealty":
        patch.bonusIn = (view) => fealtyValue(view.flag("fealty"));
        patch.after = (view) => ({ flags: { fealty: view.flag("fealty") + 1 } });
        break;
      case "for the dracai":
        patch.bonusIn = (view) => view.flag("mark") * fealtyValue(view.flag("fealty"));
        patch.after = (view) => view.flag("mark") >= 1 ? { flags: { fealty: view.flag("fealty") + 1 } } : undefined;
        break;
      case "oath of loyalty":
        patch.canPlay = (view) => view.flag("played") === 0 && view.flag("attacks") === 0;
        patch.after = () => ({ flags: { onlyDraconic: 1 } });
        break;
      case "blaze headlong":
        patch.goAgainIn = (view) => view.flag("played:red") > 0;
        patch.uses = { reliableGoAgain: true };
        break;
      case "overcrowded":
        patch.powerIn = (view) => power + otherAuraNames + (view.flag("fealty") > 0 ? 1 : 0);
        break;
      default:
        break;
    }
    return patch;
  };

  return {
    name: "fang",
    trackedTraits: ["draconic", "red"],
    startFlags(observed, nextTurn) {
      const fealty = fealtyTokens(observed).length;
      const marked = opponentMarked(observed);
      return {
        ...(fealty > 0 ? { fealty } : {}),
        ...(marked ? { mark: 1 } : {}),
        ...(!nextTurn && (observed.view.turnFacts?.players[observed.seat].weaponAttacks ?? 0) > 0
          ? { veinSwung: 1 }
          : {}),
      };
    },
    startPending(observed, nextTurn) {
      // Next-attack setups already resolved this turn (Blade Flurry, Tooth, Savor...).
      if (nextTurn) return [];
      return observed.view.ongoing.flatMap((effect, index) => {
        if (effect.seat !== observed.seat || effect.facts?.nextAttack !== true || !effect.facts.power) return [];
        const source = named(observed.cards[effect.cardId]);
        const appliesTo = source === "tooth of the dragon"
          ? (attack: SolverCard, view: SolverView) => view.hasTrait(attack, "draconic")
          : source === "blade flurry" || source === "braveforge bracers" ? isWeapon : isDagger;
        return [{ key: `ongoing.${index}.${effect.cardId}`, uses: 1, power: effect.facts.power, appliesTo }];
      });
    },
    startResources(observed, nextTurn) {
      if (!nextTurn) return 0;
      return observed.view.players[observed.seat].board
        .filter((card) => named(observed.cards[card.cardId]) === "vigor").length;
    },
    card(data, card, context) {
      const patch = cardPatch(data, card, context.hitChance);
      const traits = cardTraits(data, card);
      const draconic = traits.includes("draconic");
      if (hasType(data, "weapon") || (hasType(data, "action") && traits.includes("attack"))) {
        const vein = hasType(data, "weapon");
        // Hitting a marked hero creates Fealty and spends the mark.
        const baseOnHit = cardUses(data, context.input, card).onHit;
        const ownOnHit = patch.onHitIn;
        patch.onHitIn = (view) => (ownOnHit ? ownOnHit(view) : baseOnHit) +
          (heroAbility ? view.flag("mark") * (fealtyValue(view.flag("fealty")) - markValue(view.flag("fealty"))) : 0);
        withAfter(patch, (view) => ({
          flags: {
            mark: heroAbility ? tenth(view.flag("mark") * (1 - context.hitChance)) : view.flag("mark"),
            veinWaiting: vein ? 1 : 0,
            ...(vein ? { veinSwung: 1 } : {}),
          },
        }));
      } else if (hasType(data, "attack-reaction") || hasType(data, "instant")) {
        const reaction = hasType(data, "attack-reaction");
        if (reaction) {
          const dagger = /target dagger attack/i.test(data.text);
          const weapon = /target weapon attack/i.test(data.text) || named(data) === "provoke";
          if (dagger) patch.reactionTarget = isDagger;
          else if (weapon) patch.reactionTarget = isWeapon;
        }
        // A non-Draconic card spends a surplus Fealty token to become Draconic.
        const spendsFealty = (view: SolverView) =>
          !draconic && reaction && view.flag("fealty") > ONLINE_FEALTY;
        const triggers = (view: SolverView) => veinWaiting(view) && (draconic || spendsFealty(view));
        if (reaction) {
          const base = patch.reactionPowerIn ?? ((): number => patch.reactionPower ?? 0);
          patch.reactionPowerIn = (view) => base(view) + (triggers(view) ? 1 : 0);
        } else {
          withBonus(patch, (view) => triggers(view) ? 1 : 0);
        }
        withBonus(patch, (view) => triggers(view) && !draconic ? -FEALTY_TOKEN_VALUE : 0);
        withAfter(patch, (view) => triggers(view)
          ? {
            ...(view.flag("lastAttackGoAgain") === 0 ? { actionPoints: 1 } : {}),
            flags: {
              veinWaiting: 0,
              lastAttackGoAgain: 1,
              ...(!draconic ? { fealty: view.flag("fealty") - 1 } : {}),
            },
          }
          : undefined);
      } else if (hasType(data, "action")) {
        withAfter(patch, () => CHAIN_CLOSED);
      }
      // Oath of Loyalty: afterwards only Draconic cards may be played this turn.
      if (!hasType(data, "weapon")) {
        const own = patch.canPlay;
        patch.canPlay = (view, self) =>
          (view.flag("onlyDraconic") === 0 || view.hasTrait(self, "draconic")) && (own ? own(view, self) : true);
      }
      return patch;
    },
    startActionPoints(observed, nextTurn) {
      // Go again on our open link arrives when it resolves.
      const link = nextTurn ? undefined : [...observed.view.chain].reverse().find((entry) => !entry.resolved);
      return link?.attackingCard.owner === observed.seat && link.goAgain === true ? 1 : 0;
    },
    equipment(data, card, context) {
      if (named(data) !== "braveforge bracers") return undefined;
      const ourTurn = context.input.view.activePlayer === context.input.seat;
      if (ourTurn && card.usedAbilityIndexes?.includes(0)) return undefined;
      return {
        kind: "equipment",
        speed: "action",
        cost: 1,
        goAgain: true,
        canPlay: (view) => view.flag("veinSwung") > 0,
        after: () => ({
          ...CHAIN_CLOSED,
          pending: [{ key: `bracers#${card.instanceId}`, uses: 1, power: 1, appliesTo: isWeapon }],
        }),
      };
    },
  };
}
