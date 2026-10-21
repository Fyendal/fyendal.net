import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  anyDamageTarget,
  buffNextAttack,
  cardNamed,
  commonOptionMessages,
  dealArcane,
  dealToAnyTarget,
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  ongoingLabel,
  opponentSeat,
} from "./shared-helpers.js";

const LIGHTNING = "AST028";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function instantCards(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).hand.filter((card) => ctx.hasCardType(card, "instant"));
}

function revealInstantEquipment(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onDefend(ctx) {
      const instants = instantCards(ctx);
      if (instants.length)
        ctx.requestCardChoice(
          "ast-reveal-instant",
          decisionPrompt(`${ctx.data.name}: reveal an instant card?`, "card.ast.instant.reveal", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
            optionMessages: commonOptionMessages("none"),
          }),
          ["none", ...instants.map((card) => card.instanceId)],
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ast-reveal-instant" || option === "none") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !ctx.hasCardType(card, "instant")) return;
      ctx.logPublic(
        localizedCardLog(
          ctx,
          `${ctx.data.name} reveals ${data(ctx, card).name}`,
          "card.log.common.card.revealed",
          { revealed: { kind: "card", cardId: card.cardId } },
          { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
        ),
      );
      effect(ctx);
    },
  };
}

function applySerenadeChoices(ctx: ScriptCtx, choices: number[]): void {
  if (choices.includes(1)) ctx.createToken(LIGHTNING);
  if (choices.includes(3)) buffNextAttack(ctx, { attack: 1 });
  if (!choices.includes(2)) return;
  const skyzyks = ctx.player(ctx.seat).deck.filter((card) => cardNamed(ctx, card, "skyzyk"));
  if (skyzyks.length)
    ctx.requestCardChoice(
      "serenade-skyzyk",
      decisionPrompt("Search your deck for a Skyzyk", "card.ast.skyzyk.search"),
      skyzyks.map((card) => card.instanceId),
    );
  else ctx.shuffleDeck();
}

export const ast: Record<string, CardScript> = {
  "aurora, shooting star|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      oncePerTurn: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedSubtype:lightning") === true,
      onActivate: (ctx) => {
        ctx.createToken(LIGHTNING);
      },
    },
  },
  "cap of quick thinking|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          discardDamagePreventionCardType: "instant",
          discardDamagePreventionAmount: 1,
          discardDamagePreventionDraw: 1,
        });
      },
    },
  },
  "shock frock|0": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      destroySelfCost: true,
      canActivate: (ctx) => ctx.getFlag("player", "playedSubtype:lightning") === true,
      onActivate(ctx) {
        ctx.changeResources(ctx.seat, 1);
      },
    },
  },
  "zap clappers|0": revealInstantEquipment((ctx) => {
    dealArcane(ctx, ctx.link?.attacker ?? opponentSeat(ctx), 1);
  }),
  "starlight striders|0": revealInstantEquipment((ctx) => {
    ctx.createToken(LIGHTNING);
  }),
  "photon rush|1": {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "playedSubtype:lightning") === true) ctx.grantGoAgain();
    },
  },
  "arc lightning|2": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel("deal 1 arcane damage to any target whenever you go again", "card.effect.ast.arclightning"),
      });
      ctx.addModifier({ scope: "next-play", grantKeyword: "go again", appliesToCardType: "action" });
    },
    triggers: [
      {
        event: "go-again-resolved",
        label: "Deal 1 arcane damage to any target",
        labelMessage: decisionMessage("card.trigger.common.arcane.anytarget", { amount: 1 }),
        target: anyDamageTarget((ctx) =>
          decisionPrompt(
            `Arc Lightning: deal ${ctx.previewArcaneDamage(1)} arcane damage to any target`,
            "card.ast.arcane.target.choose",
            { values: { amount: ctx.previewArcaneDamage(1) } },
          ),
        ),
        effect: (ctx) => dealToAnyTarget(ctx, ctx.playTargetInstanceId, 1, { arcane: true }),
      },
    ],
  },
  "skyward serenade|2": {
    additionalCost(ctx) {
      ctx.requestChoice(
        "serenade-first",
        decisionPrompt("Skyward Serenade: choose the first mode", "card.ast.serenade.mode.first", {
          optionMessages: {
            "1: Embodiment": decisionMessage("card.ast.option.embodiment"),
            "2: Search Skyzyk": decisionMessage("card.ast.option.skyzyk"),
            "3: Next attack +1": decisionMessage("card.ast.option.attack"),
          },
        }),
        ["1: Embodiment", "2: Search Skyzyk", "3: Next attack +1"],
      );
    },
    onPlay(ctx) {
      applySerenadeChoices(ctx, [ctx.getState("serenadeFirst"), ctx.getState("serenadeSecond")]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "serenade-first") {
        const first = Number(option[0]);
        ctx.setState("serenadeFirst", first);
        ctx.requestChoice(
          "serenade-second",
          decisionPrompt("Skyward Serenade: choose a different second mode", "card.ast.serenade.mode.second", {
            optionMessages: {
              "1: Embodiment": decisionMessage("card.ast.option.embodiment"),
              "2: Search Skyzyk": decisionMessage("card.ast.option.skyzyk"),
              "3: Next attack +1": decisionMessage("card.ast.option.attack"),
            },
          }),
          [1, 2, 3]
            .filter((mode) => mode !== first)
            .map((mode) => `${mode}: ${mode === 1 ? "Embodiment" : mode === 2 ? "Search Skyzyk" : "Next attack +1"}`),
        );
      } else if (hook === "serenade-second") {
        ctx.setState("serenadeSecond", Number(option[0]));
      } else if (hook === "serenade-skyzyk") {
        const id = Number(option);
        const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === id);
        if (!card || !ctx.banish(id)) return;
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.data.name} reveals ${data(ctx, card).name} and banishes it`,
            "card.log.ast.search.banished",
            { result: { kind: "card", cardId: card.cardId } },
            { kind: "card-moved", cardId: card.cardId, ownerSeat: ctx.seat, from: "deck", to: "banish" },
          ),
        );
        ctx.shuffleDeck();
        ctx.allowPlayFrom(id, "banish");
      }
    },
  },
  "skyzyk|1": {
    modifyAttack: (ctx) => (ctx.link?.goAgain === true ? 1 : 0),
  },
  "spark spray|1": {
    onFriendlyDefended(ctx) {
      ctx.requestPayment(
        "spark-spray",
        decisionPrompt("Pay 1 resource for +1 power?", "card.ast.power.pay", { values: { amount: 1 } }),
        1,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "spark-spray" && option === "paid") ctx.addModifier({ scope: "chain-link", attack: 1 });
    },
  },
  "written in the stars|3": {
    onPlay(ctx) {
      ctx.createToken(LIGHTNING);
      if (ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true) ctx.drawCards(ctx.seat, 1);
    },
  },
};
