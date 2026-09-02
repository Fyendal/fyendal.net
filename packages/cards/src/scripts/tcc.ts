import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  decisionMessage,
  decisionPrompt,
  opponentSeat,
  payForDefenseBoost,
  previousAttackHasName,
} from "./shared-helpers.js";

const COPPER = "TCC103";
const CROUCHING_TIGER = "TCC104";
const MIGHT = "TCC105";
const QUICKEN = "TCC106";
const VIGOR = "TCC107";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type);
}

function equippedEvos(ctx: ScriptCtx): number {
  return ctx.countEquipped("evo");
}

function guardianAura(power: number, reduction = 0): CardScript {
  return {
    triggers: [{
      event: "start-of-turn",
      whose: "subject",
      label: `Destroy this — next Guardian attack gets +${power}{p}`,
      effect(ctx) {
        ctx.destroySelf();
        buffNextAttack(ctx, {
          attack: power,
          ...(reduction > 0 ? { attackCostReduction: reduction } : {}),
          appliesTo: "attack-action",
          appliesToClass: "guardian",
        });
      },
    }],
  };
}

function boulderDrop(): CardScript {
  return {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "boulder-drop-top",
          decisionPrompt(`${ctx.data.name}: put a card from your hand on top of your deck`, "card.tcc.boulder.hand.top", { values: { card: { kind: "card", cardId: ctx.self.cardId } } }),
          hand.map((card) => card.instanceId),
          target,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "boulder-drop-top") ctx.putOnDeckTop(Number(option));
    },
  };
}

function civicGift(kind: "draw" | "might" | "quicken" | "vigor"): CardScript {
  return {
    onDefend(ctx) {
      const target = opponentSeat(ctx);
      if (kind === "draw") ctx.drawCards(target, 1);
      else ctx.createToken(kind === "might" ? MIGHT : kind === "quicken" ? QUICKEN : VIGOR, target);
    },
  };
}

function destroyForEveryone(kind: "draw" | "might" | "quicken" | "vigor"): CardScript {
  return {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      destroySelfCost: true,
      label: `Destroy: each hero ${kind === "draw" ? "draws" : `creates ${kind}`}`,
      onActivate(ctx) {
        for (const player of ctx.state.players) {
          if (kind === "draw") ctx.drawCards(player.seat, 1);
          else ctx.createToken(kind === "might" ? MIGHT : kind === "quicken" ? QUICKEN : VIGOR, player.seat);
        }
      },
    },
  };
}

function interlude(amount: number): CardScript {
  return {
    onPlay(ctx) {
      ctx.requestChoice(
        "interlude-target",
        decisionPrompt(`${ctx.data.name}: choose a hero to prevent the next ${amount} damage to`, "card.tcc.interlude.hero.choose", { values: { card: { kind: "card", cardId: ctx.self.cardId }, amount }, optionMessages: { you: decisionMessage("common.option.self"), opponent: decisionMessage("common.option.opponent") } }),
        ["you", "opponent"],
      );
    },
    onPreventsDamage(ctx, prevented) {
      if (prevented > 0 && ctx.getCounter("interlude-target") !== ctx.seat) ctx.createToken(COPPER);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "interlude-target") return;
      const target = option === "you" ? ctx.seat : opponentSeat(ctx);
      ctx.setCounter("interlude-target", target);
      ctx.preventNextDamage(target, amount);
    },
  };
}

function song(effect: (ctx: ScriptCtx, target: number) => void): CardScript {
  return { onPlay(ctx) { effect(ctx, opponentSeat(ctx)); } };
}

function tigerEyeReflex(): CardScript {
  return {
    onDefend(ctx) {
      const tiger = ctx.createToken(CROUCHING_TIGER);
      if (!tiger) return;
      ctx.banish(tiger.instanceId);
      ctx.allowPlayFrom(tiger.instanceId, "banish", { untilEndOfNextTurn: true });
    },
  };
}

export const tcc: Record<string, CardScript> = {
  "professor teklovossen|0": {
    allowsFriendlyCardPlayFrom: (ctx, card, zone) => zone === "banish" && hasType(ctx, card, "evo"),
    modifyFriendlyCardPlayCost(ctx, card, _zone, base) {
      return hasType(ctx, card, "evo") ? Math.max(0, base - (ctx.state.players.length - 1)) : base;
    },
  },
  "teklo blaster|0": { activated: attackAbility(3) },
  "apocalypse automaton|1": { canPlay: (ctx) => equippedEvos(ctx) > 0 },

  // Protect only changes multiplayer defender eligibility. In the engine's
  // supported two-hero games there is no third hero to protect; ordinary
  // self-defense remains native for these cards.
  "brevant, civic protector|0": {},
  "hammer of havenhold|0": {
    activated: attackAbility(3),
    onAttackDeclared(ctx) {
      if (ctx.player(ctx.seat).pitch.some((card) => data(ctx, card).name === "Chivalry")) {
        ctx.addModifier({ scope: "chain-link", attack: 1 });
      }
    },
  },
  "civic peak|0": civicGift("draw"),
  "civic duty|0": civicGift("vigor"),
  "civic guide|0": civicGift("might"),
  "civic steps|0": civicGift("quicken"),
  "crash down|2": guardianAura(5),
  "earthlore empowerment|1": guardianAura(5, 1),
  "earthlore empowerment|2": guardianAura(4, 1),
  "boulder drop|2": boulderDrop(),
  "crowd control|1": payForDefenseBoost(3, 1),
  "crowd control|2": payForDefenseBoost(3, 1),
  "crowd control|3": payForDefenseBoost(3, 1),

  "melody, sing-along|0": {
    triggers: [{
      event: "card-played",
      label: "Create Copper tokens",
      condition: (ctx, played) => !!played && hasType(ctx, played, "song"),
      effect: (ctx) => ctx.createTokens(COPPER, ctx.state.players.length - 1),
    }],
  },
  "jinglewood, smash hit|0": {
    activated: [
      {
        cost: 3,
        isAttack: false,
        goAgain: true,
        oncePerTurn: true,
        label: "An opponent chooses a token; create Copper",
        onActivate(ctx) {
          ctx.requestChoice(
            "jinglewood-token",
            decisionPrompt("Jinglewood: choose a token to create", "card.tcc.jinglewood.token.choose"),
            ["Might", "Quicken", "Vigor"],
            opponentSeat(ctx),
          );
        },
      },
      {
        ...attackAbility(0, { oncePerTurn: false })[0]!,
        label: "Attack (destroy on hit)",
      },
    ],
    canTriggerOnHit(ctx) {
      return ctx.link?.attackingCard.instanceId === ctx.self.instanceId;
    },
    onHit(ctx) {
      ctx.destroySelf();
    },
    onChoose(ctx, hook, option) {
      if (hook !== "jinglewood-token") return;
      const token = option === "Might" ? MIGHT : option === "Quicken" ? QUICKEN : VIGOR;
      ctx.createToken(token, opponentSeat(ctx));
      ctx.createToken(COPPER);
    },
  },
  "nom de plume|0": destroyForEveryone("draw"),
  "heart-throb|0": destroyForEveryone("vigor"),
  "fiddle-dee|0": destroyForEveryone("might"),
  "quickstep|0": destroyForEveryone("quicken"),
  "final act|1": {
    onAttackDeclared(ctx) {
      const bonus = 2 * ctx.state.players.reduce((sum, player) => sum + player.pitch.length, 0);
      if (bonus > 0) ctx.addModifier({ scope: "chain-link", attack: bonus });
    },
  },
  "encore|2": {
    onPlay(ctx) {
      const cards = ctx.player(ctx.seat).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") &&
          hasType(ctx, card, "attack") &&
          hasType(ctx, card, "bard");
      });
      if (cards.length) {
        ctx.requestCardChoice("encore", decisionPrompt("Encore: return a Bard attack action to your hand", "card.tcc.encore.attack.return"), cards.map((card) => card.instanceId));
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "encore") ctx.moveToHand(Number(option));
    },
  },
  "interlude|1": interlude(3),
  "interlude|2": interlude(2),
  "interlude|3": interlude(1),
  "song of jack-be-quick|3": song((ctx, target) => { ctx.createToken(QUICKEN, target); }),
  "song of sweet nectar|3": song((ctx, target) => { ctx.gainLife(target, 1); }),
  "song of the rosen matador|3": song((ctx, target) => { ctx.createToken(VIGOR, target); }),
  "song of the shining knight|3": song((ctx, target) => { ctx.createToken(MIGHT, target); }),
  "song of the wandering mind|3": song((ctx, target) => { ctx.drawCards(target, 1); }),
  "mask of three tails|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      label: "Destroy: draw a card",
      canActivate: (ctx) => ctx.hitsThisCombatChain(ctx.seat) >= 3,
      onActivate(ctx) { ctx.drawCards(ctx.seat, 1); },
    },
  },
  "growl|1": {
    onAttackDeclared(ctx) {
      buffNextAttack(ctx, { attack: 1, appliesToName: "crouching tiger", expiresOnChainClose: true });
    },
  },
  "growl|2": {
    onAttackDeclared(ctx) {
      buffNextAttack(ctx, { attack: 1, appliesToName: "crouching tiger", expiresOnChainClose: true });
    },
  },
  "mauling qi|1": {
    canTriggerOnHit(ctx) {
      return previousAttackHasName(ctx, "crouching tiger");
    },
    onHit(ctx) {
      ctx.dealDamage(opponentSeat(ctx), 1);
    },
  },
  "tiger eye reflex|2": tigerEyeReflex(),
  "tiger eye reflex|3": tigerEyeReflex(),

  // Choice completion for Song of Yesteryears is shared by all TCC scripts;
  // the pending choice routes back to the song's own functional script.
  "song of yesteryears|3": {
    ...song((ctx, target) => {
      const attacks = ctx.player(target).graveyard.filter((card) => {
        return ctx.hasCardType(card, "action") && hasType(ctx, card, "attack");
      });
      if (attacks.length) ctx.requestCardChoice("yesteryears", decisionPrompt("Put an attack action on the bottom of your deck", "card.tcc.attack.bottom"), attacks.map((card) => card.instanceId), target);
    }),
    onChoose(ctx, hook, option) {
      if (hook === "yesteryears") ctx.putOnDeckBottom(Number(option));
    },
  },
};
