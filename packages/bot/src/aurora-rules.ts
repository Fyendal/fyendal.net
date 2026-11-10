import type { CardData, CardView } from "@fyendal/shared";
import { BLOCK_USE_RATE } from "./card-ev.js";
import { combineEffects, type HeroSolverRules, type SolverCardPatch } from "./card-model.js";
import { embodimentOfLightning, lightningCardPatcher, runechantPending } from "./briar-rules.js";
import type { PendingEffect, SolverCard } from "./hand-solver.js";
import type { BotPolicyInput } from "./policy.js";

const named = (data: CardData | undefined): string => data?.name.trim().toLowerCase() ?? "";

const isLightning = (data: CardData): boolean =>
  data.subtypes?.some((subtype) => subtype.toLowerCase() === "lightning") === true;

const isActionCard = (card: SolverCard): boolean => card.kind === "attack" || card.kind === "action";

/** Arc Lightning's ping on every later go again, counted as a point of damage. */
function arcPing(key: string): PendingEffect {
  return { key, uses: Infinity, power: 1, requiresGoAgain: true };
}

function nextActionGoAgain(key: string): PendingEffect {
  return { key, uses: 1, scope: "card", grantsGoAgain: true, appliesTo: isActionCard };
}

/** Skyzyk and Rush of Power gain +1{p} while they have go again. */
const GO_AGAIN_POWER_BONUS: PendingEffect = {
  key: "aurora.go-again-power",
  uses: Infinity,
  power: 1,
  requiresGoAgain: true,
  appliesTo: (card) => {
    const name = card.name.trim().toLowerCase();
    return name === "skyzyk" || name === "rush of power";
  },
};

function activeArcLightnings(input: BotPolicyInput): { pings: number; grants: number } {
  let pings = 0;
  let grants = 0;
  for (const effect of input.view.ongoing) {
    if (effect.seat !== input.seat || named(input.cards[effect.cardId]) !== "arc lightning") continue;
    if (effect.facts?.goAgain) grants++;
    else pings++;
  }
  return { pings, grants };
}

/** Hand-value rules for Aurora: Arc Lightning power turns, Skyward Serenade,
 * Current Funnel, Flittering Charge, Scorpio and the Runechant arms. */
export function auroraSolverRules(input: BotPolicyInput): HeroSolverRules {
  const shared = lightningCardPatcher(input);

  const cardPatch = (data: CardData, card: CardView, averageDraw: number): SolverCardPatch => {
    const power = card.attack ?? data.attack ?? 0;
    switch (named(data)) {
      case "arc lightning":
        return {
          replaceAfter: true,
          after: (view) => ({
            flags: { arc: view.flag("arc") + 1 },
            pending: [
              nextActionGoAgain(`arc-next#${card.instanceId}`),
              arcPing(`arc-ping#${card.instanceId}`),
            ],
          }),
          uses: { pump: 3, pumpRider: 2 },
        };
      case "skyward serenade":
        // Embodiment and +1{p} are the usual pair; Skyzyk only when out of attacks.
        return {
          replaceAfter: true,
          after: () => ({
            pending: [
              embodimentOfLightning(`serenade-embodiment#${card.instanceId}`),
              { key: `serenade-power#${card.instanceId}`, uses: 1, power: 1 },
            ],
          }),
          uses: { pump: 1, pumpRider: 2 },
        };
      case "current funnel":
        return {
          goAgainIn: (view) => view.flag("lastLightning") > 0,
          after: (view) => view.flag("lastLightning") > 0
            ? { pending: [nextActionGoAgain(`funnel#${card.instanceId}`)] }
            : undefined,
        };
      case "flittering charge":
        return {
          goAgainIn: (view) => view.held.some((held) =>
            held.instanceId !== card.instanceId && (held.kind === "instant" || held.kind === "attack-reaction")
          ),
        };
      case "enlightened strike":
        // Go again while the hand can follow up, otherwise the +2{p} mode.
        return {
          goAgainIn: (view) => view.held.length >= 3,
          powerIn: (view) => power + (view.held.length >= 3 ? 0 : 2),
        };
      case "nimby":
        return { bonusIn: () => averageDraw };
      case "scorpio, comet tail":
        return { canPlay: (view) => view.flag("links:lightning") > 0 };
      default:
        return shared(data, card);
    }
  };

  return {
    name: "aurora",
    trackedTraits: ["lightning"],
    startFlags(observed, nextTurn): Record<string, number> {
      const graveyard = observed.view.players[observed.seat].graveyard;
      const nimblism = graveyard.filter((card) => named(observed.cards[card.cardId]) === "nimblism").length;
      const arc = nextTurn ? 0 : activeArcLightnings(observed).pings;
      return {
        ...(nimblism > 0 ? { nimblismGrave: nimblism } : {}),
        ...(arc > 0 ? { arc } : {}),
      };
    },
    startPending(observed, nextTurn) {
      const board = observed.view.players[observed.seat].board;
      const runechants = board.filter((card) => named(observed.cards[card.cardId]) === "runechant").length;
      const embodiments = board.filter((card) => named(observed.cards[card.cardId]) === "embodiment of lightning");
      const arc = nextTurn ? { pings: 0, grants: 0 } : activeArcLightnings(observed);
      return [
        GO_AGAIN_POWER_BONUS,
        ...runechantPending("board", runechants),
        ...embodiments.map((token) => embodimentOfLightning(`embodiment#${token.instanceId}`)),
        ...Array.from({ length: arc.pings }, (_, index) => arcPing(`arc-ping.board.${index}`)),
        ...Array.from({ length: arc.grants }, (_, index) => nextActionGoAgain(`arc-next.board.${index}`)),
      ];
    },
    card(data, card, context) {
      const patch = cardPatch(data, card, context.averageDraw);
      if (data.cardType !== "action") return patch;
      const attack = data.subtypes?.some((subtype) => subtype.toLowerCase() === "attack") === true;
      const staticGoAgain = data.keywords?.some((keyword) => keyword.toLowerCase() === "go again") === true;
      const own = patch.after;
      const ownBonus = patch.bonusIn;
      return {
        ...patch,
        // Arc Lightning pings non-attack go again too; attacks get it as power.
        ...(!attack && staticGoAgain
          ? { bonusIn: (view) => (ownBonus?.(view) ?? 0) + view.flag("arc") }
          : {}),
        // Current Funnel reads whether the last action card was Lightning.
        after: (view) => combineEffects(
          own?.(view),
          { flags: { lastLightning: isLightning(data) ? 1 : 0 } },
        ),
      };
    },
    equipment(data, card) {
      switch (named(data)) {
        case "grasp of the arknight":
          return {
            kind: "equipment",
            speed: "action",
            cost: 2,
            goAgain: true,
            after: () => ({ pending: runechantPending(`grasp#${card.instanceId}`, 1) }),
          };
        case "vexing quillhand":
          return {
            kind: "equipment",
            speed: "action",
            cost: 0,
            goAgain: true,
            // Its value is the Arcane Barrier it gives up.
            consumeCost: BLOCK_USE_RATE,
            after: () => ({ pending: runechantPending(`quillhand#${card.instanceId}`, 2) }),
          };
        default:
          return undefined;
      }
    },
  };
}
