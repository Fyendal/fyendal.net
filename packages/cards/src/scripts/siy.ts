import type {
  CardInstance,
  CardScript,
  DeepReadonly,
  ScriptCtx,
} from "@fyendal/engine";
import {
  commonOptionMessages,
  dealArcane,
  type DecisionPromptOptions,
  decisionMessage,
  decisionPrompt,
  opponentSeat,
  wizardActionAsInstant,
} from "./shared-helpers.js";

// ── SIY (Silver Age Chapter 1: Iyslander precon) ───────────────────────────
// Ice Fusion reuses the engine's card-backed additional-cost pause. Frostbite
// uses generic static-cost and friendly-play/activation hooks so every copy
// stacks and then destroys itself after the taxed event.

const FROSTBITE = "SIY035";

function isWizardNonAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (
    ctx.hasCardType(card, "action") &&
    !ctx.cardTypes(card).includes("attack") &&
    ctx.cardTypes(card).includes("wizard")
  );
}

function fusionAdditionalCost(ctx: ScriptCtx): void {
  const ice = ctx.player(ctx.seat).hand.filter((card) => ctx.cardTypes(card).includes("ice"));
  if (ice.length === 0) return;
  ctx.requestCardChoice(
    "ice-fusion",
    decisionPrompt(
      `${ctx.data.name}: reveal an Ice card from your hand to fuse?`,
      "card.siy.fusion.reveal",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    [...ice.map((card) => card.instanceId), "no"],
  );
}

function handleFusion(ctx: ScriptCtx, hook: string, option: string): boolean {
  if (hook !== "ice-fusion") return false;
  if (option === "no") return true;
  const revealed = ctx.player(ctx.seat).hand.find((card) => card.instanceId === Number(option));
  if (!revealed) return true;
  ctx.setCounter("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  ctx.setFlag("player", "iceFusedThisTurn", true);
  for (const target of [0, 1]) {
    const key = `nextIceFusionFrostbites:${target}`;
    const count = Number(ctx.getPlayerFlag(ctx.seat, key));
    ctx.createTokens(FROSTBITE, count, target);
    ctx.setPlayerFlag(ctx.seat, key, 0);
  }
  ctx.logPublic(`${ctx.data.name} is fused (reveals ${ctx.cardData(revealed.cardId).name})`);
  return true;
}

function iceEternalAdditionalCost(ctx: ScriptCtx): void {
  fusionAdditionalCost(ctx);
}

function isFused(ctx: ScriptCtx): boolean {
  return ctx.getCounter("fused") > 0;
}

function requestHeroTarget(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  values?: DecisionPromptOptions["values"],
): void {
  ctx.requestChoice(
    hook,
    decisionPrompt(fallback, id, {
      values,
      optionMessages: commonOptionMessages("opposing hero", "your hero"),
    }),
    ["opposing hero", "your hero"],
  );
}

function requestAnyTarget(
  ctx: ScriptCtx,
  hook: string,
  fallback: string,
  id: string,
  values?: DecisionPromptOptions["values"],
): void {
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  for (const player of ctx.state.players) {
    for (const card of player.board) {
      if (!ctx.cardTypes(card).includes("ally")) continue;
      options.push(`ally:${player.seat}:${card.instanceId}`);
      cardOptions.push(card.instanceId);
    }
  }
  ctx.requestChoice(
    hook,
    decisionPrompt(fallback, id, {
      values,
      optionMessages: commonOptionMessages("opposing hero", "your hero"),
    }),
    options,
    ctx.seat,
    cardOptions,
  );
}

function targetSeat(ctx: ScriptCtx, option: string): number {
  return option === "your hero" ? ctx.seat : opponentSeat(ctx);
}

function dealToChosenTarget(ctx: ScriptCtx, option: string, damage: number): void {
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  ctx.setCounter("targetedAlly", ally ? 1 : 0);
  if (ally) {
    dealArcane(ctx, Number(ally[1]), damage, Number(ally[2]));
    return;
  }
  dealArcane(ctx, targetSeat(ctx, option), damage);
}

function arcaneSpell(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      const amount = ctx.previewArcaneDamage(damage);
      requestAnyTarget(
        ctx,
        "arcane-target",
        `${ctx.data.name}: deal ${amount} arcane damage to which target?`,
        "card.siy.arcane.target.choose",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount },
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "arcane-target") dealToChosenTarget(ctx, option, damage);
    },
  };
}

function discardUnlessPay(ctx: ScriptCtx, target: number, cost: number, key: string): void {
  const player = ctx.state.players[target]!;
  if (player.hand.length === 0) return;
  if (ctx.requestPayment(
    `${key}:pay:${target}`,
    decisionPrompt(
      `${ctx.data.name}: pay ${cost} resource${cost === 1 ? "" : "s"} or discard a card?`,
      "card.siy.discard.pay",
      {
        values: {
          card: { kind: "card", cardId: ctx.self.cardId },
          amount: cost,
        },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    cost,
    target,
  )) return;
  ctx.requestCardChoice(
    `${key}:discard:${target}`,
    decisionPrompt(
      `${ctx.data.name}: choose a card to discard`,
      "card.siy.discard.choose",
      { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
    ),
    player.hand.map((card) => card.instanceId),
    target,
  );
}

function handleDiscardUnlessPay(ctx: ScriptCtx, hook: string, option: string, key: string): boolean {
  const pay = new RegExp(`^${key}:pay:(\\d+)$`).exec(hook);
  if (pay) {
    const target = Number(pay[1]);
    const player = ctx.state.players[target]!;
    if (option === "paid") {
      ctx.logPublic(`${ctx.cardData(player.heroCardId).name} pays the resource cost`);
    } else if (player.hand.length > 0) {
      ctx.requestCardChoice(
        `${key}:discard:${target}`,
        decisionPrompt(
          `${ctx.data.name}: choose a card to discard`,
          "card.siy.discard.choose",
          { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
        ),
        player.hand.map((card) => card.instanceId),
        target,
      );
    }
    return true;
  }
  const discard = new RegExp(`^${key}:discard:(\\d+)$`).exec(hook);
  if (!discard) return false;
  ctx.discardCard(Number(discard[1]), Number(option));
  return true;
}

function aetherIcevein(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      const amount = ctx.previewArcaneDamage(damage);
      requestAnyTarget(
        ctx,
        "icevein-target",
        `${ctx.data.name}: deal ${amount} arcane damage to which target?`,
        "card.siy.arcane.target.choose",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount },
      );
    },
    onDamageDealt(ctx, target, amount, arcane) {
      if (arcane && amount > 0 && isFused(ctx) && ctx.getCounter("targetedAlly") === 0) {
        discardUnlessPay(ctx, target, 2, "icevein");
      }
    },
    onChoose(ctx, hook, option) {
      if (handleFusion(ctx, hook, option)) return;
      if (hook === "icevein-target") {
        dealToChosenTarget(ctx, option, damage);
        return;
      }
      handleDiscardUnlessPay(ctx, hook, option, "icevein");
    },
  };
}

function polarCap(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      const amount = ctx.previewArcaneDamage(damage);
      requestAnyTarget(
        ctx,
        "polar-target",
        `${ctx.data.name}: deal ${amount} arcane damage to which target?`,
        "card.siy.arcane.target.choose",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount },
      );
    },
    onDamageDealt(ctx, target, amount, arcane) {
      if (arcane && amount > 0 && isFused(ctx) && ctx.getCounter("targetedAlly") === 0) {
        ctx.createToken(FROSTBITE, target);
      }
    },
    onChoose(ctx, hook, option) {
      if (handleFusion(ctx, hook, option)) return;
      if (hook === "polar-target") dealToChosenTarget(ctx, option, damage);
    },
  };
}

function offerFreezeTarget(ctx: ScriptCtx, target: number): void {
  const player = ctx.state.players[target]!;
  const options: string[] = [];
  const cardOptions: (number | null)[] = [];
  for (const card of player.arsenal) {
    options.push(`arsenal:${card.instanceId}`);
    cardOptions.push(null); // do not reveal the private arsenal card
  }
  for (const card of player.board) {
    if (!ctx.cardTypes(card).includes("ally")) continue;
    options.push(`ally:${card.instanceId}`);
    cardOptions.push(card.instanceId);
  }
  if (options.length === 0) return;
  ctx.requestChoice(
    `cold-freeze:${target}`,
    decisionPrompt(
      `${ctx.data.name}: choose an arsenal card or ally to freeze`,
      "card.siy.cold.freeze.choose",
      { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
    ),
    options,
    ctx.seat,
    cardOptions,
  );
}

function offerColdPayment(ctx: ScriptCtx, target: number): void {
  if (!ctx.requestPayment(
    `cold-pay:${target}`,
    decisionPrompt(
      `${ctx.data.name}: pay 1 resource to avoid freezing a card?`,
      "card.siy.cold.freeze.pay",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId } },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    1,
    target,
  )) {
    offerFreezeTarget(ctx, target);
  }
}

function freezeChoice(ctx: ScriptCtx, target: number, option: string): void {
  const id = Number(option.split(":")[1]);
  const player = ctx.state.players[target]!;
  const card = [...player.arsenal, ...player.board].find((candidate) => candidate.instanceId === id);
  if (!card) return;
  const expiry = ctx.state.turn + (ctx.state.activePlayer === ctx.seat ? 2 : 1);
  const current = Number(card.counters?.frozenUntilTurn || 0);
  ctx.addCounter(card.instanceId, "frozenUntilTurn", Math.max(0, expiry - current));
  ctx.logPublic(`${ctx.cardData(card.cardId).name} is frozen until the start of ${ctx.cardData(ctx.player(ctx.seat).heroCardId).name}'s next turn`);
}

export const siy: Record<string, CardScript> = {
  "iyslander|0": {
    triggers: [{
      event: "card-played",
      label: "Create a Frostbite",
      condition: (ctx, played) => ctx.state.activePlayer !== ctx.seat &&
        !!played &&
        ctx.cardTypes(played).includes("ice"),
      effect: (ctx) => ctx.createToken(FROSTBITE, ctx.state.activePlayer),
    }],
    onFriendlyPlay(ctx, played) {
      if (
        ctx.getFlag("player", "nextWizardNonAttackAsInstant") === true &&
        isWizardNonAttack(ctx, played)
      ) {
        ctx.setFlag("player", "nextWizardNonAttackAsInstant", false);
      }
    },
  },

  "aether hail|3": arcaneSpell(2),
  "aether icevein|1": aetherIcevein(5),
  "aether icevein|2": aetherIcevein(4),
  "aether icevein|3": aetherIcevein(3),

  "brain freeze|3": {
    playAsInstant: wizardActionAsInstant,
    additionalCost: fusionAdditionalCost,
    onPlay(ctx) {
      const opposing = ctx.state.players[opponentSeat(ctx)]!;
      const revealedIds = opposing.hand.map((card) => card.instanceId);
      if (!ctx.revealCards(revealedIds, opposing.seat)) return;
      const choices = isFused(ctx)
        ? opposing.hand.filter((card) => {
            const data = ctx.cardData(card.cardId);
            return ctx.hasCardType(card, "action") && data.cost === 0;
          })
        : [];
      ctx.requestCardChoice(
        "brain-freeze-top",
        decisionPrompt(
          choices.length
            ? "Brain Freeze: put a revealed cost 0 action on top of their deck"
            : "Brain Freeze: no revealed cost 0 action can be put on top",
          choices.length
            ? "card.siy.brainfreeze.action.choose"
            : "card.siy.brainfreeze.action.none",
          choices.length
            ? {}
            : { optionMessages: { Close: decisionMessage("common.option.close") } },
        ),
        choices.length ? choices.map((card) => card.instanceId) : ["Close"],
        undefined,
        revealedIds,
      );
    },
    onChoose(ctx, hook, option) {
      if (handleFusion(ctx, hook, option)) return;
      if (hook === "brain-freeze-top" && option !== "Close") {
        ctx.putOnDeckTop(Number(option));
      }
    },
  },

  "cold snap|3": {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1);
      requestHeroTarget(
        ctx,
        "cold-target",
        "Cold Snap: choose a hero",
        "card.siy.coldsnap.hero.choose",
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "cold-target") {
        offerColdPayment(ctx, targetSeat(ctx, option));
        return;
      }
      const pay = /^cold-pay:(\d+)$/.exec(hook);
      if (pay) {
        const target = Number(pay[1]);
        if (option !== "paid") {
          offerFreezeTarget(ctx, target);
        } else {
          const player = ctx.state.players[target]!;
          ctx.logPublic(`${ctx.cardData(player.heroCardId).name} pays 1 resource`);
        }
        return;
      }
      const freeze = /^cold-freeze:(\d+)$/.exec(hook);
      if (freeze) freezeChoice(ctx, Number(freeze[1]), option);
    },
  },

  "frost spike|3": {
    onPlay(ctx) {
      const slots = ["head", "chest", "arms", "legs"] as const;
      const options: string[] = [];
      for (const player of ctx.state.players) {
        for (const slot of slots) {
          const occupiedByToken = player.board.some((card) => card.counters?.[`frostZone:${slot}`]);
          if (!player.equipment[slot] && !occupiedByToken) options.push(`${player.seat}:${slot}`);
        }
      }
      if (options.length === 0) {
        ctx.logPublic("Frost Spike finds no exposed equipment zone");
        return;
      }
      ctx.requestChoice(
        "frost-spike-zone",
        decisionPrompt(
          "Frost Spike: choose an exposed equipment zone",
          "card.siy.frostspike.zone.choose",
        ),
        options,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "frost-spike-zone") return;
      const [seatText, slot] = option.split(":");
      const token = ctx.createToken(FROSTBITE, Number(seatText));
      if (token) ctx.addCounter(token.instanceId, `frostZone:${slot}`, 1);
    },
  },

  "frostbite|0": {
    additionalCostToController: 1,
    onFriendlyActivate(ctx) {
      ctx.destroySelf();
    },
    triggers: [
      {
        event: "card-played",
        label: "Destroy Frostbite",
        effect: (ctx) => ctx.destroySelf(),
      },
      {
        event: "end-of-turn",
        whose: "subject",
        condition(ctx) {
          return ctx.player(ctx.seat).board.some((card) =>
            ctx.cardData(card.cardId).name.toLowerCase() === "frost hex",
          );
        },
        label: "Frost Hex deals 1 arcane damage",
        effect(ctx) {
          ctx.dealDamage(ctx.seat, 1, { arcane: true });
        },
      },
      {
        event: "end-of-turn",
        whose: "subject",
        label: "Destroy Frostbite",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "frosting|3": arcaneSpell(1),
  "ice bolt|1": arcaneSpell(5),
  "ice bolt|3": arcaneSpell(3),

  "ice eternal|3": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [0],
    playAsInstant: wizardActionAsInstant,
    variablePlayCost: { base: 0, resourcesPerX: 2, counterKey: "x", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") },
    additionalCost: iceEternalAdditionalCost,
    onPlay(ctx) {
      const x = ctx.getCounter("x");
      requestHeroTarget(
        ctx,
        "ice-eternal-target",
        `Ice Eternal: create ${x} Frostbite token${x === 1 ? "" : "s"} under which hero?`,
        "card.siy.iceeternal.hero.choose",
        { amount: x },
      );
    },
    onChoose(ctx, hook, option) {
      if (handleFusion(ctx, hook, option)) {
        return;
      }
      if (hook !== "ice-eternal-target") return;
      const target = targetSeat(ctx, option);
      ctx.createTokens(FROSTBITE, ctx.getCounter("x"), target);
      if (!isFused(ctx)) return;
      const frostbites = ctx.state.players[target]!.board.filter(
        (card) => ctx.cardData(card.cardId).name === "Frostbite",
      ).length;
      dealArcane(ctx, target, frostbites);
    },
  },

  "polar cap|1": polarCap(4),

  "pyroglyphic protection|3": {
    playAsInstant: wizardActionAsInstant,
    preventArcaneDamage: 1,
    triggers: [
      {
        event: "begin-action-phase",
        whose: "subject",
        label: "Destroy Pyroglyphic Protection",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  },

  "stir the aetherwinds|3": {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      ctx.setFlag("player", "nextWizardNonAttackAsInstant", true);
      ctx.setFlag("player", "nextWizardNonAttackArcaneBonus", 1);
    },
  },

  "winter's bite|3": {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      requestHeroTarget(
        ctx,
        "winter-target",
        "Winter's Bite: choose a hero",
        "card.siy.wintersbite.hero.choose",
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "winter-target") {
        discardUnlessPay(ctx, targetSeat(ctx, option), 1, "winter");
        return;
      }
      handleDiscardUnlessPay(ctx, hook, option, "winter");
    },
  },
};
