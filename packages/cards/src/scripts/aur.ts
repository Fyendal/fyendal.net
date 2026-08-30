import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, opponentSeat } from "./shared-helpers.js";

function playedLightning(ctx: ScriptCtx): boolean {
  return ctx.getPlayerFlag(ctx.seat, "playedSubtype:lightning") === true;
}

function crackling(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (playedLightning(ctx)) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  };
}

function harnessLightning(amount: number): CardScript {
  return {
    arcaneDamageEffect: true,
    prospectiveHeroDamage(ctx) {
      return playedLightning(ctx) ? [{ targetSeat: opponentSeat(ctx), amount }] : [];
    },
    onPlay(ctx) {
      if (playedLightning(ctx)) ctx.dealDamage(opponentSeat(ctx), amount, { arcane: true });
    },
  };
}

function photonRush(): CardScript {
  return { onAttackDeclared(ctx) { if (playedLightning(ctx)) ctx.grantGoAgain(); } };
}

function sparkSpray(): CardScript {
  return {
    onFriendlyDefended(ctx) {
      ctx.requestPayment("spark-spray", `${ctx.data.name}: pay {r} for +1{p}?`, 1);
    },
    onChoose(ctx, hook, option) {
      if (hook === "spark-spray" && option === "paid") {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
      }
    },
  };
}

function staticShock(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return playedLightning(ctx) && ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
            ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true });
    },
  };
}

export const aur: Record<string, CardScript> = {
  "aether crackers|0": {
    onFriendlyCombatDamageDealt(ctx, _source, target, amount) {
      if (amount > 0) {
        ctx.requestChoice(
          "aether-crackers",
          `Aether Crackers: destroy this to deal ${ctx.previewArcaneDamage(1)} arcane damage to the hero that was hit?`,
          ["yes", "no"],
        );
        ctx.setCounter("hit-target", target);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aether-crackers" || option !== "yes") return;
      const target = ctx.getCounter("hit-target");
      ctx.destroySelf();
      ctx.dealDamage(target, 1, { arcane: true });
    },
  },
  "crackling|1": crackling(),
  "crackling|2": crackling(),
  "harness lightning|1": harnessLightning(3),
  "harness lightning|2": harnessLightning(2),
  "photon rush|3": photonRush(),
  "sizzle|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 2, appliesToSubtype: ["lightning", "elemental"] });
    },
  },
  "spark spray|2": sparkSpray(),
  "spark spray|3": sparkSpray(),
  "static shock|2": staticShock(),
};
