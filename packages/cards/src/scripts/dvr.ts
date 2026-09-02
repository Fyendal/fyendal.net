import type { CardScript, ScriptCtx } from "@fyendal/engine";
import { attackAbility, attackedWithWeapon, isCard, isSwordAttack, isWeaponAttack, lessonCounter, localizedCardLog, mentorFlipTrigger, mentorPayoff, nextAttack, reprise, weaponAttackCount } from "./shared-helpers.js";

// ── Dorinthea (hero / weapon / equipment / mentor / token / deck cards) ──
export const dvr: Record<string, CardScript> = {
  "dorinthea, quicksilver prodigy|0": {
    // Dorinthea, Quicksilver Prodigy — the first time Dawnblade's attack gets
    // go again each turn (declared with it, or granted later e.g. on hit),
    // you may attack an additional time with it (re-enable its ability)
    onGainGoAgain(ctx) {
      const link = ctx.link;
      if (!link || !isCard(ctx, link.attackingCard.cardId, "Dawnblade, Resplendent")) return;
      if (ctx.getFlag("player", "dorintheaExtraAttack")) return;
      ctx.setFlag("player", "dorintheaExtraAttack", true);
      const p = ctx.state.players[ctx.seat]!;
      const dawnblade = p.weapons.find((w) => isCard(ctx, w.cardId, "Dawnblade, Resplendent"));
      if (dawnblade) {
        ctx.grantAdditionalActivation(dawnblade.instanceId);
        ctx.logPublic(localizedCardLog(ctx, "Dorinthea's ability: Dawnblade may attack an additional time this turn", "card.log.dvr.dorinthea.additionalattack"));
      }
    },
  },
  "dawnblade, resplendent|0": {
    // Dawnblade, Resplendent — Once per Turn Action {r}: Attack;
    // the second time you attack with this each turn, it gets +1{p} until end of turn
    activated: attackAbility(1),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId !== ctx.self.instanceId) return;
      if (weaponAttackCount(ctx) === 2) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "sword" });
        ctx.logPublic(localizedCardLog(ctx, "Dawnblade, Resplendent gains +1 attack until end of turn", "card.log.dvr.dawnblade.turn.attack", { amount: 1 }));
      }
    },
  },
  "blossom of spring|0": {
    // Blossom of Spring — Action, destroy this: Gain {r}. Go again
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 1);
        ctx.logPublic(localizedCardLog(ctx, "Blossom of Spring: gained {r}", "card.log.common.resources.gained", { amount: 1 }));
        ctx.destroySelf();
      },
    },
  },
  "gallantry gold|0": {
    // Gallantry Gold — Action {r}, destroy: your weapon attacks gain +1{p} this turn. Go again
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      onActivate(ctx) {
        ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesTo: "weapon" });
        ctx.logPublic(localizedCardLog(ctx, "Gallantry Gold: weapon attacks gain +1 attack this turn", "card.log.dvr.gallantry.weapon.attack", { amount: 1 }));
        ctx.destroySelf();
      },
    },
  },
  "hala goldenhelm|0": {
    activeWhileFaceUpInArsenal: true,
    // Hala Goldenhelm — mentor: face down in arsenal, flips up at start of turn;
    // whenever a sword attack you control hits, it gains go again
    triggers: [mentorFlipTrigger()],
    canTriggerOnHit: isSwordAttack,
    onHit(ctx) {
      ctx.grantGoAgain();
      ctx.logPublic(localizedCardLog(ctx, "Hala Goldenhelm: the attack gains go again", "card.log.common.attack.goagain.gained"));
      if (lessonCounter(ctx) >= 2) mentorPayoff(ctx, "Glistening Steelblade", 2);
    },
  },
  "quicken|0": {
    // Quicken token — playing an attack action card or activating a weapon
    // attack destroys this and gives that attack go again.
    triggers: [
      {
        event: "card-played",
        label: "Destroy Quicken (attack gains go again)",
        condition: (ctx, played) => !!played &&
          ctx.hasCardType(played, "action") &&
          ctx.cardTypes(played).includes("attack"),
        effect(ctx) {
          ctx.grantGoAgain();
          ctx.logPublic(localizedCardLog(ctx, "Quicken: the attack gains go again", "card.log.common.attack.goagain.gained"));
          ctx.destroySelf();
        },
      },
      {
        event: "weapon-attack-activated",
        label: "Destroy Quicken (attack gains go again)",
        effect(ctx) {
          ctx.grantGoAgain();
          ctx.logPublic(localizedCardLog(ctx, "Quicken: the attack gains go again", "card.log.common.attack.goagain.gained"));
          ctx.destroySelf();
        },
      },
    ],
  },

  // ── Dorinthea deck ──
  "en garde|1": {
    // En Garde (red)
    onPlay: nextAttack({ attack: 3, appliesTo: "weapon" }),
  },
  "flock of the feather walkers|1": ((): CardScript => {
    // Flock of the Feather Walkers (red)
    const revealable = (ctx: ScriptCtx) => (c: { instanceId: number; cardId: string }) =>
      c.instanceId !== ctx.self.instanceId && (ctx.cardData(c.cardId).cost ?? 99) <= 1;
    return {
      canPlay(ctx) {
        return ctx.state.players[ctx.seat]!.hand.some(revealable(ctx));
      },
      additionalCost(ctx) {
        const reveal = ctx.state.players[ctx.seat]!.hand.find(revealable(ctx));
        if (reveal) ctx.logPublic(localizedCardLog(
          ctx,
          `reveals ${ctx.cardData(reveal.cardId).name} (cost 1 or less)`,
          "card.log.common.reveal.cost.maximum",
          { revealed: { kind: "card", cardId: reveal.cardId }, cost: 1 },
          { kind: "cards-revealed", cards: [{ cardId: reveal.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
        ));
      },
      onAttackDeclared(ctx) {
        ctx.createToken("DVR028");
      },
    };
  })(),
  "in the swing|1": {
    // In the Swing (red)
    canPlay: (ctx) => isWeaponAttack(ctx) && weaponAttackCount(ctx) >= 2,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
    },
  },
  "ironsong response|1": {
    // Ironsong Response (red) — Reprise
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      if (reprise(ctx)) {
        ctx.addModifier({ scope: "chain-link", attack: 3 });
        ctx.logPublic(localizedCardLog(ctx, "Ironsong Response (Reprise): +3 attack", "card.log.common.reprise.attack", { amount: 3 }));
      }
    },
  },
  "second swing|1": {
    // Second Swing (red)
    onPlay(ctx) {
      if (attackedWithWeapon(ctx)) nextAttack({ attack: 4, appliesTo: "any" })(ctx);
    },
  },
  "sharpen steel|1": {
    // Sharpen Steel (red)
    onPlay: nextAttack({ attack: 3, appliesTo: "weapon" }),
  },
  "thrust|1": {
    // Thrust (red)
    canPlay: isSwordAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 3 });
    },
  },
  "warrior's valor|1": {
    // Warrior's Valor (red)
    onPlay(ctx) {
      nextAttack({ attack: 3, appliesTo: "weapon" })(ctx);
      nextAttack({ appliesTo: "weapon", onHitGoAgain: true })(ctx);
    },
  },
  "driving blade|2": {
    // Driving Blade (yellow)
    onPlay(ctx) {
      nextAttack({ attack: 2, appliesTo: "weapon", goAgain: true })(ctx);
    },
  },
  "glistening steelblade|2": {
    // Glistening Steelblade (yellow) — next Dawnblade attack has go again;
    // whenever Dawnblade hits a hero this turn, put a +1{p} counter on it
    onPlay(ctx) {
      nextAttack({ appliesTo: "weapon", goAgain: true })(ctx);
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "sword" }); // marker
    },
    canTriggerOnHit(ctx) {
      const link = ctx.link;
      return !!link && link.targetAllyId === undefined &&
        isCard(ctx, link.attackingCard.cardId, "Dawnblade, Resplendent");
    },
    onHit(ctx) {
      ctx.addModifier({ scope: "static", attack: 1, appliesTo: "sword" });
      ctx.logPublic(localizedCardLog(ctx, "Dawnblade, Resplendent gets a +1 attack counter", "card.log.dvr.dawnblade.counter", { amount: 1 }));
    },
  },
  "on a knife edge|2": {
    // On a Knife Edge (yellow)
    onPlay(ctx) {
      nextAttack({ appliesTo: "sword", goAgain: true })(ctx);
    },
  },
  "out for blood|2": {
    // Out for Blood (yellow) — Reprise
    canPlay: isWeaponAttack,
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 2 });
      if (reprise(ctx)) {
        nextAttack({ attack: 1, appliesTo: "any" })(ctx);
        ctx.logPublic(localizedCardLog(ctx, "Out for Blood (Reprise): your next attack gains +1", "card.log.dvr.outforblood.reprise", { amount: 1 }));
      }
    },
  },
  "run through|2": {
    // Run Through (yellow)
    canPlay: isSwordAttack,
    onPlay(ctx) {
      ctx.grantGoAgain();
      nextAttack({ attack: 2, appliesTo: "sword" })(ctx);
    },
  },
  "slice and dice|2": {
    // Slice and Dice (yellow) — first sword/dagger attack +1, second +2
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", appliesTo: "sword" }); // marker
    },
    modifyAttack(ctx) {
      if (
        !isWeaponAttack(ctx) ||
        !ctx.link ||
        !ctx.cardTypes(ctx.link.attackingCard)
          .some((subtype) => subtype === "sword" || subtype === "dagger")
      ) return 0;
      const n = weaponAttackCount(ctx);
      if (n === 1) return 1;
      if (n === 2) return 2;
      return 0;
    },
  },
  "blade flash|3": {
    // Blade Flash (blue)
    canPlay: isSwordAttack,
    onPlay(ctx) {
      ctx.grantGoAgain();
    },
  },
  "hit and run|3": {
    // Hit and Run (blue)
    onPlay(ctx) {
      nextAttack({ appliesTo: "weapon", goAgain: true })(ctx);
      if (attackedWithWeapon(ctx)) nextAttack({ attack: 1, appliesTo: "any" })(ctx);
    },
  },
  "sigil of solace|3": {
    // Sigil of Solace (blue)
    onPlay(ctx) {
      ctx.gainLife(ctx.seat, 1);
    },
  },
  "visit the blacksmith|3": {
    // Visit the Blacksmith (blue)
    onPlay: nextAttack({ attack: 1, appliesTo: "sword" }),
  },
};
