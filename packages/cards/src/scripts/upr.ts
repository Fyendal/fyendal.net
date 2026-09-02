import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  dealArcane,
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
  payForDefenseBoost,
  wizardActionAsInstant,
  yesNoPrompt,
} from "./shared-helpers.js";
import { uprHighRarity } from "./upr/high-rarity.js";

// Uprising commons, rares, and young heroes. Invocation back faces use a
// synthetic `B` registry id linked from the playable front by CardData.backId.
const ASH = "UPR043";
const AETHER_ASHWING = "UPR042";
const FROSTBITE = "SIY035";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasSubtype(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, subtype: string): boolean {
  return ctx.cardTypes(card).includes(subtype.toLowerCase());
}

function isNamed(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return data(ctx, card).name === name;
}

function ashCards(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).board.filter((card) => isNamed(ctx, card, "Ash"));
}

function phoenixFlames(ctx: ScriptCtx, zone: "hand" | "graveyard" = "graveyard") {
  return ctx.player(ctx.seat)[zone].filter((card) => isNamed(ctx, card, "Phoenix Flame"));
}

function draconicLinks(ctx: ScriptCtx): number {
  return ctx.chainLinksControlled(ctx.seat, "draconic");
}

function playedAnotherRed(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "playedPitch:1")) >= 2;
}

function livingTargets(ctx: ScriptCtx): number[] {
  return [
    ...ctx.state.players.map((player) => player.hero.instanceId),
    ...ctx.state.players.flatMap((player) =>
      player.board.filter((card) => hasSubtype(ctx, card, "ally") && card.life !== undefined)
        .map((card) => card.instanceId),
    ),
  ];
}

function chooseDamageTarget(ctx: ScriptCtx, hook: string, prompt: string, amount: number, arcane = true): void {
  ctx.requestCardChoice(hook, decisionPrompt(prompt, arcane ? "card.upr.arcane.target.choose" : "card.upr.damage.target.choose", {
    values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: arcane ? ctx.previewArcaneDamage(amount) : amount },
  }), livingTargets(ctx));
}

function heroChoicePrompt(fallback = "Choose a hero") {
  return decisionPrompt(fallback, "card.upr.hero.choose", { optionMessages: {
    opponent: decisionMessage("common.option.opponent"),
    you: decisionMessage("card.upr.option.you"),
  } });
}

function arcaneHeroChoicePrompt(ctx: ScriptCtx, amount: number) {
  return decisionPrompt(`Choose a hero for ${ctx.previewArcaneDamage(amount)} arcane damage`, "card.upr.arcane.hero.choose", {
    values: { amount: ctx.previewArcaneDamage(amount) },
    optionMessages: {
      opponent: decisionMessage("common.option.opponent"),
      you: decisionMessage("card.upr.option.you"),
    },
  });
}

function dealToTarget(ctx: ScriptCtx, option: string, amount: number, arcane = false): number {
  const id = Number(option);
  const hero = ctx.state.players.find((player) => player.hero.instanceId === id);
  if (hero) return arcane ? dealArcane(ctx, hero.seat, amount) : ctx.dealDamage(hero.seat, amount);
  const owner = ctx.state.players.find((player) =>
    player.board.some((card) => card.instanceId === id),
  );
  if (!owner) return 0;
  return arcane
    ? dealArcane(ctx, owner.seat, amount, id)
    : ctx.dealDamage(owner.seat, amount, { targetAllyId: id });
}

function createFrostbites(ctx: ScriptCtx, seat: number, count: number): void {
  ctx.createTokens(FROSTBITE, count, seat);
}

function freeze(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): void {
  const expiry = ctx.state.turn + (ctx.state.activePlayer === ctx.seat ? 2 : 1);
  const current = Number(card.counters?.frozenUntilTurn ?? 0);
  ctx.addCounter(card.instanceId, "frozenUntilTurn", Math.max(0, expiry - current));
  if (ctx.player(card.owner).arsenal.some((candidate) => candidate.instanceId === card.instanceId)) {
    ctx.logPublic(localizedCardLog(ctx, `${ctx.data.name}: a card in the target hero's arsenal is frozen`, "card.log.upr.frozen.arsenal", { target: { kind: "player", seat: card.owner } }));
  } else {
    ctx.logPublic(localizedCardLog(ctx, `${ctx.cardData(card.cardId).name} is frozen`, "card.log.upr.frozen.card", { target: { kind: "card", cardId: card.cardId } }));
  }
}

function frozen(card: DeepReadonly<CardInstance>, turn: number): boolean {
  return Number(card.counters?.frozenUntilTurn ?? 0) > turn;
}

function transformAsh(
  ctx: ScriptCtx,
  ashId: number,
  backId: string,
  power = 0,
  existingPermanentInstanceId?: number,
): DeepReadonly<CardInstance> | undefined {
  const ash = ashCards(ctx).find((card) => card.instanceId === ashId);
  if (!ash) return undefined;
  const permanent = ctx.transformInto(backId, [ash.instanceId], existingPermanentInstanceId);
  if (!permanent) return undefined;
  if (power !== 0) ctx.addCardTempPower(permanent.instanceId, power);
  return permanent;
}

function requestAsh(
  ctx: ScriptCtx,
  hook: string,
  prompt: string,
  optional = false,
): boolean {
  const ash = ashCards(ctx);
  if (ash.length === 0) return false;
  ctx.requestCardChoice(hook, decisionPrompt(prompt, "card.upr.ash.transform.named", {
    values: { card: { kind: "card", cardId: ctx.self.cardId } },
    ...(optional ? { optionMessages: commonOptionMessages("pass") } : {}),
  }), [
    ...(optional ? ["pass"] : []),
    ...ash.map((card) => card.instanceId),
  ]);
  return true;
}

function invocation(backId: string): CardScript {
  return {
    canPlay: (ctx) => ashCards(ctx).length > 0,
    onPlay(ctx) {
      if (!requestAsh(ctx, "invoke", `${ctx.data.name}: choose an Ash to transform`)) {
        ctx.transformInto(backId, [], ctx.self.instanceId);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "invoke") transformAsh(ctx, Number(option), backId, 0, ctx.self.instanceId);
    },
  };
}

function dragonAttack() {
  return attackAbility(0, {
    canActivate(ctx) {
      return ctx.player(ctx.seat).weapons.some((weapon) =>
        ctx.cardData(weapon.cardId).name === "Storm of Sandikai");
    },
  });
}

function fusionAdditionalCost(ctx: ScriptCtx): void {
  const ice = ctx.player(ctx.seat).hand.filter((card) => hasSubtype(ctx, card, "ice"));
  if (ice.length === 0) return;
  ctx.requestCardChoice(
    "ice-fusion",
    decisionPrompt(`${ctx.data.name}: reveal an Ice card from your hand to fuse?`, "card.upr.ice.fusion.reveal.named", {
      values: { card: { kind: "card", cardId: ctx.self.cardId } },
      optionMessages: commonOptionMessages("no"),
    }),
    [...ice.map((card) => card.instanceId), "no"],
  );
}

function consumeIsenhowl(ctx: ScriptCtx): void {
  for (const target of [0, 1]) {
    const key = `nextIceFusionFrostbites:${target}`;
    const count = Number(ctx.getPlayerFlag(ctx.seat, key));
    if (count > 0) createFrostbites(ctx, target, count);
    ctx.setPlayerFlag(ctx.seat, key, 0);
  }
}

function handleFusion(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "ice-fusion") return false;
  if (option === "no") return true;
  const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
  if (!card) return true;
  ctx.setCounter("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  ctx.setFlag("player", "iceFusedThisTurn", true);
  consumeIsenhowl(ctx);
  ctx.logPublic(localizedCardLog(
    ctx,
    `${ctx.data.name} is fused (reveals ${ctx.cardData(card.cardId).name})`,
    "card.log.common.fusion.revealed",
    { revealed: { kind: "card", cardId: card.cardId } },
    { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
  ));
  return true;
}

function fused(ctx: ScriptCtx): boolean {
  return ctx.getCounter("fused") > 0;
}

function arcaneSpell(amount: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      chooseDamageTarget(ctx, "arcane", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to any target`, amount);
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane") dealToTarget(ctx, option, amount, true);
    },
  };
}

function fusedArcane(
  amount: number,
  afterDamage?: (ctx: ScriptCtx, target: number, dealt: number) => void,
): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      chooseDamageTarget(ctx, "fused-arcane", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to any target`, amount);
    },
    onDamageDealt(ctx, target, dealt, arcane) {
      if (arcane) afterDamage?.(ctx, target, dealt);
    },
    onChoose(ctx, hook, option) {
      if (handleFusion(ctx, hook, option)) return;
      if (hook !== "fused-arcane") return;
      const id = Number(option);
      ctx.setCounter("target", id);
      ctx.setCounter(
        "targetedAlly",
        ctx.state.players.some((player) => player.board.some((card) => card.instanceId === id)) ? 1 : 0,
      );
      dealToTarget(ctx, option, amount, true);
    },
  };
}

function conditionalDraconicGoAgain(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (draconicLinks(ctx) >= 2) ctx.grantGoAgain();
    },
  };
}

function returnFlameChoice(
  ctx: ScriptCtx,
  hook: string,
  prompt: string,
  messageId = "card.upr.phoenixflame.return",
): void {
  const flames = phoenixFlames(ctx);
  if (flames.length > 0) {
    ctx.requestCardChoice(hook, decisionPrompt(prompt, messageId, {
      values: { card: { kind: "card", cardId: ctx.self.cardId } },
      optionMessages: commonOptionMessages("pass"),
    }), ["pass", ...flames.map((card) => card.instanceId)]);
  }
}

function resolveFlameReturn(ctx: ScriptCtx, option: string): boolean {
  if (option === "pass") return false;
  const flame = phoenixFlames(ctx).find((card) => card.instanceId === Number(option));
  return flame ? ctx.moveToHand(flame.instanceId) : false;
}

function banishAttackOnHit(
  hook: string,
  reward: "power" | "discount" | "go-again",
): CardScript {
  return {
    onHit(ctx) {
      const count = draconicLinks(ctx);
      const choices = ctx.player(ctx.seat).hand.filter((card) => {
        const cardData = data(ctx, card);
        return ctx.hasCardType(card, "action") &&
          hasSubtype(ctx, card, "attack") &&
          (cardData.cost ?? 0) < count;
      });
      if (choices.length > 0) {
        ctx.requestCardChoice(hook, decisionPrompt(`${ctx.data.name}: banish an eligible attack?`, "card.upr.attack.banish", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
          optionMessages: commonOptionMessages("pass"),
        }), [
          "pass",
          ...choices.map((card) => card.instanceId),
        ]);
      }
    },
    onChoose(ctx, chosenHook, option) {
      if (chosenHook !== hook || option === "pass") return;
      const id = Number(option);
      if (!ctx.banish(id)) return;
      if (reward === "power") ctx.addCounter(id, "power", 1);
      if (reward === "go-again") ctx.grantCardKeyword(id, "go again");
      ctx.allowPlayFrom(id, "banish", reward === "discount" ? { costReduction: 1 } : undefined);
    },
  };
}

function defensePay(): CardScript {
  return { defendCost: 1, ...payForDefenseBoost(1, 2) };
}

function fightingSpirit(): CardScript {
  const gain = (ctx: ScriptCtx) => {
    if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.gainLife(ctx.seat, 1);
  };
  return { onAttackDeclared: gain, onDefend: gain };
}

function oasis(amount: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.requestCardChoice(
        "oasis-hero",
        decisionPrompt(`${ctx.data.name}: choose a hero`, "card.upr.hero.choose.named", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
        ctx.state.players.map((player) => player.hero.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "oasis-hero") {
        const target = ctx.state.players.find((player) => player.hero.instanceId === Number(option));
        if (!target) return;
        ctx.setCounter("oasisTarget", target.seat);
        ctx.requestCardChoice("oasis-source", decisionPrompt("Choose a damage source", "card.upr.damage.source.choose"), livingTargets(ctx));
        return;
      }
      if (hook === "oasis-source") {
        const target = ctx.getCounter("oasisTarget");
        ctx.preventNextDamage(target, amount, Number(option));
        if (ctx.compareLife(target, target === 0 ? 1 : 0) < 0) {
          ctx.requestChoice("oasis-life", yesNoPrompt("Gain 1 life?", "card.upr.life.gain"), ["yes", "no"], target);
        }
        return;
      }
      if (hook === "oasis-life" && option === "yes") ctx.gainLife(ctx.getCounter("oasisTarget"), 1);
    },
  };
}

function quelling(): CardScript {
  return { quell: { amount: 1, cost: 1 } };
}

function nekriaDamageTrigger(ctx: ScriptCtx): void {
  ctx.setCounter("lifePenalty", ctx.getCounter("lifePenalty") + 1);
  ctx.setPermanentLife(ctx.self.instanceId, (ctx.self.life ?? 0) - 1);
  ctx.createToken(ASH);
}

function readRipples(times: number): CardScript {
  const next = (ctx: ScriptCtx) => {
    const remaining = ctx.getCounter("remainingOpts");
    if (remaining <= 0) {
      ctx.drawCards(ctx.seat, 1);
      return;
    }
    ctx.setCounter("remainingOpts", remaining - 1);
    optN(ctx, 1);
  };
  return {
    triggers: [{
      event: "end-of-turn",
      whose: "subject",
      label: "Destroy this, opt, then draw",
      effect(ctx) {
        ctx.destroySelf();
        ctx.setCounter("remainingOpts", times);
        next(ctx);
      },
    }],
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option, () => next(ctx));
    },
  };
}

function sift(max: number): CardScript {
  const offer = (ctx: ScriptCtx) => {
    const moved = ctx.getCounter("siftMoved");
    if (moved >= max || ctx.player(ctx.seat).hand.length === 0) {
      ctx.drawCards(ctx.seat, moved);
      return;
    }
    ctx.requestCardChoice("sift", decisionPrompt(`${ctx.data.name}: put up to ${max} cards on the bottom`, "card.upr.hand.bottom.upto", {
      values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: max },
      optionMessages: commonOptionMessages("done"),
    }), [
      "done",
      ...ctx.player(ctx.seat).hand.map((card) => card.instanceId),
    ]);
  };
  return {
    onPlay(ctx) {
      ctx.setCounter("siftMoved", 0);
      offer(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "sift") return;
      if (option === "done") {
        ctx.drawCards(ctx.seat, ctx.getCounter("siftMoved"));
        return;
      }
      if (!ctx.putOnDeckBottom(Number(option))) return;
      ctx.setCounter("siftMoved", ctx.getCounter("siftMoved") + 1);
      offer(ctx);
    },
  };
}

function strategicPlanning(maxCost: number): CardScript {
  return {
    onPlay(ctx) {
      const choices = ctx.state.players.flatMap((player) => player.graveyard).filter((card) => {
        const cardData = data(ctx, card);
        return ctx.hasCardType(card, "action") && (cardData.cost ?? 0) <= maxCost;
      });
      if (choices.length > 0) {
        ctx.requestCardChoice("strategic", decisionPrompt(`${ctx.data.name}: put an action on the bottom`, "card.upr.action.bottom", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }), choices.map((card) => card.instanceId));
      }
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onChoose(ctx, hook, option) {
      if (hook === "strategic") ctx.putOnDeckBottom(Number(option));
    },
    triggers: [{
      event: "end-of-turn",
      whose: "subject",
      label: "Draw a card",
      effect(ctx) {
        ctx.drawCards(ctx.seat, 1);
        const marker = ctx.state.modifiers.find((modifier) =>
          modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn" && !modifier.consumed,
        );
        if (marker) ctx.consumeModifier(marker.id);
      },
    }],
  };
}

function sigilProtection(): CardScript {
  return {
    triggers: [{
      event: "begin-action-phase",
      whose: "subject",
      label: "Destroy Sigil of Protection",
      effect(ctx) { ctx.destroySelf(); },
    }],
  };
}

function singe(maxAllyTargets: number): CardScript {
  const offerAlly = (ctx: ScriptCtx, another = false): void => {
    const target = ctx.getCounter("singeTarget");
    const allies = ctx.player(target).board.filter((card) => hasSubtype(ctx, card, "ally"));
    if (!allies.length) return;
    ctx.requestCardChoice(
      "singe-ally",
      decisionPrompt(
        another
          ? `Deal ${ctx.previewArcaneDamage(1)} arcane damage to another ally?`
          : `Deal ${ctx.previewArcaneDamage(1)} arcane damage to an ally?`,
        another ? "card.upr.arcane.ally.next" : "card.upr.arcane.ally.choose",
        { values: { amount: ctx.previewArcaneDamage(1) }, optionMessages: commonOptionMessages("done") },
      ),
      ["done", ...allies.map((card) => card.instanceId)],
    );
  };
  return {
    ...arcaneSpell(1),
    onPlay(ctx) {
      ctx.requestChoice("singe-hero", arcaneHeroChoicePrompt(ctx, 1), ["opponent", "you"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "singe-hero") {
        const target = option === "you" ? ctx.seat : opponentSeat(ctx);
        ctx.setCounter("singeTarget", target);
        ctx.setCounter("singeRemaining", maxAllyTargets);
        dealArcane(ctx, target, 1);
        offerAlly(ctx);
      } else if (hook === "singe-ally" && option !== "done") {
        dealArcane(ctx, ctx.getCounter("singeTarget"), 1, Number(option));
        const remaining = ctx.getCounter("singeRemaining") - 1;
        ctx.setCounter("singeRemaining", remaining);
        if (remaining > 0) offerAlly(ctx, true);
      }
    },
  };
}

function transmogrify(power: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        appliesTo: "attack-action",
        grantType: "illusionist",
        grantKeyword: "phantasm",
      });
      ctx.setPlayerFlag(ctx.seat, "transmogrifyPower", power);
      ctx.setPlayerFlag(ctx.seat, "transmogrifyPending", true);
      ctx.addModifier({ scope: "until-end-of-turn" });
    },
    onFriendlyAttackDeclared(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, "transmogrifyPending") !== true) return;
      if (ctx.link?.attackCardType !== "action") return;
      if (!hasSubtype(ctx, ctx.link.attackingCard, "attack")) return;
      const target = Number(ctx.getPlayerFlag(ctx.seat, "transmogrifyPower"));
      ctx.addModifier({ scope: "chain-link", attack: target - ctx.basePower(ctx.link.attackingCard) });
      ctx.setPlayerFlag(ctx.seat, "transmogrifyPending", false);
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn" && !modifier.consumed,
      );
      if (marker) ctx.consumeModifier(marker.id);
    },
  };
}

export const upr: Record<string, CardScript> = mergeSetScripts("UPR", uprHighRarity, {
  "ash|0": { materialKeywords: ["phantasm"] },
  // Storm's continuous grant is represented on each Dragon ally so the
  // engine can enumerate the granted attack through legalIntents.
  "storm of sandikai|0": {},

  // Hero
  "dromai|0": {
    replacePitchResources(ctx, pitched, amount) {
      if (ctx.cardColor(pitched) === 1) ctx.createToken(ASH);
      return amount;
    },
    onFriendlyAttackDeclared(ctx) {
      if (ctx.link && hasSubtype(ctx, ctx.link.attackingCard, "dragon") &&
        Number(ctx.getFlag("player", "playedPitch:1")) > 0) ctx.grantGoAgain();
    },
    onFriendlyPlay(ctx, played) {
      if (ctx.cardColor(played) !== 1 || !ctx.link) return;
      if (hasSubtype(ctx, ctx.link.attackingCard, "dragon")) ctx.grantGoAgain();
    },
  },

  // Dragon allies and invocations
  "invoke azvolai|1": invocation("UPR009B"),
  "invoke cromai|1": invocation("UPR010B"),
  "invoke kyloria|1": invocation("UPR011B"),
  "invoke miragai|1": invocation("UPR012B"),
  "invoke nekria|1": invocation("UPR013B"),
  "invoke ouvia|1": invocation("UPR014B"),
  "invoke themai|1": invocation("UPR015B"),
  "invoke vynserakai|1": invocation("UPR016B"),
  "invoke yendurai|1": invocation("UPR017B"),
  "azvolai|0": {
    activated: dragonAttack(),
    onAttackDeclared(ctx) {
      ctx.setCounter("azvolaiHits", 0);
      ctx.requestCardChoice("azvolai", decisionPrompt(`Azvolai: deal ${ctx.previewArcaneDamage(1)} arcane damage to up to 2 targets`, "card.upr.azvolai.targets", {
        values: { amount: ctx.previewArcaneDamage(1), count: 2 }, optionMessages: commonOptionMessages("done"),
      }), ["done", ...livingTargets(ctx)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "azvolai" || option === "done") return;
      dealToTarget(ctx, option, 1, true);
      const count = ctx.getCounter("azvolaiHits") + 1;
      ctx.setCounter("azvolaiHits", count);
      if (count < 2) ctx.requestCardChoice("azvolai", decisionPrompt(`Azvolai: deal ${ctx.previewArcaneDamage(1)} arcane damage to another target?`, "card.upr.azvolai.target.next", {
        values: { amount: ctx.previewArcaneDamage(1) }, optionMessages: commonOptionMessages("done"),
      }), ["done", ...livingTargets(ctx)]);
    },
  },
  "cromai|0": {
    activated: dragonAttack(),
    onAttackDeclared(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, `cromai:${ctx.self.instanceId}`) === true) return;
      ctx.setPlayerFlag(ctx.seat, `cromai:${ctx.self.instanceId}`, true);
      ctx.gainActionPoint();
    },
    onLeaveArena(ctx) {
      if (ctx.getPlayerFlag(ctx.seat, `cromai:${ctx.self.instanceId}`) === true) return;
      ctx.setPlayerFlag(ctx.seat, `cromai:${ctx.self.instanceId}`, true);
      ctx.gainActionPoint();
    },
  },
  "kyloria|0": {
    activated: dragonAttack(),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) => hasSubtype(ctx, card, "item"));
      if (items.length === 0) {
        ctx.drawCards(ctx.seat, 1);
        return;
      }
      ctx.requestCardChoice("kyloria", decisionPrompt("Kyloria: gain control of an item", "card.upr.kyloria.item.control"), items.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "kyloria") return;
      if (!ctx.steal(Number(option), { duration: "indefinite" })) ctx.drawCards(ctx.seat, 1);
    },
  },
  "miragai|0": {
    activated: dragonAttack(),
    onFriendlyAttackDeclared(ctx) {
      if (!ctx.link || !hasSubtype(ctx, ctx.link.attackingCard, "dragon")) return;
      if (ctx.getPlayerFlag(ctx.seat, "dragonAttackedThisTurn") === true) return;
      ctx.setPlayerFlag(ctx.seat, "dragonAttackedThisTurn", true);
      ctx.suppressCardKeyword(ctx.link.attackingCard.instanceId, "phantasm");
    },
  },
  "nekria|0": {
    activated: dragonAttack(),
    onDealsDamage: nekriaDamageTrigger,
    onDealtDamage: nekriaDamageTrigger,
  },
  "ouvia|0": {
    activated: dragonAttack(),
    onEnterArena(ctx) { requestAsh(ctx, "ouvia", "Ouvia: transform an Ash?", true); },
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: "Transform up to one Ash",
      effect(ctx) { requestAsh(ctx, "ouvia", "Ouvia: transform an Ash?", true); },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "ouvia" && option !== "pass") transformAsh(ctx, Number(option), AETHER_ASHWING);
    },
  },
  "themai|0": {
    activated: dragonAttack(),
    opponentsCannotPlayOrActivateOnYourTurn: true,
  },
  "vynserakai|0": {
    activated: dragonAttack(),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      dealArcane(ctx, opponentSeat(ctx), 3);
    },
  },
  "yendurai|0": {
    activated: dragonAttack(),
    onEnterArena(ctx) { ctx.setCounter("endurance", 1); },
    replaceDamageToSelf(ctx, amount) {
      if (ctx.getCounter("endurance") <= 0 && ctx.getCounter("enduranceSpent") > 0) return amount;
      ctx.addCounter(ctx.self.instanceId, "endurance", -1);
      ctx.setCounter("enduranceSpent", 1);
      return Math.max(0, amount - 3);
    },
  },

  // Draconic Illusionist
  "billowing mirage|1": { onAttackDeclared(ctx) { requestAsh(ctx, "billow", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "billow" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  "billowing mirage|2": { onAttackDeclared(ctx) { requestAsh(ctx, "billow", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "billow" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  "billowing mirage|3": { onAttackDeclared(ctx) { requestAsh(ctx, "billow", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "billow" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  "dunebreaker cenipai|1": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "dunebreaker cenipai|2": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "dunebreaker cenipai|3": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "embermaw cenipai|1": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "embermaw cenipai|2": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "embermaw cenipai|3": { onDestroyed(ctx) { ctx.createToken(ASH); } },
  "sweeping blow|1": { onAttackDeclared(ctx) { ctx.createToken(ASH); } },
  "sweeping blow|2": { onAttackDeclared(ctx) { ctx.createToken(ASH); } },
  "sweeping blow|3": { onAttackDeclared(ctx) { ctx.createToken(ASH); } },
  "dustup|1": { onHit(ctx) { ctx.createToken(ASH); requestAsh(ctx, "dustup", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "dustup" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  "dustup|2": { onHit(ctx) { ctx.createToken(ASH); requestAsh(ctx, "dustup", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "dustup" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  "dustup|3": { onHit(ctx) { ctx.createToken(ASH); requestAsh(ctx, "dustup", "Transform an Ash?", true); }, onChoose(ctx, h, o) { if (h === "dustup" && o !== "pass") transformAsh(ctx, Number(o), AETHER_ASHWING); } },
  ...(Object.fromEntries([1, 2, 3].map((pitch) => [`rake the embers|${pitch}`, {
    onPlay(ctx: ScriptCtx) {
      ctx.createToken(ASH);
      ctx.setCounter("rakeRemaining", 4 - pitch);
      requestAsh(ctx, "rake", "Transform an Ash?", true);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "rake" || option === "pass") return;
      transformAsh(ctx, Number(option), AETHER_ASHWING);
      const remaining = ctx.getCounter("rakeRemaining") - 1;
      ctx.setCounter("rakeRemaining", remaining);
      if (remaining > 0) requestAsh(ctx, "rake", "Transform another Ash?", true);
    },
  } satisfies CardScript])) as Record<string, CardScript>),
  "skittering sands|1": { onPlay(ctx) { requestAsh(ctx, "skitter", "Transform an Ash", false); }, onChoose(ctx, h, o) { if (h === "skitter") transformAsh(ctx, Number(o), AETHER_ASHWING, 3); } },
  "skittering sands|2": { onPlay(ctx) { requestAsh(ctx, "skitter", "Transform an Ash", false); }, onChoose(ctx, h, o) { if (h === "skitter") transformAsh(ctx, Number(o), AETHER_ASHWING, 2); } },
  "skittering sands|3": { onPlay(ctx) { requestAsh(ctx, "skitter", "Transform an Ash", false); }, onChoose(ctx, h, o) { if (h === "skitter") transformAsh(ctx, Number(o), AETHER_ASHWING, 1); } },
  "sand cover|1": { onPlay(ctx) { requestAsh(ctx, "sand", "Give an Ash ward 4"); }, onChoose(ctx, h, o) { if (h === "sand") ctx.grantCardKeyword(Number(o), "ward 4"); } },
  "sand cover|2": { onPlay(ctx) { requestAsh(ctx, "sand", "Give an Ash ward 3"); }, onChoose(ctx, h, o) { if (h === "sand") ctx.grantCardKeyword(Number(o), "ward 3"); } },
  "sand cover|3": { onPlay(ctx) { requestAsh(ctx, "sand", "Give an Ash ward 2"); }, onChoose(ctx, h, o) { if (h === "sand") ctx.grantCardKeyword(Number(o), "ward 2"); } },
  "silken form|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", label: "Destroy: transform an Ash", onActivate(ctx) { ctx.destroySelf(); requestAsh(ctx, "silken", "Transform an Ash"); } },
    quell: { amount: 1, cost: 1 },
    onChoose(ctx, h, o) { if (h === "silken") transformAsh(ctx, Number(o), AETHER_ASHWING); },
  },
  "heat wave|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", label: "Destroy: Phoenix Flames +1", onActivate(ctx) { ctx.destroySelf(); ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToName: "phoenix flame" }); } },
    quell: { amount: 1, cost: 1 },
  },

  // Draconic Ninja and generic attacks
  "cinderskin devotion|1": conditionalDraconicGoAgain(),
  "cinderskin devotion|2": conditionalDraconicGoAgain(),
  "lava vein loyalty|1": conditionalDraconicGoAgain(),
  "lava vein loyalty|2": conditionalDraconicGoAgain(),
  "lava vein loyalty|3": conditionalDraconicGoAgain(),
  "burn away|1": {
    additionalCost(ctx) { returnFlameChoice(ctx, "burn-away", "Banish a Phoenix Flame for +2 and go again?", "card.upr.phoenixflame.banish.goagain"); },
    onChoose(ctx, h, o) {
      if (h !== "burn-away" || o === "pass") return;
      if (!ctx.banish(Number(o))) return;
      ctx.addCardTempPower(ctx.self.instanceId, 2);
      ctx.grantCardKeyword(ctx.self.instanceId, "go again");
    },
  },
  "engulfing flamewave|1": { onHit(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && hasSubtype(ctx, top, "attack") && (data(ctx, top).cost ?? 0) < draconicLinks(ctx)) { ctx.banish(top.instanceId); ctx.allowPlayFrom(top.instanceId, "banish"); } } },
  "engulfing flamewave|2": { onHit(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && hasSubtype(ctx, top, "attack") && (data(ctx, top).cost ?? 0) < draconicLinks(ctx)) { ctx.banish(top.instanceId); ctx.allowPlayFrom(top.instanceId, "banish"); } } },
  "engulfing flamewave|3": { onHit(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && hasSubtype(ctx, top, "attack") && (data(ctx, top).cost ?? 0) < draconicLinks(ctx)) { ctx.banish(top.instanceId); ctx.allowPlayFrom(top.instanceId, "banish"); } } },
  "flameborn retribution|1": {
    canTriggerOnDefend: (ctx) => ctx.getPlayerFlag(ctx.seat, "damageTakenThisTurn") === true,
    onDefend(ctx) { if (ctx.getPlayerFlag(ctx.seat, "damageTakenThisTurn") === true) returnFlameChoice(ctx, "flameborn", "Return a Phoenix Flame?"); },
    onChoose(ctx, h, o) { if (h === "flameborn") resolveFlameReturn(ctx, o); },
  },
  "inflame|1": {
    onAttackDeclared(ctx) { if (playedAnotherRed(ctx)) returnFlameChoice(ctx, "inflame", "Return a Phoenix Flame?"); },
    onChoose(ctx, h, o) { if (h === "inflame") resolveFlameReturn(ctx, o); },
  },
  "mounting anger|2": banishAttackOnHit("mounting", "power"),
  "mounting anger|3": banishAttackOnHit("mounting", "power"),
  "rising resentment|2": banishAttackOnHit("resentment", "discount"),
  "rising resentment|3": banishAttackOnHit("resentment", "discount"),
  "soaring strike|1": banishAttackOnHit("soaring", "go-again"),
  "soaring strike|2": banishAttackOnHit("soaring", "go-again"),
  "soaring strike|3": banishAttackOnHit("soaring", "go-again"),
  "rise from the ashes|2": { onPlay(ctx) { buffNextAttack(ctx, { attack: 2, appliesTo: "attack-action", appliesToType: ["draconic", "ninja"] }); returnFlameChoice(ctx, "rise", "Return a Phoenix Flame?"); }, onChoose(ctx, h, o) { if (h === "rise") resolveFlameReturn(ctx, o); } },
  "rise from the ashes|3": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1, appliesTo: "attack-action", appliesToType: ["draconic", "ninja"] }); returnFlameChoice(ctx, "rise", "Return a Phoenix Flame?"); }, onChoose(ctx, h, o) { if (h === "rise") resolveFlameReturn(ctx, o); } },
  "breaking point|1": { canTriggerOnHit: (ctx) => ctx.currentChainLinkNumber() >= 4 && ctx.link?.targetAllyId === undefined, onHit(ctx) { for (const card of [...ctx.player(opponentSeat(ctx)).arsenal]) ctx.moveToGraveyard(card.instanceId, "arsenal"); } },
  "rise up|1": { modifyAttack(ctx) { if (ctx.currentChainLinkNumber() < 4) return 0; return ctx.state.chain.filter((link) => ctx.cardData(link.attackingCard.cardId).name === "Phoenix Flame").length * 2; }, onAttackDeclared(ctx) { if (ctx.currentChainLinkNumber() >= 4) ctx.addModifier({ scope: "chain-link", dominate: true }); } },
  "red hot|1": {
    onAttackDeclared(ctx) {
      if (ctx.currentChainLinkNumber() < 4) return;
      const shown = ctx.player(ctx.seat).deck.slice(0, draconicLinks(ctx));
      const red = shown.filter((card) => ctx.cardColor(card) === 1).length;
      ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name} reveals ${shown.map((card) => data(ctx, card).name).join(", ") || "no cards"}`,
        "card.log.upr.redhot.revealed",
        { count: shown.length, revealed: shown.map((card) => data(ctx, card).name).join(", ") || "no cards" },
        { kind: "cards-revealed", cards: shown.map((card) => ({ cardId: card.cardId, ownerSeat: ctx.seat })), sourceZone: "deck" },
      ));
      ctx.setCounter("redHotDamage", red);
      if (red > 0) chooseDamageTarget(ctx, "red-hot", `Deal ${red} damage to any target`, red, false);
      else ctx.shuffleDeck();
    },
    onChoose(ctx, h, o) { if (h === "red-hot") { dealToTarget(ctx, o, ctx.getCounter("redHotDamage")); ctx.shuffleDeck(); } },
  },
  "searing touch|1": { onAttackDeclared(ctx) { if (ctx.currentChainLinkNumber() >= 4) chooseDamageTarget(ctx, "searing", "Deal 2 damage to any target", 2, false); }, onChoose(ctx, h, o) { if (h === "searing") dealToTarget(ctx, o, 2); } },
  "stoke the flames|1": { onHit(ctx) { returnFlameChoice(ctx, "stoke", "Return a Phoenix Flame and gain go again?", "card.upr.phoenixflame.return.goagain"); }, onChoose(ctx, h, o) { if (h === "stoke" && resolveFlameReturn(ctx, o)) ctx.grantGoAgain(); } },

  // Ice / Wizard
  "aether dart|1": arcaneSpell(3), "aether dart|2": arcaneSpell(2), "aether dart|3": arcaneSpell(1),
  "aether hail|1": arcaneSpell(4), "aether hail|2": arcaneSpell(3),
  "frosting|1": arcaneSpell(3), "frosting|2": arcaneSpell(2),
  "ice bolt|2": arcaneSpell(4),
  "arctic incarceration|1": { playAsInstant: wizardActionAsInstant, onPlay(ctx) { ctx.requestChoice("arctic", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "arctic") createFrostbites(ctx, o === "you" ? ctx.seat : opponentSeat(ctx), 3); } },
  "arctic incarceration|2": { playAsInstant: wizardActionAsInstant, onPlay(ctx) { ctx.requestChoice("arctic", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "arctic") createFrostbites(ctx, o === "you" ? ctx.seat : opponentSeat(ctx), 2); } },
  "arctic incarceration|3": { playAsInstant: wizardActionAsInstant, onPlay(ctx) { ctx.requestChoice("arctic", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "arctic") createFrostbites(ctx, o === "you" ? ctx.seat : opponentSeat(ctx), 1); } },
  "brain freeze|1": {
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      const revealedIds = hand.map((card) => card.instanceId);
      if (!ctx.revealCards(revealedIds, opponentSeat(ctx))) return;
      const choices = fused(ctx)
        ? hand.filter((card) => ctx.hasCardType(card, "action") && (data(ctx, card).cost ?? 0) <= 2)
        : [];
      ctx.requestCardChoice(
        "brain",
        decisionPrompt(choices.length ? "Put a revealed action on top" : "No revealed action can be put on top", choices.length ? "card.upr.revealed.action.top" : "card.upr.revealed.action.none", { optionMessages: { Close: decisionMessage("common.option.close") } }),
        choices.length ? choices.map((card) => card.instanceId) : ["Close"],
        undefined,
        revealedIds,
      );
    },
    onChoose(ctx, h, o) {
      if (handleFusion(ctx, h, o)) return;
      if (h === "brain" && o !== "Close") ctx.putOnDeckTop(Number(o));
    },
  },
  "brain freeze|2": {
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      const revealedIds = hand.map((card) => card.instanceId);
      if (!ctx.revealCards(revealedIds, opponentSeat(ctx))) return;
      const choices = fused(ctx)
        ? hand.filter((card) => ctx.hasCardType(card, "action") && (data(ctx, card).cost ?? 0) <= 1)
        : [];
      ctx.requestCardChoice(
        "brain",
        decisionPrompt(choices.length ? "Put a revealed action on top" : "No revealed action can be put on top", choices.length ? "card.upr.revealed.action.top" : "card.upr.revealed.action.none", { optionMessages: { Close: decisionMessage("common.option.close") } }),
        choices.length ? choices.map((card) => card.instanceId) : ["Close"],
        undefined,
        revealedIds,
      );
    },
    onChoose(ctx, h, o) {
      if (handleFusion(ctx, h, o)) return;
      if (h === "brain" && o !== "Close") ctx.putOnDeckTop(Number(o));
    },
  },
  "dampen|1": { ...arcaneSpell(4), onDamageDealt(ctx, _target, amount, arcane) { if (arcane && amount > 0) ctx.preventNextArcaneDamage(ctx.seat, amount); } },
  "dampen|2": { ...arcaneSpell(3), onDamageDealt(ctx, _target, amount, arcane) { if (arcane && amount > 0) ctx.preventNextArcaneDamage(ctx.seat, amount); } },
  "dampen|3": { ...arcaneSpell(2), onDamageDealt(ctx, _target, amount, arcane) { if (arcane && amount > 0) ctx.preventNextArcaneDamage(ctx.seat, amount); } },
  "icebind|1": fusedArcane(3, (ctx, target, dealt) => { if (fused(ctx) && dealt > 0 && ctx.getCounter("targetedAlly") === 0) { const card = ctx.player(target).arsenal[0]; if (card) freeze(ctx, card); } }),
  "icebind|2": fusedArcane(2, (ctx, target, dealt) => { if (fused(ctx) && dealt > 0 && ctx.getCounter("targetedAlly") === 0) { const card = ctx.player(target).arsenal[0]; if (card) freeze(ctx, card); } }),
  "icebind|3": fusedArcane(1, (ctx, target, dealt) => { if (fused(ctx) && dealt > 0 && ctx.getCounter("targetedAlly") === 0) { const card = ctx.player(target).arsenal[0]; if (card) freeze(ctx, card); } }),
  "polar cap|2": fusedArcane(3, (ctx, target, dealt) => { if (fused(ctx) && dealt > 0 && ctx.getCounter("targetedAlly") === 0) ctx.createToken(FROSTBITE, target); }),
  "polar cap|3": fusedArcane(2, (ctx, target, dealt) => { if (fused(ctx) && dealt > 0 && ctx.getCounter("targetedAlly") === 0) ctx.createToken(FROSTBITE, target); }),
  "succumb to winter|1": fusedArcane(5, (ctx, target) => { if (!fused(ctx)) return; if (ctx.getCounter("targetedAlly")) { const ally = ctx.state.players.flatMap((p) => p.board).find((card) => card.instanceId === ctx.getCounter("target")); if (ally && frozen(ally, ctx.state.turn)) ctx.destroyPermanent(ally.instanceId); } else { const card = ctx.player(target).arsenal.find((candidate) => frozen(candidate, ctx.state.turn)); if (card) ctx.moveToGraveyard(card.instanceId, "arsenal"); } }),
  "succumb to winter|2": fusedArcane(4, (ctx, target) => { if (!fused(ctx)) return; if (ctx.getCounter("targetedAlly")) { const ally = ctx.state.players.flatMap((p) => p.board).find((card) => card.instanceId === ctx.getCounter("target")); if (ally && frozen(ally, ctx.state.turn)) ctx.destroyPermanent(ally.instanceId); } else { const card = ctx.player(target).arsenal.find((candidate) => frozen(candidate, ctx.state.turn)); if (card) ctx.moveToGraveyard(card.instanceId, "arsenal"); } }),
  "succumb to winter|3": fusedArcane(3, (ctx, target) => { if (!fused(ctx)) return; if (ctx.getCounter("targetedAlly")) { const ally = ctx.state.players.flatMap((p) => p.board).find((card) => card.instanceId === ctx.getCounter("target")); if (ally && frozen(ally, ctx.state.turn)) ctx.destroyPermanent(ally.instanceId); } else { const card = ctx.player(target).arsenal.find((candidate) => frozen(candidate, ctx.state.turn)); if (card) ctx.moveToGraveyard(card.instanceId, "arsenal"); } }),
  "isenhowl weathervane|1": { onPlay(ctx) { ctx.requestChoice("isenhowl", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "isenhowl") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); const key = `nextIceFusionFrostbites:${target}`; ctx.setPlayerFlag(ctx.seat, key, Number(ctx.getPlayerFlag(ctx.seat, key)) + 4); } } },
  "isenhowl weathervane|2": { onPlay(ctx) { ctx.requestChoice("isenhowl", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "isenhowl") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); const key = `nextIceFusionFrostbites:${target}`; ctx.setPlayerFlag(ctx.seat, key, Number(ctx.getPlayerFlag(ctx.seat, key)) + 3); } } },
  "isenhowl weathervane|3": { onPlay(ctx) { ctx.requestChoice("isenhowl", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "isenhowl") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); const key = `nextIceFusionFrostbites:${target}`; ctx.setPlayerFlag(ctx.seat, key, Number(ctx.getPlayerFlag(ctx.seat, key)) + 2); } } },
  "cold snap|1": { playAsInstant: wizardActionAsInstant, onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); ctx.requestChoice("cold-target", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "cold-target") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); ctx.setCounter("coldTarget", target); if (!ctx.requestPayment("cold-pay", decisionPrompt("Pay 3 to avoid freezing?", "card.upr.freeze.avoid.pay", { values: { amount: 3 } }), 3, target)) { const choices = [...ctx.player(target).arsenal, ...ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally"))]; if (choices.length) ctx.requestCardChoice("cold-freeze", decisionPrompt("Choose a card to freeze", "card.upr.freeze.card.choose"), choices.map((c) => c.instanceId)); } } else if (h === "cold-pay" && o !== "paid") { const target = ctx.getCounter("coldTarget"); const choices = [...ctx.player(target).arsenal, ...ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally"))]; if (choices.length) ctx.requestCardChoice("cold-freeze", decisionPrompt("Choose a card to freeze", "card.upr.freeze.card.choose"), choices.map((c) => c.instanceId)); } else if (h === "cold-freeze") { const card = [...ctx.player(ctx.getCounter("coldTarget")).arsenal, ...ctx.player(ctx.getCounter("coldTarget")).board].find((c) => c.instanceId === Number(o)); if (card) freeze(ctx, card); } } },
  "cold snap|2": { playAsInstant: wizardActionAsInstant, onPlay(ctx) { if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1); ctx.requestChoice("cold-target", heroChoicePrompt(), ["opponent", "you"]); }, onChoose(ctx, h, o) { if (h === "cold-target") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); ctx.setCounter("coldTarget", target); if (!ctx.requestPayment("cold-pay", decisionPrompt("Pay 2 to avoid freezing?", "card.upr.freeze.avoid.pay", { values: { amount: 2 } }), 2, target)) { const choices = [...ctx.player(target).arsenal, ...ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally"))]; if (choices.length) ctx.requestCardChoice("cold-freeze", decisionPrompt("Choose a card to freeze", "card.upr.freeze.card.choose"), choices.map((c) => c.instanceId)); } } else if (h === "cold-pay" && o !== "paid") { const target = ctx.getCounter("coldTarget"); const choices = [...ctx.player(target).arsenal, ...ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally"))]; if (choices.length) ctx.requestCardChoice("cold-freeze", decisionPrompt("Choose a card to freeze", "card.upr.freeze.card.choose"), choices.map((c) => c.instanceId)); } else if (h === "cold-freeze") { const card = [...ctx.player(ctx.getCounter("coldTarget")).arsenal, ...ctx.player(ctx.getCounter("coldTarget")).board].find((c) => c.instanceId === Number(o)); if (card) freeze(ctx, card); } } },
  "sigil of permafrost|1": { additionalCost: fusionAdditionalCost, onPlay(ctx) { if (fused(ctx)) { ctx.setCounter("sigilFrost", 1); ctx.addModifier({ scope: "until-end-of-turn" }); } }, onFriendlyDamageDealt(ctx, _source, target, amount, arcane) { if (!arcane || amount <= 0 || !ctx.getCounter("sigilFrost")) return; createFrostbites(ctx, target, amount); ctx.setCounter("sigilFrost", 0); const marker = ctx.state.modifiers.find((m) => m.sourceInstanceId === ctx.self.instanceId && !m.consumed); if (marker) ctx.consumeModifier(marker.id); }, onChoose(ctx, h, o) { handleFusion(ctx, h, o); } },
  "sigil of permafrost|2": { additionalCost: fusionAdditionalCost, onPlay(ctx) { if (fused(ctx)) { ctx.setCounter("sigilFrost", 1); ctx.addModifier({ scope: "until-end-of-turn" }); } }, onFriendlyDamageDealt(ctx, _source, target, amount, arcane) { if (!arcane || amount <= 0 || !ctx.getCounter("sigilFrost")) return; createFrostbites(ctx, target, amount); ctx.setCounter("sigilFrost", 0); const marker = ctx.state.modifiers.find((m) => m.sourceInstanceId === ctx.self.instanceId && !m.consumed); if (marker) ctx.consumeModifier(marker.id); }, onChoose(ctx, h, o) { handleFusion(ctx, h, o); } },
  "sigil of permafrost|3": { additionalCost: fusionAdditionalCost, onPlay(ctx) { if (fused(ctx)) { ctx.setCounter("sigilFrost", 1); ctx.addModifier({ scope: "until-end-of-turn" }); } }, onFriendlyDamageDealt(ctx, _source, target, amount, arcane) { if (!arcane || amount <= 0 || !ctx.getCounter("sigilFrost")) return; createFrostbites(ctx, target, amount); ctx.setCounter("sigilFrost", 0); const marker = ctx.state.modifiers.find((m) => m.sourceInstanceId === ctx.self.instanceId && !m.consumed); if (marker) ctx.consumeModifier(marker.id); }, onChoose(ctx, h, o) { handleFusion(ctx, h, o); } },
  "conduit of frostburn|0": {
    activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", label: "Destroy: empower next arcane card", onActivate(ctx) { ctx.setCounter("conduitReady", 1); ctx.addModifier({ scope: "until-end-of-turn" }); ctx.destroySelf(); } },
    quell: { amount: 1, cost: 1 },
    onFriendlyPlay(ctx, played) { if (!ctx.getCounter("conduitReady") || !ctx.cardData(played.cardId).text.toLowerCase().includes("arcane damage")) return; ctx.setCounter("conduitSource", played.instanceId); ctx.setCounter("conduitReady", 0); },
    onFriendlyDamageDealt(ctx, source, target, amount, arcane) { if (!arcane || amount <= 0 || source.instanceId !== ctx.getCounter("conduitSource")) return; const card = ctx.player(target).arsenal.find((candidate) => frozen(candidate, ctx.state.turn)); if (card) ctx.moveToGraveyard(card.instanceId, "arsenal"); const marker = ctx.state.modifiers.find((m) => m.sourceInstanceId === ctx.self.instanceId && !m.consumed); if (marker) ctx.consumeModifier(marker.id); },
  },
  "glacial horns|0": { activated: { cost: 0, isAttack: false, goAgain: true, label: "Destroy: freeze arsenal and ally", onActivate(ctx) { ctx.destroySelf(); ctx.requestChoice("horns-target", heroChoicePrompt(), ["opponent", "you"]); } }, onChoose(ctx, h, o) { if (h === "horns-target") { const target = o === "you" ? ctx.seat : opponentSeat(ctx); ctx.setCounter("hornsTarget", target); if (ctx.player(target).arsenal[0]) ctx.requestChoice("horns-arsenal", yesNoPrompt("Freeze their arsenal card?", "card.upr.freeze.arsenal"), ["yes", "no"]); else { const allies = ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally")); if (allies.length) ctx.requestCardChoice("horns-ally", decisionPrompt("Freeze an ally?", "card.upr.freeze.ally", { optionMessages: commonOptionMessages("pass") }), ["pass", ...allies.map((c) => c.instanceId)]); } } else if (h === "horns-arsenal") { const target = ctx.getCounter("hornsTarget"); const arsenalCard = ctx.player(target).arsenal[0]; if (o === "yes" && arsenalCard) freeze(ctx, arsenalCard); const allies = ctx.player(target).board.filter((c) => hasSubtype(ctx, c, "ally")); if (allies.length) ctx.requestCardChoice("horns-ally", decisionPrompt("Freeze an ally?", "card.upr.freeze.ally", { optionMessages: commonOptionMessages("pass") }), ["pass", ...allies.map((c) => c.instanceId)]); } else if (h === "horns-ally" && o !== "pass") { const card = ctx.player(ctx.getCounter("hornsTarget")).board.find((c) => c.instanceId === Number(o)); if (card) freeze(ctx, card); } } },

  // Generic
  "brothers in arms|1": defensePay(), "brothers in arms|2": defensePay(),
  "fyendal's fighting spirit|2": fightingSpirit(), "fyendal's fighting spirit|3": fightingSpirit(),
  "healing balm|1": { onPlay(ctx) { ctx.gainLife(ctx.seat, 3); } },
  "healing balm|2": { onPlay(ctx) { ctx.gainLife(ctx.seat, 2); } },
  "healing balm|3": { onPlay(ctx) { ctx.gainLife(ctx.seat, 1); } },
  "flex|1": { onAttackDeclared(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onDefend(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onChoose(ctx, h, o) { if (h === "flex" && o === "paid") ctx.addCardTempPower(ctx.self.instanceId, 2); } },
  "flex|2": { onAttackDeclared(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onDefend(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onChoose(ctx, h, o) { if (h === "flex" && o === "paid") ctx.addCardTempPower(ctx.self.instanceId, 2); } },
  "flex|3": { onAttackDeclared(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onDefend(ctx) { ctx.requestPayment("flex", decisionPrompt("Pay 2 for +2 power?", "card.upr.power.pay", { values: { amount: 2, power: 2 } }), 2); }, onChoose(ctx, h, o) { if (h === "flex" && o === "paid") ctx.addCardTempPower(ctx.self.instanceId, 2); } },
  "rapid reflex|1": { canPlay(ctx) { return !!ctx.link && ctx.link.attackCardType === "action" && ctx.cardData(ctx.link.attackingCard.cardId).cost === 0; }, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 3 }); } },
  "rapid reflex|2": { canPlay(ctx) { return !!ctx.link && ctx.link.attackCardType === "action" && ctx.cardData(ctx.link.attackingCard.cardId).cost === 0; }, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 2 }); } },
  "rapid reflex|3": { canPlay(ctx) { return !!ctx.link && ctx.link.attackCardType === "action" && ctx.cardData(ctx.link.attackingCard.cardId).cost === 0; }, onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); } },
  "read the ripples|1": readRipples(3), "read the ripples|2": readRipples(2), "read the ripples|3": readRipples(1),
  "sift|1": sift(4), "sift|2": sift(3), "sift|3": sift(2),
  "strategic planning|1": strategicPlanning(2), "strategic planning|2": strategicPlanning(1), "strategic planning|3": strategicPlanning(0),
  "sigil of protection|1": sigilProtection(), "sigil of protection|2": sigilProtection(), "sigil of protection|3": sigilProtection(),
  "oasis respite|2": oasis(3), "oasis respite|3": oasis(2),
  "sash of sandikai|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", label: "Destroy: gain 1 resource", canActivate: (ctx) => Number(ctx.getFlag("player", "playedPitch:1")) > 0, onActivate(ctx) { ctx.destroySelf(); ctx.changeResources(ctx.seat, 1); } } },
  "singe|1": singe(3),
  "singe|2": singe(2),
  "singe|3": singe(1),
  "tide flippers|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "attack-reaction", destroySelfCost: true, label: "Give a small attack go again", canActivate: (ctx) => !!ctx.link && ctx.link.attackCardType === "action" && ctx.basePower(ctx.link.attackingCard) <= 2, onActivate(ctx) { ctx.grantGoAgain(); } } },
  "trade in|1": { onAttackDeclared(ctx) { ctx.requestCardChoice("trade", decisionPrompt("Discard a card to draw?", "card.upr.discard.draw", { optionMessages: commonOptionMessages("pass") }), ["pass", ...ctx.player(ctx.seat).hand.map((c) => c.instanceId)]); if (ctx.link?.flags.fromArsenal) ctx.grantGoAgain(); }, onChoose(ctx, h, o) { if (h === "trade" && o !== "pass" && ctx.discardCard(ctx.seat, Number(o))) ctx.drawCards(ctx.seat, 1); } },
  "trade in|2": { onAttackDeclared(ctx) { ctx.requestCardChoice("trade", decisionPrompt("Discard a card to draw?", "card.upr.discard.draw", { optionMessages: commonOptionMessages("pass") }), ["pass", ...ctx.player(ctx.seat).hand.map((c) => c.instanceId)]); if (ctx.link?.flags.fromArsenal) ctx.grantGoAgain(); }, onChoose(ctx, h, o) { if (h === "trade" && o !== "pass" && ctx.discardCard(ctx.seat, Number(o))) ctx.drawCards(ctx.seat, 1); } },
  "trade in|3": { onAttackDeclared(ctx) { ctx.requestCardChoice("trade", decisionPrompt("Discard a card to draw?", "card.upr.discard.draw", { optionMessages: commonOptionMessages("pass") }), ["pass", ...ctx.player(ctx.seat).hand.map((c) => c.instanceId)]); if (ctx.link?.flags.fromArsenal) ctx.grantGoAgain(); }, onChoose(ctx, h, o) { if (h === "trade" && o !== "pass" && ctx.discardCard(ctx.seat, Number(o))) ctx.drawCards(ctx.seat, 1); } },
  "transmogrify|1": transmogrify(8), "transmogrify|2": transmogrify(7), "transmogrify|3": transmogrify(6),

  // Quell-only equipment
  "quelling robe|0": quelling(),
  "quelling sleeves|0": quelling(),
  "quelling slippers|0": quelling(),
});
