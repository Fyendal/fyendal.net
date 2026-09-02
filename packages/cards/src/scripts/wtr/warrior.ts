import type { CardScript } from "@fyendal/engine";
import { commonOptionMessages, decisionPrompt, isWeaponAttack, localizedLog, nextAttack, reprise, yesNoPrompt } from "../shared-helpers.js";

// ── Welcome to Rathe (WTR) warrior-class cards ──
//
// These are the WTR printings not already covered by DVR reprints:
//   driving blade|1 / |3  (|2 is DVR)
//   sharpen steel|2 / |3  (|1 is DVR)
//   warrior's valor|2 / |3  (|1 is DVR)
//   ironsong response|2 / |3  (|1 is DVR)

function strokeOfForesight(bonus: number): CardScript {
  return {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (!reprise(ctx)) return;
      ctx.drawCards(ctx.seat, 1);
      const p = ctx.player(ctx.seat);
      if (p.hand.length === 0) return;
      ctx.requestCardChoice(
        "stroke-card",
        decisionPrompt("Stroke of Foresight: choose a card from your hand", "card.wtr.stroke.card.choose"),
        p.hand.map((c) => c.instanceId),
      );
    },
    onChoose(ctx, hook, option) {
      const p = ctx.player(ctx.seat);
      if (hook === "stroke-card") {
        // remember the pick while the follow-up position choice is answered
        ctx.setCounter("strokeCard", Number(option));
        ctx.requestChoice(
          "stroke-position",
          decisionPrompt("Stroke of Foresight: put it on the top or bottom of your deck?", "card.wtr.stroke.position", { optionMessages: commonOptionMessages("top", "bottom") }),
          ["top", "bottom"],
        );
        return;
      }
      if (hook !== "stroke-position") return;
      const card = p.hand.find((c) => c.instanceId === ctx.getCounter("strokeCard"));
      if (!card) return;
      if (option === "top") {
        ctx.putOnDeckTop(card.instanceId);
        ctx.logPublic(localizedLog(
          "Stroke of Foresight: card put on top of deck",
          "card.log.wtr.stroke.card.top",
          { card: { kind: "card", cardId: ctx.self.cardId } },
          { kind: "card-moved", ownerSeat: ctx.seat, from: "hand", to: "deck" },
        ));
      } else {
        ctx.putOnDeckBottom(card.instanceId);
        ctx.logPublic(localizedLog(
          "Stroke of Foresight: card put on bottom of deck",
          "card.log.wtr.stroke.card.bottom",
          { card: { kind: "card", cardId: ctx.self.cardId } },
          { kind: "card-moved", ownerSeat: ctx.seat, from: "hand", to: "deck" },
        ));
      }
    },
  };
}

function naturesPathPilgrimage(attack: number): CardScript {
  return {
    onPlay(ctx) {
      nextAttack({ attack, appliesTo: "weapon" })(ctx);
      // Marker so the source card's onHit fires for the granted triggered ability.
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "weapon" });
      ctx.setFlag("player", "naturesPathPilgrimageActive", true);
    },
    canTriggerOnHit(ctx) {
      return isWeaponAttack(ctx) && ctx.getFlag("player", "naturesPathPilgrimageActive") === true;
    },
    onHit(ctx) {
      const p = ctx.player(ctx.seat);
      if (p.arsenal.length > 0) {
        ctx.setFlag("player", "naturesPathPilgrimageActive", false);
        return;
      }
      const top = p.deck[0];
      if (!top) {
        ctx.setFlag("player", "naturesPathPilgrimageActive", false);
        return;
      }
      const data = ctx.cardData(top.cardId);
      ctx.logPublic(localizedLog(
        `Nature's Path Pilgrimage reveals ${data.name}`,
        "card.log.wtr.naturespath.reveals",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          revealed: { kind: "card", cardId: top.cardId },
        },
        { kind: "cards-revealed", cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }], sourceZone: "deck" },
      ));
      if (ctx.hasCardType(top, "action")) {
        ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
        ctx.logPublic(localizedLog(
          "Nature's Path Pilgrimage: action card put face down into arsenal",
          "card.log.wtr.naturespath.arsenal",
          {
            card: { kind: "card", cardId: ctx.self.cardId },
            result: { kind: "card", cardId: top.cardId },
          },
          {
            kind: "card-moved",
            cardId: top.cardId,
            ownerSeat: ctx.seat,
            from: "deck",
            to: "arsenal",
            faceDown: true,
          },
        ));
      }
      ctx.setFlag("player", "naturesPathPilgrimageActive", false);
    },
  };
}

export const warrior: Record<string, CardScript> = {
  // ── Hero ──
  "dorinthea|0": {
    // Young Dorinthea — the first weapon hit each turn must grant permission
    // to attack an additional time with that weapon. The player chooses
    // whether to use that permission later by attacking again; resolving the
    // hit itself is not optional. The once-per-turn flag is cleared by normal
    // turn cleanup; this is not a beginning-of-turn triggered ability.
    onSuppressedHit(ctx) {
      if (isWeaponAttack(ctx)) ctx.setFlag("player", "dorintheaWtrTriggered", true);
    },
    canTriggerOnHit(ctx) {
      return isWeaponAttack(ctx) && ctx.getFlag("player", "dorintheaWtrTriggered") !== true;
    },
    onHit(ctx) {
      const link = ctx.link!;
      const p = ctx.state.players[ctx.seat]!;
      const weapon = p.weapons.find(
        (w) => w.instanceId === link.attackingCard.instanceId,
      );
      if (!weapon) return;
      ctx.setFlag("player", "dorintheaWtrTriggered", true);
      ctx.grantAdditionalActivation(weapon.instanceId);
      ctx.logPublic(localizedLog(
        "Dorinthea's ability: the weapon may attack an additional time this turn",
        "card.log.wtr.dorinthea.additionalattack",
        { card: { kind: "card", cardId: ctx.self.cardId } },
      ));
    },
  },

  // ── Attack reactions ──
  "biting blade|1": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic(localizedLog("Biting Blade (Reprise): weapons you control gain +1 attack", "card.log.wtr.bitingblade.reprise", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 }));
      }
    },
  },
  "biting blade|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic(localizedLog("Biting Blade (Reprise): weapons you control gain +1 attack", "card.log.wtr.bitingblade.reprise", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 }));
      }
    },
  },
  "biting blade|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic(localizedLog("Biting Blade (Reprise): weapons you control gain +1 attack", "card.log.wtr.bitingblade.reprise", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 }));
      }
    },
  },

  "overpower|1": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 6 : 4;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic(localizedLog("Overpower (Reprise): +6 attack", "card.log.wtr.reprise.attack", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 6 }));
    },
  },
  "overpower|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 5 : 3;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic(localizedLog("Overpower (Reprise): +5 attack", "card.log.wtr.reprise.attack", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 5 }));
    },
  },
  "overpower|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 4 : 2;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic(localizedLog("Overpower (Reprise): +4 attack", "card.log.wtr.reprise.attack", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 4 }));
    },
  },

  "ironsong response|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: 2 });
        ctx.logPublic(localizedLog("Ironsong Response (Reprise): +2 attack", "card.log.wtr.reprise.attack", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 2 }));
      }
    },
  },
  "ironsong response|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
        ctx.logPublic(localizedLog("Ironsong Response (Reprise): +1 attack", "card.log.wtr.reprise.attack", { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 }));
      }
    },
  },

  "stroke of foresight|1": strokeOfForesight(3),
  "stroke of foresight|2": strokeOfForesight(2),
  "stroke of foresight|3": strokeOfForesight(1),

  // ── Actions ──
  "driving blade|1": {
    onPlay: nextAttack({ attack: 3, appliesTo: "weapon", goAgain: true }),
  },
  "driving blade|3": {
    onPlay: nextAttack({ attack: 1, appliesTo: "weapon", goAgain: true }),
  },

  "sharpen steel|2": {
    onPlay: nextAttack({ attack: 2, appliesTo: "weapon" }),
  },
  "sharpen steel|3": {
    onPlay: nextAttack({ attack: 1, appliesTo: "weapon" }),
  },

  "warrior's valor|2": {
    onPlay: nextAttack({ attack: 2, appliesTo: "weapon", onHitGoAgain: true }),
  },
  "warrior's valor|3": {
    onPlay: nextAttack({ attack: 1, appliesTo: "weapon", onHitGoAgain: true }),
  },

  "nature's path pilgrimage|1": naturesPathPilgrimage(3),
  "nature's path pilgrimage|2": naturesPathPilgrimage(2),
  "nature's path pilgrimage|3": naturesPathPilgrimage(1),

  // ── Defense reactions ──
  // Steelblade Shunt is a defense reaction; onPlay fires both when it is played
  // as a reaction and when it is declared as a defending card.
  "steelblade shunt|1": {
    onPlay(ctx) {
      if (!isWeaponAttack(ctx)) return;
      const attacker = ctx.state.players[ctx.link!.attacker]!;
      ctx.dealDamage(attacker.seat, 1);
      ctx.logPublic(localizedLog("Steelblade Shunt deals 1 damage to the attacking hero", "card.log.wtr.steelbladeshunt.damage", { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: attacker.seat }, amount: 1 }, { kind: "damage", targetSeat: attacker.seat, amount: 1, damageType: "physical", sourceCardId: ctx.self.cardId }));
    },
  },
  "steelblade shunt|2": {
    onPlay(ctx) {
      if (!isWeaponAttack(ctx)) return;
      const attacker = ctx.state.players[ctx.link!.attacker]!;
      ctx.dealDamage(attacker.seat, 1);
      ctx.logPublic(localizedLog("Steelblade Shunt deals 1 damage to the attacking hero", "card.log.wtr.steelbladeshunt.damage", { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: attacker.seat }, amount: 1 }, { kind: "damage", targetSeat: attacker.seat, amount: 1, damageType: "physical", sourceCardId: ctx.self.cardId }));
    },
  },
  "steelblade shunt|3": {
    onPlay(ctx) {
      if (!isWeaponAttack(ctx)) return;
      const attacker = ctx.state.players[ctx.link!.attacker]!;
      ctx.dealDamage(attacker.seat, 1);
      ctx.logPublic(localizedLog("Steelblade Shunt deals 1 damage to the attacking hero", "card.log.wtr.steelbladeshunt.damage", { card: { kind: "card", cardId: ctx.self.cardId }, target: { kind: "player", seat: attacker.seat }, amount: 1 }, { kind: "damage", targetSeat: attacker.seat, amount: 1, damageType: "physical", sourceCardId: ctx.self.cardId }));
    },
  },

  // ── Equipment ──
  "refraction bolters|0": {
    canTriggerOnHit: isWeaponAttack,
    onHit(ctx) {
      ctx.requestChoice(
        "refraction-bolters",
        yesNoPrompt("Refraction Bolters: destroy this to give the attack go again?", "card.wtr.bolters.destroy"),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "refraction-bolters" || option !== "yes") return;
      // the link is already resolved when the choice is answered, so grant
      // the action point directly (resolveLink's go-again check has passed)
      ctx.gainActionPoint();
      ctx.logPublic(localizedLog(
        "Refraction Bolters: the attack gains go again (+1 action point)",
        "card.log.wtr.refractionbolters.goagain",
        { card: { kind: "card", cardId: ctx.self.cardId }, amount: 1 },
      ));
      ctx.destroySelf();
    },
  },
};
