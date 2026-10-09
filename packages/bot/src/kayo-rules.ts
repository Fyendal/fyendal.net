import type { CardData } from "@fyendal/shared";
import { BLOCK_USE_RATE } from "./card-ev.js";
import type { HeroSolverRules, SolverCardPatch } from "./card-model.js";
import { averageOver, unseenCounts } from "./deck-knowledge.js";
import type { PendingEffect, SolverCard, SolverView } from "./hand-solver.js";
import { isAttack, type BotPolicyInput } from "./policy.js";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

/** Kayo's attack action cards get +1{p} outside the combat chain, so a
 * printed 5 counts as "6 or more" in pitch and discard. */
function kayoSixPlus(data: CardData | undefined): boolean {
  return isAttack(data) && (data?.attack ?? 0) + 1 >= 6;
}

function solverSixPlus(card: SolverCard): boolean {
  return card.kind === "attack" && card.power + 1 >= 6;
}

/** Chance a random discard after drawing one card hits a 6+ card: the held
 * cards other than the source, plus one draw from the remaining deck. */
function randomDiscardSixChance(view: SolverView, sourceId: number, deckSixShare: number): number {
  const others = view.held.filter((card) => card.instanceId !== sourceId);
  const six = others.filter(solverSixPlus).length;
  return (six + deckSixShare) / (others.length + 1);
}

function tokenEffects(input: BotPolicyInput, nextTurn: boolean): PendingEffect[] {
  const me = input.view.players[input.seat];
  const effects: PendingEffect[] = [];
  if (nextTurn) {
    me.board.forEach((token) => {
      const name = named(input.cards[token.cardId]);
      if (name === "agility") effects.push({ key: `agility#${token.instanceId}`, uses: 1, grantsGoAgain: true });
      if (name === "might") effects.push({ key: `might#${token.instanceId}`, uses: 1, power: 1 });
    });
    return effects;
  }
  input.view.ongoing.forEach((effect, index) => {
    if (effect.seat !== input.seat) return;
    if (/next attack.*go again/i.test(effect.label)) {
      effects.push({ key: `ongoing-agility.${index}`, uses: 1, grantsGoAgain: true });
    } else if (/\+1.*next attack|next attack.*\+1/i.test(effect.label)) {
      effects.push({ key: `ongoing-might.${index}`, uses: 1, power: 1 });
    }
  });
  return effects;
}

/** Hand-value rules for Kayo: pitch and discard 6+ conditions, Agility and
 * Might tokens, Vigor resources, Mandible Claw, and Predatory Plating. */
export function kayoSolverRules(input: BotPolicyInput): HeroSolverRules {
  const deck = unseenCounts(input, "own");
  const deckSixShare = deck
    ? averageOver(deck, (cardId) => kayoSixPlus(input.cards[cardId]) ? 1 : 0) ?? 0.6
    : 0.6;

  return {
    name: "kayo",
    trackedTraits: [],
    startFlags(observed, nextTurn): Record<string, number> {
      const me = observed.view.players[observed.seat];
      const pitchedSix = !nextTurn && me.pitch.some((card) => kayoSixPlus(observed.cards[card.cardId]));
      return pitchedSix ? { pitchedSix: 1 } : {};
    },
    startPending: tokenEffects,
    startResources(observed, nextTurn) {
      if (!nextTurn) return 0;
      const me = observed.view.players[observed.seat];
      return me.board.filter((token) => named(observed.cards[token.cardId]) === "vigor").length;
    },
    card(data, card) {
      const name = named(data);
      const patch: SolverCardPatch = {};
      if (kayoSixPlus(data)) patch.onPitch = () => ({ flags: { pitchedSix: 1 } });
      if (name === "bear hug") patch.canPlay = (view) => view.flag("pitchedSix") > 0;
      if (name === "run roughshod") patch.canPlay = (view) => view.flag("discardedSix") > 0;
      if (name === "buckwild") {
        patch.goAgainIn = (view) => view.flag("pitchedSix") > 0;
        patch.uses = { reliableGoAgain: true };
      }
      const power = card.attack ?? data.attack ?? 0;
      if (name === "rough up") patch.powerIn = (view) => power + (view.flag("pitchedSix") > 0 ? 1 : 0);
      if (name === "bluster buff") patch.powerIn = () => Math.max(0, power - 1);
      if (name === "wild ride" || name === "bare fangs" || name === "wrecker romp") {
        const chance = (view: SolverView) => randomDiscardSixChance(view, card.instanceId, deckSixShare);
        patch.after = (view) => chance(view) >= 0.5 ? { flags: { discardedSix: 1 } } : undefined;
        if (name === "wild ride") {
          patch.goAgainIn = (view) => chance(view) >= 0.5;
          patch.uses = { reliableGoAgain: deckSixShare >= 0.5 };
        }
        if (name === "bare fangs") {
          patch.powerIn = (view) => power + (chance(view) >= 0.5 ? 2 : 0);
        }
      }
      if (name === "mandible claw") patch.goAgainIn = (view) => view.flag("discardedSix") > 0;
      return patch;
    },
    equipment(data, card) {
      if (named(data) !== "predatory plating") return undefined;
      return {
        kind: "equipment",
        speed: "instant",
        cost: 0,
        consumeCost: Math.max(0, card.defense ?? data.defense ?? 0) * BLOCK_USE_RATE,
        canPlay: (view) => view.lastAttack !== undefined && view.lastAttack.power >= 6,
        after: () => ({ resources: 1 }),
      };
    },
  };
}
