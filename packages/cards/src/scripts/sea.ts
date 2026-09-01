import type { CardInstance, CardScript, DeepReadonly, Modifier, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, nextAttack, opponentSeat, requestDiscardChoice, resolveDiscardChoice } from "./shared-helpers.js";

const GOLD = "SGB035";
const GOLDEN_COG = "SEA042";
const GOLDFIN_HARPOON = "SEA093";
const GOLDKISS_RUM = "SEA245";

type Card = DeepReadonly<CardInstance>;
type NextAttackMod = Omit<Modifier, "id" | "sourceInstanceId" | "scope" | "defense" | "seat">;

function data(ctx: ScriptCtx, card: Card | string) {
  return ctx.cardData(typeof card === "string" ? card : card.cardId);
}

function hasTag(ctx: ScriptCtx, card: Card | string, tag: string): boolean {
  const wanted = tag.toLowerCase();
  if (typeof card !== "string") return ctx.cardTypes(card).includes(wanted);
  const d = data(ctx, card);
  return [...(d.classes ?? []), ...(d.subtypes ?? [])].some((value) => value.toLowerCase() === wanted);
}

function named(ctx: ScriptCtx, card: Card | string, name: string): boolean {
  return typeof card === "string"
    ? data(ctx, card).name.trim().toLowerCase() === name.toLowerCase()
    : ctx.cardNames(card).includes(name.toLowerCase());
}

function isCog(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "cog"); }
function isItem(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "item"); }
function isAlly(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "ally"); }
function isArrow(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "arrow"); }
function isPirate(ctx: ScriptCtx, card: Card): boolean { return hasTag(ctx, card, "pirate"); }

function isThief(ctx: ScriptCtx, seat = ctx.seat): boolean {
  return hasTag(ctx, ctx.player(seat).hero, "thief");
}

function highTide(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).pitch.filter((card) => ctx.cardColor(card) === 3).length >= 2;
}

function controlledGold(ctx: ScriptCtx, seat = ctx.seat): Card[] {
  const player = ctx.player(seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ].filter((card) => named(ctx, card, "Gold"));
}

function controlledCogs(ctx: ScriptCtx, tapped?: boolean): Card[] {
  return ctx.player(ctx.seat).board.filter((card) =>
    isCog(ctx, card) && (tapped === undefined || (card.tapped === true) === tapped));
}

function createGold(ctx: ScriptCtx, count = 1): void {
  ctx.createTokens(GOLD, count);
}

function createGoldenCog(ctx: ScriptCtx): void {
  ctx.createToken(GOLDEN_COG);
}

function attackAbilityForAlly(cost: number, goAgain = false): CardScript {
  return { activated: attackAbility(cost, { tap: true, goAgain, oncePerTurn: false }) };
}

function maintenanceCog(steam: number): CardScript {
  return {
    onEnterArena(ctx) { ctx.setCounter("steam", steam); },
    triggers: [{
      event: "start-of-turn",
      label: "Remove a steam counter or destroy this",
      effect(ctx) {
        if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
        else ctx.setCounter("steam", ctx.getCounter("steam") - 1);
      },
    }],
  };
}

function tapChoice(ctx: ScriptCtx, hook: string, prompt: string, cards: readonly Card[]): void {
  if (cards.length) ctx.requestCardChoice(hook, prompt, ["pass", ...cards.map((card) => card.instanceId)]);
}

function nextAllyAttack(
  flag: string,
  mod: NextAttackMod,
  onHit: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { appliesToSubtype: "ally", appliesToClass: "pirate", ...mod });
      ctx.addModifier({ scope: "until-end-of-turn" });
      ctx.setFlag("player", flag, (Number(ctx.getFlag("player", flag)) || 0) + 1);
    },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.link || !isAlly(ctx, ctx.link.attackingCard) || !isPirate(ctx, ctx.link.attackingCard)) return;
      const count = Number(ctx.getFlag("player", flag)) || 0;
      if (count <= 0) return;
      ctx.setFlag("player", flag, count - 1);
      ctx.setFlag("link", flag, (Number(ctx.getFlag("link", flag)) || 0) + 1);
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" && !modifier.consumed);
      if (marker) ctx.consumeModifier(marker.id);
    },
    canTriggerOnHit(ctx) {
      return (Number(ctx.getFlag("link", flag)) || 0) > 0 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const count = Number(ctx.getFlag("link", flag)) || 0;
      ctx.setFlag("link", flag, 0);
      for (let i = 0; i < count; i++) onHit(ctx);
    },
  };
}

function discardOrMill(
  hook: string,
  apply: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    onAttackDeclared(ctx) {
      const player = ctx.player(ctx.seat);
      const options: (number | string)[] = [
        "pass",
        ...player.hand.map((card) => card.instanceId),
        ...(player.deck.length ? ["deck-top"] : []),
      ];
      if (options.length > 1) ctx.requestCardChoice(hook, `${ctx.data.name}: discard a card or destroy the top card of your deck?`, options);
    },
    onChoose(ctx, choiceHook, option) {
      if (choiceHook !== hook || option === "pass") return;
      const chosen = option === "deck-top"
        ? ctx.player(ctx.seat).deck[0]
        : ctx.player(ctx.seat).hand.find((card) => card.instanceId === Number(option));
      if (!chosen) return;
      const watery = (data(ctx, chosen).keywords ?? []).some((keyword) => keyword.toLowerCase() === "watery grave");
      if (option === "deck-top") {
        ctx.logPublic(`${ctx.data.name} destroys ${data(ctx, chosen).name} from the top of the deck`);
        ctx.moveToGraveyard(chosen.instanceId, "deck");
      } else {
        ctx.discardCard(ctx.seat, chosen.instanceId);
      }
      if (watery) apply(ctx);
    },
  };
}

function highTidePower(power: number): CardScript {
  return { modifyAttack: (ctx) => highTide(ctx) ? power : 0 };
}

function highTideGoAgain(): CardScript {
  return { onAttackDeclared(ctx) { if (highTide(ctx)) ctx.grantGoAgain(); } };
}

function highTideOverpower(onHit?: (ctx: ScriptCtx) => void): CardScript {
  return {
    modifyAttack: (ctx) => highTide(ctx) ? 1 : 0,
    onAttackDeclared(ctx) { if (highTide(ctx)) ctx.setFlag("link", "overpower", true); },
    ...(onHit ? { onHit } : {}),
  };
}

function tapAllyAttack(kind: "overpower" | "go-again"): CardScript {
  return {
    onAttackDeclared(ctx) {
      tapChoice(ctx, "tap-ally-attack", `${ctx.data.name}: tap an ally you control?`, ctx.player(ctx.seat).board.filter((card) => isAlly(ctx, card) && !card.tapped));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "tap-ally-attack" || option === "pass" || !ctx.tap(Number(option))) return;
      if (kind === "overpower") ctx.setFlag("link", "overpower", true);
      else ctx.grantGoAgain();
    },
  };
}

function wateryAttackSeries(name: string, effect: (ctx: ScriptCtx) => void): Record<string, CardScript> {
  return Object.fromEntries([1, 2, 3].map((pitch) => [
    `${name}|${pitch}`,
    discardOrMill(`${name}-${pitch}`, effect),
  ]));
}

function cogPoweredAttack(createOnHit: boolean): CardScript {
  return {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", activationsPerTurn: 2,
      canActivate: (ctx) => controlledCogs(ctx, false).length > 0,
      effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Choose a cog to tap as a cost" }],
      effectCardCostChoiceHook: "cog-powered-attack",
      onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); },
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      tapChoice(ctx, "cog-hit", `${ctx.data.name}: tap a cog you control?`, controlledCogs(ctx, false));
    },
    onChoose(ctx, hook, option) {
      if (hook === "cog-hit" && option !== "pass" && ctx.tap(Number(option))) {
        if (createOnHit) createGoldenCog(ctx);
        else {
          const cogs = controlledCogs(ctx);
          if (cogs.length) ctx.requestCardChoice("cog-steam", "Put a steam counter on a cog you control", cogs.map((card) => card.instanceId));
        }
      } else if (hook === "cog-steam") {
        ctx.addCounter(Number(option), "steam", 1);
      }
    },
  };
}

function skimmerAbility(): CardScript {
  const mode = (label: string, effect: (ctx: ScriptCtx) => void) => ({
    cost: 0, isAttack: false as const, goAgain: false, timing: "instant" as const,
    label,
    canActivate: (ctx: ScriptCtx) =>
      ctx.getCounter("cogModeTurn") !== ctx.state.turn && controlledCogs(ctx, false).length > 0,
    effectCardCosts: [{ zone: "arena" as const, move: "tap" as const, count: 1, subtype: "cog", prompt: `${label}: choose a cog to tap as a cost` }],
    effectCardCostChoiceHook: "skimmer-cog-cost",
    onCostPaid(ctx: ScriptCtx) { ctx.setCounter("cogModeTurn", ctx.state.turn); },
    onActivate: effect,
  });
  return {
    activated: [
      mode("Get +1 attack", (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 })),
      mode("Gain go again", (ctx) => ctx.grantGoAgain()),
    ],
  };
}

function treasureCounters(ctx: ScriptCtx): number {
  return Number(ctx.getPlayerFlag(0, "seaTreasureCounters")) || 0;
}

function setTreasureCounters(ctx: ScriptCtx, value: number): void {
  ctx.setPlayerFlag(0, "seaTreasureCounters", Math.max(0, value));
}

function addTreasureCounter(ctx: ScriptCtx): void {
  setTreasureCounters(ctx, treasureCounters(ctx) + 1);
}

function payTreasureGold(ctx: ScriptCtx, amount: number): void {
  if (amount <= 0) return;
  const removed = Math.min(amount, treasureCounters(ctx));
  if (removed <= 0) return;
  setTreasureCounters(ctx, treasureCounters(ctx) - removed);
  createGold(ctx, removed);
}

function treasureIsland(): CardScript {
  return {
    global: true,
    triggers: [{
      event: "attack-declared",
      label: "Treasure Island gets a gold counter",
      condition(ctx) {
        return ctx.link?.targetAllyId === undefined &&
          Number(ctx.getPlayerFlag(0, "seaTreasureAttackTurn")) !== ctx.state.turn;
      },
      effect(ctx) {
        if (Number(ctx.getPlayerFlag(0, "seaTreasureAttackTurn")) === ctx.state.turn) return;
        ctx.setPlayerFlag(0, "seaTreasureAttackTurn", ctx.state.turn);
        addTreasureCounter(ctx);
      },
    }],
    onFriendlyDamageDealt(ctx, _source, _target, amount) {
      payTreasureGold(ctx, amount);
    },
    onFriendlyCombatDamageDealt(ctx, _source, _target, amount) {
      payTreasureGold(ctx, amount);
    },
  };
}

function pirateHero(ctx: ScriptCtx, seat: number): boolean {
  return hasTag(ctx, ctx.player(seat).hero, "pirate");
}

function yellowDiscardAttack(hook: string): CardScript {
  return {
    onAttackDeclared(ctx) {
      const yellow = ctx.player(ctx.seat).hand.filter((card) => ctx.cardColor(card) === 2);
      if (yellow.length) ctx.requestCardChoice(hook, `${ctx.data.name}: discard a yellow card?`, ["pass", ...yellow.map((card) => card.instanceId)]);
    },
    onChoose(ctx, choiceHook, option) {
      if (choiceHook !== hook || option === "pass") return;
      if (!ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.drawCards(ctx.seat, 1);
      createGold(ctx);
    },
  };
}

function goFish(color: 1 | 2 | 3): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (!hand.length) return;
      const chooser = ctx.getFlag("player", "activatedCannonThisTurn") ? ctx.seat : target;
      // cannon branch: "instead look at their hand and you choose the card"
      if (chooser === ctx.seat) for (const card of hand) ctx.lookAt(card.instanceId);
      ctx.requestCardChoice(`go-fish:${color}`, "Go Fish: choose and reveal a card", hand.map((card) => card.instanceId), chooser);
    },
    onChoose(ctx, hook, option) {
      if (hook !== `go-fish:${color}`) return;
      const target = opponentSeat(ctx);
      const card = ctx.player(target).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.logPublic(`Go Fish reveals ${data(ctx, card).name}`);
      if (ctx.cardColor(card) === color && ctx.discardCard(target, card.instanceId)) createGold(ctx);
    },
  };
}

function topArrowSetup(grant: "power" | "go-again" | "overpower"): CardScript {
  return {
    onPlay(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.lookAt(top.instanceId);
      if (!isArrow(ctx, top) || ctx.player(ctx.seat).arsenal.length) return;
      ctx.requestCardChoice(`top-arrow:${grant}`, `${ctx.data.name}: put the arrow face-up into your arsenal?`, ["pass", top.instanceId]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== `top-arrow:${grant}` || option === "pass") return;
      const id = Number(option);
      if (!ctx.putIntoArsenal(id, "deck")) return;
      if (grant === "power") ctx.addCardTempPower(id, 1);
      else ctx.grantCardKeyword(id, grant === "go-again" ? "go again" : "overpower");
    },
  };
}

function callBigGuns(power: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: power, appliesToSubtype: "arrow" });
      const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card));
      if (!ctx.player(ctx.seat).arsenal.length && arrows.length) {
        ctx.requestCardChoice("call-big-guns", "Put an arrow from your hand face-up into your arsenal?", ["pass", ...arrows.map((card) => card.instanceId)]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "call-big-guns" && option !== "pass") ctx.putIntoArsenal(Number(option), "hand");
    },
  };
}

function goldHunter(kind: "go-again" | "power" | "overpower" | "discount"): CardScript {
  const behind = (ctx: ScriptCtx) => controlledGold(ctx).length < controlledGold(ctx, opponentSeat(ctx)).length;
  if (kind === "discount") return { modifyPlayCost: (ctx, base) => behind(ctx) ? base - 2 : base };
  if (kind === "power") return { modifyAttack: (ctx) => behind(ctx) ? 2 : 0 };
  return { onAttackDeclared(ctx) { if (!behind(ctx)) return; if (kind === "go-again") ctx.grantGoAgain(); else ctx.setFlag("link", "overpower", true); } };
}

function flyingHigh(pitch: number): CardScript {
  const flag = `seaFlyingHigh:${pitch}`;
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { goAgain: true });
      ctx.addModifier({ scope: "until-end-of-turn" });
      ctx.setFlag("player", flag, true);
    },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getFlag("player", flag) || !ctx.link) return;
      ctx.setFlag("player", flag, false);
      if (ctx.cardColor(ctx.link.attackingCard) === pitch) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  };
}

function graveLife(amount: number): CardScript {
  return {
    triggers: [{
      event: "card-put-into-graveyard",
      sourceZone: "graveyard",
      label: `Gain ${amount} life`,
      condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.gainLife(ctx.seat, amount),
    }],
  };
}

function rallyDefense(): CardScript {
  return { defenseAbility: { discard: 1, oncePerTurn: true }, onDefendAbility(ctx) { ctx.addModifier({ scope: "chain-link", defense: 3 }); } };
}

function crashDownTheGates(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return;
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (!top) return;
      ctx.logPublic(`${data(ctx, top).name} is revealed from the top of the defending hero's deck`);
      if (ctx.currentAttackPower() > ctx.basePower(top)) ctx.addModifier({ scope: "chain-link", attack: 2 });
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.moveToGraveyard(top.instanceId, "deck");
    },
  };
}

export const sea: Record<string, CardScript> = {
  "golden cog|0": maintenanceCog(1),
  "goldfin harpoon|0": { graveyardReplacement: "cease-to-exist" },
  "goldkiss rum|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, tapHeroCost: true,
      canActivate: (ctx) => !ctx.player(ctx.seat).hero.tapped,
      onActivate(ctx) {
        ctx.setFlag("player", "nextActionGoAgain", true);
        if (!pirateHero(ctx, ctx.seat)) ctx.setCardCounter(ctx.player(ctx.seat).hero.instanceId, "cannotUntapUntilTurn", ctx.state.turn);
      },
    },
  },

  "treasure island|0": treasureIsland(),

  "puffin|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, tap: true,
      canActivate: (ctx) => controlledGold(ctx).length > 0,
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Gold", prompt: "Puffin: choose a Gold to destroy as a cost" }],
      effectCardCostChoiceHook: "puffin-gold-cost",
      onActivate: createGoldenCog,
    },
    onFriendlyCrank(ctx) {
      const count = Number(ctx.getFlag("player", "cranksThisTurn")) + 1;
      ctx.setFlag("player", "cranksThisTurn", count);
      if (count === 2) ctx.drawCards(ctx.seat, 1);
    },
  },
  "rust belt|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Rust Belt: choose a cog to tap as a cost" }],
      effectCardCostChoiceHook: "rust-belt-cog-cost",
      onActivate(ctx) { ctx.changeResources(ctx.seat, 1); },
    },
  },
  "unicycle|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => controlledCogs(ctx, true).length > 0,
      onActivate(ctx) { ctx.requestCardChoice("unicycle", "Untap a cog you control", controlledCogs(ctx, true).map((card) => card.instanceId)); },
    },
    onChoose(ctx, hook, option) { if (hook === "unicycle") ctx.untap(Number(option)); },
  },
  "copper cog|3": maintenanceCog(2),
  "lubricate|3": {
    onPlay(ctx) {
      const cogs = controlledCogs(ctx, true);
      if (cogs.length) ctx.requestCardChoice("lubricate", "Untap up to 3 cogs (choose one at a time)", ["done", ...cogs.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "lubricate" || option === "done") return;
      ctx.untap(Number(option));
      const cogs = controlledCogs(ctx, true);
      const count = ctx.getCounter("lubricated") + 1;
      ctx.setCounter("lubricated", count);
      if (count < 3 && cogs.length) ctx.requestCardChoice("lubricate", "Untap another cog?", ["done", ...cogs.map((card) => card.instanceId)]);
    },
  },
  "pinion sentry|3": {
    onDefend(ctx) { tapChoice(ctx, "pinion", "Tap a cog to create a Golden Cog?", controlledCogs(ctx, false)); },
    onChoose(ctx, hook, option) { if (hook === "pinion" && option !== "pass" && ctx.tap(Number(option))) createGoldenCog(ctx); },
  },
  "goldwing turbine|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToClass: "mechanologist" }); createGoldenCog(ctx); } },
  "goldwing turbine|2": { onPlay(ctx) { buffNextAttack(ctx, { attack: 2, appliesToClass: "mechanologist" }); createGoldenCog(ctx); } },
  "goldwing turbine|3": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1, appliesToClass: "mechanologist" }); createGoldenCog(ctx); } },
  "draw back the hammer|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4, appliesToClass: "mechanologist" });
      const guns = ctx.player(ctx.seat).weapons.filter((card) => hasTag(ctx, card, "gun") && card.tapped);
      if (guns.length) ctx.requestCardChoice("draw-hammer", "Untap a gun you control?", ["pass", ...guns.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "draw-hammer" && option !== "pass") ctx.untap(Number(option)); },
  },
  "perk up|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToClass: "mechanologist" }); ctx.untap(ctx.player(ctx.seat).hero.instanceId); } },
  "tighten the screws|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4, appliesToClass: "mechanologist" });
      const cogs = controlledCogs(ctx, true);
      if (cogs.length) ctx.requestCardChoice("tighten", "Untap a cog you control?", ["pass", ...cogs.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "tighten" && option !== "pass") ctx.untap(Number(option)); },
  },

  "board the ship|1": tapAllyAttack("overpower"),
  "paddle faster|1": tapAllyAttack("go-again"),
  "hoist 'em up|1": {
    onDefend(ctx) { tapChoice(ctx, "hoist", "Tap an ally for +1 defense?", ctx.player(ctx.seat).board.filter((card) => isAlly(ctx, card) && !card.tapped)); },
    onChoose(ctx, hook, option) { if (hook === "hoist" && option !== "pass" && ctx.tap(Number(option))) ctx.addModifier({ scope: "chain-link", defense: 1 }); },
  },
  "heave ho!|3": nextAllyAttack("heaveHo", { overpower: true }, createGold),
  "kelpie, tangled mess|2": {
    activated: [
      ...attackAbility(0, { tap: true, oncePerTurn: false }),
      {
        cost: 1, isAttack: false, goAgain: true, tap: true, oncePerTurn: false,
        canActivate: (ctx) => !ctx.self.tapped,
        onActivate(ctx) {
          const targets = ctx.state.players.flatMap((player) => [player.hero, ...player.board.filter((card) => isAlly(ctx, card))]).filter((card) => !card.tapped);
          if (targets.length) ctx.requestCardChoice("kelpie-tap", "Tap target hero or ally", targets.map((card) => card.instanceId));
        },
      },
    ],
    onChoose(ctx, hook, option) { if (hook === "kelpie-tap") ctx.tap(Number(option)); },
  },
  "scooba, salty sea dog|2": {
    ...attackAbilityForAlly(3),
    onAttackDeclared(ctx) {
      const yellow = ctx.state.players.flatMap((player) => player.graveyard).filter((card) => ctx.cardColor(card) === 2 && !card.faceDown);
      if (yellow.length) ctx.requestCardChoice("scooba-yellow", "Put a yellow graveyard card on the bottom to create Gold?", ["pass", ...yellow.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "scooba-yellow" && option !== "pass" && ctx.putOnDeckBottom(Number(option))) createGold(ctx); },
  },
  "chowder, hearty cook|2": {
    activated: [
      ...attackAbility(0, { tap: true, oncePerTurn: false }),
      { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, oncePerTurn: false, onActivate(ctx) { ctx.gainLife(ctx.seat, 1); } },
    ],
  },
  "shelly, hardened traveler|2": {
    activated: [
      ...attackAbility(3, { tap: true, oncePerTurn: false }),
      { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, oncePerTurn: false, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", defense: 1, appliesTo: "attack-action", once: true }); } },
    ],
  },
  "head stone|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, onActivate(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.moveToGraveyard(top.instanceId, "deck"); } },
  },

  "marlynn|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, tap: true,
      canActivate: (ctx) => controlledGold(ctx).length > 0,
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Gold", prompt: "Marlynn: choose a Gold to destroy as a cost" }],
      effectCardCostChoiceHook: "marlynn-gold-cost",
      onActivate(ctx) { ctx.createCardInHand(GOLDFIN_HARPOON); },
    },
    onFriendlyActivate(ctx, activated) {
      if (hasTag(ctx, activated, "cannon")) ctx.setFlag("player", "activatedCannonThisTurn", true);
    },
    onFriendlyDraws(ctx) {
      if (ctx.state.activePlayer !== ctx.seat || ctx.state.phase === "start" || ctx.state.phase === "end" || ctx.state.phase === "game-over") return;
      const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card));
      if (!ctx.player(ctx.seat).arsenal.length && arrows.length) ctx.requestCardChoice("marlynn-arrow", "Marlynn: put an arrow face-up into your arsenal?", ["pass", ...arrows.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "marlynn-arrow" && option !== "pass") ctx.putIntoArsenal(Number(option), "hand"); },
  },
  "blue fin harpoon|3": goFish(3),
  "red fin harpoon|3": goFish(1),
  "yellow fin harpoon|3": goFish(2),
  "patch the hole|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.player(ctx.seat).arsenal.length > 0, onActivate(ctx) { const card = ctx.player(ctx.seat).arsenal[0]; if (card) ctx.moveToHand(card.instanceId); } },
  },
  "glidewell fins|0": {
    activated: { cost: 1, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: (ctx) => !ctx.player(ctx.seat).arsenal.length && ctx.player(ctx.seat).hand.some((card) => isArrow(ctx, card)), onActivate(ctx) { const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card)); ctx.requestCardChoice("glidewell", "Put an arrow face-up into your arsenal", arrows.map((card) => card.instanceId)); } },
    onChoose(ctx, hook, option) { if (hook === "glidewell" && ctx.putIntoArsenal(Number(option), "hand")) ctx.addCardTempPower(Number(option), 1); },
  },
  "fire in the hole|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" });
      const bows = ctx.player(ctx.seat).weapons.filter((card) => hasTag(ctx, card, "bow") && card.tapped);
      if (bows.length) ctx.requestCardChoice("fire-hole", "Untap a bow you control?", ["pass", ...bows.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "fire-hole" && option !== "pass") ctx.untap(Number(option)); },
  },
  "monkey powder|1": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1, appliesToSubtype: "arrow", overpower: true }); ctx.drawCards(ctx.seat, 1); } },
  "hook|3": topArrowSetup("power"),
  "line|3": topArrowSetup("go-again"),
  "sinker|3": topArrowSetup("overpower"),
  "nettling shot|1": {
    onEnterArsenal(ctx) {
      const allies = ctx.state.players.flatMap((player) => player.board.filter((card) => isAlly(ctx, card) && !card.tapped));
      if (allies.length) ctx.requestCardChoice("nettling", "Tap target ally?", ["pass", ...allies.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) { if (hook === "nettling" && option !== "pass") ctx.tap(Number(option)); },
  },
  "scouting shot|1": { onEnterArsenal(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.lookAt(top.instanceId); } },
  "call in the big guns|2": callBigGuns(2),
  "call in the big guns|3": callBigGuns(1),

  "scurv, stowaway|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, tap: true,
      canActivate: (ctx) => controlledGold(ctx).length > 0,
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, name: "Gold", prompt: "Scurv: choose a Gold to destroy as a cost" }],
      effectCardCostChoiceHook: "scurv-gold-cost",
      onActivate(ctx) { ctx.createToken(GOLDKISS_RUM); },
    },
    onFriendlyActivate(ctx, activated) { if (named(ctx, activated, "Goldkiss Rum")) ctx.changeResources(ctx.seat, 1); },
  },
  "blue sea tricorn|0": { activated: { cost: 3, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.drawCards(ctx.seat, 1); } } },
  "buccaneer's bounty|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } } },
  "fish fingers|0": { activated: { cost: 1, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => nextAttack({ attack: 1 })(ctx) } },
  "peg leg|0": { activated: { cost: 3, isAttack: false, goAgain: true, destroySelfCost: true, onActivate: (ctx) => nextAttack({ goAgain: true })(ctx) } },

  "hms barracuda|2": {
    ...highTideOverpower((ctx) => {
      if (ctx.link?.targetAllyId !== undefined) return;
      const allies = ctx.player(opponentSeat(ctx)).board.filter((card) => isAlly(ctx, card));
      if (allies.length) ctx.requestCardChoice("barracuda", "Destroy an ally they control", allies.map((card) => card.instanceId));
    }),
    onChoose(ctx, hook, option) { if (hook === "barracuda") ctx.destroyPermanent(Number(option)); },
  },
  "hms kraken|2": {
    ...highTideOverpower((ctx) => {
      if (ctx.link?.targetAllyId !== undefined) return;
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card));
      if (items.length) ctx.requestCardChoice("kraken", "Destroy an item they control", items.map((card) => card.instanceId));
    }),
    onChoose(ctx, hook, option) { if (hook === "kraken") ctx.destroyPermanent(Number(option)); },
  },
  "hms marlin|2": highTideOverpower((ctx) => { if (ctx.link?.targetAllyId === undefined) { const top = ctx.player(opponentSeat(ctx)).deck[0]; if (top) ctx.moveToGraveyard(top.instanceId, "deck"); } }),
  "divvy up|3": {
    onPlay(ctx) {
      const counters = treasureCounters(ctx);
      const removed = isThief(ctx) ? counters : Math.ceil(counters / 2);
      setTreasureCounters(ctx, counters - removed);
      if (removed) createGold(ctx, removed);
    },
  },
  "sea floor salvage|3": {
    onPlay(ctx) {
      const cards = ctx.state.players.flatMap((player) => player.graveyard.filter((card) => !card.faceDown));
      if (cards.length) ctx.requestCardChoice("salvage-face-down", "Turn a card in a graveyard face-down", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "salvage-face-down") return;
      const card = ctx.state.players.flatMap((player) => player.graveyard).find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const yellow = ctx.cardColor(card) === 2;
      if (ctx.setCardFaceDown(card.instanceId, true) && yellow) createGold(ctx);
    },
  },
  "scrub the deck|3": {
    onPlay(ctx) {
      ctx.requestChoice("scrub-target", "Choose a hero whose deck top to destroy", ctx.state.players.map((player) => `hero:${player.seat}`));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "scrub-target") return;
      const seat = Number(option.split(":")[1]);
      const top = ctx.player(seat).deck[0];
      if (!top) return;
      const yellow = ctx.cardColor(top) === 2;
      if (ctx.moveToGraveyard(top.instanceId, "deck") && yellow) createGold(ctx);
    },
  },
  "shifting tides|3": {
    triggers: [{ event: "start-of-turn", label: "Pitch the top card", effect(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) { ctx.destroySelf(); return; }
      const blue = ctx.cardColor(top) === 3;
      ctx.pitchCard(top.instanceId);
      if (blue) ctx.putOnDeckBottom(ctx.self.instanceId);
      else ctx.destroySelf();
    } }],
  },
  "not so fast|2": {
    onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); ctx.setCounter("ready", 1); },
    replaceOpponentDraw(ctx, drawingSeat, count) {
      if (!ctx.getCounter("ready") || ctx.getPlayerFlag(drawingSeat, "goldDrawEffect") !== true || count <= 0) return count;
      ctx.setCounter("ready", 0);
      ctx.drawCards(ctx.seat, 1);
      return count - 1;
    },
  },
  "lost in transit|2": {
    onDefend(ctx) {
      if (treasureCounters(ctx) > 0) ctx.requestChoice("lost-transit", "Remove a Treasure Island gold counter?", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "lost-transit" && option === "yes") { setTreasureCounters(ctx, treasureCounters(ctx) - 1); if (isThief(ctx)) createGold(ctx); }
    },
  },
  "battalion barque|2": highTidePower(2),
  "battalion barque|3": highTidePower(2),
  "gold hunter lightsail|2": goldHunter("go-again"),
  "gold hunter longboat|2": goldHunter("power"),
  "gold hunter marauder|2": goldHunter("overpower"),
  "gold hunter ketch|2": goldHunter("discount"),
  "swiftwater sloop|2": highTideGoAgain(),
  "saltwater swell|2": {
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, top).name}`);
      if (ctx.cardColor(top) === 3) ctx.pitchCard(top.instanceId);
    },
  },
  "crash down the gates|1": crashDownTheGates(),
  "crash down the gates|2": crashDownTheGates(),
  "crash down the gates|3": crashDownTheGates(),
  "jack be nimble|1": {
    onAttackDeclared(ctx) {
      const nimblisms = ctx.player(ctx.seat).graveyard.filter((card) => named(ctx, card, "Nimblism"));
      if (nimblisms.length) ctx.requestCardChoice("jack-nimble-banish", "Banish a Nimblism for +1 power and go again?", ["pass", ...nimblisms.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "jack-nimble-steal") {
        ctx.steal(Number(option));
        return;
      }
      if (hook !== "jack-nimble-banish" || option === "pass") return;
      const card = ctx.player(ctx.seat).graveyard.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.banish(card.instanceId);
      ctx.setCounter("jackNimbleBuff", 1);
      ctx.grantGoAgain();
    },
    modifyAttack: (ctx) => ctx.getCounter("jackNimbleBuff"),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card));
      if (items.length) ctx.requestCardChoice("jack-nimble-steal", "Steal an item until the end of the action phase", items.map((card) => card.instanceId));
    },
  },
  "thiev'n varmints|1": {
    onAttackDeclared(ctx) { if (treasureCounters(ctx) > 0) ctx.requestChoice("varmints", "Remove a Treasure Island gold counter?", ["yes", "no"]); },
    onChoose(ctx, hook, option) { if (hook === "varmints" && option === "yes") { setTreasureCounters(ctx, treasureCounters(ctx) - 1); if (isThief(ctx)) createGold(ctx); } },
  },

  "bandana of the blue beyond|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, discardCost: { count: 1 },
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length > 0,
      onActivate(ctx) {
        const blue = ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardColor(card) === 3);
        if (blue.length) ctx.requestCardChoice("bandana-blue", "Put a blue graveyard card on the bottom of your deck", blue.map((card) => card.instanceId));
      },
    },
    onChoose(ctx, hook, option) { if (hook === "bandana-blue") ctx.putOnDeckBottom(Number(option)); },
  },
  "helmsman's peak|0": { onDefend(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.lookAt(top.instanceId); } },
  "captain's coat|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: (ctx) => Number(ctx.getFlag("player", "cardsDrawnThisTurn")) > 0, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } } },
  "old knocker|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, tapHeroCost: true, canActivate: (ctx) => !ctx.player(ctx.seat).hero.tapped, onActivate(ctx) { ctx.changeResources(ctx.seat, 1); } } },
  "light fingers|0": {
    canTriggerOnDefend: isThief,
    onDefend(ctx) {
      if (!isThief(ctx) || !ctx.link) return;
      const gold = controlledGold(ctx, ctx.link.attacker)[0];
      if (gold) ctx.steal(gold.instanceId, { duration: "indefinite" });
    },
  },
  "quartermaster's boots|0": { activated: { cost: 2, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { ctx.setFlag("player", "nextNonAttackActionCardGoAgain", true); } } },

  "clap 'em in irons|3": {
    onEnterArena(ctx) {
      const targets = ctx.state.players.flatMap((player) => [player.hero, ...player.board.filter((card) => isAlly(ctx, card))]).filter((card) => isPirate(ctx, card) && !card.tapped);
      if (targets.length) ctx.requestCardChoice("clap-tap", "Tap target Pirate hero or ally", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "clap-tap" && ctx.tap(Number(option))) ctx.setCounter("clapTarget", Number(option)); },
    preventsUntapOf(ctx, target) { return ctx.getCounter("clapTarget") === target.instanceId; },
    triggers: [{ event: "start-of-turn", label: "Destroy this", effect(ctx) { ctx.destroySelf(); } }],
  },
  "regain composure|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 1 }); ctx.addModifier({ scope: "until-end-of-turn" }); ctx.setCounter("ready", 1); },
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.getCounter("ready")) return;
      ctx.setCounter("ready", 0);
      ctx.setFlag("link", "regainComposure", true);
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId &&
        modifier.scope === "until-end-of-turn" && !modifier.consumed);
      if (marker) ctx.consumeModifier(marker.id);
    },
    canTriggerOnHit: (ctx) => ctx.getFlag("link", "regainComposure") === true,
    onHit(ctx) { ctx.untap(ctx.player(ctx.seat).hero.instanceId); },
  },
  "tit for tat|3": {
    onPlay(ctx) { ctx.requestChoice("tit-tap", "Tap target hero", ctx.state.players.map((player) => `hero:${player.seat}`)); },
    onChoose(ctx, hook, option) {
      if (hook === "tit-tap") {
        const seat = Number(option.split(":")[1]);
        ctx.tap(ctx.player(seat).hero.instanceId);
        ctx.setCounter("titTappedSeat", seat + 1);
        const others = ctx.state.players.filter((player) => player.seat !== seat);
        ctx.requestChoice("tit-untap", "Untap another target hero", others.map((player) => `hero:${player.seat}`));
      } else if (hook === "tit-untap") {
        ctx.untap(ctx.player(Number(option.split(":")[1])).hero.instanceId);
      }
    },
  },
  "fool's gold|2": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Create a Gold token",
      condition: (ctx, discarded) => discarded?.instanceId === ctx.self.instanceId,
      effect: (ctx) => createGold(ctx),
    }],
  },
  "blow for a blow|1": {
    triggers: [{ event: "card-played", sourceZone: "self", label: "Gain go again", condition: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0, effect(ctx, played) { if (played) ctx.grantGoAgain(played.instanceId); } }],
    onHit(ctx) {
      const options = ctx.state.players.flatMap((player) => [`hero:${player.seat}`, ...player.board.filter((card) => isAlly(ctx, card)).map((card) => `ally:${card.instanceId}`)]);
      ctx.requestChoice("blow-target", "Deal 1 damage to any target", options);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "blow-target") return;
      const [kind, raw] = option.split(":");
      if (kind === "hero") ctx.dealDamage(Number(raw), 1);
      else ctx.dealDamage(0, 1, { targetAllyId: Number(raw) });
    },
  },
  "rally the coast guard|1": rallyDefense(),
  "rally the coast guard|2": rallyDefense(),
  "sirens of safe harbor|1": graveLife(1),
  "sirens of safe harbor|2": graveLife(1),
  "sirens of safe harbor|3": graveLife(1),
  "strike gold|1": { onHit: createGold },
  "strike gold|2": { onHit: createGold },
  "strike gold|3": { onHit: createGold },
};

Object.assign(sea,
  Object.fromEntries([1, 2, 3].map((pitch) => [`cloud city steamboat|${pitch}`, cogPoweredAttack(false)])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`cogwerx zeppelin|${pitch}`, cogPoweredAttack(true)])),
  Object.fromEntries([1, 2, 3].flatMap((pitch) => [[`cloud skiff|${pitch}`, skimmerAbility()], [`sky skimmer|${pitch}`, skimmerAbility()]])),
  Object.fromEntries(["teeth of the cog", "tough old wrench"].flatMap((name) => [1, 2, 3].map((pitch) => [
    `${name}|${pitch}`,
    {
      onDefend(ctx: ScriptCtx) {
        const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
        if (items.length) ctx.requestCardChoice("sea-galvanize", "Destroy an item to create a Golden Cog?", ["pass", ...items.map((card) => card.instanceId)]);
      },
      onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "sea-galvanize" && option !== "pass" && ctx.destroyPermanent(Number(option))) createGoldenCog(ctx); },
    } satisfies CardScript,
  ]))),
  wateryAttackSeries("angry bones", (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 })),
  wateryAttackSeries("burly bones", (ctx) => ctx.setFlag("link", "overpower", true)),
  Object.fromEntries([1, 2].map((pitch) => [
    `jittery bones|${pitch}`,
    discardOrMill(`jittery bones-${pitch}`, (ctx) => ctx.grantGoAgain()),
  ])),
  wateryAttackSeries("restless bones", (ctx) => ctx.grantGoAgain()),
  Object.fromEntries([1, 2, 3].map((pitch) => [`pilfer the wreck|${pitch}`, {
    canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx: ScriptCtx) {
      const cards = ctx.player(opponentSeat(ctx)).graveyard.filter((card) => !card.faceDown);
      if (cards.length) ctx.requestCardChoice("pilfer-wreck", "Turn a card in their graveyard face-down?", ["pass", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "pilfer-wreck" || option === "pass") return;
      const card = ctx.player(opponentSeat(ctx)).graveyard.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      const yellow = ctx.cardColor(card) === 2;
      if (ctx.setCardFaceDown(card.instanceId, true) && yellow) createGold(ctx);
    },
  } satisfies CardScript])),
  Object.fromEntries(["expedition to azuro keys", "expedition to blackwater strait", "expedition to dreadfall reach", "expedition to horizon's mantle"].map((name) => [`${name}|1`, {
    onAttackDeclared(ctx: ScriptCtx) { ctx.requestChoice("expedition-counter", "Put a gold counter on Treasure Island?", ["yes", "no"]); },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "expedition-counter" && option === "yes") addTreasureCounter(ctx); },
  } satisfies CardScript])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`swindler's grift|${pitch}`, yellowDiscardAttack(`swindler-${pitch}`)])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`chart a course|${pitch}`, {
    onPlay(ctx: ScriptCtx) {
      ctx.setCounter("chartOrdinal", pitch);
      ctx.addModifier({ scope: "until-end-of-turn" });
      ctx.requestChoice("chart-treasure", "Put a gold counter on Treasure Island?", ["yes", "no"]);
    },
    onFriendlyAttackDeclared(ctx: ScriptCtx) {
      if (Number(ctx.getFlag("player", "attacksDeclaredThisTurn")) !== ctx.getCounter("chartOrdinal")) return;
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn" && !modifier.consumed);
      if (marker) ctx.consumeModifier(marker.id);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "chart-treasure" && option === "yes") addTreasureCounter(ctx); },
  } satisfies CardScript])),
  Object.fromEntries([
    ["mutiny on the battalion barque|3", { attack: 2 }],
    ["mutiny on the nimbus sovereign|3", { overpower: true }],
    ["mutiny on the swiftwater|3", { goAgain: true }],
  ].map(([key, mod]) => [key, {
    onPlay(ctx: ScriptCtx) {
      const opponent = opponentSeat(ctx);
      if (controlledGold(ctx, opponent).length <= controlledGold(ctx).length) return;
      const gold = controlledGold(ctx, opponent)[0];
      if (gold && ctx.steal(gold.instanceId, { duration: "indefinite" })) buffNextAttack(ctx, mod as NextAttackMod);
    },
  } satisfies CardScript])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`fiddler's green|${pitch}`, graveLife(4 - pitch)])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`money or your life?|${pitch}`, {
    canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx: ScriptCtx) {
      ctx.setCounter("moneyRepeats", isThief(ctx) ? 2 : 1);
      const gold = controlledGold(ctx, opponentSeat(ctx));
      ctx.requestCardChoice("money-choice", "Give a Gold or take 2 damage", [...gold.map((card) => card.instanceId), "damage"], opponentSeat(ctx));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "money-choice") return;
      if (option === "damage") ctx.dealDamage(opponentSeat(ctx), 2);
      else ctx.steal(Number(option), { duration: "indefinite" });
      const remaining = ctx.getCounter("moneyRepeats") - 1;
      ctx.setCounter("moneyRepeats", remaining);
      if (remaining > 0) {
        const gold = controlledGold(ctx, opponentSeat(ctx));
        ctx.requestCardChoice("money-choice", "Give a Gold or take 2 damage", [...gold.map((card) => card.instanceId), "damage"], opponentSeat(ctx));
      }
    },
  } satisfies CardScript])),
  Object.fromEntries([1, 2].map((pitch) => [`flying high|${pitch}`, flyingHigh(pitch)])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`nimby|${pitch}`, {
    onAttackDeclared(ctx: ScriptCtx) {
      const cards = ctx.player(ctx.seat).deck.filter((card) => named(ctx, card, "Nimblism"));
      if (cards.length) ctx.requestCardChoice("nimby-search", "Search for a Nimblism?", ["pass", ...cards.map((card) => card.instanceId)]);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "nimby-search" || option === "pass") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.logPublic(`${ctx.data.name} reveals ${data(ctx, card).name}`);
      ctx.moveToHand(card.instanceId);
      ctx.shuffleDeck();
    },
  } satisfies CardScript])),
  Object.fromEntries([1, 2, 3].map((pitch) => [`walk the plank|${pitch}`, {
    canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined && pirateHero(ctx, opponentSeat(ctx)),
    onHit(ctx: ScriptCtx) {
      const target = opponentSeat(ctx);
      const options = [ctx.player(target).hero, ...ctx.player(target).board.filter((card) => isAlly(ctx, card))].filter((card) => !card.tapped);
      if (options.length) ctx.requestCardChoice("walk-tap", "Tap that Pirate hero or an ally they control", options.map((card) => card.instanceId));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "walk-tap") ctx.tap(Number(option)); },
  } satisfies CardScript])),
  Object.fromEntries([2, 3].map((pitch) => [`on the horizon|${pitch}`, { onDefend(ctx: ScriptCtx) { const top = ctx.player(ctx.seat).deck[0]; if (top) ctx.lookAt(top.instanceId); } } satisfies CardScript])),
);

function seaTargets(ctx: ScriptCtx, hook: string, prompt: string): void {
  ctx.requestChoice(hook, prompt, [
    ...ctx.state.players.map((player) => `hero:${player.seat}`),
    ...ctx.state.players.flatMap((player) => player.board.filter((card) => isAlly(ctx, card)).map((card) => `ally:${card.instanceId}`)),
  ]);
}

function dealSeaTarget(ctx: ScriptCtx, option: string, amount: number, arcane = false): void {
  const [kind, raw] = option.split(":");
  if (kind === "hero") ctx.dealDamage(Number(raw), amount, { arcane });
  else ctx.dealDamage(0, amount, { arcane, targetAllyId: Number(raw) });
}

function kingHarpoon(kind: "attack" | "non-attack"): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx); const hand = ctx.player(target).hand;
      if (!hand.length) return;
      ctx.requestCardChoice(`king-${kind}`, "Go Fish: choose and reveal a card", hand.map((card) => card.instanceId), ctx.getFlag("player", "activatedCannonThisTurn") ? ctx.seat : target);
    },
    onChoose(ctx, hook, option) {
      if (hook !== `king-${kind}`) return;
      const target = opponentSeat(ctx); const card = ctx.player(target).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.revealCards([card.instanceId], target);
      const attack = ctx.hasCardType(card, "action") && hasTag(ctx, card, "attack");
      if ((kind === "attack") === attack && ctx.discardCard(target, card.instanceId)) createGold(ctx);
    },
  };
}

function seaAmulet(effect: (ctx: ScriptCtx) => void, timing: "action" | "instant" = "action"): CardScript {
  return { activated: { cost: 0, isAttack: false, goAgain: timing === "action", timing, destroySelfCost: true, onActivate: effect } };
}

function destroyItemOnHit(): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) { const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card)); if (items.length) ctx.requestCardChoice("sea-destroy-item", "Destroy an item", items.map((card) => card.instanceId)); },
    onChoose(ctx, hook, option) { if (hook === "sea-destroy-item") ctx.destroyPermanent(Number(option)); },
  };
}

Object.assign(sea, {
  "riches of trōpal-dhani|2": { triggers: [{ event: "card-pitched", sourceZone: "pitch", label: "Create a Gold token", condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId, effect(ctx: ScriptCtx) { createGold(ctx); } }] },
  "puffin, hightail|0": sea["puffin|0"]!,
  "polly cranka|0": { activated: { cost: 0, isAttack: false, goAgain: true, tap: true, banishSelfCost: true, onActivate(ctx: ScriptCtx) { ctx.createToken("SEA003"); } } },
  "golden skywarden|2": {
    onDefend(ctx: ScriptCtx) { const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card)); if (items.length) ctx.requestCardChoice("skywarden", "Destroy an item for +1 defense?", ["pass", ...items.map((card) => card.instanceId)]); },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook !== "skywarden" || option === "pass") return; const item = ctx.player(ctx.seat).board.find((card) => card.instanceId === Number(option)); if (!item || !ctx.destroyPermanent(item.instanceId)) return; ctx.addCardTempDefense(ctx.self.instanceId, 1); if (named(ctx, item, "Golden Cog")) createGold(ctx); },
  },
  "jolly bludger|2": {
    onAttackDeclared(ctx: ScriptCtx) { tapChoice(ctx, "bludger", "Tap a cog for overpower?", controlledCogs(ctx, false)); },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "bludger" && option !== "pass" && ctx.tap(Number(option))) ctx.setFlag("link", "overpower", true); },
    onHit(ctx: ScriptCtx) { for (const item of ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card)).slice(0, ctx.link?.damage ?? 0)) ctx.steal(item.instanceId, { duration: "indefinite" }); },
    activated: [1, 2, 3].map(() => ({ cost: 0, isAttack: false, goAgain: false, timing: "instant" as const, effectCardCosts: [{ zone: "arena" as const, move: "tap" as const, count: 1, subtype: "cog", prompt: "Tap a cog" }], onActivate(ctx: ScriptCtx) { ctx.addCardTempPower(ctx.self.instanceId, 1); } })),
  },
  "cogwerx blunderbuss|0": { activated: [...attackAbility(2, { tap: true, oncePerTurn: false }), { cost: 0, isAttack: false, goAgain: false, timing: "instant", effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Tap a cog" }], onActivate(ctx: ScriptCtx) { buffNextAttack(ctx, { goAgain: true, appliesToInstanceId: ctx.self.instanceId }); } }] },
  "spitfire|0": { activated: { cost: 0, isAttack: true, goAgain: false, tap: true, oncePerTurn: false, effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Tap a cog" }] }, onAttackDeclared(ctx: ScriptCtx) { tapChoice(ctx, "spitfire", "Tap a cog for +1 attack?", controlledCogs(ctx, false)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "spitfire" && option !== "pass" && ctx.tap(Number(option))) ctx.addModifier({ scope: "chain-link", attack: 1 }); } },
  "cogwerx tinker rings|0": { onDefend(ctx: ScriptCtx) { createGoldenCog(ctx); } },
  "cogwerx dovetail|1": { canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, onHit(ctx: ScriptCtx) { for (const cog of controlledCogs(ctx, true)) ctx.untap(cog.instanceId); }, activated: ["power", "go-again", "power"].map((mode) => ({ cost: 0, isAttack: false, goAgain: false, timing: "instant" as const, effectCardCosts: [{ zone: "arena" as const, move: "tap" as const, count: 1, subtype: "cog", prompt: "Tap a cog" }], onActivate(ctx: ScriptCtx) { if (mode === "power") ctx.addCardTempPower(ctx.self.instanceId, 1); else ctx.grantGoAgain(); } })) },
  "palantir aeronought|1": { activated: [1, 2, 3].map((n) => ({ cost: 0, isAttack: false, goAgain: false, timing: "instant" as const, effectCardCosts: [{ zone: "arena" as const, move: "tap" as const, count: 1, subtype: "cog", prompt: "Tap a cog" }], onActivate(ctx: ScriptCtx) { ctx.addCardTempPower(ctx.self.instanceId, 1); if (n === 3 && ctx.link) { const cards = [...ctx.link.defendingCards, ...ctx.link.defendingEquipment]; if (cards.length) ctx.requestCardChoice("palantir", "Destroy a defending card", cards.map((card) => card.instanceId)); } } })), onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "palantir") ctx.moveToGraveyard(Number(option), "chain"); } },
  "cog in the machine|1": { onPlay(ctx: ScriptCtx) { ctx.createTokens(GOLDEN_COG, 2); tapChoice(ctx, "cog-machine", "Tap a cog to bottom this?", controlledCogs(ctx, false)); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "cog-machine" && option !== "pass" && ctx.tap(Number(option))) ctx.putOnDeckBottom(ctx.self.instanceId); } },
  "cogwerx workshop|3": { onPlay(ctx: ScriptCtx) { createGoldenCog(ctx); for (const cog of controlledCogs(ctx).slice(0, 2)) ctx.addCounter(cog.instanceId, "steam", 1); } },
  "blood in the water|1": {
    onDefend(ctx: ScriptCtx) { const p = ctx.player(ctx.seat); ctx.requestCardChoice("blood-water", "Discard or destroy the top card?", ["pass", ...p.hand.map((card) => card.instanceId), ...(p.deck.length ? ["deck-top"] : [])]); },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook !== "blood-water" || option === "pass") return; const card = option === "deck-top" ? ctx.player(ctx.seat).deck[0] : ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option)); if (!card) return; const watery = (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "watery grave"); if (option === "deck-top") ctx.moveToGraveyard(card.instanceId, "deck"); else ctx.discardCard(ctx.seat, card.instanceId); if (watery) ctx.addCardTempDefense(ctx.self.instanceId, 2); },
  },
  "chart the high seas|3": { onPlay(ctx: ScriptCtx) { const top = ctx.player(ctx.seat).deck.slice(0, 2); for (const card of top) ctx.lookAt(card.instanceId); const blue = top.find((card) => ctx.cardColor(card) === 3); if (blue) ctx.pitchCard(blue.instanceId); for (const card of top.filter((candidate) => candidate.instanceId !== blue?.instanceId)) { const yellow = ctx.cardColor(card) === 2; if (ctx.moveToGraveyard(card.instanceId, "deck") && yellow) createGold(ctx); } } },
  "give no quarter|3": { onPlay(ctx: ScriptCtx) { for (let i = 0; i < 2; i++) ctx.addModifier({ scope: "until-end-of-turn", playCostReduction: 3, appliesToSubtype: "ally", appliesToKeyword: "watery grave" }); } },
  "chum, friendly first mate|2": { activated: [...attackAbility(0, { tap: true, oncePerTurn: false }), { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, oncePerTurn: false, effectCardCosts: [{ zone: "hand", move: "discard", count: 1, keyword: "watery grave", prompt: "Discard a card with watery grave" }], onActivate(ctx) { ctx.setCounter("must-target-turn", ctx.state.turn); } }], mandatoryAttackTarget: (ctx) => ctx.getCounter("must-target-turn") === ctx.state.turn },
  "moray le fay|2": { activated: [...attackAbility(0, { tap: true, oncePerTurn: false }), { cost: 1, isAttack: false, goAgain: false, timing: "instant", tap: true, oncePerTurn: false, onActivate(ctx: ScriptCtx) { const allies = ctx.player(ctx.seat).board.filter((card) => isAlly(ctx, card)); if (allies.length) ctx.requestCardChoice("moray", "Put a +1 counter on an ally", allies.map((card) => card.instanceId)); } }], onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "moray") ctx.addCounter(Number(option), "power", 1); } },
  "wailer humperdinck|2": attackAbilityForAlly(6),
  "dead threads|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, canActivate: (ctx: ScriptCtx) => ctx.getFlag("player", "graveSubtype:ally") === true, onActivate(ctx: ScriptCtx) { ctx.changeResources(ctx.seat, 1); } } },
  "marlynn, treasure hunter|0": sea["marlynn|0"]!,
  "hammerhead, harpoon cannon|0": { activated: { cost: 4, isAttack: false, goAgain: true, tap: true, onActivate(ctx: ScriptCtx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "arrow", overpower: true }); ctx.setFlag("player", "activatedCannonThisTurn", true); } } },
  "king kraken harpoon|1": kingHarpoon("non-attack"),
  "king shark harpoon|1": kingHarpoon("attack"),
  "big game trophy shot|2": { onPlay(ctx: ScriptCtx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "arrow" }); ctx.drawCards(ctx.seat, 1); requestDiscardChoice(ctx, "big-game-discard", "Choose a card to discard", ctx.seat); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "big-game-discard") resolveDiscardChoice(ctx, option, ctx.seat); } },
  "gold the tip|2": { onPlay(ctx: ScriptCtx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow" }); if (ctx.player(ctx.seat).arsenal.some((card) => !card.faceDown && isArrow(ctx, card) && ctx.cardColor(card) === 2)) createGold(ctx); } },
  "redspine manta|0": { activated: { cost: 0, isAttack: false, goAgain: true, tap: true, canActivate: (ctx: ScriptCtx) => !ctx.player(ctx.seat).arsenal.length && ctx.player(ctx.seat).hand.some((card) => isArrow(ctx, card)), onActivate(ctx: ScriptCtx) { const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card)); ctx.requestCardChoice("manta", "Put an arrow face-up into arsenal", arrows.map((card) => card.instanceId)); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "manta") ctx.putIntoArsenal(Number(option), "hand"); } },
  "sealace sarong|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, effectCardCosts: [{ zone: "arsenal", move: "turn-face-up", count: 1, pitch: 3, subtype: "arrow", prompt: "Turn a blue arrow face-up" }], onActivate(ctx: ScriptCtx) { const arrow = ctx.player(ctx.seat).arsenal.find((card) => !card.faceDown && isArrow(ctx, card) && ctx.cardColor(card) === 3); if (arrow) ctx.grantCardKeyword(arrow.instanceId, "go again"); } } },
  "barbed barrage|1": { onPlayCostPaid(ctx: ScriptCtx, paid: readonly Card[]) { if (paid.length >= 2) ctx.setFlag("link", "additionalTarget", true); } },
  "return fire|1": { onDefend(ctx: ScriptCtx) { const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card)); if (arrows.length) ctx.requestCardChoice("return-fire", "Banish an arrow?", ["pass", ...arrows.map((card) => card.instanceId)]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "return-fire" && option !== "pass" && ctx.banish(Number(option))) { ctx.allowPlayFrom(Number(option), "banish", { untilNextTurn: true }); ctx.addCardTempPower(Number(option), 3); } } },
  "sticky fingers|0": { ...attackAbilityForAlly(0), onAttackDeclared(ctx: ScriptCtx) { const gold = controlledGold(ctx, opponentSeat(ctx))[0]; if (ctx.link?.targetAllyId === undefined && gold) ctx.steal(gold.instanceId, { duration: "indefinite" }); } },
  "gold-baited hook|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      tap: true,
      onActivate(ctx: ScriptCtx) {
        buffNextAttack(ctx, {
          appliesToClass: "pirate",
          onHitScriptHook: {
            hook: "gold-baited-hook-hit",
            label: "steal a Gold token they control, otherwise create a Gold token",
            heroOnly: true,
          },
        });
      },
    },
    onGrantedHit(ctx: ScriptCtx, hook: string) {
      if (hook !== "gold-baited-hook-hit") return;
      const gold = controlledGold(ctx, opponentSeat(ctx))[0];
      if (!gold || !ctx.steal(gold.instanceId, { duration: "indefinite" })) createGold(ctx);
    },
    triggers: [{
      event: "end-of-turn",
      label: "Destroy Gold-Baited Hook",
      condition: (ctx: ScriptCtx) =>
        ctx.getFlag("player", "createdName:gold") !== true &&
        ctx.getFlag("player", "stolenName:gold") !== true,
      effect(ctx: ScriptCtx) { ctx.destroySelf(); },
    }],
  },
  "conqueror of the high seas|1": { modifyAttack: (ctx: ScriptCtx) => highTide(ctx) ? 1 : 0, onAttackDeclared(ctx: ScriptCtx) { if (highTide(ctx)) ctx.grantGoAgain(); }, canTriggerOnHit: (ctx: ScriptCtx) => ctx.link?.targetAllyId === undefined, onHit(ctx: ScriptCtx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) if (ctx.moveToGraveyard(card.instanceId, "arsenal")) createGold(ctx); } },
  "loan shark|2": { onEnterArena(ctx: ScriptCtx) { createGold(ctx, 2); }, triggers: [{ event: "end-of-turn", label: "Pay Loan Shark", condition: (ctx: ScriptCtx) => ctx.getFlag("player", "createdName:gold") !== true, effect(ctx: ScriptCtx) { ctx.destroySelf(); const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("loan", "Discard a card or lose 2 life", ["Lose 2 life", ...hand.map((card) => card.instanceId)]); else ctx.loseLife(ctx.seat, 2); } }], onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "loan") { if (option === "Lose 2 life") ctx.loseLife(ctx.seat, 2); else ctx.discardCard(ctx.seat, Number(option)); } } },
  "tip the barkeep|3": {
    onPlay(ctx: ScriptCtx) {
      ctx.createToken(GOLDKISS_RUM);
      const gold = controlledGold(ctx);
      if (gold.length) {
        ctx.requestCardChoice(
          "tip-gold",
          "Give a Gold token you control to another hero?",
          ["pass", ...gold.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "tip-gold" || option === "pass") return;
      if (ctx.giveControl(Number(option), opponentSeat(ctx))) {
        ctx.putOnDeckBottom(ctx.self.instanceId);
      }
    },
  },
  "sunken treasure|3": { onDefend(ctx: ScriptCtx) { const cards = ctx.state.players.flatMap((player) => player.graveyard.filter((card) => !card.faceDown)); if (cards.length) ctx.requestCardChoice("sunken", "Turn a graveyard card face-down?", ["pass", ...cards.map((card) => card.instanceId)]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook !== "sunken" || option === "pass") return; const card = ctx.state.players.flatMap((player) => player.graveyard).find((candidate) => candidate.instanceId === Number(option)); if (card && ctx.setCardFaceDown(card.instanceId, true) && ctx.cardColor(card) === 2) createGold(ctx); } },
  "sea legs|2": {
    triggers: [{
      event: "card-discarded",
      sourceZone: "graveyard",
      label: "Create a Goldkiss Rum token",
      condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
      effect: (ctx) => ctx.createToken(GOLDKISS_RUM),
    }],
  },
  "midas touch|2": { playTargetOptions: (ctx: ScriptCtx) => ctx.state.players.flatMap((player) => player.board.filter((card) => isAlly(ctx, card)).map((card) => card.instanceId)), onPlay(ctx: ScriptCtx) { const target = ctx.state.players.flatMap((player) => player.board).find((card) => card.instanceId === ctx.playTargetInstanceId); if (!target) return; const cost = data(ctx, target).cost ?? 0; if (ctx.destroyPermanent(target.instanceId)) ctx.createTokens(GOLD, cost, target.owner); } },
  "amethyst amulet|3": seaAmulet((ctx) => buffNextAttack(ctx, { attack: 2 }), "instant"),
  "diamond amulet|3": seaAmulet((ctx) => ctx.changeActionPoints(ctx.seat, 1), "instant"),
  "onyx amulet|3": seaAmulet((ctx) => { for (const p of ctx.state.players) { ctx.tap(p.hero.instanceId); for (const ally of p.board.filter((card) => isAlly(ctx, card))) ctx.tap(ally.instanceId); } }),
  "opal amulet|3": seaAmulet((ctx) => { for (const card of ctx.player(ctx.seat).deck.slice(0, 2)) ctx.lookAt(card.instanceId); }),
  "pearl amulet|3": seaAmulet((ctx) => { const cards = ctx.state.players.flatMap((p) => [p.hero, ...p.board, ...p.weapons]); if (cards.length) ctx.requestCardChoice("pearl", "Untap a permanent", cards.map((card) => card.instanceId)); }),
  "platinum amulet|3": seaAmulet((ctx) => { const cards = ctx.link ? [...ctx.link.defendingCards, ...ctx.link.defendingEquipment] : []; if (cards.length) ctx.requestCardChoice("platinum", "Give a defender +1 defense", cards.map((card) => card.instanceId)); }, "instant"),
  "pounamu amulet|3": seaAmulet((ctx) => ctx.gainLife(ctx.seat, 2)),
  "ruby amulet|3": seaAmulet((ctx) => ctx.changeResources(ctx.seat, 2), "instant"),
  "sapphire amulet|3": seaAmulet((ctx) => ctx.setFlag("player", "sapphireIntellect", true)),
  "bam bam|2": { ...destroyItemOnHit(), activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "clubsDestroyItems", true); } } },
  "surface shaking|3": { onEnterArena(ctx: ScriptCtx) { ctx.createTokens("SBR035", 3); }, triggers: [{ event: "begin-action-phase", label: "Resolve Surface Shaking", effect(ctx: ScriptCtx) { ctx.destroySelf(); } }] },
  "preach modesty|1": { onEnterArena(ctx: ScriptCtx) { ctx.setCounter("balance", 1); }, triggers: [{ event: "begin-action-phase", label: "Remove balance or destroy", effect(ctx: ScriptCtx) { if (ctx.getCounter("balance") > 0) ctx.setCounter("balance", 0); else ctx.destroySelf(); } }] },
  "escalate bloodshed|1": { onOpponentDraws(ctx: ScriptCtx, seat: number, count: number) { if (ctx.state.phase === "action") ctx.loseLife(seat, count); }, onFriendlyDraws(ctx: ScriptCtx, count: number) { if (ctx.state.phase === "action") ctx.loseLife(ctx.seat, count); }, triggers: [{ event: "begin-action-phase", whose: "any", label: "Draw a card", effect(ctx: ScriptCtx) { ctx.drawCards(ctx.state.activePlayer, 1); } }] },
  "deny redemption|1": { onAttackDeclared(ctx: ScriptCtx) { if (ctx.link?.targetAllyId === undefined && ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, unpreventable: true }); }, activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx: ScriptCtx) { ctx.setFlag("player", "heroesCannotGainLife", true); } } },
  "burn bare|0": {
    arcaneDamageEffect: true,
    onPlay(ctx: ScriptCtx) { seaTargets(ctx, "burn", `Choose a target for ${ctx.previewArcaneDamage(6)} arcane damage`); },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: "Discard: destroy the attacking phantasm",
      canActivate(ctx) {
        const link = ctx.link;
        return !!link &&
          link.attacker !== ctx.seat &&
          link.targetAllyId === undefined &&
          (data(ctx, link.attackingCard).keywords ?? [])
            .some((keyword) => keyword.toLowerCase() === "phantasm");
      },
      onActivate(ctx) {
        ctx.destroyAttackingCard();
      },
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook === "burn") dealSeaTarget(ctx, option, 6, true);
    },
  },
  "riddle with regret|1": { triggers: [{ event: "end-of-turn", whose: "any", label: "Lose life for auras", effect(ctx: ScriptCtx) { const seat = ctx.state.activePlayer; const count = ctx.player(seat).board.filter((card) => hasTag(ctx, card, "aura")).length; ctx.loseLife(seat, count); if (count >= 3) ctx.destroySelf(); } }] },
  "claw of vynserakai|0": { ...attackAbility(1, { oncePerTurn: true }), preventArcaneDamageWhileActive: 1 },
  "everbloom // life|3": { meld: { leftName: "Everbloom", rightName: "Life", leftCardType: "action", rightCardType: "instant" }, onPlay(ctx: ScriptCtx) { if (ctx.self.meldSide !== "left") ctx.gainLife(ctx.seat, 1); if (ctx.self.meldSide !== "right") { const gained = Number(ctx.getPlayerFlag(ctx.seat, "lifeGainedThisTurn")); const cards = ctx.state.players.flatMap((player) => player.graveyard).filter((card) => ctx.hasCardType(card, "action") && (data(ctx, card).cost ?? 0) < gained); if (cards.length) ctx.requestCardChoice("everbloom", "Put an action on the bottom", cards.map((card) => card.instanceId)); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "everbloom") ctx.putOnDeckBottom(Number(option)); } },
  "consign to cosmos // shock|2": { meld: { leftName: "Consign to Cosmos", rightName: "Shock", leftCardType: "action", rightCardType: "instant" }, arcaneDamageEffect: true, onPlay(ctx: ScriptCtx) { if (ctx.self.meldSide !== "left") seaTargets(ctx, "consign", `Choose a target for ${ctx.previewArcaneDamage(1)} arcane damage`); if (ctx.self.meldSide !== "right") { const amount = Number(ctx.getPlayerFlag(ctx.seat, `arcaneDamageAmountToSeat:${opponentSeat(ctx)}`)); const cards = ctx.state.players.flatMap((player) => player.graveyard).filter((card) => ctx.hasCardType(card, "instant") || hasTag(ctx, card, "aura")); for (const card of cards.slice(0, amount)) ctx.banish(card.instanceId); } }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "consign") dealSeaTarget(ctx, option, 1, true); } },
  "herald of sekem|1": { onAttackDeclared(ctx: ScriptCtx) { const yellow = ctx.player(ctx.seat).hand.filter((card) => ctx.cardColor(card) === 2); if (yellow.length) ctx.requestCardChoice("sekem", "Put a yellow card into your soul?", ["pass", ...yellow.map((card) => card.instanceId)]); }, onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "sekem" && option !== "pass" && ctx.putIntoSoul(Number(option))) seaTargets(ctx, "sekem-target", `Choose a target for ${ctx.previewArcaneDamage(2)} arcane damage`); else if (hook === "sekem-target") dealSeaTarget(ctx, option, 2, true); } },
  "arcane compliance|3": { onPlay(ctx: ScriptCtx) { ctx.setFlag("player", "arcaneCompliance", true); } },
} satisfies Record<string, CardScript>);

sea["pearl amulet|3"]!.onChoose = (ctx, hook, option) => { if (hook === "pearl") ctx.untap(Number(option)); };
sea["platinum amulet|3"]!.onChoose = (ctx, hook, option) => { if (hook === "platinum") ctx.addCardTempDefense(Number(option), 1); };
