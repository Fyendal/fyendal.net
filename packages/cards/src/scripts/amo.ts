import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  BLOODROT_POX,
  FRAILTY,
  INERTIA,
  NAMED_DISEASE_TOKENS,
  assassinContractAttackTargets,
  attackAbility,
  contractWithSilver,
  controlledDiseases,
  createChosenDisease,
  decisionPrompt,
  diseaseTokenOptionMessages,
  equipWithSilver,
  hitHookLabel,
  hitWithDaggerThisChain,
  isInfected,
  ongoingLabel,
  opponentSeat,
  requestDiseaseTokenChoice,
  targetsHero,
} from "./shared-helpers.js";

const SILVER = "DYN245";

function opposingDiseases(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return controlledDiseases(ctx, opponentSeat(ctx));
}

function defenderInfected(ctx: ScriptCtx): boolean {
  return targetsHero(ctx) && isInfected(ctx, opponentSeat(ctx));
}

function createInertiaForEachHero(ctx: ScriptCtx): void {
  for (const player of ctx.state.players) ctx.createToken(INERTIA, player.seat);
}

const mortimer: CardScript = {
  activated: [
    {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Cure a disease",
      canActivate: (ctx) => opposingDiseases(ctx).length > 0,
      onActivate(ctx) {
        ctx.requestCardChoice(
          "amo-mortimer-cure",
          decisionPrompt("Choose a disease to cure", "card.amo.mortimer.disease.choose"),
          opposingDiseases(ctx).map((card) => card.instanceId),
        );
      },
    },
    {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      tap: true,
      label: "Destroy 2 Silver: give go again",
      effectCardCosts: [
        {
          zone: "arena",
          move: "destroy",
          count: 2,
          name: "Silver",
          prompt: decisionPrompt("Destroy 2 Silver", "card.common.cost.silver.destroy.two"),
        },
      ],
      canActivate(ctx) {
        return (
          !!ctx.link && ctx.link.attacker === ctx.seat && ctx.cardTypes(ctx.link.attackingCard).includes("assassin")
        );
      },
      onActivate(ctx) {
        ctx.grantGoAgain();
      },
    },
  ],
  onChoose(ctx, hook, option) {
    if (hook !== "amo-mortimer-cure") return;
    const disease = opposingDiseases(ctx).find((card) => card.instanceId === Number(option));
    if (disease && ctx.destroyPermanent(disease.instanceId)) ctx.createToken(SILVER);
  },
};

export const amo: Record<string, CardScript> = {
  "humour plunge|0": {
    activated: attackAbility(2, {
      goAgain: true,
      oncePerTurn: false,
      tap: true,
    }),
    modifyAttack(ctx) {
      return defenderInfected(ctx) ? 1 : 0;
    },
  },

  "dr. mortimer, blight of the pits|0": mortimer,
  "dr. mortimer|0": mortimer,

  "viral diffusion|1": {
    onDefend(ctx) {
      const attackingSeat = ctx.link?.attacker;
      if (attackingSeat === undefined) return;
      ctx.createToken(FRAILTY, attackingSeat);
      ctx.createToken(INERTIA, attackingSeat);
      ctx.createToken(BLOODROT_POX, attackingSeat);
    },
  },

  "plague mask|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          prohibitsTokenCreationOfType: "disease",
          ...ongoingLabel("disease tokens can't be created under your control", "card.effect.amo.plaguemask"),
        });
      },
    },
  },

  "isolation vestment|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          playCostReduction: 1,
          appliesTo: "attack-action",
          appliesToClass: "assassin",
          appliesToTargetControllingType: "disease",
          ...ongoingLabel(
            "Assassin attack action cards that target an infected hero cost 1 less to play",
            "card.effect.amo.isolationvestment",
          ),
        });
      },
    },
  },

  "surgical gloves|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: false,
      effectCardCosts: [
        {
          zone: "arena",
          opponentControlled: true,
          move: "destroy",
          count: 1,
          types: ["disease"],
          prompt: decisionPrompt("Choose a disease to cure", "card.amo.mortimer.disease.choose"),
        },
      ],
      targetCardOptions(ctx) {
        const link = ctx.link;
        return link && link.attacker !== ctx.seat && link.flags.attackGone !== true
          ? [link.attackingCard.instanceId]
          : [];
      },
      onActivate(ctx) {
        const attacker = ctx.link?.attacker;
        if (ctx.playTargetInstanceId !== undefined && attacker !== undefined) {
          ctx.addModifier({
            scope: "chain-link",
            attack: -1,
            seat: attacker,
            appliesToInstanceId: ctx.playTargetInstanceId,
          });
        }
        ctx.destroyAtEndPhase(ctx.self.instanceId);
      },
    },
  },

  "second salvos|0": {
    triggers: [equipWithSilver(2)],
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.untap(ctx.player(ctx.seat).hero.instanceId);
      },
    },
  },

  "escaped subject|1": {
    hasConditionalGoAgain: defenderInfected,
  },

  "eviscerate the enervated|1": {
    ...contractWithSilver((ctx, card) => card.owner === opponentSeat(ctx) && isInfected(ctx, card.owner)),
    canTriggerOnHit: targetsHero,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  },

  "sneaking rot|1": {
    canTriggerOnHit: (ctx) => targetsHero(ctx) && ctx.link?.flags[`reactionBySeat:${ctx.seat}`] === true,
    onHit(ctx) {
      ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
    },
  },

  "wound extraction|1": {
    canTriggerOnHit: (ctx) => targetsHero(ctx) && hitWithDaggerThisChain(ctx),
    onHit(ctx) {
      requestDiseaseTokenChoice(ctx, "amo-wound-extraction");
    },
    onChoose(ctx, hook, option) {
      if (hook === "amo-wound-extraction") createChosenDisease(ctx, option);
    },
  },

  "act on intel: whereabouts|1": {
    playTargetOptions: assassinContractAttackTargets,
    onPlay(ctx) {
      if (ctx.playTargetInstanceId === undefined) return;
      ctx.addModifier({
        scope: "chain-link",
        attack: 1,
        appliesTo: "attack-action",
        appliesToInstanceId: ctx.playTargetInstanceId,
        onHitScriptHook: {
          hook: "amo-act-on-intel-hit",
          ...hitHookLabel("the hit hero banishes a card from their hand", "card.effect.amo.actonintel"),
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "amo-act-on-intel-hit") return;
      const defender = opponentSeat(ctx);
      const hand = ctx.player(defender).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "amo-act-on-intel-banish",
          decisionPrompt("Banish a card from your hand", "card.hnt.hand.card.banish"),
          hand.map((card) => card.instanceId),
          defender,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "amo-act-on-intel-banish") ctx.banish(Number(option));
    },
  },

  "pick your poison|2": {
    onPlay(ctx) {
      ctx.requestChoice(
        "amo-pick-your-poison",
        decisionPrompt(
          "Choose a disease token. The other two are created under your control",
          "card.amo.pickyourpoison.choose",
          { optionMessages: diseaseTokenOptionMessages(NAMED_DISEASE_TOKENS) },
        ),
        [...NAMED_DISEASE_TOKENS],
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "amo-pick-your-poison") return;
      for (const tokenId of NAMED_DISEASE_TOKENS) {
        if (tokenId !== option) ctx.createToken(tokenId, opponentSeat(ctx));
      }
    },
  },

  "languid pace|3": {
    onAttackDeclared: createInertiaForEachHero,
    onDefend: createInertiaForEachHero,
  },

  "viral sampling|3": {
    canTriggerOnHit: defenderInfected,
    onHit(ctx) {
      ctx.completeContract();
      ctx.createToken(SILVER);
    },
  },
};
