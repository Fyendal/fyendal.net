import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, decisionMessage, decisionPrompt, localizedLog, opponentSeat, payForDefenseBoost } from "../shared-helpers.js";

// ── WTR Guardian cards ──────────────────────────────────────────────────────
//
// Crush keyword: these attacks have an additional "on hit" effect if they deal
// 4 or more damage to a hero.

function crushTriggered(ctx: ScriptCtx): boolean {
  return !!ctx.link && ctx.link.damage >= 4 && ctx.link.hit;
}


function opponentEquipmentOptions(ctx: ScriptCtx): string[] {
  const opp = ctx.player(opponentSeat(ctx));
  const options: string[] = [];
  for (const [slot, eq] of Object.entries(opp.equipment)) {
    if (eq) options.push(`${slot}:${eq.instanceId}`);
  }
  return options;
}

function findOpponentEquipment(
  ctx: ScriptCtx,
  optionId: string,
): { readonly instanceId: number; readonly cardId: string; readonly defCounters?: number } | undefined {
  const opp = ctx.player(opponentSeat(ctx));
  const instanceId = Number(optionId.split(":")[1]);
  return Object.values(opp.equipment).find((eq) => eq?.instanceId === instanceId);
}

// ── Auras: Blessing of Deliverance, Emerging Power, Stonewall Confidence ─────
//
// These non-attack actions have the Aura subtype in the complete WTR data, so
// the engine settles the played card itself into the arena.

function blessingOfDeliverance(topN: number): CardScript {
  return {
    onPlay(ctx) {
      const hasCost3 = ctx.state.players[ctx.seat]!.pitch.some(
        (c) => (ctx.cardData(c.cardId).cost ?? 0) >= 3,
      );
      if (hasCost3) {
        ctx.drawCards(ctx.seat, 1);
        ctx.logPublic(localizedLog(
          "Blessing of Deliverance: drew a card",
          "card.log.common.card.drawn",
          { card: { kind: "card", cardId: ctx.self.cardId } },
        ));
      }
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Blessing of Deliverance and reveal top cards",
        effect(ctx) {
          ctx.destroySelf();
          const p = ctx.state.players[ctx.seat]!;
          let life = 0;
          for (let i = 0; i < Math.min(topN, p.deck.length); i++) {
            const c = p.deck[i]!;
            if ((ctx.cardData(c.cardId).cost ?? 0) >= 3) life++;
          }
          if (life > 0) {
            ctx.gainLife(ctx.seat, life);
            ctx.logPublic(localizedLog(
              `Blessing of Deliverance: gained ${life} life`,
              "card.log.wtr.blessing.life",
              { card: { kind: "card", cardId: ctx.self.cardId }, amount: life },
            ));
          }
        },
      },
    ],
  };
}

function emergingPower(bonus: number): CardScript {
  return {
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Emerging Power and buff next Guardian attack",
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, { attack: bonus,
            appliesTo: "attack-action",
            appliesToClass: "guardian", });
          ctx.logPublic(localizedLog(
            `Emerging Power: next Guardian attack action gets +${bonus} attack`,
            "card.log.wtr.emergingpower.attack",
            { card: { kind: "card", cardId: ctx.self.cardId }, amount: bonus },
          ));
        },
      },
    ],
  };
}

function stonewallConfidence(bonus: number): CardScript {
  return {
    onEnterArena(ctx) {
      // The buff lives on the aura so it expires when the aura is destroyed.
      ctx.addModifier(
        { scope: "static", defense: bonus, minCost: 3 },
        ctx.self,
      );
      ctx.logPublic(localizedLog(
        `Stonewall Confidence: cards you control with cost 3 or more get +${bonus} defense while defending`,
        "card.log.wtr.stonewall.defense",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount: bonus },
      ));
    },
    triggers: [
      {
        event: "start-of-turn",
        label: "Destroy Stonewall Confidence",
        effect(ctx) {
          ctx.destroySelf();
        },
      },
    ],
  };
}

// ── Crush attacks ────────────────────────────────────────────────────────────

function bucklingBlow(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const options = opponentEquipmentOptions(ctx);
      if (options.length === 0) return;
      ctx.requestChoice(
        "buckling-blow-target",
        decisionPrompt("Buckling Blow: put a -1 defense counter on an equipment they control", "card.wtr.buckling.equipment.choose", { optionMessages: Object.fromEntries(options.flatMap((value) => {
          const equipment = findOpponentEquipment(ctx, value);
          return equipment ? [[value, decisionMessage("card.common.target.card", { card: { kind: "card", cardId: equipment.cardId } })]] : [];
        })) }),
        options,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "buckling-blow-target") return;
      const eq = findOpponentEquipment(ctx, option);
      if (eq) {
        ctx.addCardDefenseCounters(eq.instanceId, 1);
        ctx.logPublic(localizedLog(
          `${ctx.cardData(eq.cardId).name} gets a -1 defense counter`,
          "card.log.wtr.bucklingblow.counter",
          {
            card: { kind: "card", cardId: ctx.self.cardId },
            target: { kind: "card", cardId: eq.cardId },
            amount: 1,
          },
        ));
      }
    },
  };
}

function cartilageCrush(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      ctx.increaseFirstActionCostNextTurn(opponentSeat(ctx), 1);
      ctx.logPublic(localizedLog(
        "Cartilage Crush: opponent's next action costs +{r}",
        "card.log.wtr.cartilagecrush.cost",
        { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: opponentSeat(ctx) }, amount: 1 },
      ));
    },
  };
}

function crushConfidence(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      ctx.suppressHeroAbilitiesThroughNextTurn(opponentSeat(ctx));
      ctx.logPublic(localizedLog(
        "Crush Confidence: opponent loses hero abilities until end of next turn",
        "card.log.wtr.crushconfidence.suppressed",
        { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: opponentSeat(ctx) } },
      ));
    },
  };
}

function debilitate(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      // seat-targeted debuff: rides the modifier list so it shows up as an
      // ongoing effect and only applies to the opponent's attacks
      buffNextAttack(ctx, { attack: -2, seat: opponentSeat(ctx) });
      ctx.logPublic(localizedLog(
        "Debilitate: opponent's next attack gets -2{p}",
        "card.log.wtr.debilitate.attack",
        { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: opponentSeat(ctx) }, amount: 2 },
      ));
    },
  };
}

function disable(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      if (opp.arsenal.length > 0) {
        const card = opp.arsenal[0]!;
        ctx.putOnDeckBottom(card.instanceId);
        ctx.logPublic(localizedLog(
          "Disable: put the arsenal card on the bottom of the deck",
          "card.log.wtr.disable.arsenal.bottom",
          { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: opponentSeat(ctx) } },
          {
            kind: "card-moved",
            ownerSeat: opponentSeat(ctx),
            from: "arsenal",
            to: "deck",
          },
        ));
      }
    },
  };
}

// ── Defense reaction ─────────────────────────────────────────────────────────

function staunchResponse(): CardScript {
  return payForDefenseBoost(4, 3, {
    onPlay: true,
    message: "Staunch Response: pay {r}{r}{r}{r} for +3 defense?",
    logMessage: "Staunch Response: +3 defense",
  });
}

export const guardian: Record<string, CardScript> = {
  // ── Hero ──
  "bravo|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          dominate: true,
          appliesTo: "attack-action",
          minCost: 3,
        });
        ctx.logPublic(localizedLog(
          "Bravo: attack action cards with cost 3 or more gain dominate this turn",
          "card.log.wtr.bravo.dominate",
          { card: { kind: "card", cardId: ctx.self.cardId } },
        ));
      },
    },
  },

  // ── Equipment ──
  "helm of isen's peak|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      onActivate(ctx) {
        ctx.setPlayerFlag(ctx.seat, "bonusIntellect", 1);
        ctx.logPublic(localizedLog(
          "Helm of Isen's Peak: +1 intellect this turn",
          "card.log.wtr.helm.intellect",
          { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 },
        ));
        ctx.destroySelf();
      },
    },
  },

  // ── Auras ──
  "blessing of deliverance|1": blessingOfDeliverance(3),
  "blessing of deliverance|2": blessingOfDeliverance(2),
  "blessing of deliverance|3": blessingOfDeliverance(1),
  "emerging power|1": emergingPower(3),
  "emerging power|2": emergingPower(2),
  "emerging power|3": emergingPower(1),
  "stonewall confidence|1": stonewallConfidence(4),
  "stonewall confidence|2": stonewallConfidence(3),
  "stonewall confidence|3": stonewallConfidence(2),

  // ── Crush attacks ──
  "buckling blow|1": bucklingBlow(),
  "buckling blow|2": bucklingBlow(),
  "buckling blow|3": bucklingBlow(),
  "cartilage crush|1": cartilageCrush(),
  "cartilage crush|2": cartilageCrush(),
  "cartilage crush|3": cartilageCrush(),
  "crush confidence|1": crushConfidence(),
  "crush confidence|2": crushConfidence(),
  "crush confidence|3": crushConfidence(),
  "debilitate|1": debilitate(),
  "debilitate|2": debilitate(),
  "debilitate|3": debilitate(),
  "disable|1": disable(),
  "disable|2": disable(),
  "disable|3": disable(),

  // ── Defense reaction ──
  "staunch response|1": staunchResponse(),
  "staunch response|2": staunchResponse(),
  "staunch response|3": staunchResponse(),
};
