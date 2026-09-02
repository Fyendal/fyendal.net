import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, decisionPrompt, opponentSeat, yesNoPrompt } from "./shared-helpers.js";

const COURAGE = "SBL035";
const VIGOR = "SDO036";
const GOLD = "SGB035";

type Card = DeepReadonly<CardInstance>;

function isSword(ctx: ScriptCtx, card: Card): boolean {
  return ctx.cardTypes(card).some((type) => type.toLowerCase() === "sword");
}

function attached(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some((modifier) =>
    modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
  );
}

function consumeArmedSource(ctx: ScriptCtx): boolean {
  const marker = ctx.state.modifiers.find((modifier) =>
    modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn",
  );
  return marker ? ctx.consumeModifier(marker.id) : false;
}

function controlledPermanents(ctx: ScriptCtx): Card[] {
  const player = ctx.player(ctx.seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ];
}

function nextWager(
  power: number,
  appliesTo: "sword" | "warrior",
  optional: boolean,
  rewardLabel: string,
  reward: (ctx: ScriptCtx, winner: number) => void,
): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: power,
        ...(appliesTo === "sword" ? { appliesToSubtype: "sword" } : { appliesToClass: "warrior" }),
      });
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (optional && ctx.link?.targetAllyId !== undefined && attached(ctx)) consumeArmedSource(ctx);
    },
    triggers: [{
      event: "attack-declared",
      optional,
      label: optional ? "Wager with the defending hero?" : "Wager with the defending hero",
      condition: (ctx) => (!optional || ctx.link?.targetAllyId === undefined) && attached(ctx),
      onTrigger: (ctx) => { consumeArmedSource(ctx); },
      effect: (ctx) => { ctx.wager(opponentSeat(ctx), [], rewardLabel); },
    }],
    onWagerResolved(ctx, winner) { reward(ctx, winner); },
  };
}

function wagerReaction(
  power: number,
  rewardLabel: string,
  reward: (ctx: ScriptCtx, winner: number) => void,
): CardScript {
  return {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "weapon" && isSword(ctx, ctx.link.attackingCard),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: power });
      ctx.wager(opponentSeat(ctx), [], rewardLabel);
    },
    onWagerResolved(ctx, winner) { reward(ctx, winner); },
  };
}

function prizeworn(token: string): CardScript {
  return {
    triggers: [{
      event: "wager-won",
      label: `Tap your hero and destroy this to create ${token === VIGOR ? "Vigor" : "Courage"}?`,
      effect(ctx) {
        if (!ctx.player(ctx.seat).hero.tapped) {
          ctx.requestChoice("prizeworn", yesNoPrompt(`${ctx.data.name}: tap your hero and destroy this?`, "card.aol.hero.tap.destroy", { card: { kind: "card", cardId: ctx.self.cardId } }), ["yes", "no"]);
        }
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "prizeworn" || option !== "yes") return;
      ctx.tap(ctx.player(ctx.seat).hero.instanceId);
      ctx.destroySelf();
      ctx.createToken(token);
    },
  };
}

function alternativeGold(): CardScript["alternativePlayCost"] {
  return { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }] };
}

export const aol: Record<string, CardScript> = {
  "olympia, prized fighter|0": {
    triggers: [{
      event: "wager-won",
      label: "Create a Gold token",
      condition(ctx) {
        return ctx.link?.attacker === ctx.seat &&
          ctx.getFlag("link", `olympiaGold:${ctx.self.instanceId}`) !== true;
      },
      onTrigger(ctx) {
        ctx.setFlag("link", `olympiaGold:${ctx.self.instanceId}`, true);
      },
      effect(ctx) { ctx.createToken(GOLD); },
    }],
  },
  "golden grail|0": {
    activated: {
      cost: 2,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      alternativeEffectCardCosts: [
        { zone: "arena", move: "destroy", count: 1, name: "Gold", prompt: decisionPrompt("Destroy a Gold", "card.common.cost.gold.destroy") },
      ],
    },
    modifyAttack: (ctx) => ctx.getFlag("link", "wagered") === true ? 1 : 0,
  },
  "prizeworn plating|0": prizeworn(VIGOR),
  "prizeworn gauntlet|0": prizeworn(COURAGE),
  "prizeworn pathfinders|0": {
    triggers: [{
      event: "wager-won",
      label: "Pay 1 to remove a -1 defense counter?",
      effect(ctx) {
        if ((ctx.self.defCounters ?? 0) > 0) {
          ctx.requestPayment("pathfinders", decisionPrompt("Pay 1 to remove a -1 defense counter?", "card.aol.defensecounter.pay", { values: { amount: 1 } }), 1);
        }
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "pathfinders" && option === "paid") {
        ctx.addCardDefenseCounters(ctx.self.instanceId, -1);
      }
    },
  },
  "into the muck|1": {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.getFlag("link", "wagered") === true && ctx.link.defendingCards.some((card) => ctx.cardData(card.cardId).cardType !== "equipment"),
    onPlay(ctx) {
      const defenders = (ctx.link?.defendingCards ?? []).filter(
        (card) => ctx.cardData(card.cardId).cardType !== "equipment",
      );
      if (defenders.length === 1) ctx.banish(defenders[0]!.instanceId);
      else if (defenders.length > 1) ctx.requestCardChoice("muck", decisionPrompt("Banish a non-equipment defending card", "card.aol.defender.nonequipment.banish"), defenders.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "muck") ctx.banish(Number(option)); },
  },
  "belly buster|1": nextWager(3, "warrior", true, "Winner creates Courage", (ctx, winner) => { if (winner >= 0) ctx.createToken(COURAGE, winner); }),
  "belly buster|3": nextWager(1, "warrior", true, "Winner creates Courage", (ctx, winner) => { if (winner >= 0) ctx.createToken(COURAGE, winner); }),
  "big slick|1": nextWager(5, "sword", false, "Winner draws a card", (ctx, winner) => { if (winner >= 0) ctx.drawCards(winner, 1); }),
  "check-raise|1": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    triggers: [{ event: "wager-generated", label: "The wagering attack gets +4", onTrigger: (ctx) => { consumeArmedSource(ctx); }, effect: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 4 }) }],
  },
  "check-raise|2": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    triggers: [{ event: "wager-generated", label: "The wagering attack gets +3", onTrigger: (ctx) => { consumeArmedSource(ctx); }, effect: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 3 }) }],
  },
  "check-raise|3": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    triggers: [{ event: "wager-generated", label: "The wagering attack gets +2", onTrigger: (ctx) => { consumeArmedSource(ctx); }, effect: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 2 }) }],
  },
  "heads up|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    triggers: [{
      event: "wager-generated",
      label: "If it wagered, it gets dominate",
      condition: (ctx) => attached(ctx),
      effect: (ctx) => ctx.addModifier({ scope: "chain-link", dominate: true }),
    }],
  },
  "drawing dead|2": wagerReaction(1, "Winner discards a card", (ctx, winner) => {
    const hand = winner >= 0 ? ctx.player(winner).hand : [];
    if (hand.length) {
      ctx.setCounter("decisionSeat", winner);
      ctx.requestCardChoice("drawing-discard", decisionPrompt("Discard a card", "card.aol.card.discard"), hand.map((card) => card.instanceId), winner);
    }
  }),
  "bluff catcher|2": {
    alternativePlayCost: alternativeGold(),
    ...nextWager(3, "sword", false, "Winner gets +1 intellect during their next end phase", (ctx, winner) => {
      if (winner < 0) return;
      const target = ctx.player(winner);
      const targetTurn = winner === ctx.state.activePlayer ? ctx.state.turn : ctx.state.turn + 1;
      ctx.setCardCounter(target.hero.instanceId, "bonusIntellectAtEndPhaseTurn", targetTurn);
    }),
  },
  "donkey|3": wagerReaction(1, "Winner destroys a card in their arsenal", (ctx, winner) => {
    const arsenal = winner >= 0 ? ctx.player(winner).arsenal : [];
    if (arsenal.length === 1) ctx.moveToGraveyard(arsenal[0]!.instanceId, "arsenal");
    else if (arsenal.length > 1) {
      ctx.setCounter("decisionSeat", winner);
      ctx.requestCardChoice("donkey-arsenal", decisionPrompt("Choose an arsenal card to destroy", "card.aol.arsenal.card.destroy"), arsenal.map((card) => card.instanceId), winner);
    }
  }),
  "shove off|3": {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "weapon" && isSword(ctx, ctx.link.attackingCard) && ctx.link.defendingCards.length > 0,
    onPlay(ctx) {
      const defenders = ctx.link?.defendingCards ?? [];
      if (defenders.length === 1) ctx.moveToHand(defenders[0]!.instanceId);
      else ctx.requestCardChoice("shove", decisionPrompt("Return a defending card to hand", "card.aol.defender.return"), defenders.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "shove") ctx.moveToHand(Number(option)); },
  },
  "golden company|3": { alternativePlayCost: alternativeGold() },
  "odds on favorite|3": nextWager(0, "sword", false, "Winner searches their deck for a card and puts it on top", (ctx, winner) => {
    if (winner < 0) return;
    const deck = ctx.player(winner).deck;
    if (!deck.length) return;
    ctx.setCounter("decisionSeat", winner);
    ctx.requestCardChoice("odds-top", decisionPrompt("Choose a card to put on top", "card.aol.deck.card.top"), deck.map((card) => card.instanceId), winner);
  }),
  "rake back|3": {
    alternativePlayCost: alternativeGold(),
    ...nextWager(2, "sword", false, "Winner may equip an equipment card from their graveyard", (ctx, winner) => {
      const equipment = winner >= 0 ? ctx.player(winner).graveyard.filter((card) => ctx.cardData(card.cardId).cardType === "equipment") : [];
      if (equipment.length) {
        ctx.setCounter("decisionSeat", winner);
        ctx.requestCardChoice("rake-equip", decisionPrompt("Equip an equipment from your graveyard?", "card.aol.graveyard.equipment.equip", { optionMessages: commonOptionMessages("no") }), ["no", ...equipment.map((card) => card.instanceId)], winner);
      }
    }),
  },
  "visit the prize room|3": {
    onPlay(ctx) {
      const gold = controlledPermanents(ctx).filter((card) => ctx.cardNames(card).includes("gold"));
      const galea = (ctx.player(ctx.seat).inventory ?? []).find((card) =>
        ctx.cardData(card.cardId).name === "Prized Galea"
      );
      if (gold.length > 0 && galea) {
        ctx.setCounter("prizedGalea", galea.instanceId);
        ctx.requestCardChoice("visit-gold", decisionPrompt("Visit the Prize Room: destroy a Gold to equip Prized Galea?", "card.aol.gold.destroy.galea", { optionMessages: commonOptionMessages("no") }), ["no", ...gold.map((card) => card.instanceId)]);
      }
      ctx.createToken(VIGOR);
      ctx.createToken(COURAGE);
    },
    onChoose(ctx, hook, option) {
      if (hook === "visit-gold" && option !== "no" && ctx.destroyPermanent(Number(option))) {
        ctx.equipFromInventory(ctx.getCounter("prizedGalea"));
      }
    },
  },
};

// Winner decisions shared by the wager cards above.
for (const script of Object.values(aol)) {
  const original = script.onChoose;
  script.onChoose = (ctx, hook, option) => {
    original?.(ctx, hook, option);
    if (hook === "drawing-discard") ctx.discardCard(ctx.getCounter("decisionSeat"), Number(option));
    if (hook === "donkey-arsenal") ctx.moveToGraveyard(Number(option), "arsenal");
    if (hook === "odds-top") { ctx.shuffleDeck(ctx.getCounter("decisionSeat")); ctx.putOnDeckTop(Number(option)); }
    if (hook === "rake-equip" && option !== "no") ctx.equipFromGraveyard(Number(option));
  };
}
