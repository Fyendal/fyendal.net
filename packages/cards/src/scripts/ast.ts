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

const SERENADE_MODES = [
  { id: 1, name: "Embodiment", text: "Create an Embodiment of Lightning token", message: "card.ast.option.embodiment" },
  { id: 2, name: "Search Skyzyk", text: "Search your deck for a Skyzyk", message: "card.ast.option.skyzyk" },
  { id: 3, name: "Next attack +1", text: "Your next attack this turn gets +1{p}", message: "card.ast.option.attack" },
] as const;

type SerenadeMode = (typeof SERENADE_MODES)[number];

function serenadeOption(mode: SerenadeMode): string {
  return `${mode.id}: ${mode.name}`;
}

function serenadeOptionMessages() {
  return Object.fromEntries(SERENADE_MODES.map((mode) => [serenadeOption(mode), decisionMessage(mode.message)]));
}

function serenadeModes(first: unknown, second: unknown): [SerenadeMode, SerenadeMode] | undefined {
  const a = SERENADE_MODES.find((mode) => mode.id === first);
  const b = SERENADE_MODES.find((mode) => mode.id === second);
  return a && b ? [a, b] : undefined;
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
        ctx.gainResources(ctx.seat, 1);
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
          optionMessages: serenadeOptionMessages(),
        }),
        SERENADE_MODES.map(serenadeOption),
      );
    },
    stackLabel(card) {
      const modes = serenadeModes(card.scriptState?.serenadeFirst, card.scriptState?.serenadeSecond);
      if (!modes) return undefined;
      return {
        label: `Skyward Serenade: ${modes[0].text}; ${modes[1].text}`,
        labelMessage: {
          id: "card.ast.serenade.stack",
          values: {
            card: { kind: "card", cardId: card.cardId },
            first: { kind: "term", id: modes[0].message },
            second: { kind: "term", id: modes[1].message },
          },
        },
      };
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
            optionMessages: serenadeOptionMessages(),
          }),
          SERENADE_MODES.filter((mode) => mode.id !== first).map(serenadeOption),
        );
      } else if (hook === "serenade-second") {
        ctx.setState("serenadeSecond", Number(option[0]));
        const modes = serenadeModes(ctx.getState("serenadeFirst"), ctx.getState("serenadeSecond"));
        if (modes)
          ctx.logPublic(localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.player(ctx.seat).heroCardId).name} chooses ${modes[0].name} and ${modes[1].name} for ${ctx.data.name}`,
            "card.log.ast.serenade.modes.chosen",
            {
              player: { kind: "player", seat: ctx.seat },
              first: { kind: "term", id: modes[0].message },
              second: { kind: "term", id: modes[1].message },
            },
          ));
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
