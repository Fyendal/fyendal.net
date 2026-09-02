import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, decisionPrompt, opponentSeat } from "./shared-helpers.js";

const BLOODROT_POX = "OUT234";
const FRAILTY = "OUT235";
const INERTIA = "OUT236";
const SILVER = "DYN245";

function isDisease(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("disease");
}

function opposingDiseases(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(opponentSeat(ctx)).board.filter((card) => isDisease(ctx, card));
}

export const amo: Record<string, CardScript> = {
  "humour plunge|0": {
    activated: attackAbility(2, {
      goAgain: true,
      oncePerTurn: false,
      tap: true,
    }),
    modifyAttack(ctx) {
      return ctx.link?.targetAllyId === undefined && opposingDiseases(ctx).length > 0 ? 1 : 0;
    },
  },

  "dr. mortimer, blight of the pits|0": {
    activated: [
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "instant",
        tap: true,
        label: "Cure a disease",
        canActivate: (ctx) => opposingDiseases(ctx).length > 0,
        onActivate(ctx) {
          ctx.requestCardChoice(
            "amo-mortimer-cure",
            decisionPrompt(
              "Choose a disease to cure",
              "card.amo.mortimer.disease.choose",
            ),
            opposingDiseases(ctx).map((card) => card.instanceId),
          );
        },
      },
      {
        cost: 0,
        isAttack: false,
        goAgain: false,
        timing: "attack-reaction",
        tap: true,
        label: "Destroy 2 Silver: give go again",
        effectCardCosts: [{
          zone: "arena",
          move: "destroy",
          count: 2,
          name: "Silver",
          prompt: "Destroy 2 Silver",
        }],
        canActivate(ctx) {
          return !!ctx.link &&
            ctx.link.attacker === ctx.seat &&
            ctx.cardTypes(ctx.link.attackingCard).includes("assassin");
        },
        onActivate(ctx) {
          ctx.grantGoAgain();
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "amo-mortimer-cure") return;
      const disease = opposingDiseases(ctx).find((card) => card.instanceId === Number(option));
      if (disease && ctx.destroyPermanent(disease.instanceId)) ctx.createToken(SILVER);
    },
  },

  "viral diffusion|1": {
    onDefend(ctx) {
      const attackingSeat = ctx.link?.attacker;
      if (attackingSeat === undefined) return;
      ctx.notifyTrapTriggered();
      ctx.createToken(FRAILTY, attackingSeat);
      ctx.createToken(INERTIA, attackingSeat);
      ctx.createToken(BLOODROT_POX, attackingSeat);
    },
  },
};
