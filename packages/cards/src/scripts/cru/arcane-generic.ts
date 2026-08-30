import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextArcaneDamageCard,
  buffNextAttack,
  dealArcane,
  opponentSeat,
  optN,
  optOnChoose,
  wizardActionAsInstant,
} from "../shared-helpers.js";

const COPPER = "CRU197";
const RUNECHANT = "CRU157";

function createRunechants(ctx: ScriptCtx, count: number): void {
  ctx.createTokens(RUNECHANT, count);
}

function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !ctx.cardTypes(card).includes("attack");
}

function isRunebladeAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (
    ctx.hasCardType(card, "action") &&
    ctx.cardTypes(card).includes("attack") &&
    ctx.cardTypes(card).includes("runeblade")
  );
}

function mauvrionSkies(runechants: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        goAgain: true,
        appliesTo: "attack-action",
        appliesToClass: "runeblade",
        onHitCreateToken: { cardId: RUNECHANT, count: runechants },
      });
    },
  };
}

function consumingVolition(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.state.players[target]!.hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "consuming-discard",
        "Consuming Volition: choose a card to discard",
        hand.map((card) => card.instanceId),
        target,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "consuming-discard") {
        ctx.discardCard(opponentSeat(ctx), Number(option));
      }
    },
  };
}

function meatAndGreet(): CardScript {
  const resolve = (ctx: ScriptCtx): void => {
    if (ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true) {
      ctx.grantGoAgain();
    }
  };
  return {
    onHit(ctx) {
      createRunechants(ctx, 1);
      resolve(ctx);
    },
    onMiss: resolve,
  };
}

function requestResearchOrder(ctx: ScriptCtx, ids: number[]): void {
  if (ids.length === 0) return;
  ctx.requestCardChoice(
    `research-order:${ids.join(",")}`,
    "Sutcliffe's Research Notes: choose the bottommost card first",
    ids,
  );
}

function researchNotes(count: number): CardScript {
  return {
    onPlay(ctx) {
      const cards = ctx.state.players[ctx.seat]!.deck.slice(0, count);
      for (const card of cards) ctx.lookAt(card.instanceId);
      createRunechants(ctx, cards.filter((card) => isRunebladeAttack(ctx, card)).length);
      requestResearchOrder(ctx, cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      const match = /^research-order:([\d,]+)$/.exec(hook);
      if (!match) return;
      const ids = match[1]!.split(",").map(Number);
      const chosen = Number(option);
      if (!ids.includes(chosen) || !ctx.putOnDeckTop(chosen)) return;
      requestResearchOrder(ctx, ids.filter((id) => id !== chosen));
    },
  };
}

function requestHeroTarget(ctx: ScriptCtx, hook: string, prompt: string): void {
  ctx.requestChoice(hook, prompt, ["opposing hero", "your hero"]);
}

function chosenHero(ctx: ScriptCtx, option: string): number {
  return option === "your hero" ? ctx.seat : opponentSeat(ctx);
}

function forebodingBolt(damage: number): CardScript {
  return {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      requestHeroTarget(ctx, `foreboding-target:${damage}`, `${ctx.data.name}: choose a hero`);
    },
    onChoose(ctx, hook, option) {
      const match = /^foreboding-target:(\d+)$/.exec(hook);
      if (match) {
        ctx.dealDamage(chosenHero(ctx, option), Number(match[1]));
        optN(ctx, 1);
        return;
      }
      optOnChoose(ctx, hook, option);
    },
  };
}

function rousingAether(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      requestHeroTarget(ctx, `rousing-target:${damage}`, `${ctx.data.name}: deal ${ctx.previewArcaneDamage(damage)} arcane damage to a hero`);
    },
    onChoose(ctx, hook, option) {
      const match = /^rousing-target:(\d+)$/.exec(hook);
      if (!match) return;
      dealArcane(ctx, chosenHero(ctx, option), Number(match[1]));
      buffNextArcaneDamageCard(ctx, 1);
    },
  };
}

function snapback(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    playAsInstant: (ctx) =>
      wizardActionAsInstant(ctx) ||
      ctx.getFlag("player", "playedClassType:wizard:non-attack-action") === true,
    onPlay(ctx) {
      requestHeroTarget(ctx, `snapback-target:${damage}`, `${ctx.data.name}: deal ${ctx.previewArcaneDamage(damage)} arcane damage to a hero`);
    },
    onChoose(ctx, hook, option) {
      const match = /^snapback-target:(\d+)$/.exec(hook);
      if (match) dealArcane(ctx, chosenHero(ctx, option), Number(match[1]));
    },
  };
}

function promiseOfPlenty(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.flags.fromArsenal === true) ctx.grantGoAgain();
    },
    onHit(ctx) {
      for (const player of ctx.state.players) {
        if (player.arsenal.length > 0) continue;
        const top = player.deck[0];
        if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
      }
    },
  };
}

function reinforceTheLine(defense: number): CardScript {
  return {
    canPlay: (ctx) =>
      ctx.link?.defendingCards.some((card) => {
        return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
      }) === true,
    onPlay(ctx) {
      const defenders = (ctx.link?.defendingCards ?? []).filter((card) => {
        return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
      });
      if (defenders.length > 0) {
        ctx.requestCardChoice(
          `reinforce:${defense}`,
          `${ctx.data.name}: choose a defending attack action card`,
          defenders.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      const match = /^reinforce:(\d+)$/.exec(hook);
      if (match) ctx.addCardTempDefense(Number(option), Number(match[1]));
    },
  };
}

export const cruArcaneGeneric: Record<string, CardScript> = {
  "viserai, rune blood|0": {
    triggers: [{
      event: "card-played",
      label: "Create a Runechant",
      condition(ctx, played) {
        if (!played) return false;
      const currentIsNonAttack = isNonAttackAction(ctx, played);
      const priorNonAttacks = Number(ctx.getFlag("player", "nonAttackActionsPlayedThisTurn")) -
        (currentIsNonAttack ? 1 : 0);
        return ctx.cardTypes(played).includes("runeblade") && priorNonAttacks > 0;
      },
      effect: (ctx) => createRunechants(ctx, 1),
    }],
  },

  "nebula blade|0": {
    activated: { cost: 2, isAttack: true, goAgain: false, oncePerTurn: true, label: "Attack" },
    modifyAttack: (ctx) =>
      ctx.getFlag("player", "playedNonAttackAction") === true ? 3 : 0,
    onHit: (ctx) => createRunechants(ctx, 1),
  },

  "mauvrion skies|2": mauvrionSkies(2),
  "consuming volition|1": consumingVolition(),
  "consuming volition|2": consumingVolition(),
  "consuming volition|3": consumingVolition(),
  "meat and greet|1": meatAndGreet(),
  "meat and greet|2": meatAndGreet(),
  "meat and greet|3": meatAndGreet(),
  "sutcliffe's research notes|1": researchNotes(3),
  "sutcliffe's research notes|2": researchNotes(2),
  "sutcliffe's research notes|3": researchNotes(1),

  "kano, dracai of aether|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Look at the top card",
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        if (!isNonAttackAction(ctx, top)) return;
        ctx.requestCardChoice(
          "kano-banish",
          `${ctx.data.name}: banish the top card and allow it to be played as an instant?`,
          ["no", top.instanceId],
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "kano-banish" || option === "no") return;
      const id = Number(option);
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || top.instanceId !== id || !isNonAttackAction(ctx, top)) return;
      if (!ctx.banish(id)) return;
      ctx.allowPlayFrom(id, "banish");
      ctx.setFlag("player", `asInstant:${id}`, true);
    },
  },

  "aether conduit|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      oncePerTurn: true,
      label: "Deal 2 arcane damage",
      onActivate(ctx) {
        requestHeroTarget(ctx, "conduit-target", `Aether Conduit: deal ${ctx.previewArcaneDamage(2)} arcane damage to a hero`);
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "conduit-target") dealArcane(ctx, chosenHero(ctx, option), 2);
    },
  },

  "foreboding bolt|1": forebodingBolt(3),
  "foreboding bolt|2": forebodingBolt(2),
  "foreboding bolt|3": forebodingBolt(1),
  "rousing aether|1": rousingAether(4),
  "rousing aether|2": rousingAether(3),
  "rousing aether|3": rousingAether(2),
  "snapback|2": snapback(2),
  "snapback|3": snapback(1),

  "promise of plenty|1": promiseOfPlenty(),
  "promise of plenty|2": promiseOfPlenty(),
  "promise of plenty|3": promiseOfPlenty(),
  "lunging press|3": {
    canPlay: (ctx) => ctx.link?.attackCardType === "action",
    onPlay: (ctx) => ctx.addModifier({ scope: "chain-link", attack: 1 }),
  },
  "cash in|2": {
    alternativePlayCost: {
      kind: "destroy-controlled-named",
      options: [
        { name: "Copper", count: 4 },
        { name: "Silver", count: 2 },
        { name: "Gold", count: 1 },
      ],
    },
    onPlay: (ctx) => ctx.drawCards(ctx.seat, 2),
  },
  "reinforce the line|1": reinforceTheLine(4),
  "reinforce the line|2": reinforceTheLine(3),
  "reinforce the line|3": reinforceTheLine(2),
  "cracked bauble|2": {},
  "copper|0": {
    activated: {
      cost: 4,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      label: "Destroy: draw a card",
      onActivate: (ctx) => ctx.drawCards(ctx.seat, 1),
    },
  },
  "kavdaen, trader of skins|0": {
    activated: {
      cost: 3,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      label: "Trade life for Copper",
      onActivate(ctx) {
        const other = opponentSeat(ctx);
        const comparison = ctx.compareLife(ctx.seat, other);
        if (comparison !== 0) {
          const higher = comparison > 0 ? ctx.seat : other;
          ctx.loseLife(higher, 1);
          ctx.createToken(COPPER, higher);
        }
        const after = ctx.compareLife(ctx.seat, other);
        if (after !== 0) {
          ctx.gainLife(after < 0 ? ctx.seat : other, 1);
        }
      },
    },
  },
};
