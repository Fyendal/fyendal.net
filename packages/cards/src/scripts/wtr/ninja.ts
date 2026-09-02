import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { commonOptionMessages, decisionPrompt, localizedLog, previousAttackHasName } from "../shared-helpers.js";

// ── WTR Ninja helpers ───────────────────────────────────────────────────────

/** Normalised card name (no pitch). */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True if the previous resolved attack matches the named card (any pitch). */
function comboWith(ctx: ScriptCtx, name: string): boolean {
  return previousAttackHasName(ctx, nameKey(name));
}

function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function hasCombo(ctx: ScriptCtx, cardId: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some((k) => k.toLowerCase() === "combo");
}

function hitsThisChain(ctx: ScriptCtx): number {
  return ctx.state.chain.filter((l) => l.resolved && l.hit).length;
}

// ── Ninja combo attacks ─────────────────────────────────────────────────────

const blackoutKick = ((): CardScript => ({
  modifyAttack(ctx) {
    return comboWith(ctx, "rising knee thrust") ? 3 : 0;
  },
}))();

const flusterFist = ((): CardScript => ({
  modifyAttack(ctx) {
    return comboWith(ctx, "open the center") ? hitsThisChain(ctx) : 0;
  },
}))();

const openTheCenter = ((): CardScript => ({
  modifyAttack(ctx) {
    return comboWith(ctx, "head jab") ? 1 : 0;
  },
  onAttackDeclared(ctx) {
    if (!comboWith(ctx, "head jab")) return;
    ctx.grantGoAgain();
    ctx.addModifier({ scope: "chain-link", dominate: true });
    ctx.logPublic(localizedLog(
      "Open the Center: +1 attack, go again, dominate",
      "card.log.wtr.openthecenter.combo",
      { card: { kind: "card", cardId: ctx.self.cardId } },
    ));
  },
}))();

const risingKneeThrust = ((): CardScript => ({
  modifyAttack(ctx) {
    return comboWith(ctx, "leg tap") ? 2 : 0;
  },
  onAttackDeclared(ctx) {
    if (!comboWith(ctx, "leg tap")) return;
    ctx.grantGoAgain();
    ctx.logPublic(localizedLog(
      "Rising Knee Thrust: +2 attack and go again",
      "card.log.wtr.risingkneethrust.combo",
      { card: { kind: "card", cardId: ctx.self.cardId } },
    ));
  },
}))();

const whelmingGustwave = ((): CardScript => ({
  modifyAttack(ctx) {
    return comboWith(ctx, "surging strike") ? 1 : 0;
  },
  onAttackDeclared(ctx) {
    if (!comboWith(ctx, "surging strike")) return;
    ctx.grantGoAgain();
    ctx.setFlag("link", "whelmingGustwaveCombo", true);
    ctx.logPublic(localizedLog(
      "Whelming Gustwave: +1 attack, go again, draw on hit",
      "card.log.wtr.whelminggustwave.combo",
      { card: { kind: "card", cardId: ctx.self.cardId } },
    ));
  },
  canTriggerOnHit(ctx) {
    return ctx.getFlag("link", "whelmingGustwaveCombo") === true;
  },
  onHit(ctx) {
        ctx.drawCards(ctx.seat, 1);
  },
}))();

// ── Equipment / defense reaction ────────────────────────────────────────────

const breakingScales: CardScript = {
  // equipment attack reaction: destroy to pump a combo attack in the reaction window
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "attack-reaction",
    canActivate(ctx) {
      const link = ctx.state.chain[ctx.state.chain.length - 1];
      if (!link || link.resolved) return false;
      return isAttackAction(ctx, link.attackingCard) && hasCombo(ctx, link.attackingCard.cardId);
    },
    onActivate(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.logPublic(localizedLog(
        "Breaking Scales: target combo attack gains +1 attack",
        "card.log.wtr.breakingscales.attack",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 },
      ));
      ctx.destroySelf();
    },
  },
};

const flicFlak = ((): CardScript => ({
  onPlay(ctx) {
    ctx.addModifier({ scope: "until-end-of-turn", defense: 2, appliesToKeyword: "combo", once: true });
    ctx.logPublic(localizedLog(
      "Flic Flak: the next combo card you defend with this turn gains +2 defense",
      "card.log.wtr.flicflak.defense",
      { card: { kind: "card", cardId: ctx.self.cardId }, amount: 2 },
    ));
  },
}))();

// ── Katsu hero ──────────────────────────────────────────────────────────────

const katsu: CardScript = {
  onSuppressedHit(ctx) {
    if (ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "action") {
      ctx.setFlag("player", "katsuTriggeredThisTurn", true);
    }
  },
  canTriggerOnHit(ctx) {
    return ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "action" &&
      ctx.getFlag("player", "katsuTriggeredThisTurn") !== true;
  },
  onHit(ctx) {
    ctx.setFlag("player", "katsuTriggeredThisTurn", true);
    const p = ctx.player(ctx.seat);
    const zeroCost = p.hand.filter((c) => (ctx.cardData(c.cardId).cost ?? 99) === 0);
    if (zeroCost.length === 0) return;
    ctx.requestCardChoice(
      "katsu-discard",
      decisionPrompt("Katsu: discard a card with cost 0 to search for a combo card?", "card.wtr.katsu.discard", { optionMessages: commonOptionMessages("pass") }),
      ["pass", ...zeroCost.map((c) => c.instanceId)],
    );
  },
  onChoose(ctx, hook, option) {
    const p = ctx.player(ctx.seat);
    if (hook === "katsu-discard") {
      if (option === "pass") return;
      const discarded = ctx.discardCard(ctx.seat, Number(option));
      if (!discarded) return;
      const comboCards = p.deck.filter((c) => hasCombo(ctx, c.cardId));
      if (comboCards.length === 0) {
        ctx.shuffleDeck();
        ctx.logPublic(localizedLog(
          "Katsu: no combo card found; deck shuffled",
          "card.log.wtr.katsu.search.none",
          { card: { kind: "card", cardId: ctx.self.cardId } },
          { kind: "shuffle", seat: ctx.seat },
        ));
        return;
      }
      ctx.requestCardChoice(
        "katsu-search",
        decisionPrompt("Katsu: choose a combo card to banish face up", "card.wtr.katsu.combo.choose"),
        comboCards.map((c) => c.instanceId),
      );
      return;
    }
    if (hook !== "katsu-search") return;
    const found = p.deck.find((c) => c.instanceId === Number(option));
    if (!found) return;
    ctx.banish(found.instanceId);
    ctx.allowPlayFrom(found.instanceId, "banish");
    ctx.logPublic(localizedLog(
      `Katsu: banished ${ctx.cardData(found.cardId).name} face up — it may be played this turn`,
      "card.log.wtr.katsu.search.banished",
      {
        card: { kind: "card", cardId: ctx.self.cardId },
        result: { kind: "card", cardId: found.cardId },
      },
      {
        kind: "card-moved",
        cardId: found.cardId,
        ownerSeat: ctx.seat,
        from: "deck",
        to: "banish",
      },
    ));
    ctx.shuffleDeck();
  },
};

// ── Exports ─────────────────────────────────────────────────────────────────

export const ninja: Record<string, CardScript> = {
  "blackout kick|1": blackoutKick,
  "blackout kick|2": blackoutKick,
  "blackout kick|3": blackoutKick,

  "breaking scales|0": breakingScales,

  "flic flak|1": flicFlak,
  "flic flak|2": flicFlak,
  "flic flak|3": flicFlak,

  "fluster fist|1": flusterFist,
  "fluster fist|2": flusterFist,
  "fluster fist|3": flusterFist,

  "katsu|0": katsu,

  "open the center|1": openTheCenter,
  "open the center|2": openTheCenter,
  "open the center|3": openTheCenter,

  "rising knee thrust|1": risingKneeThrust,
  "rising knee thrust|2": risingKneeThrust,
  "rising knee thrust|3": risingKneeThrust,

  "whelming gustwave|1": whelmingGustwave,
  "whelming gustwave|2": whelmingGustwave,
  "whelming gustwave|3": whelmingGustwave,
};
