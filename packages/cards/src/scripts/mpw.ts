import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  opponentSeat,
  yesNoPrompt,
} from "./shared-helpers.js";
import { SHARPEN_FOLLOWUP, sharpenSword } from "./aha/warrior-sharpen.js";

const BLADE_DANCE = "MPW134";
const FLURRY = "MPW135";

type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card) { return ctx.cardData(card.cardId); }
function hasType(ctx: ScriptCtx, card: Card, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function isSword(ctx: ScriptCtx, card: Card): boolean { return hasType(ctx, card, "sword"); }
function isWeaponAttack(ctx: ScriptCtx): boolean { return ctx.link?.attackCardType === "weapon"; }
function isSwordAttack(ctx: ScriptCtx): boolean {
  return isWeaponAttack(ctx) && !!ctx.link && isSword(ctx, ctx.link.attackingCard);
}
function swords(ctx: ScriptCtx): readonly Card[] {
  return ctx.player(ctx.seat).weapons.filter((card) => isSword(ctx, card));
}
function controlledNamed(ctx: ScriptCtx, name: string): readonly Card[] {
  const player = ctx.player(ctx.seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ].filter((card) => ctx.cardNames(card).includes(name.toLowerCase()));
}

function chooseSword(
  ctx: ScriptCtx,
  hook: string,
  finish: (ctx: ScriptCtx, instanceId: number) => void = sharpenSword,
): void {
  const choices = swords(ctx);
  if (choices.length === 1) finish(ctx, choices[0]!.instanceId);
  else if (choices.length > 1) {
    ctx.requestCardChoice(
      hook,
      decisionPrompt(
        `${ctx.data.name}: choose a sword`,
        "card.mpw.sword.choose",
        { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
      ),
      choices.map((card) => card.instanceId),
    );
  }
}

function weaponReaction(power: number, effect?: (ctx: ScriptCtx, weapon: Card) => void): CardScript {
  return {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && isWeaponAttack(ctx),
    onPlay(ctx) {
      const weapon = ctx.link?.attackingCard;
      if (!weapon) return;
      if (power) ctx.addModifier({ scope: "chain-link", attack: power });
      effect?.(ctx, weapon);
    },
  };
}

function swordReaction(power: number, effect?: (ctx: ScriptCtx, weapon: Card) => void): CardScript {
  const base = weaponReaction(power, effect);
  return { ...base, canPlay: (ctx) => ctx.link?.attacker === ctx.seat && isSwordAttack(ctx) };
}

function consumeMarker(ctx: ScriptCtx, scope: "until-end-of-turn" | "chain-link" = "until-end-of-turn") {
  const marker = ctx.state.modifiers.find((modifier) =>
    modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === scope && !modifier.consumed
  );
  if (marker) ctx.consumeModifier(marker.id);
  return marker;
}

function alternativeGold(): CardScript["alternativePlayCost"] {
  return { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }] };
}

function nextWager(
  power: number,
  rewardLabel: string,
  reward: (ctx: ScriptCtx, winner: number) => void,
): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: power, appliesToSubtype: "sword" });
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    triggers: [{
      event: "attack-declared",
      label: "Wager with the defending hero",
      condition: (ctx) => ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"
      ),
      effect: (ctx) => ctx.wager(opponentSeat(ctx), [], rewardLabel),
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
    ...swordReaction(power, (ctx) => ctx.wager(opponentSeat(ctx), [], rewardLabel)),
    onWagerResolved(ctx, winner) { reward(ctx, winner); },
  };
}

function sharpenAction(
  threshold: number,
  reward: "blade" | "flurry" | "discount",
): CardScript {
  const finish = (ctx: ScriptCtx, id: number) => {
    sharpenSword(ctx, id, 1, {
      threshold,
      kind: reward === "blade"
        ? SHARPEN_FOLLOWUP.BLADE_DANCE
        : reward === "flurry"
          ? SHARPEN_FOLLOWUP.MPW_FLURRY
          : SHARPEN_FOLLOWUP.DISCOUNT,
    });
  };
  return {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay: (ctx) => chooseSword(ctx, "mpw-sharpen", finish),
    onChoose(ctx, hook, option) { if (hook === "mpw-sharpen") finish(ctx, Number(option)); },
  };
}

function displayOfArtistry(power: number): CardScript {
  return weaponReaction(power, (ctx, weapon) => {
    if (Number(weapon.counters?.sharpenedTurn) !== ctx.state.turn) return;
    ctx.addModifier({ scope: "chain-link", defense: -1, appliesToCardType: "attack-reaction" });
    ctx.addModifier({ scope: "chain-link", defense: -1, appliesToCardType: "defense-reaction" });
  });
}

function silverdrop(power: number): CardScript {
  return {
    ...weaponReaction(power),
    modifyPlayCost(ctx, base) {
      return Number(ctx.link?.attackingCard.counters?.sharpenedTurn) === ctx.state.turn
        ? Math.max(0, base - 1)
        : base;
    },
  };
}

function smallOrBigBlinder(power: number, token: string, tokenName: string): CardScript {
  return wagerReaction(power, `Winner creates ${tokenName}`, (ctx, winner) => { if (winner >= 0) ctx.createToken(token, winner); });
}

function onHitRemoveCounter(effect: (ctx: ScriptCtx, target: number) => void): CardScript {
  return {
    ...weaponReaction(0, (ctx) => ctx.addModifier({ scope: "chain-link" })),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined &&
        Number(ctx.link?.attackingCard.counters?.power ?? 0) >= 1 &&
        ctx.state.modifiers.some((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId &&
          modifier.scope === "chain-link" &&
          !modifier.consumed
        );
    },
    onHit(ctx) {
      consumeMarker(ctx, "chain-link");
      ctx.addCounter(ctx.link!.attackingCard.instanceId, "power", -1);
      effect(ctx, opponentSeat(ctx));
    },
  };
}

function oldeLeather(): CardScript {
  return { modifyDefense: (ctx) => Number(ctx.getPlayerFlag(opponentSeat(ctx), "attacksDeclaredThisTurn")) >= 2 ? 2 : 0 };
}

export const mpw: Record<string, CardScript> = {
  "hala|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: true, tap: true,
      canActivate: (ctx) => swords(ctx).length > 0,
      onActivate: (ctx) => chooseSword(ctx, "hala-sharpen"),
    },
    onChoose(ctx, hook, option) { if (hook === "hala-sharpen") sharpenSword(ctx, Number(option)); },
  },
  "durendal|0": {
    activated: attackAbility(1),
    modifyDefendingDefense(ctx, defending) {
      if (Number(ctx.self.counters?.power ?? 0) < 1) return 0;
      const cardType = data(ctx, defending).cardType;
      return cardType === "attack-reaction" || cardType === "defense-reaction" ? -1 : 0;
    },
  },
  "blunt retort|0": {
    canTriggerOnDefend: isWeaponAttack,
    onDefend(ctx) {
      if (Number(ctx.link?.attackingCard.counters?.power ?? 0) > 0) {
        ctx.requestChoice(
          "blunt-retort",
          yesNoPrompt(
            "Remove a +1 power counter from the attacking weapon?",
            "card.mpw.blunt.counter.remove",
          ),
          ["yes", "no"],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "blunt-retort" && option === "yes" && ctx.link) {
        ctx.addCounter(ctx.link.attackingCard.instanceId, "power", -1);
      }
    },
  },
  "edge laden plate|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => swords(ctx).some((sword) => Number(sword.counters?.sharpenedTurn) === ctx.state.turn),
      onActivate: (ctx) => ctx.changeResources(ctx.seat, 1),
    },
  },
  "duelist gauntlets|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true,
      canActivate: (ctx) => isSwordAttack(ctx),
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", defense: -1, appliesToCardType: "attack-reaction" });
        ctx.addModifier({ scope: "chain-link", defense: -1, appliesToCardType: "defense-reaction" });
      },
    },
  },
  "longsword leggings|0": {
    activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) {
      ctx.requestChoice(
        "longsword-token",
        decisionPrompt(
          "Create which token?",
          "card.mpw.token.create.choose",
          {
            optionMessages: {
              "Blade Dance": decisionMessage("card.common.target.card", {
                card: { kind: "card", cardId: BLADE_DANCE },
              }),
              Flurry: decisionMessage("card.common.target.card", {
                card: { kind: "card", cardId: FLURRY },
              }),
            },
          },
        ),
        ["Blade Dance", "Flurry"],
      );
    } },
    onChoose(ctx, hook, option) {
      if (hook === "longsword-token") ctx.createToken(option === "Flurry" ? FLURRY : BLADE_DANCE);
    },
  },
  "hot top|0": {
    canTriggerOnDefend: isWeaponAttack,
    onDefend(ctx) {
      const reactions = ctx.player(ctx.seat).graveyard.filter((card) => data(ctx, card).cardType === "attack-reaction");
      if (reactions.length) ctx.requestCardChoice(
        "hot-top",
        decisionPrompt(
          "Put an attack reaction on top of your deck?",
          "card.mpw.reaction.top",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...reactions.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) { if (hook === "hot-top" && option !== "no") ctx.putOnDeckTop(Number(option)); },
  },
  "heart of bladehold|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: true, destroySelfCost: true,
      canActivate: (ctx) => Number(ctx.getFlag("player", "weaponAttackCount")) === 1,
      onActivate: (ctx) => buffNextAttack(ctx, { attackActivationCostReduction: 99, appliesToSubtype: "sword" }),
    },
  },
  "dealer's grip|0": {
    activated: {
      cost: 2, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.attacker === ctx.seat && ctx.getFlag("link", "wagered") === true,
      onActivate: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 }),
    },
  },
  "overwhelming swing|2": {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && isWeaponAttack(ctx),
    modifyPlayCost: (ctx, base) => base + (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0),
    onPlay(ctx) {
      const defenders = (ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0);
      ctx.addModifier({ scope: "chain-link", attack: defenders * 2 + 1 });
    },
  },
  "point of escalation|2": swordReaction(0, (ctx) => {
    const sword = ctx.link?.attackingCard;
    if (sword) ctx.addModifier({ scope: "chain-link", attack: 2 * Number(ctx.getFlag("player", `attackedInstance:${sword.instanceId}`)) });
  }),
  "sharpening sparks|1": {
    ...swordReaction(2, (ctx) => ctx.addModifier({ scope: "chain-link" })),
    canTriggerOnHit(ctx) { return !!ctx.link && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link" && !modifier.consumed); },
    onHit(ctx) { consumeMarker(ctx, "chain-link"); sharpenSword(ctx, ctx.link!.attackingCard.instanceId); },
  },
  "all in|1": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    onFriendlyAttackDeclared(ctx) {
      const marker = ctx.state.modifiers.find((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn" && !modifier.consumed);
      if (!isSwordAttack(ctx) || !marker || ctx.getCounter("allInUsed") > 0) return;
      ctx.setCounter("allInUsed", 1);
      const gold = [...controlledNamed(ctx, "Gold")];
      for (const token of gold) ctx.destroyPermanent(token.instanceId);
      if (gold.length) ctx.addModifier({ scope: "chain-link", attack: gold.length * 2 });
      ctx.setFlag("link", "mpwAllIn", true);
    },
    onAttackResolved(ctx) {
      if (ctx.link?.flags.mpwAllIn !== true) return;
      if (!ctx.link.hit) ctx.loseGame(ctx.seat);
      consumeMarker(ctx);
    },
  },
  "and again...|3": {
    canPlay: (ctx) => swords(ctx).some((sword) =>
      Number(sword.counters?.sharpenedTurn) === ctx.state.turn &&
      Number(ctx.getFlag("player", `attackedInstance:${sword.instanceId}`)) > 0
    ),
    playTargetOptions(ctx) {
      return swords(ctx).filter((sword) =>
        Number(sword.counters?.sharpenedTurn) === ctx.state.turn &&
        Number(ctx.getFlag("player", `attackedInstance:${sword.instanceId}`)) > 0
      ).map((sword) => sword.instanceId);
    },
    onPlay(ctx) { if (ctx.playTargetInstanceId !== undefined) ctx.attackWithPermanent(ctx.playTargetInstanceId); },
  },
  "drawn to the blade|2": {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay: (ctx) => chooseSword(ctx, "drawn-sharpen", (inner, id) => {
      sharpenSword(inner, id, 1, {
        threshold: 2,
        kind: SHARPEN_FOLLOWUP.DRAW_ON_HIT,
      });
    }),
    onChoose(ctx, hook, option) {
      if (hook !== "drawn-sharpen") return;
      sharpenSword(ctx, Number(option), 1, {
        threshold: 2,
        kind: SHARPEN_FOLLOWUP.DRAW_ON_HIT,
      });
    },
  },
  "honed for honor|3": {
    canPlay: (ctx) => swords(ctx).length > 0,
    onPlay: (ctx) => chooseSword(ctx, "honed-sharpen", (inner, id) => {
      sharpenSword(inner, id, 1, {
        threshold: 3,
        kind: SHARPEN_FOLLOWUP.TOP_ATTACK_REACTION,
      });
    }),
    onChoose(ctx, hook, option) {
      if (hook === "honed-sharpen") {
        sharpenSword(ctx, Number(option), 1, {
          threshold: 3,
          kind: SHARPEN_FOLLOWUP.TOP_ATTACK_REACTION,
        });
      } else if (hook === "honed-top" && option !== "no") ctx.putOnDeckTop(Number(option));
    },
  },
  "raise blades|1": {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) ctx.requestCardChoice(
        "raise-top",
        decisionPrompt(
          "Put a hand card on top of your deck",
          "card.mpw.hand.top",
        ),
        hand.map((card) => card.instanceId),
      );
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" });
    },
    onChoose(ctx, hook, option) { if (hook === "raise-top") ctx.putOnDeckTop(Number(option)); },
  },
  "terms of combat|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesTo: "weapon" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    triggers: [{
      event: "card-played",
      whose: "any",
      label: "Draw a card",
      condition: (ctx, played, event) => event?.causedBySeat !== ctx.seat &&
        ctx.link?.attacker === ctx.seat &&
        !!played &&
        data(ctx, played).cardType === "defense-reaction",
      effect: (ctx) => ctx.drawCards(ctx.seat, 1),
    }],
    onOpponentActivate(ctx, _activated, timing) { if (ctx.link?.attacker === ctx.seat && timing === "defense-reaction") ctx.drawCards(ctx.seat, 1); },
  },
  "lessons learned|3": {
    onPlay(ctx) {
      const reactions = ctx.player(ctx.seat).graveyard.filter((card) => data(ctx, card).cardType === "attack-reaction");
      if (reactions.length) ctx.requestCardChoice(
        "lessons-learned",
        decisionPrompt(
          "Shuffle an attack reaction into your deck?",
          "card.mpw.reaction.shuffle",
          { optionMessages: commonOptionMessages("done") },
        ),
        ["done", ...reactions.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "lessons-learned") return;
      const count = ctx.getCounter("lessonsCount");
      if (option === "done") {
        if (count > 0) ctx.shuffleDeck();
        return;
      }
      const chosen = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
      if (!chosen || !ctx.putOnDeckBottom(chosen.instanceId)) return;
      ctx.setCounter("lessonsCount", count + 1);
      ctx.setCounter(`lessonsCard:${count}`, chosen.instanceId);
      if (count >= 2) {
        ctx.shuffleDeck();
        return;
      }
      const chosenNames = new Set(Array.from({ length: count + 1 }, (_, index) => {
        const id = ctx.getCounter(`lessonsCard:${index}`);
        const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === id);
        return card ? data(ctx, card).name : "";
      }));
      const remaining = ctx.player(ctx.seat).graveyard.filter((card) =>
        data(ctx, card).cardType === "attack-reaction" && !chosenNames.has(data(ctx, card).name)
      );
      if (remaining.length) ctx.requestCardChoice(
        "lessons-learned",
        decisionPrompt(
          "Shuffle another differently named attack reaction?",
          "card.mpw.reaction.shuffle.next",
          { optionMessages: commonOptionMessages("done") },
        ),
        ["done", ...remaining.map((card) => card.instanceId)],
      );
      else ctx.shuffleDeck();
    },
  },
  "stand tall|2": { modifyDefense: (ctx) => 2 * Number(ctx.getFlag("link", "reactionCount")) },
  "display of artistry|1": displayOfArtistry(3),
  "display of artistry|2": displayOfArtistry(2),
  "display of artistry|3": displayOfArtistry(1),
  "downswing|1": wagerReaction(1, "Winner loses 1 life", (ctx, winner) => { if (winner >= 0) ctx.loseLife(winner, 1); }),
  "quicksilver dance|3": swordReaction(0, (ctx, weapon) => {
    if (Number(weapon.counters?.power ?? 0) < 1) return;
    ctx.addCounter(weapon.instanceId, "power", -1); ctx.createToken(BLADE_DANCE); ctx.drawCards(ctx.seat, 1);
  }),
  "run through|1": swordReaction(0, (ctx) => { ctx.grantGoAgain(); buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }); }),
  "run through|3": swordReaction(0, (ctx) => { ctx.grantGoAgain(); buffNextAttack(ctx, { attack: 1, appliesToSubtype: "sword" }); }),
  "shimmer of the blade|1": {
    ...weaponReaction(3),
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate: (ctx) => { ctx.createToken(BLADE_DANCE); } },
  },
  "golden company|1": { alternativePlayCost: alternativeGold() },
  "golden company|2": { alternativePlayCost: alternativeGold() },
  "below the belt|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "warrior") && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
    },
  },
  "big slick|2": nextWager(4, "Winner draws a card", (ctx, winner) => { if (winner >= 0) ctx.drawCards(winner, 1); }),
  "big slick|3": nextWager(3, "Winner draws a card", (ctx, winner) => { if (winner >= 0) ctx.drawCards(winner, 1); }),
  "blade rush|2": {
    onPlay: (ctx) => ctx.addModifier({ scope: "until-end-of-turn" }),
    onFriendlyAttackDeclared(ctx) {
      if (!isSwordAttack(ctx)) return;
      const count = Number(ctx.getFlag("player", "weaponAttackCount"));
      if (count === 1) ctx.grantGoAgain();
      if (count === 2) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },
  "crimson waltz|2": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    onFriendlyAttackDeclared(ctx) {
      if (!isSwordAttack(ctx) || !consumeMarker(ctx)) return;
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) ctx.requestCardChoice(
        "waltz-top",
        decisionPrompt("Put a hand card on top", "card.mpw.hand.top"),
        hand.map((card) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) { if (hook === "waltz-top") ctx.putOnDeckTop(Number(option)); },
  },
  "off beat|3": {
    onPlay(ctx) {
      const tokens = ctx.player(ctx.seat).board.filter((card) => ["Blade Dance", "Flurry"].includes(data(ctx, card).name));
      const names = [...new Set(tokens.map((token) => data(ctx, token).name))];
      const options = ["none", ...names, ...(names.length === 2 ? ["both"] : [])];
      ctx.requestChoice(
        "off-beat-tokens",
        decisionPrompt(
          "Destroy up to one Blade Dance and/or Flurry?",
          "card.mpw.tokens.destroy",
          {
            optionMessages: {
              none: decisionMessage("common.option.none"),
              "Blade Dance": decisionMessage("card.common.target.card", {
                card: { kind: "card", cardId: BLADE_DANCE },
              }),
              Flurry: decisionMessage("card.common.target.card", {
                card: { kind: "card", cardId: FLURRY },
              }),
              both: decisionMessage("card.mpw.option.bothtokens"),
            },
          },
        ),
        options,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "off-beat-tokens") {
        if (option === "none") return;
        const wanted = option === "both" ? ["Blade Dance", "Flurry"] : [option];
        let count = 0;
        for (const name of wanted) {
          const token = ctx.player(ctx.seat).board.find((card) => data(ctx, card).name === name);
          if (token && ctx.destroyPermanent(token.instanceId)) count++;
        }
        ctx.setCounter("offBeatCount", count);
        if (count > 0) chooseSword(ctx, "off-beat", (inner, id) => sharpenSword(inner, id, count));
      } else if (hook === "off-beat") {
        sharpenSword(ctx, Number(option), ctx.getCounter("offBeatCount"));
      }
    },
  },
  "rest before battle|2": {
    canPlay: (ctx) => ctx.getFlag("player", "attackedWithWeaponThisTurn") === true,
    triggers: [{ event: "start-of-turn", label: "Destroy Rest Before Battle and draw", effect(ctx) { ctx.destroySelf(); ctx.drawCards(ctx.seat, 1); } }],
  },
  "shatter the weakpoint|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "warrior") && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) {
      const equipment = Object.values(ctx.player(opponentSeat(ctx)).equipment).filter((card): card is Card => !!card && (data(ctx, card).defense ?? 0) === 0);
      if (equipment.length) ctx.requestCardChoice(
        "shatter-equipment",
        decisionPrompt(
          "Destroy an equipment",
          "card.mpw.equipment.destroy",
        ),
        equipment.map((card) => card.instanceId),
      );
    },
    onChoose(ctx, hook, option) { if (hook === "shatter-equipment") ctx.destroyPermanent(Number(option)); },
  },
  "steel to the dome|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && hasType(ctx, ctx.player(opponentSeat(ctx)).hero, "warrior") && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); },
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length) ctx.requestCardChoice(
        "dome-discard",
        decisionPrompt("Discard a card", "card.common.card.discard.choose"),
        hand.map((card) => card.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) { if (hook === "dome-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "take the lead|1": {
    ...weaponReaction(3),
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && ctx.getFlag("link", "wagered") === true,
  },
  "a moment's peace|3": {
    canTriggerOnDefend: isSwordAttack,
    onDefend(ctx) {
      if (ctx.link) ctx.setPlayerFlag(ctx.link.attacker, `cannotAttackInstance:${ctx.link.attackingCard.instanceId}`, true);
    },
  },
  "big blinder|1": smallOrBigBlinder(4, FLURRY, "Flurry"),
  "big blinder|2": smallOrBigBlinder(3, FLURRY, "Flurry"),
  "big blinder|3": smallOrBigBlinder(2, FLURRY, "Flurry"),
  "carve up|2": onHitRemoveCounter((ctx, target) => {
    for (const card of [...ctx.player(target).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal");
  }),
  "deadly display|2": weaponReaction(2, (ctx, weapon) => {
    if (Number(weapon.counters?.sharpenedTurn) === ctx.state.turn) ctx.addModifier({ scope: "chain-link", onHitCreateToken: { cardId: FLURRY, count: 1 } });
  }),
  "dice up|3": onHitRemoveCounter((ctx, target) => {
    const auras = ctx.player(target).board.filter((card) => hasType(ctx, card, "aura"));
    if (auras.length) ctx.requestCardChoice(
      "dice-aura",
      decisionPrompt("Destroy an aura", "card.mpw.aura.destroy"),
      auras.map((card) => card.instanceId),
    );
  }),
  "silverdrop downpour|2": silverdrop(3),
  "silverdrop downpour|3": silverdrop(2),
  "slice up|1": onHitRemoveCounter((ctx, target) => {
    const hand = ctx.player(target).hand;
    if (hand.length) ctx.requestCardChoice(
      "slice-discard",
      decisionPrompt("Discard a card", "card.common.card.discard.choose"),
      hand.map((card) => card.instanceId),
      target,
    );
  }),
  "small blinder|1": smallOrBigBlinder(4, BLADE_DANCE, "Blade Dance"),
  "small blinder|2": smallOrBigBlinder(3, BLADE_DANCE, "Blade Dance"),
  "small blinder|3": smallOrBigBlinder(2, BLADE_DANCE, "Blade Dance"),
  "steel on steel|1": { modifyDefense: (ctx) => isWeaponAttack(ctx) ? 1 : 0 },
  "steel on steel|2": { modifyDefense: (ctx) => isWeaponAttack(ctx) ? 1 : 0 },
  "steel on steel|3": { modifyDefense: (ctx) => isWeaponAttack(ctx) ? 1 : 0 },
  "engage steel|1": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    modifyAttack(ctx) { return ctx.link?.defendingCards.some((card) => hasType(ctx, card, "warrior")) ? 1 : 0; },
  },
  "engage steel|2": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    modifyAttack(ctx) { return ctx.link?.defendingCards.some((card) => hasType(ctx, card, "warrior")) ? 1 : 0; },
  },
  "engage steel|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" }); ctx.addModifier({ scope: "until-end-of-turn" }); },
    modifyAttack(ctx) { return ctx.link?.defendingCards.some((card) => hasType(ctx, card, "warrior")) ? 1 : 0; },
  },
  "gutshot|1": nextWager(3, "Winner creates Blade Dance", (ctx, winner) => { if (winner >= 0) ctx.createToken(BLADE_DANCE, winner); }),
  "gutshot|2": nextWager(2, "Winner creates Blade Dance", (ctx, winner) => { if (winner >= 0) ctx.createToken(BLADE_DANCE, winner); }),
  "gutshot|3": nextWager(1, "Winner creates Blade Dance", (ctx, winner) => { if (winner >= 0) ctx.createToken(BLADE_DANCE, winner); }),
  "jive|3": { onPlay: (ctx) => { ctx.createToken(BLADE_DANCE); } },
  "sharp incline|3": sharpenAction(1, "discount"),
  "sharp 'n shine|1": sharpenAction(1, "blade"),
  "sharp 'n shine|2": sharpenAction(2, "blade"),
  "sharp 'n shine|3": sharpenAction(3, "blade"),
  "showdown|1": nextWager(3, "Winner creates Flurry", (ctx, winner) => { if (winner >= 0) ctx.createToken(FLURRY, winner); }),
  "showdown|2": nextWager(2, "Winner creates Flurry", (ctx, winner) => { if (winner >= 0) ctx.createToken(FLURRY, winner); }),
  "showdown|3": nextWager(1, "Winner creates Flurry", (ctx, winner) => { if (winner >= 0) ctx.createToken(FLURRY, winner); }),
  "swordmaster's path|2": { onPlay(ctx) { buffNextAttack(ctx, { attack: 2, appliesToSubtype: "sword" }); ctx.setFlag("player", "ahaExtraSharpen", true); } },
  "heavy swing|1": { triggers: [{ event: "start-of-turn", label: "Destroy Heavy Swing and empower a sword", effect(ctx) {
    ctx.destroySelf(); buffNextAttack(ctx, { attack: 3, appliesToSubtype: "sword" });
  } }] },
  "blade dance|0": { triggers: [{ event: "weapon-attack-activated", label: "Destroy Blade Dance for go again", effect(ctx) { ctx.destroySelf(); ctx.grantGoAgain(); } }] },
  "clip flexor|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "defense-reaction", destroySelfCost: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.some((card) => data(ctx, card).cardType === "attack-reaction"),
      onActivate(ctx) {
        const reactions = ctx.player(ctx.seat).hand.filter((card) => data(ctx, card).cardType === "attack-reaction");
        if (reactions.length) ctx.requestCardChoice(
          "clip-defender",
          decisionPrompt(
            "Add an attack reaction as a defender",
            "card.mpw.reaction.defender.add",
          ),
          reactions.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) { if (hook === "clip-defender") ctx.addDefenderFromHand(Number(option)); },
  },
  "vigilant dodgers|0": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true,
      canActivate: (ctx) => ctx.getPlayerFlag(opponentSeat(ctx), "attackedWithWeaponThisTurn") === true,
      onActivate: (ctx) => ctx.preventNextDamage(ctx.seat, 1),
    },
  },
  "olde leather helm|0": oldeLeather(),
  "olde leather plate|0": oldeLeather(),
  "olde leather gloves|0": oldeLeather(),
  "olde leather boots|0": oldeLeather(),
  "peaceful sanctuary|1": { prohibitsAuraTokenCreation: true, triggers: [{ event: "begin-action-phase", label: "Destroy Peaceful Sanctuary", effect: (ctx) => ctx.destroySelf() }] },
  "thwart|2": { onDefend(ctx) { if (ctx.link) ctx.setCardCounter(ctx.link.attackingCard.instanceId, "power", 0); } },
  "overbear|1": { onPlay: (ctx) => buffNextAttack(ctx, { appliesTo: "weapon", dominate: true }) },
};

for (const script of Object.values(mpw)) {
  const original = script.onChoose;
  script.onChoose = (ctx, hook, option) => {
    original?.(ctx, hook, option);
    if (hook === "dice-aura") ctx.destroyPermanent(Number(option));
    if (hook === "slice-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
  };
}
