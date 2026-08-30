import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { opponentSeat, previousAttackHasName } from "../shared-helpers.js";

const COPPER = "CRU197";
type CardRef = DeepReadonly<CardInstance>;

function comboWith(ctx: ScriptCtx, name: string): boolean {
  return previousAttackHasName(ctx, name);
}

function isAttackAction(ctx: ScriptCtx, card: CardRef): boolean {
  return ctx.hasCardType(card, "action") && ctx.cardTypes(card).includes("attack");
}

function hasCombo(ctx: ScriptCtx, card: CardRef): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some(
    (keyword) => keyword.toLowerCase() === "combo",
  );
}

function isWeaponAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon";
}

function isSword(ctx: ScriptCtx, card: CardRef): boolean {
  return ctx.cardTypes(card).includes("sword");
}

function attackedWithWeapon(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "attackedWithWeaponThisTurn") === true;
}

function weaponAttacks(ctx: ScriptCtx): number {
  return Number(ctx.getFlag("player", "weaponAttackCount")) || 0;
}

function nextAttack(ctx: ScriptCtx, attack = 0, appliesTo?: "any" | "weapon"): void {
  ctx.addModifier({
    scope: "next-attack",
    ...(attack !== 0 ? { attack } : {}),
    ...(appliesTo ? { appliesTo } : {}),
  });
}

function hitGoAgain(): CardScript {
  return {
    onHit(ctx) {
      ctx.grantGoAgain();
    },
  };
}

function craneDance(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (!comboWith(ctx, "soulbead strike")) return;
      ctx.setFlag("link", "craneCombo", true);
      ctx.grantGoAgain();
      ctx.logPublic(
        "Crane Dance: combo — attack action defenders with too much base power are restricted",
      );
    },
    modifyAttack(ctx) {
      return ctx.getFlag("link", "craneCombo") === true ? 1 : 0;
    },
    canBeDefendedBy(ctx, defending) {
      if (ctx.getFlag("link", "craneCombo") !== true || !isAttackAction(ctx, defending)) {
        return true;
      }
      return ctx.basePower(defending) <= ctx.chainLinksControlled(ctx.seat);
    },
  };
}

function rushingRiver(): CardScript {
  const requestTopCard = (ctx: ScriptCtx): void => {
    const hand = ctx.state.players[ctx.seat]!.hand;
    if (hand.length === 0) return;
    ctx.requestCardChoice(
      "rushing-top",
      "Rushing River: put a card from your hand on top of your deck",
      hand.map((card) => card.instanceId),
    );
  };
  return {
    onAttackDeclared(ctx) {
      if (!comboWith(ctx, "torrent of tempo")) return;
      ctx.setFlag("link", "rushingCombo", true);
      ctx.grantGoAgain();
    },
    modifyAttack(ctx) {
      return ctx.getFlag("link", "rushingCombo") === true ? 1 : 0;
    },
    canTriggerOnHit(ctx) {
      return ctx.getFlag("link", "rushingCombo") === true;
    },
    onHit(ctx) {
      const hits = ctx.state.chain.filter((link) => link.hit).length;
      if (hits <= 0) return;
      ctx.drawCards(ctx.seat, hits);
      ctx.setCounter("rushingRemaining", hits);
      requestTopCard(ctx);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "rushing-top") return;
      if (!ctx.putOnDeckTop(Number(option))) return;
      const remaining = Math.max(0, ctx.getCounter("rushingRemaining") - 1);
      ctx.setCounter("rushingRemaining", remaining);
      if (remaining > 0) requestTopCard(ctx);
    },
  };
}

function flyingKick(): CardScript {
  return {
    modifyAttack(ctx) {
      return ctx.state.chain.length >= 3 ? 2 : 0;
    },
  };
}

function dauntless(attack: number): CardScript {
  return {
    onPlay(ctx) {
      nextAttack(ctx, attack, "weapon");
      const defender = opponentSeat(ctx);
      const current = Number(ctx.getPlayerFlag(defender, "nextDefenseReactionExtraCost"));
      ctx.setPlayerFlag(defender, "nextDefenseReactionExtraCost", current + 1);
      ctx.logPublic("Dauntless: the defending hero's next defense reaction costs {r} more");
    },
  };
}

function hitAndRun(attack: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.addModifier({ scope: "next-attack", appliesTo: "weapon", goAgain: true });
      if (attackedWithWeapon(ctx)) nextAttack(ctx, attack, "any");
    },
  };
}

function pushForward(attack: number): CardScript {
  return {
    onPlay(ctx) {
      nextAttack(ctx, attack, "weapon");
      if (attackedWithWeapon(ctx)) {
        ctx.addModifier({ scope: "next-attack", dominate: true });
      }
    },
  };
}

export const cruNinjaWarrior: Record<string, CardScript> = {
  "katsu, the wanderer|0": {
    onSuppressedHit(ctx) {
      if (ctx.link?.attackCardType === "action") {
        ctx.setFlag("player", "katsuWandererUsed", true);
      }
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "action" &&
        ctx.getFlag("player", "katsuWandererUsed") !== true;
    },
    onHit(ctx) {
      ctx.setFlag("player", "katsuWandererUsed", true);
      const zeroes = ctx.state.players[ctx.seat]!.hand.filter(
        (card) => (ctx.cardData(card.cardId).cost ?? 0) === 0,
      );
      if (zeroes.length === 0) return;
      ctx.requestCardChoice(
        "katsu-discard",
        "Katsu: discard a cost 0 card to search for a combo card?",
        ["pass", ...zeroes.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "katsu-discard") {
        if (option === "pass" || !ctx.discardCard(ctx.seat, Number(option))) return;
        const combo = ctx.state.players[ctx.seat]!.deck.filter((card) => hasCombo(ctx, card));
        if (combo.length === 0) {
          ctx.shuffleDeck(ctx.seat);
          return;
        }
        ctx.requestCardChoice(
          "katsu-search",
          "Katsu: choose a combo card to banish face up",
          combo.map((card) => card.instanceId),
        );
        return;
      }
      if (hook !== "katsu-search") return;
      const id = Number(option);
      if (!ctx.banish(id)) return;
      ctx.allowPlayFrom(id, "banish");
      ctx.shuffleDeck(ctx.seat);
      ctx.logPublic("Katsu: the searched combo card is banished and may be played this turn");
    },
  },

  "ira, crimson haze|0": {
    onFriendlyAttackDeclared(ctx) {
      const attacks = Number(ctx.getFlag("player", "iraAttacks")) + 1;
      ctx.setFlag("player", "iraAttacks", attacks);
      if (attacks === 2) ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },

  "benji, the piercing wind|0": {
    canBeDefendedBy(ctx, _defending, fromHand) {
      if (!fromHand || !ctx.link || ctx.link.attackCardType !== "action") return true;
      return ctx.currentAttackPower() > 2;
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "action" &&
        ctx.getFlag("player", "benjiHitUsed") !== true;
    },
    onHit(ctx) {
      ctx.setFlag("player", "benjiHitUsed", true);
      nextAttack(ctx, 1);
    },
    onSuppressedHit(ctx) {
      if (ctx.link?.attackCardType === "action") {
        ctx.setFlag("player", "benjiHitUsed", true);
      }
    },
  },

  "harmonized kodachi|0": {
    activated: { cost: 1, isAttack: true, goAgain: false, oncePerTurn: true },
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      const hasZero = ctx.state.players[ctx.seat]!.pitch.some(
        (card) => (ctx.cardData(card.cardId).cost ?? 0) === 0,
      );
      if (hasZero) ctx.grantGoAgain();
    },
  },

  "edge of autumn|0": {
    activated: { cost: 1, isAttack: true, goAgain: true, oncePerTurn: true },
  },

  "zephyr needle|0": {
    activated: { cost: 1, isAttack: true, goAgain: true, oncePerTurn: true },
    destroyOnChainCloseWhenDefendedByHigherDefense: true,
  },

  "crane dance|1": craneDance(),
  "crane dance|2": craneDance(),
  "crane dance|3": craneDance(),
  "rushing river|1": rushingRiver(),
  "rushing river|2": rushingRiver(),
  "rushing river|3": rushingRiver(),
  "flying kick|1": flyingKick(),
  "flying kick|2": flyingKick(),
  "flying kick|3": flyingKick(),
  "soulbead strike|1": hitGoAgain(),
  "soulbead strike|2": hitGoAgain(),
  "soulbead strike|3": hitGoAgain(),
  "torrent of tempo|1": hitGoAgain(),
  "torrent of tempo|2": hitGoAgain(),
  "torrent of tempo|3": hitGoAgain(),
  "bittering thorns|2": {
    onHit(ctx) {
      nextAttack(ctx, 1);
    },
  },
  "whirling mist blossom|2": {
    canTriggerOnHit(ctx) {
      const current = ctx.state.chain.length - 1;
      return current > 0 && ctx.state.chain[current - 1]?.hit === true;
    },
    onHit(ctx) { ctx.drawCards(ctx.seat, 2); },
  },
  "zen state|0": {
    fixedDamagePrevention: { amount: 1 },
    onEnterArena(ctx) {
      ctx.setCounter("balance", 1);
    },
    triggers: [
      {
        event: "begin-action-phase",
        whose: "subject",
        label: "Remove a balance counter or destroy Zen State",
        effect(ctx) {
          if (ctx.getCounter("balance") <= 0) {
            ctx.destroySelf();
            return;
          }
          ctx.requestChoice(
            "zen-maintenance",
            "Zen State: remove a balance counter or destroy it?",
            ["remove", "destroy"],
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook !== "zen-maintenance") return;
      if (option === "remove" && ctx.getCounter("balance") > 0) {
        ctx.setCounter("balance", ctx.getCounter("balance") - 1);
      } else {
        ctx.destroySelf();
      }
    },
  },

  "dorinthea ironsong|0": {
    onSuppressedHit(ctx) {
      if (isWeaponAttack(ctx)) ctx.setFlag("player", "dorintheaIronsongUsed", true);
    },
    canTriggerOnHit(ctx) {
      return isWeaponAttack(ctx) && ctx.getFlag("player", "dorintheaIronsongUsed") !== true;
    },
    onHit(ctx) {
      ctx.setFlag("player", "dorintheaIronsongUsed", true);
      ctx.grantAdditionalActivation(ctx.link!.attackingCard.instanceId);
    },
  },

  "kassai, cintari sellsword|0": {
    modifyAttackActivationCost(ctx, attacker, baseCost) {
      return isSword(ctx, attacker) && weaponAttacks(ctx) === 1 ? baseCost - 1 : baseCost;
    },
    canTriggerOnHit: isWeaponAttack,
    onHit(ctx) {
      ctx.setFlag(
        "player",
        "kassaiWeaponHits",
        Number(ctx.getFlag("player", "kassaiWeaponHits")) + 1,
      );
    },
    triggers: [
      {
        event: "end-of-turn",
        whose: "subject",
        condition: (ctx) => weaponAttacks(ctx) >= 2,
        label: "Create Copper for weapon attacks that hit",
        effect(ctx) {
          const hits = Number(ctx.getFlag("player", "kassaiWeaponHits"));
          ctx.createTokens(COPPER, hits);
        },
      },
    ],
  },

  "cintari saber|0": {
    activated: { cost: 1, isAttack: true, goAgain: false, oncePerTurn: true },
    modifyAttack(ctx) {
      return Number(ctx.getFlag("player", `cintariBonus:${ctx.self.instanceId}`));
    },
    friendlyDefendedTrigger: {
      label: "When Cintari Saber is defended by an attack action card",
      condition(ctx, defenders) {
        return ctx.link?.attackingCard.instanceId === ctx.self.instanceId &&
          defenders.some((card) => isAttackAction(ctx, card));
      },
    },
    onFriendlyDefended(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      const key = `cintariBonus:${ctx.self.instanceId}`;
      ctx.setFlag("player", key, Number(ctx.getFlag("player", key)) + 1);
    },
  },

  "dauntless|1": dauntless(3),
  "dauntless|2": dauntless(2),
  "dauntless|3": dauntless(1),
  "out for blood|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      if (ctx.getFlag("link", "defendedFromHand") === true) nextAttack(ctx, 1);
    },
  },
  "hit and run|1": hitAndRun(3),
  "hit and run|2": hitAndRun(2),
  "push forward|1": pushForward(3),
  "push forward|2": pushForward(2),
  "push forward|3": pushForward(1),
};
