import type { CardScript, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  decisionPrompt,
  faceUpGraveyard,
  isItem,
  isMarked,
  markHero,
  ongoingLabel,
  opponentSeat,
} from "./shared-helpers.js";

function myStealthAttack(ctx: ScriptCtx): boolean {
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat &&
    ctx.hasKeyword(ctx.link.attackingCard, "stealth");
}
function lingeringFromSelf(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some(
    (modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "until-end-of-turn" && !modifier.consumed,
  );
}

export const aac: Record<string, CardScript> = {
  "arakni, 5l!p3d 7hru 7h3 cr4x|0": {
    onFriendlyAttackDeclared(ctx) {
      if (
        !ctx.link ||
        !ctx.hasKeyword(ctx.link.attackingCard, "stealth") ||
        ctx.getFlag("player", "aacFirstStealthUsed") === true
      )
        return;
      ctx.setFlag("player", "aacFirstStealthUsed", true);
      ctx.grantGoAgain();
    },
  },
  "creep|1": {
    onAttackDeclared(ctx) {
      buffNextAttack(ctx, {
        goAgain: true,
        appliesToKeyword: "stealth",
        expiresOnChainClose: true,
      });
    },
  },
  "horrors of the past|2": {
    onAttackDeclared(ctx) {
      const previous = [...ctx.state.chain]
        .reverse()
        .find(
          (link) =>
            link.attacker === ctx.seat &&
            link.attackingCard.instanceId !== ctx.self.instanceId &&
            link.attackCardType === "action" &&
            ctx.hasKeyword(link.attackingCard, "stealth"),
        );
      if (previous) {
        ctx.grantBaseAbilities(ctx.self.instanceId, previous.attackingCard.cardId);
      }
    },
  },
  "hunter's klaive|0": {
    activated: attackAbility(2, { goAgain: true }),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      markHero(ctx, opponentSeat(ctx));
    },
    onEffectHit(ctx, targetSeat) {
      markHero(ctx, targetSeat);
    },
  },
  "infiltrate|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (!top) return;
      ctx.banish(top.instanceId);
      ctx.allowPlayFrom(top.instanceId, "banish", { untilEndOfNextTurn: true, forSeat: ctx.seat });
    },
  },
  "inverter's nightcowl|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      label: "Stealth attacks gain {r} this turn",
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          ...ongoingLabel(
            "gain 1 resource whenever you play a card with stealth",
            "card.effect.aac.invertersnightcowl",
          ),
        });
      },
    },
    triggers: [
      {
        event: "card-played",
        label: "Gain 1 resource",
        condition: (ctx, played) => lingeringFromSelf(ctx) && !!played && ctx.hasKeyword(played, "stealth"),
        effect: (ctx) => ctx.gainResources(ctx.seat, 1),
      },
    ],
  },
  "marked|0": {},
  "meet madness|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const opponent = ctx.player(target);
      const result = ctx.randomInt(3);
      if (result === 0 && opponent.hand.length) {
        ctx.requestCardChoice(
          "aac-madness-hand",
          decisionPrompt("Choose a card from your hand to banish", "card.aac.hand.card.banish"),
          opponent.hand.map((card) => card.instanceId),
          target,
        );
      } else if (result === 1 && opponent.arsenal.length) {
        ctx.requestCardChoice(
          "aac-madness-arsenal",
          decisionPrompt("Choose a card from your arsenal to banish", "card.aac.arsenal.card.banish"),
          opponent.arsenal.map((card) => card.instanceId),
          target,
        );
      } else if (result === 2 && opponent.deck[0]) {
        ctx.banish(opponent.deck[0].instanceId);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "aac-madness-hand") ctx.banish(Number(option));
      if (hook === "aac-madness-arsenal") {
        ctx.setCardFaceDown(Number(option), false);
        ctx.banish(Number(option));
      }
    },
  },
  "rage baiters|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      tap: true,
      canActivate: myStealthAttack,
      label: "Give mark on hit",
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", onHitMark: true });
      },
    },
  },
  "take up the mantle|2": {
    canPlay: myStealthAttack,
    onPlay(ctx) {
      const marked = isMarked(ctx, opponentSeat(ctx));
      ctx.addModifier({ scope: "chain-link", attack: marked ? 3 : 2 });
      if (!marked) return;
      const options = faceUpGraveyard(ctx).filter((card) =>
        ctx.hasCardType(card, "action") && ctx.hasKeyword(card, "stealth"));
      if (options.length)
        ctx.requestCardChoice(
          "aac-mantle",
          decisionPrompt("Banish a stealth attack for the target to become its copy?", "card.aac.stealthattack.copy", {
            optionMessages: commonOptionMessages("pass"),
          }),
          ["pass", ...options.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "aac-mantle" || option === "pass") return;
      const chosen = faceUpGraveyard(ctx).find((card) => card.instanceId === Number(option));
      if (!chosen || !ctx.link || !ctx.banish(chosen.instanceId)) return;
      ctx.becomeCardCopy(ctx.link.attackingCard.instanceId, chosen.cardId);
    },
  },
  "undercover acquisition|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const items = ctx.player(opponentSeat(ctx)).board.filter((card) => isItem(ctx, card));
      if (items.length)
        ctx.requestCardChoice(
          "aac-steal-item",
          decisionPrompt("Steal an item", "card.common.item.steal"),
          items.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "aac-steal-item") ctx.steal(Number(option), { duration: "indefinite" });
    },
  },
};
