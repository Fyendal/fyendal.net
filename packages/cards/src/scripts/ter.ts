import type { CardScript, DeepReadonly, CardInstance, ScriptCtx } from "@fyendal/engine";

const MIGHT = "TER028";

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type);
}

function earthBond(extra: CardScript): CardScript {
  return {
    ...extra,
    onPlayCostPaid(ctx, paid) {
      ctx.setCounter("earth-bond", paid.some((card) => hasType(ctx, card, "earth")) ? 1 : 0);
      extra.onPlayCostPaid?.(ctx, paid);
    },
  };
}

function brackenRap(): CardScript {
  return earthBond({
    onAttackDeclared(ctx) {
      if (ctx.getCounter("earth-bond") > 0) ctx.createToken(MIGHT);
    },
  });
}

function logFall(): CardScript {
  return earthBond({
    onAttackDeclared(ctx) {
      if (ctx.getCounter("earth-bond") > 0) ctx.addModifier({ scope: "chain-link", overpower: true });
    },
  });
}

function strongWood(): CardScript {
  return earthBond({
    onAttackDeclared(ctx) {
      if (ctx.getCounter("earth-bond") > 0) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  });
}

function powerGainReplacement(bonus: number, once: boolean): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        powerGainBonus: bonus,
        appliesTo: "attack",
        ...(once ? { once: true } : {}),
      });
    },
  };
}

function seedsOfStrength(base: number): CardScript {
  return earthBond({
    onPlay(ctx) {
      ctx.createTokens(MIGHT, base + (ctx.getCounter("earth-bond") > 0 ? 1 : 0));
    },
  });
}

export const ter: Record<string, CardScript> = {
  "terra|0": {
    triggers: [{
      event: "end-of-turn",
      whose: "any",
      condition: (ctx) => ctx.player(ctx.seat).pitch.some((card) => hasType(ctx, card, "earth")),
      label: "Pay {r} to create a Might",
      effect(ctx) {
        ctx.requestPayment("terra-might", "Terra: pay {r} to create a Might token?", 1);
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook === "terra-might" && option === "paid") ctx.createToken(MIGHT);
    },
  },
  "redwood hammer|0": {
    activated: {
      cost: 3,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      label: "Attack",
      onCostPaid(ctx, paid) {
        ctx.setCounter("earth-pitched", paid.some((card) => hasType(ctx, card, "earth")) ? 1 : 0);
      },
    },
    onAttackDeclared(ctx) {
      if (ctx.getCounter("earth-pitched") > 0) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },
  "hard knuckle|0": {
    triggers: [{
      event: "card-played",
      label: "Destroy this to give the attack +1?",
      condition: (ctx, played) => !!played &&
        ctx.hasCardType(played, "action") &&
        hasType(ctx, played, "attack"),
      effect(ctx, played) {
        if (!played) return;
        ctx.setCounter("hard-knuckle-attack", played.instanceId);
        ctx.requestChoice(
          "hard-knuckle",
          "Hard Knuckle: destroy this to give the attack +1{p}?",
          ["yes", "no"],
        );
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "hard-knuckle" || option !== "yes") return;
      const attackId = ctx.getCounter("hard-knuckle-attack");
      ctx.destroySelf();
      ctx.addCardTempPower(attackId, 1);
    },
  },
  "bracken rap|1": brackenRap(),
  "bracken rap|2": brackenRap(),
  "log fall|1": logFall(),
  "log fall|2": logFall(),
  "strong wood|1": strongWood(),
  "strong wood|2": strongWood(),
  "flourish|2": powerGainReplacement(3, true),
  "flourish|3": powerGainReplacement(2, true),
  "thrive|2": powerGainReplacement(1, false),
  "seeds of strength|2": seedsOfStrength(2),
  "seeds of strength|3": seedsOfStrength(1),
  "sigil of shelter|2": { onPlay(ctx) { ctx.preventNextDamage(ctx.seat, 2); } },
  "sigil of shelter|3": { onPlay(ctx) { ctx.preventNextDamage(ctx.seat, 1); } },
  "canopy shelter|3": { onDefend(ctx) { ctx.createToken(MIGHT); } },
};
