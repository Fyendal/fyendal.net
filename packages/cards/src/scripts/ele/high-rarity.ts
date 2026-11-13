import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  attackArcaneHeroTrigger,
  buffNextAttack,
  commonOptionMessages,
  dealtByThis,
  decisionMessage,
  decisionPrompt,
  equippedCards,
  faceUpGraveyard,
  hasCardSubtype,
  heroTarget,
  isAttackAction,
  isFused,
  isFusedWith,
  ongoingLabel,
  opponentSeat,
  opposingHeroDamage,
  targetHeroSeat,
  withFusion,
} from "../shared-helpers.js";

const FROSTBITE = "SIY035";
const SEISMIC_SURGE = "CRU044";
const EMBODIMENT_OF_EARTH = "ELE109";
const EMBODIMENT_OF_LIGHTNING = "ELE110";

function playedAttackAndNonAttack(ctx: ScriptCtx): boolean {
  return (
    Number(ctx.getFlag("player", "attackActionsPlayedThisTurn")) > 0 &&
    Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) > 0
  );
}

function blossomingBanishChoice(ctx: ScriptCtx): void {
  const cards = faceUpGraveyard(ctx).filter((card) => ctx.hasCardType(card, "action") && !isAttackAction(ctx, card));
  if (cards.length)
    ctx.requestCardChoice(
      "blossoming-banish",
      decisionPrompt("Banish a non-attack action from your graveyard?", "card.ele.graveyard.nonattack.banish", {
        optionMessages: commonOptionMessages("no"),
      }),
      ["no", ...cards.map((card) => card.instanceId)],
    );
}

function channel(type: "earth" | "ice" | "lightning", extra: CardScript): CardScript {
  function maintain(ctx: ScriptCtx): void {
    const remaining = ctx.getState("channelRemaining");
    if (remaining <= 0) return;
    const cards = ctx.player(ctx.seat).pitch.filter((card) => hasCardSubtype(ctx, card, type));
    if (cards.length < remaining) {
      ctx.destroySelf();
      return;
    }
    ctx.requestCardChoice(
      "channel-bottom",
      decisionPrompt(`Put a ${type} card from pitch on the bottom`, "card.ele.pitch.card.bottom", {
        values: { type: type[0]!.toUpperCase() + type.slice(1) },
      }),
      cards.map((card) => card.instanceId),
    );
  }
  return {
    ...extra,
    triggers: [
      ...(extra.triggers ?? []),
      {
        event: "end-of-turn",
        label: `Channel ${type}`,
        effect(ctx) {
          const flow = ctx.getCounter("flow") + 1;
          ctx.setCounter("flow", flow);
          ctx.setState("channelRemaining", flow);
          maintain(ctx);
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "channel-bottom") {
        if (ctx.putOnDeckBottom(Number(option))) {
          ctx.setState("channelRemaining", ctx.getState("channelRemaining") - 1);
          maintain(ctx);
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

const oldhim: CardScript = {
  activated: {
    cost: 3,
    isAttack: false,
    goAgain: false,
    timing: "defense-reaction",
    oncePerTurn: true,
    onCostPaid(ctx, cards) {
      ctx.setState("oldhimEarth", cards.some((card) => hasCardSubtype(ctx, card, "earth")) ? 1 : 0);
      ctx.setState("oldhimIce", cards.some((card) => hasCardSubtype(ctx, card, "ice")) ? 1 : 0);
    },
    onActivate(ctx) {
      if (ctx.getState("oldhimEarth")) ctx.preventNextDamage(ctx.seat, 2);
      if (ctx.getState("oldhimIce") && ctx.link && ctx.player(ctx.link.attacker).hand.length)
        ctx.requestCardChoice(
          "adult-oldhim-top",
          decisionPrompt("Put a card from hand on top of deck", "card.ele.hand.card.top"),
          ctx.player(ctx.link.attacker).hand.map((card) => card.instanceId),
          ctx.link.attacker,
        );
    },
  },
  onChoose(ctx, hook, option) {
    if (hook === "adult-oldhim-top") ctx.putOnDeckTop(Number(option));
  },
};

const lexi: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    oncePerTurn: true,
    canActivate: (ctx) => ctx.player(ctx.seat).arsenal.some((card) => card.faceDown),
    onActivate(ctx) {
      ctx.requestCardChoice(
        "adult-lexi-flip",
        decisionPrompt("Turn a face-down arsenal card face up", "card.ele.arsenal.faceup"),
        ctx
          .player(ctx.seat)
          .arsenal.filter((card) => card.faceDown)
          .map((card) => card.instanceId),
      );
    },
  },
  onChoose(ctx, hook, option) {
    if (hook !== "adult-lexi-flip") return;
    const card = ctx.player(ctx.seat).arsenal.find((candidate) => candidate.instanceId === Number(option));
    if (!card) return;
    const ice = hasCardSubtype(ctx, card, "ice");
    const lightning = hasCardSubtype(ctx, card, "lightning");
    ctx.turnArsenalFaceUp(card.instanceId);
    if (ice) ctx.createToken(FROSTBITE, opponentSeat(ctx));
    if (lightning) buffNextAttack(ctx, { goAgain: true });
  },
};

const briar: CardScript = {
  onSuppressedHit(ctx) {
    if (ctx.link?.attackCardType === "action" && ctx.link.targetAllyId === undefined)
      ctx.setFlag("player", "briarEarthThisTurn", true);
  },
  canTriggerOnHit(ctx) {
    return (
      ctx.link?.attackCardType === "action" &&
      ctx.link.targetAllyId === undefined &&
      ctx.getFlag("player", "briarEarthThisTurn") !== true
    );
  },
  onHit(ctx) {
    ctx.setFlag("player", "briarEarthThisTurn", true);
    ctx.createToken(EMBODIMENT_OF_EARTH);
  },
  triggers: [
    {
      event: "card-played",
      label: "Create an Embodiment of Lightning",
      condition: (ctx, played) =>
        !!played &&
        ctx.hasCardType(played, "action") &&
        !hasCardSubtype(ctx, played, "attack") &&
        Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) === 2,
      effect: (ctx) => ctx.createToken(EMBODIMENT_OF_LIGHTNING),
    },
  ],
};

export const eleHighRarity: Record<string, CardScript> = {
  "korshem, crossroad of elements|0": {
    global: true,
    onAnyHeroReveals(ctx, revealingSeat) {
      ctx.setState("revealingSeat", revealingSeat + 1);
      ctx.requestChoice(
        "korshem-benefit",
        decisionPrompt("Choose Korshem's benefit", "card.ele.korshem.benefit", {
          optionMessages: {
            resource: decisionMessage("card.ele.korshem.option.resource"),
            life: decisionMessage("card.ele.korshem.option.life"),
            attack: decisionMessage("card.ele.korshem.option.attack"),
            defense: decisionMessage("card.ele.korshem.option.defense"),
          },
        }),
        ["resource", "life", "attack", "defense"],
        revealingSeat,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "korshem-benefit") return;
      const target = ctx.getState("revealingSeat") - 1;
      if (target < 0) return;
      if (option === "resource") ctx.gainResources(target, 1);
      else if (option === "life") ctx.gainLife(target, 1);
      else if (option === "attack") buffNextAttack(ctx, { seat: target, attack: 1 });
      else if (option === "defense")
        ctx.addModifier({
          scope: "until-end-of-turn",
          seat: target,
          defense: 1,
          appliesToCardType: "action",
          once: true,
        });
    },
    triggers: [
      {
        event: "end-of-turn",
        whose: "any",
        label: "Check Korshem",
        effect(ctx) {
          if (!ctx.state.players.some((player) => player.flags.cardEffectResourceLifeOrStatGainThisTurn === true))
            ctx.destroySelf();
        },
      },
    ],
  },
  "oldhim, grandfather of eternity|0": oldhim,
  "winter's wail|0": {
    activated: {
      cost: 3,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      onCostPaid(ctx, cards) {
        ctx.setState("icePitched", cards.some((card) => hasCardSubtype(ctx, card, "ice")) ? 1 : 0);
      },
    },
    canTriggerOnHit(ctx) {
      return ctx.getState("icePitched") > 0 && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.createToken(FROSTBITE, opponentSeat(ctx));
    },
  },
  "endless winter|1": withFusion("ice", {
    friendlyDefendedTrigger: {
      label: "Whenever the defending hero adds a defending card",
      condition: (ctx) => isFused(ctx) && ctx.link?.attackingCard.instanceId === ctx.self.instanceId,
    },
    onFriendlyDefended(ctx) {
      if (ctx.link) ctx.createToken(FROSTBITE, opponentSeat(ctx));
    },
    canTriggerOnHit(ctx) {
      return isFused(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: opponentSeat(ctx),
        expiresAtStartOfTurn: ctx.state.turn + 2,
        onFriendlyActivateCreateToken: FROSTBITE,
      });
    },
  }),
  "oaken old|1": withFusion(["ice", "earth"], {
    modifyAttack: (ctx) => (isFused(ctx) ? 2 : 0),
    onAttackDeclared(ctx) {
      if (isFused(ctx)) ctx.addModifier({ scope: "chain-link", dominate: true });
    },
    canTriggerOnHit(ctx) {
      return isFused(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length < 2) {
        for (const card of [...hand]) ctx.putOnDeckBottom(card.instanceId);
        return;
      }
      const first = hand[ctx.randomInt(hand.length)]!;
      const remaining = hand.filter((card) => card.instanceId !== first.instanceId);
      const second = remaining[ctx.randomInt(remaining.length)]!;
      const firstOrder = `${first.instanceId}:${second.instanceId}`;
      const secondOrder = `${second.instanceId}:${first.instanceId}`;
      ctx.requestChoice(
        "oaken-order",
        decisionPrompt("Choose the order for the two random cards", "card.ele.oaken.order", {
          optionMessages: {
            [firstOrder]: decisionMessage("card.ele.card.order", {
              first: { kind: "card", cardId: first.cardId },
              second: { kind: "card", cardId: second.cardId },
            }),
            [secondOrder]: decisionMessage("card.ele.card.order", {
              first: { kind: "card", cardId: second.cardId },
              second: { kind: "card", cardId: first.cardId },
            }),
          },
        }),
        [firstOrder, secondOrder],
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "oaken-order") return;
      for (const id of option.split(":").map(Number)) ctx.putOnDeckBottom(id);
    },
  }, "and"),
  "awakening|3": withFusion("earth", {
    onPlay(ctx) {
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) >= 0) return;
      const count = ctx.player(opponentSeat(ctx)).life - ctx.player(ctx.seat).life;
      ctx.createTokens(SEISMIC_SURGE, count * (isFused(ctx) ? 2 : 1));
      const cards = ctx
        .player(ctx.seat)
        .deck.filter(
          (card) =>
            hasCardSubtype(ctx, card, "guardian") && isAttackAction(ctx, card) &&
              (ctx.cardData(card.cardId).cost ?? 99) <= count,
        );
      if (cards.length)
        ctx.requestCardChoice(
          "awakening-search",
          decisionPrompt("Choose a Guardian attack", "card.ele.guardian.attack.choose"),
          cards.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "awakening-search" && ctx.moveToHand(Number(option))) ctx.shuffleDeck();
    },
  }),
  "lexi, livewire|0": lexi,
  "shiver|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.some((card) => ctx.cardTypes(card).includes("arrow")),
      onActivate(ctx) {
        ctx.requestCardChoice(
          "shiver-load",
          decisionPrompt("Load an arrow face up", "card.ele.arrow.load.faceup"),
          ctx
            .player(ctx.seat)
            .hand.filter((card) => ctx.cardTypes(card).includes("arrow"))
            .map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "shiver-load" && ctx.putIntoArsenal(Number(option), "hand", { faceUp: true }))
        ctx.requestChoice(
          "shiver-mode",
          decisionPrompt("Choose a bonus", "card.ele.bonus.choose", {
            optionMessages: {
              power: decisionMessage("card.ele.option.power.one"),
              dominate: decisionMessage("card.ele.option.dominate"),
            },
          }),
          ["power", "dominate"],
        );
      else if (hook === "shiver-mode")
        buffNextAttack(
          ctx,
          option === "power" ? { attack: 1, appliesToSubtype: "arrow" } : { dominate: true, appliesToSubtype: "arrow" },
        );
    },
  },
  "voltaire, strike twice|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      activationsPerTurn: 2,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.some((card) => ctx.cardTypes(card).includes("arrow")),
      onActivate(ctx) {
        ctx.requestCardChoice(
          "voltaire-load",
          decisionPrompt("Load an arrow face up", "card.ele.arrow.load.faceup"),
          ctx
            .player(ctx.seat)
            .hand.filter((card) => ctx.cardTypes(card).includes("arrow"))
            .map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "voltaire-load" && ctx.putIntoArsenal(Number(option), "hand", { faceUp: true }))
        ctx.requestChoice(
          "voltaire-mode",
          decisionPrompt("Choose a bonus", "card.ele.bonus.choose", {
            optionMessages: {
              power: decisionMessage("card.ele.option.power.one"),
              "go again": decisionMessage("card.ele.option.goagain"),
            },
          }),
          ["power", "go again"],
        );
      else if (hook === "voltaire-mode")
        buffNextAttack(
          ctx,
          option === "power" ? { attack: 1, appliesToSubtype: "arrow" } : { goAgain: true, appliesToSubtype: "arrow" },
        );
    },
  },
  "frost lock|3": withFusion("ice", {
    modifyAttack: (ctx) => (isFused(ctx) ? 1 : 0),
    onAttackDeclared(ctx) {
      ctx.setPlayerFlag(
        opponentSeat(ctx),
        "costMoreThisTurn",
        Number(ctx.getPlayerFlag(opponentSeat(ctx), "costMoreThisTurn")) + 1,
      );
    },
  }),
  "light it up|2": withFusion("lightning", {
    canTriggerOnHit(ctx) {
      return isFused(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const count = equippedCards(ctx, opponentSeat(ctx)).length;
      for (let i = 0; i < count; i++) ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.self.instanceId });
    },
  }),
  "ice storm|1": withFusion(["ice", "lightning"], {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 3,
        appliesToSubtype: "arrow",
        ...(isFused(ctx)
          ? { onHitDealDamage: 1, onDamageDealtCreateTokenPerPoint: FROSTBITE }
          : {}),
      });
    },
  }, "and"),
  "briar, warden of thorns|0": briar,
  "blossoming spellblade|1": withFusion(["earth", "lightning"], {
    triggers: [
      attackArcaneHeroTrigger(1, isFused),
      {
        event: "damage-dealt",
        sourceZone: "self",
        label: "Banish a non-attack action from your graveyard to play it this turn?",
        labelMessage: { id: "card.trigger.common.graveyard.nonattack.banish.optional" },
        condition: (ctx, eventCard, event) =>
          dealtByThis(ctx, eventCard) && isFused(ctx) && !!opposingHeroDamage(ctx, event),
        effect: blossomingBanishChoice,
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "blossoming-banish" && option !== "no" && ctx.banish(Number(option)))
        ctx.allowPlayFrom(Number(option), "banish", { asInstant: true, graveyardReplacement: "banish" });
    },
  }, "and"),
  "flicker wisp|2": withFusion("lightning", {
    arcaneDamageEffect: true,
    onPlay(ctx) {
      // The fused replacement starts before this card's own damage, so it applies to it.
      if (isFused(ctx))
        ctx.addModifier({ scope: "until-end-of-turn", damage: 1, damageArcaneOnly: true, appliesToCardType: "action" });
      ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true, sourceInstanceId: ctx.self.instanceId });
    },
  }),
  "force of nature|3": withFusion("earth", {
    onPlay(ctx) {
      if (isFused(ctx)) buffNextAttack(ctx, { attack: 1 });
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "draw a card whenever an attack action card you control with power greater than its base power hits",
          "card.effect.ele.forceofnature",
        ),
      });
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.attacker === ctx.seat &&
        link.attackCardType === "action" &&
        ctx.currentAttackPower() > ctx.basePower(link.attackingCard)
      );
    },
    onHit(ctx) {
      ctx.drawCards(ctx.seat, 1);
    },
  }),
  "fulminate|2": withFusion(["earth", "lightning"], {
    onPlay(ctx) {
      if (isFusedWith(ctx, "earth"))
        ctx.addModifier({ scope: "until-end-of-turn", attack: 3, appliesTo: "attack-action" });
      if (isFusedWith(ctx, "lightning"))
        ctx.addModifier({ scope: "until-end-of-turn", goAgain: true, appliesTo: "attack-action" });
    },
  }),
  "flashfreeze|1": withFusion(["ice", "lightning"], {
    onPlay(ctx) {
      if (isFused(ctx))
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesTo: "attack",
          ...(isFusedWith(ctx, "lightning") ? { onHitDealDamage: 3 } : {}),
        });
    },
    onFriendlyAttackDeclared(ctx) {
      if (!isFusedWith(ctx, "ice")) return;
      if (
        !ctx.requestPayment(
          "flashfreeze-ice",
          decisionPrompt("Pay 2 resources or the attack gains dominate", "card.ele.dominate.pay", {
            values: { amount: 2 },
          }),
          2,
          opponentSeat(ctx),
        )
      )
        ctx.addModifier({ scope: "chain-link", dominate: true });
    },
    onChoose(ctx, hook, option) {
      if (hook === "flashfreeze-ice" && option === "declined") ctx.addModifier({ scope: "chain-link", dominate: true });
    },
  }),
  "pulse of volthaven|1": {
    onPlay: (ctx) => buffNextAttack(ctx, { attack: 4, appliesToSubtype: ["ice", "lightning", "elemental"] }),
  },
  "pulse of candlehold|2": {
    onPlay(ctx) {
      const cards = faceUpGraveyard(ctx).filter(
          (card) =>
            isAttackAction(ctx, card) &&
            ["earth", "lightning", "elemental"].some((type) => hasCardSubtype(ctx, card, type)),
        );
      if (cards.length)
        ctx.requestCardChoice(
          "candlehold",
          decisionPrompt("Put an action on top of your deck", "card.ele.action.top", {
            optionMessages: commonOptionMessages("done"),
          }),
          ["done", ...cards.map((card) => card.instanceId)],
        );
      ctx.banish(ctx.self.instanceId);
    },
    onChoose(ctx, hook, option) {
      if (hook === "candlehold" && option !== "done") ctx.putOnDeckTop(Number(option));
    },
  },
  "pulse of isenloft|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        defense: 1,
        appliesToCardType: "action",
        appliesToSubtype: ["earth", "ice", "elemental"],
      });
    },
  },
  "crown of seeds|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      canActivate: (ctx) => ctx.player(ctx.seat).arsenal.some((card) => card.faceDown),
      onActivate(ctx) {
        ctx.requestCardChoice(
          "crown-bottom",
          decisionPrompt("Put a face-down arsenal card on the bottom", "card.ele.arsenal.facedown.bottom"),
          ctx
            .player(ctx.seat)
            .arsenal.filter((card) => card.faceDown)
            .map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "crown-bottom" && ctx.putOnDeckBottom(Number(option))) {
        ctx.drawCards(ctx.seat, 1);
        ctx.preventNextDamage(ctx.seat, 1);
      }
    },
  },
  "channel mount heroic|1": channel("earth", {
    onEnterArena(ctx) {
      ctx.addModifier({ scope: "static", attack: 3, appliesTo: "attack-action" });
    },
  }),
  "tome of harvests|3": {
    additionalCost(ctx) {
      if (ctx.player(ctx.seat).arsenal.length)
        ctx.requestCardChoice(
          "harvests-bottom",
          decisionPrompt("Put your arsenal on the bottom", "card.ele.arsenal.bottom"),
          ctx.player(ctx.seat).arsenal.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "harvests-bottom" && ctx.putOnDeckBottom(Number(option))) {
        ctx.drawCards(ctx.seat, 3);
      }
    },
  },
  "heart of ice|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      onActivate(ctx) {
        ctx.setPlayerFlag(
          opponentSeat(ctx),
          "costMoreThisTurn",
          Number(ctx.getPlayerFlag(opponentSeat(ctx), "costMoreThisTurn")) + 1,
        );
      },
    },
  },
  "channel lake frigid|3": channel("ice", { additionalCostToOpponents: 1 }),
  "blizzard|3": {
    playTargetOptions(ctx) {
      return ctx.state.chain
        .filter((link) => link.flags.attackGone !== true)
        .map((link) => link.attackingCard.instanceId);
    },
    onPlay(ctx) {
      const target = ctx.state.chain.find((link) =>
        link.flags.attackGone !== true && link.attackingCard.instanceId === ctx.playTargetInstanceId
      );
      if (!target) return;
      if (
        !ctx.requestPayment(
          "blizzard-pay",
          decisionPrompt("Pay 2 resources to prevent the attack losing go again?", "card.ele.goagain.keep.pay", {
            values: { amount: 2 },
          }),
          2,
          target.attacker,
        )
      )
        ctx.suppressCardKeyword(target.attackingCard.instanceId, "go again");
    },
    onChoose(ctx, hook, option) {
      if (hook === "blizzard-pay" && option === "declined" && ctx.playTargetInstanceId !== undefined) {
        ctx.suppressCardKeyword(ctx.playTargetInstanceId, "go again");
      }
    },
  },
  "shock charmers|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: false,
      onActivate(ctx) {
        ctx.setPlayerFlag(
          ctx.seat,
          "shockCharmersArmed",
          Number(ctx.getPlayerFlag(ctx.seat, "shockCharmersArmed")) + 1,
        );
      },
    },
    canTriggerOnHit(ctx) {
      return (
        ctx.link?.targetAllyId === undefined &&
        ctx.link?.attackCardType === "action" &&
        Number(ctx.getPlayerFlag(ctx.seat, "shockCharmersArmed")) > 0
      );
    },
    onHit(ctx) {
      const armed = Number(ctx.getPlayerFlag(ctx.seat, "shockCharmersArmed"));
      ctx.setPlayerFlag(ctx.seat, "shockCharmersArmed", armed - 1);
      ctx.dealDamage(opponentSeat(ctx), 1, { sourceInstanceId: ctx.self.instanceId });
    },
  },
  "channel thunder steppe|2": channel("lightning", {
    triggers: [
      {
        event: "card-played",
        label: "Pay 1 to give this action go again?",
        condition: (ctx, played) => !!played && ctx.hasCardType(played, "action"),
        effect(ctx, played) {
          if (!played) return;
          ctx.setState("thunderTarget", played.instanceId);
          ctx.requestPayment(
            "thunder-steppe",
            decisionPrompt("Pay 1 to give this action go again?", "card.ele.goagain.give.pay", {
              values: { amount: 1 },
            }),
            1,
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "thunder-steppe" && option === "paid") {
        const target = ctx.getState("thunderTarget");
        ctx.grantCardKeyword(target, "go again");
        ctx.grantGoAgain(target);
      }
    },
  }),
  "blink|3": { onPlay: (ctx) => ctx.gainActionPoints(ctx.seat, 1) },
  "rampart of the ram's head|0": {
    defendCost: 1,
    onDefend(ctx) {
      ctx.requestPayment(
        "rampart-pay",
        decisionPrompt("Pay 1 for +1 defense?", "card.ele.defense.pay", { values: { amount: 1, defense: 1 } }),
        1,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "rampart-pay" && option === "paid") ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },
  "new horizon|0": {
    additionalArsenalZoneWhileFaceUp: true,
    onDestroyed(ctx) {
      for (const card of [...ctx.player(ctx.seat).arsenal]) {
        ctx.moveToGraveyard(card.instanceId, "arsenal");
      }
    },
  },
  "seek and destroy|1": {
    onPlay: (ctx) =>
      buffNextAttack(ctx, { attack: 3, appliesToSubtype: "arrow", onHitClearHandAndArsenalAtEndPhase: true }),
  },
  "rosetta thorn|0": {
    activated: { cost: 1, isAttack: true, goAgain: false, oncePerTurn: true },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && playedAttackAndNonAttack(ctx))
        ctx.dealDamage(opponentSeat(ctx), 2, { arcane: true, sourceInstanceId: ctx.self.instanceId });
    },
  },
  "duskblade|0": {
    activated: { cost: 1, isAttack: true, goAgain: false, oncePerTurn: true },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId && playedAttackAndNonAttack(ctx))
        ctx.addCounter(ctx.self.instanceId, "power", 1);
    },
    triggers: [
      {
        event: "end-of-turn",
        label: "Remove Duskblade counters",
        effect(ctx) {
          if (!playedAttackAndNonAttack(ctx)) ctx.setCardCounter(ctx.self.instanceId, "power", 0);
        },
      },
    ],
  },
  "spellbound creepers|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      putCounterCost: { key: "bind", amount: 1 },
      canActivate(ctx) {
        return (
          ctx.getFlag("player", "attackedWithAttackActionThisTurn") === true ||
          ctx.getFlag("player", "defendedWithAttackActionThisTurn") === true
        );
      },
      onActivate(ctx) {
        ctx.setFlag("player", "nextNonAttackAsInstant", true);
      },
    },
    triggers: [
      {
        event: "end-of-turn",
        label: "Maintain Spellbound Creepers",
        condition: (ctx) => ctx.getCounter("bind") > 0,
        effect(ctx) {
          const dealt = Number(ctx.getFlag("player", `arcaneDamageAmountToSeat:${opponentSeat(ctx)}`));
          if (dealt < ctx.getCounter("bind")) ctx.destroySelf();
        },
      },
    ],
  },
  "sting of sorcery|3": {
    triggers: [
      {
        event: "attack-declared",
        label: "Deal 1 arcane damage to target hero",
        labelMessage: decisionMessage("card.trigger.common.arcane.target", { amount: 1 }),
        condition: (ctx) => ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "action",
        target: heroTarget(),
        effect(ctx) {
          const seat = targetHeroSeat(ctx);
          // The granted ability belongs to the attack card, so that card is the damage source.
          const sourceInstanceId = ctx.link?.attackingCard.instanceId ?? ctx.self.instanceId;
          if (seat !== undefined) ctx.dealDamage(seat, 1, { arcane: true, sourceInstanceId });
        },
      },
      { event: "end-of-turn", label: "Destroy Sting of Sorcery", effect: (ctx) => ctx.destroySelf() },
    ],
  },
};
