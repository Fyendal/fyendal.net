import { engineRuntime } from "../engineRuntime.js";
import { describe, expect, it } from "vitest";
import type { GameIntent } from "@fyendal/shared";
import { actionCandidates, applyIntent, legalIntents, projectStateFor, projectStateForReplay, projectTransitionEvents, rngNext } from "../index.js";
import { declareAttack } from "../attacks.js";
import { closeChain } from "../combatChain.js";
import { computeAttack } from "../combatValues.js";
import { resolveWagerLayer, resumeWagerResult } from "../wagers.js";
import { destroyPermanent } from "../zoneMoves.js";
import { answerTokenCreationReplacement, answerTokenReplacementOrder } from "../tokens.js";
import { cardHasType, cardTypesOf } from "../cardProperties.js";
import { logPublic } from "../gameLog.js";
import { makeCtx } from "../scriptContext.js";
import { abilityResourceCost } from "../abilityRules.js";
import { mayPlayFromZone, playFromSourceCardId } from "../playRules.js";
import { heroAbilitiesDisabled } from "../stateQueries.js";
import { createGame as createGameState } from "../runtimeState.js";
import { drawUpTo, finishEndPhase, startTurn } from "../turn.js";
import { continueStack } from "../triggers.js";
import { cards, decklist, giveCard, makeGame, player, scripts } from "./fixtures.js";

function passTopLayer(state: ReturnType<typeof makeGame>): ReturnType<typeof makeGame> {
  let next = state;
  for (let pass = 0; pass < 2; pass++) {
    const result = applyIntent(next, next.priorityPlayer, { kind: "pass" });
    if (!result.ok) throw new Error(result.error);
    next = result.state;
  }
  return next;
}

describe("game setup & turn structure", () => {
  it("preserves localized card-script decisions beside their deterministic fallback", () => {
    const state = makeGame(900);
    const source = player(state, 0).hero;

    makeCtx(state, engineRuntime, 0, source).requestChoice(
      "localized-choice",
      {
        fallback: "Choose a mode",
        message: { id: "card.test.mode.choose" },
        optionMessagesByValue: {
          first: { id: "card.test.mode.first" },
          second: { id: "card.test.mode.second" },
        },
      },
      ["first", "second"],
    );

    expect(state.pendingDecision).toMatchObject({
      prompt: "Choose a mode",
      promptMessage: { id: "card.test.mode.choose" },
      options: ["first", "second"],
      optionMessages: [
        { id: "card.test.mode.first" },
        { id: "card.test.mode.second" },
      ],
    });
    expect(projectStateFor(state, 0).pendingDecision?.promptMessage).toEqual({
      id: "card.test.mode.choose",
    });
    expect(projectStateFor(state, 1).pendingDecision?.promptMessage).toBeUndefined();
  });

  it("aligns partial card-script option messages by stable option value", () => {
    const state = makeGame(901);
    const source = player(state, 0).hero;

    makeCtx(state, engineRuntime, 0, source).requestChoice(
      "localized-choice",
      {
        fallback: "Choose a mode",
        message: { id: "card.test.mode.choose" },
        optionMessagesByValue: {
          first: { id: "card.test.mode.first" },
          second: { id: "card.test.mode.second" },
          unused: { id: "card.test.mode.unused" },
        },
      },
      ["second", "untranslated", "first"],
    );

    expect(state.pendingDecision?.promptMessage).toEqual({
      id: "card.test.mode.choose",
    });
    expect(state.pendingDecision?.optionMessages).toEqual([
      { id: "card.test.mode.second" },
      null,
      { id: "card.test.mode.first" },
    ]);
  });

  it("supports semantic prompts across card, name, and payment decisions", () => {
    const cardState = makeGame(902);
    const cardSource = player(cardState, 0).hero;
    makeCtx(cardState, engineRuntime, 0, cardSource).requestCardChoice(
      "localized-card",
      {
        fallback: "Choose a card",
        message: { id: "card.test.card.choose" },
        optionMessagesByValue: {
          [String(cardSource.instanceId)]: { id: "card.test.card.option" },
        },
      },
      [cardSource.instanceId],
    );
    expect(cardState.pendingDecision).toMatchObject({
      promptMessage: { id: "card.test.card.choose" },
      options: [String(cardSource.instanceId)],
      optionMessages: [{ id: "card.test.card.option" }],
      cardOptions: [cardSource.instanceId],
    });

    const nameState = makeGame(903);
    const nameSource = player(nameState, 0).hero;
    makeCtx(nameState, engineRuntime, 0, nameSource).requestNameChoice(
      "localized-name",
      {
        fallback: "Choose a name",
        message: { id: "card.test.name.choose" },
      },
    );
    expect(nameState.pendingDecision?.promptMessage).toEqual({
      id: "card.test.name.choose",
    });

    const paymentState = makeGame(904);
    const paymentSource = player(paymentState, 0).hero;
    player(paymentState, 0).resources = 1;
    expect(makeCtx(paymentState, engineRuntime, 0, paymentSource).requestPayment(
      "localized-payment",
      {
        fallback: "Pay 1?",
        message: { id: "card.test.payment.choose" },
        optionMessagesByValue: {
          no: { id: "common.option.no" },
        },
      },
      1,
    )).toBe(true);
    expect(paymentState.pendingDecision?.promptMessage).toEqual({
      id: "card.test.payment.choose",
    });
    expect(paymentState.pendingDecision?.optionMessages?.at(-1)).toEqual({
      id: "common.option.no",
    });
  });

  it("closes the combat chain and settles equipment before entering the end phase", () => {
    const state = makeGame(944);
    const active = player(state, 0);
    const defending = player(state, 1);
    const attack = active.hand.shift()!;
    attack.cardId = "ATK4";
    const battleworn = { instanceId: 9944, cardId: "BW", owner: 1 };
    defending.equipment.chest = battleworn;
    state.chain = [{
      attacker: 0,
      attackingCard: attack,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [battleworn],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: true,
      flags: {},
    }];

    const result = applyIntent(state, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.state.phase).toBe("end");
    expect(result.state.chain).toEqual([]);
    expect(player(result.state, 1).equipment.chest?.defCounters).toBe(1);
    expect(player(result.state, 0).graveyard).toContainEqual(
      expect.objectContaining({ instanceId: attack.instanceId }),
    );
  });

  it.each([3, 5])("journals arsenal before draw-up at intellect %i", (intellect) => {
    const state = makeGame(940 + intellect);
    const active = player(state, 0);
    active.intellect = intellect;
    active.hand = active.hand.slice(0, Math.min(active.hand.length, intellect));
    while (active.hand.length < intellect) {
      active.hand.push(active.deck.shift()!);
    }
    state.phase = "end";
    state.activePlayer = 0;
    state.priorityPlayer = 0;
    state.pendingDecision = {
      player: 0,
      kind: "arsenal",
      prompt: "Choose a card for arsenal",
      options: active.hand.map((card) => String(card.instanceId)),
      cardOptions: active.hand.map((card) => card.instanceId),
    };
    const chosen = active.hand[0]!;

    const result = applyIntent(state, 0, { kind: "choose", optionId: String(chosen.instanceId) });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.slice(0, 2).map(({ from, to }) => ({ from, to }))).toEqual([
      { from: { kind: "hand", seat: 0 }, to: { kind: "arsenal", seat: 0 } },
      { from: { kind: "deck", seat: 0, position: "top" }, to: { kind: "hand", seat: 0 } },
    ]);
    expect(projectTransitionEvents(result.events, 1).slice(0, 2))
      .toEqual(result.events.slice(0, 2).map((event) => ({
        kind: "move",
        from: event.from,
        to: event.to,
        count: 1,
      })));
    expect(projectTransitionEvents(result.events, 0)[0]).toHaveProperty(
      "instanceId",
      chosen.instanceId,
    );
  });

  it("persists and projects pitch history only with a visible card", () => {
    const state = makeGame(95);
    const attack = giveCard(state, 0, "BIG");
    const blue = giveCard(state, 0, "BLUE");

    const result = applyIntent(state, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [blue],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pitched = player(result.state, 0).pitch.find((card) => card.instanceId === blue)!;
    expect(pitched.pitchCount).toBe(1);
    expect(projectStateFor(result.state, 0).players[0].pitch[0]?.pitchCount).toBe(1);
    expect(projectStateFor(result.state, 1).players[0].pitch[0]?.pitchCount).toBe(1);

    player(result.state, 0).pitch = [];
    player(result.state, 0).hand = [pitched];
    const opponentView = projectStateFor(result.state, 1);
    expect(opponentView.players[0].hand).toEqual([]);
    expect(JSON.stringify(opponentView)).not.toContain(`"instanceId":${blue}`);
  });

  it("projects authoritative names only with visible card identities", () => {
    const state = makeGame(951);
    const ownCard = player(state, 0).hand[0]!;

    expect(projectStateFor(state, 0).players[0].hand[0]).toMatchObject({
      cardId: ownCard.cardId,
      name: cards[ownCard.cardId]!.name,
    });
    expect(projectStateFor(state, 1).players[0].hand).toEqual([]);

    player(state, 0).banish = [{ ...ownCard, faceDown: true }];
    expect(projectStateFor(state, 1).players[0].banish[0]).not.toHaveProperty("name");
  });

  it("applies a weapon's attack modifier only while that weapon is attacking", () => {
    const actionState = makeGame(97);
    actionState.scriptsRef = {
      ...actionState.scriptsRef,
      SWORD: { ...actionState.scriptsRef.SWORD, modifyAttack: () => 5 },
    };
    const attackAction = player(actionState, 0).hand[0]!;
    attackAction.cardId = "ATK4";
    declareAttack(actionState, engineRuntime, 0, attackAction, "action");
    expect(computeAttack(actionState, engineRuntime, actionState.chain[0]!)).toBe(4);

    const weaponState = makeGame(96);
    weaponState.scriptsRef = {
      ...weaponState.scriptsRef,
      SWORD: { ...weaponState.scriptsRef.SWORD, modifyAttack: () => 5 },
    };
    const weapon = player(weaponState, 0).weapons[0]!;
    declareAttack(weaponState, engineRuntime, 0, weapon, "weapon");
    expect(computeAttack(weaponState, engineRuntime, weaponState.chain[0]!)).toBe(8);
  });

  it("does not fire chain-close abilities for attacks already removed from the chain", () => {
    const s = makeGame(98);
    s.scriptsRef = {
      ...s.scriptsRef,
      ATK4: {
        ...s.scriptsRef.ATK4,
        onCombatChainClosed(ctx) {
          ctx.setPlayerFlag(ctx.seat, "removedAttackClosed", true);
        },
      },
    };
    const card = player(s, 0).hand.shift()!;
    card.cardId = "ATK4";
    s.chain.push({
      attacker: 0,
      attackingCard: card,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: true,
      flags: { attackGone: true },
    });

    closeChain(s, engineRuntime);

    expect(player(s, 0).flags.removedAttackClosed).not.toBe(true);
  });

  it("applies all-zone types in every face-up zone", () => {
    const s = makeGame(99);
    s.scriptsRef = {
      ...s.scriptsRef,
      ATK4: { ...s.scriptsRef.ATK4, allZoneTypes: ["earth", "ice", "lightning"] },
    };
    const p = player(s, 0);
    const id = giveCard(s, 0, "ATK4");
    const card = p.hand.find((candidate) => candidate.instanceId === id)!;
    const expectElements = (): void => {
      expect(cardTypesOf(s, card)).toEqual(expect.arrayContaining(["earth", "ice", "lightning"]));
    };

    expectElements();
    p.hand.splice(p.hand.indexOf(card), 1);
    p.pitch.push(card);
    expectElements();
    p.pitch.pop();
    p.banish.push(card);
    expectElements();
    p.banish.pop();
    p.graveyard.push(card);
    expectElements();
    p.graveyard.pop();
    s.chain.push({
      attacker: 0,
      attackingCard: card,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: false,
      flags: {},
    });
    expectElements();

    card.faceDown = true;
    expect(cardTypesOf(s, card)).not.toContain("ice");
  });

  it("applies generic friendly draw, life-gain, and ability-cost replacements", () => {
    const s = makeGame(100);
    s.scriptsRef = { ...s.scriptsRef, HERO_A: {
      replaceFriendlyDraw(ctx, count) {
        const top = ctx.player(ctx.seat).deck[0];
        if (top) ctx.banish(top.instanceId);
        return Math.max(0, count - 1);
      },
      replaceHeroLifeGain(ctx, gainingSeat, amount) {
        ctx.loseLife(gainingSeat, amount);
        return 0;
      },
      modifyActivatedAbilityCost(_ctx, source, baseCost) {
        return source.instanceId === player(s, 0).hero.instanceId ? baseCost : Math.max(0, baseCost - 2);
      },
    } };
    const p = player(s, 0);
    const handBefore = p.hand.length;
    const banishBefore = p.banish.length;
    makeCtx(s, engineRuntime, 0, p.hero).drawCards(0, 1);
    expect(p.hand).toHaveLength(handBefore);
    expect(p.banish).toHaveLength(banishBefore + 1);

    const lifeBefore = p.life;
    makeCtx(s, engineRuntime, 0, p.hero).gainLife(0, 2);
    expect(p.life).toBe(lifeBefore - 2);

    const weapon = p.weapons[0]!;
    expect(abilityResourceCost(s, engineRuntime, 0, weapon, { cost: 3 })).toBe(1);
    expect(abilityResourceCost(s, engineRuntime, 0, p.hero, { cost: 3 })).toBe(3);
  });

  it("offers a named-card replacement only when the final damage is lethal", () => {
    const s = makeGame(1002);
    const target = player(s, 1);
    target.life = 3;
    target.flags.preventNextDamage = 1;
    const candidate = target.hand.shift()!;
    candidate.cardId = "INSTANT";
    candidate.faceDown = true;
    target.arsenal.push(candidate);
    makeCtx(s, engineRuntime, 1, target.hero).addModifier({
      scope: "until-end-of-turn",
      preventLethalDamageByBanishingNamedCard: "Test Sigil",
    });

    engineRuntime.commands.dealEffectDamage(s, {
      sourceInstanceId: player(s, 0).hero.instanceId,
      sourceSeat: 0,
      targetSeat: 1,
      amount: 4,
      arcane: false,
    });

    expect(s.pendingDecision).toMatchObject({
      player: 1,
      chooseHook: "lethal-damage-prevention",
      options: [String(candidate.instanceId), "decline"],
    });
    expect(s.pendingDecision?.arcane?.amount).toBe(3);

    const result = applyIntent(s, 1, {
      kind: "choose",
      optionId: String(candidate.instanceId),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 1).life).toBe(3);
    expect(player(result.state, 1).banish).toContainEqual(expect.objectContaining({
      instanceId: candidate.instanceId,
      cardId: "INSTANT",
    }));
    expect(player(result.state, 1).banish[0]).not.toHaveProperty("faceDown");
  });

  it("clears stale private-zone placement metadata when drawing a card", () => {
    const s = makeGame(1001);
    const p = player(s, 0);
    const top = p.deck[0]!;
    top.faceDown = true;
    top.arsenalSlot = 0;

    makeCtx(s, engineRuntime, 0, p.hero).drawCards(0, 1);

    const drawn = p.hand.find((card) => card.instanceId === top.instanceId);
    expect(drawn).toBeDefined();
    expect(drawn).not.toHaveProperty("faceDown");
    expect(drawn).not.toHaveProperty("arsenalSlot");
  });

  it("orders global and optional-friendly token replacements together", () => {
    const s = makeGame(102);
    const p = player(s, 0);
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        globalTokenCreationReplacement: {
          label: "Create one fewer token",
          replace: (_ctx, _seat, _cardId, count) => Math.max(0, count - 1),
        },
        optionalFriendlyTokenCreationReplacement: {
          label: "Use the optional replacement?",
          condition: (_ctx, cardId, count) => cardId === "TOKEN" && count > 0,
          effect: (ctx) => ctx.setPlayerFlag(ctx.seat, "optionalReplacementUsed", true),
        },
      },
    };

    makeCtx(s, engineRuntime, 0, p.hand[0]!).createToken("TOKEN");

    const sourceId = p.hero.instanceId;
    expect(s.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "engine-token-replacement-order",
      options: [`global:${sourceId}`, `optional-friendly:${sourceId}`],
    });
    expect(projectStateFor(s, 0).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.token.next",
    });
    expect(answerTokenReplacementOrder(s, engineRuntime, 0, `optional-friendly:${sourceId}`)).toBeUndefined();
    expect(s.pendingDecision?.chooseHook).toBe("engine-token-creation-replacement");
    expect(answerTokenCreationReplacement(s, engineRuntime, 0, "yes")).toBeUndefined();
    expect(p.flags.optionalReplacementUsed).toBe(true);
    expect(p.board.some((card) => card.cardId === "TOKEN")).toBe(false);
  });

  it("canonicalizes token reprints before creating distinct instances", () => {
    const s = makeGame(110);
    const p = player(s, 0);
    s.cardsRef = {
      ...s.cardsRef,
      TOKEN_ALT: { ...s.cardsRef.TOKEN!, id: "TOKEN_ALT" },
    };

    const first = makeCtx(s, engineRuntime, 0, p.hand[0]!).createToken("TOKEN_ALT");
    const second = makeCtx(s, engineRuntime, 0, p.hand[0]!).createToken("TOKEN");

    expect(first?.cardId).toBe("TOKEN");
    expect(second?.cardId).toBe("TOKEN");
    expect(first?.instanceId).not.toBe(second?.instanceId);
  });

  it("does not let a later replacement revive a zero-token event", () => {
    const s = makeGame(108);
    const p = player(s, 0);
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        globalTokenCreationReplacement: {
          label: "Create one fewer token",
          replace: (_ctx, _seat, _cardId, count) =>
            count > 0 ? count - 1 : undefined,
        },
      },
      SWORD: {
        ...s.scriptsRef.SWORD,
        replaceFriendlyTokenCreation: (_ctx, cardId, count) =>
          cardId === "TOKEN" ? count + 1 : undefined,
      },
    };

    makeCtx(s, engineRuntime, 0, p.hand[0]!).createToken("TOKEN");

    expect(answerTokenReplacementOrder(
      s, engineRuntime,
      0,
      `global:${p.hero.instanceId}`,
    )).toBeUndefined();
    expect(p.board.filter((card) => card.cardId === "TOKEN")).toHaveLength(0);
    expect(s.pendingDecision).toBeNull();
  });

  it("queues one triggered layer for a batch of one or more created tokens", () => {
    const s = makeGame(109);
    const p = player(s, 0);
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        triggers: [{
          event: "token-created",
          label: "Observe the token batch",
          condition: (_ctx, token, event) =>
            token?.cardId === "TOKEN" && event?.tokenCount === 2,
          effect(ctx) {
            ctx.setPlayerFlag(ctx.seat, "tokenBatchTriggerResolved", true);
          },
        }],
      },
    };

    makeCtx(s, engineRuntime, 0, p.hand[0]!).createTokens("TOKEN", 2);

    expect(p.flags.tokenBatchTriggerResolved).toBeUndefined();
    expect(s.pendingTriggeredLayers).toHaveLength(1);
    continueStack(s, engineRuntime);
    expect(s.stack).toHaveLength(1);
    expect(s.pendingDecision?.kind).toBe("priority-window");

    const resolved = passTopLayer(s);
    expect(player(resolved, 0).flags.tokenBatchTriggerResolved).toBe(true);
  });

  it("queues later token events while replacement ordering is suspended", () => {
    const s = makeGame(107);
    const p = player(s, 0);
    const addOne = {
      label: "Create one more token",
      replace: (
        _ctx: ReturnType<typeof makeCtx>,
        _seat: number,
        _cardId: string,
        count: number,
      ) => count + 1,
    };
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: { globalTokenCreationReplacement: addOne },
      SWORD: {
        ...s.scriptsRef.SWORD,
        globalTokenCreationReplacement: addOne,
      },
    };

    const ctx = makeCtx(s, engineRuntime, 0, p.hand[0]!);
    ctx.createToken("TOKEN");
    ctx.createToken("TOKEN");

    expect(s.pendingDecision?.chooseHook).toBe("engine-token-replacement-order");
    expect(s.pendingTokenCreations).toHaveLength(1);

    const heroReplacement = `global:${p.hero.instanceId}`;
    const first = applyIntent(s, 0, { kind: "choose", optionId: heroReplacement });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(player(first.state, 0).board.filter((card) => card.cardId === "TOKEN")).toHaveLength(3);
    expect(first.state.pendingDecision?.chooseHook).toBe("engine-token-replacement-order");

    const second = applyIntent(first.state, 0, { kind: "choose", optionId: heroReplacement });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(player(second.state, 0).board.filter((card) => card.cardId === "TOKEN")).toHaveLength(6);
    expect(second.state.pendingDecision).toBeNull();
    expect(second.state.pendingTokenCreations).toEqual([]);
  });

  it("preserves wager-prize continuation after a loss replacement", () => {
    const s = makeGame(105);
    const attack = player(s, 0).hand.shift()!;
    attack.cardId = "ATK4";
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        globalTokenCreationReplacement: {
          label: "Create one more token",
          replace: (_ctx, _seat, _cardId, count) => count + 1,
        },
      },
      HERO_B: {
        globalTokenCreationReplacement: {
          label: "Create one fewer token",
          replace: (_ctx, _seat, _cardId, count) => Math.max(0, count - 1),
        },
      },
      ATK4: {
        onWagerResolved(ctx) {
          ctx.setPlayerFlag(ctx.seat, "wagerPrizeFinished", true);
        },
      },
    };
    s.chain.push({
      attacker: 0,
      attackingCard: attack,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: false,
      flags: { "wagerPendingWinner:0": 0 },
      wagers: [{
        source: attack,
        controllerSeat: 0,
        opposingSeat: 1,
        rewardCardIds: ["TOKEN", "TOKEN"],
        rewardLabel: "Winner creates 2 Test Tokens",
      }],
    });

    resumeWagerResult(s, engineRuntime, 0);

    expect(s.pendingDecision).toMatchObject({
      chooseHook: "engine-token-replacement-player-order",
      resume: { kind: "continue-wager-prizes", wagerIndex: 0 },
    });
    const first = applyIntent(s, 0, { kind: "choose", optionId: "0" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.pendingDecision).toMatchObject({
      chooseHook: "engine-token-replacement-player-order",
      resume: { kind: "continue-wager-prizes", wagerIndex: 0 },
    });
    const second = applyIntent(first.state, 0, { kind: "choose", optionId: "0" });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(player(second.state, 0).board.filter((card) => card.cardId === "TOKEN")).toHaveLength(2);
    expect(player(second.state, 0).flags.wagerPrizeFinished).toBe(true);
  });

  it("orders wager-loss replacements and continues after one is declined", () => {
    const s = makeGame(109);
    const p = player(s, 0);
    const attack = p.hand.shift()!;
    attack.cardId = "ATK4";
    const swordId = p.weapons[0]!.instanceId;
    const heroId = p.hero.instanceId;
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        onFriendlyWagerLossReplacement(ctx) {
          ctx.requestChoice("hero-wager-loss", "Use the hero replacement?", ["yes", "no"]);
          return true;
        },
        onChoose(ctx, hook, option) {
          if (hook === "hero-wager-loss" && option === "yes") {
            ctx.setCounter("wagerWinnerOverride", ctx.seat + 1);
          }
        },
      },
      SWORD: {
        ...s.scriptsRef.SWORD,
        onFriendlyWagerLossReplacement(ctx) {
          ctx.requestChoice("sword-wager-loss", "Use the sword replacement?", ["yes", "no"]);
          return true;
        },
      },
    };
    s.chain.push({
      attacker: 0,
      attackingCard: attack,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: false,
      flags: {},
      wagers: [{
        source: attack,
        controllerSeat: 0,
        opposingSeat: 1,
        rewardCardIds: [],
        rewardLabel: "No specified prize",
      }],
    });

    resolveWagerLayer(s, engineRuntime, {
      sourceInstanceId: attack.instanceId,
      seat: 0,
      triggerIndex: -1,
      label: "Resolve wager",
      optional: false,
      engineEffect: { kind: "wager-result", wagerIndex: 0 },
    });

    expect(s.pendingDecision).toMatchObject({
      player: 0,
      chooseHook: "engine-wager-loss-replacement-order",
      options: [String(heroId), String(swordId)],
    });
    const ordered = applyIntent(s, 0, { kind: "choose", optionId: String(swordId) });
    expect(ordered.ok).toBe(true);
    if (!ordered.ok) return;
    expect(ordered.state.pendingDecision).toMatchObject({
      chooseHook: "sword-wager-loss",
      resume: {
        kind: "continue-wager-loss-replacements",
        remainingSourceInstanceIds: [heroId],
      },
    });

    const declined = applyIntent(ordered.state, 0, { kind: "choose", optionId: "no" });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.state.pendingDecision).toMatchObject({
      chooseHook: "hero-wager-loss",
      resume: {
        kind: "continue-wager-loss-replacements",
        remainingSourceInstanceIds: [],
      },
    });

    const accepted = applyIntent(declined.state, 0, { kind: "choose", optionId: "yes" });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.state.log.some((entry) =>
      entry.publicText?.includes("Hero A wins the wager")
    )).toBe(true);
  });

  it("collects self-scoped triggers for events queued during resolution", () => {
    const s = makeGame(106);
    const attack = player(s, 0).hand.shift()!;
    attack.cardId = "ATK4";
    s.scriptsRef = {
      ...s.scriptsRef,
      ATK4: {
        triggers: [{
          event: "wager-generated",
          sourceZone: "self",
          label: "Observe this attack's wager",
          effect: () => {},
        }],
      },
    };
    const link = {
      attacker: 0,
      attackingCard: attack,
      attackCardType: "action" as const,
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: false,
      flags: {},
    };
    s.chain.push(link);

    makeCtx(s, engineRuntime, 0, attack, link).wager(1, ["TOKEN"]);

    expect(s.pendingTriggeredLayers).toEqual([
      expect.objectContaining({
        sourceInstanceId: attack.instanceId,
        triggerIndex: 0,
        label: "Observe this attack's wager",
      }),
    ]);
  });

  it("expires start-bound permissions on the named hero's next turn, including after an extra opposing turn", () => {
    const s = makeGame(101);
    const card = player(s, 0).hand[0]!;
    const ctx = makeCtx(s, engineRuntime, 0, player(s, 0).hero);
    expect(ctx.banish(card.instanceId)).toBe(true);
    ctx.allowPlayFrom(card.instanceId, "banish", { untilNextTurn: true });

    s.activePlayer = 1;
    s.turn = 2;
    startTurn(s, engineRuntime);
    expect(player(s, 0).banish[0]?.playableFrom).toContain("banish");

    s.activePlayer = 0;
    s.turn = 3;
    startTurn(s, engineRuntime);
    expect(player(s, 0).banish[0]?.playableFrom).toBeUndefined();
  });

  it("keeps repeated play-from-zone grants idempotent", () => {
    const s = makeGame(103);
    const card = player(s, 0).hand[0]!;
    const ctx = makeCtx(s, engineRuntime, 0, player(s, 0).hero);
    expect(ctx.moveToGraveyard(card.instanceId, "hand")).toBe(true);

    for (let i = 0; i < 4; i++) ctx.allowPlayFrom(card.instanceId, "graveyard");

    expect(card.playableFrom).toEqual(["graveyard"]);
  });

  it("clears a previous object's play-from-zone grant when it enters the graveyard", () => {
    const s = makeGame(104);
    const card = player(s, 0).hand[0]!;
    const ctx = makeCtx(s, engineRuntime, 0, player(s, 0).hero);
    expect(ctx.moveToGraveyard(card.instanceId, "hand")).toBe(true);
    ctx.allowPlayFrom(card.instanceId, "graveyard", {
      asInstant: true,
      costReduction: 1,
      untilNextTurn: true,
    });

    player(s, 0).graveyard.splice(0, 1);
    player(s, 0).board.push(card);
    destroyPermanent(s, engineRuntime, 0, card);

    const resetCard = player(s, 0).graveyard[0]!;
    expect(resetCard.playableFrom).toBeUndefined();
    expect(resetCard.playableFromSourceCardId).toBeUndefined();
    expect(resetCard.playableFromUntilStartOfSeatTurn).toBeUndefined();
    expect(resetCard.playCostReduction).toBeUndefined();
    expect(resetCard.playableAsInstant).toBeUndefined();
  });

  it("grants matching cards play permission from a zone for the modifier duration", () => {
    const s = makeGame(107);
    s.cardsRef = {
      ...s.cardsRef,
      RUNE_AURA: {
        id: "RUNE_AURA",
        name: "Runechant of Testing",
        cardType: "instant",
        subtypes: ["aura"],
        classes: ["runeblade"],
        cost: 0,
        defense: 3,
        text: "Test aura.",
      },
    };
    const p = player(s, 0);
    const source = p.hero;
    const runechantId = giveCard(s, 0, "RUNE_AURA");
    const auraId = giveCard(s, 0, "AURA");
    const ctx = makeCtx(s, engineRuntime, 0, source);
    expect(ctx.banish(runechantId)).toBe(true);
    expect(ctx.banish(auraId)).toBe(true);

    ctx.addModifier({
      scope: "until-end-of-turn",
      grantsPlayFromZone: "banish",
      grantsPlayFromNameContains: "runechant",
      appliesToSubtype: "aura",
    });

    const runechant = p.banish.find((card) => card.instanceId === runechantId)!;
    const aura = p.banish.find((card) => card.instanceId === auraId)!;
    expect(mayPlayFromZone(s, engineRuntime, runechant, "banish", 0)).toBe(true);
    expect(playFromSourceCardId(s, engineRuntime, runechant, "banish", 0)).toBe("HERO_A");
    expect(mayPlayFromZone(s, engineRuntime, aura, "banish", 0)).toBe(false);

    runechant.faceDown = true;
    expect(mayPlayFromZone(s, engineRuntime, runechant, "banish", 0)).toBe(false);
  });

  it("separates an attacker's declaration hook from friendly observers", () => {
    const s = makeGame(104);
    const p = player(s, 0);
    const observer = { instanceId: s.nextInstanceId++, cardId: "AURA", owner: 0 };
    const selfOnly = { instanceId: s.nextInstanceId++, cardId: "IDOL", owner: 0 };
    const attacker = { instanceId: s.nextInstanceId++, cardId: "ATK4", owner: 0 };
    p.board.push(observer, selfOnly);
    s.scriptsRef = {
      ...s.scriptsRef,
      AURA: {
        onAttackDeclared(ctx) { ctx.addCounter(ctx.self.instanceId, "self", 1); },
        onFriendlyAttackDeclared(ctx) { ctx.addCounter(ctx.self.instanceId, "friendly", 1); },
      },
      ATK4: {
        onAttackDeclared(ctx) { ctx.addCounter(ctx.self.instanceId, "self", 1); },
      },
      IDOL: {
        onAttackDeclared(ctx) { ctx.addCounter(ctx.self.instanceId, "self", 1); },
      },
    };
    s.modifiers.push({
      id: s.nextModifierId++,
      sourceInstanceId: observer.instanceId,
      seat: 0,
      scope: "until-end-of-turn",
    });
    s.modifiers.push({
      id: s.nextModifierId++,
      sourceInstanceId: selfOnly.instanceId,
      seat: 0,
      scope: "until-end-of-turn",
    });

    declareAttack(s, engineRuntime, 0, attacker, "action");

    expect(s.chain.at(-1)?.attackingCard.counters?.self).toBe(1);
    expect(p.board[0]?.counters?.self).toBeUndefined();
    expect(p.board[0]?.counters?.friendly).toBe(1);
    expect(p.board[1]?.counters?.self).toBeUndefined();
  });

  it("expires seat-bound continuous effects at start or end independently", () => {
    const s = makeGame(102);
    const owned = player(s, 1).hand[0]!;
    const ctx = makeCtx(s, engineRuntime, 0, player(s, 0).hero);
    ctx.addModifier({ scope: "until-end-of-turn", seat: 1, suppressesOwnedClassTalentTypes: true, expiresAtEndOfSeatTurn: 1 });
    ctx.addModifier({ scope: "until-end-of-turn", seat: 1, suppressesOwnedNames: true, expiresAtStartOfSeatTurn: 0 });
    expect(cardTypesOf(s, owned)).not.toContain("generic");

    s.activePlayer = 1;
    s.turn = 2;
    startTurn(s, engineRuntime);
    expect(s.modifiers.some((modifier) => modifier.suppressesOwnedNames)).toBe(true);
    expect(s.modifiers.some((modifier) => modifier.suppressesOwnedClassTalentTypes)).toBe(true);

    s.activePlayer = 0;
    s.turn = 3;
    startTurn(s, engineRuntime);
    expect(s.modifiers.some((modifier) => modifier.suppressesOwnedNames)).toBe(false);
  });

  it("keeps next-turn hero suppression through intervening extra turns", () => {
    const s = makeGame(103);
    makeCtx(s, engineRuntime, 0, player(s, 0).hero).suppressHeroAbilitiesThroughNextTurn(1);

    s.activePlayer = 0;
    s.turn = 2;
    startTurn(s, engineRuntime);
    expect(heroAbilitiesDisabled(s, 1)).toBe(true);

    s.activePlayer = 1;
    s.turn = 3;
    startTurn(s, engineRuntime);
    expect(heroAbilitiesDisabled(s, 1)).toBe(true);
    finishEndPhase(s, engineRuntime);
    expect(heroAbilitiesDisabled(s, 1)).toBe(false);
  });
  it("creates a game, seat 0 starts, both players draw opening hands", () => {
    const s = makeGame(1);
    expect(s.turn).toBe(1);
    expect(s.activePlayer).toBe(0);
    expect(s.phase).toBe("action");
    expect(player(s, 0).hand).toHaveLength(4);
    expect(player(s, 0).actionPoints).toBe(1);
    expect(player(s, 1).hand).toHaveLength(4); // both draw opening hands
  });

  it("startPlayer config picks who takes the first turn", () => {
    const d = Array.from({ length: 40 }, () => "BLOCK3");
    const s = createGameState({
      decklists: [decklist("HERO_A", "SWORD", d), decklist("HERO_B", "CLUB", d)],
      seed: 1,
      cards,
      scripts,
      startPlayer: 1,
    });
    for (const p of s.players) drawUpTo(s, engineRuntime, p);
    startTurn(s, engineRuntime);
    expect(s.turn).toBe(1);
    expect(s.activePlayer).toBe(1);
    expect(s.priorityPlayer).toBe(1);
    expect(player(s, 1).actionPoints).toBe(1);
    expect(player(s, 0).actionPoints).toBe(0);
  });

  it("passing ends the turn, pitches are bottomed, hands refill", () => {
    let s = makeGame(2);
    const atk = giveCard(s, 0, "ATK4");
    // play ATK4 (cost 0), defender no-defense, both pass reactions
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" }); // attacker reaction pass
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" }); // defender reaction pass → resolve
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(16); // 20 - 4
    expect(s.chain).toHaveLength(1); // resolved link stays until the chain closes
    // end turn: arsenal decision appears (hand non-empty); the chain closes in cleanup
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    if (s.pendingDecision?.kind === "arsenal") {
      r = applyIntent(s, 0, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.activePlayer).toBe(1);
    expect(s.turn).toBe(2);
    expect(player(s, 1).hand.length).toBe(4);
  });

  it("puts an end-of-turn arsenal card face down and hides it from the opponent", () => {
    let s = makeGame(37);
    const card = player(s, 0).hand[0]!;

    let r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("arsenal");

    r = applyIntent(s, 0, { kind: "choose", optionId: String(card.instanceId) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    expect(player(s, 0).arsenal[0]).toMatchObject({
      instanceId: card.instanceId,
      faceDown: true,
    });
    expect(projectStateFor(s, 0).players[0]!.arsenal[0]!.cardId).toBe(card.cardId);
    expect(projectStateFor(s, 1).players[0]!.arsenal).toHaveLength(0);
    expect(projectStateFor(s, 1).players[0]!.arsenalCount).toBe(1);
    expect(projectStateFor(s, 1).log).toContain("Hero A puts a card face down into arsenal");
  });

  it("omits inactive arena state from graveyard and banished card views", () => {
    const s = makeGame(41);
    const staleState = {
      counters: { arcaneBonus: 2, fused: 1, power: 3 },
      defCounters: 1,
      life: 2,
    };
    player(s, 0).graveyard.push({
      instanceId: s.nextInstanceId++,
      cardId: "ATK4",
      owner: 0,
      ...staleState,
    });
    player(s, 0).banish.push({
      instanceId: s.nextInstanceId++,
      cardId: "ATK4",
      owner: 0,
      ...staleState,
    });

    const view = projectStateFor(s, 0).players[0]!;
    for (const card of [view.graveyard.at(-1), view.banish.at(-1)]) {
      expect(card).toMatchObject({ attack: 4, defense: 3 });
      expect(card?.counters).toBeUndefined();
      expect(card?.defCounters).toBeUndefined();
      expect(card?.life).toBeUndefined();
    }
  });

  it("projects public cards retained underneath a transformed hero", () => {
    const s = makeGame(42);
    player(s, 0).hero.subcards = [{
      instanceId: 990,
      cardId: "HERO_A",
      owner: 0,
      subcards: [{ instanceId: 991, cardId: "SWORD", owner: 0 }],
    }];

    for (const viewer of [0, 1]) {
      expect(projectStateFor(s, viewer).players[0]!.heroSubcards).toEqual([
        expect.objectContaining({
          instanceId: 990,
          cardId: "HERO_A",
          subcards: [expect.objectContaining({ instanceId: 991, cardId: "SWORD" })],
        }),
      ]);
    }
  });

  it("never offers an end-of-turn arsenal decision when the arsenal is occupied", () => {
    let s = makeGame(38);
    player(s, 0).arsenal.push({ instanceId: 999, cardId: "BLOCK3", owner: 0, faceDown: true });

    const result = applyIntent(s, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;

    expect(s.pendingDecision?.kind).not.toBe("arsenal");
    expect(player(s, 0).arsenal).toHaveLength(1);
  });

  it("end of turn privately prompts each player to order multiple pitch cards", () => {
    const s = makeGame(36);
    s.phase = "end";
    const active = player(s, 0);
    const other = player(s, 1);
    // cards pitched on the opponent's turn (e.g. paying for a defense
    // reaction) sit in their pitch zone until the turn's cleanup too
    active.pitch.push({ instanceId: 981, cardId: "YEL", owner: 0 });
    active.pitch.push({ instanceId: 982, cardId: "BLUE", owner: 0 });
    active.pitch.push({ instanceId: 983, cardId: "BLOCK3", owner: 0 });
    other.pitch.push({ instanceId: 984, cardId: "BLUE", owner: 1 });
    other.pitch.push({ instanceId: 985, cardId: "YEL", owner: 1 });
    const activeDeck = active.deck.length;
    const otherDeck = other.deck.length;

    finishEndPhase(s, engineRuntime);

    expect(s.pendingDecision).toMatchObject({
      player: 0,
      kind: "choose-target",
      prompt: "Choose the first card to put on the bottom of your deck",
      options: ["981", "982", "983"],
      chooseHook: "engine-end-phase-pitch-order",
    });
    expect(projectStateFor(s, 0).pendingDecision?.optionCards).toHaveLength(3);
    expect(projectStateFor(s, 1).pendingDecision).toMatchObject({ prompt: "" });
    expect(projectStateFor(s, 1).pendingDecision?.options).toBeUndefined();
    expect(projectStateFor(s, 1).pendingDecision?.optionCards).toBeUndefined();

    let result = applyIntent(s, 0, { kind: "choose", optionId: "983" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pendingDecision).toMatchObject({
      player: 0,
      prompt: "Choose the next card to put on the bottom of your deck",
      options: ["981", "982"],
    });
    expect(player(result.state, 0).pitch).toHaveLength(3);

    result = applyIntent(result.state, 0, { kind: "choose", optionId: "981" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 0).pitch).toHaveLength(0);
    expect(player(result.state, 0).deck.slice(activeDeck).map((card) => card.instanceId))
      .toEqual([983, 981, 982]);
    expect(result.state.pendingDecision).toMatchObject({
      player: 1,
      prompt: "Choose the first card to put on the bottom of your deck",
      options: ["984", "985"],
    });

    result = applyIntent(result.state, 1, { kind: "choose", optionId: "985" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 1).pitch).toHaveLength(0);
    expect(player(result.state, 1).deck.slice(otherDeck).map((card) => card.instanceId))
      .toEqual([985, 984]);
    expect(result.state.turn).toBe(2);
  });

  it("end of turn bottoms a lone pitch card without prompting", () => {
    const s = makeGame(136);
    const active = player(s, 0);
    const other = player(s, 1);
    active.pitch.push({ instanceId: 981, cardId: "YEL", owner: 0 });
    other.pitch.push({ instanceId: 982, cardId: "BLUE", owner: 1 });

    finishEndPhase(s, engineRuntime);

    expect(active.pitch).toHaveLength(0);
    expect(other.pitch).toHaveLength(0);
    expect(active.deck.at(-1)?.instanceId).toBe(981);
    expect(other.deck.at(-1)?.instanceId).toBe(982);
    expect(s.pendingDecision).toBeNull();
  });

  it("end of the first turn: BOTH players draw up; later turns: only the active player", () => {
    let s = makeGame(13);
    // turn 1: seat 0 attacks (spends a card), seat 1 defends (spends a card)
    const atk = player(s, 0).hand.find((c) => c.cardId === "ATK4")!.instanceId;
    const block = player(s, 1).hand.find((c) => c.cardId === "BLOCK3")!.instanceId;
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [block] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    for (const seat of [0, 1] as const) {
      r = applyIntent(s, seat, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(player(s, 0).hand.length).toBe(3); // spent 1 of 4
    expect(player(s, 1).hand.length).toBe(3);
    // end turn 1
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    if (s.pendingDecision?.kind === "arsenal") {
      r = applyIntent(s, 0, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.turn).toBe(2);
    expect(player(s, 0).hand.length).toBe(4); // active player drew up
    expect(player(s, 1).hand.length).toBe(4); // first-turn rule: defender also drew up

    // turn 2: seat 1 attacks, seat 0 defends (spends a card)
    const atk2 = player(s, 1).hand.find((c) => c.cardId === "ATK4")!.instanceId;
    const block2 = player(s, 0).hand.find((c) => c.cardId === "BLOCK3")!.instanceId;
    r = applyIntent(s, 1, { kind: "play-card", instanceId: atk2, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "defend", instanceIds: [block2] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    for (const seat of [1, 0] as const) {
      r = applyIntent(s, seat, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(player(s, 0).hand.length).toBe(3); // spent a card defending
    // end turn 2
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    if (s.pendingDecision?.kind === "arsenal") {
      r = applyIntent(s, 1, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(s.turn).toBe(3);
    expect(player(s, 1).hand.length).toBe(4); // active player drew up
    expect(player(s, 0).hand.length).toBe(3); // NOT the first turn: defender does not draw
  });
});

describe("scripted choices", () => {
  it("keeps bounded card-choice metadata when the choice queues behind Crank", () => {
    const s = makeGame(397);
    const source = player(s, 0).hand[0]!;
    const searched = player(s, 1).hand.slice(0, 2);
    s.pendingDecision = {
      player: 0,
      kind: "optional-effect",
      prompt: "Crank?",
      options: ["yes", "no"],
      sourceInstanceId: player(s, 0).hero.instanceId,
      chooseHook: "engine-crank",
    };

    makeCtx(s, engineRuntime, 0, source).requestCardChoices(
      "bounded-search",
      "Choose up to 2 cards",
      searched.map((card) => card.instanceId),
      0,
      2,
      0,
      undefined,
      searched.map((card) => card.instanceId),
    );

    expect(s.pendingDecision.followUpDecisions?.[0]).toMatchObject({
      chooseHook: "bounded-search",
      options: searched.map((card) => String(card.instanceId)),
      minimumSelections: 0,
      maximumSelections: 2,
      cardOptions: searched.map((card) => card.instanceId),
      lookedCardIds: searched.map((card) => card.instanceId),
    });
  });
});

describe("viewer projection secrecy", () => {
  it("caps audience-aware log entries at the newest 200", () => {
    const s = makeGame(398);
    for (let index = 0; index < 205; index++) logPublic(s, `line-${index}`);
    expect(s.log).toHaveLength(200);
    expect(s.log[0]).toEqual({ publicText: "line-5" });
    expect(s.log.at(-1)).toEqual({ publicText: "line-204" });
  });

  it("contains poisoned private identities across complete seat, spectator, legal, and replay payloads", () => {
    const s = makeGame(399);
    const owner = player(s, 0);
    const hand = owner.hand[0]!;
    const arsenal = owner.hand[1]!;
    const top = owner.deck[0]!;
    const poisons = [
      { card: hand, id: "POISON_HAND_CARD", name: "Poison Hand Name", instanceId: 9_100_001 },
      { card: arsenal, id: "POISON_ARSENAL_CARD", name: "Poison Arsenal Name", instanceId: 9_100_002 },
      { card: top, id: "POISON_TOP_CARD", name: "Poison Top Name", instanceId: 9_100_003 },
    ];
    for (const poison of poisons) {
      s.cardsRef[poison.id] = { ...cards.BLOCK3!, id: poison.id, name: poison.name };
      poison.card.cardId = poison.id;
      poison.card.instanceId = poison.instanceId;
    }
    owner.hand.splice(owner.hand.indexOf(arsenal), 1);
    arsenal.faceDown = true;
    owner.arsenal.push(arsenal);
    s.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a private card",
      options: poisons.map((poison) => String(poison.instanceId)),
      cardOptions: poisons.map((poison) => poison.instanceId),
      chooseHook: "private-test",
    };
    const privateLine = poisons
      .map((poison) => `${poison.name}#${poison.instanceId}`)
      .join(" ");
    s.log.push({
      publicText: "the player handles private cards",
      seatText: [privateLine, null],
    });

    for (const viewer of [0, 1, null] as const) {
      const view = projectStateFor(s, viewer);
      const statePayload = JSON.stringify({
        type: "state",
        version: 1,
        view,
        yourSeat: viewer,
        legal: viewer === null ? [] : legalIntents(s, viewer),
        spectators: 0,
        lastActionAt: [0, 0],
      });
      const replayPayload = JSON.stringify({ version: 1, seat: viewer, views: [view] });
      for (const poison of poisons) {
        if (viewer === 0) {
          expect(statePayload).toContain(poison.id);
          expect(statePayload).toContain(String(poison.instanceId));
          expect(replayPayload).toContain(poison.id);
        } else {
          expect(statePayload).not.toContain(poison.id);
          expect(statePayload).not.toContain(poison.name);
          expect(statePayload).not.toContain(String(poison.instanceId));
          expect(replayPayload).not.toContain(poison.id);
          expect(replayPayload).not.toContain(poison.name);
          expect(replayPayload).not.toContain(String(poison.instanceId));
        }
      }
      if (viewer === 0) expect(view.log).toContain(privateLine);
      else expect(view.log).toContain("the player handles private cards");
    }
  });

  it("projects private logs only to the entitled seat and never exposes engine randomness", () => {
    const s = makeGame(400);
    s.log.push({
      publicText: "a private card moved",
      seatText: ["POISON_PRIVATE_CARD_NAME moved", null],
    });

    for (const viewer of [0, 1, null] as const) {
      const view = projectStateFor(s, viewer);
      const serialized = JSON.stringify(view);
      if (viewer === 0) {
        expect(view.log).toContain("POISON_PRIVATE_CARD_NAME moved");
        expect(serialized).toContain("POISON_PRIVATE_CARD_NAME");
      } else {
        expect(view.log).toContain("a private card moved");
        expect(serialized).not.toContain("POISON_PRIVATE_CARD_NAME");
      }
      expect(serialized).not.toMatch(/"(?:seed|rngState)"/);
    }
  });

  it.each([
    ["deck search", "choose-target", "deck-search", "deck"],
    ["opt", "choose-target", "opt", "deck"],
    ["discard", "choose-target", "discard", "hand"],
    ["trigger ordering", "choose-target", "trigger-order", "literal"],
  ] as const)("hides %s decision capabilities from every non-deciding viewer", (_label, kind, hook, location) => {
    const s = makeGame(401);
    const chosen = location === "hand" ? player(s, 0).hand[0]! : player(s, 0).deck[0]!;
    s.pendingDecision = {
      player: 0,
      kind,
      prompt: "private choice",
      options: location === "literal" ? ["first", "second"] : [String(chosen.instanceId)],
      ...(location === "literal" ? {} : { cardOptions: [chosen.instanceId] }),
      chooseHook: hook,
    };

    const mine = projectStateFor(s, 0).pendingDecision;
    expect(mine?.options).toHaveLength(location === "literal" ? 2 : 1);
    if (location !== "literal") expect(mine?.optionCards?.[0]?.cardId).toBe(chosen.cardId);

    for (const viewer of [1, null] as const) {
      const hidden = projectStateFor(s, viewer).pendingDecision;
      expect(hidden?.prompt).toBe("");
      expect(hidden?.options).toBeUndefined();
      expect(hidden?.optionCards).toBeUndefined();
    }
  });

  it("projects an explicitly revealed choice group to every viewer", () => {
    const s = makeGame(403);
    const [eligible, ineligible] = player(s, 1).hand;
    expect(eligible).toBeDefined();
    expect(ineligible).toBeDefined();
    s.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a revealed card",
      options: [String(eligible!.instanceId)],
      cardOptions: [eligible!.instanceId],
      revealedCardIds: [eligible!.instanceId, ineligible!.instanceId],
      chooseHook: "revealed-choice-test",
    };

    const deciding = projectStateFor(s, 0).pendingDecision;
    expect(deciding?.optionCards?.map((card) => card?.instanceId)).toEqual([
      eligible!.instanceId,
    ]);
    expect(deciding?.revealedCards?.map((card) => card.instanceId)).toEqual([
      eligible!.instanceId,
      ineligible!.instanceId,
    ]);

    for (const viewer of [1, null] as const) {
      const visible = projectStateFor(s, viewer).pendingDecision;
      expect(visible?.options).toBeUndefined();
      expect(visible?.optionCards).toBeUndefined();
      expect(visible?.revealedCards?.map((card) => card.cardId)).toEqual([
        eligible!.cardId,
        ineligible!.cardId,
      ]);
    }
  });

  it("projects a disappeared non-hero permanent target safely", () => {
    let s = makeGame(402);
    const attack = giveCard(s, 0, "ATK4");
    const result = applyIntent(s, 0, { kind: "play-card", instanceId: attack, pitchInstanceIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    s.chain[0]!.targetAllyId = 999_999;
    expect(projectStateFor(s, 0).chain[0]?.targetAllyName).toBe("a permanent");
  });

  it("projects a targeted ally's public card state for chain rendering", () => {
    let s = makeGame(404);
    const attack = giveCard(s, 0, "ATK4");
    const result = applyIntent(s, 0, { kind: "play-card", instanceId: attack, pitchInstanceIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    const target = {
      instanceId: s.nextInstanceId++,
      cardId: "TOKEN",
      owner: 1,
      life: 2,
      counters: { suspense: 2 },
    };
    player(s, 1).board.push(target);
    s.chain[0]!.targetAllyId = target.instanceId;

    expect(projectStateFor(s, 0).chain[0]).toMatchObject({
      targetAllyName: "Test Token",
      targetAlly: {
        instanceId: target.instanceId,
        cardId: "TOKEN",
        life: 2,
        counters: { suspense: 2 },
      },
    });
  });

  it("projects whether the current attack has wagered", () => {
    let s = makeGame(405);
    const attack = giveCard(s, 0, "ATK4");
    const result = applyIntent(s, 0, { kind: "play-card", instanceId: attack, pitchInstanceIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    s.chain[0]!.flags.wagered = true;
    s.chain[0]!.wagerRewards = ["Winner creates Gold"];

    expect(projectStateFor(s, 0).chain[0]).toMatchObject({
      wagered: true,
      wagerRewards: ["Winner creates Gold"],
    });
    expect(projectStateFor(s, 1).chain[0]).toMatchObject({
      wagered: true,
      wagerRewards: ["Winner creates Gold"],
    });
  });
});

describe("pitch & costs", () => {
  it("logs a played card before the cards pitched to pay for it", () => {
    const s = makeGame(409);
    const attack = giveCard(s, 0, "BIG");
    const blue = giveCard(s, 0, "BLUE");

    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [blue],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const newLog = result.state.log.slice(s.log.length).map((entry) => entry.publicText);
    expect(newLog.slice(0, 2)).toEqual([
      expect.stringContaining("Hero A plays Big Swing"),
      expect.stringContaining("Hero A pitches Blue Resource"),
    ]);
  });

  it("offers and applies ordered multi-card payments", () => {
    const cases = [
      { label: "three reds", cardIds: ["ATK6", "ATK6", "ATK6"], float: 0 },
      { label: "a red and a yellow", cardIds: ["ATK6", "YEL"], float: 0 },
      { label: "two yellows", cardIds: ["YEL", "YEL"], float: 1 },
      { label: "a blue", cardIds: ["BLUE"], float: 0 },
    ] as const;

    for (const payment of cases) {
      const s = makeGame(410);
      const p = player(s, 0);
      p.hand = [];
      s.scriptsRef = {
        ...s.scriptsRef,
        SWORD: {
          activated: { cost: 3, isAttack: true, goAgain: true, oncePerTurn: true },
        },
      };
      const pitchInstanceIds = payment.cardIds.map((cardId) => giveCard(s, 0, cardId));
      const sourceInstanceId = p.weapons[0]!.instanceId;
      const offered = legalIntents(s, 0).find(
        (intent) => intent.kind === "activate-ability" &&
          intent.sourceInstanceId === sourceInstanceId &&
          intent.pitchInstanceIds.length === pitchInstanceIds.length &&
          intent.pitchInstanceIds.every((id, index) => id === pitchInstanceIds[index]),
      );
      expect(offered, payment.label).toBeDefined();
      if (!offered || offered.kind !== "activate-ability") continue;

      const result = applyIntent(s, 0, offered);
      expect(result.ok, payment.label).toBe(true);
      if (!result.ok) continue;
      expect(player(result.state, 0).resources, payment.label).toBe(payment.float);
      expect(
        player(result.state, 0).pitch.map((card) => card.instanceId),
        payment.label,
      ).toEqual(pitchInstanceIds);
    }
  });

  it("allows red then blue to pay 3, but rejects blue then red", () => {
    const s = makeGame(411);
    const p = player(s, 0);
    p.hand = [];
    s.scriptsRef = {
      ...s.scriptsRef,
      SWORD: {
        activated: { cost: 3, isAttack: true, goAgain: true, oncePerTurn: true },
      },
    };
    // Keep the blue first in hand to prove legal generation is independent of
    // hand layout and follows the player's announced pitch order.
    const blue = giveCard(s, 0, "BLUE");
    const red = giveCard(s, 0, "ATK6");
    const sourceInstanceId = p.weapons[0]!.instanceId;
    const payments = legalIntents(s, 0)
      .flatMap((intent) => intent.kind === "activate-ability" &&
          intent.sourceInstanceId === sourceInstanceId
        ? [intent.pitchInstanceIds]
        : []);

    expect(payments).toContainEqual([red, blue]);
    expect(payments).not.toContainEqual([blue, red]);

    const legal = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId,
      pitchInstanceIds: [red, blue],
    });
    expect(legal.ok).toBe(true);
    if (legal.ok) expect(player(legal.state, 0).resources).toBe(1);

    const overpitch = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId,
      pitchInstanceIds: [blue, red],
    });
    expect(overpitch.ok).toBe(false);
    if (!overpitch.ok) expect(overpitch.error).toContain("overpitch");
  });

  it("floats 2 when red then blue pays a 2-cost ability", () => {
    const s = makeGame(412);
    const p = player(s, 0);
    p.hand = [];
    s.scriptsRef = {
      ...s.scriptsRef,
      SWORD: {
        activated: { cost: 2, isAttack: true, goAgain: true, oncePerTurn: true },
      },
    };
    const blue = giveCard(s, 0, "BLUE");
    const red = giveCard(s, 0, "ATK6");
    const sourceInstanceId = p.weapons[0]!.instanceId;
    const offered = legalIntents(s, 0).find(
      (intent) => intent.kind === "activate-ability" &&
        intent.sourceInstanceId === sourceInstanceId &&
        intent.pitchInstanceIds[0] === red &&
        intent.pitchInstanceIds[1] === blue,
    );
    expect(offered).toBeDefined();
    if (!offered || offered.kind !== "activate-ability") return;
    expect(offered.pitchRequired).toBe(2);

    const result = applyIntent(s, 0, offered);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 0).resources).toBe(2);
  });

  it("a delayed first-attack tax ignores non-attacks", () => {
    let s = makeGame(403);
    const pump = giveCard(s, 0, "PUMP");
    player(s, 0).hero.counters = {
      firstAttackExtraCostTurn: s.turn,
      firstAttackExtraCost: 1,
    };

    const intents = legalIntents(s, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === pump,
    );
    expect(intents.some((intent) => intent.kind === "play-card" && intent.pitchInstanceIds.length === 0)).toBe(true);
    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: pump,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(player(s, 0).hero.counters?.firstAttackExtraCost).toBe(1);
  });

  it("a delayed first-action tax is paid and consumed by an action card", () => {
    let s = makeGame(413);
    const action = giveCard(s, 0, "PUMP");
    const pitch = giveCard(s, 0, "BLUE");
    player(s, 0).hero.counters = {
      firstActionExtraCostTurn: s.turn,
      firstActionExtraCost: 1,
    };

    const intents = legalIntents(s, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === action,
    );
    expect(intents.some((intent) => intent.kind === "play-card" && intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some(
      (intent) => intent.kind === "play-card" && intent.pitchInstanceIds.length === 1 && intent.pitchInstanceIds[0] === pitch,
    )).toBe(true);
    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: action,
      pitchInstanceIds: [pitch],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(player(s, 0).resources).toBe(2);
    expect(player(s, 0).hero.counters?.firstActionExtraCost).toBeUndefined();
  });

  it("a delayed first-action tax ignores instant cards", () => {
    const s = makeGame(414);
    const instant = giveCard(s, 0, "INSTANT");
    player(s, 0).hero.counters = {
      firstActionExtraCostTurn: s.turn,
      firstActionExtraCost: 1,
    };

    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: instant,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 0).hero.counters?.firstActionExtraCost).toBe(1);
  });

  it("a delayed first-action tax applies to action abilities", () => {
    const s = makeGame(415);
    const weapon = player(s, 0).weapons[0]!;
    const pitch = giveCard(s, 0, "YEL");
    player(s, 0).hand = player(s, 0).hand.filter((card) => card.instanceId === pitch);
    player(s, 0).hero.counters = {
      firstActionExtraCostTurn: s.turn,
      firstActionExtraCost: 1,
    };

    const intents = legalIntents(s, 0).filter(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === weapon.instanceId,
    );
    expect(intents.some((intent) => intent.kind === "activate-ability" && intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some(
      (intent) => intent.kind === "activate-ability" && intent.pitchInstanceIds.length === 1 && intent.pitchInstanceIds[0] === pitch,
    )).toBe(true);
    const result = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: weapon.instanceId,
      pitchInstanceIds: [pitch],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(player(result.state, 0).resources).toBe(0);
    expect(player(result.state, 0).hero.counters?.firstActionExtraCost).toBeUndefined();
  });

  it("a delayed first-attack tax is paid and consumed by an attack action card", () => {
    let s = makeGame(404);
    const attack = giveCard(s, 0, "ATK6");
    const pitch = giveCard(s, 0, "ATK6");
    player(s, 0).hero.counters = {
      firstAttackExtraCostTurn: s.turn,
      firstAttackExtraCost: 1,
    };

    const intents = legalIntents(s, 0).filter(
      (intent) => intent.kind === "play-card" && intent.instanceId === attack,
    );
    expect(intents.some((intent) => intent.kind === "play-card" && intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some(
      (intent) => intent.kind === "play-card" && intent.pitchInstanceIds.length === 1 && intent.pitchInstanceIds[0] === pitch,
    )).toBe(true);
    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [pitch],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(player(s, 0).resources).toBe(0);
    expect(player(s, 0).hero.counters?.firstAttackExtraCost).toBeUndefined();
  });

  it("a delayed first-attack tax applies to attack abilities", () => {
    let s = makeGame(405);
    const weapon = player(s, 0).weapons[0]!;
    const pitch = giveCard(s, 0, "YEL");
    player(s, 0).hand = player(s, 0).hand.filter((card) => card.instanceId === pitch);
    player(s, 0).hero.counters = {
      firstAttackExtraCostTurn: s.turn,
      firstAttackExtraCost: 1,
    };

    const intents = legalIntents(s, 0).filter(
      (intent) => intent.kind === "activate-ability" && intent.sourceInstanceId === weapon.instanceId,
    );
    expect(intents.some((intent) => intent.kind === "activate-ability" && intent.pitchInstanceIds.length === 0)).toBe(false);
    expect(intents.some(
      (intent) => intent.kind === "activate-ability" && intent.pitchInstanceIds.length === 1 && intent.pitchInstanceIds[0] === pitch,
    )).toBe(true);
    const result = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: weapon.instanceId,
      pitchInstanceIds: [pitch],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(player(s, 0).resources).toBe(0);
    expect(player(s, 0).hero.counters?.firstAttackExtraCost).toBeUndefined();
  });

  it("pays a 2-cost attack with a blue pitch, floats the spare resource", () => {
    let s = makeGame(3);
    const big = giveCard(s, 0, "BIG");
    const blue = giveCard(s, 0, "BLUE");
    const r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: big,
      pitchInstanceIds: [blue],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).resources).toBe(1); // 3 pitched - 2 cost
    expect(player(s, 0).pitch).toHaveLength(1);
    const publicLog = projectStateFor(s, null).log.join("\n");
    expect(publicLog).toContain("Blue Resource⟦BLUE⟧");
    expect(publicLog).toContain("Big Swing⟦BIG⟧");
  });

  it("tags pitch-bearing names emitted by card scripts with their exact printing", () => {
    const s = makeGame(301);
    const source = player(s, 0).hand[0]!;
    source.cardId = "BLOCK3";

    makeCtx(s, engineRuntime, 0, source).logPublic(`${cards.BLOCK3!.name} resolves`);

    expect(s.log.at(-1)?.publicText).toBe("Blocker resolves⟦BLOCK3⟧");
  });

  it("rejects underpayment", () => {
    const s = makeGame(4);
    const big = giveCard(s, 0, "BIG");
    const yel = giveCard(s, 0, "YEL"); // pitches for 2 exactly — this one succeeds
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: big, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
    r = applyIntent(s, 0, { kind: "play-card", instanceId: big, pitchInstanceIds: [yel] });
    expect(r.ok).toBe(true);
  });

  it("rejects overpitch: no extra cards once the cost is covered", () => {
    let s = makeGame(14);
    const big = giveCard(s, 0, "BIG"); // cost 2
    const yel = giveCard(s, 0, "YEL"); // 2 — covers alone
    const blue = giveCard(s, 0, "BLUE"); // 3 — a second card would be overpitch
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: big, pitchInstanceIds: [yel, blue] });
    expect(r.ok).toBe(false);
    // a single card that overpays within itself is fine
    r = applyIntent(s, 0, { kind: "play-card", instanceId: big, pitchInstanceIds: [blue] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).resources).toBe(1); // 3 - 2 floats
    // resolve the chain
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    for (const seat of [0, 1] as const) {
      r = applyIntent(s, seat, { kind: "pass" });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      s = r.state;
    }
    expect(player(s, 0).resources).toBe(1); // floats until end of turn

    // float up to 2 via a 1-cost weapon attack paid with a blue
    const sword = player(s, 0).weapons[0]!;
    const blue2 = giveCard(s, 0, "BLUE");
    player(s, 0).actionPoints = 1;
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: sword.instanceId,
      pitchInstanceIds: [blue2],
    });
    // the weapon costs 1 and 1 is already floating: pitching would be overpitch
    expect(r.ok).toBe(false);
    // paying purely from floating resources works
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: sword.instanceId,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).resources).toBe(0); // 1 - 1
  });
});

describe("combat", () => {
  it("projects native and granted on-hit effects with their card sources", () => {
    let s = makeGame(4);
    const blade = player(s, 0).weapons[0]!;
    blade.cardId = "BLADE";
    const blue = giveCard(s, 0, "BLUE");
    const attack = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: blade.instanceId,
      pitchInstanceIds: [blue],
    });
    expect(attack.ok).toBe(true);
    if (!attack.ok) return;
    s = attack.state;

    const sourceId = giveCard(s, 0, "PUMP");
    const sourceIndex = player(s, 0).hand.findIndex((card) => card.instanceId === sourceId);
    const source = player(s, 0).hand.splice(sourceIndex, 1)[0]!;
    player(s, 0).graveyard.push(source);
    s.modifiers.push({
      id: s.nextModifierId++,
      sourceInstanceId: sourceId,
      seat: 0,
      scope: "chain-link",
      onHitDraw: 1,
    });

    expect(projectStateFor(s, 1).chain[0]!.onHitEffects).toEqual([
      {
        sourceCardId: "BLADE",
        text: "When this hits, it gains go again",
        impact: { grantsTempo: true },
      },
      {
        sourceCardId: "PUMP",
        text: "When this hits, draw 1 card.",
        impact: { drawCards: 1 },
      },
    ]);
  });

  it("weapon attack with go again refunds AP and can hit", () => {
    let s = makeGame(5);
    const sword = player(s, 0).weapons[0]!;
    const blue = giveCard(s, 0, "BLUE");
    let r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: sword.instanceId,
      pitchInstanceIds: [blue],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).actionPoints).toBe(0); // 1 - 1, refund comes at resolution
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(17); // 3 weapon damage
    expect(player(s, 0).actionPoints).toBe(1); // go again refund
    // once per turn: cannot activate again
    const blue2 = giveCard(s, 0, "BLUE");
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: sword.instanceId,
      pitchInstanceIds: [blue2],
    });
    expect(r.ok).toBe(false);
  });

  it("defense reduces damage; block cards go to graveyard", () => {
    let s = makeGame(6);
    const atk = giveCard(s, 0, "ATK6");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const block = giveCard(s, 1, "BLOCK3");
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [block] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(17); // 6 - 3
    // cards stay on the resolved link until the combat chain closes
    expect(s.chain).toHaveLength(1);
    expect(projectStateFor(s, 0).chain[0]!.resolved).toBe(true);
    expect(player(s, 1).graveyard).toHaveLength(0);
    // playing a non-attack action closes the chain: cards go to graveyard
    const blue = giveCard(s, 0, "BLUE");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: blue, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain).toHaveLength(0);
    expect(player(s, 1).graveyard.some((c) => c.cardId === "BLOCK3")).toBe(true);
    expect(player(s, 0).graveyard.some((c) => c.cardId === "ATK6")).toBe(true);
  });

  it("activating a non-attack action ability on equipment closes the combat chain", () => {
    let s = makeGame(101);
    s.scriptsRef = {
      ...s.scriptsRef,
      BW: {
        activated: {
          cost: 0,
          isAttack: false,
          goAgain: true,
        },
      },
    };
    const equipment = { instanceId: s.nextInstanceId++, cardId: "BW", owner: 0 };
    player(s, 0).equipment.chest = equipment;
    const attack = giveCard(s, 0, "ATK6");

    let r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain).toHaveLength(1);

    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: equipment.instanceId,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    expect(s.chain).toHaveLength(0);
    expect(player(s, 0).graveyard.map((card) => card.cardId)).toContain("ATK6");
    expect(s.stack[0]).toMatchObject({ ability: true, sourceInstanceId: equipment.instanceId });
  });

  it("attack reaction buffs the attack", () => {
    let s = makeGame(7);
    const atk = giveCard(s, 0, "ATK4");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const react = giveCard(s, 0, "REACT");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: react, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // playing a reaction keeps priority with the same player, and the reaction
    // sits on the stack as a layer — it has not resolved yet
    expect(s.priorityPlayer).toBe(0);
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0]!.card?.instanceId).toBe(react);
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(4);
    // both pass in succession → the reaction resolves
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(6);
    // the attacker (turn player) regains priority; both pass again to end the step
    expect(s.priorityPlayer).toBe(0);
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(14); // 4 + 2
  });

  it("keeps an attack reaction off the chain until its resolution choice is complete", () => {
    let s = makeGame(71);
    s.scriptsRef = {
      ...s.scriptsRef,
      REACT: {
        onPlay(ctx) {
          ctx.requestChoice("reaction-choice", "Apply the reaction?", ["yes", "no"]);
        },
        onChoose(ctx, hook, option) {
          if (hook === "reaction-choice" && option === "yes") {
            ctx.addModifier({ scope: "chain-link", attack: 2 });
          }
        },
      },
    };
    const attack = giveCard(s, 0, "ATK4");
    const reaction = giveCard(s, 0, "REACT");

    let result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: reaction,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = passTopLayer(result.state);

    expect(s.pendingDecision?.chooseHook).toBe("reaction-choice");
    expect(s.stack[0]?.card?.instanceId).toBe(reaction);
    expect(s.chain[0]!.reactions.some((card) => card.instanceId === reaction)).toBe(false);

    result = applyIntent(s, 0, { kind: "choose", optionId: "yes" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;

    expect(s.stack.some((layer) => layer.card?.instanceId === reaction)).toBe(false);
    expect(s.chain[0]!.reactions.some((card) => card.instanceId === reaction)).toBe(true);
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(6);
  });

  it("dominate limits defense to 1 card from hand", () => {
    let s = makeGame(8);
    const dom = giveCard(s, 0, "DOM");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: dom, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const b1 = giveCard(s, 1, "BLOCK3");
    const b2 = giveCard(s, 1, "BLOCK3");
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [b1, b2] });
    expect(r.ok).toBe(false);
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [b1] });
    expect(r.ok).toBe(true);
  });

  it("rejects a defend intent that lists the same card twice", () => {
    let s = makeGame(36);
    player(s, 1).equipment.head = { instanceId: 999, cardId: "HELM", owner: 1 };
    const atk = giveCard(s, 0, "ATK6");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const block = giveCard(s, 1, "BLOCK3");
    // the legal-defender snapshots survive zone removal, so a repeated id
    // would otherwise defend (and run hooks) multiple times
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [block, block] });
    expect(r.ok).toBe(false);
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [999, 999] });
    expect(r.ok).toBe(false);
    // each card once is still legal: 3 (BLOCK3) + 1 (HELM) defense
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [block, 999] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain[0]!.defendingCards).toHaveLength(1);
    expect(s.chain[0]!.defendingEquipment).toHaveLength(1);
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(18); // 6 - 4: each card defended exactly once
  });

  it("allows off-hand equipment in a weapon zone to stage and defend", () => {
    let s = makeGame(37);
    const buckler = { instanceId: 998, cardId: "BUCKLER", owner: 1 };
    player(s, 1).weapons.push(buckler);
    const atk = giveCard(s, 0, "ATK4");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    expect(legalIntents(s, 1)).toContainEqual({
      kind: "stage-defenders",
      instanceIds: [buckler.instanceId],
    });
    r = applyIntent(s, 1, { kind: "stage-defenders", instanceIds: [buckler.instanceId] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(projectStateFor(s, 1).pendingDecision?.stagedDefense).toBe(2);

    const defend = legalIntents(s, 1).find((intent) =>
      intent.kind === "defend" && intent.instanceIds.includes(buckler.instanceId),
    );
    expect(defend).toBeDefined();
    if (!defend) return;
    r = applyIntent(s, 1, defend);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.chain[0]!.defendingEquipment.map((card) => card.instanceId)).toContain(
      buckler.instanceId,
    );
  });

  it("intimidate banishes a random hand card face down until the end phase begins", () => {
    let s = makeGame(9);
    giveCard(s, 1, "BLOCK3");
    const intim = giveCard(s, 0, "INTIM");
    const handBefore = player(s, 1).hand.length;
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: intim, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // no choice for the defender: a random card is banished right away (8.5.10)
    const pending = player(s, 1).banish.filter((c) => c.intimidated === true);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.faceDown).toBe(true);
    expect(player(s, 1).hand.length).toBe(handBefore - 1);
    expect(player(s, 0).flags.intimidatedThisTurn).toBe(true); // 8.5.10a
    expect(s.pendingDecision?.kind).toBe("defend");
    const banishedId = pending[0]!.instanceId;
    // the marker is public: the owner sees the card, the opponent a flagged back
    const ownerBanish = projectStateFor(s, 1).players[1]!.banish;
    expect(ownerBanish.some((c) => c.instanceId === banishedId && c.intimidated === true && c.cardId !== "")).toBe(true);
    const opponentBanish = projectStateFor(s, 0).players[1]!.banish;
    expect(opponentBanish.some((c) => c.hidden === true && c.intimidated === true && c.cardId === "")).toBe(true);
    // finish the attack and the turn
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // the card returns at the beginning of the end phase — before arsenalling
    expect(s.pendingDecision?.kind).toBe("arsenal");
    expect(player(s, 1).banish.every((c) => c.intimidated !== true)).toBe(true);
    expect(player(s, 1).hand.some((c) => c.instanceId === banishedId)).toBe(true);
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).banish.every((c) => c.intimidated !== true)).toBe(true);
    expect(player(s, 1).hand.some((c) => c.instanceId === banishedId && !c.faceDown)).toBe(true);
  });

  it("blade break equipment is destroyed when the combat chain closes", () => {
    let s = makeGame(10);
    player(s, 1).equipment.head = { instanceId: 999, cardId: "HELM", owner: 1 };
    const atk = giveCard(s, 0, "ATK6");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [999] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(15); // 6 - 1
    // the equipment survives link resolution; it is destroyed at chain close
    expect(player(s, 1).equipment.head).toBeDefined();
    const blue = giveCard(s, 0, "BLUE");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: blue, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).equipment.head).toBeUndefined();
    expect(player(s, 1).graveyard.some((c) => c.cardId === "HELM")).toBe(true);
  });

  it("battleworn equipment gets a -1 defense counter instead of being destroyed (8.3.2)", () => {
    let s = makeGame(33);
    player(s, 1).equipment.chest = { instanceId: 997, cardId: "BW", owner: 1 };
    const atk = giveCard(s, 0, "ATK6");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [997] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(16); // 6 - 2
    // close the chain with a non-attack action: counter, not destruction
    const blue = giveCard(s, 0, "BLUE");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: blue, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const chest = player(s, 1).equipment.chest;
    expect(chest?.cardId).toBe("BW");
    expect(chest?.defCounters).toBe(1);
    // it now defends for 1 (2 printed - 1 counter), and the counter is
    // projected so the client can render the badge on the card
    const projected = projectStateFor(s, 1).players[1]!.equipment.chest;
    expect(projected?.defense).toBe(1);
    expect(projected?.defCounters).toBe(1);
  });

  it("Guardwell adds counters equal to the equipment's modified defense (8.3.34)", () => {
    const s = makeGame(34);
    s.cardsRef = {
      ...s.cardsRef,
      GUARDWELL: {
        ...cards.HELM!,
        id: "GUARDWELL",
        name: "Test Guardwell",
        keywords: ["Guardwell"],
        text: "This gets +1 defense while defending a weapon attack. Guardwell",
      },
    };
    s.scriptsRef = {
      ...s.scriptsRef,
      GUARDWELL: {
        modifyDefense(ctx) {
          return ctx.link?.attackCardType === "weapon" ? 1 : 0;
        },
      },
    };
    const equipment = { instanceId: 997, cardId: "GUARDWELL", owner: 1 };
    player(s, 1).equipment.head = equipment;
    s.chain = [{
      attacker: 0,
      attackingCard: player(s, 0).weapons[0]!,
      attackCardType: "weapon",
      defendingCards: [],
      defendingEquipment: [equipment],
      reactions: [],
      goAgain: false,
      damage: 1,
      hit: true,
      resolved: true,
      flags: {},
    }];

    closeChain(s, engineRuntime);

    expect(player(s, 1).equipment.head?.defCounters).toBe(2);
    expect(s.log.at(-1)?.publicText).toContain("gets 2 -1 defense counter(s) (Guardwell)");
  });

  it("destroyed tokens cease to exist — they never enter the graveyard", () => {
    const s = makeGame(35);
    const p = player(s, 0);
    p.board.push({ instanceId: 990, cardId: "TOKEN", owner: 0 });
    destroyPermanent(s, engineRuntime, 0, p.board[0]!);
    expect(p.board).toHaveLength(0);
    expect(p.graveyard.some((c) => c.cardId === "TOKEN")).toBe(false);
    // no graveyard facts are recorded for a token either
    expect(p.flags["graveName:test token"]).toBeUndefined();
    expect(s.log.at(-1)?.publicText).toContain("is destroyed");
  });

  it("clears named and defense counters when a card enters the graveyard", () => {
    const s = makeGame(36);
    const p = player(s, 0);
    const card = {
      instanceId: 991,
      cardId: "BLOCK3",
      owner: 0,
      counters: { power: 2, frozenUntilTurn: 4 },
      defCounters: 1,
    };
    p.board.push(card);

    destroyPermanent(s, engineRuntime, 0, card);

    const graveyardCard = p.graveyard.at(-1);
    expect(graveyardCard).toMatchObject({ instanceId: card.instanceId, cardId: card.cardId });
    expect(graveyardCard).toBe(card);
    expect(graveyardCard?.counters).toBeUndefined();
    expect(graveyardCard?.defCounters).toBeUndefined();

    // Card-choice projection independently treats inactive-zone cards as
    // counter-free, including states loaded from older persisted games.
    graveyardCard!.counters = { power: 3 };
    graveyardCard!.defCounters = 2;
    s.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a graveyard card",
      options: [String(card.instanceId)],
      cardOptions: [card.instanceId],
      chooseHook: "graveyard-choice-test",
    };
    const optionCard = projectStateFor(s, 0).pendingDecision?.optionCards?.[0];
    expect(optionCard?.counters).toBeUndefined();
    expect(optionCard?.defCounters).toBeUndefined();
  });

  it("a defense reaction resolves as a defending card with its printed defense (8.1.3b)", () => {
    let s = makeGame(34);
    const atk = giveCard(s, 0, "ATK6"); // go again keeps the turn going after
    const dr = giveCard(s, 1, "DREACT"); // defense 3
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // attacker passes the reaction window; defender plays the reaction
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("defense-reaction");
    expect(projectStateFor(s, 1).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.reaction.defense",
    });
    r = applyIntent(s, 1, { kind: "play-card", instanceId: dr, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // the reaction sits on the stack first: not a defending card yet
    expect(s.stack[0]?.card?.instanceId).toBe(dr);
    expect(s.chain[0]!.defendingCards.some((c) => c.instanceId === dr)).toBe(false);
    expect(projectStateFor(s, 0).chain[0]!.defenseValue).toBe(0);
    expect(projectStateFor(s, 1).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.reaction.defense.card",
      values: { card: { kind: "card", cardId: "DREACT" } },
    });
    // both pass in succession → it resolves as a defending card (8.1.3b)
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const link = s.chain[0]!;
    expect(link.defendingCards.some((c) => c.instanceId === dr)).toBe(true);
    expect(link.flags.defendedFromHand).toBe(true);
    expect(projectStateFor(s, 0).chain[0]!.defenseValue).toBe(3);
    // both pass again: 6 - 3 = 3 damage, and the reaction goes to the graveyard
    // when the chain closes
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(17);
    const blue = giveCard(s, 0, "BLUE");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: blue, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).graveyard.some((c) => c.instanceId === dr)).toBe(true);
  });

  it("keeps a defense reaction on the stack until its resolution choice is complete", () => {
    let s = makeGame(72);
    s.scriptsRef = {
      ...s.scriptsRef,
      DREACT: {
        onPlay(ctx) {
          ctx.requestChoice("defense-reaction-choice", "Resolve the defense reaction?", ["yes", "no"]);
        },
        onChoose(ctx, hook) {
          if (hook !== "defense-reaction-choice") return;
          ctx.setFlag(
            "player",
            "wasDefendingDuringResolutionChoice",
            ctx.link?.defendingCards.some(
              (card) => card.instanceId === ctx.self.instanceId,
            ) === true,
          );
        },
      },
    };
    const attack = giveCard(s, 0, "ATK6");
    const reaction = giveCard(s, 1, "DREACT");

    let result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: attack,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 1, {
      kind: "play-card",
      instanceId: reaction,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = passTopLayer(result.state);

    expect(s.pendingDecision?.chooseHook).toBe("defense-reaction-choice");
    expect(s.stack[0]?.card?.instanceId).toBe(reaction);
    expect(s.chain[0]!.defendingCards.some((card) => card.instanceId === reaction)).toBe(false);
    expect(s.chain[0]!.flags.defendedFromHand).toBeUndefined();
    expect(projectStateFor(s, 0).chain[0]!.defenseValue).toBe(0);

    result = applyIntent(s, 1, { kind: "choose", optionId: "yes" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;

    expect(player(s, 1).flags.wasDefendingDuringResolutionChoice).toBe(false);
    expect(s.stack.some((layer) => layer.card?.instanceId === reaction)).toBe(false);
    expect(s.chain[0]!.defendingCards.some((card) => card.instanceId === reaction)).toBe(true);
    expect(s.chain[0]!.flags.defendedFromHand).toBe(true);
    expect(projectStateFor(s, 0).chain[0]!.defenseValue).toBe(3);
  });

  it("dominate blocks defense reactions from hand once defended from hand (8.3.4b)", () => {
    let s = makeGame(35);
    const dom = giveCard(s, 0, "DOM");
    const b1 = giveCard(s, 1, "BLOCK3");
    const dr = giveCard(s, 1, "DREACT");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: dom, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [b1] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // already defended from hand: no defense reaction from hand vs dominate
    r = applyIntent(s, 1, { kind: "play-card", instanceId: dr, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });
});

describe("legalIntents / applyIntent contract", () => {
  it("advertises structurally valid unaffordable actions without calling them legal", () => {
    const s = makeGame(710);
    const active = player(s, 0);
    active.hand = [];
    const expensiveId = giveCard(s, 0, "BIG");
    const expensive = active.hand.find((card) => card.instanceId === expensiveId)!;
    active.resources = 0;
    s.scriptsRef = {
      ...s.scriptsRef,
      SWORD: { activated: { cost: 4, isAttack: true, goAgain: true } },
    };
    const weapon = active.weapons[0]!;

    expect(legalIntents(s, 0).some(
      (intent) => intent.kind === "play-card" && intent.instanceId === expensive.instanceId,
    )).toBe(false);
    expect(actionCandidates(s, 0)).toContainEqual(expect.objectContaining({
      kind: "play-card",
      instanceId: expensive.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 2,
    }));
    expect(legalIntents(s, 0).some(
      (intent) => intent.kind === "activate-ability" &&
        intent.sourceInstanceId === weapon.instanceId,
    )).toBe(false);
    expect(actionCandidates(s, 0)).toContainEqual(expect.objectContaining({
      kind: "activate-ability",
      sourceInstanceId: weapon.instanceId,
      pitchInstanceIds: [],
      pitchRequired: 4,
    }));

    const invalid = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: expensive.instanceId,
      pitchInstanceIds: [],
    });
    expect(invalid.ok).toBe(false);
  });

  it("Rune Gate offers a banished card only with enough Runechants and replaces its printed cost", () => {
    let s = makeGame(71);
    const active = player(s, 0);
    const gated = { instanceId: s.nextInstanceId++, cardId: "RUNE_GATE", owner: 0 };
    active.banish.push(gated);
    active.board.push({ instanceId: s.nextInstanceId++, cardId: "RUNECHANT", owner: 0 });
    expect(legalIntents(s, 0).some((intent) => intent.kind === "play-from-zone" && intent.instanceId === gated.instanceId)).toBe(false);

    active.board.push({ instanceId: s.nextInstanceId++, cardId: "RUNECHANT", owner: 0 });
    const intent = legalIntents(s, 0).find(
      (candidate) => candidate.kind === "play-from-zone" && candidate.instanceId === gated.instanceId,
    );
    expect(intent).toMatchObject({ kind: "play-from-zone", zone: "banish", pitchInstanceIds: [] });
    const result = applyIntent(s, 0, intent!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    expect(s.chain.at(-1)?.attackingCard.counters?.runeGated).toBe(1);
  });

  it("every enumerated legal intent succeeds (seeded random playout)", () => {
    const carrier = { rngState: 123456 };
    const rand = () => rngNext(carrier);
    for (let game = 0; game < 5; game++) {
      let s = makeGame(100 + game);
      for (let step = 0; step < 300 && s.winner === null; step++) {
        const seat = s.pendingDecision?.player ?? s.priorityPlayer;
        const options = legalIntents(s, seat).filter((i) => i.kind !== "concede");
        expect(options.length).toBeGreaterThan(0);
        const intent = options[Math.floor(rand() * options.length)]!;
        const r = applyIntent(s, seat, intent);
        expect(r.ok, `step ${step} game ${game}: ${JSON.stringify(intent)} → ${r.ok ? "" : r.error}`).toBe(true);
        if (!r.ok) return;
        s = r.state;
      }
    }
  });

  it("playing out of turn is rejected", () => {
    const s = makeGame(11);
    const card = player(s, 1).deck[0]!;
    player(s, 1).hand.push(card);
    const r = applyIntent(s, 1, { kind: "play-card", instanceId: card.instanceId, pitchInstanceIds: [] });
    expect(r.ok).toBe(false);
  });
});

describe("projection", () => {
  it("hides opponent hand but exposes counts and public zones", () => {
    let s = makeGame(12);
    const atk = giveCard(s, 0, "ATK4");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const view1 = projectStateFor(s, 1);
    const expectedHand = player(s, 0).hand.length;
    expect(view1.players[0]!.hand).toHaveLength(0);
    expect(view1.players[0]!.handCount).toBe(expectedHand);
    expect(view1.players[0]!.deckCount).toBeGreaterThan(0);
    const view0 = projectStateFor(s, 0);
    expect(view0.players[0]!.hand.length).toBe(expectedHand);
    expect(view0.chain).toHaveLength(1);
    expect(view0.chain[0]!.attackValue).toBe(4);
  });

  it("projects established combat prevention during reaction and prevention decisions", () => {
    const s = makeGame(122);
    const attackingCard = player(s, 0).hand.shift()!;
    attackingCard.cardId = "ATK4";
    s.chain.push({
      attacker: 0,
      attackingCard,
      attackCardType: "action",
      defendingCards: [],
      defendingEquipment: [],
      reactions: [],
      goAgain: false,
      damage: 0,
      hit: false,
      resolved: false,
      flags: {},
    });
    player(s, 1).flags.preventNextDamage = 2;
    const shieldSource = player(s, 1).hand.shift()!;
    shieldSource.cardId = "INSTANT";
    player(s, 1).graveyard.push(shieldSource);
    s.modifiers.push({
      id: s.nextModifierId++,
      sourceInstanceId: shieldSource.instanceId,
      sourceCardId: shieldSource.cardId,
      seat: 1,
      scope: "until-end-of-turn",
      preventNextDamagePool: 2,
    });
    s.cardsRef = {
      ...s.cardsRef,
      FIXED_PREVENTION: {
        id: "FIXED_PREVENTION",
        name: "Fixed Prevention",
        cardType: "token",
        classes: ["generic"],
        subtypes: ["aura"],
        text: "Prevent 2 damage.",
      },
      WARD_THREE: {
        id: "WARD_THREE",
        name: "Ward Three",
        cardType: "token",
        classes: ["generic"],
        subtypes: ["aura"],
        keywords: ["Ward 3"],
        text: "Ward 3",
      },
    };
    s.scriptsRef = {
      ...s.scriptsRef,
      FIXED_PREVENTION: { fixedDamagePrevention: { amount: 2 } },
    };
    player(s, 1).board.push(
      {
        instanceId: s.nextInstanceId++,
        cardId: "FIXED_PREVENTION",
        owner: 1,
      },
      {
        instanceId: s.nextInstanceId++,
        cardId: "WARD_THREE",
        owner: 1,
      },
    );

    for (const viewer of [0, 1, null] as const) {
      // The full shield, fixed prevention, and Ward are shown even though
      // this attack currently threatens only 4 damage.
      expect(projectStateFor(s, viewer).chain[0]?.damageToPrevent).toBe(7);
      expect(projectStateFor(s, viewer).chain[0]?.preventionModifiers).toEqual([
        { sourceCardId: "FIXED_PREVENTION", amount: 2 },
        { sourceCardId: "INSTANT", amount: 2 },
        { sourceCardId: "WARD_THREE", amount: 3 },
      ]);
    }

    // Token-created effects retain their snapshotted public source identity
    // after the source itself ceases to exist.
    player(s, 1).graveyard = [];
    expect(projectStateFor(s, 0).chain[0]?.preventionModifiers).toEqual([
      { sourceCardId: "FIXED_PREVENTION", amount: 2 },
      { sourceCardId: "INSTANT", amount: 2 },
      { sourceCardId: "WARD_THREE", amount: 3 },
    ]);

    s.pendingDecision = {
      player: 1,
      kind: "optional-effect",
      prompt: "Prevent damage?",
      options: ["no"],
      chooseHook: "optional-damage-prevention",
      arcane: {
        sourceInstanceId: attackingCard.instanceId,
        sourceSeat: 0,
        targetSeat: 1,
        amount: 1,
        arcane: false,
        combat: true,
      },
    };

    for (const viewer of [0, 1, null] as const) {
      expect(projectStateFor(s, viewer).chain[0]?.damageToPrevent).toBe(7);
    }

    s.pendingDecision = null;
    player(s, 1).flags.preventNextDamage = 0;
    player(s, 1).board = [];
    expect(projectStateFor(s, 0).chain[0]?.damageToPrevent).toBeUndefined();
    expect(projectStateFor(s, 0).chain[0]?.preventionModifiers).toBeUndefined();
  });

  it("reveals both hands and both decks in draw order only after game end", () => {
    const s = makeGame(120);
    const arsenalCard = s.players[1]!.hand.shift()!;
    arsenalCard.faceDown = true;
    s.players[1]!.arsenal.push(arsenalCard);
    const hands = s.players.map((candidate) => candidate.hand.map((card) => card.instanceId));
    const decks = s.players.map((candidate) => candidate.deck.map((card) => card.instanceId));

    const activeView = projectStateFor(s, 0);
    expect(activeView.players[1]!.hand).toEqual([]);
    expect(activeView.players[1]!.arsenal).toEqual([]);
    expect(activeView.players[1]!.arsenalCount).toBe(1);
    expect(activeView.players[0]!.deck).toBeUndefined();
    expect(activeView.players[1]!.deck).toBeUndefined();

    s.winner = 0;
    s.phase = "game-over";
    for (const viewer of [0, 1, null] as const) {
      const finishedView = projectStateFor(s, viewer);
      expect(finishedView.players[0]!.hand.map((card) => card.instanceId)).toEqual(hands[0]);
      expect(finishedView.players[1]!.hand.map((card) => card.instanceId)).toEqual(hands[1]);
      expect(finishedView.players[0]!.deck?.map((card) => card.instanceId)).toEqual(decks[0]);
      expect(finishedView.players[1]!.deck?.map((card) => card.instanceId)).toEqual(decks[1]);
      expect(finishedView.players[1]!.arsenal.map((card) => card.instanceId)).toEqual([
        arsenalCard.instanceId,
      ]);
    }
  });

  it("creates a full-information replay projection without changing live visibility", () => {
    const s = makeGame(121);
    const arsenalCard = s.players[1]!.hand.shift()!;
    arsenalCard.faceDown = true;
    s.players[1]!.arsenal.push(arsenalCard);

    const live = projectStateFor(s, 0);
    const replay = projectStateForReplay(s);

    expect(live.players[1]!.hand).toEqual([]);
    expect(live.players[1]!.arsenal).toEqual([]);
    expect(live.players[1]!.deck).toBeUndefined();
    expect(replay.players[0]!.hand.length).toBeGreaterThan(0);
    expect(replay.players[1]!.hand.length).toBeGreaterThan(0);
    expect(replay.players[1]!.arsenal[0]!.instanceId).toBe(arsenalCard.instanceId);
    expect(replay.players[0]!.deck?.length).toBeGreaterThan(0);
    expect(replay.players[1]!.deck?.length).toBeGreaterThan(0);
  });
});

describe("trigger stack & priority windows", () => {
  it("mentor starts face down; start-of-turn trigger offers the flip, decline keeps it inert", () => {
    let s = makeGame(21, undefined, "MENTOR");
    expect(s.phase).toBe("start");
    expect(s.stack).toHaveLength(1);
    expect(player(s, 0).arsenal[0]!.faceDown).toBe(true);
    expect(s.pendingDecision?.kind).toBe("optional-effect");
    expect(s.pendingDecision?.player).toBe(0);
    expect(s.pendingDecision?.defaultOption).toBe("yes");
    expect(projectStateFor(s, 0).pendingDecision?.defaultOption).toBe("yes");
    expect(projectStateFor(s, 1).pendingDecision?.defaultOption).toBeUndefined();

    // a malformed option is rejected instead of silently declining the trigger
    let r = applyIntent(s, 0, { kind: "choose", optionId: "bogus" });
    expect(r.ok).toBe(false);

    // decline: stays face down, action phase begins, mentor hook stays inert
    r = applyIntent(s, 0, { kind: "choose", optionId: "no" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("action");
    expect(player(s, 0).arsenal[0]!.faceDown).toBe(true);
    const atk = giveCard(s, 0, "ATK4");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).flags.mentorFired).toBeFalsy();
  });

  it("accepting the flip turns the mentor face up and enables its hooks", () => {
    let s = makeGame(22, undefined, "MENTOR");
    let r = applyIntent(s, 0, { kind: "choose", optionId: "yes" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("action");
    expect(player(s, 0).arsenal[0]!.faceDown).toBe(false);
    const atk = giveCard(s, 0, "ATK4");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).flags.mentorFired).toBe(true);
  });

  it("optional trigger is answered before any priority window; flip happens immediately", () => {
    let s = makeGame(28, undefined, "MENTOR");
    giveCard(s, 1, "INSTANT"); // a window would open — but the trigger choice comes first
    expect(s.pendingDecision?.kind).toBe("optional-effect");
    expect(s.pendingDecision?.player).toBe(0);

    const r = applyIntent(s, 0, { kind: "choose", optionId: "yes" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).arsenal[0]!.faceDown).toBe(false); // trigger resolved right away
    // no trailing priority window over an empty stack — straight back to the
    // action phase once the last layer has resolved
    expect(s.phase).toBe("action");
  });

  it("face-down mentor is secret to the opponent; flipping it face up makes it public", () => {
    let s = makeGame(29, undefined, "MENTOR");
    // trigger pending for seat 0; mentor still face down
    const opp = projectStateFor(s, 1);
    expect(opp.players[0]!.arsenal).toHaveLength(0);
    expect(opp.players[0]!.arsenalCount).toBe(1);
    expect(opp.stack[0]!.card).toBeNull();
    expect(opp.pendingDecision?.prompt).toBe(""); // not the decider
    expect(opp.log.every((l) => !l.includes("Test Mentor"))).toBe(true);

    const self = projectStateFor(s, 0);
    expect(self.players[0]!.arsenal[0]!.cardId).toBe("MENTOR");
    expect(self.stack[0]!.card?.cardId).toBe("MENTOR");
    expect(self.pendingDecision?.prompt).toContain("Test Mentor");

    // flip face up: now public to the opponent
    const r = applyIntent(s, 0, { kind: "choose", optionId: "yes" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const oppAfter = projectStateFor(s, 1);
    expect(oppAfter.players[0]!.arsenal[0]?.cardId).toBe("MENTOR");
  });

  it("attack declaration opens a priority window; defender responds with an instant", () => {
    let s = makeGame(23);
    const atk = giveCard(s, 0, "ATK4");
    const sigil = giveCard(s, 1, "INSTANT");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(s.pendingDecision?.kind).toBe("priority-window");
    expect(s.priorityPlayer).toBe(0); // attacker holds priority first
    expect(projectStateFor(s, 1).chain[0]!.attackingCard.cardId).toBe("ATK4");
    expect(projectStateFor(s, 0).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.priority.card",
      values: { card: { kind: "card", cardId: "ATK4" } },
    });

    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.priorityPlayer).toBe(1);

    // defender responds with an instant (no AP involved): it goes on the stack
    // as a layer and keeps priority with the defender — nothing resolves yet
    r = applyIntent(s, 1, { kind: "play-card", instanceId: sigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.priorityPlayer).toBe(1); // playing a card does not pass priority
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0]!.card?.instanceId).toBe(sigil);
    expect(player(s, 1).life).toBe(20); // the effect waits for both players to pass
    expect(projectStateFor(s, 1).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.priority.card",
      values: { card: { kind: "card", cardId: "INSTANT" } },
    });

    // both pass in succession → the instant resolves; with nobody left able to
    // respond, the attack then becomes attacking and the defend decision appears
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(21);
    expect(s.phase).toBe("defend");
    expect(s.pendingDecision?.kind).toBe("defend");
    expect(projectStateFor(s, 1).pendingDecision?.promptMessage).toEqual({
      id: "engine.decision.defend",
      values: {
        card: { kind: "card", cardId: "ATK4" },
        attack: 4,
      },
    });
  });

  it("a declared attack projects as on-stack until both pass; then its chain link starts", () => {
    let s = makeGame(31);
    const atk = giveCard(s, 0, "ATK4");
    giveCard(s, 1, "INSTANT"); // a response exists → the attack window opens
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(projectStateFor(s, 1).chain[0]!.onStack).toBe(true);

    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // The attack-layer resolved: it is now attacking and no longer on the
    // stack. The Attack Step has its own priority point before defense.
    expect(s.pendingDecision?.kind).toBe("priority-window");
    expect(projectStateFor(s, 1).chain[0]!.onStack).toBeUndefined();
    expect(projectStateFor(s, 1).stackContext).toBe("ATTACK STEP · TRIGGERS");

    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("defend");
  });

  it("a non-attack action rides the stack: effects and go again resolve after both pass", () => {
    let s = makeGame(32);
    const pump = giveCard(s, 0, "PUMP");
    giveCard(s, 1, "INSTANT"); // the defender can respond → a window opens
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: pump, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // played but not resolved: on the stack, no effect, no go-again refund yet
    expect(s.phase).toBe("layer");
    expect(s.pendingDecision?.kind).toBe("priority-window");
    expect(s.stack[0]!.card?.cardId).toBe("PUMP");
    expect(player(s, 0).actionPoints).toBe(0);
    expect(s.modifiers.some((m) => m.scope === "next-attack")).toBe(false);
    expect(player(s, 0).graveyard).toHaveLength(0);

    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // the layer resolved — effect applied, go again refunded — and with the
    // stack now empty there is no trailing window: back to the action phase
    expect(player(s, 0).actionPoints).toBe(1);
    expect(s.modifiers.some((m) => m.scope === "next-attack")).toBe(true);
    expect(player(s, 0).graveyard.map((c) => c.cardId)).toContain("PUMP");
    expect(s.phase).toBe("action");
  });

  it("a non-attack action waits for priority even when nobody can respond", () => {
    let s = makeGame(33);
    const pump = giveCard(s, 0, "PUMP");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: pump, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(s.stack[0]?.card?.instanceId).toBe(pump);
    expect(player(s, 0).actionPoints).toBe(0);
    expect(s.modifiers.some((m) => m.scope === "next-attack")).toBe(false);

    s = passTopLayer(s);
    expect(s.phase).toBe("action");
    expect(player(s, 0).actionPoints).toBe(1);
    expect(s.modifiers.some((m) => m.scope === "next-attack")).toBe(true);
  });

  it("an initial triggered layer waits for priority even when nobody can respond", () => {
    let s = makeGame(122);
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        ...s.scriptsRef.HERO_A,
        triggers: [{
          event: "card-played",
          label: "Gain 1 life",
          effect(ctx) {
            ctx.gainLife(ctx.seat, 1);
          },
        }],
      },
    };
    const pump = giveCard(s, 0, "PUMP");

    const result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: pump,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;

    expect(s.stack).toHaveLength(2);
    expect(s.stack[0]?.card).toBeUndefined();
    expect(s.stack[0]?.label).toBe("Gain 1 life");
    expect(s.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(player(s, 0).life).toBe(20);

    s = passTopLayer(s);
    expect(player(s, 0).life).toBe(21);
    expect(s.stack[0]?.card?.instanceId).toBe(pump);
  });

  it("pauses on the next triggered layer after a response resolves", () => {
    let s = makeGame(123);
    s.scriptsRef = {
      ...s.scriptsRef,
      HERO_A: {
        ...s.scriptsRef.HERO_A,
        triggers: [{
          event: "card-played",
          label: "Gain 1 life",
          effect(ctx) {
            ctx.gainLife(ctx.seat, 1);
          },
        }],
      },
    };
    const pump = giveCard(s, 0, "PUMP");
    const response = giveCard(s, 1, "INSTANT");

    let result = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: pump,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;

    expect(s.stack).toHaveLength(2);
    expect(s.stack[0]?.card).toBeUndefined();
    expect(s.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
    expect(player(s, 0).life).toBe(20);

    result = applyIntent(s, 0, { kind: "pass" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    result = applyIntent(s, 1, {
      kind: "play-card",
      instanceId: response,
      pitchInstanceIds: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    s = result.state;
    s = passTopLayer(s);

    expect(player(s, 1).life).toBe(21);
    expect(s.stack).toHaveLength(2);
    expect(s.stack[0]?.card).toBeUndefined();
    expect(s.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });

    s = passTopLayer(s);
    expect(player(s, 0).life).toBe(21);
    expect(s.stack[0]?.card?.instanceId).toBe(pump);
    expect(s.pendingDecision).toMatchObject({ kind: "priority-window", player: 0 });
  });

  it("the turn player can close the combat chain manually once the last link resolved", () => {
    let s = makeGame(34);
    const atk = giveCard(s, 0, "ATK4");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // mid-link: not offered to anyone
    expect(legalIntents(s, 0).some((i) => i.kind === "close-chain")).toBe(false);
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain[0]!.resolved).toBe(true);
    // open chain: offered to the turn player, not the opponent
    expect(legalIntents(s, 0).some((i) => i.kind === "close-chain")).toBe(true);
    expect(legalIntents(s, 1).some((i) => i.kind === "close-chain")).toBe(false);

    r = applyIntent(s, 0, { kind: "close-chain" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain).toHaveLength(0);
    expect(player(s, 0).graveyard.map((c) => c.cardId)).toContain("ATK4");
    expect(s.phase).toBe("action"); // the turn continues
    expect(legalIntents(s, 0).some((i) => i.kind === "close-chain")).toBe(false);
  });

  it("staged defenders show for both players — face-down hand cards and 0 defense for the opponent", () => {
    let s = makeGame(35);
    const atk = giveCard(s, 0, "ATK4");
    const block = giveCard(s, 1, "BLOCK3");
    player(s, 1).equipment.chest = { instanceId: 994, cardId: "BW", owner: 1 };
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("defend");

    // only the defender may stage, and only eligible defenders
    r = applyIntent(s, 0, { kind: "stage-defenders", instanceIds: [] });
    expect(r.ok).toBe(false);
    const mentor = giveCard(s, 1, "MENTOR"); // no defense stat — cannot defend
    r = applyIntent(s, 1, { kind: "stage-defenders", instanceIds: [mentor] });
    expect(r.ok).toBe(false);

    // stage a hand card + an equipment (declarative full set)
    r = applyIntent(s, 1, { kind: "stage-defenders", instanceIds: [block, 994] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // staging is cosmetic: the cards stay in their zones until the commit
    expect(player(s, 1).hand.some((c) => c.instanceId === block)).toBe(true);
    expect(player(s, 1).equipment.chest?.instanceId).toBe(994);

    const mine = projectStateFor(s, 1).pendingDecision;
    expect(mine?.stagedCards?.map((c) => c.cardId)).toEqual(["BLOCK3", "BW"]);
    expect(mine?.stagedDefense).toBe(5); // 3 + 2
    const opp = projectStateFor(s, 0).pendingDecision;
    expect(opp?.stagedCards?.[0]!.hidden).toBe(true); // hand card face-down
    expect(opp?.stagedCards?.[0]!.cardId).toBe("");
    expect(opp?.stagedCards?.[1]!.cardId).toBe("BW"); // equipment stays public
    expect(opp?.stagedDefense).toBe(0);

    // unstage the equipment declaratively, then commit the rest
    r = applyIntent(s, 1, { kind: "stage-defenders", instanceIds: [block] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(projectStateFor(s, 1).pendingDecision?.stagedCards).toHaveLength(1);
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [block] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).not.toBe("defend");
  });

  it("advertises the exact staged defense when more than four hand cards are selected", () => {
    let s = makeGame(36);
    player(s, 1).hand = [];
    const defenders = Array.from({ length: 5 }, () => giveCard(s, 1, "BLOCK3"));
    const atk = giveCard(s, 0, "ATK4");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    r = applyIntent(s, 1, { kind: "stage-defenders", instanceIds: defenders });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    const exact = legalIntents(s, 1).find((intent) =>
      intent.kind === "defend" &&
      intent.instanceIds.length === defenders.length &&
      defenders.every((id) => intent.instanceIds.includes(id)),
    );
    expect(exact).toBeDefined();
    if (!exact) return;
    r = applyIntent(s, 1, exact);
    expect(r.ok).toBe(true);
  });

  it("go again granted on hit re-enables a once-per-turn weapon (Dorinthea pattern)", () => {
    let s = makeGame(30);
    player(s, 0).weapons = [{ instanceId: 997, cardId: "BLADE", owner: 0 }];
    const blue = giveCard(s, 0, "BLUE");
    let r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: 997,
      pitchInstanceIds: [blue],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // Damage is dealt in the Damage Step, then the on-hit ability becomes a
    // layer and the turn-player gets priority before that ability resolves.
    expect(player(s, 1).life).toBe(17);
    expect(player(s, 0).actionPoints).toBe(0);
    expect(s.chain[0]!.resolved).toBe(false);
    expect(s.stack[0]?.engineEffect?.kind).toBe("on-hit-hook");
    expect(s.pendingDecision?.kind).toBe("priority-window");
    expect(projectStateFor(s, 0).stackContext).toBe("DAMAGE STEP · ON-HIT TRIGGERS");
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // The trigger has resolved and the attack has entered its Resolution Step:
    // go again refunds the AP and Dorinthea re-enables the weapon.
    expect(player(s, 0).actionPoints).toBe(1);
    expect(s.chain[0]!.resolved).toBe(true);
    expect(s.chain).toHaveLength(1); // chain still open — past link browsable
    // floating resources left from the first pitch cover the second activation
    r = applyIntent(s, 0, {
      kind: "activate-ability",
      sourceInstanceId: 997,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain).toHaveLength(2); // second attack is a new link on the same chain
  });

  it("priority window is skipped when nobody holds a playable instant", () => {
    let s = makeGame(24);
    const atk = giveCard(s, 0, "ATK4");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("defend"); // straight to the defend step
  });

  it("instants played in the action phase cost no action points", () => {
    let s = makeGame(25);
    const sigil = giveCard(s, 0, "INSTANT");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: sigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 0).actionPoints).toBe(1);
    expect(player(s, 0).life).toBe(20);
    s = passTopLayer(s);
    expect(player(s, 0).life).toBe(21);
  });

  it("intimidate on a non-attack action resolves after priority, then the turn continues", () => {
    let s = makeGame(29);
    const bellow = giveCard(s, 0, "BELLOW");
    giveCard(s, 1, "BLOCK3"); // defender has a card to banish
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: bellow, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(player(s, 1).banish.every((c) => c.intimidated !== true)).toBe(true);
    s = passTopLayer(s);
    expect(player(s, 0).actionPoints).toBe(1); // go again refunded
    // a random card is banished on resolution — no decision for the defender
    expect(player(s, 1).banish.filter((c) => c.intimidated === true)).toHaveLength(1);
    expect(s.pendingDecision).toBeNull();
    expect(s.phase).toBe("action"); // active player's turn continues
    // and the active player can still attack afterwards
    const atk = giveCard(s, 0, "ATK4");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.pendingDecision?.kind).toBe("defend");
  });

  it("priority holder may play several reactions before passing", () => {
    let s = makeGame(27);
    const atk = giveCard(s, 0, "ATK4");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const r1 = giveCard(s, 0, "REACT");
    const r2 = giveCard(s, 0, "REACT");
    r = applyIntent(s, 0, { kind: "play-card", instanceId: r1, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.priorityPlayer).toBe(0); // still the attacker's priority
    r = applyIntent(s, 0, { kind: "play-card", instanceId: r2, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.priorityPlayer).toBe(0);
    // both pass: the LAST reaction played resolves first (last-in, first-out)
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(6); // 4 + 2
    expect(player(s, 1).life).toBe(20); // the attack itself has not resolved
    // both pass again: the first reaction resolves
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(8); // 4 + 2 + 2
    // stack empty: a final pair of passes ends the reaction step
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(12); // 4 + 2 + 2
    // the resolved link keeps its buffed values even though the reaction
    // modifiers expired with it
    const view = projectStateFor(s, 0);
    expect(view.chain[0]!.resolved).toBe(true);
    expect(view.chain[0]!.attackValue).toBe(8);
  });

  it("defense reactions can be played from arsenal on the opponent's turn", () => {
    let s = makeGame(26);
    const atk = giveCard(s, 0, "ATK4");
    player(s, 1).arsenal.push({ instanceId: 998, cardId: "DREACT", owner: 1 });
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // reaction step: attacker passes, defender plays the arsenal'd defense reaction
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const handBefore = player(s, 1).hand.length;
    r = applyIntent(s, 1, { kind: "play-from-arsenal", instanceId: 998, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).arsenal).toHaveLength(0);
    // the reaction is a layer on the stack: the draw waits for its resolution
    expect(player(s, 1).hand.length).toBe(handBefore);
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).hand.length).toBe(handBefore + 1); // DREACT draws a card
  });

  it("an instant played in the action phase goes on the stack and opens a window", () => {
    let s = makeGame(37);
    const sigil = giveCard(s, 0, "INSTANT");
    const oppSigil = giveCard(s, 1, "INSTANT"); // the opponent can respond, so a window must open
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: sigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.phase).toBe("layer");
    expect(s.pendingDecision?.kind).toBe("priority-window");
    expect(s.priorityPlayer).toBe(0); // the player keeps priority after playing it
    expect(s.stack).toHaveLength(1);
    expect(player(s, 0).life).toBe(20); // nothing has resolved yet
    // turn player passes; the opponent responds with their own instant (stacked
    // on top — responses happen before resolution, while a layer is on the stack)
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "play-card", instanceId: oppSigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.stack).toHaveLength(2);
    expect(player(s, 1).life).toBe(20); // on the stack, not resolved
    // both pass in succession → the top layer (the opponent's instant) resolves
    // first; the original remains and receives its own priority round.
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(21);
    expect(player(s, 0).life).toBe(20);
    expect(s.stack).toHaveLength(1);
    s = passTopLayer(s);
    expect(player(s, 0).life).toBe(21);
    expect(s.phase).toBe("action");
    expect(player(s, 0).actionPoints).toBe(1); // instants never cost AP
    expect(player(s, 0).graveyard.some((c) => c.instanceId === sigil)).toBe(true);
  });

  it("keeps an item on the stack until its resolution choice is complete", () => {
    let s = makeGame(64);
    const item = giveCard(s, 0, "CHOICE_ITEM");
    giveCard(s, 1, "INSTANT"); // ensure both players receive priority over the item

    let r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: item,
      pitchInstanceIds: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.stack[0]?.card?.instanceId).toBe(item);
    expect(player(s, 0).board.some((card) => card.instanceId === item)).toBe(false);

    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    expect(s.pendingDecision?.chooseHook).toBe("choice-item");
    expect(s.stack[0]?.card?.instanceId).toBe(item);
    expect(player(s, 0).board.some((card) => card.instanceId === item)).toBe(false);
    expect(player(s, 0).flags.choiceItemEnteredAfterResolution).toBeUndefined();

    r = applyIntent(s, 0, { kind: "choose", optionId: "yes" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;

    expect(s.stack.some((layer) => layer.card?.instanceId === item)).toBe(false);
    expect(player(s, 0).board.some((card) => card.instanceId === item)).toBe(true);
    expect(player(s, 0).flags.choiceItemEnteredAfterResolution).toBe(true);
  });

  it("a second stacked defense reaction from hand fails to resolve against dominate (7.4.2d)", () => {
    let s = makeGame(38);
    const dom = giveCard(s, 0, "DOM");
    const dr1 = giveCard(s, 1, "DREACT");
    const dr2 = giveCard(s, 1, "DREACT");
    let r = applyIntent(s, 0, { kind: "play-card", instanceId: dom, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // no defenders declared: nothing has defended from hand yet
    r = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // both defense reactions may be PLAYED from hand — dominate only checks at
    // resolution whether the card can become a defending card (7.4.2c/d)
    r = applyIntent(s, 1, { kind: "play-card", instanceId: dr1, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "play-card", instanceId: dr2, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    // both pass → the last-played reaction resolves first and defends from hand
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.chain[0]!.defendingCards.some((c) => c.instanceId === dr2)).toBe(true);
    // both pass → the first reaction now fails to resolve (Dominate)
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.log.some((l) => l.publicText?.includes("fails to resolve (Dominate)"))).toBe(true);
    expect(player(s, 1).graveyard.some((c) => c.instanceId === dr1)).toBe(true);
    expect(s.chain[0]!.defendingCards.some((c) => c.instanceId === dr1)).toBe(false);
    // stack empty: both pass → 6 - 3 = 3 damage
    r = applyIntent(s, 0, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    r = applyIntent(s, 1, { kind: "pass" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(player(s, 1).life).toBe(17);
  });
});

describe("ongoing effects", () => {
  it("lingering modifiers are projected with the affected seat and a label", () => {
    let s = makeGame(50);
    const pump = giveCard(s, 0, "PUMP");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: pump, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    s = passTopLayer(s);
    const mine = projectStateFor(s, 0).ongoing;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toEqual({ seat: 0, cardId: "PUMP", label: "+2 attack · next attack" });
    // the effect is public: the opponent sees it too
    const theirs = projectStateFor(s, 1).ongoing;
    expect(theirs).toHaveLength(1);
    expect(theirs[0]!.cardId).toBe("PUMP");

    // it buffs only the creator's next attack, then leaves the projection
    const atk = giveCard(s, 0, "ATK4");
    const r2 = applyIntent(s, 0, { kind: "play-card", instanceId: atk, pitchInstanceIds: [] });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    s = r2.state;
    expect(projectStateFor(s, 0).chain[0]!.attackValue).toBe(6); // 4 + 2
    expect(projectStateFor(s, 0).chain[0]!.attackModifiers).toContainEqual({
      sourceCardId: "PUMP",
      amount: 2,
    });
    // consumed: it moved onto the chain link, so the lingering chip is gone
    expect(projectStateFor(s, 0).ongoing).toHaveLength(0);

    let r3 = applyIntent(s, 1, { kind: "defend", instanceIds: [] });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    s = r3.state;
    r3 = applyIntent(s, 0, { kind: "pass" });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    s = r3.state;
    r3 = applyIntent(s, 1, { kind: "pass" });
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    s = r3.state;
    expect(projectStateFor(s, 0).chain[0]!.attackModifiers).toContainEqual({
      sourceCardId: "PUMP",
      amount: 2,
    });
  });

  it("projects delayed Crush restrictions on the affected opponent", () => {
    const s = makeGame(51);
    const opponent = player(s, 1);
    opponent.hero.counters = {
      firstActionExtraCostTurn: s.turn,
      firstActionExtraCost: 1,
      halveBaseAttackActionUntil: s.turn + 1,
      attackActionBasePowerLimitUntilTurn: s.turn + 1,
      attackActionBasePowerLimit: 3,
      attackActionNoPowerGainUntilTurn: s.turn + 1,
      cannotDrawActionTurn: s.turn + 1,
    };

    for (const viewer of [0, 1] as const) {
      const effects = projectStateFor(s, viewer).ongoing;
      expect(effects).toHaveLength(5);
      expect(effects.every((effect) => effect.seat === 1)).toBe(true);
      expect(effects.every((effect) => effect.cardId === "")).toBe(true);
      expect(effects.map((effect) => effect.label)).toEqual(expect.arrayContaining([
        expect.stringContaining("base attack 3 or less"),
        expect.stringContaining("can't gain attack"),
        expect.stringContaining("next action costs +1 resource"),
      ]));
    }
  });
});

describe("meld split cards", () => {
  it("has both split-card types outside the stack", () => {
    const s = makeGame(58);
    const split = giveCard(s, 0, "SPLIT");
    const card = player(s, 0).hand.find((candidate) => candidate.instanceId === split)!;

    expect(card.meldSide).toBeUndefined();
    expect(cardHasType(s, card, "action")).toBe(true);
    expect(cardHasType(s, card, "instant")).toBe(true);
  });

  it("rejects missing meld announcements and announcements on ordinary cards", () => {
    const s = makeGame(59);
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    expect(applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
    })).toMatchObject({ ok: false, error: "choose a meld side" });

    const ordinary = giveCard(s, 0, "INSTANT");
    expect(applyIntent(s, 0, {
      kind: "play-card",
      instanceId: ordinary,
      pitchInstanceIds: [],
      meldSide: "both",
    })).toMatchObject({ ok: false, error: "Test Sigil does not have meld" });
  });

  it("playing the left or right side costs the base cost and runs that side", () => {
    let s = makeGame(60);
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    const r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
      meldSide: "left",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    s = passTopLayer(s);
    expect(player(s, 0).life).toBe(21); // left half: +1
    expect(player(s, 0).resources).toBe(1); // pitched 3 for a cost of 2
    expect(player(s, 0).actionPoints).toBe(0); // the action half consumes 1 AP
    const resolved = player(s, 0).graveyard.find((card) => card.instanceId === split)!;
    expect(resolved.meldSide).toBeUndefined();
    expect(cardHasType(s, resolved, "action")).toBe(true);
    expect(cardHasType(s, resolved, "instant")).toBe(true);
  });

  it("meld 'both' costs twice the base cost and runs right then left", () => {
    let s = makeGame(61);
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    const yel = giveCard(s, 0, "YEL");
    // 2 x base cost 2 = 4: a single blue (3) does not cover it
    let r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
      meldSide: "both",
    });
    expect(r.ok).toBe(false);
    r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue, yel],
      meldSide: "both",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    s = passTopLayer(s); // right half
    s = passTopLayer(s); // left half
    expect(player(s, 0).life).toBe(23); // right (+2) then left (+1)
    expect(player(s, 0).actionPoints).toBe(0); // meld includes the action half
  });

  it("the instant half is AP-free while the action half requires an action point", () => {
    let s = makeGame(64);
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    player(s, 0).actionPoints = 0;

    const sides = legalIntents(s, 0)
      .flatMap((intent) => intent.kind === "play-card" && intent.instanceId === split
        ? [intent.meldSide]
        : []);
    expect(new Set(sides)).toEqual(new Set(["right"]));
    expect(applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
      meldSide: "left",
    })).toMatchObject({ ok: false, error: "not enough action points" });

    player(s, 0).actionPoints = 1;
    const right = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
      meldSide: "right",
    });
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    s = right.state;
    expect(player(s, 0).actionPoints).toBe(1);
  });

  it("only the instant half is playable in a priority window", () => {
    let s = makeGame(65);
    const opener = giveCard(s, 0, "INSTANT");
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    const opened = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: opener,
      pitchInstanceIds: [],
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    s = opened.state;

    const sides = legalIntents(s, 0)
      .flatMap((intent) => intent.kind === "play-card" && intent.instanceId === split
        ? [intent.meldSide]
        : []);
    expect(new Set(sides)).toEqual(new Set(["right"]));
    expect(applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue],
      meldSide: "both",
    })).toMatchObject({
      ok: false,
      error: "only instants can be played in a priority window",
    });
  });

  it("legal intents offer one variant per side with the doubled pitch for 'both'", () => {
    const s = makeGame(62);
    giveCard(s, 0, "SPLIT");
    giveCard(s, 0, "BLUE");
    giveCard(s, 0, "YEL");
    const plays = legalIntents(s, 0).filter(
      (i): i is Extract<GameIntent, { kind: "play-card" }> => i.kind === "play-card",
    );
    const splitPlays = plays.filter((i) => {
      const c = player(s, 0).hand.find((x) => x.instanceId === i.instanceId);
      return c?.cardId === "SPLIT";
    });
    const sides = new Set(splitPlays.map((i) => i.meldSide));
    expect(sides).toEqual(new Set(["left", "right", "both"]));
    // "both" requires pitches covering 4 (blue+yellow); left/right need just 2
    const both = splitPlays.filter((i) => i.meldSide === "both");
    expect(both.length).toBeGreaterThan(0);
    for (const i of both) {
      const total = i.pitchInstanceIds.reduce(
        (sum, id) => sum + (cards[player(s, 0).hand.find((x) => x.instanceId === id)!.cardId]?.pitch ?? 0),
        0,
      );
      expect(total).toBeGreaterThanOrEqual(4);
    }
    expect(splitPlays.some((i) => i.meldSide === "left" && i.pitchInstanceIds.length === 1)).toBe(
      true,
    );
  });

  it("a melded layer resolves right half, opens priority, then resolves the left half", () => {
    let s = makeGame(63);
    const split = giveCard(s, 0, "SPLIT");
    const blue = giveCard(s, 0, "BLUE");
    const yel = giveCard(s, 0, "YEL");
    const sigil = giveCard(s, 1, "INSTANT"); // the opponent can respond
    let r = applyIntent(s, 0, {
      kind: "play-card",
      instanceId: split,
      pitchInstanceIds: [blue, yel],
      meldSide: "both",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    const passOnce = () => {
      const pr = applyIntent(s, s.priorityPlayer, { kind: "pass" });
      expect(pr.ok).toBe(true);
      if (pr.ok) s = pr.state;
    };
    // a response is available, so the instant rides the stack: priority window
    expect(s.pendingDecision?.kind).toBe("priority-window");
    passOnce(); // seat 0
    passOnce(); // seat 1 — both passed: the right half resolves
    expect(player(s, 0).life).toBe(22); // right half: +2
    // the layer stays on the stack for its second resolution, priority passes again
    expect(s.stack).toHaveLength(1);
    expect(s.stack[0]!.meldStage).toBe(2);
    expect(s.pendingDecision?.kind).toBe("priority-window");
    passOnce(); // seat 0 passes; the opponent responds with an instant between halves
    r = applyIntent(s, 1, { kind: "play-card", instanceId: sigil, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    passOnce(); // seat 1
    passOnce(); // seat 0 — the sigil resolves on top
    expect(player(s, 1).life).toBe(21);
    // The left half still receives its own priority round before it resolves.
    passOnce();
    passOnce();
    expect(player(s, 0).life).toBe(23);
    expect(s.stack).toHaveLength(0);
    expect(s.phase).toBe("action");
  });
});

describe("state-based destroy-at-zero-counter", () => {
  const placeAura = (s: ReturnType<typeof makeGame>, charges?: number) => {
    const aura = {
      instanceId: s.nextInstanceId++,
      cardId: "AURA",
      owner: 0,
      ...(charges !== undefined ? { counters: { charge: charges } } : {}),
    };
    player(s, 0).board.push(aura);
    return aura;
  };

  it("destroys the permanent when its named counter is reduced to 0", () => {
    let s = makeGame(70);
    placeAura(s, 1);
    const zap = giveCard(s, 0, "ZAP");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: zap, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    s = passTopLayer(s);
    expect(player(s, 0).board).toHaveLength(0);
    expect(player(s, 0).graveyard.map((c) => c.cardId)).toContain("AURA");
  });

  it("spares it above 0, and spares a card that never received the counter", () => {
    let s = makeGame(71);
    placeAura(s, 2); // ZAP takes it to 1: survives
    placeAura(s); // never received a counter: not state-destroyed
    const zap = giveCard(s, 0, "ZAP");
    const r = applyIntent(s, 0, { kind: "play-card", instanceId: zap, pitchInstanceIds: [] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    s = passTopLayer(s);
    expect(player(s, 0).board).toHaveLength(2);
    expect(player(s, 0).board[0]!.counters?.charge).toBe(1);
  });
});
