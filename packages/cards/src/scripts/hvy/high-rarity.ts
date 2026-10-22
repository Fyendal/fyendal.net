import type { CardInstance, CardScript, DeepReadonly, Modifier, ScriptCtx } from "@fyendal/engine";
import {
  armDelayedEffect,
  attackAbility,
  buffNextAttack,
  cardNameContains,
  commonOptionMessages,
  consumeDelayedEffect,
  contractCompletionCount,
  decisionMessage,
  decisionPrompt,
  heroDamage,
  hitHookLabel,
  ongoingLabel,
  opponentSeat,
  pendingDelayedEffect,
} from "../shared-helpers.js";

const AGILITY = "HVY240";
const CINTARI_SELLSWORD = "HVY134";
const GOLD = "HVY243";
const MIGHT = "HVY241";
const PONDER = "DYN244";
const VIGOR = "HVY242";

const DOUBLE_DOWN_ATTACK = "card.effect.hvy.doubledown.attack";
const isDoubleDownAttack = (modifier: DeepReadonly<Modifier>) =>
  modifier.ongoingLabelMessage?.id === DOUBLE_DOWN_ATTACK;

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string) {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string) {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function controlledPermanents(ctx: ScriptCtx, seat = ctx.seat): DeepReadonly<CardInstance>[] {
  const player = ctx.player(seat);
  return [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is DeepReadonly<CardInstance> => card !== undefined),
  ];
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function isSix(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.basePower(card) >= 6;
}
function wagerAttack(tokens: string[]): CardScript {
  return {
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        optional: true,
        label: "Wager with the defending hero?",
        condition: (ctx) => ctx.link?.targetAllyId === undefined,
        effect: (ctx) => ctx.wager(opponentSeat(ctx), tokens),
      },
    ],
  };
}
function topCards(ctx: ScriptCtx, count: number) {
  return ctx.player(ctx.seat).deck.slice(0, count);
}
function chooseArsenalBottom(ctx: ScriptCtx, hook: string) {
  const card = ctx.player(ctx.seat).arsenal[0];
  if (card)
    ctx.requestCardChoice(
      hook,
      decisionPrompt("Put your arsenal card on the bottom?", "card.hvy.arsenal.bottom", {
        optionMessages: commonOptionMessages("no"),
      }),
      ["no", card.instanceId],
    );
}
function evoEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    playableEquipment: true,
    canPlay(ctx) {
      const slot = ctx
        .cardTypes(ctx.self)
        .find((type): type is "head" | "chest" | "arms" | "legs" => ["head", "chest", "arms", "legs"].includes(type));
      const base = slot ? ctx.player(ctx.seat).equipment[slot] : undefined;
      return !!base && has(ctx, base, "base");
    },
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true || (extra.playAsInstant?.(ctx) ?? false);
    },
  };
}
const ANTE_MODES = ["agility", "gold", "vigor", "power"] as const;
type AnteMode = (typeof ANTE_MODES)[number];
function requestAnteMode(ctx: ScriptCtx): void {
  const remaining = ctx.getState("ante-remaining");
  if (remaining <= 0) return;
  const total = Math.min(ANTE_MODES.length, ctx.getState("anteX") + 1);
  ctx.requestChoice(
    "ante-mode",
    decisionPrompt(
      remaining === total ? "Choose a wager mode" : "Choose another wager mode",
      remaining === total ? "card.hvy.wager.mode.choose" : "card.hvy.wager.mode.next",
      {
        optionMessages: {
          agility: decisionMessage("card.hvy.wager.option.agility"),
          gold: decisionMessage("card.hvy.wager.option.gold"),
          vigor: decisionMessage("card.hvy.wager.option.vigor"),
          power: decisionMessage("card.hvy.wager.option.power"),
        },
        chosen: ANTE_MODES.filter((mode) => ctx.getState(`ante-mode:${mode}`) > 0),
      },
    ),
    ANTE_MODES.filter((mode) => ctx.getState(`ante-mode:${mode}`) <= 0),
  );
}
function applyAnteModes(ctx: ScriptCtx): void {
  for (const mode of ANTE_MODES) {
    if (ctx.getState(`ante-mode:${mode}`) <= 0) continue;
    if (mode === "agility") ctx.wager(opponentSeat(ctx), [AGILITY]);
    else if (mode === "gold") ctx.wager(opponentSeat(ctx), [GOLD]);
    else if (mode === "vigor") ctx.wager(opponentSeat(ctx), [VIGOR]);
    else if (mode === "power")
      ctx.addModifier({ scope: "chain-link", attack: Number(ctx.getFlag("link", "wagerCount")) });
  }
}

export const hvyHighRarity: Record<string, CardScript> = {
  "deathmatch arena|0": {
    global: true,
    onFriendlyCombatDamageDealt(ctx, _source, targetSeat, amount) {
      if (amount > 0 && ctx.player(targetSeat).life <= 0) ctx.createTokens(GOLD, ctx.state.players.length);
    },
  },
  "apex bonebreaker|0": {
    modifyDefense: (ctx) =>
      ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && isSix(ctx, card)) ? 0 : 0,
    canTriggerOnDefend: (ctx) =>
      ctx.link?.defendingCards.some((card) => card.instanceId !== ctx.self.instanceId && isSix(ctx, card)) === true,
    onDefend(ctx) {
      ctx.createToken(MIGHT);
    },
  },
  "send packing|2": {
    onAttackDeclared(ctx) {
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (arsenal) {
        ctx.banish(arsenal.instanceId, { faceDown: false });
        ctx.setState("packed", arsenal.instanceId);
      }
    },
    onMiss(ctx) {
      const id = ctx.getState("packed");
      if (id) ctx.moveToHand(id);
    },
  },
  "cast bones|1": {
    onPlay(ctx) {
      const cards = [...topCards(ctx, 6)];
      ctx.revealCards(cards.map((card) => card.instanceId));
      const sixes = cards.filter((card) => isSix(ctx, card)).length;
      ctx.createTokens(MIGHT, sixes);
      const order: DeepReadonly<CardInstance>[] = [];
      while (cards.length) order.push(cards.splice(ctx.randomInt(cards.length), 1)[0]!);
      for (const card of [...order].reverse()) ctx.putOnDeckTop(card.instanceId);
      if (ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "might")).length >= 6) ctx.createToken(AGILITY);
    },
    onChoose() {},
  },
  "reckless charge|3": {
    onPlay(ctx) {
      ctx.requestDieRoll("reckless", 6);
    },
    onDieRollResolved(ctx, hook, result) {
      if (hook !== "reckless") return;
      ctx.changeActionPoints(ctx.seat, Math.floor(result / 2));
      if (ctx.getPlayerFlag(ctx.seat, "rolledDie:6") === true) ctx.drawCards(ctx.seat, 1);
    },
  },
  "no fear|1": {
    additionalCost(ctx) {
      const cards = ctx.player(ctx.seat).hand.filter((card) => isSix(ctx, card));
      if (cards.length) {
        ctx.requestCardChoices(
          "no-fear",
          decisionPrompt("Banish any number of cards with 6 or more power", "card.hvy.six.banish.choose", {
            values: { amount: 6 },
          }),
          cards.map((card) => card.instanceId),
          0,
          cards.length,
        );
      } else {
        ctx.preventNextDamage(ctx.seat, 2);
      }
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "no-fear") return;
      let count = 0;
      for (const option of options) {
        if (!ctx.banish(Number(option))) continue;
        count += 1;
        ctx.setState(`fear-card-${count}`, Number(option));
      }
      ctx.setState("fear-count", count);
      ctx.preventNextDamage(ctx.seat, 2 + count);
      if (count > 0)
        ctx.scheduleEndOfTurnTrigger(
          "no-fear-return",
          decisionPrompt("Return cards banished by No Fear", "card.trigger.common.nofear.return"),
          ctx.state.activePlayer,
        );
    },
    onDelayedTrigger(ctx, hook) {
      if (hook !== "no-fear-return") return;
      const count = ctx.getState("fear-count");
      for (let i = 1; i <= count; i++) ctx.moveToHand(ctx.getState(`fear-card-${i}`));
    },
  },
  "betsy, skin in the game|0": {
    triggers: [
      {
        event: "wager-generated",
        label: "Pay 2 for +1 and overpower?",
        effect(ctx, attacking) {
          if (!attacking) return;
          ctx.setState("betsy-attack", attacking.instanceId);
          ctx.requestPayment(
            "betsy-pay",
            decisionPrompt("Pay 2 for +1 and overpower?", "card.hvy.betsy.pay.generic", {
              values: { amount: 2 },
              optionMessages: commonOptionMessages("no"),
            }),
            2,
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "betsy-pay" && option === "paid") {
        ctx.addModifier({
          scope: "chain-link",
          attack: 1,
          appliesToInstanceId: ctx.getState("betsy-attack"),
          overpower: true,
        });
      }
    },
  },
  "victor goldmane, high and mighty|0": {
    firstFailedClashReplacement: { costPermanentName: "Gold", choiceHook: "victor-adult-reclash" },
    onFriendlyTokenCreated(ctx, token) {
      if (named(ctx, token, "gold") && ctx.getPlayerFlag(ctx.seat, "victorGoldDrawn") !== true) {
        ctx.setPlayerFlag(ctx.seat, "victorGoldDrawn", true);
        ctx.drawCards(ctx.seat, 1);
      }
    },
  },
  "aurum aegis|0": { allZoneNames: ["Gold"] },
  "gauntlets of iron will|0": {
    onDefend(ctx) {
      ctx.setState("replacement-ready", 1);
    },
    replacePowerGain(ctx, amount) {
      if (ctx.getState("replacement-ready") <= 0 || amount <= 0) return amount;
      ctx.setState("replacement-ready", 0);
      return Math.max(0, amount - 1);
    },
  },
  "bet big|1": wagerAttack([GOLD, MIGHT, VIGOR]),
  "primed to fight|1": {
    modifyPlayCost(ctx, base) {
      const controlled =
        ctx.player(ctx.seat).board.some((card) => named(ctx, card, "vigor")) ||
        ctx.getPlayerFlag(ctx.seat, "createdName:vigor") === true;
      return controlled ? Math.max(0, base - 1) : base;
    },
    modifyAttack(ctx) {
      return ctx.player(ctx.seat).board.some((card) => named(ctx, card, "might")) ||
        ctx.getPlayerFlag(ctx.seat, "createdName:might") === true
        ? 1
        : 0;
    },
  },
  "the golden son|2": {
    alternativePlayCost: {
      kind: "destroy-controlled-named",
      options: [{ name: "Gold", count: 1 }],
      replacesResourceCost: false,
    },
    onAlternativeCostPaid(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3, overpower: true });
    },
    onClashRevealed(ctx, won) {
      if (won) ctx.createToken(GOLD);
    },
  },
  "boast|3": { modifyDefense: (ctx) => Number(ctx.getPlayerFlag(ctx.seat, "clashesWonThisTurn")) * 2 },
  "trounce|1": {
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "trounce-one");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "trounce-one") {
        ctx.setState("trounce-winner", winner);
        ctx.requestClash(opponentSeat(ctx), "trounce-two");
      } else if (hook === "trounce-two" && winner >= 0 && winner === ctx.getState("trounce-winner")) {
        ctx.createToken(GOLD, winner);
        ctx.createToken(MIGHT, winner);
        ctx.createToken(VIGOR, winner);
      }
    },
  },
  "kassai of the golden sand|0": {
    modifyAttackActivationCost(ctx, attacker, base) {
      return has(ctx, attacker, "sword") && Number(ctx.getPlayerFlag(ctx.seat, "cardsDrawnThisTurn")) > 0
        ? Math.max(0, base - 1)
        : base;
    },
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      effectCardCosts: [
        {
          zone: "graveyard",
          move: "banish",
          count: 2,
          pitch: 1,
          prompt: decisionPrompt("Banish 2 red cards", "card.common.cost.red.banish.two"),
        },
        {
          zone: "graveyard",
          move: "banish",
          count: 2,
          pitch: 2,
          prompt: decisionPrompt("Banish 2 yellow cards", "card.common.cost.yellow.banish.two"),
        },
      ],
      label: "Next weapon hit creates Gold",
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesTo: "weapon",
          onHitScriptHook: {
            hook: "kassai-gold",
            ...hitHookLabel("create a Gold token", "card.effect.common.gold.create"),
            heroOnly: true,
          },
          once: true,
        });
      },
    },
    onGrantedHit(ctx, hook) {
      if (hook === "kassai-gold") ctx.createToken(GOLD);
    },
  },
  "grains of bloodspill|0": {
    canTriggerOnHit: (ctx) => ctx.link?.attackCardType === "weapon",
    onHit(ctx) {
      ctx.requestPayment(
        "grains",
        decisionPrompt("Pay 1 to create Vigor?", "card.hvy.vigor.pay", {
          values: { amount: 1 },
          optionMessages: commonOptionMessages("no"),
        }),
        1,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "grains" && option === "paid") ctx.createToken(VIGOR);
    },
  },
  "blade flurry|1": {
    onPlay(ctx) {
      if (ctx.link?.attackCardType === "weapon") ctx.addModifier({ scope: "chain-link", attack: 2 });
      buffNextAttack(ctx, { attack: 2, appliesTo: "weapon" });
    },
  },
  "shift the tide of battle|2": {
    canPlay: (ctx) =>
      !!ctx.link &&
      has(ctx, ctx.link.attackingCard, "warrior") &&
      ctx.currentAttackPower() > ctx.basePower(ctx.link.attackingCard),
    onPlay(ctx) {
      ctx.grantGoAgain();
      ctx.addModifier({ scope: "until-end-of-turn", onHitCreateToken: { cardId: AGILITY, count: 1 }, once: true });
    },
  },
  "up the ante|3": {
    variablePlayCost: {
      base: 0,
      maximum: ANTE_MODES.length - 1,
      stateKey: "anteX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
    },
    playTargetOptions(ctx) {
      return ctx.link ? [ctx.link.attackingCard.instanceId] : [];
    },
    additionalCost(ctx) {
      ctx.setState("ante-remaining", ctx.getState("anteX") + 1);
      requestAnteMode(ctx);
    },
    onPlay(ctx) {
      applyAnteModes(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ante-mode" || !ANTE_MODES.includes(option as AnteMode)) return;
      const mode = option as AnteMode;
      ctx.setState(`ante-mode:${mode}`, 1);
      ctx.setState("ante-remaining", ctx.getState("ante-remaining") - 1);
      requestAnteMode(ctx);
    },
  },
  "commanding performance|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToType: ["warrior"] });
      // The lingering modifier keeps this card's defended trigger live after
      // it leaves the arena.
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "your Warrior attacks get \"When this is defended by 1 or more attack action cards, destroy a card in the defending hero's arsenal\"",
          "card.effect.hvy.commandingperformance",
        ),
      });
    },
    triggers: [
      {
        event: "attack-defended",
        label: "Destroy a card in the defending hero's arsenal",
        labelMessage: { id: "card.trigger.common.defended.arsenal.destroy" },
        condition(ctx, _eventCard, event) {
          const link = ctx.link;
          if (!link || link.attacker !== ctx.seat || !ctx.currentAttackHasType("warrior")) return false;
          const added = new Set(event?.defenderInstanceIds ?? []);
          return link.defendingCards.some((card) => added.has(card.instanceId) && isAttack(ctx, card));
        },
        effect(ctx) {
          const arsenal = ctx.player(opponentSeat(ctx)).arsenal;
          if (arsenal.length === 1) ctx.moveToGraveyard(arsenal[0]!.instanceId, "arsenal");
          else if (arsenal.length > 1)
            ctx.requestCardChoice(
              "commanding-arsenal",
              decisionPrompt("Choose an arsenal card to destroy", "card.aol.arsenal.card.destroy"),
              arsenal.map((card) => card.instanceId),
            );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "commanding-arsenal") return;
      const id = Number(option);
      if (ctx.player(opponentSeat(ctx)).arsenal.some((card) => card.instanceId === id))
        ctx.moveToGraveyard(id, "arsenal");
    },
  },
  "raise an army|2": {
    additionalCost(ctx) {
      const totalGold = controlledPermanents(ctx).filter((card) => named(ctx, card, "gold")).length;
      if (totalGold > 0)
        ctx.requestChoice(
          "army-gold-count",
          decisionPrompt("How many Gold do you want to destroy?", "card.hvy.gold.count"),
          Array.from({ length: totalGold + 1 }, (_, count) => String(count)),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "army-gold-count") return;
      const gold = controlledPermanents(ctx).filter((card) => named(ctx, card, "gold"));
      const count = Number(option);
      if (!Number.isSafeInteger(count) || count < 0 || count > gold.length) return;
      let destroyed = 0;
      for (const card of gold.slice(0, count)) if (ctx.destroyPermanent(card.instanceId)) destroyed++;
      ctx.createTokens(CINTARI_SELLSWORD, destroyed);
    },
  },
  "cintari sellsword|0": {
    activated: {
      ...attackAbility(1, { goAgain: true })[0]!,
      canActivate: (ctx) => ctx.getPlayerFlag(ctx.seat, "attackedWithWeaponThisTurn") === true,
    },
  },
  "talk a big game|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "the next time you deal at least the chosen amount of damage to a hero, create that many Might tokens",
          "card.effect.hvy.talkabiggame",
        ),
      });
      ctx.requestChoice("big-number", decisionPrompt("Choose a number", "card.hvy.number.choose"), [
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
      ]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "big-number") ctx.setState("talk-threshold", Number(option));
    },
    triggers: [
      {
        event: "damage-dealt",
        label: "Create Might tokens equal to the chosen number",
        labelMessage: { id: "card.trigger.common.might.create.chosen" },
        // A delayed "next time" trigger: triggering moves the chosen number
        // from the pending threshold to the amount to create.
        condition(ctx, _eventCard, event) {
          const damage = heroDamage(event);
          const threshold = ctx.getState("talk-threshold");
          return !!damage && damage.byController && !damage.arcane && threshold > 0 && damage.amount >= threshold;
        },
        onTrigger(ctx) {
          ctx.setState("talk-might", ctx.getState("talk-threshold"));
          ctx.setState("talk-threshold", 0);
        },
        effect: (ctx) => ctx.createTokens(MIGHT, ctx.getState("talk-might")),
      },
    ],
  },
  "runner runner|1": {
    onAttackDeclared(ctx) {
      if (ctx.link?.goAgain) ctx.createToken(AGILITY);
    },
  },
  "double down|1": {
    alternativePlayCost: { kind: "destroy-controlled-named", options: [{ name: "Gold", count: 1 }] },
    onPlay(ctx) {
      // Two markers: the consumable one is the pending wagering-attack bonus;
      // the persistent one keeps the token replacement observable all turn.
      armDelayedEffect(
        ctx,
        ongoingLabel("the next attack that wagers gets +3 power and overpower", DOUBLE_DOWN_ATTACK),
      );
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel("wagers create 1 more of each token", "card.effect.hvy.doubledown.tokens"),
      });
    },
    triggers: [
      {
        event: "wager-generated",
        label: "The wagering attack gets +3 and overpower",
        condition: (ctx) => !!pendingDelayedEffect(ctx, { match: isDoubleDownAttack }),
        onTrigger: (ctx) => consumeDelayedEffect(ctx, { match: isDoubleDownAttack }),
        effect(ctx) {
          ctx.addModifier({ scope: "chain-link", attack: 3, overpower: true });
        },
      },
    ],
    globalTokenCreationReplacement: {
      label: "Double Down adds one of each wager token",
      labelMessage: decisionMessage("card.hvy.doubledown.replacement"),
      replace(_ctx, _creatingSeat, _cardId, count, cause) {
        return cause.kind === "wager" && count > 0 ? count + 1 : undefined;
      },
    },
  },
  "balance of justice|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      label: "Draw a card",
      canActivate: (ctx) => Number(ctx.getPlayerFlag(opponentSeat(ctx), "cardsDrawnThisTurn")) >= 2,
      onActivate(ctx) {
        ctx.drawCards(ctx.seat, 1);
      },
    },
  },
  "nasty surprise|3": {
    triggers: [
      {
        event: "card-put-into-graveyard",
        sourceZone: "graveyard",
        label: "Create Agility, Might, and Vigor tokens",
        condition: (ctx, card, eventContext) =>
          card?.instanceId === ctx.self.instanceId &&
          eventContext?.causedBySeat !== undefined &&
          eventContext.causedBySeat !== ctx.seat,
        effect(ctx) {
          ctx.createToken(AGILITY);
          ctx.createToken(MIGHT);
          ctx.createToken(VIGOR);
        },
      },
    ],
    onFriendlyDestroyed() {},
  },
  "pay up|1": {
    onAttackDeclared(ctx) {
      if (controlledPermanents(ctx, opponentSeat(ctx)).some((card) => named(ctx, card, "gold")))
        ctx.setFlag("link", "overpower", true);
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const gold = controlledPermanents(ctx, opponentSeat(ctx)).find((card) => named(ctx, card, "gold"));
      if (gold) ctx.steal(gold.instanceId, { duration: "indefinite" });
      else ctx.dealDamage(opponentSeat(ctx), 1);
    },
  },
  "ripple away|3": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: "Reduce action-card token creation",
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          ...ongoingLabel("action card effects create 1 fewer of each token", "card.effect.hvy.rippleaway"),
        });
      },
    },
    globalTokenCreationReplacement: {
      label: "Ripple Away removes one of each token",
      labelMessage: decisionMessage("card.hvy.rippleaway.replacement"),
      replace(ctx, _creatingSeat, _cardId, count, cause) {
        return cause.sourceCardId && ctx.cardData(cause.sourceCardId).cardType === "action" && count > 0
          ? Math.max(0, count - 1)
          : undefined;
      },
    },
  },
  "standing order|1": {
    onAttackDeclared(ctx) {
      chooseArsenalBottom(ctx, "standing");
    },
    onDefend(ctx) {
      chooseArsenalBottom(ctx, "standing");
    },
    onChoose(ctx, hook, option) {
      if (hook === "standing" && option !== "no" && ctx.putOnDeckBottom(Number(option))) {
        ctx.addCardTempPower(ctx.self.instanceId, 2);
        ctx.addCardTempDefense(ctx.self.instanceId, 2);
      }
    },
  },
  "tenacity|2": {
    onAttackDeclared(ctx) {
      const defenders = ctx.state.chain.slice(0, -1).reduce(
        (count, link) => count + link.defendingCards.length + link.defendingEquipment.length,
        0,
      );
      if (defenders > 0) ctx.addCardTempPower(ctx.self.instanceId, defenders);
    },
  },
  "seduce secrets|2": {
    onPlay(ctx) {
      const target = ctx.player(opponentSeat(ctx));
      for (const card of [...target.hand, ...target.deck.slice(0, 1)]) ctx.lookAt(card.instanceId);
      if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1);
    },
  },
  "graven call|0": {
    activated: [
      { ...attackAbility(2, { goAgain: true })[0]!, label: "Attack" },
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        fromGraveyard: true,
        effectCardCosts: [
          {
            zone: "arena",
            move: "destroy",
            count: 2,
            name: "Silver",
            prompt: decisionPrompt("Destroy 2 Silver", "card.common.cost.silver.destroy.two"),
          },
        ],
        label: "Equip from graveyard",
        onActivate(ctx) {
          if (ctx.equipFromGraveyard(ctx.self.instanceId)) ctx.addCounter(ctx.self.instanceId, "power", 1);
        },
      },
    ],
  },
  "coercive tendency|3": {
    onPlay(ctx) {
      const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, 3);
      for (const card of cards) ctx.lookAt(card.instanceId);
      if (cards.length)
        ctx.requestCardChoice(
          "coercive-first",
          decisionPrompt("Choose the top card", "card.hvy.deck.top.choose"),
          cards.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option, _unused?: never) {
      if (hook === "coercive-first") {
        ctx.setState("coercive-first", Number(option));
        const cards = ctx
          .player(opponentSeat(ctx))
          .deck.slice(0, 3)
          .filter((card) => card.instanceId !== Number(option));
        if (cards.length)
          ctx.requestCardChoice(
            "coercive-second",
            decisionPrompt("Choose the second card", "card.hvy.deck.second.choose"),
            cards.map((card) => card.instanceId),
          );
        return;
      }
      if (hook !== "coercive-second") return;
      const first = ctx.getState("coercive-first");
      const cards = ctx.player(opponentSeat(ctx)).deck.slice(0, 3);
      const third = cards.find((card) => card.instanceId !== first && card.instanceId !== Number(option));
      if (third) ctx.putOnDeckTop(third.instanceId);
      ctx.putOnDeckTop(Number(option));
      ctx.putOnDeckTop(first);
      const completions = contractCompletionCount(ctx);
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
      if (contractCompletionCount(ctx) > completions) {
        ctx.addModifier({ scope: "combat-chain", goAgain: true, appliesTo: "attack", appliesToClass: "assassin" });
        if (ctx.link?.attacker === ctx.seat && has(ctx, ctx.link.attackingCard, "assassin")) ctx.grantGoAgain();
      }
    },
  },
  "ancestral harmony|3": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToKeyword: "combo" });
      const top = ctx.player(ctx.seat).deck[0];
      if (
        top &&
        ctx.banish(top.instanceId) &&
        (data(ctx, top).keywords ?? []).some((keyword) => keyword.toLowerCase() === "combo")
      )
        ctx.allowPlayFrom(top.instanceId, "banish");
    },
  },
  "evo magneto|3": evoEquipment({
    onDefend(ctx) {
      if (ctx.destroySubcard(ctx.self.instanceId)) {
        const items = ctx
          .player(opponentSeat(ctx))
          .board.filter(
            (card) => isAttack(ctx, card) === false && has(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= 1,
          );
        if (items.length)
          ctx.requestCardChoice(
            "magneto",
            decisionPrompt("Gain control of an item", "card.hvy.item.control"),
            items.map((card) => card.instanceId),
          );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "magneto") ctx.steal(Number(option), { duration: "indefinite" });
    },
  }),
  "judge, jury, executioner|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getCounter("aim") > 0;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length > 1)
        ctx.requestCardChoice(
          "judge-keep",
          decisionPrompt("Choose a card to keep", "card.hvy.hand.keep"),
          hand.map((card) => card.instanceId),
          target,
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "judge-keep") return;
      const target = opponentSeat(ctx);
      for (const card of [...ctx.player(target).hand])
        if (card.instanceId !== Number(option)) ctx.discardCard(target, card.instanceId);
    },
  },
  "reel in|3": {
    variablePlayCost: { base: 0, stateKey: "reelX", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") },
    onPlay(ctx) {
      const looked = topCards(ctx, ctx.getState("reelX") + 1);
      for (const card of looked) ctx.lookAt(card.instanceId);
      const cards = looked.filter((card) => has(ctx, card, "trap")).slice(0, 4);
      ctx.revealCards(cards.map((card) => card.instanceId));
      for (const card of cards) ctx.moveToHand(card.instanceId);
      ctx.shuffleDeck();
    },
  },
  "sonata galaxia|1": {
    variablePlayCost: {
      base: 0,
      resourcesPerX: 2,
      stateKey: "galaxiaX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
    },
    modifyPlayCost(ctx, base) {
      const runechants = ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card)).length;
      return Math.max(0, base - runechants);
    },
    onPlay(ctx) {
      const x = ctx.getState("galaxiaX");
      const cards = ctx
        .player(ctx.seat)
        .deck.filter(
          (card) => has(ctx, card, "runeblade") && has(ctx, card, "aura") && (data(ctx, card).cost ?? 0) <= x,
        );
      if (cards.length) {
        ctx.requestCardChoice(
          "galaxia-aura",
          decisionPrompt(`Choose a Runeblade aura with cost ${x} or less`, "card.hvy.runeblade.aura.choose", {
            values: { amount: x },
          }),
          cards.map((card) => card.instanceId),
        );
        return;
      }
      ctx.shuffleDeck();
      if (x >= 2) ctx.gainActionPoint();
    },
    onChoose(ctx, hook, option) {
      if (hook !== "galaxia-aura") return;
      const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === Number(option));
      if (
        card &&
        has(ctx, card, "runeblade") &&
        has(ctx, card, "aura") &&
        (data(ctx, card).cost ?? 0) <= ctx.getState("galaxiaX")
      )
        ctx.settleCard(card.instanceId);
      ctx.shuffleDeck();
      if (ctx.getState("galaxiaX") >= 2) ctx.gainActionPoint();
    },
  },
  "aether arc|3": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [1],
    prospectiveHeroDamage(ctx) {
      return ctx.state.players
        .filter((player) => player.seat !== ctx.seat)
        .map((player) => ({ targetSeat: player.seat, amount: 1 }));
    },
    onPlay(ctx) {
      for (const target of ctx.state.players.filter((player) => player.seat !== ctx.seat))
        if (ctx.dealDamage(target.seat, 1, { arcane: true }) > 0) ctx.createToken(PONDER);
    },
  },
  "dissolve reality|2": {
    onPlay(ctx) {
      for (const player of ctx.state.players) {
        for (const card of [...player.arsenal]) ctx.putOnDeckBottom(card.instanceId);
        ctx.createToken(PONDER, player.seat);
      }
    },
  },
  "luminaris, angel's glow|0": {
    onFriendlyPlay(ctx, card) {
      if (!isAttack(ctx, card) || !ctx.player(ctx.seat).pitch.some((pitch) => ctx.cardColor(pitch) === 2)) return;
      if (cardNameContains(ctx, card, "Herald") && ctx.getPlayerFlag(ctx.seat, "luminarisHerald") !== true) {
        ctx.setPlayerFlag(ctx.seat, "luminarisHerald", true);
        ctx.grantCardKeyword(card.instanceId, "go again");
      }
    },
    onFriendlyActivate(ctx, card) {
      if (
        !has(ctx, card, "angel") ||
        !ctx.player(ctx.seat).pitch.some((pitch) => ctx.cardColor(pitch) === 2) ||
        ctx.getPlayerFlag(ctx.seat, "luminarisAngel") === true
      )
        return;
      ctx.setPlayerFlag(ctx.seat, "luminarisAngel", true);
      ctx.grantCardKeyword(card.instanceId, "go again");
    },
  },
};
