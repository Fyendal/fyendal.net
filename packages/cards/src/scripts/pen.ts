import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "@fyendal/engine";
import type { CounterKind } from "@fyendal/shared";
import {
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  cardNameContains,
  commonOptionMessages,
  contractWithSilver,
  controlledPermanents,
  controlsNamed,
  createdThisTurn,
  dealArcane,
  dealArcaneToTargetHero,
  decisionMessage,
  decisionPrompt,
  decompose,
  entersArenaTrigger,
  equipWithSilver,
  equipmentZoneCards,
  equippedCards,
  faceUpGraveyard,
  heroChoiceSeat,
  heroDamage,
  heroTarget,
  hitHookLabel,
  hitWithDaggerThisChain,
  isAttackAction,
  isSixPlus,
  leavesArenaTrigger,
  mergeSetScripts,
  ongoingLabel,
  opponentSeat,
  optN,
  optOnChoose,
  pitches,
  queueIntimidate,
  requestDiscardChoice,
  requestHeroChoice,
  resolveDiscardChoice,
  unityEquipment,
  yesNoPrompt,
  warnIfNoActionPoint,
  cardNamed,
  hasCardSubtype,
  isAura,
  isDagger,
  isNonAttackAction,
  isSword,
  arenaAllies,
  isAlly,
  isItem,
  hasLessLife,
  hasMoreLife,
} from "./shared-helpers.js";
import { SHARPEN_FOLLOWUP, sharpenSword } from "./aha/warrior-sharpen.js";
import { penHighRarity } from "./pen/high-rarity.js";
import { concoctDisorder } from "./sar.js";
import { LIVING_LEGEND_HEROES } from "../formatLegality.js";
import { hasType } from "@fyendal/shared";
import {
  AGILITY,
  BLOODROT_POX,
  COURAGE,
  EMBODIMENT_OF_EARTH,
  EMBODIMENT_OF_LIGHTNING,
  FANG_STRIKE,
  FRAILTY,
  FROSTBITE,
  GOLD,
  HYPER_DRIVER,
  INERTIA,
  MIGHT,
  PONDER,
  QUICKEN,
  RUNECHANT,
  SEISMIC_SURGE,
  SIGIL_OF_FATE,
  SLITHER,
  SPECTRAL_SHIELD,
  SPELLBANE_AEGIS,
  VIGOR,
} from "./tokens.js";

// Compendium of Rathe (PEN) — complete set and required tokens.

type Card = DeepReadonly<CardInstance>;

// Token replacements see a card id before any instance exists.
function printedHasTag(ctx: ScriptCtx, cardId: string, tag: string): boolean {
  const d = ctx.cardData(cardId);
  return [...(d.classes ?? []), ...(d.subtypes ?? [])].includes(tag);
}

// Static ability of a permanent: inert while Haboob is only a defending card on the chain.
function haboobPower(ctx: ScriptCtx, card: Card): number {
  const inArena = ctx.player(ctx.seat).board.some((c) => c.instanceId === ctx.self.instanceId);
  return inArena && isAttackAction(ctx, card) ? -1 : 0;
}

function haboobAsh(ctx: ScriptCtx) {
  return ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "Ash"));
}

function requestDeepRecessesBanish(ctx: ScriptCtx, startSeat = 0): void {
  for (let seat = startSeat; seat < ctx.state.players.length; seat++) {
    const graveyard = faceUpGraveyard(ctx, seat);
    if (ctx.player(seat).flags.lostLifeThisTurn !== true || graveyard.length === 0) continue;
    ctx.requestCardChoice(
      `deep-recesses-graveyard:${seat}`,
      decisionPrompt(`Choose a card from hero ${seat + 1}'s graveyard to banish`, "card.pen.graveyard.card.banish", {
        values: { hero: seat + 1 },
      }),
      graveyard.map((card) => card.instanceId),
    );
    return;
  }
}

function continuePoundOfFlesh(ctx: ScriptCtx, startIndex = 0): void {
  const seats = [ctx.seat, ...ctx.state.players.map((player) => player.seat).filter((seat) => seat !== ctx.seat)];
  for (let index = startIndex; index < seats.length; index++) {
    const seat = seats[index]!;
    const hand = ctx.player(seat).hand;
    if (hand.length === 0) continue;
    ctx.requestCardChoice(
      `pen-pound-banish:${index}`,
      decisionPrompt("Banish a card from your hand", "card.common.hand.card.banish"),
      hand.map((card) => card.instanceId),
      seat,
    );
    return;
  }
  for (const player of ctx.state.players) {
    if (ctx.getState(`pound-six:${player.seat}`) !== 1) ctx.loseLife(player.seat, 1);
  }
}

function allPermanents(ctx: ScriptCtx): Card[] {
  return ctx.state.players.flatMap((player) => controlledPermanents(ctx, player.seat));
}

function heroesAndAllies(ctx: ScriptCtx): Card[] {
  return ctx.state.players.flatMap((player) => [
    player.hero,
    ...player.board.filter((card) => isAlly(ctx, card)),
  ]);
}

function create(ctx: ScriptCtx, cardId: string, count = 1, seat = ctx.seat): void {
  ctx.createTokens(cardId, count, seat);
}

/** Cloaked trap: "While this is equipped face-down, when an attack … hits
 * you". The attack's combat damage to this hero is the hit; the trigger stays
 * anonymous while face-down. */
function concealedHitTrap(token: string, tokenName: string, attackMatches: (ctx: ScriptCtx) => boolean): CardScript {
  return {
    triggersWhileFaceDown: true,
    triggers: [
      {
        event: "damage-dealt",
        whose: "any",
        label: `Destroy this and create ${tokenName} under each opponent's control`,
        labelMessage: { id: "card.trigger.common.concealed.token", values: { token: tokenName } },
        condition: (ctx, _eventCard, event) => {
          const damage = heroDamage(event);
          return !!damage?.combat && damage.targetSeat === ctx.seat && ctx.self.faceDown === true && attackMatches(ctx);
        },
        effect(ctx) {
          ctx.notifyTrapTriggered();
          ctx.destroySelf();
          create(ctx, token, 1, opponentSeat(ctx));
        },
      },
    ],
  };
}

function penArcaneSpell(
  amount: number,
  createSigil = false,
  replacement?: { amount: number; when: (ctx: ScriptCtx) => boolean },
): CardScript {
  const damage = (ctx: ScriptCtx) => replacement?.when(ctx) ? replacement.amount : amount;
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: replacement ? [amount, replacement.amount] : [amount],
    onPlay(ctx) {
      const preview = ctx.previewArcaneDamage(damage(ctx));
      const allies = ctx.state.players.flatMap((player) =>
        arenaAllies(ctx, player).map((card) => ({ player, card })),
      );
      ctx.requestChoice(
        "pen-arcane",
        decisionPrompt(
          `${ctx.data.name}: deal ${preview} arcane damage to which target?`,
          "card.pen.arcane.target.choose",
          {
            values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: preview },
            optionMessages: {
              opponent: decisionMessage("common.option.opponent"),
              you: decisionMessage("card.pen.option.you"),
            },
          },
        ),
        ["opponent", "you", ...allies.map(({ player, card }) => `ally:${player.seat}:${card.instanceId}`)],
        ctx.seat,
        [null, null, ...allies.map(({ card }) => card.instanceId)],
        "opponent",
      );
    },
    onDamageDealt(ctx, _target, dealt, arcane) {
      if (createSigil && arcane && dealt > 0) create(ctx, SIGIL_OF_FATE);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-arcane") return;
      const ally = /^ally:(\d+):(\d+)$/.exec(option);
      if (ally) dealArcane(ctx, Number(ally[1]), damage(ctx), Number(ally[2]));
      else dealArcane(ctx, option === "you" ? ctx.seat : opponentSeat(ctx), damage(ctx));
    },
  };
}

function bond(tag: "earth" | "ice" | "lightning", effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onPlayCostPaid(ctx, paid) {
      if (paid.some((card) => hasCardSubtype(ctx, card, tag))) ctx.setState("bonded", 1);
    },
    onPlay(ctx) {
      if (ctx.getState("bonded") > 0) effect(ctx);
    },
  };
}

function nextAttackPump(amount: number, extra: Partial<Parameters<typeof buffNextAttack>[1]> = {}): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: amount, ...extra });
    },
  };
}

function discardAllyAttack(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const allies = ctx.player(ctx.seat).hand.filter((card) => isAlly(ctx, card));
      if (allies.length)
        ctx.requestCardChoice(
          "pen-discard-ally",
          decisionPrompt(`${ctx.data.name}: discard an ally?`, "card.pen.ally.discard", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...allies.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-discard-ally" || option === "no" || !ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.grantGoAgain();
    },
  };
}

function auraFromGraveArcane(): CardScript {
  return {
    arcaneDamageEffect: true,
    onAttackDeclared(ctx) {
      const auras = faceUpGraveyard(ctx).filter((card) => isAura(ctx, card));
      if (auras.length)
        ctx.requestCardChoice(
          "pen-banish-aura",
          decisionPrompt(
            `${ctx.data.name}: banish an aura for ${ctx.previewArcaneDamage(1)} arcane damage?`,
            "card.pen.aura.banish.arcane",
            {
              values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: ctx.previewArcaneDamage(1) },
              optionMessages: commonOptionMessages("no"),
            },
          ),
          ["no", ...auras.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-banish-aura" || option === "no" || !ctx.banish(Number(option))) return;
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  };
}

function contractColor(color: 1 | 2 | 3, repeat = false): CardScript {
  return {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === color),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const first = ctx.player(target).deck[0];
      if (!first) return;
      const matches = ctx.cardColor(first) === color;
      ctx.banish(first.instanceId);
      if (repeat && matches) {
        const second = ctx.player(target).deck[0];
        if (second) ctx.banish(second.instanceId);
      }
    },
  };
}

function leaveToken(cardId: string): CardScript {
  return {
    onDestroyed(ctx) {
      create(ctx, cardId);
    },
  };
}

function createSigils(count: number): CardScript {
  return {
    onPlay(ctx) {
      create(ctx, SIGIL_OF_FATE, count);
    },
  };
}

function gravenEquipment(): CardScript {
  return {
    onGameStart(ctx) {
      ctx.addCardDefenseCounters(ctx.self.instanceId, 1);
    },
    triggers: [
      entersArenaTrigger(
        "Put a -1 defense counter on this",
        decisionMessage("card.trigger.common.defensecounter.minus", { amount: 1 }),
        (ctx) => {
          ctx.addCardDefenseCounters(ctx.self.instanceId, 1);
        },
        { condition: (_ctx, _card, event) => event?.from !== "graveyard" },
      ),
      equipWithSilver(2),
    ],
  };
}

function evoBeta(slot: "head" | "chest" | "arms" | "legs"): CardScript {
  return {
    playableEquipment: true,
    transformsEquipment: (ctx, equipped) => hasCardSubtype(ctx, equipped, "base"),
    playAsInstant(ctx) {
      return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true;
    },
    modifyFriendlyCardPlayCost(ctx, card, _zone, base) {
      return hasCardSubtype(ctx, card, "evo") && hasCardSubtype(ctx, card, slot) ? Math.max(0, base - 1) : base;
    },
  };
}

function oathOfOak(count: number): CardScript {
  return {
    onPlay(ctx) {
      create(ctx, EMBODIMENT_OF_EARTH, count);
    },
  };
}

function putOnIce(count: number): CardScript {
  return {
    onPlay(ctx) {
      const allies = ctx.state.players.flatMap((player) => player.board).filter((card) =>
        isAlly(ctx, card));
      if (allies.length)
        ctx.requestCardChoices(
          "pen-freeze-ally",
          decisionPrompt(
            `Choose up to ${count} ${count === 1 ? "ally" : "allies"} to freeze`,
            "card.pen.ally.freeze.choose",
            { values: { count } },
          ),
          allies.map((card) => card.instanceId),
          0,
          count,
        );
      if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1);
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "pen-freeze-ally") return;
      for (const option of options) ctx.setCardState(Number(option), "frozenUntilTurn", ctx.state.turn + 2);
    },
  };
}

function phoenixBannerman(token: string): CardScript {
  return {
    onPlay(ctx) {
      const flame = ctx.player(ctx.seat).deck.find((card) => cardNamed(ctx, card, "Phoenix Flame"));
      if (flame) ctx.moveToHand(flame.instanceId);
      ctx.shuffleDeck();
      create(ctx, token);
    },
  };
}

function chooseTokenToDestroy(ctx: ScriptCtx, hook: string, name: string): void {
  const choices = ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, name));
  if (choices.length)
    ctx.requestCardChoice(
      hook,
      decisionPrompt(`${ctx.data.name}: destroy a ${name}?`, "card.pen.token.destroy.named", {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, token: name },
        optionMessages: commonOptionMessages("no"),
      }),
      ["no", ...choices.map((card) => card.instanceId)],
    );
}

function elixir(tokenName: string): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3 });
      chooseTokenToDestroy(ctx, "pen-elixir", tokenName);
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-elixir" && option !== "no" && ctx.destroyPermanent(Number(option))) ctx.gainLife(ctx.seat, 1);
    },
  };
}

const GALCIA_FREEZE_TARGET: NonNullable<TriggerDef["target"]> = {
  options: (ctx) =>
    ctx.state.players
      .flatMap((player) => [
        ...player.board.filter((card) => ["ally", "aura", "item"].some((tag) => hasCardSubtype(ctx, card, tag))),
        ...equippedCards(ctx, player.seat),
      ])
      .map((card) => card.instanceId),
  prompt: () => decisionPrompt("Freeze a permanent", "card.pen.permanent.freeze"),
};

function freezeGalciaTarget(ctx: ScriptCtx): void {
  if (ctx.playTargetInstanceId !== undefined) ctx.freezeWhileInArena(ctx.playTargetInstanceId);
}

function tendenciesTargets(ctx: ScriptCtx, subtype: "item" | "aura"): Card[] {
  return ctx.state.players
    .flatMap((player) => player.board)
    .filter((card) => hasCardSubtype(ctx, card, subtype) && ctx.hasCardType(card, "token"));
}

/** Ask for Destructive Tendencies' aura token; without one, resolve the item. */
function requestTendenciesAura(ctx: ScriptCtx, itemChosen: boolean): void {
  const auras = tendenciesTargets(ctx, "aura");
  if (auras.length === 0) {
    finishTendencies(ctx);
    return;
  }
  ctx.requestCardChoice(
    "pen-tendencies-aura",
    decisionPrompt("Remove all counters from target aura token", "card.pen.token.aura.counters.remove", {
      optionMessages: commonOptionMessages("pass"),
    }),
    [...(itemChosen ? ["pass"] : []), ...auras.map((card) => card.instanceId)],
  );
}

/** Remove all counters from the chosen item token and aura token together. */
function finishTendencies(ctx: ScriptCtx, auraId?: number): void {
  const itemId = ctx.getState("tendenciesItem");
  ctx.setState("tendenciesItem", 0);
  for (const card of ctx.state.players.flatMap((player) => player.board)) {
    if (card.instanceId !== itemId && card.instanceId !== auraId) continue;
    for (const key of (Object.keys(card.counters ?? {}) as CounterKind[])) ctx.setCardCounter(card.instanceId, key, 0);
  }
}

export const pen: Record<string, CardScript> = mergeSetScripts("PEN", penHighRarity, {
  "buzzard helm|0": {
    onDefend(ctx) {
      ctx.drawCards(ctx.seat, 1);
      if (isSixPlus(ctx, ctx.discardRandom(ctx.seat, 1)[0])) ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },
  "skera strapping|0": {
    spellvoidValue: (ctx) => (ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) ? 3 : 0),
  },
  "rip off the top|2": {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand.filter((card) => (ctx.cardData(card.cardId).pitch ?? 0) > 0);
      const pitched = hand[ctx.randomInt(hand.length)];
      if (pitched && ctx.pitchCard(pitched.instanceId) && isSixPlus(ctx, pitched)) buffNextAttack(ctx, { attack: 3 });
    },
  },
  ...pitches("aggressive pounce", () => ({
    hasConditionalGoAgain: (ctx) => ctx.getFlag("player", "intimidatedThisTurn") === true,
  })),
  "bear hug|1": { canPlay: (ctx) => ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) },
  "bear hug|2": { canPlay: (ctx) => ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) },

  "volcanic vice|0": { spellvoidValue: (ctx) => (ctx.getFlag("player", "createdName:seismic surge") === true ? 3 : 0) },
  "valahai riven|2": {
    defendCost: 3,
    onDefend(ctx) {
      ctx.requestXPayment(
        "pen-valahai",
        decisionPrompt("Pay up to 3 resources for Seismic Surge tokens", "card.pen.seismic.resources.pay", {
          values: { count: 3 },
        }),
        ctx.seat,
        3,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-valahai" && option.startsWith("x:")) create(ctx, SEISMIC_SURGE, Number(option.slice(2)));
    },
  },
  ...pitches("distant rumbling", (pitch) => ({
    triggers: [
      entersArenaTrigger(
        "Draw a card, then put a card from your hand fifth from the top",
        decisionMessage("card.trigger.pen.distantrumbling.draw.fifth"),
        (ctx) => {
          ctx.drawCards(ctx.seat, 1);
          const hand = ctx.player(ctx.seat).hand;
          if (hand.length)
            ctx.requestCardChoice(
              "pen-rumbling-hand",
              decisionPrompt("Put a card from hand fifth from the top", "card.pen.hand.fifthfromtop"),
              hand.map((card) => card.instanceId),
            );
        },
      ),
      {
        event: "start-of-turn",
        label: "Destroy this and create Seismic Surges",
        effect(ctx) {
          ctx.destroySelf();
          create(ctx, SEISMIC_SURGE, 4 - pitch);
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "pen-rumbling-hand") ctx.putOnDeckAtDepth(Number(option), 5);
    },
  })),
  ...pitches("rites of earthlore", (pitch) => ({
    triggers: [
      entersArenaTrigger(
        "Create a Seismic Surge token",
        decisionMessage("card.trigger.common.seismicsurge.create"),
        (ctx) => create(ctx, SEISMIC_SURGE),
      ),
      {
        event: "start-of-turn",
        label: "Destroy this and empower the next Guardian attack",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { attack: 4 - pitch, appliesToClass: "guardian", appliesTo: "attack-action" });
        },
      },
    ],
  })),

  "dyed silk sleeves|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      tap: true,
      canActivate: (ctx) =>
        !!ctx.link &&
        hasCardSubtype(ctx, ctx.link.attackingCard, "ninja") &&
        ctx
          .player(ctx.seat)
          .weapons.some(
            (card) => isDagger(ctx, card) && card.instanceId !== ctx.link?.attackingCard.instanceId,
          ),
      effectCardCosts: [
        {
          zone: "arena",
          move: "destroy",
          count: 1,
          subtype: "dagger",
          prompt: decisionPrompt("Destroy an off-chain dagger", "card.common.cost.offchaindagger.destroy"),
        },
      ],
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
        ctx.setState("armed", 1);
      },
    },
    onMiss(ctx) {
      if (ctx.getState("armed")) ctx.destroySelf();
    },
  },
  "two steps forward|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.hitsThisCombatChain() >= 2,
      onActivate(ctx) {
        create(ctx, AGILITY);
      },
    },
  },
  "feign vengeance|3": {
    onAttackResolved(ctx) {
      if ((ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0) > 0)
        ctx.drawCards(ctx.seat, 1);
    },
  },
  ...pitches("become the bottle", () => ({
    onAttackDeclared(ctx) {
      const cards = ctx.state.chain.flatMap((link) => [
        link.attackingCard,
        ...link.defendingCards,
        ...link.defendingEquipment,
        ...link.reactions,
      ]);
      if (cards.length)
        ctx.requestCardChoice(
          "pen-bottle-name",
          decisionPrompt("Choose a card on the combat chain", "card.pen.combatchain.card.choose"),
          cards.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-bottle-name") return;
      const chosen = ctx.state.chain
        .flatMap((link) => [link.attackingCard, ...link.defendingCards, ...link.defendingEquipment, ...link.reactions])
        .find((card) => card.instanceId === Number(option));
      if (!chosen) return;
      for (const name of ctx.cardNames(chosen)) {
        const canonicalCardId = ctx.cardIdsNamed(name)[0];
        ctx.grantCardName(ctx.self.instanceId, canonicalCardId ? ctx.cardData(canonicalCardId).name : name);
      }
    },
  })),
  ...pitches("become the cup", () => ({
    additionalCost(ctx) {
      ctx.requestChoice(
        "pen-cup-color",
        decisionPrompt("Choose a color", "card.common.color.choose", {
          optionMessages: {
            red: decisionMessage("card.pen.option.red"),
            yellow: decisionMessage("card.pen.option.yellow"),
            blue: decisionMessage("card.pen.option.blue"),
          },
        }),
        ["red", "yellow", "blue"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-cup-color") return;
      ctx.setCardColor(ctx.self.instanceId, option === "red" ? 1 : option === "yellow" ? 2 : 3);
    },
  })),

  "plating of unity|0": unityEquipment(),
  "pillar of unity|0": unityEquipment(),
  "rend flesh|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesTo: "sword",
        onHitScriptHook: {
          hook: "pen-rend-flesh",
          ...hitHookLabel("remove a +1 power counter for the hit hero to lose 2 life", "card.effect.pen.rendflesh"),
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "pen-rend-flesh") return;
      const sword = ctx.link?.attackingCard;
      if (!sword || Number(sword.counters?.power ?? 0) <= 0) return;
      ctx.setState("rendFleshSword", sword.instanceId);
      ctx.requestChoice(
        "pen-rend-flesh-remove",
        decisionPrompt(
          "Rend Flesh: remove a +1 power counter for the hit hero to lose 2 life?",
          "card.pen.rendflesh.counter.remove",
          { optionMessages: commonOptionMessages("yes", "no") },
        ),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-rend-flesh-remove" || option !== "yes") return;
      const sword = ctx.link?.attackingCard;
      if (
        !sword ||
        sword.instanceId !== ctx.getState("rendFleshSword") ||
        Number(sword.counters?.power ?? 0) <= 0
      ) return;
      ctx.addCounter(sword.instanceId, "power", -1);
      ctx.loseLife(opponentSeat(ctx), 2);
    },
  },
  ...pitches("display of craftsmanship", (pitch) => ({
    canPlay: (ctx) => ctx.link?.attackCardType === "weapon",
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 5 - pitch });
      const weapon = ctx.link?.attackingCard;
      if (weapon && Number(weapon.scriptState?.sharpenedTurn ?? 0) === ctx.state.turn)
        ctx.addCounter(weapon.instanceId, "power", 1);
    },
  })),
  ...pitches("cut n' carve", (pitch) => ({
    onPlay(ctx) {
      const swords = ctx.player(ctx.seat).weapons.filter((card) => isSword(ctx, card));
      if (swords.length)
        ctx.requestCardChoice(
          "pen-sharpen",
          decisionPrompt("Choose a sword to sharpen", "card.common.sword.sharpen"),
          swords.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-sharpen") return;
      sharpenSword(ctx, Number(option), 1, {
        threshold: pitch,
        kind: SHARPEN_FOLLOWUP.DOMINATE,
      });
    },
  })),

  "mbrio base vizier|0": {
    optionalDamagePrevention: {
      amount: 1,
      arcaneOnly: true,
      removeCounter: { key: "steam", from: (ctx, permanent) => cardNamed(ctx, permanent, "Hyper Driver") },
    },
  },
  "mbrio base cortex|0": { modifyDefense: (ctx) => (controlsNamed(ctx, "Hyper Driver") ? 2 : 0) },
  "mbrio base digits|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      effectCardCosts: [
        {
          zone: "arena",
          move: "tap",
          count: 1,
          subtype: "cog",
          prompt: decisionPrompt("Tap a cog", "card.common.cost.cog.tap"),
        },
      ],
      onActivate(ctx) {
        ctx.addCardTempDefense(ctx.self.instanceId, 1);
      },
    },
  },
  "blast rig|1": { modifyAttack: (ctx) => ctx.countEquipped("evo") },
  "speed demon|1": {
    declareAdditionalCost(ctx) {
      const choices = faceUpGraveyard(ctx)
        .filter((card) => isItem(ctx, card) || ctx.hasCardType(card, "equipment"));
      if (choices.length)
        ctx.requestCardChoice(
          "pen-scrap",
          decisionPrompt("Scrap an item or equipment from your graveyard?", "card.common.scrap.choose", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...choices.map((card) => card.instanceId)],
        );
    },
    modifyAttack: (ctx) => (controlsNamed(ctx, "Hyper Driver") ? 1 : 0),
    onChoose(ctx, hook, option) {
      if (hook !== "pen-scrap" || option === "no") return;
      const target = faceUpGraveyard(ctx).find(
          (card) =>
            card.instanceId === Number(option) &&
            (isItem(ctx, card) || ctx.hasCardType(card, "equipment")),
        );
      if (!target) return;
      const driver = cardNamed(ctx, target, "Hyper Driver");
      if (ctx.banish(target.instanceId) && driver) ctx.setState("scrappedDriver", 1);
    },
    onAttackDeclared(ctx) {
      if (ctx.getState("scrappedDriver")) ctx.createToken(HYPER_DRIVER, undefined, { steam: 2 });
    },
  },
  "assembly module|3": {
    onEnterArena(ctx) {
      ctx.setCounter("steam", 1);
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Remove a steam counter or destroy this",
        labelMessage: decisionMessage("card.trigger.common.steam.maintain"),
        effect(ctx) {
          if (ctx.getCounter("steam") <= 0) ctx.destroySelf();
          else ctx.setCounter("steam", ctx.getCounter("steam") - 1);
        },
      },
    ],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      tap: true,
      onActivate(ctx) {
        const drivers = ctx.player(ctx.seat).deck.filter((card) => cardNamed(ctx, card, "Hyper Driver"));
        if (drivers.length === 0) {
          ctx.shuffleDeck();
          return;
        }
        ctx.requestCardChoice(
          "assembly-module-search",
          decisionPrompt("Search your deck for a Hyper Driver and put it into the arena?", "card.pen.hyperdriver.search.arena", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...drivers.map((card) => card.instanceId)],
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "assembly-module-search") return;
      if (option !== "no") ctx.settleCard(Number(option));
      ctx.shuffleDeck();
    },
  },
  "evo beta base head|3": evoBeta("head"),
  "evo beta base chest|3": evoBeta("chest"),
  "evo beta base arms|3": evoBeta("arms"),
  "evo beta base legs|3": evoBeta("legs"),
  ...pitches("heavy metal hardcore", () => ({
    modifyAttack: (ctx) => (ctx.getFlag("player", "boostedSubtype:evo") === true ? 1 : 0),
  })),

  "concealed nerve gas|0": concealedHitTrap(FRAILTY, "Frailty", (ctx) => ctx.currentAttackHasGoAgain()),
  "concealed pathogen|0": concealedHitTrap(
    BLOODROT_POX,
    "Bloodrot Pox",
    (ctx) => !!ctx.link && ctx.link.flags[`reactionBySeat:${ctx.link.attacker}`] === true,
  ),
  "concealed sedative|0": concealedHitTrap(INERTIA, "Inertia", (ctx) => ctx.attackBonusAboveBase() > 0),
  "rainbow goo trap|1": {
    canTriggerOnDefend: (ctx) =>
      ctx.attackBonusAboveBase() > 0 && ctx.currentAttackHasDominate() && ctx.currentAttackHasGoAgain(),
    onDefend(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: -2, seat: opponentSeat(ctx) });
      ctx.suppressAttackAbilities();
    },
  },
  "courageous crossing|3": {
    onPlay(ctx) {
      requestHeroChoice(
        ctx,
        "courageous-crossing-hero",
        `${ctx.data.name}: choose target hero`,
        "card.common.target.hero.choose",
        { values: { card: { kind: "card", cardId: ctx.self.cardId } }, defaultOption: "your hero" },
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "courageous-crossing-hero") return;
      const seat = heroChoiceSeat(ctx, option);
      if (seat !== undefined) create(ctx, COURAGE, 1, seat);
    },
    canTriggerOnDefend: (ctx) => ctx.attackBonusAboveBase() > 0,
    onDefendTarget: {
      options: (ctx) =>
        allPermanents(ctx).filter((card) => Number(card.counters?.power ?? 0) > 0).map((card) => card.instanceId),
      prompt: () => decisionPrompt("Remove a +1 power counter", "card.pen.powercounter.remove"),
    },
    onDefend(ctx) {
      if (ctx.playTargetInstanceId !== undefined) ctx.addCounter(ctx.playTargetInstanceId, "power", -1);
    },
  },
  "frail swingline|3": {
    onPlay(ctx) {
      requestHeroChoice(
        ctx,
        "frail-swingline-hero",
        `${ctx.data.name}: choose target hero`,
        "card.common.target.hero.choose",
        { values: { card: { kind: "card", cardId: ctx.self.cardId } }, defaultOption: "opposing hero" },
      );
    },
    canTriggerOnDefend: (ctx) => !!ctx.link && ctx.currentAttackPower() < ctx.basePower(ctx.link.attackingCard),
    onDefend(ctx) {
      requestDiscardChoice(
        ctx,
        "frail-swingline-discard",
        decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "frail-swingline-hero") {
        const seat = heroChoiceSeat(ctx, option);
        if (seat !== undefined) create(ctx, FRAILTY, 1, seat);
      }
      if (hook === "frail-swingline-discard") resolveDiscardChoice(ctx, option, opponentSeat(ctx));
    },
  },
  "quickening sand|3": {
    onPlay(ctx) {
      requestHeroChoice(
        ctx,
        "quickening-sand-hero",
        `${ctx.data.name}: choose target hero`,
        "card.common.target.hero.choose",
        { values: { card: { kind: "card", cardId: ctx.self.cardId } }, defaultOption: "your hero" },
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "quickening-sand-hero") return;
      const seat = heroChoiceSeat(ctx, option);
      if (seat !== undefined) create(ctx, QUICKEN, 1, seat);
    },
    canTriggerOnDefend: (ctx) => ctx.currentAttackHasGoAgain(),
    onDefendTarget: {
      options: (ctx) => heroesAndAllies(ctx).map((card) => card.instanceId),
      prompt: () => decisionPrompt("Tap target hero or ally", "card.common.heroally.tap"),
    },
    onDefend(ctx) {
      if (ctx.playTargetInstanceId !== undefined) ctx.tap(ctx.playTargetInstanceId);
    },
  },
  ...pitches("spellbane trap", (pitch) => ({
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "arrow" });
    },
    canTriggerOnDefend: (ctx) => ctx.getPlayerFlag(opponentSeat(ctx), "arcaneDamageDealtThisTurn") === true,
    onDefend(ctx) {
      create(ctx, SPELLBANE_AEGIS);
    },
  })),

  "blackstone greaves|0": {
    modifyDefense: (ctx) => (ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true ? 1 : 0),
  },
  "runic fellingsong|2": auraFromGraveArcane(),
  "runic fellingsong|3": auraFromGraveArcane(),
  ...pitches("weeping battleground", () => ({
    onPlay(ctx) {
      const auras = faceUpGraveyard(ctx).filter((card) => isAura(ctx, card));
      if (auras.length)
        ctx.requestCardChoice(
          "pen-weeping",
          decisionPrompt(
            `Banish an aura for ${ctx.previewArcaneDamage(1)} arcane damage?`,
            "card.pen.aura.banish.arcane.unnamed",
            { values: { amount: ctx.previewArcaneDamage(1) }, optionMessages: commonOptionMessages("no") },
          ),
          ["no", ...auras.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-weeping" && option !== "no" && ctx.banish(Number(option)))
        dealArcane(ctx, opponentSeat(ctx), 1);
    },
  })),

  "shroud of the fate watcher|0": {
    triggers: [
      leavesArenaTrigger(
        "Create a Sigil of Fate token",
        decisionMessage("card.trigger.common.sigiloffate.create"),
        (ctx) => create(ctx, SIGIL_OF_FATE),
      ),
    ],
  },
  "robe of resourcefulness|0": {
    triggers: [
      leavesArenaTrigger(
        "Gain 2 resources",
        decisionMessage("card.trigger.common.resources.gain", { amount: 2 }),
        (ctx) => ctx.gainResources(ctx.seat, 2),
      ),
    ],
  },
  "gloves of erasure|0": {
    triggers: [
      leavesArenaTrigger(
        "Destroy target aura token",
        decisionMessage("card.trigger.common.auratoken.target.destroy"),
        (ctx) => {
          if (ctx.playTargetInstanceId !== undefined) ctx.destroyPermanent(ctx.playTargetInstanceId);
        },
        {
          target: {
            options: (ctx) =>
              ctx.state.players
                .flatMap((player) => player.board)
                .filter((card) => isAura(ctx, card) && ctx.hasCardType(card, "token"))
                .map((card) => card.instanceId),
            prompt: () => decisionPrompt("Destroy an aura token", "card.common.cost.auratoken.destroy"),
          },
        },
      ),
    ],
  },
  "glyph power spell|1": penArcaneSpell(4, false, {
    amount: 6,
    when: (ctx) => controlledPermanents(ctx, ctx.seat).some((card) => !card.faceDown && ctx.cardNames(card).some((name) => name.includes("sigil"))),
  }),
  "painful premonition|1": penArcaneSpell(3, true),
  "painful premonition|2": penArcaneSpell(2, true),
  "painful premonition|3": penArcaneSpell(1, true),
  "future sight|1": createSigils(3),
  "future sight|2": createSigils(2),
  "future sight|3": createSigils(1),
  "sigil of fate|0": {
    triggers: [
      leavesArenaTrigger("Opt 1", decisionMessage("card.trigger.common.opt", { amount: 1 }), (ctx) => optN(ctx, 1)),
      {
        event: "begin-action-phase",
        label: "Destroy Sigil of Fate",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
    onChoose: optOnChoose,
  },
  "embody greatness|2": {
    additionalCost(ctx) {
      const available = [...LIVING_LEGEND_HEROES].flatMap((name) => {
        const heroId = ctx.cardIdsNamed(name).find((cardId) => hasType(ctx.cardData(cardId), "hero"));
        return heroId ? [ctx.cardData(heroId).name] : [];
      });
      if (available.length) {
        ctx.requestChoice(
          "pen-embody-hero",
          decisionPrompt("Name a living legend hero", "card.pen.livinglegend.hero.name"),
          [...available],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-embody-hero") return;
      const heroId = ctx.cardIdsNamed(option).find((cardId) => hasType(ctx.cardData(cardId), "hero"));
      if (heroId) ctx.becomeHeroUntilNextTurn(heroId);
    },
  },

  "silken shroud|0": leaveToken(PONDER),
  "silken shawl|0": leaveToken(VIGOR),
  "silken symphony|0": leaveToken(MIGHT),
  "silken slippers|0": leaveToken(AGILITY),
  "shimmering mirage|3": {
    onChainLinkResolved(ctx) {
      if (ctx.banish(ctx.self.instanceId)) {
        ctx.allowPlayFrom(ctx.self.instanceId, "banish", { untilChainClose: true });
      }
    },
  },
  ...pitches("power of make believe", () => ({
    modifyAttack(ctx) {
      return (ctx.link?.defendingCards ?? []).filter((card) => isSixPlus(ctx, card)).length;
    },
  })),
  ...pitches("shimmering specter", () => ({
    triggers: [
      leavesArenaTrigger(
        "Create a Spectral Shield token",
        decisionMessage("card.trigger.common.spectralshield.create"),
        (ctx) => create(ctx, SPECTRAL_SHIELD),
        // Leaving the combat chain is leaving the arena; the event records
        // whether it was attacking or defending as it left.
        { whileDefending: true, condition: (_ctx, _card, event) => event?.combatRole !== undefined },
      ),
    ],
  })),

  "graven cowl|0": gravenEquipment(),
  "graven vestment|0": gravenEquipment(),
  "graven gloves|0": gravenEquipment(),
  "graven walkers|0": gravenEquipment(),
  "mist hunter|1": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 3),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && hasCardSubtype(ctx, ctx.player(opponentSeat(ctx)).hero, "mystic");
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      ctx.banishCards(
        ctx.player(target).deck.filter((card) => cardNamed(ctx, card, "Inner Chi")).map((card) => card.instanceId),
      );
      ctx.shuffleDeck(target);
    },
  },
  ...pitches("excessive bloodloss", () => contractColor(1, true)),
  ...pitches("knife through", () => ({
    hasConditionalGoAgain: (ctx) => hitWithDaggerThisChain(ctx),
  })),
  "song of larinkmorth white|3": {
    onPlay(ctx) {
      create(ctx, FROSTBITE, 1, opponentSeat(ctx));
    },
  },
  "reach beyond the grave|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        const allies = faceUpGraveyard(ctx).filter((card) => isAlly(ctx, card));
        if (allies.length)
          ctx.requestCardChoice(
            "pen-reach-ally",
            decisionPrompt("Return an ally", "card.pen.ally.return"),
            allies.map((card) => card.instanceId),
          );
        else
          requestDiscardChoice(
            ctx,
            "pen-reach-discard",
            decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"),
            ctx.seat,
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-reach-ally") {
        ctx.moveToHand(Number(option));
        requestDiscardChoice(
          ctx,
          "pen-reach-discard",
          decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"),
          ctx.seat,
        );
      } else if (hook === "pen-reach-discard") resolveDiscardChoice(ctx, option, ctx.seat);
    },
  },
  "beneath the surface|2": { wateryGraveWhileDefending: true },
  ...pitches("man overboard", discardAllyAttack),
  ...pitches("tentacular toll", (pitch) => ({
    onPlay(ctx) {
      const allies = faceUpGraveyard(ctx).filter((card) => isAlly(ctx, card))
        .slice(0, 4 - pitch);
      for (const ally of allies) ctx.setCardFaceDown(ally.instanceId, true);
      create(ctx, GOLD, allies.length);
    },
  })),
  "skywarden no.161803|2": {
    onDefend(ctx) {
      const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
      if (items.length)
        ctx.requestCardChoice(
          "pen-galvanize",
          decisionPrompt("Destroy an item for +1 defense?", "card.common.item.destroy.defense", {
            values: { amount: 1 },
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...items.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-galvanize" || option === "no") return;
      const card = ctx.player(ctx.seat).board.find((item) => item.instanceId === Number(option));
      if (card && ctx.destroyPermanent(card.instanceId)) {
        ctx.addModifier({ scope: "chain-link", defense: 1 });
        if (cardNamed(ctx, card, "Golden Cog")) create(ctx, GOLD);
      }
    },
  },
  "shallow water shark harpoon|2": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getFlag("player", "activatedCannonThisTurn") === true;
    },
    onHit(ctx) {
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0];
      if (arsenal) {
        ctx.moveToGraveyard(arsenal.instanceId, "arsenal");
        create(ctx, GOLD);
      }
    },
  },
  "trench of watery depths|0": {
    onDefend(ctx) {
      const blues = faceUpGraveyard(ctx)
        .filter((card) => ctx.cardColor(card) === 3 && (ctx.cardData(card.cardId).pitch ?? 0) > 0);
      if (blues.length)
        ctx.requestCardChoice(
          "pen-trench-pitch",
          decisionPrompt("Pitch a blue from graveyard?", "card.pen.graveyard.blue.pitch", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...blues.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-trench-pitch" && option !== "no") ctx.pitchCard(Number(option));
    },
  },
  "break open the chests!|2": {
    onPlay(ctx) {
      let yellow = false;
      for (const player of ctx.state.players)
        for (const card of player.arsenal) {
          ctx.turnArsenalFaceUp(card.instanceId);
          if (ctx.cardColor(card) === 2) yellow = true;
        }
      if (yellow) create(ctx, GOLD, 2);
    },
  },
  ...pitches("lighten the load", () => ({
    onAttackDeclared(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      const items = ctx.player(ctx.seat).board.filter((card) => isItem(ctx, card));
      const options = [
        "no",
        ...hand.map((card) => String(card.instanceId)),
        ...items.map((card) => `item:${card.instanceId}`),
      ];
      if (options.length <= 1) return;
      ctx.requestChoice(
        "pen-lighten",
        decisionPrompt("Discard a card or destroy an item for go again?", "card.pen.discardoritem.goagain", {
          optionMessages: commonOptionMessages("no"),
        }),
        options,
        undefined,
        [null, ...hand.map((card) => card.instanceId), ...items.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-lighten" || option === "no") return;
      const paid = option.startsWith("item:")
        ? ctx.destroyPermanent(Number(option.slice(5)))
        : !!ctx.discardCard(ctx.seat, Number(option));
      if (paid) ctx.grantGoAgain();
    },
  })),
  ...pitches("submerge", () => ({
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand.filter((card) => card.instanceId !== ctx.self.instanceId);
      if (hand.length)
        ctx.requestCardChoice(
          "pen-submerge",
          decisionPrompt("Put a card fifth from the top", "card.pen.card.fifthfromtop"),
          hand.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-submerge") ctx.putOnDeckAtDepth(Number(option), 5);
    },
  })),

  "herald of victoria|2": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          seat: opponentSeat(ctx),
          attack: -1,
          appliesTo: "attack-action",
          powerWhileDefending: true,
        });
      },
    },
  },
  "solray plating|0": { optionalDamagePrevention: { amount: 1, moveSource: "destroy" } },
  "blessing of themis|2": {
    onEnterArena(ctx) {
      ctx.setState("themisNamed", 0);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-themis-name") return;
      ctx.setChosenName(option);
      ctx.setState("themisNamed", 1);
      for (const player of ctx.state.players) {
        for (const card of player.banish) {
          if (!card.faceDown && cardNamed(ctx, card, option)) ctx.setCardFaceDown(card.instanceId, true);
        }
      }
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Put Blessing of Themis into your soul",
        labelMessage: decisionMessage("card.trigger.common.soul.put", { target: "Blessing of Themis" }),
        effect(ctx) {
          ctx.putIntoSoul(ctx.self.instanceId);
        },
      },
      {
        event: "card-entered-arena",
        label: "Name a card and turn matching banished cards face-down",
        labelMessage: decisionMessage("card.trigger.pen.themis.name"),
        condition: (ctx, card) => card?.instanceId === ctx.self.instanceId,
        effect(ctx) {
          ctx.requestNameChoice("pen-themis-name", decisionPrompt("Name a card", "card.common.card.name"));
        },
      },
      {
        event: "card-banished",
        whose: "any",
        label: "Turn the named banished card face-down",
        labelMessage: decisionMessage("card.trigger.pen.themis.facedown"),
        condition: (ctx, card) => ctx.getState("themisNamed") === 1 &&
          !!card && !card.faceDown && !!ctx.self.chosenName &&
          cardNamed(ctx, card, ctx.self.chosenName),
        effect(ctx, card) {
          if (!card) return;
          const banished = ctx.player(card.owner).banish.find((entry) => entry.instanceId === card.instanceId);
          if (banished && !banished.faceDown) ctx.setCardFaceDown(banished.instanceId, true);
        },
      },
    ],
  },
  "duty bound blitz|3": { canPlay: (ctx) => Number(ctx.getFlag("player", "soulPitch:2")) > 0 },
  ...pitches("soul bond belief", () => ({
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (top && ctx.cardColor(top) === 2 && ctx.putIntoSoul(top.instanceId))
        ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  })),
  "pound of flesh|3": {
    onPlay(ctx) {
      continuePoundOfFlesh(ctx);
    },
    onChoose(ctx, hook, option) {
      const match = /^pen-pound-banish:(\d+)$/.exec(hook);
      if (!match) return;
      const index = Number(match[1]);
      const seats = [ctx.seat, ...ctx.state.players.map((player) => player.seat).filter((seat) => seat !== ctx.seat)];
      const seat = seats[index];
      if (seat === undefined) return;
      const card = ctx.player(seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (card && ctx.banish(card.instanceId) && isSixPlus(ctx, card)) {
        ctx.setState(`pound-six:${seat}`, 1);
      }
      continuePoundOfFlesh(ctx, index + 1);
    },
  },
  "deep recesses of existence|3": bloodDebt({
    runeGate: true,
    onCombatChainClosed(ctx) {
      ctx.requestChoice(
        "deep-recesses-self",
        yesNoPrompt("Banish Deep Recesses of Existence face-down?", "card.pen.deeprecesses.banish"),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "deep-recesses-self") {
        if (option === "yes" && ctx.banish(ctx.self.instanceId, { faceDown: true })) {
          requestDeepRecessesBanish(ctx);
        }
        return;
      }
      const match = /^deep-recesses-graveyard:(\d+)$/.exec(hook);
      if (!match) return;
      const seat = Number(match[1]);
      const instanceId = Number(option);
      ctx.setCardFaceDown(instanceId, false);
      ctx.banish(instanceId);
      requestDeepRecessesBanish(ctx, seat + 1);
    },
  }),
  "embraforged gauntlet|0": bloodDebt({ graveyardReplacement: "banish" }),
  "engulfing shadows|2": bloodDebt({ graveyardReplacement: "banish" }),
  ...pitches("depths of despair", () =>
    bloodDebt({
      onDefend(ctx) {
        ctx.setFlag("link", `banishOnClose:${ctx.self.instanceId}`, true);
      },
    }),
  ),
  ...pitches("fasting carcass", (pitch) =>
    bloodDebt({
      onPlay(ctx) {
        ctx.addModifier({
          scope: "next-play",
          grantKeyword: "go again",
          appliesToCardType: "action",
          appliesToPitch: pitch,
        });
      },
    }),
  ),

  "seeds of strength|1": {
    ...bond("earth", (ctx) => create(ctx, MIGHT, 4)),
    onPlay(ctx) {
      create(ctx, MIGHT, ctx.getState("bonded") ? 4 : 3);
    },
  },
  "arc bending|1": {
    ...bond("lightning", (ctx) => ctx.grantGoAgain()),
    onAttackDeclared(ctx) {
      if (ctx.getState("bonded")) ctx.grantGoAgain();
      ctx.addModifier({ scope: "combat-chain", damage: 1, appliesToType: ["lightning", "elemental"] });
    },
  },
  "verdant tide|1": {
    ...bond("earth", (ctx) => create(ctx, EMBODIMENT_OF_EARTH)),
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "create 1 more of each Elemental or Runeblade aura token you create",
          "card.effect.pen.verdanttide",
        ),
      });
      if (ctx.getState("bonded")) create(ctx, EMBODIMENT_OF_EARTH);
    },
    replaceFriendlyTokenCreation(ctx, cardId, count) {
      return printedHasTag(ctx, cardId, "aura") && (printedHasTag(ctx, cardId, "elemental") ||
        printedHasTag(ctx, cardId, "runeblade"))
        ? count + 1
        : count;
    },
  },
  "voltic veil|1": {
    ...bond("lightning", (ctx) => dealArcane(ctx, opponentSeat(ctx), 1)),
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, 4);
      if (ctx.getState("bonded")) dealArcane(ctx, opponentSeat(ctx), 1);
    },
  },
  "colors of aria|1": { allZoneTypes: ["earth", "ice", "lightning"] },
  "frosthaven sheath|1": bond("ice", (ctx) => create(ctx, FROSTBITE, 1, ctx.link?.attacker ?? opponentSeat(ctx))),
  "leaven sheath|1": bond("earth", (ctx) => create(ctx, EMBODIMENT_OF_EARTH)),
  "stormwind sheath|1": bond("lightning", (ctx) => create(ctx, EMBODIMENT_OF_LIGHTNING)),
  "laden with earth|1": {
    ...bond("earth", (ctx) => create(ctx, EMBODIMENT_OF_EARTH)),
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3 });
      if (ctx.getState("bonded")) create(ctx, EMBODIMENT_OF_EARTH);
    },
  },
  "laden with frost|1": {
    ...bond("ice", (ctx) => create(ctx, FROSTBITE, 1, opponentSeat(ctx))),
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3 });
      if (ctx.getState("bonded")) create(ctx, FROSTBITE, 1, opponentSeat(ctx));
    },
  },
  "laden with lightning|1": {
    ...bond("lightning", (ctx) => create(ctx, EMBODIMENT_OF_LIGHTNING)),
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3 });
      if (ctx.getState("bonded")) create(ctx, EMBODIMENT_OF_LIGHTNING);
    },
  },
  "chorus of rotwood|1": decompose(
    "play",
    (ctx) => create(ctx, EMBODIMENT_OF_EARTH),
    (ctx) => create(ctx, RUNECHANT, 3),
  ),
  "sowing thorns|1": decompose("play", () => {}, (ctx) => ctx.gainLife(ctx.seat, 1)),
  "limbs of lignum vitae|0": {
    modifyDefense: (ctx) =>
      ctx.player(ctx.seat).banish.filter((card) =>
        !card.faceDown && hasCardSubtype(ctx, card, "earth")).length >= 4 ? 1 : 0,
  },
  "doubling season|1": { replacePowerGain: (_ctx, amount) => amount + 1 },
  "oath of oak|1": oathOfOak(3),
  "oath of oak|2": oathOfOak(2),
  "oath of oak|3": oathOfOak(1),
  "sprout strength|2": nextAttackPump(2),
  "sprout strength|3": nextAttackPump(1),

  "monolith of galcia|3": {
    onPlay(ctx) {
      const frozen = ctx.state.players
        .flatMap((player) => [...player.board, ...equippedCards(ctx, player.seat)])
        .filter((card) => ctx.isFrozen(card));
      if (frozen.length)
        ctx.requestCardChoice(
          "pen-destroy-frozen",
          decisionPrompt("Destroy a frozen permanent", "card.pen.frozen.permanent.destroy"),
          frozen.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-destroy-frozen") ctx.destroyPermanent(Number(option));
    },
  },
  "shattering grasp|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      canActivate: (ctx) =>
        ctx.state.players
          .flatMap((player) => player.board)
          .some((card) => isAlly(ctx, card) && ctx.isFrozen(card)),
      onActivate(ctx) {
        const allies = ctx.state.players
          .flatMap((player) => player.board)
          .filter((card) => isAlly(ctx, card) && ctx.isFrozen(card));
        ctx.requestCardChoice(
          "pen-shatter-ally",
          decisionPrompt("Destroy a frozen ally", "card.pen.frozen.ally.destroy"),
          allies.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-shatter-ally") ctx.destroyPermanent(Number(option));
    },
  },
  "channel galcia's cradle|3": {
    triggers: [
      entersArenaTrigger(
        "Freeze target ally, aura, item, or equipment",
        decisionMessage("card.trigger.pen.galcia.freeze"),
        freezeGalciaTarget,
        { target: GALCIA_FREEZE_TARGET },
      ),
      {
        event: "start-of-turn",
        label: "Freeze target ally, aura, item, or equipment",
        labelMessage: decisionMessage("card.trigger.pen.galcia.freeze"),
        target: GALCIA_FREEZE_TARGET,
        effect: freezeGalciaTarget,
      },
      {
        event: "end-of-turn",
        label: "Channel Ice",
        labelMessage: decisionMessage("card.trigger.common.channel.ice"),
        effect(ctx) {
          const n = ctx.getCounter("flow") + 1;
          ctx.setCounter("flow", n);
          const ice = ctx
            .player(ctx.seat)
            .pitch.filter((card) => hasCardSubtype(ctx, card, "ice"))
            .slice(0, n);
          if (ice.length < n) ctx.destroySelf();
          else for (const card of ice) ctx.putOnDeckBottom(card.instanceId);
        },
      },
    ],
  },
  ...pitches("conquer the icy terrain", () => ({
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      if (
        !ctx.requestPayment(
          "pen-conquer-pay",
          decisionPrompt("Pay 2 resources to prevent destruction?", "card.pen.destruction.prevent.pay", {
            values: { amount: 2 },
          }),
          2,
          target,
        )
      ) {
        const frozen = [...ctx.player(target).arsenal, ...controlledPermanents(ctx, target)].filter((card) =>
          ctx.isFrozen(card),
        );
        if (frozen.length)
          ctx.requestCardChoice(
            "pen-conquer-destroy",
            decisionPrompt("Destroy a frozen card", "card.pen.frozen.card.destroy", {
              optionMessages: commonOptionMessages("no"),
            }),
            ["no", ...frozen.map((card) => card.instanceId)],
          );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-conquer-pay" && option === "declined") {
        const target = opponentSeat(ctx);
        const frozen = [...ctx.player(target).arsenal, ...controlledPermanents(ctx, target)].filter((card) =>
          ctx.isFrozen(card),
        );
        if (frozen.length)
          ctx.requestCardChoice(
            "pen-conquer-destroy",
            decisionPrompt("Destroy a frozen card", "card.pen.frozen.card.destroy", {
              optionMessages: commonOptionMessages("no"),
            }),
            ["no", ...frozen.map((card) => card.instanceId)],
          );
      } else if (hook === "pen-conquer-destroy" && option !== "no") ctx.destroyPermanent(Number(option));
    },
  })),
  "put on ice|1": putOnIce(3),
  "put on ice|2": putOnIce(2),
  "put on ice|3": putOnIce(1),

  "sigil of voltaris|3": {
    arcaneDamageEffect: true,
    triggers: [
      entersArenaTrigger(
        "Deal 1 arcane damage to target hero",
        decisionMessage("card.trigger.common.arcane.target", { amount: 1 }),
        dealArcaneToTargetHero,
        { target: heroTarget() },
      ),
      leavesArenaTrigger(
        "Deal 1 arcane damage to target hero",
        decisionMessage("card.trigger.common.arcane.target", { amount: 1 }),
        dealArcaneToTargetHero,
        { target: heroTarget() },
      ),
      {
        event: "begin-action-phase",
        label: "Destroy Sigil of Voltaris",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },
  "strike twice|1": {
    ...penArcaneSpell(3),
    playAsInstant: (ctx) => ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true,
  },
  "voltic vanguard|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedCardType:instant") === true,
      onActivate(ctx) {
        ctx.preventNextDamage(ctx.seat, 2);
      },
    },
  },
  "ion charged|2": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        attack: 1,
        appliesToType: ["lightning", "elemental"],
        appliesToKeyword: "go again",
      });
    },
  },
  ...pitches("overcharge", (pitch) => ({
    modifyAttack: (ctx) => (ctx.link?.flags.playedInstant === true ? 4 - pitch : 0),
  })),
  "cloud cover|2": {
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, 2);
    },
  },
  "cloud cover|3": {
    onPlay(ctx) {
      ctx.preventNextDamage(ctx.seat, 1);
    },
  },

  "haboob|1": {
    modifyFriendlyAttack: haboobPower,
    modifyOpposingAttack: haboobPower,
    modifyFriendlyPower: haboobPower,
    modifyOpposingPower: haboobPower,
    triggers: [
      {
        event: "start-of-turn",
        whose: "any",
        label: "Haboob storm upkeep",
        effect(ctx) {
          const n = ctx.getCounter("storm") + 1;
          ctx.setCounter("storm", n);
          if (haboobAsh(ctx).length < n) {
            ctx.destroySelf();
            return;
          }
          ctx.requestChoice(
            "pen-haboob-upkeep",
            yesNoPrompt(`Destroy ${n} Ash to keep Haboob?`, "card.pen.haboob.upkeep", { count: n }),
            ["yes", "no"],
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "pen-haboob-upkeep") return;
      const n = ctx.getCounter("storm");
      const ash = haboobAsh(ctx).slice(0, n);
      if (option !== "yes" || ash.length < n) {
        ctx.destroySelf();
        return;
      }
      for (const card of ash) ctx.destroyPermanent(card.instanceId);
    },
  },
  "smoldering steel|1": {
    canPlay: (ctx) => !!ctx.link && isDagger(ctx, ctx.link.attackingCard),
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1, onHitDealDamage: 1 });
    },
    optionalFriendlyTokenCreationReplacement: {
      sourceZone: "graveyard",
      label: "Banish Smoldering Steel instead of creating Frostbite?",
      labelMessage: decisionMessage("card.pen.smolderingsteel.replacement"),
      condition(ctx, cardId, count) {
        return count > 0 && ctx.cardData(cardId).name === "Frostbite";
      },
      effect(ctx) {
        ctx.banish(ctx.self.instanceId);
      },
    },
  },
  "smoldering scales|0": {
    optionalFriendlyTokenCreationReplacement: {
      label: "Destroy Smoldering Scales instead of creating Frostbite?",
      labelMessage: decisionMessage("card.pen.smolderingscales.replacement"),
      condition(ctx, cardId, count) {
        return count > 0 && ctx.cardData(cardId).name === "Frostbite";
      },
      effect(ctx) {
        ctx.destroySelf();
      },
    },
  },
  "four feathers one crown|1": {
    modifyAttack: (ctx) =>
      faceUpGraveyard(ctx).filter((card) => cardNameContains(ctx, card, "Phoenix Bannerman")).length,
  },
  "phoenix bannerman: head|1": phoenixBannerman(PONDER),
  "phoenix bannerman: chest|1": phoenixBannerman(VIGOR),
  "phoenix bannerman: arms|1": phoenixBannerman(MIGHT),
  "phoenix bannerman: legs|1": phoenixBannerman(AGILITY),

  "serpent's kiss|3": {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "transcendedThisTurn") === true) {
        ctx.createCardInHand(FANG_STRIKE);
        ctx.createCardInHand(SLITHER);
      } else
        ctx.requestChoice(
          "pen-serpent-token",
          decisionPrompt("Create Fang Strike or Slither", "card.pen.serpent.token.create", {
            optionMessages: Object.fromEntries(
              [FANG_STRIKE, SLITHER].map((cardId) => [
                cardId,
                decisionMessage("card.common.target.card", { card: { kind: "card", cardId } }),
              ]),
            ),
          }),
          [FANG_STRIKE, SLITHER],
        );
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck.slice(0, 2);
      if (top.length) {
        for (const card of top) ctx.lookAt(card.instanceId);
        ctx.requestCardChoice(
          "pen-serpent-banish",
          decisionPrompt("Banish one of the top 2 cards", "card.pen.deck.top.banish", { values: { count: 2 } }),
          top.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-serpent-token") ctx.createCardInHand(option);
      else if (hook === "pen-serpent-banish") ctx.banish(Number(option));
    },
  },
  "wax and wane|3": {
    onPlay(ctx) {
      const auras = ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card));
      if (auras.length)
        ctx.requestCardChoice(
          "pen-wax-aura",
          decisionPrompt("Put a +1 power counter on an aura", "card.pen.aura.powercounter.add"),
          auras.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-wax-aura") ctx.addCounter(Number(option), "power", 1);
    },
  },
  "shapeless form|3": {
    onAttackDeclared: (ctx) => ctx.addModifier({ scope: "combat-chain" }),
    triggers: [
      {
        event: "card-played",
        label: "Choose a name for the ephemeral attack",
        labelMessage: decisionMessage("card.pen.ephemeral.name"),
        condition: (ctx, played) =>
          !!played &&
          played.instanceId !== ctx.self.instanceId &&
          hasCardSubtype(ctx, played, "attack") &&
          ctx.hasKeyword(played, "ephemeral"),
        effect(ctx, played) {
          if (!played) return;
          ctx.setState("shapelessTarget", played.instanceId);
          ctx.requestNameChoice(
            "pen-shapeless-name",
            decisionPrompt("Choose a name for the ephemeral attack", "card.pen.ephemeral.name"),
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "pen-shapeless-name") return;
      const target = ctx.getState("shapelessTarget");
      if (target > 0) ctx.grantCardName(target, option);
    },
  },
  "kimono of layered lessons|0": {
    activated: {
      cost: 0,
      chiCost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      turnsFaceUp: true,
      onActivate(ctx) {
        ctx.addCardDefenseCounters(ctx.self.instanceId, -1);
      },
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Kimono of Layered Lessons",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },
  "recede to mistform|3": {
    variablePlayCost: {
      base: 0,
      stateKey: "recedeX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return equipmentZoneCards(ctx.player(ctx.seat)).filter(
          (card) =>
            card &&
            !card.faceDown &&
            ctx.hasKeyword(card, "cloaked"),
        ).length;
      },
    },
    onPlay(ctx) {
      const equipment = equipmentZoneCards(ctx.player(ctx.seat)).filter(
        (card): card is DeepReadonly<CardInstance> =>
          !!card &&
          !card.faceDown &&
          ctx.hasKeyword(card, "cloaked"),
      );
      const n = Math.min(ctx.getState("recedeX"), equipment.length);
      if (n > 0)
        ctx.requestCardChoices(
          "recede-equipment",
          decisionPrompt(
            `Choose ${n} equipment with cloaked to turn face-down`,
            "card.pen.cloaked.equipment.facedown.choose",
            { values: { count: n } },
          ),
          equipment.map((card) => card.instanceId),
          n,
          n,
        );
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "recede-equipment") return;
      for (const option of options) ctx.setCardFaceDown(Number(option), true);
    },
  },
  "mistborn protector|3": { modifyDefense: (ctx) => (createdThisTurn(ctx) ? 1 : 0) },
  "billowing mist|3": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 1 });
      ctx.setFlag("player", "penExtraEphemeral", true);
    },
  },
  "look within|3": {
    onPlay(ctx) {
      const chi = ctx.player(ctx.seat).deck.find((card) => hasCardSubtype(ctx, card, "chi"));
      if (chi) ctx.revealCards([chi.instanceId]);
      ctx.shuffleDeck();
      if (chi) ctx.putOnDeckTop(chi.instanceId);
    },
  },
  "spreading mist|3": {
    onPlay(ctx) {
      buffNextAttack(ctx, { goAgain: true });
      ctx.setFlag("player", "penExtraEphemeral", true);
    },
  },
  "descend into madness|3": {
    onPlay(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (!hand.length) return;
      ctx.banish(hand[ctx.randomInt(hand.length)]!.instanceId);
      ctx.drawCards(target, 1);
    },
  },
  "concoct disorder|2": concoctDisorder(),
  "concoct disorder|3": concoctDisorder(),
  "hyper inflation|2": {
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", seat: 0, appliesTo: "any", playCostReduction: -1 });
      ctx.addModifier({ scope: "until-end-of-turn", seat: 1, appliesTo: "any", playCostReduction: -1 });
    },
  },
  "hyper inflation|3": {
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", seat: 0, appliesTo: "any", playCostReduction: -1 });
      ctx.addModifier({ scope: "until-end-of-turn", seat: 1, appliesTo: "any", playCostReduction: -1 });
    },
  },

  "tough as a rok|3": {
    modifyBasePower: (ctx, card, base) => (card.instanceId === ctx.self.instanceId ? (hasLessLife(ctx) ? 6 : 0) : base),
  },
  "energy of the audience|2": {
    modifyAttack: (ctx) =>
      hasLessLife(ctx) ? ctx.player(ctx.seat).board.filter((card) =>
        isAura(ctx, card) && ctx.hasKeyword(card, "suspense"))
            .length : 0,
  },
  "comeback kicks|0": {
    onCheered(ctx) {
      if (hasLessLife(ctx))
        ctx.requestChoice(
          "pen-comeback",
          warnIfNoActionPoint(
            ctx,
            yesNoPrompt("Destroy Comeback Kicks to gain an action point?", "card.pen.comeback.destroy"),
          ),
          ["yes", "no"],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-comeback" && option === "yes") {
        ctx.destroySelf();
        ctx.gainActionPoint();
      }
    },
  },
  "emboldened by the crowd|2": {
    modifyPlayCost: (ctx, base) => (ctx.getFlag("player", "cheeredThisTurn") === true ? Math.max(0, base - 3) : base),
  },
  ...pitches("hulk up", () => ({ modifyPlayCost: (ctx, base) => (hasLessLife(ctx) ? Math.max(0, base - 1) : base) })),
  ...pitches("stadium security", () => ({
    canDefendFromArsenal: (ctx) => ctx.getFlag("player", "controlledName:toughness") === true,
  })),
  "chain of brutality|1": {
    onAttackDeclared(ctx) {
      ctx.addModifier({ scope: "chain-link", goAgainIfAttackPowerAtLeast: 6 });
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.currentAttackPower() >= 6;
    },
    onHit(ctx) {
      ctx.addModifier({
        scope: "next-play",
        appliesToCardType: "action",
        appliesToSubtype: "attack",
        basePower: 6,
      });
    },
  },
  "snarky prick|1": {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return;
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (!top) return;
      ctx.lookAt(top.instanceId);
      if (ctx.cardColor(top) === 1)
        ctx.requestCardChoice(
          "pen-snarky",
          decisionPrompt("Destroy the red card?", "card.pen.red.card.destroy", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", top.instanceId],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-snarky" && option !== "no" && ctx.moveToGraveyard(Number(option), "deck"))
        ctx.addModifier({ scope: "chain-link", attack: 4 });
    },
  },
  ...pitches("insult to injury", () => ({
    onAttackDeclared(ctx) {
      if (hasMoreLife(ctx)) ctx.grantGoAgain();
    },
  })),
  ...pitches("bad breath", (pitch) => ({
    onPlay(ctx) {
      queueIntimidate(ctx);
      ctx.addModifier({ scope: "until-end-of-turn", onHitCreateToken: { cardId: MIGHT, count: 4 - pitch }, once: true });
    },
  })),

  "myrkhellir helm|0": {
    modifyDefense: (ctx) => (controlsNamed(ctx, "Gold") ? 1 : 0),
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.setPlayerFlag(ctx.seat, "doubleNextGoldDraw", true);
      },
    },
  },
  "burnished bunkerplate|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "defense-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => !!ctx.link && ctx.player(ctx.seat).arsenal.some((card) => ctx.hasCardType(card, "action")),
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).arsenal.filter((card) => ctx.hasCardType(card, "action"));
        ctx.requestCardChoice(
          "pen-bunkerplate",
          decisionPrompt("Add an action from arsenal as a defender", "card.pen.arsenal.action.defend"),
          cards.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-bunkerplate") ctx.addDefenderFromArsenal(Number(option));
    },
  },
  "unyielding grip|0": { modifyDefense: (ctx) => (ctx.player(ctx.seat).hand.length === 0 ? 3 : 0) },
  "unflinching foothold|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate: (ctx) => !!ctx.link,
      onActivate(ctx) {
        if (ctx.link) ctx.suppressCardKeyword(ctx.link.attackingCard.instanceId, "dominate");
      },
    },
  },
  "clearwater elixir|1": elixir("Bloodrot Pox"),
  "restvine elixir|1": elixir("Inertia"),
  "sapwood elixir|1": elixir("Frailty"),
  "ransack and raze|3": {
    variablePlayCost: {
      base: 0,
      stateKey: "ransackX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        const target = ctx.globalCards().find((card) => card.instanceId === ctx.playTargetInstanceId);
        return target ? (ctx.cardData(target.cardId).cost ?? 0) : 0;
      },
      canDeclareX(ctx, x) {
        const target = ctx.globalCards().find((card) => card.instanceId === ctx.playTargetInstanceId);
        return !!target && (ctx.cardData(target.cardId).cost ?? 0) === x;
      },
    },
    playTargetOptions(ctx) {
      return ctx
        .globalCards()
        .filter((card) => hasCardSubtype(ctx, card, "landmark"))
        .map((card) => card.instanceId);
    },
    onPlay(ctx) {
      const target = ctx.globalCards().find((card) => card.instanceId === ctx.playTargetInstanceId);
      const x = ctx.getState("ransackX");
      if (target && ctx.destroyGlobal(target.instanceId)) create(ctx, GOLD, x);
    },
  },
  "destructive tendencies|3": {
    // Choose 1 or both: a target item token, then a target aura token. Pass
    // is offered only while the other mode can still be chosen. Counters are
    // removed from both targets once the choices are made.
    onPlay(ctx) {
      ctx.setState("tendenciesItem", 0);
      const items = tendenciesTargets(ctx, "item");
      if (items.length === 0) {
        requestTendenciesAura(ctx, false);
        return;
      }
      const canSkip = tendenciesTargets(ctx, "aura").length > 0;
      ctx.requestCardChoice(
        "pen-tendencies-item",
        decisionPrompt("Remove all counters from target item token", "card.pen.token.item.counters.remove", {
          optionMessages: commonOptionMessages("pass"),
        }),
        [...(canSkip ? ["pass"] : []), ...items.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-tendencies-item") {
        const chosen = option !== "pass";
        if (chosen) ctx.setState("tendenciesItem", Number(option));
        requestTendenciesAura(ctx, chosen);
        return;
      }
      if (hook === "pen-tendencies-aura") finishTendencies(ctx, option === "pass" ? undefined : Number(option));
    },
  },
  "pilfer the tomb|3": {
    onPlay(ctx) {
      const cards = faceUpGraveyard(ctx, opponentSeat(ctx))
        .filter((card) => ctx.hasCardType(card, "instant") || ctx.cardColor(card) === 2);
      if (cards.length)
        ctx.requestCardChoice(
          "pen-pilfer",
          decisionPrompt("Banish an instant or yellow card", "card.pen.instantyellow.banish"),
          cards.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-pilfer") ctx.banish(Number(option));
    },
  },
  "shatter sorcery|3": {
    onPlay(ctx) {
      ctx.preventNextArcaneDamage(ctx.seat, 1);
      const sigils = ctx.state.players
        .flatMap((player) => player.board)
        .filter((card) => isAura(ctx, card) && cardNameContains(ctx, card, "Sigil"));
      if (sigils.length)
        ctx.requestCardChoice(
          "pen-shatter-sigil",
          decisionPrompt("Destroy a Sigil aura?", "card.pen.sigil.destroy", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...sigils.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-shatter-sigil" && option !== "no") ctx.destroyPermanent(Number(option));
    },
  },
  "drag down|2": {
    onDefend(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: -2, seat: opponentSeat(ctx) });
    },
  },
  "drag down|3": {
    onDefend(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: -1, seat: opponentSeat(ctx) });
    },
  },

  "kano|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: false,
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        if (isNonAttackAction(ctx, top))
          ctx.requestCardChoice(
            "pen-kano",
            decisionPrompt("Banish the top card and play it as an instant?", "card.pen.deck.top.instant", {
              optionMessages: commonOptionMessages("no"),
            }),
            ["no", top.instanceId],
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-kano" || option === "no") return;
      const instanceId = Number(option);
      if (ctx.banish(instanceId)) {
        ctx.allowPlayFrom(instanceId, "banish", { asInstant: true });
      }
    },
  },
});
