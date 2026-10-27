import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  cardNamed,
  contractWithSilver,
  decisionMessage,
  decisionPrompt,
  equipWithSilver,
  hitHookLabel,
  ongoingLabel,
  opponentSeat,
  requestDiseaseTokenChoice,
} from "./shared-helpers.js";

const BLOODROT_POX = "OUT234";
const FRAILTY = "OUT235";
const INERTIA = "OUT236";

function seedDisease(tokenId: string): CardScript {
  return {
    onPlay(ctx) {
      for (const player of ctx.state.players) ctx.createToken(tokenId, player.seat);
    },
  };
}

function isReaction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "attack-reaction") || ctx.hasCardType(card, "defense-reaction");
}

function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("dagger");
}

/** Every dagger in play: weapons, dagger permanents, and dagger attack cards
 * still on the combat chain. */
function daggerTargets(ctx: ScriptCtx): number[] {
  const candidates = [
    ...ctx.state.players.flatMap((player) => [...player.weapons, ...player.board]),
    ...ctx.state.chain.filter((link) => link.flags.attackGone !== true).map((link) => link.attackingCard),
  ];
  return candidates
    .filter((card) => isDagger(ctx, card))
    .map((card) => card.instanceId)
    .filter((instanceId, index, ids) => ids.indexOf(instanceId) === index);
}

function chooseDisease(ctx: ScriptCtx): void {
  requestDiseaseTokenChoice(ctx, "mpa-phial-disease", [FRAILTY, INERTIA, BLOODROT_POX]);
}

function isInfected(ctx: ScriptCtx, seat: number): boolean {
  return ctx.player(seat).board.some((card) => ctx.cardTypes(card).includes("disease"));
}

function activeAssassinAttack(ctx: ScriptCtx): number[] {
  const link = ctx.link;
  if (!link || link.flags.attackGone === true || !ctx.cardTypes(link.attackingCard).includes("assassin")) return [];
  return [link.attackingCard.instanceId];
}

export const mpa: Record<string, CardScript> = {
  "phial of calamity|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      targetCardOptions: daggerTargets,
      onActivate(ctx) {
        const dagger = ctx.playTargetInstanceId;
        if (dagger === undefined) return;
        ctx.addModifier({
          scope: "until-end-of-turn",
          appliesToInstanceId: dagger,
          onHitScriptHook: {
            hook: "mpa-phial-hit",
            ...hitHookLabel(
              "create a Frailty, Inertia, or Bloodrot Pox token under the hit hero's control",
              "card.effect.mpa.phial",
            ),
            heroOnly: true,
          },
        });
      },
    },
    onGrantedHit(ctx, hook) {
      if (hook === "mpa-phial-hit") chooseDisease(ctx);
    },
    // A thrown dagger hits through effect damage, which never reaches the
    // combat on-hit hook, so its live grant is matched here instead.
    onFriendlyEffectHitCondition(ctx, source, targetSeat) {
      return (
        targetSeat !== ctx.seat &&
        ctx.state.modifiers.some(
          (modifier) =>
            modifier.sourceInstanceId === ctx.self.instanceId &&
            modifier.appliesToInstanceId === source.instanceId &&
            modifier.onHitScriptHook?.hook === "mpa-phial-hit",
        )
      );
    },
    onFriendlyEffectHit(ctx) {
      chooseDisease(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "mpa-phial-disease") return;
      if (option === FRAILTY || option === INERTIA || option === BLOODROT_POX) {
        ctx.createToken(option, opponentSeat(ctx));
      }
    },
  },

  "cadaver handlers|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      targetCardOptions: activeAssassinAttack,
      canActivate: (ctx) => isInfected(ctx, opponentSeat(ctx)),
      onActivate(ctx) {
        const target = ctx.playTargetInstanceId;
        const link = ctx.state.chain.find((candidate) => candidate.attackingCard.instanceId === target);
        if (!link) return;
        for (const card of [...link.defendingCards, ...link.defendingEquipment]) {
          ctx.addCardTempDefense(card.instanceId, -1);
        }
      },
    },
  },

  "seed bloodrot|3": seedDisease(BLOODROT_POX),
  "seed frailty|3": seedDisease(FRAILTY),
  "seed inertia|3": seedDisease(INERTIA),

  "outbreak|3": {
    playTargetOptions(ctx) {
      return ctx.state.chain
        .filter((link) =>
          link.flags.attackGone !== true &&
          link.attackCardType === "action" &&
          ctx.cardTypes(link.attackingCard).includes("assassin")
        )
        .map((link) => link.attackingCard.instanceId);
    },
    onPlay(ctx) {
      if (ctx.playTargetInstanceId === undefined) return;
      ctx.addModifier({
        scope: "chain-link",
        attack: 3,
        appliesTo: "attack-action",
        appliesToInstanceId: ctx.playTargetInstanceId,
        onHitScriptHook: {
          hook: "mpa-outbreak-hit",
          ...hitHookLabel(
            "create a Frailty, Inertia, and Bloodrot Pox token under the hit hero's control",
            "card.effect.mpa.outbreak",
          ),
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "mpa-outbreak-hit") return;
      for (const tokenId of [FRAILTY, INERTIA, BLOODROT_POX]) {
        ctx.createToken(tokenId, opponentSeat(ctx));
      }
    },
  },

  "prolonged illness|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "whenever a disease token is destroyed, if it's the first with " +
            "that name, create a copy of it under the same hero's control",
          "card.effect.mpa.prolongedillness",
        ),
      });
    },
    triggers: [
      {
        event: "card-left-arena",
        whose: "any",
        label: "Create a copy of the first destroyed disease token of this name",
        labelMessage: { id: "card.mpa.prolonged.copy" },
        condition(ctx, left, event) {
          if (!left || event?.destroyed !== true || event.controllerSeat === undefined) return false;
          if (!ctx.cardTypes(left).includes("disease") || !ctx.hasCardType(left, "token")) return false;
          const name = ctx.cardData(left.cardId).name.trim().toLowerCase().replace(/\s+/g, " ");
          return ctx.state.players.every(
            (player) => Number(player.flags[`destroyedNameCount:${name}`] ?? 0) === 0,
          );
        },
        onTrigger(ctx, left, event) {
          if (left && event?.controllerSeat !== undefined) {
            ctx.setState(`copySeat:${left.instanceId}`, event.controllerSeat);
          }
        },
        effect(ctx, destroyed) {
          if (destroyed) ctx.createTokenCopyOf(destroyed, ctx.getState(`copySeat:${destroyed.instanceId}`));
        },
      },
    ],
  },

  "prey on insecurity|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      oncePerTurn: false,
      effectCardCosts: [
        {
          zone: "hand",
          move: "put-on-deck-bottom",
          count: 1,
          prompt: decisionPrompt(
            "Put a card from your hand on the bottom of your deck",
            "card.common.cost.hand.deckbottom",
          ),
        },
      ],
      canActivate(ctx) {
        const attack = ctx.link?.attackingCard;
        return (
          !!attack &&
          ctx.link?.attacker === ctx.seat &&
          attack.instanceId !== ctx.self.instanceId &&
          (ctx.cardData(attack.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "stealth")
        );
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
          decisionPrompt("Choose a card to banish from the defending hero's hand", "card.mpa.remember.hand.banish"),
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

  "demoralize the dracai|1": {
    ...contractWithSilver((ctx, card) => card.owner === opponentSeat(ctx) && ctx.cardColor(card) === 1),
    onAttackDeclared(ctx) {
      // Keeps its hit trigger observable for later links while it stays on the chain.
      ctx.addModifier({ scope: "combat-chain" });
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return (
        !!link &&
        link.attacker === ctx.seat &&
        link.attackCardType === "action" &&
        link.targetAllyId === undefined &&
        ctx.state.chain.some(
          (chainLink) => chainLink.attackingCard.instanceId === ctx.self.instanceId && chainLink.flags.attackGone !== true,
        )
      );
    },
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  },

  "mutually assured destruction|1": {
    ...contractWithSilver((ctx, card) => card.owner === opponentSeat(ctx) && isInfected(ctx, card.owner)),
    onAttackDeclared(ctx) {
      // Its reaction-play trigger must remain functional for every link while
      // this Contract attack stays face up on the combat chain.
      ctx.addModifier({ scope: "combat-chain" });
    },
    triggers: [
      {
        event: "card-played",
        whose: "any",
        label: "Infect each hero and banish the top card of each deck",
        condition(ctx, played) {
          if (!played || !isReaction(ctx, played)) return false;
          if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return false;
          return ctx.getState(`reaction:${played.owner}`) === 0;
        },
        onTrigger(ctx, played) {
          if (played) ctx.setState(`reaction:${played.owner}`, 1);
        },
        effect(ctx) {
          for (const player of ctx.state.players) ctx.createToken(BLOODROT_POX, player.seat);
          for (const player of ctx.state.players) {
            const top = ctx.player(player.seat).deck[0];
            if (top) ctx.banish(top.instanceId);
          }
        },
      },
    ],
  },

  "tailored targeting|1": {
    ...contractWithSilver((ctx, card) =>
      card.owner === opponentSeat(ctx) && !!ctx.self.chosenName && cardNamed(ctx, card, ctx.self.chosenName),
    ),
    triggers: [
      {
        event: "attack-declared",
        sourceZone: "self",
        label: "Name a card",
        labelMessage: decisionMessage("card.trigger.common.cardname.choose"),
        effect(ctx) {
          ctx.requestNameChoice("mpa-tailored-name", decisionPrompt("Name a card", "card.common.card.name"));
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "mpa-tailored-name") ctx.setChosenName(option);
    },
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const named = ctx.self.chosenName;
      for (;;) {
        const top = ctx.player(opponentSeat(ctx)).deck[0];
        if (!top || !ctx.banish(top.instanceId)) return;
        if (!named || !cardNamed(ctx, top, named)) return;
      }
    },
  },
};
