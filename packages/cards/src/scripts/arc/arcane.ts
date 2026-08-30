import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextArcaneDamageCard,
  buffNextAttack,
  dealArcane,
  opponentSeat,
  optN,
  optOnChoose,
  wizardActionAsInstant,
} from "../shared-helpers.js";

const RUNECHANT = "SVI034";

function isRunechant(ctx: ScriptCtx, card: { readonly cardId: string }): boolean {
  return ctx.cardData(card.cardId).name === "Runechant";
}

function runeCount(ctx: ScriptCtx): number {
  return ctx.state.players[ctx.seat]!.board.filter((card) => isRunechant(ctx, card)).length;
}

function createRunechants(ctx: ScriptCtx, count: number): void {
  ctx.createTokens(RUNECHANT, count);
}

function runeDiscount(): CardScript {
  return {
    modifyPlayCost: (ctx, base) => Math.max(0, base - runeCount(ctx)),
  };
}

function spellbladeAssault(): CardScript {
  return { onAttackDeclared: (ctx) => createRunechants(ctx, 2) };
}

function reduceToRunechant(): CardScript {
  return {
    ...runeDiscount(),
    onPlay: (ctx) => createRunechants(ctx, 1),
  };
}

function oathOfTheArknight(attack: number): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack, appliesToClass: "runeblade" });
      createRunechants(ctx, 1);
    },
  };
}

function drawnToTheDarkDimension(): CardScript {
  return {
    ...runeDiscount(),
    onAttackDeclared: (ctx) => ctx.drawCards(ctx.seat, 1),
  };
}

function spellbladeStrike(): CardScript {
  return { onAttackDeclared: (ctx) => createRunechants(ctx, 1) };
}

function bloodspillInvocation(count: number): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.attacker === ctx.seat && ctx.link.attackCardType === "action";
    },
    onHit(ctx) {
      ctx.destroySelf();
      createRunechants(ctx, count);
    },
    onHeroDealtDamage(ctx) {
      ctx.destroySelf();
    },
  };
}

function readTheRunes(count: number): CardScript {
  return { onPlay: (ctx) => createRunechants(ctx, count) };
}

function absorbInAether(): CardScript {
  return { onPlay: (ctx) => buffNextArcaneDamageCard(ctx, 2) };
}

function stirTheAetherwinds(amount: number): CardScript {
  return {
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      ctx.setFlag("player", "nextWizardNonAttackAsInstant", true);
      ctx.setFlag("player", "nextWizardNonAttackArcaneBonus", amount);
    },
  };
}

function opposingArcaneSpell(damage: number, extra: CardScript = {}): CardScript {
  return {
    arcaneDamageEffect: true,
    playAsInstant: wizardActionAsInstant,
    prospectiveHeroDamage: (ctx) => [{
      targetSeat: opponentSeat(ctx),
      amount: damage + ctx.getCounter("arcaneBonus"),
    }],
    onPlay: (ctx) => dealArcane(ctx, opponentSeat(ctx), damage),
    ...extra,
    onChoose(ctx, hook, option) {
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function targetHeroArcaneSpell(damage: number): CardScript {
  return {
    arcaneDamageEffect: true,
    playAsInstant: wizardActionAsInstant,
    onPlay(ctx) {
      ctx.requestChoice(
        `arc-target:${damage}`,
        `${ctx.data.name}: deal ${ctx.previewArcaneDamage(damage)} arcane damage to which hero?`,
        ["opposing hero", "your hero"],
      );
    },
    onChoose(ctx, hook, option) {
      const match = /^arc-target:(\d+)$/.exec(hook);
      if (!match) return;
      dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), Number(match[1]));
    },
  };
}

function aetherFlare(damage: number): CardScript {
  return opposingArcaneSpell(damage, {
    onDamageDealt(ctx, _target, amount, arcane) {
      if (arcane && amount > 0) buffNextArcaneDamageCard(ctx, amount);
    },
  });
}

function aetherSpindle(damage: number): CardScript {
  return opposingArcaneSpell(damage, {
    onDamageDealt(ctx, _target, amount, arcane) {
      if (arcane && amount > 0) optN(ctx, amount);
    },
    onChoose(ctx, hook, option) {
      optOnChoose(ctx, hook, option);
    },
  });
}

function isWizardNonAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (
    ctx.hasCardType(card, "action") &&
    !ctx.cardTypes(card).includes("attack") &&
    ctx.cardTypes(card).includes("wizard")
  );
}

function reverberate(damage: number): CardScript {
  return opposingArcaneSpell(damage, {
    onDamageDealt(ctx, _target, amount, arcane) {
      if (!arcane || amount <= 0) return;
      const eligible = ctx.state.players[ctx.seat]!.hand.filter(
        (card) => isWizardNonAttack(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) <= amount,
      );
      if (eligible.length === 0) return;
      ctx.requestCardChoice(
        "reverberate-banish",
        `${ctx.data.name}: banish a Wizard non-attack action to play as an instant this turn?`,
        ["no", ...eligible.map((card) => card.instanceId)],
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "reverberate-banish" || option === "no") return;
      const instanceId = Number(option);
      const card = ctx.state.players[ctx.seat]!.hand.find(
        (candidate) => candidate.instanceId === instanceId,
      );
      if (!card || !isWizardNonAttack(ctx, card) || !ctx.banish(instanceId)) return;
      ctx.allowPlayFrom(instanceId, "banish");
      ctx.setFlag("player", `asInstant:${instanceId}`, true);
    },
  });
}

function requestIndexChoice(ctx: ScriptCtx, count: number): void {
  const cards = ctx.state.players[ctx.seat]!.deck.slice(0, count);
  for (const card of cards) ctx.lookAt(card.instanceId);
  if (cards.length === 0) return;
  const ids = cards.map((card) => card.instanceId);
  ctx.requestCardChoice(
    `index-top:${ids.join(",")}`,
    `${ctx.data.name}: choose a card to put on top of your deck`,
    ids,
  );
}

function requestIndexBottomOrder(ctx: ScriptCtx, ids: number[]): void {
  if (ids.length === 0) return;
  ctx.requestCardChoice(
    `index-bottom:${ids.join(",")}`,
    `${ctx.data.name}: choose the next card to put on the bottom of your deck`,
    ids,
  );
}

function indexScript(count: number): CardScript {
  return {
    playAsInstant: wizardActionAsInstant,
    onPlay: (ctx) => requestIndexChoice(ctx, count),
    onChoose(ctx, hook, option) {
      const topMatch = /^index-top:([\d,]+)$/.exec(hook);
      if (topMatch) {
        const ids = topMatch[1]!.split(",").map(Number);
        const chosen = Number(option);
        if (!ids.includes(chosen)) return;
        ctx.putOnDeckTop(chosen);
        requestIndexBottomOrder(ctx, ids.filter((id) => id !== chosen));
        return;
      }
      const bottomMatch = /^index-bottom:([\d,]+)$/.exec(hook);
      if (!bottomMatch) return;
      const ids = bottomMatch[1]!.split(",").map(Number);
      const chosen = Number(option);
      if (!ids.includes(chosen)) return;
      ctx.putOnDeckBottom(chosen);
      requestIndexBottomOrder(ctx, ids.filter((id) => id !== chosen));
    },
  };
}

export const arcArcane: Record<string, CardScript> = {
  "spellblade assault|2": spellbladeAssault(),
  "reduce to runechant|2": reduceToRunechant(),
  "reduce to runechant|3": reduceToRunechant(),
  "oath of the arknight|1": oathOfTheArknight(3),
  "oath of the arknight|2": oathOfTheArknight(2),
  "oath of the arknight|3": oathOfTheArknight(1),
  "amplify the arknight|2": runeDiscount(),
  "amplify the arknight|3": runeDiscount(),
  "drawn to the dark dimension|1": drawnToTheDarkDimension(),
  "drawn to the dark dimension|2": drawnToTheDarkDimension(),
  "drawn to the dark dimension|3": drawnToTheDarkDimension(),
  "rune flash|2": runeDiscount(),
  "rune flash|3": runeDiscount(),
  "spellblade strike|1": spellbladeStrike(),
  "spellblade strike|2": spellbladeStrike(),
  "spellblade strike|3": spellbladeStrike(),
  "bloodspill invocation|1": bloodspillInvocation(3),
  "bloodspill invocation|2": bloodspillInvocation(2),
  "bloodspill invocation|3": bloodspillInvocation(1),
  "read the runes|2": readTheRunes(2),
  "read the runes|3": readTheRunes(1),

  "robe of rapture|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      destroySelfCost: true,
      label: "Destroy: gain 3 resources",
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 3);
        ctx.logPublic(`${ctx.data.name}: gained {r}{r}{r}`);
      },
    },
  },
  "absorb in aether|2": absorbInAether(),
  "absorb in aether|3": absorbInAether(),
  "aether spindle|2": aetherSpindle(3),
  "stir the aetherwinds|1": stirTheAetherwinds(3),
  "stir the aetherwinds|2": stirTheAetherwinds(2),
  "aether flare|1": aetherFlare(3),
  "aether flare|2": aetherFlare(2),
  "aether flare|3": aetherFlare(1),
  "index|1": indexScript(5),
  "index|2": indexScript(4),
  "index|3": indexScript(3),
  "reverberate|1": reverberate(3),
  "reverberate|2": reverberate(2),
  "reverberate|3": reverberate(1),
  "scalding rain|1": targetHeroArcaneSpell(4),
  "scalding rain|2": targetHeroArcaneSpell(3),
  "scalding rain|3": targetHeroArcaneSpell(2),
  "zap|1": targetHeroArcaneSpell(3),
  "zap|2": targetHeroArcaneSpell(2),
  "zap|3": targetHeroArcaneSpell(1),
  "voltic bolt|2": targetHeroArcaneSpell(4),
};
