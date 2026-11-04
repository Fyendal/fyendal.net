import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  BLOODROT_POX,
  FRAILTY,
  INERTIA,
  NAMED_DISEASE_TOKENS,
  armGrantedHitRider,
  cardNamed,
  chainHitRider,
  commonOptionMessages,
  contractWithSilver,
  createChosenDisease,
  decisionMessage,
  decisionPrompt,
  equipWithSilver,
  hitHookLabel,
  isDisease,
  isDiseaseToken,
  isInfected,
  leavesArenaTrigger,
  ongoingLabel,
  opponentSeat,
  requestDiseaseTokenChoice,
  targetsHero,
  tokenContractWithSilver,
} from "./shared-helpers.js";

const SILVER = "DYN245";

function seedDisease(tokenId: string): CardScript {
  return {
    onPlay(ctx) {
      for (const player of ctx.state.players) ctx.createToken(tokenId, player.seat);
    },
  };
}

function isReaction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "attack-reaction") || ctx.hasCardType(card, "defense-reaction");
}

function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("dagger");
}

/** Every dagger in play: weapons, dagger permanents, and dagger attack cards
 * still on the combat chain. */
function daggerTargets(ctx: ScriptCtx): number[] {
  const candidates = [
    ...ctx.state.players.flatMap((player) => [...player.weapons, ...player.board]),
    ...ctx.state.chain.filter((link) => link.flags.attackGone !== true).map((link) => link.attackingCard),
  ];
  return candidates
    .filter((card) => isDagger(ctx, card))
    .map((card) => card.instanceId)
    .filter((instanceId, index, ids) => ids.indexOf(instanceId) === index);
}

function activeAssassinAttack(ctx: ScriptCtx): number[] {
  const link = ctx.link;
  if (!link || link.flags.attackGone === true || !ctx.cardTypes(link.attackingCard).includes("assassin")) return [];
  return [link.attackingCard.instanceId];
}

function assassinAttackActionTargets(ctx: ScriptCtx): number[] {
  return ctx.state.chain
    .filter((link) =>
      link.flags.attackGone !== true &&
      link.attackCardType === "action" &&
      ctx.cardTypes(link.attackingCard).includes("assassin")
    )
    .map((link) => link.attackingCard.instanceId);
}

/** "As an additional cost to play this, destroy N Silver you control." */
function silverAdditionalCost(amount: number): Pick<CardScript, "canPlay" | "additionalCost"> {
  const silver = (ctx: ScriptCtx) => ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Silver"));
  return {
    canPlay: (ctx) => silver(ctx).length >= amount,
    additionalCost(ctx) {
      for (const card of silver(ctx).slice(0, amount)) ctx.destroyPermanent(card.instanceId);
    },
  };
}

function sickening(effect: (ctx: ScriptCtx, defender: number) => void): CardScript {
  return {
    onPlay(ctx) {
      const defender = opponentSeat(ctx);
      if (isInfected(ctx, defender)) effect(ctx, defender);
    },
  };
}

const reactionCount = (ctx: ScriptCtx): number => Number(ctx.getFlag("link", "reactionCount"));

function tailoredBanish(ctx: ScriptCtx): void {
  const named = ctx.self.chosenName;
  for (;;) {
    const top = ctx.player(opponentSeat(ctx)).deck[0];
    if (!top || !ctx.banish(top.instanceId)) return;
    if (!named || !cardNamed(ctx, top, named)) return;
  }
}

function leavesChainAsAttack(fallback: string, messageId: string, effect: (ctx: ScriptCtx) => void) {
  return leavesArenaTrigger(
    fallback,
    decisionMessage(messageId),
    (ctx) => {
      // Leaving at chain close has no chain link left to affect.
      if (ctx.link && ctx.link.flags.attackGone !== true) effect(ctx);
    },
    { condition: (_ctx, _card, event) => event?.combatRole === "attacking" },
  );
}

const painfulChoicePower = (ctx: ScriptCtx): void =>
  ctx.addModifier({ scope: "chain-link", attack: 4, appliesToInstanceId: ctx.self.instanceId });

function offerPainfulChoice(ctx: ScriptCtx): void {
  const defender = opponentSeat(ctx);
  const hand = ctx.player(defender).hand;
  if (!hand.length) {
    painfulChoicePower(ctx);
    return;
  }
  ctx.requestCardChoice(
    "mpa-painful-banish",
    decisionPrompt(
      "Choose a card in your hand to banish, or Painful Choice gets +4 power",
      "card.mpa.painfulchoice.banish",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: 4 },
        optionMessages: { power: decisionMessage("card.mpa.painfulchoice.option.power", { amount: 4 }) },
      },
    ),
    ["power", ...hand.map((card) => card.instanceId)],
    defender,
  );
}

function eachPitch(name: string, script: CardScript): Record<string, CardScript> {
  return { [`${name}|1`]: script, [`${name}|2`]: script, [`${name}|3`]: script };
}

function banishTopOnHitContract(
  condition: (ctx: ScriptCtx, card: DeepReadonly<CardInstance>) => boolean,
): CardScript {
  return {
    ...contractWithSilver(condition),
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  };
}

export const mpa: Record<string, CardScript> = {
  "phial of calamity|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      targetCardOptions: daggerTargets,
      onActivate(ctx) {
        const dagger = ctx.playTargetInstanceId;
        if (dagger === undefined) return;
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesToInstanceId: dagger,
          onHitScriptHook: {
            hook: "mpa-phial-hit",
            ...hitHookLabel(
              "create a Frailty, Inertia, or Bloodrot Pox token under the hit hero's control",
              "card.effect.mpa.phial",
            ),
            heroOnly: true,
          },
        });
      },
    },
    onGrantedHit(ctx, hook) {
      if (hook === "mpa-phial-hit") requestDiseaseTokenChoice(ctx, "mpa-phial-disease");
    },
    // A thrown dagger hits through effect damage, which never reaches the
    // combat on-hit hook, so its live grant is matched here instead.
    onFriendlyEffectHitCondition(ctx, source, targetSeat) {
      return (
        targetSeat !== ctx.seat &&
        ctx.state.modifiers.some(
          (modifier) =>
            modifier.sourceInstanceId === ctx.self.instanceId &&
            modifier.appliesToInstanceId === source.instanceId &&
            modifier.onHitScriptHook?.hook === "mpa-phial-hit",
        )
      );
    },
    onFriendlyEffectHit(ctx) {
      requestDiseaseTokenChoice(ctx, "mpa-phial-disease");
    },
    onChoose(ctx, hook, option) {
      if (hook === "mpa-phial-disease") createChosenDisease(ctx, option);
    },
  },

  "cadaver handlers|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      targetCardOptions: activeAssassinAttack,
      canActivate: (ctx) => isInfected(ctx, opponentSeat(ctx)),
      onActivate(ctx) {
        const target = ctx.playTargetInstanceId;
        const link = ctx.state.chain.find((candidate) => candidate.attackingCard.instanceId === target);
        if (!link) return;
        // Link-scoped, so the -1 is gone when Temper checks at chain close.
        const reduce = (card: DeepReadonly<CardInstance>, appliesToEquipment: boolean) =>
          ctx.addModifier({
            scope: "chain-link",
            defense: -1,
            seat: card.owner,
            appliesToInstanceId: card.instanceId,
            ...(appliesToEquipment ? { appliesToEquipment } : {}),
          });
        for (const card of link.defendingCards) reduce(card, false);
        for (const card of link.defendingEquipment) reduce(card, true);
      },
    },
  },

  "mask of one million eyes|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.drawCards(ctx.seat, 1);
        const hand = ctx.player(ctx.seat).hand;
        if (!hand.length) return;
        ctx.requestCardChoice(
          "mpa-mask-bottom",
          decisionPrompt(
            "Put a card from your hand on the bottom of your deck",
            "card.common.cost.hand.deckbottom",
          ),
          hand.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "mpa-mask-bottom") ctx.putOnDeckBottom(Number(option));
    },
  },

  "seed bloodrot|3": seedDisease(BLOODROT_POX),
  "seed frailty|3": seedDisease(FRAILTY),
  "seed inertia|3": seedDisease(INERTIA),

  "outbreak|3": {
    playTargetOptions: assassinAttackActionTargets,
    onPlay(ctx) {
      const target = ctx.playTargetInstanceId;
      if (target === undefined) return;
      ctx.addModifier({ scope: "chain-link", attack: 3, appliesTo: "attack-action", appliesToInstanceId: target });
      armGrantedHitRider(
        ctx,
        ongoingLabel(
          "when it hits a hero, create a Frailty, Inertia, and Bloodrot Pox token under their control",
          "card.effect.mpa.outbreak",
        ),
        target,
      );
    },
    ...chainHitRider((ctx, seat) => {
      for (const tokenId of NAMED_DISEASE_TOKENS) ctx.createToken(tokenId, seat);
    }),
  },

  "expense not spared|2": {
    ...silverAdditionalCost(2),
    playTargetOptions: assassinAttackActionTargets,
    onPlay(ctx) {
      if (ctx.playTargetInstanceId === undefined) return;
      ctx.addModifier({
        scope: "chain-link",
        attack: 5,
        appliesTo: "attack-action",
        appliesToInstanceId: ctx.playTargetInstanceId,
      });
    },
  },

  "festering rot|2": {
    playTargetOptions: assassinAttackActionTargets,
    onPlay(ctx) {
      const target = ctx.playTargetInstanceId;
      if (target === undefined) return;
      ctx.grantGoAgain(target);
      armGrantedHitRider(
        ctx,
        ongoingLabel(
          "when it hits a hero, create a Bloodrot Pox token under their control",
          "card.effect.common.bloodrot.create.hit.hero",
        ),
        target,
      );
    },
    ...chainHitRider((ctx, seat) => ctx.createToken(BLOODROT_POX, seat)),
  },

  "pinpoint elimination|3": {
    onPlay(ctx) {
      ctx.requestNameChoice("mpa-pinpoint-name", decisionPrompt("Name a card", "card.common.card.name"));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mpa-pinpoint-name") return;
      const defender = opponentSeat(ctx);
      const top = ctx.player(defender).deck[0];
      if (!top || !ctx.revealCards([top.instanceId], defender) || !cardNamed(ctx, top, option)) return;
      ctx.banish(top.instanceId);
      ctx.createToken(SILVER);
    },
  },

  "prolonged illness|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "whenever a disease token is destroyed, if it's the first with " +
            "that name, create a copy of it under the same hero's control",
          "card.effect.mpa.prolongedillness",
        ),
      });
    },
    triggers: [
      {
        event: "card-left-arena",
        whose: "any",
        label: "Create a copy of the first destroyed disease token of this name",
        labelMessage: { id: "card.mpa.prolonged.copy" },
        condition(ctx, left, event) {
          if (!left || event?.destroyed !== true || event.controllerSeat === undefined) return false;
          if (!isDiseaseToken(ctx, left)) return false;
          const name = ctx.cardData(left.cardId).name.trim().toLowerCase().replace(/\s+/g, " ");
          return ctx.state.players.every(
            (player) => Number(player.flags[`destroyedNameCount:${name}`] ?? 0) === 0,
          );
        },
        onTrigger(ctx, left, event) {
          if (left && event?.controllerSeat !== undefined) {
            ctx.setState(`copySeat:${left.instanceId}`, event.controllerSeat);
          }
        },
        effect(ctx, destroyed) {
          if (destroyed) ctx.createTokenCopyOf(destroyed, ctx.getState(`copySeat:${destroyed.instanceId}`));
        },
      },
    ],
  },

  "painful choice|1": {
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "You may put a card from your hand on the bottom of your deck",
        labelMessage: decisionMessage("card.mpa.painfulchoice.trigger"),
        condition: (ctx) => ctx.player(ctx.seat).hand.length > 0,
        effect(ctx) {
          ctx.requestCardChoice(
            "mpa-painful-bottom",
            decisionPrompt(
              "Painful Choice: put a card from your hand on the bottom of your deck?",
              "card.mpa.painfulchoice.bottom",
              { optionMessages: commonOptionMessages("pass") },
            ),
            ["pass", ...ctx.player(ctx.seat).hand.map((card) => card.instanceId)],
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "mpa-painful-bottom") {
        if (option !== "pass" && ctx.putOnDeckBottom(Number(option))) offerPainfulChoice(ctx);
      } else if (hook === "mpa-painful-banish") {
        if (option === "power") painfulChoicePower(ctx);
        else ctx.banish(Number(option));
      }
    },
  },

  "prey on insecurity|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      oncePerTurn: false,
      effectCardCosts: [
        {
          zone: "hand",
          move: "put-on-deck-bottom",
          count: 1,
          prompt: decisionPrompt(
            "Put a card from your hand on the bottom of your deck",
            "card.common.cost.hand.deckbottom",
          ),
        },
      ],
      canActivate(ctx) {
        const attack = ctx.link?.attackingCard;
        return (
          !!attack &&
          ctx.link?.attacker === ctx.seat &&
          attack.instanceId !== ctx.self.instanceId &&
          (ctx.cardData(attack.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "stealth")
        );
      },
      onCostPaid(ctx) {
        ctx.destroySelf();
      },
      onActivate(ctx) {
        const attack = ctx.link?.attackingCard;
        if (!attack) return;
        ctx.addModifier({
          scope: "chain-link",
          attack: 3,
          appliesToInstanceId: attack.instanceId,
        });
      },
    },
  },

  "bribe the guards|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      effectCardCosts: [
        {
          zone: "arena",
          move: "destroy",
          count: 1,
          name: "Silver",
          prompt: decisionPrompt("Destroy a Silver", "card.common.cost.silver.destroy"),
        },
      ],
      targetCardOptions(ctx) {
        const link = ctx.state.chain.find((candidate) => candidate.attackingCard.instanceId === ctx.self.instanceId);
        return link ? [...link.defendingCards, ...link.defendingEquipment].map((card) => card.instanceId) : [];
      },
      onActivate(ctx) {
        if (ctx.playTargetInstanceId !== undefined) ctx.addCardTempDefense(ctx.playTargetInstanceId, -1);
      },
    },
  },

  "continued coercion|2": {
    triggers: [
      leavesChainAsAttack(
        "Attacks get go again this chain link",
        "card.mpa.continuedcoercion.goagain",
        (ctx) => ctx.grantChainLinkGoAgain(ctx.state.chain.length - 1),
      ),
    ],
  },

  "flip the script|3": {
    triggers: [
      leavesChainAsAttack(
        "Attacks get +1 power this chain link",
        "card.mpa.flipscript.power",
        (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1, appliesTo: "attack" }),
      ),
    ],
  },

  "remember the mists|3": {
    modifyAttack(ctx) {
      return ctx.getFlag("link", "fromOutsideHandOrArsenal") === true ? 2 : 0;
    },
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "mpa-remember-banish",
          decisionPrompt("Choose a card to banish from the defending hero's hand", "card.mpa.remember.hand.banish"),
          hand.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mpa-remember-banish") return;
      const instanceId = Number(option);
      if (ctx.banish(instanceId)) {
        ctx.allowPlayFrom(instanceId, "banish", {
          forSeat: opponentSeat(ctx),
          untilEndOfNextTurn: true,
        });
      }
    },
  },

  "demoralize the dracai|1": {
    ...contractWithSilver((ctx, card) => card.owner === opponentSeat(ctx) && ctx.cardColor(card) === 1),
    onAttackDeclared(ctx) {
      // Keeps its hit trigger observable for later links while it stays on the chain.
      ctx.addModifier({ scope: "combat-chain" });
    },
    onBecameAttackingCard: (ctx) => ctx.addModifier({ scope: "combat-chain" }),
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.attacker === ctx.seat &&
        link.attackCardType === "action" &&
        link.targetAllyId === undefined &&
        ctx.state.chain.some(
          (chainLink) => chainLink.attackingCard.instanceId === ctx.self.instanceId && chainLink.flags.attackGone !== true,
        )
      );
    },
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  },

  "mutually assured destruction|1": {
    ...contractWithSilver((ctx, card) => card.owner === opponentSeat(ctx) && isInfected(ctx, card.owner)),
    onBecameAttackingCard: (ctx) => ctx.addModifier({ scope: "combat-chain" }),
    onAttackDeclared(ctx) {
      // Its reaction-play trigger must remain functional for every link while
      // this Contract attack stays face up on the combat chain.
      ctx.addModifier({ scope: "combat-chain" });
    },
    triggers: [
      {
        event: "card-played",
        whose: "any",
        label: "Infect each hero and banish the top card of each deck",
        condition(ctx, played) {
          if (!played || !isReaction(ctx, played)) return false;
          if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return false;
          return ctx.getState(`reaction:${played.owner}`) === 0;
        },
        onTrigger(ctx, played) {
          if (played) ctx.setState(`reaction:${played.owner}`, 1);
        },
        effect(ctx) {
          for (const player of ctx.state.players) ctx.createToken(BLOODROT_POX, player.seat);
          for (const player of ctx.state.players) {
            const top = ctx.player(player.seat).deck[0];
            if (top) ctx.banish(top.instanceId);
          }
        },
      },
    ],
  },

  "sick intent|1": {
    ...tokenContractWithSilver(isDisease),
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      requestDiseaseTokenChoice(ctx, "mpa-sick-intent-disease");
    },
    onChoose(ctx, hook, option) {
      if (hook === "mpa-sick-intent-disease") createChosenDisease(ctx, option);
    },
  },

  "spike slasher|1": {
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "Attack reaction cards cost 1 less to play this chain link",
        labelMessage: decisionMessage("card.mpa.spikeslasher.discount", { amount: 1 }),
        effect(ctx) {
          ctx.addModifier({ scope: "chain-link", playCostReduction: 1, appliesToCardType: "attack-reaction" });
        },
      },
    ],
  },

  "tailored targeting|1": {
    ...contractWithSilver((ctx, card) =>
      card.owner === opponentSeat(ctx) && !!ctx.self.chosenName && cardNamed(ctx, card, ctx.self.chosenName),
    ),
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "Name a card",
        labelMessage: decisionMessage("card.trigger.common.cardname.choose"),
        effect(ctx) {
          ctx.requestNameChoice("mpa-tailored-name", decisionPrompt("Name a card", "card.common.card.name"));
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "mpa-tailored-name") ctx.setChosenName(option);
    },
    canTriggerOnHit: targetsHero,
    onHit: tailoredBanish,
    onFriendlyEffectHitCondition: (ctx, _source, targetSeat) =>
      ctx.link?.attackingCard.instanceId === ctx.self.instanceId && targetSeat !== ctx.seat,
    onFriendlyEffectHit: tailoredBanish,
  },

  "sickening exhaustion|3": sickening((ctx, defender) => {
    for (const card of [...ctx.player(defender).arsenal]) ctx.putOnDeckBottom(card.instanceId);
  }),

  "sickening rot|3": {
    ...sickening((ctx, defender) => {
      const paying = ctx.requestPayment(
        "mpa-sickening-rot-pay",
        decisionPrompt("Sickening Rot: pay {r}{r}{r} or take 2 damage?", "card.mpa.sickeningrot.pay", {
          optionMessages: commonOptionMessages("no"),
        }),
        3,
        defender,
      );
      if (!paying) ctx.dealDamage(defender, 2);
    }),
    onChoose(ctx, hook, option) {
      if (hook === "mpa-sickening-rot-pay" && option !== "paid") ctx.dealDamage(opponentSeat(ctx), 2);
    },
  },

  "sickening weakness|3": {
    // A continuous effect, so cards that start defending later this link are weakened too.
    ...sickening((ctx) => {
      ctx.addModifier({
        scope: "chain-link",
        ...ongoingLabel("defending cards get -1 defense this chain link", "card.effect.mpa.sickeningweakness"),
      });
    }),
    modifyDefendingDefense: () => -1,
    modifyDefendingEquipmentDefense: () => -1,
  },

  "concoct agony|2": {
    modifyAttack: (ctx) => (reactionCount(ctx) >= 3 ? 3 : 0),
    canTriggerOnHit: (ctx) => reactionCount(ctx) >= 3 && targetsHero(ctx),
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.banish(card.instanceId);
    },
  },

  ...eachPitch("the spider's cut", {
    ...silverAdditionalCost(1),
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      ctx.createToken(SILVER);
      ctx.createToken(SILVER);
    },
  }),

  ...eachPitch("feverish strike", {
    modifyAttack: (ctx) => (isInfected(ctx, ctx.seat) ? 1 : 0),
  }),

  ...eachPitch("desperate drive", {
    hasConditionalGoAgain: (ctx) => isInfected(ctx, ctx.seat),
  }),

  ...eachPitch("in the hot zone", {
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "Create a Bloodrot Pox token under your control",
        labelMessage: decisionMessage("card.mpa.hotzone.bloodrot"),
        effect(ctx) {
          ctx.createToken(BLOODROT_POX, ctx.seat);
        },
      },
    ],
  }),

  ...eachPitch(
    "slice the sickly",
    banishTopOnHitContract((ctx, card) => card.owner === opponentSeat(ctx) && isInfected(ctx, card.owner)),
  ),

  ...eachPitch(
    "decapitate the disloyal",
    banishTopOnHitContract((ctx, card) => card.owner === opponentSeat(ctx) && !ctx.hasClassOrTalent(card)),
  ),
};
