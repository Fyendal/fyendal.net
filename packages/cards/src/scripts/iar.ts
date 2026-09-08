import type {
  CardInstance,
  CardScript,
  DeepReadonly,
  ScriptCtx,
  TriggerDef,
} from "@fyendal/engine";
import {
  ampNextArcane,
  attackAbility,
  bloodDebtScript as bloodDebt,
  buffNextAttack,
  commonOptionMessages,
  dealArcane,
  decisionMessage,
  decisionPrompt,
  optN,
  optOnChoose,
  opponentSeat,
  previousAttackHasName,
  requestDiscardChoice,
  revealTopSixPlusStays,
  resolveDiscardChoice,
  suspenseAura,
} from "./shared-helpers.js";

const RUNECHANT = "SBA036";
const GATE = "IAR222";
const BLASMOPHET = "IAR221";
const CORRUPTED_CORPSE = "IAR090";
const COURAGE = "DTD232";
const EMBODIMENT_OF_EARTH = "AJV028";
const FROSTBITE = "AJV029";
const GRAPHENE_CHELICERA = "SAR033";
const LIGHTNING_FLOW = "OMN203";
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

function requestAnyTarget(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  amount: number,
): void {
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  for (const player of ctx.state.players) {
    for (const card of player.board) {
      if (!hasType(ctx, card, "ally")) continue;
      options.push(`ally:${player.seat}:${card.instanceId}`);
      cardOptions.push(card.instanceId);
    }
  }
  ctx.requestChoice(
    hook,
    decisionPrompt(fallback, id, {
      values: { amount },
      optionMessages: commonOptionMessages("opposing hero", "your hero"),
    }),
    options,
    ctx.seat,
    cardOptions,
  );
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
    ctx.createToken(FROSTBITE, seat, { [`frostZone:${slot}`]: 1 });
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

function maintainChannelStormgarden(ctx: ScriptCtx): void {
  const remaining = ctx.getCounter("iarStormgardenRemaining");
  if (remaining <= 0) return;
  const lightning = ctx.player(ctx.seat).pitch.filter((card) => hasType(ctx, card, "lightning"));
  if (lightning.length < remaining) {
    ctx.destroySelf();
    return;
  }
  ctx.requestCardChoice(
    "iar-stormgarden-bottom",
    decisionPrompt(
      "Put a Lightning card from pitch on the bottom",
      "card.ele.pitch.card.bottom",
      { values: { type: "Lightning" } },
    ),
    lightning.map((card) => card.instanceId),
  );
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

type MarkEffect = "neverest" | "pathstone" | "ushering";

function resolveMarkEffect(ctx: ScriptCtx, effect: MarkEffect): void {
  if (effect === "pathstone") {
    ctx.gainLife(ctx.seat, 1);
    return;
  }
  if (effect === "ushering") {
    ctx.createToken(GATE);
    return;
  }
  const banished = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown);
  if (banished.length === 0) return;
  ctx.requestCardChoice(
    "iar-mark-neverest-banish",
    decisionPrompt(
      "Turn a card in your banished zone face-down to create a Corrupted Corpse?",
      "card.iar.mark.neverest.banish.choose",
      { optionMessages: commonOptionMessages("no") },
    ),
    ["no", ...banished.map((card) => card.instanceId)],
  );
}

function markOf(effect: MarkEffect): CardScript {
  const label = effect === "neverest"
    ? "Turn a banished card face-down to create a Corrupted Corpse"
    : effect === "pathstone"
      ? "Gain 1 life"
      : "Create a Gate to i'Arathael";
  const labelMessage = effect === "neverest"
    ? { id: "card.trigger.iar.mark.neverest" }
    : effect === "pathstone"
      ? { id: "card.trigger.common.life.gain", values: { amount: 1 } }
      : { id: "card.iar.forsaken.option.gate" };
  return {
    onEnterArena(ctx) {
      const allies = ctx.player(ctx.seat).board.filter((card) =>
        card.instanceId !== ctx.self.instanceId && hasType(ctx, card, "ally")
      );
      if (allies.length === 0) {
        ctx.destroySelf();
        return;
      }
      ctx.requestCardChoice(
        "iar-mark-bind",
        decisionPrompt("Choose an ally to bind this to", "card.iar.mark.ally.bind.choose"),
        allies.map((card) => card.instanceId),
      );
    },
    modifyFriendlyAttack(ctx, attacking) {
      return attacking.instanceId === ctx.self.boundToInstanceId ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      return ctx.self.boundToInstanceId !== undefined &&
        ctx.link?.attackingCard.instanceId === ctx.self.boundToInstanceId &&
        ctx.link.targetAllyId === undefined;
    },
    onHit(ctx) {
      resolveMarkEffect(ctx, effect);
    },
    triggers: [{
      event: "card-left-arena",
      label,
      labelMessage,
      condition: (ctx, left, event) => !!left &&
        left.instanceId === ctx.self.boundToInstanceId &&
        hasType(ctx, left, "ally") &&
        (event?.to === "graveyard" || event?.to === "cease-to-exist"),
      effect(ctx) { resolveMarkEffect(ctx, effect); },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "iar-mark-bind") {
        ctx.bindSelfTo(Number(option));
        return;
      }
      if (hook !== "iar-mark-neverest-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).banish.find((candidate) =>
        candidate.instanceId === Number(option) && !candidate.faceDown
      );
      if (!card || !ctx.setCardFaceDown(card.instanceId, true)) return;
      ctx.createCardInBanish(CORRUPTED_CORPSE);
    },
  };
}

function restlessTemplar(): CardScript {
  const condition = (
    ctx: ScriptCtx,
    left: DeepReadonly<CardInstance> | undefined,
    to: string | undefined,
  ): boolean => !!left && left.owner === ctx.seat && hasType(ctx, left, "zombie") &&
    (ctx.cardData(left.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "decay") &&
    (to === "graveyard" || to === "cease-to-exist");
  const gateTrigger = (sourceZone?: "self"): TriggerDef => ({
    event: "card-left-arena",
    ...(sourceZone ? { sourceZone } : {}),
    label: "Create a Gate to i'Arathael",
    labelMessage: { id: "card.iar.forsaken.option.gate" },
    condition: (ctx, left, event) =>
      condition(ctx, left, event?.to) &&
      (sourceZone !== "self" || left?.instanceId === ctx.self.instanceId),
    effect(ctx: ScriptCtx) { ctx.createToken(GATE); },
  });
  return {
    activated: zombieAttack(),
    triggers: [gateTrigger(), gateTrigger("self"), ...decay().triggers!],
  };
}

function restlessLooter(): CardScript {
  return {
    activated: [{
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Discard a card, then draw a card",
      onActivate(ctx) {
        const hand = ctx.player(ctx.seat).hand;
        if (hand.length > 0) {
          ctx.requestCardChoice(
            "iar-looter-discard",
            decisionPrompt("Choose a card to discard", "card.iar.looter.discard.choose"),
            hand.map((card) => card.instanceId),
          );
        }
      },
    }, ...zombieAttack().map((ability) => ({ ...ability, label: "Attack" }))],
    onChoose(ctx, hook, option) {
      if (hook === "iar-looter-discard" && ctx.discardCard(ctx.seat, Number(option))) {
        ctx.drawCards(ctx.seat, 1);
      }
    },
    ...decay(),
  };
}

function violentGusto(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (!selfHitsHero(ctx)) return;
      const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => hasType(ctx, card, "aura"));
      if (auras.length === 0) return;
      ctx.requestCardChoice(
        "iar-violent-gusto-aura",
        decisionPrompt(
          "Name and return an aura permanent?",
          "card.iar.violentgusto.aura.choose",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...auras.map((card) => card.instanceId)],
      );
    },
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) && !!ctx.self.chosenName,
    onHit(ctx) {
      const chosen = ctx.self.chosenName?.toLowerCase();
      if (!chosen) return;
      for (const aura of [...ctx.player(opponentSeat(ctx)).board]) {
        if (hasType(ctx, aura, "aura") && ctx.cardNames(aura).includes(chosen)) {
          ctx.moveToHand(aura.instanceId);
        }
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-violent-gusto-aura" || option === "no") return;
      const aura = ctx.player(opponentSeat(ctx)).board.find((card) =>
        card.instanceId === Number(option) && hasType(ctx, card, "aura")
      );
      if (!aura) return;
      ctx.setChosenName(ctx.cardData(aura.cardId).name);
      ctx.moveToHand(aura.instanceId);
    },
  };
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
    decisionPrompt(
      `Forsaken Strike: choose effect ${choiceNumber} of ${total}`,
      "card.iar.forsaken.mode.choose",
      {
        values: { index: choiceNumber, total },
        optionMessages: {
          "Create a Gate to i'Arathael": decisionMessage("card.iar.forsaken.option.gate"),
          "Give Forsaken Strike +2 power": decisionMessage("card.iar.forsaken.option.power"),
          "Give Forsaken Strike go again": decisionMessage("card.iar.forsaken.option.goagain"),
        },
      },
    ),
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
  },
  additionalCost(ctx) {
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
          decisionPrompt(
            "Turn a card with blood debt face down",
            "card.iar.blooddebt.facedown",
          ),
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
        ctx.isRunechant(card)
      );
      if (runechants.length > 0) {
        ctx.requestCardChoice(
          "iar-usurp-runechant",
          decisionPrompt(
            "Usurp: destroy a Runechant",
            "card.iar.usurp.runechant.destroy",
          ),
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

function ingestTheUnknown(): CardScript {
  return bloodDebt({
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      const power = ctx.basePower(top);
      if (ctx.banish(top.instanceId)) ctx.addCardTempPower(ctx.self.instanceId, power);
    },
  });
}

function hellboundAssault(): CardScript {
  return bloodDebt({
    canTriggerOnHit: (ctx) => ctx.link?.attackingCard.instanceId === ctx.self.instanceId,
    onHit(ctx) { ctx.setFlag("link", "attackToBanish", true); },
  });
}

function cleaveTheHeavens(): CardScript {
  return bloodDebt({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      fromHandMove: "banish",
      onActivate(ctx) { ctx.createToken(GATE); },
    },
  });
}

function revealTopForAttack(
  payoff: (ctx: ScriptCtx) => void,
): CardScript {
  return {
    onAttackDeclared(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || !ctx.revealCards([top.instanceId])) return;
      if (ctx.basePower(top) >= 6) payoff(ctx);
    },
  };
}

type ZombieDiscardPayoff = "corpse" | "next-attack" | "recover";

function zombieDiscardAttack(payoff: ZombieDiscardPayoff): CardScript {
  return {
    onAttackDeclared(ctx) {
      const zombies = ctx.player(ctx.seat).hand.filter((card) => hasType(ctx, card, "zombie"));
      if (zombies.length === 0) return;
      ctx.requestCardChoice(
        "iar-zombie-discard",
        decisionPrompt(
          "Discard a zombie?",
          "card.iar.zombie.discard.optional",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...zombies.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-zombie-discard") {
        if (option === "no") return;
        const zombie = ctx.player(ctx.seat).hand.find((card) =>
          card.instanceId === Number(option) && hasType(ctx, card, "zombie")
        );
        if (!zombie || !ctx.discardCard(ctx.seat, zombie.instanceId)) return;
        if (payoff === "corpse") {
          ctx.createCardInBanish(CORRUPTED_CORPSE);
        } else if (payoff === "next-attack") {
          buffNextAttack(ctx, { attack: 1 });
        } else {
          const banished = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown);
          if (banished.length > 0) {
            ctx.requestCardChoice(
              "iar-malignant-recover",
              decisionPrompt(
                "Put a card from your banished zone into your graveyard",
                "card.iar.banished.graveyard.put",
              ),
              banished.map((card) => card.instanceId),
            );
          }
        }
        return;
      }
      if (hook === "iar-malignant-recover") {
        const instanceId = Number(option);
        const selected = ctx.player(ctx.seat).banish.find((card) =>
          card.instanceId === instanceId && !card.faceDown
        );
        if (selected) ctx.moveToGraveyard(instanceId, "banish");
      }
    },
  };
}

function arknightDescendancy(): CardScript {
  return bloodDebt({
    modifyPlayCost(ctx, base) {
      const runechants = ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card));
      return Math.max(0, base - runechants.length);
    },
    onSelfBanished(ctx) {
      const maximum = Math.min(3, Math.max(0, ctx.player(ctx.seat).life - 1));
      ctx.requestChoice(
        "iar-arknight-life",
        decisionPrompt("Pay up to 3 life", "card.iar.arknight.life.pay"),
        Array.from({ length: maximum + 1 }, (_, amount) => String(amount)),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-arknight-life") return;
      const amount = Number(option);
      const maximum = Math.min(3, Math.max(0, ctx.player(ctx.seat).life - 1));
      if (!Number.isInteger(amount) || amount < 0 || amount > maximum) return;
      if (amount > 0) ctx.loseLife(ctx.seat, amount);
      ctx.createTokens(RUNECHANT, amount);
    },
  });
}

function forbiddenHarvest(): CardScript {
  return {
    onPlay(ctx) {
      const banished = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown);
      if (banished.length === 0) return;
      ctx.requestCardChoices(
        "iar-forbidden-harvest",
        decisionPrompt(
          "Turn up to 3 cards in your banished zone face-down",
          "card.iar.banished.facedown.upto",
          { values: { amount: 3 } },
        ),
        banished.map((card) => card.instanceId),
        0,
        Math.min(3, banished.length),
      );
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "iar-forbidden-harvest" || options.length > 3) return;
      let shadow = 0;
      for (const option of options) {
        const card = ctx.player(ctx.seat).banish.find((candidate) =>
          candidate.instanceId === Number(option) && !candidate.faceDown
        );
        if (!card) continue;
        const isShadow = hasType(ctx, card, "shadow");
        if (!ctx.setCardFaceDown(card.instanceId, true)) continue;
        if (isShadow) shadow++;
      }
      ctx.createTokens(RUNECHANT, shadow);
    },
  };
}

function bloodfrenzyGloomblade(): CardScript {
  return bloodDebt({
    ...usurp(),
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "dealtDamageThisTurn") === true) ctx.grantGoAgain();
    },
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      ctx.grantGoAgain();
    },
    onChoose(ctx, hook, option) {
      resolveUsurp(ctx, hook, option);
    },
  }, true);
}

function murmuringGloomblade(): CardScript {
  return bloodDebt({
    ...usurp(),
    onAttackDeclared(ctx) {
      ctx.createToken(RUNECHANT);
    },
    onHit(ctx) {
      ctx.createToken(RUNECHANT);
    },
    onChoose(ctx, hook, option) {
      resolveUsurp(ctx, hook, option);
    },
  }, true);
}

function gateOnHit(): CardScript {
  return bloodDebt({ onHit(ctx) { ctx.createToken(GATE); } });
}

type ShadowrealmHandPayoff = "go-again" | "power" | "gate";

function shadowrealmHandBanish(payoff: ShadowrealmHandPayoff): CardScript {
  return bloodDebt({
    onAttackDeclared(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "iar-shadowrealm-hand",
        decisionPrompt(
          "Banish a card from your hand?",
          "card.iar.hand.banish.optional",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...hand.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-shadowrealm-hand" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) =>
        candidate.instanceId === Number(option)
      );
      if (!card) return;
      const shadow = hasType(ctx, card, "shadow");
      if (!ctx.banish(card.instanceId) || !shadow) return;
      if (payoff === "go-again") ctx.grantGoAgain();
      else if (payoff === "power") ctx.addCardTempPower(ctx.self.instanceId, 2);
      else ctx.createToken(GATE);
    },
  });
}

function embraceUrsur(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "iar-embrace-ursur-banish",
          decisionPrompt(
            "Banish a card from your hand?",
            "card.gem.embrace.ursur.banish",
            { optionMessages: { no: decisionMessage("common.option.decline") } },
          ),
          ["no", ...hand.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-embrace-ursur-banish" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) =>
        candidate.instanceId === Number(option)
      );
      if (!card) return;
      const types = ctx.cardTypes(card);
      if (!ctx.banish(card.instanceId)) return;
      if (types.includes("runeblade")) ctx.createToken(RUNECHANT);
      if (types.includes("shadow")) ctx.grantGoAgain();
    },
  };
}

function sonataDystopia(): CardScript {
  return {
    variablePlayCost: {
      base: 0,
      counterKey: "iarSonataDystopiaX",
      prompt: decisionPrompt("Choose X", "engine.decision.x.choose"),
      maximum(ctx) {
        return ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card)).length;
      },
    },
    additionalCost(ctx) {
      const x = ctx.getCounter("iarSonataDystopiaX");
      if (x <= 0) return;
      const runechants = ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card));
      ctx.requestCardChoices(
        "iar-sonata-dystopia-runechants",
        decisionPrompt(
          `Choose ${x} Runechant${x === 1 ? "" : "s"} to destroy`,
          "card.iar.sonata.runechants.destroy",
          { values: { amount: x } },
        ),
        runechants.map((card) => card.instanceId),
        x,
        x,
      );
    },
    onChooseMany(ctx, hook, options) {
      if (hook !== "iar-sonata-dystopia-runechants") return;
      const runechantIds = new Set(
        ctx.player(ctx.seat).board.filter((card) => ctx.isRunechant(card))
          .map((card) => card.instanceId),
      );
      for (const option of options) {
        const instanceId = Number(option);
        if (runechantIds.has(instanceId)) ctx.destroyPermanent(instanceId);
      }
    },
    onPlay(ctx) {
      const x = ctx.getCounter("iarSonataDystopiaX");
      ctx.addModifier({
        scope: "until-end-of-turn",
        appliesTo: "attack-action",
        playCostReduction: x,
        once: true,
      });
      buffNextAttack(ctx, {
        appliesTo: "attack-action",
        attack: x,
        overpower: true,
        onHitCreateToken: { cardId: RUNECHANT, count: x },
      });
    },
  };
}

function battlePrep(attack: number): CardScript {
  return {
    onPlay(ctx) {
      if (ctx.fromArsenal) buffNextAttack(ctx, { attack });
      optN(ctx, 2);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
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
          decisionPrompt(
            "Put a banished card into your graveyard?",
            "card.iar.banished.graveyard.put",
            { optionMessages: commonOptionMessages("no") },
          ),
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
  ctx.setFlag("player", "iarViseraiBloodDebtAttackInstanceId", played.instanceId);
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
  onBecomeHero(ctx) {
    const firstAttackId = ctx.getFlag("player", "iarViseraiBloodDebtAttackInstanceId");
    if (typeof firstAttackId === "number") {
      ctx.grantCardKeyword(firstAttackId, "go again");
    }
  },
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

function countdownToExtinction(): CardScript {
  return bloodDebt({
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
        decisionPrompt(
          "Search for Darkest Hour to banish?",
          "card.iar.countdown.darkesthour.search",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...darkestHours.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "iar-countdown-darkest-hour") return;
      if (option !== "no") ctx.banish(Number(option));
      ctx.shuffleDeck();
    },
  });
}

function vexingGloomblade(): CardScript {
  return bloodDebt({
    ...usurp(),
    arcaneDamageEffect: true,
    canTriggerOnHit: selfHitsHero,
    onHit(ctx) {
      requestAnyTarget(
        ctx,
        "iar-vexing-target",
        `Choose a target to deal ${ctx.previewArcaneDamage(2)} arcane damage to`,
        "card.iar.vexing.target.choose",
        ctx.previewArcaneDamage(2),
      );
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook === "iar-vexing-target") dealArcaneToTarget(ctx, option, 2);
    },
  }, true);
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

  "devouring doomwake|1": bloodDebt({
    onHit(ctx) {
      const link = ctx.link;
      if (!link) return;
      ctx.setFlag("link", "attackToBanish", true);
      for (const defending of [...link.defendingCards, ...link.defendingEquipment]) {
        ctx.banish(defending.instanceId);
      }
    },
  }),

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
          decisionPrompt(
            "Destroy a card defending your 6 or more base power attack",
            "card.iar.apex.defender.destroy",
          ),
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

  "ingest the unknown|1": ingestTheUnknown(),
  "hellbound assault|1": hellboundAssault(),
  "hellbound assault|2": hellboundAssault(),
  "hellbound assault|3": hellboundAssault(),

  "cleave the heavens|1": cleaveTheHeavens(),
  "cleave the heavens|2": cleaveTheHeavens(),
  "cleave the heavens|3": cleaveTheHeavens(),

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

  "boneseer skullcap|0": { onDefend: revealTopSixPlusStays },

  "peak power|1": revealTopForAttack((ctx) => ctx.setFlag("link", "overpower", true)),
  "peak power|2": revealTopForAttack((ctx) => ctx.setFlag("link", "overpower", true)),
  "peak power|3": revealTopForAttack((ctx) => ctx.setFlag("link", "overpower", true)),

  "headstrong stampede|1": revealTopForAttack((ctx) => ctx.grantGoAgain()),
  "headstrong stampede|2": revealTopForAttack((ctx) => ctx.grantGoAgain()),
  "headstrong stampede|3": revealTopForAttack((ctx) => ctx.grantGoAgain()),

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
          decisionPrompt(
            "Choose a zombie in your graveyard",
            "card.iar.malice.zombie.choose",
          ),
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
        prompt: decisionPrompt("Discard a zombie", "card.common.cost.zombie.discard"),
      }],
      onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 2); },
    },
  },

  "acrid stench|1": zombieDiscardAttack("corpse"),
  "acrid stench|2": zombieDiscardAttack("corpse"),
  "acrid stench|3": zombieDiscardAttack("corpse"),
  "bone mass|1": zombieDiscardAttack("next-attack"),
  "bone mass|2": zombieDiscardAttack("next-attack"),
  "bone mass|3": zombieDiscardAttack("next-attack"),
  "malignant migration|1": zombieDiscardAttack("recover"),
  "malignant migration|2": zombieDiscardAttack("recover"),
  "malignant migration|3": zombieDiscardAttack("recover"),

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
          decisionPrompt(
            "Put a zombie into your graveyard to keep Bridge of Damnation?",
            "card.iar.bridge.zombie.choose",
            { optionMessages: commonOptionMessages("destroy") },
          ),
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
          decisionPrompt(
            "Destroy or discard an ally for +2 defense?",
            "card.iar.bonebarrier.ally.choose",
            { optionMessages: commonOptionMessages("no") },
          ),
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
        decisionPrompt(
          "Choose a card to banish",
          "card.iar.hand.banish.choose",
        ),
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
        decisionPrompt(
          "Choose an arsenal card to banish",
          "card.iar.arsenal.banish.choose",
        ),
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

  "restless templar|1": restlessTemplar(),

  "restless looter|1": restlessLooter(),

  "mark of neverest|3": markOf("neverest"),

  "mark of pathstone|3": markOf("pathstone"),

  "mark of ushering|3": markOf("ushering"),

  "tome of necrosis|1": {
    alternativePlayCost: {
      kind: "discard-or-destroy-controlled-subtype",
      subtype: "ally",
      replacesResourceCost: false,
      required: true,
    },
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
      ctx.untap(ctx.player(ctx.seat).hero.instanceId);
    },
  },

  "violent gusto|1": violentGusto(),

  "become the shadow lord|3": {
    onPlay(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "iar-shadow-lord-banish",
          decisionPrompt(
            "Banish a card from your hand",
            "card.iar.hand.banish",
          ),
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
  "demonbound gloomblade|2": bloodDebt({
    ...usurp(),
  }, true),
  "demonbound gloomblade|3": bloodDebt({
    ...usurp(),
  }, true),

  "embrace ursur|2": embraceUrsur(),
  "embrace ursur|3": embraceUrsur(),

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
          decisionPrompt(
            "Banish an aura permanent they control?",
            "card.iar.bloodsong.aura.banish",
            { optionMessages: commonOptionMessages("no") },
          ),
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

  "cullingsong gloomblade|1": bloodDebt({
    ...usurp(),
    canTriggerOnHit: (ctx) => selfHitsHero(ctx) &&
      ctx.player(opponentSeat(ctx)).hand.length > 0,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      ctx.requestCardChoice(
        "iar-cullingsong-hand",
        decisionPrompt(
          "Choose a card in your hand to banish",
          "card.iar.opponent.hand.banish",
        ),
        ctx.player(target).hand.map((card) => card.instanceId),
        target,
      );
    },
    onChoose(ctx, hook, option) {
      if (resolveUsurp(ctx, hook, option)) return;
      if (hook === "iar-cullingsong-hand") ctx.banish(Number(option));
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
          decisionPrompt(
            "Choose a card in your arsenal to banish",
            "card.iar.opponent.arsenal.banish",
          ),
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

  "vexing gloomblade|1": vexingGloomblade(),
  "vexing gloomblade|2": vexingGloomblade(),
  "vexing gloomblade|3": vexingGloomblade(),

  "arknight descendancy|3": arknightDescendancy(),

  "forbidden harvest|2": forbiddenHarvest(),

  "bloodfrenzy gloomblade|1": bloodfrenzyGloomblade(),
  "bloodfrenzy gloomblade|2": bloodfrenzyGloomblade(),
  "bloodfrenzy gloomblade|3": bloodfrenzyGloomblade(),

  "murmuring gloomblade|1": murmuringGloomblade(),
  "murmuring gloomblade|2": murmuringGloomblade(),
  "murmuring gloomblade|3": murmuringGloomblade(),

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
        decisionPrompt(
          "Search for an aura with Runechant in its name?",
          "card.iar.sinspeaker.aura.search",
          { optionMessages: commonOptionMessages("no") },
        ),
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

  "sonata dystopia|3": sonataDystopia(),

  "runic reaving|1": runicDiscardAttack(),
  "runic reaving|2": runicDiscardAttack(),
  "runic reaving|3": runicDiscardAttack(),
  "runic disposition|1": runicDiscardAttack(),
  "runic disposition|2": runicDiscardAttack(),
  "runic disposition|3": runicDiscardAttack(),

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

  "countdown to extinction|1": countdownToExtinction(),
  "countdown to extinction|2": countdownToExtinction(),
  "countdown to extinction|3": countdownToExtinction(),

  "dimenxxional ferryman|3": {
    graveyardReplacement: "bottom-of-deck",
    onPlay(ctx) {
      const choices = ctx.player(ctx.seat).banish.filter((card) =>
        !card.faceDown && isBloodDebtAction(ctx, card)
      );
      if (choices.length > 0) {
        ctx.requestCardChoice(
          "iar-ferryman-target",
          decisionPrompt(
            "Choose an action card with blood debt",
            "card.iar.blooddebt.action.choose",
          ),
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
  "darkest hour|2": darkestHour(3),
  "darkest hour|3": darkestHour(2),

  "battle prep|1": battlePrep(3),
  "battle prep|2": battlePrep(2),
  "battle prep|3": battlePrep(1),

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
        decisionPrompt(
          "Choose a card to discard",
          "card.common.card.discard.choose",
        ),
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
        prompt: decisionPrompt("Destroy a Spectral Shield", "card.common.cost.spectralshield.destroy"),
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
          decisionPrompt(
            "Destroy a Ponder to draw a card and gain 1 action point?",
            "card.iar.rush.ponder.destroy",
            { optionMessages: commonOptionMessages("no") },
          ),
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
          decisionPrompt(
            "Turn an attacking hero's banished card face down",
            "card.iar.circlet.banished.facedown",
          ),
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

  "breach flesh|1": gateOnHit(),
  "breach flesh|2": gateOnHit(),
  "breach flesh|3": gateOnHit(),
  "corporeal chasm|1": gateOnHit(),
  "corporeal chasm|2": gateOnHit(),
  "corporeal chasm|3": gateOnHit(),

  "shadowrealm bloodhound|1": shadowrealmHandBanish("go-again"),
  "shadowrealm bloodhound|2": shadowrealmHandBanish("go-again"),
  "shadowrealm bloodhound|3": shadowrealmHandBanish("go-again"),
  "shadowrealm ripper|1": shadowrealmHandBanish("power"),
  "shadowrealm ripper|2": shadowrealmHandBanish("power"),
  "shadowrealm ripper|3": shadowrealmHandBanish("power"),
  "shadowrealm walker|1": shadowrealmHandBanish("gate"),
  "shadowrealm walker|2": shadowrealmHandBanish("gate"),
  "shadowrealm walker|3": shadowrealmHandBanish("gate"),

  "harbinger of destruction|1": bloodDebt({
    requiredHandCardsForAdditionalCost: 1,
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "iar-harbinger-banish",
          decisionPrompt(
            "Banish a card from your hand",
            "card.iar.hand.banish",
          ),
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
          decisionPrompt(
            "Banish a card from hand?",
            "card.iar.hand.banish.optional",
            { optionMessages: commonOptionMessages("no") },
          ),
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
            decisionPrompt(
              "Put a banished card into your graveyard",
              "card.iar.banished.graveyard.put",
            ),
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
          decisionPrompt(
            "Danse Macabre: pay 2 and tap this?",
            "card.iar.danse.pay",
            { optionMessages: commonOptionMessages("no") },
          ),
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

  "exorcism|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 3,
        onHitScriptHook: {
          hook: "iar-exorcism-hit",
          label: "turn all cards in the hit hero's banished zone face-down",
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "iar-exorcism-hit") return;
      for (const card of ctx.player(opponentSeat(ctx)).banish) {
        if (!card.faceDown) ctx.setCardFaceDown(card.instanceId, true);
      }
    },
  },

  "bravery of the blade|1": {
    additionalCost(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "iar-bravery-charge",
        decisionPrompt(
          "Charge your hero's soul?",
          "card.dtd.charge.soul.optional",
          { optionMessages: commonOptionMessages("no") },
        ),
        ["no", ...hand.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "iar-bravery-charge" && option !== "no") ctx.charge(Number(option));
    },
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "chargedThisTurn") === true) ctx.grantGoAgain();
    },
    canTriggerOnHit: (ctx) =>
      selfHitsHero(ctx) && ctx.getFlag("player", "chargedThisTurn") === true,
    onHit(ctx) {
      ctx.createToken(COURAGE);
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

  "channel stormgarden|2": {
    onEnterArena(ctx) {
      ctx.createToken(LIGHTNING_FLOW);
    },
    onFriendlyDestroyed(ctx, destroyed, destroyingSeat) {
      if (
        destroyingSeat !== ctx.seat ||
        !named(ctx, destroyed, "Lightning Flow") ||
        Number(ctx.getFlag("player", "destroyedNameCount:lightning flow")) !== 1
      ) return;
      ampNextArcane(ctx, 1);
    },
    triggers: [{
      event: "end-of-turn",
      label: "Channel Lightning",
      labelMessage: { id: "card.trigger.common.channel.lightning" },
      effect(ctx) {
        const flow = ctx.getCounter("flow") + 1;
        ctx.setCounter("flow", flow);
        ctx.setCounter("iarStormgardenRemaining", flow);
        maintainChannelStormgarden(ctx);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "iar-stormgarden-bottom") return;
      if (ctx.putOnDeckBottom(Number(option))) {
        ctx.setCounter(
          "iarStormgardenRemaining",
          ctx.getCounter("iarStormgardenRemaining") - 1,
        );
        maintainChannelStormgarden(ctx);
      }
    },
  },

  "blessing of suraya|2": {
    onCardPutIntoSoul(ctx) {
      ctx.createToken(PONDER);
    },
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Put Blessing of Suraya into soul",
      labelMessage: { id: "card.trigger.common.self.soul.put" },
      effect(ctx) {
        ctx.putIntoSoul(ctx.self.instanceId);
      },
    }],
  },

  "ice aged oak|3": {
    onPlayCostPaid(ctx, paid) {
      if (paidWithType(ctx, paid, "ice")) ctx.setCounter("iarIceBond", 1);
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("iarIceBond") > 0) {
        ctx.addModifier({ scope: "chain-link", dominate: true });
      }
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
            decisionPrompt(
              "Choose an action card with blood debt",
              "card.iar.blooddebt.action.choose",
            ),
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
