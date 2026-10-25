import type { CardData, CardView } from "@fyendal/shared";
import { BLOCK_USE_RATE, DEFAULT_HIT_CHANCE } from "./card-ev.js";
import { abilitySource, type HeroSolverRules, type ModelContext, type SolverCardPatch } from "./card-model.js";
import type { SolverCard, SolverEffect, SolverView } from "./hand-solver.js";
import { functionalKey as key, isAttack, type BotPolicyInput } from "./policy.js";

/** Damage equivalents of effects that pay off on later turns. */
export const SOUL_VALUE = 0.75;
export const COURAGE_TOKEN_VALUE = 1;
export const QUICKEN_TOKEN_VALUE = 2;
export const FLURRY_TOKEN_VALUE = 3;
export const PONDER_TOKEN_VALUE = 3;
export const SPIRIT_OF_EIRINA_VALUE = 3;
/** A Tunic energy counter: a third of the resource that funds V of the Vanguard. */
export const TUNIC_COUNTER_VALUE = 0.4;
/** An uncracked Energy Potion: two resources at the Tunic's rate. */
export const ENERGY_POTION_VALUE = 6 * TUNIC_COUNTER_VALUE;
/** A drawn card, matching the on-hit draw value in value.ts. */
export const CARD_DRAW_VALUE = 3;
/** Beacon of Victory's search: a chosen power card in hand. */
export const BEACON_SEARCH_VALUE = 4;
/** Share of this deck that is Light, for Lumina's weapon-hit reveal. */
const LIGHT_SHARE = 0.9;
/** Hero ability uses modelled per turn; the soul bounds the real count. */
const HERO_ABILITY_USES = 8;

export const RAYDN = "raydn, duskbane|0";
export const V_OF_THE_VANGUARD = "v of the vanguard|2";
export const LUMINA_ASCENSION = "lumina ascension|2";
export const BEACON_OF_VICTORY = "beacon of victory|2";
export const SPIRIT_OF_EIRINA = "spirit of eirina|2";
export const CELESTIAL_CATACLYSM = "celestial cataclysm|2";
export const BATTLEFIELD_BEACON = "battlefield beacon|2";
export const ROARING_BEAM = "roaring beam|2";
export const COURAGEOUS_STEELHAND = "courageous steelhand|1";
export const BLESSING_OF_BELLONA = "blessing of bellona|2";
export const BLESSING_OF_SURAYA = "blessing of suraya|2";
export const BOLTING_BLADE = "bolting blade|2";
export const BANNERET_OF_SWORDSMANSHIP = "banneret of swordsmanship|2";
export const EDICT_OF_STEEL = "edict of steel|1";
export const TENACITY = "tenacity|2";
export const ENERGY_POTION = "energy potion|3";
export const SAVING_GRACE = "saving grace|2";
export const SOUL_SHIELD = "soul shield|2";
export const FYENDALS_SPRING_TUNIC = "fyendal's spring tunic|0";
export const IRONSONG_VERSUS = "ironsong versus|0";
export const WARBAND_OF_BELLONA = "warband of bellona|0";
export const SNAPDRAGON_SCALERS = "snapdragon scalers|0";
export const SOLFORGE_GAUNTLET = "solforge gauntlet|0";
export const KABUTO = "kabuto of imperial authority|0";
export const CIRCLET = "circlet of eternal end|0";
export const HELM_OF_HALOS_GRACE = "helm of halo's grace|0";
export const SOULBOND_RESOLVE = "soulbond resolve|0";
export const WARPATH_OF_WINGED_GRACE = "warpath of winged grace|0";

/** Attack actions with "you may charge your hero's soul" as an additional cost. */
const CHARGE_ATTACKS = new Set([
  "beaming bravado|1", "beaming bravado|2",
  "bolt of courage|1", "bolt of courage|2",
  "engulfing light|1", "engulfing light|2",
  "spirit of war|1",
  "bravery of the blade|1",
]);

export function isChargeAttack(data: CardData | undefined): boolean {
  return CHARGE_ATTACKS.has(key(data));
}

export function named(data: CardData | undefined): string {
  return data?.name.trim().toLowerCase() ?? "";
}

export function hasSubtype(data: CardData | undefined, subtype: string): boolean {
  return data?.subtypes?.some((value) => value.toLowerCase() === subtype) === true;
}

export function isLight(data: CardData | undefined): boolean {
  return hasSubtype(data, "light");
}

export function isYellow(data: CardData | undefined): boolean {
  return Number(data?.pitch ?? 0) === 2;
}

export function boardCount(input: BotPolicyInput, name: string): number {
  return input.view.players[input.seat].board.filter((card) => named(input.cards[card.cardId]) === name).length;
}

export function soulLeft(view: SolverView): number {
  return view.flag("soul") + view.flag("charges") - view.flag("soulSpent");
}

function charged(view: SolverView): boolean {
  return view.flag("charges") > 0;
}

/** Play value of setup cards whose worth is not their printed power. */
const PLAY_VALUE: Readonly<Record<string, number>> = {
  [V_OF_THE_VANGUARD]: 9,
  [LUMINA_ASCENSION]: 6,
  [BEACON_OF_VICTORY]: 4,
  [SPIRIT_OF_EIRINA]: SPIRIT_OF_EIRINA_VALUE,
  [CELESTIAL_CATACLYSM]: 6,
  [BLESSING_OF_SURAYA]: SOUL_VALUE + PONDER_TOKEN_VALUE,
  [BLESSING_OF_BELLONA]: SOUL_VALUE + COURAGE_TOKEN_VALUE,
  [EDICT_OF_STEEL]: 3,
  [ROARING_BEAM]: 2,
};

/** What a turn gives up by charging a hand card instead of playing or keeping it. */
export function solverChargeCost(card: SolverCard): number {
  // Spirit of Eirina enters the arena when charged, so it costs nothing.
  if (`${card.name.toLowerCase()}|${card.pitch}` === SPIRIT_OF_EIRINA) return 0;
  const explicit = PLAY_VALUE[`${card.name.toLowerCase()}|${card.pitch}`];
  const offense = card.kind === "attack"
    ? (card.power + card.onHit * DEFAULT_HIT_CHANCE) * 0.6
    : card.kind === "attack-reaction"
    ? (card.reactionPower ?? 0) * 0.6
    : 0;
  return Math.max(explicit ?? 0, offense, card.heldValue);
}

/** Hand cards other than `selfId`, cheapest charge first, yellow on ties.
 * Yellow leads while a held Duty Bound Blitz still waits on one: a cheaper
 * red charge would strand every Blitz. */
export function chargeCandidates(view: SolverView, selfId: number): SolverCard[] {
  const candidates = view.held
    .filter((card) => card.zone === "hand" && card.instanceId !== selfId && !isCharged(view, card.instanceId));
  const yellowFirst = view.flag("soulYellow") === 0 && view.held.some((card) =>
    card.instanceId !== selfId && !isCharged(view, card.instanceId) &&
    card.name.toLowerCase() === "duty bound blitz"
  );
  const yellow = (card: SolverCard) => card.pitch === 2 ? 1 : 0;
  return candidates.sort((left, right) =>
    (yellowFirst ? yellow(right) - yellow(left) : 0) ||
    solverChargeCost(left) - solverChargeCost(right) ||
    yellow(right) - yellow(left) ||
    left.instanceId - right.instanceId
  );
}

/** Charged cards stay in the solver's hand, so a flag keeps them out of the line. */
function isCharged(view: SolverView, instanceId: number): boolean {
  return view.flag(`charged:${instanceId}`) > 0;
}

function chargeTarget(view: SolverView, selfId: number): SolverCard | undefined {
  return chargeCandidates(view, selfId)[0];
}

/** Record charged cards; Blessing of Bellona adds a Courage token per card. */
function recordCharges(view: SolverView, flags: Record<string, number>, targets: readonly SolverCard[]): void {
  if (targets.length === 0) return;
  flags.charges = view.flag("charges") + targets.length;
  for (const target of targets) {
    flags[`charged:${target.instanceId}`] = 1;
    if (`${target.name.toLowerCase()}|${target.pitch}` === SPIRIT_OF_EIRINA) flags.spirit = 1;
  }
  if (targets.some((target) => target.pitch === 2)) flags.soulYellow = 1;
  if (view.flag("bellona") > 0) flags.courage = (flags.courage ?? view.flag("courage")) + targets.length;
}

/** Soul gained (plus Suraya's Ponder) minus what the charged cards were worth. */
function chargeBonus(view: SolverView, targets: readonly SolverCard[]): number {
  return targets.reduce((total, target) =>
    total + SOUL_VALUE - solverChargeCost(target) + (view.flag("suraya") > 0 ? PONDER_TOKEN_VALUE : 0) +
    (`${target.name.toLowerCase()}|${target.pitch}` === SPIRIT_OF_EIRINA && view.flag("spirit") === 0
      ? SPIRIT_OF_EIRINA_VALUE
      : 0), 0);
}

interface AttackContext {
  readonly raydnId: number | undefined;
}

/** Token consumption and the pumped flag the hero ability checks. */
function attackAfter(
  view: SolverView,
  selfId: number,
  pumped: boolean,
  extra?: (flags: Record<string, number>) => void,
): SolverEffect {
  const flags: Record<string, number> = {};
  const courageUsed = view.flag("courage") > 0;
  if (courageUsed) flags.courage = view.flag("courage") - 1;
  if (view.flag("quicken") > 0) flags.quicken = view.flag("quicken") - 1;
  if (view.flag("warbandCharge") > 0) {
    flags.warbandCharge = 0;
    const target = chargeTarget(view, selfId);
    if (target) recordCharges(view, flags, [target]);
  }
  flags.lastAttackPumped = pumped || courageUsed || view.flag("vBuff") > 0 ? 1 : 0;
  extra?.(flags);
  return { flags };
}

/** Attack sources left after this card: held attacks and an unused Raydn. */
function remainingAttackSources(view: SolverView, selfId: number, context: AttackContext): number {
  const held = view.held.filter((card) => card.instanceId !== selfId && card.kind === "attack").length;
  const raydn = context.raydnId !== undefined && view.flag("raydnSwung") === 0 ? 1 : 0;
  return held + raydn;
}

/** Light hand cards whose charge cost is below the +1 per remaining link. */
function vCharges(view: SolverView, selfId: number, context: AttackContext): SolverCard[] {
  const chosen: SolverCard[] = [];
  for (const candidate of chargeCandidates(view, selfId)) {
    if (!candidate.traits.includes("light")) continue;
    const chosenAttacks = chosen.filter((card) => card.kind === "attack").length;
    const sources = remainingAttackSources(view, selfId, context) - chosenAttacks -
      (candidate.kind === "attack" ? 1 : 0);
    // Every link after V needs go again: a soul card, a charge, or a Quicken.
    const goAgainFuel = soulLeft(view) + chosen.length + 1 + view.flag("quicken");
    const attacksLeft = 1 + Math.max(0, Math.min(sources, goAgainFuel));
    if (attacksLeft > solverChargeCost(candidate)) chosen.push(candidate);
  }
  return chosen;
}

/** Hand-value rules for Ser Boltyn. */
export function boltynSolverRules(input: BotPolicyInput): HeroSolverRules {
  const me = input.view.players[input.seat];
  const raydn = me.weapons.find((weapon) => key(input.cards[weapon.cardId]) === RAYDN);
  const context: AttackContext = { raydnId: raydn?.instanceId };
  const spiritInArena = boardCount(input, "spirit of eirina") > 0;
  const facts = input.view.turnFacts?.players[input.seat];
  const ourTurn = input.view.activePlayer === input.seat;
  const defendersOnChain = input.view.chain.reduce((count, link) =>
    link.attackingCard.owner === input.seat ? count + link.defendingCards.length : count, 0);

  return {
    name: "boltyn",
    trackedTraits: [],
    startFlags(observed, nextTurn): Record<string, number> {
      const player = observed.view.players[observed.seat];
      const board = (name: string) => boardCount(observed, name);
      const blessings = board("blessing of bellona") + board("blessing of suraya");
      const ongoing = observed.view.ongoing.filter((effect) => effect.seat === observed.seat);
      const vBuff = nextTurn ? 0 : ongoing.reduce((total, effect) =>
        key(observed.cards[effect.cardId]) === V_OF_THE_VANGUARD ? total + (effect.facts?.power ?? 1) : total, 0);
      const current = observed.view.turnFacts?.players[observed.seat];
      return {
        soul: player.soul.length + (nextTurn ? blessings : 0),
        charges: nextTurn ? 0 : current?.chargesThisTurn ?? 0,
        soulYellow: nextTurn ? (blessings > 0 ? 1 : 0) : current?.yellowSoulThisTurn ? 1 : 0,
        soulBanishedChain: nextTurn ? 0 : current?.soulBanishedThisChain ?? 0,
        // Blessing of Bellona sees itself enter the soul at the start of the turn.
        courage: board("courage") + (nextTurn ? board("blessing of bellona") : 0),
        quicken: board("quicken"),
        flurry: board("flurry"),
        spirit: board("spirit of eirina") > 0 ? 1 : 0,
        bellona: nextTurn ? 0 : board("blessing of bellona") > 0 ? 1 : 0,
        suraya: nextTurn ? 0 : board("blessing of suraya") > 0 ? 1 : 0,
        lumina: !nextTurn && ongoing.some((effect) => key(observed.cards[effect.cardId]) === LUMINA_ASCENSION) ? 1 : 0,
        ironsong: !nextTurn && ongoing.some((effect) => key(observed.cards[effect.cardId]) === IRONSONG_VERSUS) ? 1 : 0,
        vBuff,
        raydnSwung: nextTurn ? 0 : (current?.weaponAttacks ?? 0) > 0 ? 1 : 0,
        [`extraUse:${player.heroInstanceId}`]: HERO_ABILITY_USES - 1,
      };
    },
    card(data, card) {
      const patch = cardPatch(data, card);
      const own = patch.canPlay;
      return {
        ...patch,
        canPlay: (view, self) => !isCharged(view, self.instanceId) && (own ? own(view, self) : true),
      };
    },
    equipment: equipmentPatch,
    abilities: heroAbilities,
  };

  function cardPatch(data: CardData, card: CardView): SolverCardPatch {
      const functional = key(data);
      // `card.attack` includes Sharpen counters, which exceed Raydn's base power.
      const power = card.attack ?? data.attack ?? 0;
      const patch: SolverCardPatch = {};
      const self = card.instanceId;

      if (functional === RAYDN) {
        patch.powerIn = (view) => power + (charged(view) ? 3 : 0) + (view.flag("lumina") > 0 ? 1 : 0) +
          (view.flag("courage") > 0 ? 1 : 0);
        patch.goAgainIn = (view) => view.flag("quicken") > 0;
        patch.onHitIn = (view) => (view.flag("lumina") > 0 ? LIGHT_SHARE * (SOUL_VALUE + 1) : 0) +
          (view.flag("ironsong") > 0 ? COURAGE_TOKEN_VALUE : 0);
        const pumped = (view: SolverView) => charged(view) || view.flag("lumina") > 0 || power > 0;
        patch.after = (view) => attackAfter(view, self, pumped(view), (flags) => {
          flags.raydnSwung = 1;
          flags.ironsong = 0;
          if (view.flag("flurry") > 0) {
            flags.flurry = view.flag("flurry") - 1;
            flags[`extraUse:${self}`] = view.flag(`extraUse:${self}`) + 1;
          }
        });
        return patch;
      }

      if (isChargeAttack(data)) {
        const willCharge = (view: SolverView) => charged(view) || chargeTarget(view, self) !== undefined;
        const yellowCharge = (view: SolverView) => chargeTarget(view, self)?.pitch === 2;
        let bonus: ((view: SolverView) => number) | undefined;
        switch (named(data)) {
          case "beaming bravado":
            patch.powerIn = (view) => power + (yellowCharge(view) ? 1 : 0);
            break;
          case "bolt of courage":
            patch.onHitIn = (view) => willCharge(view) ? CARD_DRAW_VALUE : 0;
            break;
          case "engulfing light":
            patch.onHitIn = (view) => willCharge(view) ? SOUL_VALUE : 0;
            break;
          case "spirit of war":
            bonus = (view) => yellowCharge(view)
              ? remainingAttackSources(view, self, context) * DEFAULT_HIT_CHANCE * COURAGE_TOKEN_VALUE
              : 0;
            break;
          case "bravery of the blade":
            patch.goAgainIn = willCharge;
            patch.onHitIn = (view) => willCharge(view) ? COURAGE_TOKEN_VALUE : 0;
            patch.uses = { reliableGoAgain: me.hand.length >= 2 || (facts?.chargesThisTurn ?? 0) > 0 };
            break;
          default:
            break;
        }
        patch.bonusIn = (view) => {
          const target = chargeTarget(view, self);
          return (bonus?.(view) ?? 0) + (target ? chargeBonus(view, [target]) : 0);
        };
        const pumped = (view: SolverView) => named(data) === "beaming bravado" && yellowCharge(view);
        patch.after = (view) => attackAfter(view, self, pumped(view), (flags) => {
          const target = chargeTarget(view, self);
          if (target) recordCharges(view, flags, [target]);
        });
        return patch;
      }

      switch (functional) {
        case V_OF_THE_VANGUARD:
          patch.powerIn = (view) => power + vCharges(view, self, context).length + view.flag("vBuff");
          patch.bonusIn = (view) => chargeBonus(view, vCharges(view, self, context));
          patch.replaceAfter = true;
          patch.after = (view) => {
            const chosen = vCharges(view, self, context);
            const effect = attackAfter(view, self, chosen.length > 0, (flags) => {
              recordCharges(view, flags, chosen);
              if (chosen.length > 0) flags.vBuff = view.flag("vBuff") + chosen.length;
            });
            return {
              ...effect,
              // Charged cards are priced away through the charge cost.
              pending: chosen.length > 0
                ? [{ key: `v#${self}`, uses: Number.POSITIVE_INFINITY, power: chosen.length, scope: "attack" }]
                : [],
            };
          };
          return patch;
        case LUMINA_ASCENSION:
          if (spiritInArena) patch.kind = "instant";
          // The policy plays an action Lumina only once charged.
          else patch.canPlay = charged;
          patch.uses = { pump: 5 };
          patch.replaceAfter = true;
          patch.after = (view) => ({
            // Played as an instant its go again still grants the action point.
            ...(spiritInArena ? { actionPoints: 1 } : {}),
            flags: {
              lumina: 1,
              ...(charged(view) && context.raydnId !== undefined
                ? { [`extraUse:${context.raydnId}`]: view.flag(`extraUse:${context.raydnId}`) + 1 }
                : {}),
            },
          });
          return patch;
        case CELESTIAL_CATACLYSM:
          patch.canPlay = (view) => soulLeft(view) >= 3;
          patch.bonusIn = () => -3 * SOUL_VALUE;
          // Without three soul cards it is a three-block, not a seven.
          if (me.soul.length + boardCount(input, "blessing of bellona") + boardCount(input, "blessing of suraya") < 3) {
            patch.uses = { power: 0, finisher: false };
          }
          patch.after = (view) => attackAfter(view, self, false, (flags) => {
            flags.soulSpent = view.flag("soulSpent") + 3;
            flags.soulBanishedChain = view.flag("soulBanishedChain") + 3;
          });
          return patch;
        case BATTLEFIELD_BEACON:
          patch.bonusIn = (view) => Math.min(9, view.flag("soulBanishedChain")) * COURAGE_TOKEN_VALUE;
          patch.after = (view) => attackAfter(view, self, false);
          return patch;
        case BOLTING_BLADE:
          patch.costIn = (view) => Math.max(0, (data.cost ?? 4) - 2 * view.flag("charges"));
          patch.after = (view) => attackAfter(view, self, false);
          return patch;
        case TENACITY:
          patch.powerIn = () => power + defendersOnChain;
          patch.after = (view) => attackAfter(view, self, defendersOnChain > 0);
          return patch;
        case BEACON_OF_VICTORY:
          patch.reactionPower = 1;
          // The policy holds it until a charge enables the search.
          patch.canPlay = (view) => charged(view) && soulLeft(view) >= 1;
          patch.bonusIn = () => BEACON_SEARCH_VALUE;
          patch.after = (view) => ({
            flags: {
              soulSpent: view.flag("soulSpent") + 1,
              soulBanishedChain: view.flag("soulBanishedChain") + 1,
              lastAttackPumped: 1,
            },
          });
          patch.uses = { pump: 1, pumpRider: BEACON_SEARCH_VALUE * DEFAULT_HIT_CHANCE };
          return patch;
        case ROARING_BEAM:
          patch.reactionPower = 0;
          patch.bonusIn = (view) => COURAGE_TOKEN_VALUE + (soulLeft(view) === 0 ? SOUL_VALUE : 0);
          patch.after = (view) => ({ flags: { courage: view.flag("courage") + 1 } });
          patch.uses = { pump: COURAGE_TOKEN_VALUE };
          return patch;
        case COURAGEOUS_STEELHAND:
          patch.reactionPower = 3;
          patch.canPlay = charged;
          patch.after = () => ({ flags: { lastAttackPumped: 1 } });
          return patch;
        case EDICT_OF_STEEL:
          patch.canPlay = () => context.raydnId !== undefined;
          patch.after = (view) => ({ flags: { sharpen: view.flag("sharpen") + 1, flurry: view.flag("flurry") + 1 } });
          return patch;
        case BLESSING_OF_BELLONA:
          patch.bonusIn = () => SOUL_VALUE + COURAGE_TOKEN_VALUE;
          patch.after = () => ({ flags: { bellona: 1 } });
          return patch;
        case BLESSING_OF_SURAYA:
          patch.bonusIn = () => SOUL_VALUE + PONDER_TOKEN_VALUE;
          patch.after = () => ({ flags: { suraya: 1 } });
          return patch;
        case SPIRIT_OF_EIRINA:
          // Charged from hand it enters the arena for free; from arsenal it costs the action point.
          patch.uses = { handOnly: true };
          patch.bonusIn = (view) => view.flag("spirit") > 0 ? 0 : SPIRIT_OF_EIRINA_VALUE;
          patch.after = () => ({ flags: { spirit: 1 } });
          return patch;
        case ENERGY_POTION:
          patch.after = () => ({ resources: 2 });
          return patch;
        case "duty bound blitz|1":
        case "duty bound blitz|2":
          patch.canPlay = (view) => view.flag("soulYellow") > 0;
          patch.after = (view) => attackAfter(view, self, false);
          return patch;
        default:
          break;
      }
      if (isAttack(data)) patch.after = (view) => attackAfter(view, self, false);
      return patch;
  }

  function equipmentPatch(data: CardData, card: CardView): SolverCardPatch | undefined {
      const defense = Math.max(0, card.defense ?? data.defense ?? 0);
      switch (key(data)) {
        case FYENDALS_SPRING_TUNIC: {
          // The start-of-turn trigger adds a counter before the next action phase.
          const counters = Number(card.counters?.energy ?? 0) + (ourTurn ? 0 : 1);
          if (counters < 3) return undefined;
          return { kind: "equipment", speed: "instant", cost: 0, after: () => ({ resources: 1 }) };
        }
        case IRONSONG_VERSUS:
          if (card.usedAbilityIndexes?.includes(0)) return undefined;
          return {
            kind: "equipment",
            speed: "action",
            cost: 1,
            goAgain: true,
            canPlay: (view) => context.raydnId !== undefined && view.flag("raydnSwung") === 0 &&
              view.flag("ironsong") === 0,
            after: () => ({ flags: { ironsong: 1 } }),
          };
        case WARBAND_OF_BELLONA:
          return {
            kind: "equipment",
            speed: "action",
            cost: 2,
            goAgain: true,
            consumeCost: defense * BLOCK_USE_RATE,
            canPlay: (view) => view.flag("charges") === 0 && view.flag("warbandCharge") === 0 &&
              view.held.some((held) => held.zone === "hand"),
            after: () => ({ flags: { warbandCharge: 1 } }),
          };
        case SNAPDRAGON_SCALERS:
          return {
            kind: "equipment",
            speed: "instant",
            cost: 0,
            canPlay: (view) => view.lastAttack !== undefined && view.lastAttack.kind === "attack" &&
              view.lastAttack.cost <= 1 && view.flag("lastAttackGoAgain") === 0,
            after: () => ({ actionPoints: 1, flags: { lastAttackGoAgain: 1 } }),
          };
        default:
          return undefined;
      }
  }

  function heroAbilities(modelContext: ModelContext): readonly SolverCard[] {
      const player = modelContext.input.view.players[modelContext.input.seat];
      return [abilitySource({
        instanceId: player.heroInstanceId,
        cardId: player.heroCardId,
        name: "Ser Boltyn, Breaker of Dawn",
        cost: 0,
        speed: "instant",
        // Attack Reaction - banish a soul card: a pumped attack gains go again.
        canPlay: (view) => view.lastAttack !== undefined && view.flag("lastAttackPumped") > 0 &&
          view.flag("lastAttackGoAgain") === 0 && soulLeft(view) > 0,
        after: (view) => ({
          actionPoints: 1,
          flags: { lastAttackGoAgain: 1, soulSpent: view.flag("soulSpent") + 1 },
        }),
      })];
  }
}

/** Later-turn value is uncertain and credited at this share. */
export const POSITION_DISCOUNT = 0.6;

/** Discounted board value the planner credits at the end of a line.
 * `offenseRate` is the planner's response weighting for a later swing. */
export function boltynPositionValue(input: BotPolicyInput, offenseRate = 1): number {
  const me = input.view.players[input.seat];
  const board = (name: string) => boardCount(input, name);
  const tunicCounters = Number(me.equipment.chest?.counters?.energy ?? 0);
  return POSITION_DISCOUNT * (me.soul.length * SOUL_VALUE +
    tunicCounters * TUNIC_COUNTER_VALUE +
    board("energy potion") * ENERGY_POTION_VALUE +
    board("courage") * COURAGE_TOKEN_VALUE +
    board("quicken") * QUICKEN_TOKEN_VALUE +
    // One weapon attack destroys every Flurry for a single extra swing.
    (board("flurry") > 0 ? FLURRY_TOKEN_VALUE * offenseRate : 0) +
    board("ponder") * PONDER_TOKEN_VALUE +
    (board("spirit of eirina") > 0 ? SPIRIT_OF_EIRINA_VALUE : 0) +
    board("blessing of bellona") * (SOUL_VALUE + COURAGE_TOKEN_VALUE) +
    board("blessing of suraya") * (SOUL_VALUE + PONDER_TOKEN_VALUE));
}

/** Opportunity cost of charging a hand card, for prompt scoring. */
export function cardChargeCost(
  card: CardView,
  input: BotPolicyInput,
  opportunity: (card: CardView, input: BotPolicyInput) => number,
): number {
  const data = input.cards[card.cardId];
  if (key(data) === SPIRIT_OF_EIRINA) return 0;
  const explicit = PLAY_VALUE[key(data)];
  const offense = isAttack(data) ? (card.attack ?? data?.attack ?? 0) * 0.6 : 0;
  return Math.max(explicit ?? 0, offense, opportunity(card, input));
}
