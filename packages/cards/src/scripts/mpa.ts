import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { contractWithSilver, opponentSeat } from "./shared-helpers.js";

const BLOODROT_POX = "OUT234";

function isReaction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "attack-reaction") || ctx.hasCardType(card, "defense-reaction");
}

function isInfected(ctx: ScriptCtx, seat: number): boolean {
  return ctx.player(seat).board.some((card) => ctx.cardTypes(card).includes("disease"));
}

export const mpa: Record<string, CardScript> = {
  "prey on insecurity|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      oncePerTurn: false,
      effectCardCosts: [{
        zone: "hand",
        move: "put-on-deck-bottom",
        count: 1,
        prompt: "Put a card from your hand on the bottom of your deck",
      }],
      canActivate(ctx) {
        const attack = ctx.link?.attackingCard;
        return !!attack &&
          ctx.link?.attacker === ctx.seat &&
          attack.instanceId !== ctx.self.instanceId &&
          (ctx.cardData(attack.cardId).keywords ?? [])
            .some((keyword) => keyword.toLowerCase() === "stealth");
      },
      onCostPaid(ctx) {
        ctx.destroySelf();
      },
      onActivate(ctx) {
        const attack = ctx.link?.attackingCard;
        if (!attack) return;
        ctx.addModifier({
          scope: "chain-link",
          attack: 3,
          appliesToInstanceId: attack.instanceId,
        });
      },
    },
  },

  "remember the mists|3": {
    modifyAttack(ctx) {
      return ctx.getFlag("link", "fromOutsideHandOrArsenal") === true ? 2 : 0;
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length > 0) {
        ctx.requestCardChoice(
          "mpa-remember-banish",
          "Choose a card to banish from the defending hero's hand",
          hand.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mpa-remember-banish") return;
      const instanceId = Number(option);
      if (ctx.banish(instanceId)) {
        ctx.allowPlayFrom(instanceId, "banish", {
          forSeat: opponentSeat(ctx),
          untilEndOfNextTurn: true,
        });
      }
    },
  },

  "mutually assured destruction|1": {
    ...contractWithSilver((ctx, card) =>
      card.owner === opponentSeat(ctx) && isInfected(ctx, card.owner)
    ),
    onAttackDeclared(ctx) {
      // Its reaction-play trigger must remain functional for every link while
      // this Contract attack stays face up on the combat chain.
      ctx.addModifier({ scope: "combat-chain" });
    },
    triggers: [{
      event: "card-played",
      whose: "any",
      label: "Infect each hero and banish the top card of each deck",
      condition(ctx, played) {
        if (!played || !isReaction(ctx, played)) return false;
        if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return false;
        return ctx.getCounter(`reaction:${played.owner}`) === 0;
      },
      onTrigger(ctx, played) {
        if (played) ctx.setCounter(`reaction:${played.owner}`, 1);
      },
      effect(ctx) {
        for (const player of ctx.state.players) ctx.createToken(BLOODROT_POX, player.seat);
        for (const player of ctx.state.players) {
          const top = ctx.player(player.seat).deck[0];
          if (top) ctx.banish(top.instanceId);
        }
      },
    }],
  },
};
