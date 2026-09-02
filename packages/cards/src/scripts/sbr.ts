import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  commonOptionMessages,
  decisionPrompt,
  opponentSeat,
} from "./shared-helpers.js";

// ── SBR (Silver Age Chapter 1: Bravo, Flattering Showman precon) ───────────

const SEISMIC_SURGE = "SBR035";
const VIGOR = "SBR036";

function hasKeyword(ctx: ScriptCtx, cardId: string, keyword: string): boolean {
  return (ctx.cardData(cardId).keywords ?? []).some(
    (candidate) => candidate.toLowerCase() === keyword.toLowerCase(),
  );
}

function hasCrush(ctx: ScriptCtx, card: { readonly cardId: string }): boolean {
  return hasKeyword(ctx, card.cardId, "crush");
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  const data = ctx.cardData(card.cardId);
  return (
    ctx.cardTypes(card).includes("aura") ||
    (data.keywords ?? []).some((keyword) => keyword.toLowerCase() === "suspense")
  );
}

function isNamed(ctx: ScriptCtx, card: { readonly cardId: string }, name: string): boolean {
  return ctx.cardData(card.cardId).name.toLowerCase() === name.toLowerCase();
}

function crushTriggered(ctx: ScriptCtx): boolean {
  return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.hit && ctx.link.damage >= 4;
}

function boulderDrop(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "boulder-drop-top",
        decisionPrompt(`${ctx.data.name}: put a card from your hand on top of your deck`, "card.sbr.hand.card.top", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
        hand.map((card) => card.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "boulder-drop-top") ctx.putOnDeckTop(Number(option));
    },
  };
}

function chokeslam(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardCounter(hero.instanceId, "attackActionNoPowerGainUntilTurn", ctx.state.turn + 1);
      ctx.logPublic("Chokeslam: opposing attack action cards can't gain {p} during their next action phase");
    },
  };
}

export const sbr: Record<string, CardScript> = {
  "bravo, flattering showman|0": {
    activated: {
      cost: 2,
      tap: true,
      isAttack: false,
      goAgain: true,
      label: "Turn a crush card in arsenal face up",
      canActivate(ctx) {
        return ctx.player(ctx.seat).arsenal.some((card) => card.faceDown && hasCrush(ctx, card));
      },
      onActivate(ctx) {
        const cards = ctx.player(ctx.seat).arsenal.filter(
          (card) => card.faceDown && hasCrush(ctx, card),
        );
        ctx.requestCardChoice(
          "bravo-reveal-crush",
          decisionPrompt("Bravo: turn a crush card in your arsenal face up", "card.sbr.bravo.crush.faceup"),
          cards.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "bravo-reveal-crush") return;
      const card = ctx.player(ctx.seat).arsenal.find(
        (candidate) => candidate.instanceId === Number(option),
      );
      if (!card?.faceDown || !hasCrush(ctx, card)) return;
      if (!ctx.turnArsenalFaceUp(card.instanceId)) return;
      ctx.addCardTempPower(card.instanceId, 2);
      ctx.grantCardKeyword(card.instanceId, "dominate");
      ctx.logPublic(`${ctx.cardData(card.cardId).name} is turned face up and gets +2{p} and dominate`);
    },
  },

  "sledge of anvilheim|0": {
    activated: attackAbility(4),
  },

  "magmatic carapace|0": {
    triggers: [{
      event: "card-played",
      label: "Pay 1 and tap this to create a Seismic Surge?",
      condition: (ctx, played) => !!played && isAura(ctx, played) && !ctx.self.tapped,
      effect(ctx) {
        ctx.requestPayment(
          "magmatic-carapace",
          decisionPrompt("Magmatic Carapace: pay {r} and tap it to create a Seismic Surge?", "card.sbr.carapace.pay.surge"),
          1,
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "magmatic-carapace" || option !== "paid" || ctx.self.tapped) return;
      ctx.tap(ctx.self.instanceId);
      ctx.createToken(SEISMIC_SURGE);
      ctx.logPublic("Magmatic Carapace: paid {r}, tapped, and created a Seismic Surge");
    },
  },

  "basalt boots|0": {
    modifyDefense(ctx) {
      return ctx.player(ctx.seat).board.some((card) => isNamed(ctx, card, "Seismic Surge")) ? 1 : 0;
    },
  },

  "boulder drop|1": boulderDrop(),
  "boulder drop|3": boulderDrop(),
  "chokeslam|1": chokeslam(),
  "chokeslam|3": chokeslam(),

  "fault line|1": {
    modifyAttack(ctx) {
      return ctx.player(ctx.seat).arsenal.length > 0 ? 1 : 0;
    },
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      for (const player of ctx.state.players) {
        for (const card of [...player.arsenal]) {
          ctx.setCardFaceDown(card.instanceId, false);
          ctx.putOnDeckBottom(card.instanceId);
          ctx.logPrivate(
            player.seat,
            `${ctx.cardData(card.cardId).name} is put on the bottom of its owner's deck`,
            "a face-down arsenal card is put on the bottom of its owner's deck",
          );
        }
      }
    },
  },

  "zealous belting|1": {
    onAttackDeclared(ctx) {
      const basePower = ctx.data.attack ?? 0;
      if (ctx.player(ctx.seat).pitch.some((card) => (ctx.cardData(card.cardId).attack ?? 0) > basePower)) {
        ctx.grantGoAgain();
      }
    },
  },

  "crash and bash|1": {
    onDefend(ctx) {
      const crushCards = ctx.player(ctx.seat).hand.filter((card) => hasCrush(ctx, card));
      if (crushCards.length === 0) return;
      ctx.requestCardChoice(
        "crash-reveal-crush",
        decisionPrompt("Crash and Bash: reveal a card with crush to create a Seismic Surge?", "card.sbr.crush.reveal.surge", { optionMessages: commonOptionMessages("no") }),
        ["no", ...crushCards.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "crash-reveal-crush" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !hasCrush(ctx, card)) return;
      ctx.createToken(SEISMIC_SURGE);
      ctx.logPublic(`Crash and Bash reveals ${ctx.cardData(card.cardId).name} from hand`);
    },
  },

  "clash of vigor|3": {
    onDefend(ctx) {
      ctx.requestClash(opponentSeat(ctx), "clash-of-vigor");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "clash-of-vigor" && winner >= 0) ctx.createToken(VIGOR, winner);
    },
  },

  "crush the weak|3": {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardCounter(hero.instanceId, "attackActionBasePowerLimitUntilTurn", ctx.state.turn + 1);
      ctx.setCardCounter(hero.instanceId, "attackActionBasePowerLimit", 3);
      ctx.logPublic("Crush the Weak: the opponent can't play attack actions with 3 or less base {p} next action phase");
    },
  },

  "flatten the field|3": {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const token = opponent.board.find((card) => isNamed(ctx, card, "Seismic Surge"));
      if (token) ctx.destroyPermanent(token.instanceId);
    },
  },

  "thunder quake|3": {
    triggers: [
      {
        event: "end-of-turn",
        sourceZone: "hand",
        label: "Heave 3",
        condition(ctx) {
          return ctx.player(ctx.seat).arsenal.length === 0;
        },
        effect(ctx) {
          ctx.requestPayment(
            "thunder-quake-heave",
            decisionPrompt("Thunder Quake: pay {r}{r}{r} to heave it face up into your arsenal?", "card.sbr.thunderquake.heave"),
            3,
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "thunder-quake-heave" || option !== "paid") return;
      if (!ctx.putIntoArsenal(ctx.self.instanceId, "hand")) return;
      ctx.createTokens(SEISMIC_SURGE, 3);
      ctx.logPublic("Thunder Quake is heaved: create 3 Seismic Surge tokens");
    },
  },

  "seismic surge|0": {
    triggers: [
      {
        event: "begin-action-phase",
        label: "Destroy Seismic Surge — next Guardian attack costs {r} less",
        effect(ctx) {
          ctx.setPlayerFlag(ctx.seat, "controlledName:seismic surge", true);
          ctx.destroySelf();
          const reduction = Number(ctx.getPlayerFlag(ctx.seat, "nextGuardianAttackCostReduction")) + 1;
          ctx.setPlayerFlag(ctx.seat, "nextGuardianAttackCostReduction", reduction);
          // The flag remains the cost authority. This matching modifier keeps
          // the ceased token visible as an ongoing effect and expires when the
          // discounted Guardian attack is declared.
          ctx.addModifier({
            scope: "next-attack",
            ongoingLabel: "attack costs 1 less",
            appliesTo: "attack-action",
            appliesToClass: "guardian",
          });
          ctx.logPublic("Seismic Surge is destroyed: the next Guardian attack costs {r} less");
        },
      },
    ],
  },
};
