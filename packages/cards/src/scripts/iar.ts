import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  dealArcane,
  optN,
  optOnChoose,
  opponentSeat,
  previousAttackHasName,
  requestDiscardChoice,
  resolveDiscardChoice,
  suspenseAura,
} from "./shared-helpers.js";

const RUNECHANT = "SBA036";
const GATE = "IAR222";
const BLASMOPHET = "IAR221";
const CORRUPTED_CORPSE = "IAR090";
const EMBODIMENT_OF_EARTH = "AJV028";
const FROSTBITE = "AJV029";
const GRAPHENE_CHELICERA = "SAR033";
const PONDER = "DYN244";
const SPECTRAL_SHIELD = "SEN037";
const EQUIPMENT_SLOTS = ["head", "chest", "arms", "legs"] as const;

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return ctx.cardData(card.cardId).name.toLowerCase() === name.toLowerCase();
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasType(ctx, card, "attack");
}

function selfHitsHero(ctx: ScriptCtx): boolean {
  return ctx.link !== undefined &&
    ctx.link.targetAllyId === undefined &&
    ctx.link.attackingCard.instanceId === ctx.self.instanceId;
}

function requestAnyTarget(ctx: ScriptCtx, hook: string, prompt: string): void {
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  for (const player of ctx.state.players) {
    for (const card of player.board) {
      if (!hasType(ctx, card, "ally")) continue;
      options.push(`ally:${player.seat}:${card.instanceId}`);
      cardOptions.push(card.instanceId);
    }
  }
  ctx.requestChoice(hook, prompt, options, ctx.seat, cardOptions);
}

function dealArcaneToTarget(ctx: ScriptCtx, option: string, amount: number): void {
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  if (ally) {
    dealArcane(ctx, Number(ally[1]), amount, Number(ally[2]));
    return;
  }
  dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), amount);
}

function exposedEquipmentSlots(ctx: ScriptCtx, seat: number): readonly string[] {
  const player = ctx.player(seat);
  return EQUIPMENT_SLOTS.filter((slot) =>
    !player.equipment[slot] &&
    !player.board.some((card) => card.counters?.[`frostZone:${slot}`])
  );
}

function createFrostbitesInExposedZones(ctx: ScriptCtx, seat: number): void {
  for (const slot of exposedEquipmentSlots(ctx, seat)) {
    const token = ctx.createToken(FROSTBITE, seat);
    if (token) ctx.addCounter(token.instanceId, `frostZone:${slot}`, 1);
  }
}

function paidWithType(
  ctx: ScriptCtx,
  paid: readonly DeepReadonly<CardInstance>[],
  type: string,
): boolean {
  return paid.some((card) => hasType(ctx, card, type));
}

function firstHeadBangingAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  if (!isAttackAction(ctx, card)) return false;
  const guardian = hasType(ctx, card, "guardian");
  const revered = hasType(ctx, card, "revered");
  if (!guardian && !revered) return false;
  const guardianCount = Number(ctx.getFlag("player", "playedAttackActionTypeCount:guardian"));
  const reveredCount = Number(ctx.getFlag("player", "playedAttackActionTypeCount:revered"));
  return guardianCount <= (guardian ? 1 : 0) && reveredCount <= (revered ? 1 : 0);
}

function controlsVox(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).weapons.some((card) => named(ctx, card, "Vox Necropolis"));
}

function controlsBlasmophet(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).board.some((card) =>
    named(ctx, card, "Blasmophet, the Insatiable Hunger")
  );
}

function decay(): Pick<CardScript, "triggers"> {
  return {
    triggers: [{
      event: "end-of-turn",
      whose: "subject",
      label: "Decay",
      effect(ctx) {
        const life = ctx.self.life ?? 0;
        if (life <= 1) {
          ctx.destroySelf();
          return;
        }
        ctx.setCounter("lifePenalty", ctx.getCounter("lifePenalty") + 1);
        ctx.setPermanentLife(ctx.self.instanceId, life - 1);
      },
    }],
  };
}

function zombieAttack() {
  return attackAbility(1, {
    tap: true,
    oncePerTurn: false,
    canActivate: controlsVox,
  });
}

function requestForsakenStrikeMode(ctx: ScriptCtx): void {
  const remaining = ctx.getCounter("forsakenModesRemaining");
  if (remaining <= 0) {
    applyForsakenStrikeModes(ctx);
    return;
  }
  const total = ctx.getCounter("forsakenModesTotal");
  const choiceNumber = total - remaining + 1;
  ctx.requestChoice(
    "iar-forsaken-strike-mode",
    `Forsaken Strike: choose effect ${choiceNumber} of ${total}`,
    [
      "Create a Gate to i'Arathael",
      "Give Forsaken Strike +2 power",
      "Give Forsaken Strike go again",
    ],
  );
}

function applyForsakenStrikeModes(ctx: ScriptCtx): void {
  for (let i = 0; i < ctx.getCounter("forsakenGateModes"); i++) ctx.createToken(GATE);
  ctx.addCardTempPower(ctx.self.instanceId, 2 * ctx.getCounter("forsakenPowerModes"));
  if (ctx.getCounter("forsakenGoAgainModes") > 0) {
    ctx.grantCardKeyword(ctx.self.instanceId, "go again");
  }
}

const forsakenStrike: CardScript = {
  alternativePlayCost: {
    kind: "destroy-controlled-and-or-discard-hand-subtype",
    subtype: "zombie",
    cardLabel: "zombies",
    maximumDestroyed: 3,
    maximumDiscarded: 3,
    replacesResourceCost: false,
  },
  onAlternativeCostPaid(ctx, paidCards) {
    ctx.setCounter("forsakenModesTotal", paidCards.length);
    ctx.setCounter("forsakenModesRemaining", paidCards.length);
    requestForsakenStrikeMode(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook !== "iar-forsaken-strike-mode") return;
    if (option === "Create a Gate to i'Arathael") {
      ctx.setCounter("forsakenGateModes", ctx.getCounter("forsakenGateModes") + 1);
    } else if (option === "Give Forsaken Strike +2 power") {
      ctx.setCounter("forsakenPowerModes", ctx.getCounter("forsakenPowerModes") + 1);
    } else if (option === "Give Forsaken Strike go again") {
      ctx.setCounter("forsakenGoAgainModes", ctx.getCounter("forsakenGoAgainModes") + 1);
    }
    ctx.setCounter("forsakenModesRemaining", ctx.getCounter("forsakenModesRemaining") - 1);
    requestForsakenStrikeMode(ctx);
  },
};

function faceUpBloodDebtCards(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && hasBloodDebt(ctx, card));
}

function repentanceEquipment(moveSource: "destroy" | "banish" = "destroy"): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      ...(moveSource === "destroy" ? { destroySelfCost: true } : { banishSelfCost: true }),
      canActivate: (ctx) =>
        faceUpBloodDebtCards(ctx).length > 0 ||
        (moveSource === "banish" && hasBloodDebt(ctx, ctx.self)),
      onActivate(ctx) {
        ctx.requestCardChoice(
          "iar-repentance-target",
          "Turn a card with blood debt face down",
          faceUpBloodDebtCards(ctx).map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-repentance-target") ctx.setCardFaceDown(Number(option), true);
    },
  };
}

function usurp(): Pick<CardScript, "additionalCost" | "onChoose"> {
  return {
    additionalCost(ctx) {
      const runechants = ctx.player(ctx.seat).board.filter((card) =>
        ctx.cardData(card.cardId).name.toLowerCase().includes("runechant")
      );
      if (runechants.length > 0) {
        ctx.requestCardChoice(
          "iar-usurp-runechant",
          "Usurp: destroy a Runechant",
          runechants.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      resolveUsurp(ctx, hook, option);
    },
  };
}

function resolveUsurp(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "iar-usurp-runechant") return false;
  const attackId = ctx.self.instanceId;
  if (ctx.usurpRunechant(Number(option), attackId)) ctx.addCardTempPower(attackId, 2);
  return true;
}

function runicDiscardAttack(): CardScript {
  return {
    ...usurp(),
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "discard",
      onActivate(ctx) { ctx.createToken(RUNECHANT); },
    },
  };
}

function fromBanishBonus(extra?: (ctx: ScriptCtx) => void): CardScript {
  return bloodDebt({
    modifyAttack: (ctx) => ctx.getFlag("link", "fromBanish") === true ? 1 : 0,
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromBanish") === true) extra?.(ctx);
    },
  });
}

function shadowrealmStrength(attack: number): CardScript {
  return {
    onPlay(ctx) {
      const banished = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown);
      if (banished.length > 0) {
        ctx.requestCardChoice(
          "iar-shadowrealm-strength",
          "Put a banished card into your graveyard?",
          ["no", ...banished.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-shadowrealm-strength" || option === "no") return;
      const instanceId = Number(option);
      const selected = ctx.player(ctx.seat).banish.find((card) =>
        card.instanceId === instanceId && !card.faceDown
      );
      if (!selected) return;
      if (!ctx.moveToGraveyard(instanceId, "banish")) return;
      const moved = ctx.player(ctx.seat).graveyard.find((card) =>
        card.instanceId === instanceId
      );
      if (moved && ctx.cardTypes(moved).includes("zombie")) {
        buffNextAttack(ctx, { attack });
      }
    },
  };
}

function traverseToBack(ctx: ScriptCtx): void {
  const backId = ctx.cardData(ctx.self.cardId).backId;
  if (backId) ctx.becomeHero(backId);
}

function traverseToFront(ctx: ScriptCtx): void {
  const frontId = ctx.self.originalHeroCardId;
  if (frontId) ctx.becomeHero(frontId);
}

function recordFirstViseraiBloodDebtAttack(
  ctx: ScriptCtx,
  played: DeepReadonly<CardInstance>,
): boolean {
  if (ctx.getFlag("player", "iarViseraiBloodDebtAttackPlayed") === true ||
    !hasType(ctx, played, "attack") || !isBloodDebtAction(ctx, played)) return false;
  ctx.setFlag("player", "iarViseraiBloodDebtAttackPlayed", true);
  return true;
}

const viseraiFront: CardScript = {
  onFriendlyPlay(ctx, played) {
    recordFirstViseraiBloodDebtAttack(ctx, played);
  },
  triggers: [{
    event: "token-created",
    label: "Banish the top card of your deck, then traverse if you've created 3 Runechants",
    condition: (ctx, token) => token !== undefined && named(ctx, token, "Runechant"),
    effect(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (top) ctx.banish(top.instanceId);
      if (Number(ctx.getFlag("player", "createdNameCount:runechant")) >= 3) {
        traverseToBack(ctx);
      }
    },
  }],
};

const viseraiBack: CardScript = {
  onFriendlyPlay(ctx, played) {
    if (recordFirstViseraiBloodDebtAttack(ctx, played)) {
      ctx.grantCardKeyword(played.instanceId, "Go again");
    }
  },
  triggers: [{
    event: "end-of-turn",
    whose: "any",
    optional: true,
    label: "Traverse",
    condition: (ctx) => ctx.getFlag("player", "iarGateCreatedOrActivated") === true,
    effect: traverseToFront,
  }],
};

function hasBloodDebt(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  const data = ctx.cardData(card.cardId);
  return (data.keywords ?? []).some((keyword) => keyword.trim().toLowerCase() === "blood debt");
}

function replaceActionPhaseDrawWithPonder(
  ctx: ScriptCtx,
  drawingSeat: number,
  count: number,
): number {
  if (!["action", "defend", "reaction", "layer"].includes(ctx.state.phase) || count <= 0) {
    return count;
  }
  ctx.createTokens(PONDER, count, drawingSeat);
  return 0;
}

function isBloodDebtAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasBloodDebt(ctx, card);
}

function darkestHour(attack: number): CardScript {
  return bloodDebt({
    alternativePlayCost: { kind: "put-hand-card-on-deck-top" },
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesToClass: "shadow",
      });
    },
  });
}

export const iar: Record<string, CardScript> = {
  "soul of existence|4": {
    triggers: [{
      event: "card-pitched",
      sourceZone: "pitch",
      label: "Lose 1 life",
      condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId,
      effect(ctx) { ctx.loseLife(ctx.seat, 1); },
    }],
  },

  "hex gauntlet|0": bloodDebt(repentanceEquipment("banish")),

  "blood harvest|0": bloodDebt({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) { ctx.changeResources(ctx.seat, 3); },
    },
  }),

  "apex burster|3": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      canActivate(ctx) {
        const link = ctx.link;
        return !!link && link.attacker === ctx.seat &&
          ctx.basePower(link.attackingCard) >= 6 &&
          link.defendingCards.length + link.defendingEquipment.length > 0;
      },
      onActivate(ctx) {
        const link = ctx.link;
        if (!link) return;
        ctx.requestCardChoice(
          "iar-apex-burster-target",
          "Destroy a card defending your 6 or more base power attack",
          [...link.defendingCards, ...link.defendingEquipment].map(
            (card) => card.instanceId,
          ),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-apex-burster-target") {
        ctx.destroyDefendingCard(Number(option));
      }
    },
  },

  "consuming lash|2": bloodDebt({
    canPlay: controlsBlasmophet,
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) { buffNextAttack(ctx, { grantKeyword: "Go again" }); },
    },
  }),

  "consuming strength|2": bloodDebt({
    canPlay: controlsBlasmophet,
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) { buffNextAttack(ctx, { attack: 2 }); },
    },
  }),

  "beckoning hunger|1": bloodDebt({
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) { ctx.createToken(BLASMOPHET); },
  }),
  "beckoning hunger|2": bloodDebt({
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) { ctx.createToken(BLASMOPHET); },
  }),
  "beckoning hunger|3": bloodDebt({
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) { ctx.createToken(BLASMOPHET); },
  }),

  "battle clearing bellow|3": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 6, minBasePower: 6 }); },
  },

  "malice|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      tap: true,
      canActivate: (ctx) => ctx.player(ctx.seat).graveyard.some((card) =>
        !card.faceDown && hasType(ctx, card, "zombie")
      ),
      onActivate(ctx) {
        const zombies = ctx.player(ctx.seat).graveyard.filter((card) =>
          !card.faceDown && hasType(ctx, card, "zombie")
        );
        ctx.requestCardChoice(
          "iar-malice-zombie",
          "Choose a zombie in your graveyard",
          zombies.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-malice-zombie") ctx.allowPlayFrom(Number(option), "graveyard");
    },
    onFriendlyDestroyed(ctx, destroyed) {
      if (!hasType(ctx, destroyed, "zombie") || !hasType(ctx, destroyed, "ally")) return;
      ctx.banish(destroyed.instanceId, { faceDown: true });
      ctx.createCardInBanish(CORRUPTED_CORPSE);
    },
  },

  "appalling bearers|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      effectCardCosts: [{
        zone: "hand",
        move: "discard",
        count: 1,
        subtype: "zombie",
        prompt: "Discard a zombie",
      }],
      onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 2); },
    },
  },

  "bridge of damnation|3": {
    triggers: [{
      event: "start-of-turn",
      whose: "any",
      label: "Put a zombie from banish into graveyard or destroy this",
      effect(ctx) {
        const zombies = ctx.player(ctx.seat).banish.filter((card) =>
          !card.faceDown && hasType(ctx, card, "zombie")
        );
        if (zombies.length === 0) {
          ctx.destroySelf();
          return;
        }
        ctx.requestCardChoice(
          "iar-bridge-zombie",
          "Put a zombie into your graveyard to keep Bridge of Damnation?",
          ["destroy", ...zombies.map((card) => card.instanceId)],
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "iar-bridge-zombie") return;
      if (option === "destroy" || !ctx.moveToGraveyard(Number(option), "banish")) {
        ctx.destroySelf();
      }
    },
  },

  "bone barrier|3": {
    onDefend(ctx) {
      const allies = [
        ...ctx.player(ctx.seat).board.filter((card) => hasType(ctx, card, "ally")),
        ...ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, "ally")),
      ];
      if (allies.length > 0) {
        ctx.requestCardChoice(
          "iar-bone-barrier-ally",
          "Destroy or discard an ally for +2 defense?",
          ["no", ...allies.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-bone-barrier-ally" || option === "no") return;
      const id = Number(option);
      const paid = ctx.player(ctx.seat).board.some((card) => card.instanceId === id)
        ? ctx.destroyPermanent(id)
        : ctx.discardCard(ctx.seat, id) !== undefined;
      if (paid) ctx.addCardTempDefense(ctx.self.instanceId, 2);
    },
  },

  "grasp of the darknight|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        if (ctx.player(ctx.seat).deck.length === 0) ctx.createToken(RUNECHANT);
        else optN(ctx, 1);
      },
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => ctx.createToken(RUNECHANT));
    },
  },

  "restless magister|1": {
    activated: zombieAttack(),
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.player(opponentSeat(ctx)).hand.length > 0,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      ctx.requestCardChoice(
        "iar-magister-hand",
        "Choose a card to banish",
        ctx.player(target).hand.map((card) => card.instanceId),
        target,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-magister-hand") ctx.banish(Number(option));
    },
    ...decay(),
  },

  "restless quartermaster|1": {
    activated: zombieAttack(),
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.player(opponentSeat(ctx)).arsenal.length > 0,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      ctx.requestCardChoice(
        "iar-quartermaster-arsenal",
        "Choose an arsenal card to banish",
        ctx.player(target).arsenal.map((card) => card.instanceId),
        target,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-quartermaster-arsenal") ctx.banish(Number(option));
    },
    ...decay(),
  },

  "forsaken strike|2": forsakenStrike,

  "restless outlaw|1": {
    activated: zombieAttack(),
    onDestroyed(ctx) {
      ctx.createCardInBanish(CORRUPTED_CORPSE);
    },
    ...decay(),
  },

  "become the shadow lord|3": {
    requiredHandCardsForAdditionalCost: 1,
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "iar-shadow-lord-banish",
          "Banish a card from your hand",
          hand.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-shadow-lord-banish") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) =>
        candidate.instanceId === Number(option)
      );
      if (!card) return;
      const runeblade = hasType(ctx, card, "runeblade");
      const shadow = hasType(ctx, card, "shadow");
      if (!ctx.banish(card.instanceId)) return;
      if (runeblade) ctx.createToken(RUNECHANT);
      if (shadow) ctx.createToken(GATE);
    },
  },

  "demonbound gloomblade|1": bloodDebt({
    ...usurp(),
  }, true),

  "bloodsong gloomblade|1": bloodDebt({
    ...usurp(),
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.player(opponentSeat(ctx)).board.some((card) => hasType(ctx, card, "aura")),
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const auras = ctx.player(target).board.filter((card) => hasType(ctx, card, "aura"));
      if (auras.length > 0) {
        ctx.requestCardChoice(
          "iar-bloodsong-aura",
          "Banish an aura permanent they control?",
          ["no", ...auras.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook !== "iar-bloodsong-aura" || option === "no") return;
      const target = opponentSeat(ctx);
      const aura = ctx.player(target).board.find((card) =>
        card.instanceId === Number(option) && hasType(ctx, card, "aura")
      );
      if (aura) ctx.banish(aura.instanceId);
    },
  }, true),

  "plundersong gloomblade|1": bloodDebt({
    ...usurp(),
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.player(opponentSeat(ctx)).arsenal.length > 0,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const arsenal = ctx.player(target).arsenal;
      if (arsenal.length > 0) {
        ctx.requestCardChoice(
          "iar-plundersong-arsenal",
          "Choose a card in your arsenal to banish",
          arsenal.map((card) => card.instanceId),
          target,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook !== "iar-plundersong-arsenal") return;
      const arsenal = ctx.player(opponentSeat(ctx)).arsenal;
      if (arsenal.some((card) => card.instanceId === Number(option))) {
        ctx.banish(Number(option));
      }
    },
  }, true),

  "vexing gloomblade|1": bloodDebt({
    ...usurp(),
    arcaneDamageEffect: true,
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      requestAnyTarget(
        ctx,
        "iar-vexing-target",
        `Choose a target to deal ${ctx.previewArcaneDamage(2)} arcane damage to`,
      );
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook === "iar-vexing-target") dealArcaneToTarget(ctx, option, 2);
    },
  }, true),

  "embrace sin|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 2 });
      ctx.addModifier({
        scope: "until-end-of-turn",
        grantsPlayFromZone: "banish",
        grantsPlayFromNameContains: "runechant",
        appliesToSubtype: "aura",
        ongoingLabel: "You may play an aura with Runechant in its name from banish",
      });
    },
  },

  "sinspeaker gloomblade|1": bloodDebt({
    ...usurp(),
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromBanish") !== true) return;
      if (!ctx.canSearchDeck()) return;
      const auras = ctx.player(ctx.seat).deck.filter((card) => {
        const data = ctx.cardData(card.cardId);
        return data.name.toLowerCase().includes("runechant") && hasType(ctx, card, "aura");
      });
      if (auras.length === 0) {
        ctx.shuffleDeck();
        return;
      }
      ctx.requestCardChoice(
        "iar-sinspeaker-aura",
        "Search for an aura with Runechant in its name?",
        ["no", ...auras.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook !== "iar-sinspeaker-aura") return;
      if (option !== "no") ctx.settleCard(Number(option));
      ctx.shuffleDeck();
    },
  }, true),

  "runic reaving|1": runicDiscardAttack(),
  "runic disposition|1": runicDiscardAttack(),

  "reach of the abyss|0": {
    onDefendingCombatChainClosed(ctx) {
      ctx.banishAllDefendingCardsOnChainClose();
    },
  },
  "grille of repentance|0": repentanceEquipment(),
  "path of repentance|0": repentanceEquipment(),
  "robe of repentance|0": repentanceEquipment(),

  "corrupt and conquer|1": bloodDebt({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromBanish") === true) {
        ctx.setFlag("link", "noDefenseReactions", true);
      }
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) {
        ctx.banish(card.instanceId);
      }
    },
  }),

  "open the gate to i'arathael|1": bloodDebt({
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) { ctx.createToken(GATE); },
    onSelfBanished(ctx, from) {
      if (from === "hand" || from === "deck") ctx.createToken(GATE);
    },
  }),

  "countdown to extinction|1": bloodDebt({
    onAttackDeclared(ctx) {
      ctx.createToken(GATE);
    },
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) && ctx.canSearchDeck(),
    onHit(ctx) {
      const darkestHours = ctx.player(ctx.seat).deck.filter((card) =>
        named(ctx, card, "Darkest Hour")
      );
      if (darkestHours.length === 0) {
        ctx.shuffleDeck();
        return;
      }
      ctx.requestCardChoice(
        "iar-countdown-darkest-hour",
        "Search for Darkest Hour to banish?",
        ["no", ...darkestHours.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-countdown-darkest-hour") return;
      if (option !== "no") ctx.banish(Number(option));
      ctx.shuffleDeck();
    },
  }),

  "dimenxxional ferryman|3": {
    graveyardReplacement: "bottom-of-deck",
    onPlay(ctx) {
      const choices = ctx.player(ctx.seat).banish.filter((card) =>
        !card.faceDown && isBloodDebtAction(ctx, card)
      );
      if (choices.length > 0) {
        ctx.requestCardChoice(
          "iar-ferryman-target",
          "Choose an action card with blood debt",
          choices.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-ferryman-target") ctx.setCounter("iarFerrymanTarget", Number(option));
    },
    onResolved(ctx) {
      const target = ctx.getCounter("iarFerrymanTarget");
      if (target > 0) {
        ctx.putOnDeckBottomInChosenOrder(
          [ctx.self.instanceId, target],
          "Order Dimenxxional Ferryman and the action card on the bottom of your deck",
        );
      }
    },
  },

  "planar chaos|1": {
    onPlay(ctx) {
      ctx.createToken(GATE);
      ctx.setFlag("player", "iarPlanarChaosGate", true);
    },
  },

  "darkest hour|1": darkestHour(4),
  "darkest hour|3": darkestHour(2),

  "stoke vengeance|1": {
    onAttackDeclared(ctx) {
      if (!previousAttackHasName(ctx, "Edge of Autumn")) return;
      ctx.setFlag("link", "iarStokeVengeanceCombo", true);
      ctx.grantGoAgain();
    },
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.getFlag("link", "iarStokeVengeanceCombo") === true,
    onHit(ctx) {
      buffNextAttack(ctx, { attack: 2, expiresOnChainClose: true });
    },
  },

  "echoing trap|3": {
    canDefendFromArsenal: true,
    canTriggerOnDefend(ctx) {
      const link = ctx.link;
      if (!link || link.attackCardType !== "action") return false;
      return ctx.cardNames(link.attackingCard).some((name) =>
        Number(ctx.getPlayerFlag(link.attacker, `playedNameCount:${name}`)) >= 2
      );
    },
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      ctx.setCounter("iarEchoingAttacker", attacker + 1);
      requestDiscardChoice(
        ctx,
        "iar-echoing-trap-discard",
        "Choose a card to discard",
        attacker,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-echoing-trap-discard") return;
      const attacker = ctx.getCounter("iarEchoingAttacker") - 1;
      if (attacker >= 0) resolveDiscardChoice(ctx, option, attacker);
    },
  },

  "deadly spinneret|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "discard",
      onActivate(ctx) {
        ctx.equipToken(GRAPHENE_CHELICERA);
        ctx.equipToken(GRAPHENE_CHELICERA);
      },
    },
  },

  "sigil of the muse|1": {
    replaceFriendlyDraw(ctx, count) {
      return replaceActionPhaseDrawWithPonder(ctx, ctx.seat, count);
    },
    replaceOpponentDraw(ctx, drawingSeat, count) {
      return replaceActionPhaseDrawWithPonder(ctx, drawingSeat, count);
    },
    triggers: [{
      event: "begin-action-phase",
      whose: "subject",
      label: "Destroy Sigil of the Muse and create a Ponder",
      effect(ctx) {
        ctx.destroySelf();
        ctx.createToken(PONDER);
      },
    }],
  },

  "astral ambience|2": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: false,
      effectCardCosts: [{
        zone: "arena",
        move: "destroy",
        count: 1,
        name: "Spectral Shield",
        prompt: "Destroy a Spectral Shield",
      }],
      canActivate(ctx) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId;
      },
      onActivate(ctx) {
        ctx.grantGoAgain();
      },
    },
    onFragment(ctx) {
      ctx.createToken(SPECTRAL_SHIELD);
    },
  },

  "rush of knowledge|3": {
    onAttackDeclared(ctx) {
      const ponders = ctx.player(ctx.seat).board.filter((card) =>
        named(ctx, card, "Ponder") && ctx.cardData(card.cardId).cardType === "token"
      );
      if (ponders.length > 0) {
        ctx.requestCardChoice(
          "iar-rush-ponder",
          "Destroy a Ponder to draw a card and gain 1 action point?",
          ["no", ...ponders.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-rush-ponder" || option === "no") return;
      const target = ctx.player(ctx.seat).board.find((card) =>
        card.instanceId === Number(option) &&
        named(ctx, card, "Ponder") &&
        ctx.cardData(card.cardId).cardType === "token"
      );
      if (!target || !ctx.destroyPermanent(target.instanceId)) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.changeActionPoints(ctx.seat, 1);
    },
  },

  "chains of consecration|2": {
    playTargetOptions(ctx) {
      return ctx.state.players.flatMap((player) => player.board)
        .filter((card) => hasType(ctx, card, "ally"))
        .map((card) => card.instanceId);
    },
    onPlay(ctx) {
      const target = ctx.state.players.flatMap((player) => player.board)
        .find((card) =>
          card.instanceId === ctx.playTargetInstanceId && hasType(ctx, card, "ally")
        );
      if (!target) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesToInstanceId: target.instanceId,
        preventAllDamageFromSource: true,
        banishPreventedDamageSourceFaceDownIfType: "shadow",
      });
    },
  },

  "pull from beyond|1": {
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        const matches = ctx.cardColor(top) === 1;
        ctx.banish(top.instanceId);
        if (matches) ctx.createToken(GATE);
      });
    },
  },
  "pull from beyond|2": {
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        const matches = ctx.cardColor(top) === 2;
        ctx.banish(top.instanceId);
        if (matches) ctx.createToken(GATE);
      });
    },
  },
  "pull from beyond|3": {
    onPlay(ctx) {
      if (ctx.player(ctx.seat).deck.length === 0) return;
      optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        const matches = ctx.cardColor(top) === 3;
        ctx.banish(top.instanceId);
        if (matches) ctx.createToken(GATE);
      });
    },
  },

  "circlet of eternal end|0": {
    onDefend(ctx) {
      const attacker = ctx.link?.attacker;
      if (attacker === undefined) return;
      const cards = ctx.player(attacker).banish.filter((card) => !card.faceDown);
      if (cards.length > 0) {
        ctx.requestCardChoice(
          "iar-circlet-banish",
          "Turn an attacking hero's banished card face down",
          cards.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-circlet-banish") ctx.setCardFaceDown(Number(option), true);
    },
  },

  "shadowrealm harrower|3": bloodDebt({
    modifyAttack: (ctx) => ctx.getFlag("link", "fromBanish") === true ? 1 : 0,
    onDealsDamage(ctx, targetSeat, amount, arcane) {
      if (!arcane && amount > 0 && targetSeat !== ctx.seat &&
        ctx.link?.targetAllyId === undefined &&
        ctx.getFlag("link", "fromBanish") === true) {
        ctx.gainLife(ctx.seat, amount);
      }
    },
  }),
  "shadowrealm harvester|1": fromBanishBonus((ctx) => {
    ctx.setFlag("link", "overpower", true);
  }),
  "shadowrealm reaper|2": fromBanishBonus((ctx) => ctx.grantGoAgain()),

  "unbound by shadow|1": bloodDebt({
    onAttackDeclared(ctx) {
      if (ctx.getFlag("link", "fromBanish") === true) ctx.createToken(GATE);
    },
  }),

  "harbinger of destruction|1": bloodDebt({
    requiredHandCardsForAdditionalCost: 1,
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "iar-harbinger-banish",
          "Banish a card from your hand",
          hand.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-harbinger-banish") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) =>
        candidate.instanceId === Number(option)
      );
      if (!card) return;
      const shadow = hasType(ctx, card, "shadow");
      if (ctx.banish(card.instanceId) && shadow) ctx.setCounter("iarHarbingerShadow", 1);
    },
    canTriggerOnHit: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
      ctx.getCounter("iarHarbingerShadow") > 0,
    onHit(ctx) { ctx.createTokens(GATE, 2); },
  }),

  "tribute to greater power|1": bloodDebt({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) { buffNextAttack(ctx, { overpower: true }); },
    },
  }),

  "viserai, the forsaken|0": viseraiFront,
  "viserai, between worlds|0": viseraiFront,
  "viserai, usurper|0": viseraiBack,

  "blasmophet, the insatiable hunger|0": {
    activated: attackAbility(1, {
      goAgain: true,
      oncePerTurn: false,
      canActivate: (ctx) => ctx.getFlag("player", "gemConsumingAppetiteActive") === true,
    }),
    allowsFriendlyCardPlayFrom(ctx, card, zone) {
      return zone === "banish" && !card.faceDown && isBloodDebtAction(ctx, card) &&
        ctx.getFlag("player", "iarBlasmophetPlayUsed") !== true;
    },
    onFriendlyPlay(ctx, played, from) {
      if (from === "banish" && isBloodDebtAction(ctx, played)) {
        ctx.setFlag("player", "iarBlasmophetPlayUsed", true);
      }
    },
    triggers: [{
      event: "end-of-turn",
      whose: "any",
      label: "Banish a hand card, then check the hunger",
      effect(ctx) {
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length === 0) {
          if (ctx.getFlag("player", "banishedBloodDebtThisTurn") !== true) ctx.destroySelf();
          return;
        }
        ctx.requestCardChoice(
          "iar-blasmophet-banish",
          "Banish a card from hand?",
          ["no", ...hand.map((card) => card.instanceId)],
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "iar-blasmophet-banish") return;
      if (option !== "no") ctx.banish(Number(option));
      if (ctx.getFlag("player", "banishedBloodDebtThisTurn") !== true) ctx.destroySelf();
    },
  },
  "shadowrealm strength|1": shadowrealmStrength(3),
  "shadowrealm strength|3": shadowrealmStrength(1),

  "restless cleric|1": {
    activated: [
      {
        cost: 0,
        isAttack: false,
        goAgain: true,
        tap: true,
        label: "Gain 1 life",
        onActivate(ctx) {
          ctx.gainLife(ctx.seat, 1);
        },
      },
      ...zombieAttack().map((ability) => ({ ...ability, label: "Attack" })),
    ],
    ...decay(),
  },

  "restless corporal|1": {
    activated: [
      {
        cost: 0,
        isAttack: false,
        goAgain: true,
        tap: true,
        label: "Put a banished card into your graveyard",
        canActivate: (ctx) => ctx.player(ctx.seat).banish.some((card) => !card.faceDown),
        onActivate(ctx) {
          ctx.requestCardChoice(
            "iar-restless-corporal",
            "Put a banished card into your graveyard",
            ctx.player(ctx.seat).banish
              .filter((card) => !card.faceDown)
              .map((card) => card.instanceId),
          );
        },
      },
      ...zombieAttack().map((ability) => ({ ...ability, label: "Attack" })),
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "iar-restless-corporal") return;
      const instanceId = Number(option);
      const selected = ctx.player(ctx.seat).banish.find((card) =>
        card.instanceId === instanceId && !card.faceDown
      );
      if (selected) ctx.moveToGraveyard(instanceId, "banish");
    },
    ...decay(),
  },

  "corrupted corpse|0": bloodDebt({
    activated: zombieAttack(),
    onAttackDeclared(ctx) {
      ctx.grantGoAgain();
    },
  }),

  "danse macabre|0": {
    triggers: [{
      event: "card-entered-arena",
      label: "Pay 2 and tap this for the ally's first attack?",
      condition: (ctx, entered) => !!entered && hasType(ctx, entered, "ally"),
      effect(ctx, entered) {
        if (!entered) return;
        const liveAndUntapped = Object.values(ctx.player(ctx.seat).equipment).some(
          (card) => card?.instanceId === ctx.self.instanceId && !card.tapped,
        );
        if (!liveAndUntapped) return;
        ctx.setCounter("iarDanseAlly", entered.instanceId);
        ctx.requestPayment(
          "iar-danse-macabre-pay",
          "Danse Macabre: pay 2 and tap this?",
          2,
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "iar-danse-macabre-pay" || option !== "paid") return;
      if (!ctx.tap(ctx.self.instanceId)) return;
      const allyId = ctx.getCounter("iarDanseAlly");
      ctx.addModifier({
        scope: "next-attack",
        goAgain: true,
        appliesToInstanceId: allyId,
      });
      ctx.destroyAtEndPhase(allyId);
    },
  },

  "seven sin nebula|0": {
    activated: attackAbility(1, {
      tap: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedFromBanishThisTurn") === true,
    }),
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      ctx.createToken(RUNECHANT);
    },
  },

  "usurp the shadow throne|3": bloodDebt({
    staticPlayableFrom: ["banish"],
    canPlay(ctx) {
      const inBanish = ctx.player(ctx.seat).banish.some((card) =>
        card.instanceId === ctx.self.instanceId
      );
      return !inBanish || ctx.getFlag("player", "usurpedThisTurn") === true;
    },
    modifyPlayCost(ctx, base) {
      return ctx.getFlag("player", "usurpedThisTurn") === true
        ? Math.max(0, base - 6)
        : base;
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const faceUp = ctx.player(target).banish.filter((card) => !card.faceDown);
      let turned = 0;
      for (const card of faceUp) {
        if (ctx.setCardFaceDown(card.instanceId, true)) turned++;
      }
      if (turned > 0) {
        ctx.loseLife(target, turned);
        ctx.gainLife(ctx.seat, turned);
      }
    },
  }),

  "otherworldly sins|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3, appliesToType: ["runeblade", "shadow"] });
      ctx.createToken(RUNECHANT);
    },
  },
  "otherworldly sins|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 2, appliesToType: ["runeblade", "shadow"] });
      ctx.createToken(RUNECHANT);
    },
  },
  "otherworldly sins|3": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 1, appliesToType: ["runeblade", "shadow"] });
      ctx.createToken(RUNECHANT);
    },
  },

  "crushing headache|1": {
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      (ctx.link?.damage ?? 0) >= 4,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = [...ctx.player(target).hand];
      const arsenal = [...ctx.player(target).arsenal];
      ctx.revealCards(
        [...hand, ...arsenal].map((card) => card.instanceId),
        target,
      );
      for (const card of arsenal) {
        if (isNonAttackAction(ctx, card)) ctx.moveToGraveyard(card.instanceId, "arsenal");
      }
      for (const card of hand) {
        if (isNonAttackAction(ctx, card)) ctx.discardCard(target, card.instanceId);
      }
    },
  },

  "head banging chorus|2": {
    ...suspenseAura(),
    onFriendlyPlay(ctx, played) {
      if (!firstHeadBangingAttack(ctx, played)) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesToInstanceId: played.instanceId,
        onHitScriptHook: {
          hook: "iar-head-banging-hit",
          label: "if you have no cards in hand, draw a card",
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook === "iar-head-banging-hit" && ctx.player(ctx.seat).hand.length === 0) {
        ctx.drawCards(ctx.seat, 1);
      }
    },
  },

  "ice aged oak|3": {
    onPlayCostPaid(ctx, paid) {
      if (paidWithType(ctx, paid, "ice")) ctx.setCounter("iarIceBond", 1);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("iarIceBond") > 0) ctx.setFlag("link", "dominate", true);
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      ctx.createToken(EMBODIMENT_OF_EARTH);
      if (ctx.getCounter("iarIceBond") > 0) {
        createFrostbitesInExposedZones(ctx, opponentSeat(ctx));
      }
    },
  },

  "ancient earth oak|1": {
    onPlayCostPaid(ctx, paid) {
      if (paidWithType(ctx, paid, "earth")) ctx.setCounter("iarEarthBond", 1);
    },
    modifyAttack: (ctx) => ctx.getCounter("iarEarthBond") > 0 ? 2 : 0,
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      ctx.createToken(FROSTBITE, opponentSeat(ctx));
      if (ctx.getCounter("iarEarthBond") > 0) ctx.setFlag("link", "attackToBottom", true);
    },
  },

  "baalghor, omen of the end|0": {
    replacePitchResources(ctx, pitched, amount) {
      ctx.banish(pitched.instanceId);
      return amount;
    },
    modifyAttack(ctx) {
      return ctx.link?.attackCardType === "action" &&
        ctx.getFlag("link", "fromBanish") === true
        ? 3
        : 0;
    },
  },

  "gate to i'arathael|0": {
    onEnterArena(ctx) {
      ctx.setFlag("player", "iarGateCreatedOrActivated", true);
    },
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      canActivate(ctx) {
        const anyZone = ctx.getFlag("player", "iarPlanarChaosGate") === true;
        const players = anyZone ? ctx.state.players : [ctx.player(ctx.seat)];
        return players.some((player) => player.banish.some((card) =>
          !card.faceDown && isBloodDebtAction(ctx, card)
        ));
      },
      onActivate(ctx) {
        ctx.setFlag("player", "iarGateCreatedOrActivated", true);
        const anyZone = ctx.getFlag("player", "iarPlanarChaosGate") === true;
        ctx.setFlag("player", "iarPlanarChaosGate", false);
        ctx.setFlag("player", "iarPlanarChaosGateSelection", anyZone);
        const players = anyZone ? ctx.state.players : [ctx.player(ctx.seat)];
        const choices = players.flatMap((player) => player.banish.filter((card) =>
          !card.faceDown && isBloodDebtAction(ctx, card)
        ));
        if (choices.length > 0) {
          ctx.requestCardChoice(
            "iar-gate-target",
            "Choose an action card with blood debt",
            choices.map((card) => card.instanceId),
          );
        }
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-gate-target") return;
      const anyZone = ctx.getFlag("player", "iarPlanarChaosGateSelection") === true;
      ctx.setFlag("player", "iarPlanarChaosGateSelection", false);
      ctx.allowPlayFrom(
        Number(option),
        "banish",
        anyZone ? { forSeat: ctx.seat } : undefined,
      );
    },
  },
};
