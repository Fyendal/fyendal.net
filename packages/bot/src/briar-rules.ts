import type { CardData, CardView } from "@fyendal/shared";
import { expectedTopPitch } from "./card-ev.js";
import { combineEffects, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import type { PendingEffect, SolverCard, SolverView } from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

function runechantPending(prefix: string, count: number): PendingEffect[] {
  // Every Runechant fires on the next attack action card or weapon attack.
  return Array.from({ length: count }, (_, index) => ({
    key: `${prefix}.runechant.${index}`,
    uses: 1,
    power: 1,
  }));
}

function embodimentOfLightning(key: string): PendingEffect {
  return {
    key,
    uses: 1,
    grantsGoAgain: true,
    appliesTo: (card) => card.kind === "attack",
  };
}

/** Hand-value rules for Briar: Runechants, the second non-attack action
 * Embodiment of Lightning, Lightning Fusion, conditional go again, Star Fall,
 * Quick Succession and the Burn Up meld. */
export function briarSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const opponent = input.view.players[1 - input.seat]!;
  const arsenalIds = new Set(me.arsenal.map((card) => card.instanceId));
  const fusionIds = new Set([...me.hand, ...me.arsenal].filter((card) =>
    input.cards[card.cardId]?.keywords?.some((keyword) => keyword.toLowerCase() === "lightning fusion")
  ).map((card) => card.instanceId));
  const topPitch = expectedTopPitch(input);
  const canFuse = (view: SolverView, self: number) =>
    view.held.some((card) => card.instanceId !== self && view.hasTrait(card, "lightning"));
  const fused = (card: SolverCard, view: SolverView) =>
    fusionIds.has(card.instanceId) && canFuse(view, card.instanceId);

  const cardPatch = (data: CardData, card: CardView): SolverCardPatch => {
    const power = card.attack ?? data.attack ?? 0;
    switch (named(data)) {
      case "arcane seeds // life":
        return { after: () => ({ pending: runechantPending(`seeds#${card.instanceId}`, 2) }), uses: { pump: 2 } };
      case "burn up // shock":
        // Shock deals 1 now; Burn Up adds 4 arcane to the next hit.
        return {
          bonusIn: () => 1,
          after: () => ({ pending: [{ key: `burn#${card.instanceId}`, uses: 1, onHit: 4 }] }),
          uses: { pump: 1 + 4 * 0.6 },
        };
      case "lightning press":
        return {
          kind: "attack-reaction",
          reactionPower: 3,
          reactionTarget: (attack) => attack.kind === "attack" && attack.cost <= 1,
        };
      case "nimblism":
        return { after: (view) => ({ flags: { nimblismGrave: view.flag("nimblismGrave") + 1 } }) };
      case "jack be nimble":
        return {
          goAgainIn: (view) => view.flag("nimblismGrave") > 0,
          powerIn: (view) => power + (view.flag("nimblismGrave") > 0 ? 1 : 0),
          after: (view) => view.flag("nimblismGrave") > 0
            ? { flags: { nimblismGrave: view.flag("nimblismGrave") - 1 } }
            : undefined,
        };
      case "lightning surge":
        // Its arsenal use is exactly the case where it has go again.
        return { goAgainIn: () => arsenalIds.has(card.instanceId), uses: { reliableGoAgain: true } };
      case "path of same ends":
        return { goAgainIn: () => true, powerIn: () => power + 1, uses: { reliableGoAgain: true, power: power + 1 } };
      case "scar for a scar": {
        const behind = me.life < opponent.life;
        return { goAgainIn: () => behind, uses: { reliableGoAgain: behind } };
      }
      case "second strike":
        return {
          goAgainIn: (view) => view.flag("attacks") > 0,
          powerIn: (view) => power + (view.flag("attacks") > 0 ? 1 : 0),
        };
      case "entwine lightning":
        return { goAgainIn: (view) => canFuse(view, card.instanceId) };
      case "arcanic shockwave":
        return { powerIn: (view) => power + (canFuse(view, card.instanceId) ? 1 : 0) };
      case "weave lightning":
        return {
          replaceAfter: true,
          after: () => ({
            pending: [{
              key: `weave#${card.instanceId}`,
              uses: 1,
              power: 3,
              appliesTo: (target, view) => target.kind === "attack" &&
                (view.hasTrait(target, "lightning") || view.hasTrait(target, "elemental")),
              goAgainFor: fused,
            }],
          }),
        };
      case "quick succession": {
        const boosted = Number(data.pitch ?? 3) === 1 ? 3 : 1;
        return {
          replaceAfter: true,
          after: () => ({
            pending: [
              {
                key: `quick-ga#${card.instanceId}`,
                uses: 1,
                grantsGoAgain: true,
                appliesTo: (target, view) => target.kind === "attack" &&
                  (view.hasTrait(target, "runeblade") || view.hasTrait(target, "lightning")),
              },
              { key: `quick-pow#${card.instanceId}`, uses: boosted, power: 1, requiresGoAgain: true },
            ],
          }),
          uses: { pump: boosted, pumpRider: 2 },
        };
      }
      case "static shock":
        return { onHitIn: (view) => view.flag("played:lightning") > 0 ? 1 : 0 };
      case "ravenous rabble":
        return { powerIn: () => Math.max(0, power - topPitch), uses: { power: Math.max(0, power - topPitch) } };
      case "star fall":
        return {
          goAgainIn: (view) => view.flag("played:lightning") > 0,
          powerIn: (view) => power + (view.flag("played:lightning") > 0 ? 1 : 0),
        };
      default:
        return {};
    }
  };

  return {
    name: "briar",
    trackedTraits: ["lightning"],
    startFlags(observed): Record<string, number> {
      const graveyard = observed.view.players[observed.seat].graveyard;
      const nimblism = graveyard.filter((card) => named(observed.cards[card.cardId]) === "nimblism").length;
      return nimblism > 0 ? { nimblismGrave: nimblism } : {};
    },
    startPending(observed) {
      const board = observed.view.players[observed.seat].board;
      const runechants = board.filter((card) => named(observed.cards[card.cardId]) === "runechant").length;
      const embodiments = board.filter((card) => named(observed.cards[card.cardId]) === "embodiment of lightning");
      return [
        ...runechantPending("board", runechants),
        ...embodiments.map((card) => embodimentOfLightning(`embodiment#${card.instanceId}`)),
      ];
    },
    card(data, card) {
      const patch = cardPatch(data, card);
      if (data.cardType !== "action" || (data.subtypes ?? []).some((subtype) => subtype.toLowerCase() === "attack")) {
        return patch;
      }
      // Briar: the second 'non-attack' action card each turn creates an
      // Embodiment of Lightning for the next attack action card.
      const own = patch.after;
      return {
        ...patch,
        after: (view) => combineEffects(
          own?.(view),
          view.flag("kind:action") === 2
            ? { pending: [embodimentOfLightning(`briar-embodiment#${card.instanceId}`)] }
            : undefined,
        ),
      };
    },
  };
}
