import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  ampNextArcane,
  buffNextArcaneDamageCard,
  commonOptionMessages,
  dealArcane,
  decisionPrompt,
  opponentSeat,
  optN,
  optOnChoose,
  wizardActionAsInstant,
  yesNoPrompt,
} from "./shared-helpers.js";

// ── SBZ (Silver Age: Blaze, Firemind precon) ────────────────────────────────
//
// Wizard arcane-damage cards. New mechanics used here:
// - Opt N (shared-helpers optN/optOnChoose: sequential top/bottom scripted
//   choices whose click order determines the final order of both groups)
// - legacy "next arcane card +N" effects and event-time Amp use separate
//   shared-helper pools so each binds at the correct rules event
// - playing actions "as though they were instants" (engine: CardScript.playAsInstant)
// - Amp (engine: ActivatedAbility.fromHand — discard from hand at instant speed)
// - Surge (via onDamageDealt), Blaze's energy counters (persistent counters on
//   the hero, charged by every opt its controller performs)
// - Arcane Barrier / Guardwell are native engine keywords

const PONDER = "SBZ033";



/** Opt wrapper for the set: charges Blaze, Firemind with energy counters when
 *  the opting player is Blaze (her "Whenever you opt, …" trigger). */
function opt(ctx: ScriptCtx, n: number): void {
  const heroIsBlaze =
    ctx.cardData(ctx.player(ctx.seat).heroCardId).name === "Blaze, Firemind";
  optN(ctx, n, heroIsBlaze);
}

/** True while this card may be played as an instant via Blaze, Firemind's
 *  ability (per-turn flag set when the counters are removed). */
function viaBlaze(ctx: ScriptCtx): boolean {
  return wizardActionAsInstant(ctx);
}

function blazeMatches(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  amount: number,
): boolean {
  return (
    ctx.hasCardType(card, "action") &&
    !ctx.cardTypes(card).includes("attack") &&
    ctx.cardTypes(card).includes("wizard") &&
    ctx.arcaneDamageEffectAmounts(card.cardId).includes(amount)
  );
}

// ── "target hero" / "any target" choices ────────────────────────────────────

function requestHeroTarget(ctx: ScriptCtx, damage: number): void {
  const anyTarget = /any target/i.test(ctx.data.text ?? "");
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  if (anyTarget) {
    for (const player of ctx.state.players) {
      for (const card of player.board) {
        if (!ctx.cardTypes(card).includes("ally")) continue;
        options.push(`ally:${player.seat}:${card.instanceId}`);
        cardOptions.push(card.instanceId);
      }
    }
  }
  ctx.requestChoice(
    `target:${damage}`,
    decisionPrompt(
      `${ctx.data.name}: deal ${ctx.previewArcaneDamage(damage)} arcane damage to which target?`,
      "card.sbz.arcane.target.choose",
      {
        values: {
          card: { kind: "card", cardId: ctx.self.cardId },
          amount: ctx.previewArcaneDamage(damage),
        },
        optionMessages: {
          ...commonOptionMessages("opposing hero", "your hero"),
        },
      },
    ),
    options,
    ctx.seat,
    cardOptions,
  );
}

/** Shared onChoose for the target:${n} hook; returns true when handled. */
function targetOnChoose(ctx: ScriptCtx, hook: string, option: string): boolean {
  const m = /^target:(\d+)$/.exec(hook);
  if (!m) return false;
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  if (ally) {
    dealArcane(ctx, Number(ally[1]), Number(m[1]), Number(ally[2]));
    return true;
  }
  dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), Number(m[1]));
  return true;
}

// ── factories ───────────────────────────────────────────────────────────────

/** "Deal N arcane damage to target hero" + optional extra hooks. */
function arcaneBolt(damage: number, extra: CardScript = {}): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: viaBlaze,
    onPlay: (ctx) => requestHeroTarget(ctx, damage),
    ...extra,
    onChoose(ctx, hook, option) {
      if (targetOnChoose(ctx, hook, option)) return;
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

/** Whisper of the Oracle: "Opt N / Go again" (go again is native). */
function whisperScript(n: number): CardScript {
  return {
    onPlay: (ctx) => opt(ctx, n),
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

/** Cindering Foresight: playable as an instant on an opponent's turn; "your
 *  next arcane card +1"; Opt N. */
function cinderingScript(n: number): CardScript {
  return {
    playAsInstant: (ctx) => ctx.state.activePlayer !== ctx.seat,
    onPlay(ctx) {
      buffNextArcaneDamageCard(ctx, 1);
      opt(ctx, n);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

/** Emeritus Scolding: +2 when played during an opponent's turn (possible via
 *  Blaze, Firemind's ability). */
function emeritusScript(base: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [base],
    playAsInstant: viaBlaze,
    onPlay(ctx) {
      const boosted = ctx.state.activePlayer !== ctx.seat;
      requestHeroTarget(ctx, boosted ? base + 2 : base);
    },
    onChoose(ctx, hook, option) {
      targetOnChoose(ctx, hook, option);
    },
  };
}

/** Aether Spindle: arcane to the opposing hero, then Opt X where X is the
 *  damage dealt (resolved after any Arcane Barrier decision). */
function spindleScript(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [damage],
    playAsInstant: viaBlaze,
    onPlay: (ctx) => dealArcane(ctx, opponentSeat(ctx), damage),
    onDamageDealt(ctx, _target, amount, arcane) {
      if (arcane && amount > 0) opt(ctx, amount);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  };
}

// ── scripts ─────────────────────────────────────────────────────────────────

export const sbz: Record<string, CardScript> = {
  // Blaze, Firemind — energy counters from opting (charged in the set's opt
  // wrapper); instant ability removes X counters to make a Wizard non-attack
  // action with base arcane damage X playable as an instant this turn.
  "blaze, firemind|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      label: "Remove X energy counters: play a Wizard non-attack action as an instant",
      canActivate: (ctx) =>
        ctx.getCounter("energy") > 0 ||
        ctx.player(ctx.seat).hand.some((card) => blazeMatches(ctx, card, 0)),
      onActivate(ctx) {
        const max = ctx.getCounter("energy");
        ctx.requestChoice(
          "blaze-x",
          decisionPrompt(
            "Blaze, Firemind: remove how many energy counters?",
            "card.sbz.blaze.energy.choose",
          ),
          Array.from({ length: max + 1 }, (_, i) => String(i)),
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "blaze-x") {
        const x = Number(option);
        ctx.setCounter("energy", ctx.getCounter("energy") - x);
        const matches = ctx.player(ctx.seat).hand.filter((card) =>
          blazeMatches(ctx, card, x)
        );
        if (matches.length === 0) {
          ctx.logPublic(`Blaze, Firemind: no Wizard non-attack action dealing ${x} arcane damage in hand`);
          return;
        }
        ctx.requestCardChoice(
          "blaze-banish",
          decisionPrompt(
            `Blaze, Firemind: banish a Wizard non-attack action dealing ${x} arcane damage (playable as an instant this turn)`,
            "card.sbz.blaze.action.banish",
            { values: { amount: x } },
          ),
          matches.map((c) => c.instanceId),
        );
        return;
      }
      if (hook === "blaze-banish") {
        const id = Number(option);
        const found = ctx.player(ctx.seat).hand.find((c) => c.instanceId === id);
        if (!found || !ctx.banish(id)) return;
        ctx.allowPlayFrom(id, "banish");
        ctx.setFlag("player", `asInstant:${id}`, true);
        ctx.logPublic(
          `Blaze, Firemind: ${found ? ctx.cardData(found.cardId).name : "the chosen card"} may be played as an instant this turn`,
        );
        return;
      }
    },
  },

  // Crucible of Aetherweave — "Once per Turn Instant — {r}: next arcane +1"
  "crucible of aetherweave|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      label: "Next arcane damage card +1",
      onActivate: (ctx) => buffNextArcaneDamageCard(ctx, 1),
    },
  },

  // Talismanic Lens — "Instant — Destroy Talismanic Lens: Opt 2"
  "talismanic lens|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: Opt 2",
      onActivate(ctx) {
        ctx.destroySelf();
        opt(ctx, 2);
      },
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  },

  // Spellfire Cloak — "Instant — Destroy: Gain {r}. Only during an opponent's
  // turn." (Arcane Barrier 1 is native.)
  "spellfire cloak|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: Gain {r}",
      canActivate: (ctx) => ctx.state.activePlayer !== ctx.seat,
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.changeResources(ctx.seat, 1);
        ctx.logPublic(`${ctx.data.name}: gained {r}`);
      },
    },
  },

  // Seeker's Mitts — "Instant — {r}, destroy: prevent the next 1 damage to
  // your hero this turn. Opt 1"
  "seeker's mitts|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      label: "Destroy: prevent 1, Opt 1",
      onActivate(ctx) {
        ctx.destroySelf();
        ctx.preventNextDamage(ctx.seat, 1);
        opt(ctx, 1);
      },
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  },

  // Fyendal's Fighting Spirit — "When this attacks or defends, if you have
  // less {h} than an opposing hero, gain 1{h}."
  "fyendal's fighting spirit|1": {
    onAttackDeclared(ctx) {
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) === -1) {
        ctx.gainLife(ctx.seat, 1);
        ctx.logPublic(`${ctx.data.name}: gained 1{h}`);
      }
    },
    canTriggerOnDefend: (ctx) => ctx.compareLife(ctx.seat, opponentSeat(ctx)) === -1,
    onDefend(ctx) {
      if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) === -1) {
        ctx.gainLife(ctx.seat, 1);
        ctx.logPublic(`${ctx.data.name}: gained 1{h}`);
      }
    },
  },

  // Look Tuff — "When this attacks, it gets -1{p} unless you pay {r}."
  "look tuff|1": {
    onAttackDeclared(ctx) {
      if (!ctx.requestPayment(
        "look-tuff",
        decisionPrompt(
          "Look Tuff: pay {r} or it gets -1{p}?",
          "card.sbz.looktuff.pay",
        ),
        1,
      )) {
        ctx.addModifier({ scope: "chain-link", attack: -1 });
        ctx.logPublic(`${ctx.data.name} gets -1{p}`);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "look-tuff") return;
      if (option === "paid") {
        ctx.logPublic(`${ctx.data.name}: paid {r}`);
      } else {
        ctx.addModifier({ scope: "chain-link", attack: -1 });
        ctx.logPublic(`${ctx.data.name} gets -1{p}`);
      }
    },
  },

  // Absorb in Aether — defense reaction: "your next arcane card this turn +2"
  "absorb in aether|1": {
    onPlay: (ctx) => buffNextArcaneDamageCard(ctx, 2),
  },

  "aether spindle|1": spindleScript(4),
  "aether spindle|3": spindleScript(2),

  "cindering foresight|1": cinderingScript(3),
  "cindering foresight|2": cinderingScript(2),
  "cindering foresight|3": cinderingScript(1),

  "emeritus scolding|1": emeritusScript(4),
  "emeritus scolding|2": emeritusScript(3),
  "emeritus scolding|3": emeritusScript(2),

  // Snapback — "If you have played another Wizard 'non-attack' action card
  // this turn, you may play Snapback as though it were an instant."
  "snapback|1": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [3],
    playAsInstant: (ctx) =>
      viaBlaze(ctx) ||
      ctx.getFlag("player", "playedClassType:wizard:non-attack-action") === true,
    onPlay: (ctx) => requestHeroTarget(ctx, 3),
    onChoose(ctx, hook, option) {
      targetOnChoose(ctx, hook, option);
    },
  },

  // Turn to Mindfire — 5 arcane to any target; if it deals damage, you may
  // tap your hero to create a Ponder token.
  "turn to mindfire|1": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [5],
    playAsInstant: viaBlaze,
    onPlay: (ctx) => requestHeroTarget(ctx, 5),
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 0) return;
      ctx.requestChoice(
        "mindfire-tap",
        yesNoPrompt(
          "Turn to Mindfire: tap your hero to create a Ponder token?",
          "card.sbz.mindfire.hero.tap",
        ),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (targetOnChoose(ctx, hook, option)) return;
      if (hook !== "mindfire-tap" || option !== "yes") return;
      if (ctx.tap(ctx.player(ctx.seat).hero.instanceId)) {
        ctx.createToken(PONDER);
      }
    },
  },

  "voltic bolt|1": arcaneBolt(5),
  "voltic bolt|3": arcaneBolt(3),

  "whisper of the oracle|1": whisperScript(4),
  "whisper of the oracle|2": whisperScript(3),
  "whisper of the oracle|3": whisperScript(2),

  // Aether Quickening — Surge: go again if it deals more than 2 (the printed
  // card has no go again; the "Go again" keyword in the set data is the
  // Surge-granted one and is stripped from data/cards/SBZ.json).
  "aether quickening|3": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [2],
    playAsInstant: viaBlaze,
    onPlay: (ctx) => requestHeroTarget(ctx, 2),
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 2) return;
      ctx.gainActionPoint();
      ctx.logPublic(`${ctx.data.name}: Surge — gains go again`);
    },
    onChoose(ctx, hook, option) {
      targetOnChoose(ctx, hook, option);
    },
  },

  // Open the Flood Gates — Surge: draw 2 if it deals more than 1
  "open the flood gates|3": {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [1],
    playAsInstant: viaBlaze,
    onPlay: (ctx) => requestHeroTarget(ctx, 1),
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 1) return;
      ctx.drawCards(ctx.seat, 2);
      ctx.logPublic(`${ctx.data.name}: Surge — draw 2 cards`);
    },
    onChoose(ctx, hook, option) {
      targetOnChoose(ctx, hook, option);
    },
  },

  // Arcane Twining / Photon Splicing — "Instant — Discard this: Amp 1"
  // (engine: ActivatedAbility.fromHand; Amp feeds the nextArcaneBonus pool)
  "arcane twining|3": arcaneBolt(1, {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: "Discard: Amp 1",
      onActivate: (ctx) => ampNextArcane(ctx, 1),
    },
  }),
  "photon splicing|3": arcaneBolt(2, {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      fromHand: true,
      label: "Discard: Amp 1",
      onActivate: (ctx) => ampNextArcane(ctx, 1),
    },
  }),

  // Ponder token — "At the beginning of your end phase, destroy Ponder and
  // draw a card."
  "ponder|0": {
    triggers: [
      {
        event: "end-of-turn",
        whose: "subject",
        label: "Destroy Ponder and draw a card",
        effect(ctx) {
          ctx.destroySelf();
          ctx.drawCards(ctx.seat, 1);
        },
      },
    ],
  },
};
