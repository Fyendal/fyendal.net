import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, buffNextAttack, commonOptionMessages, decisionPrompt } from "./shared-helpers.js";

const CORRUPTED_CORPSE = "IAR090";

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function zombies(ctx: ScriptCtx, zone: readonly DeepReadonly<CardInstance>[]) {
  return zone.filter((card) => !card.faceDown && hasType(ctx, card, "zombie"));
}

function controlsVox(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).weapons.some((card) =>
    ctx.cardData(card.cardId).name === "Vox Necropolis"
  );
}

function grantDestroyingZombieAttack(
  ctx: ScriptCtx,
  power: number,
  marker: string,
): void {
  buffNextAttack(ctx, { attack: power, appliesToSubtype: "zombie" });
  ctx.addModifier({ scope: "until-end-of-turn" });
  ctx.setFlag("player", marker, (Number(ctx.getFlag("player", marker)) || 0) + 1);
}

function destroyingZombieAttack(marker: string): Pick<CardScript, "onFriendlyAttackDeclared" | "canTriggerOnHit" | "onHit"> {
  return {
    onFriendlyAttackDeclared(ctx) {
      const link = ctx.link;
      const remaining = Number(ctx.getFlag("player", marker)) || 0;
      if (!link || link.attacker !== ctx.seat || remaining <= 0 ||
        !hasType(ctx, link.attackingCard, "zombie")) return;
      ctx.setFlag("player", marker, remaining - 1);
      ctx.setFlag("link", marker, (Number(ctx.getFlag("link", marker)) || 0) + 1);
      const modifier = ctx.state.modifiers.find((candidate) =>
        candidate.sourceInstanceId === ctx.self.instanceId &&
        candidate.scope === "until-end-of-turn" &&
        !candidate.consumed
      );
      if (modifier) ctx.consumeModifier(modifier.id);
    },
    canTriggerOnHit(ctx) {
      return (Number(ctx.getFlag("link", marker)) || 0) > 0;
    },
    onHit(ctx) {
      ctx.setFlag("link", marker, 0);
      ctx.destroyPermanent(ctx.link!.attackingCard.instanceId);
    },
  };
}

const undeadGraspAttack = destroyingZombieAttack("amaUndeadGrasp");
const digForSoulsAttack = destroyingZombieAttack("amaDigForSouls");

export const ama: Record<string, CardScript> = {
  "malice, domina of the dead|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      tap: true,
      canActivate: (ctx) => zombies(ctx, ctx.player(ctx.seat).graveyard).length > 0,
      onActivate(ctx) {
        const choices = zombies(ctx, ctx.player(ctx.seat).graveyard);
        ctx.requestCardChoice(
          "ama-malice-zombie",
          decisionPrompt("Choose a zombie in your graveyard", "card.common.zombie.graveyard.choose"),
          choices.map((card) => card.instanceId),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "ama-malice-zombie") ctx.allowPlayFrom(Number(option), "graveyard");
    },
    onFriendlyDestroyed(ctx, destroyed) {
      if (!hasType(ctx, destroyed, "zombie") || !hasType(ctx, destroyed, "ally")) return;
      ctx.banish(destroyed.instanceId, { faceDown: true });
      ctx.createCardInBanish(CORRUPTED_CORPSE);
    },
  },

  "vox necropolis|0": {
    onFriendlyPlay(ctx, played, from) {
      if (ctx.state.phase !== "action" || (from !== "graveyard" && from !== "banish") ||
        !hasType(ctx, played, "zombie")) return;
      ctx.setCardCounter(played.instanceId, "voxAttackOnEnter", 1);
    },
    onFriendlyEnterArena(ctx, entered) {
      if ((entered.counters?.voxAttackOnEnter ?? 0) <= 0) return;
      ctx.setCardCounter(entered.instanceId, "voxAttackOnEnter", 0);
      ctx.tap(entered.instanceId);
      ctx.attackWithPermanent(entered.instanceId);
    },
  },

  "corrupted crown|0": {
    onDefend(ctx) {
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "ama-crown-banish",
          decisionPrompt("Banish a card for +1 defense?", "card.ama.crown.card.banish", { optionMessages: commonOptionMessages("no") }),
          ["no", ...hand.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "ama-crown-banish" && option !== "no" && ctx.banish(Number(option))) {
        ctx.addCardTempDefense(ctx.self.instanceId, 1);
      }
    },
  },

  "undead grasp|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      effectCardCosts: [{
        zone: "hand",
        move: "discard",
        count: 1,
        subtype: "zombie",
        prompt: decisionPrompt("Discard a zombie", "card.common.cost.zombie.discard"),
      }],
      onActivate(ctx) {
        grantDestroyingZombieAttack(ctx, 3, "amaUndeadGrasp");
      },
    },
    ...undeadGraspAttack,
  },

  "dig for souls|1": {
    variablePlayCost: { base: 0, counterKey: "digX", prompt: decisionPrompt("Choose X", "engine.decision.x.choose") },
    onPlay(ctx) {
      const x = ctx.getCounter("digX");
      const looked = ctx.player(ctx.seat).deck.slice(0, x);
      for (const card of looked) ctx.lookAt(card.instanceId);
      const choices = zombies(ctx, looked);
      ctx.requestCardChoice(
        "ama-dig-zombie",
        decisionPrompt("Put a zombie into your graveyard?", "card.ama.dig.zombie.choose", { optionMessages: commonOptionMessages("no") }),
        ["no", ...choices.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ama-dig-zombie") return;
      const x = ctx.getCounter("digX");
      const looked = ctx.player(ctx.seat).deck.slice(0, x);
      if (option !== "no") ctx.moveToGraveyard(Number(option), "deck");
      const rest = looked
        .filter((card) => card.instanceId !== Number(option))
        .filter((card) => ctx.player(ctx.seat).deck.some((candidate) => candidate.instanceId === card.instanceId));
      ctx.putOnDeckBottomInChosenOrder(rest.map((card) => card.instanceId), "Order the remaining cards");
      grantDestroyingZombieAttack(ctx, 4, "amaDigForSouls");
    },
    ...digForSoulsAttack,
  },

  "restless commander|1": {
    activated: attackAbility(1, {
      tap: true,
      oncePerTurn: false,
      canActivate: controlsVox,
    }),
    onEnterArena(ctx) {
      ctx.addModifier({ scope: "static", attack: 1, appliesToSubtype: "zombie" });
    },
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
  },
};
