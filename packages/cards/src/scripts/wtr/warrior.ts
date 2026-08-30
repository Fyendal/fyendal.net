import type { CardScript } from "@fyendal/engine";
import { isWeaponAttack, nextAttack, reprise } from "../shared-helpers.js";

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
        "Stroke of Foresight: choose a card from your hand",
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
          "Stroke of Foresight: put it on the top or bottom of your deck?",
          ["top", "bottom"],
        );
        return;
      }
      if (hook !== "stroke-position") return;
      const card = p.hand.find((c) => c.instanceId === ctx.getCounter("strokeCard"));
      if (!card) return;
      if (option === "top") {
        ctx.putOnDeckTop(card.instanceId);
        ctx.logPublic("Stroke of Foresight: card put on top of deck");
      } else {
        ctx.putOnDeckBottom(card.instanceId);
        ctx.logPublic("Stroke of Foresight: card put on bottom of deck");
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
      ctx.logPublic(`Nature's Path Pilgrimage reveals ${data.name}`);
      if (ctx.hasCardType(top, "action")) {
        ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: false });
        ctx.logPublic("Nature's Path Pilgrimage: action card put face down into arsenal");
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
      ctx.logPublic("Dorinthea's ability: the weapon may attack an additional time this turn");
    },
  },

  // ── Attack reactions ──
  "biting blade|1": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic("Biting Blade (Reprise): weapons you control gain +1 attack");
      }
    },
  },
  "biting blade|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic("Biting Blade (Reprise): weapons you control gain +1 attack");
      }
    },
  },
  "biting blade|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic("Biting Blade (Reprise): weapons you control gain +1 attack");
      }
    },
  },

  "overpower|1": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 6 : 4;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic("Overpower (Reprise): +6 attack");
    },
  },
  "overpower|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 5 : 3;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic("Overpower (Reprise): +5 attack");
    },
  },
  "overpower|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      const bonus = reprise(ctx) ? 4 : 2;
      ctx.addModifier({ scope: "chain-link", attack: bonus });
      if (reprise(ctx)) ctx.logPublic("Overpower (Reprise): +4 attack");
    },
  },

  "ironsong response|2": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: 2 });
        ctx.logPublic("Ironsong Response (Reprise): +2 attack");
      }
    },
  },
  "ironsong response|3": {
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
        ctx.logPublic("Ironsong Response (Reprise): +1 attack");
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
      ctx.logPublic("Steelblade Shunt deals 1 damage to the attacking hero");
    },
  },
  "steelblade shunt|2": {
    onPlay(ctx) {
      if (!isWeaponAttack(ctx)) return;
      const attacker = ctx.state.players[ctx.link!.attacker]!;
      ctx.dealDamage(attacker.seat, 1);
      ctx.logPublic("Steelblade Shunt deals 1 damage to the attacking hero");
    },
  },
  "steelblade shunt|3": {
    onPlay(ctx) {
      if (!isWeaponAttack(ctx)) return;
      const attacker = ctx.state.players[ctx.link!.attacker]!;
      ctx.dealDamage(attacker.seat, 1);
      ctx.logPublic("Steelblade Shunt deals 1 damage to the attacking hero");
    },
  },

  // ── Equipment ──
  "refraction bolters|0": {
    canTriggerOnHit: isWeaponAttack,
    onHit(ctx) {
      ctx.requestChoice(
        "refraction-bolters",
        "Refraction Bolters: destroy this to give the attack go again?",
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "refraction-bolters" || option !== "yes") return;
      // the link is already resolved when the choice is answered, so grant
      // the action point directly (resolveLink's go-again check has passed)
      ctx.gainActionPoint();
      ctx.logPublic("Refraction Bolters: the attack gains go again (+1 action point)");
      ctx.destroySelf();
    },
  },
};
