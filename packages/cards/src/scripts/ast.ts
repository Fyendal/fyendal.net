import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, commonOptionMessages, dealArcane, decisionMessage, decisionPrompt, localizedCardLog, opponentSeat } from "./shared-helpers.js";

const LIGHTNING = "AST028";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function instantCards(ctx: ScriptCtx): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).hand.filter((card) => ctx.hasCardType(card, "instant"));
}

function revealInstantEquipment(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onDefend(ctx) {
      const instants = instantCards(ctx);
      if (instants.length) ctx.requestCardChoice("ast-reveal-instant", decisionPrompt(`${ctx.data.name}: reveal an instant card?`, "card.ast.instant.reveal", { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("none") }), ["none", ...instants.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "ast-reveal-instant" || option === "none") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card || !ctx.hasCardType(card, "instant")) return;
      ctx.logPublic(localizedCardLog(
        ctx,
        `${ctx.data.name} reveals ${data(ctx, card).name}`,
        "card.log.common.card.revealed",
        { revealed: { kind: "card", cardId: card.cardId } },
        { kind: "cards-revealed", cards: [{ cardId: card.cardId, ownerSeat: ctx.seat }], sourceZone: "hand" },
      ));
      effect(ctx);
    },
  };
}

function requestAnyTarget(ctx: ScriptCtx, hook: string, prompt: string): void {
  const options = ["opposing hero", "your hero"];
  const cardOptions: (number | null)[] = [null, null];
  for (const player of ctx.state.players) {
    for (const card of player.board) {
      if (!hasType(ctx, card, "ally")) continue;
      options.push(`ally:${player.seat}:${card.instanceId}`);
      cardOptions.push(card.instanceId);
    }
  }
  ctx.requestChoice(hook, decisionPrompt(prompt, "card.ast.arcane.target.choose", {
    values: { amount: ctx.previewArcaneDamage(1) },
    optionMessages: commonOptionMessages("opposing hero", "your hero"),
  }), options, ctx.seat, cardOptions);
}

function dealToChoice(ctx: ScriptCtx, option: string): void {
  const ally = /^ally:(\d+):(\d+)$/.exec(option);
  if (ally) dealArcane(ctx, Number(ally[1]), 1, Number(ally[2]));
  else dealArcane(ctx, option === "your hero" ? ctx.seat : opponentSeat(ctx), 1);
}

function applySerenadeChoices(ctx: ScriptCtx, choices: number[]): void {
  if (choices.includes(1)) ctx.createToken(LIGHTNING);
  if (choices.includes(3)) buffNextAttack(ctx, { attack: 1 });
  if (!choices.includes(2)) return;
  const skyzyks = ctx.player(ctx.seat).deck.filter((card) => data(ctx, card).name.toLowerCase() === "skyzyk");
  if (skyzyks.length) ctx.requestCardChoice("serenade-skyzyk", decisionPrompt("Search your deck for a Skyzyk", "card.ast.skyzyk.search"), skyzyks.map((card) => card.instanceId));
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
      onActivate: (ctx) => { ctx.createToken(LIGHTNING); },
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
      onActivate(ctx) { ctx.changeResources(ctx.seat, 1); },
    },
  },
  "zap clappers|0": revealInstantEquipment((ctx) => { dealArcane(ctx, ctx.link?.attacker ?? opponentSeat(ctx), 1); }),
  "starlight striders|0": revealInstantEquipment((ctx) => { ctx.createToken(LIGHTNING); }),
  "photon rush|1": {
    onAttackDeclared(ctx) {
      if (ctx.getFlag("player", "playedSubtype:lightning") === true) ctx.grantGoAgain();
    },
  },
  "arc lightning|2": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn" });
      ctx.addModifier({ scope: "next-attack", goAgain: true });
      ctx.setFlag("player", "nextActionCardGoAgain", true);
    },
    onFriendlyPlay(ctx, played) {
      if (!ctx.hasCardType(played, "action") || hasType(ctx, played, "attack")) return;
      const marker = ctx.state.modifiers.find((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "next-attack" && !modifier.consumed,
      );
      if (marker) ctx.consumeModifier(marker.id);
    },
    onGainGoAgain(ctx) { requestAnyTarget(ctx, "arc-lightning-target", `Arc Lightning: deal ${ctx.previewArcaneDamage(1)} arcane damage to any target`); },
    onChoose(ctx, hook, option) { if (hook === "arc-lightning-target") dealToChoice(ctx, option); },
  },
  "skyward serenade|2": {
    additionalCost(ctx) { ctx.requestChoice("serenade-first", decisionPrompt("Skyward Serenade: choose the first mode", "card.ast.serenade.mode.first", { optionMessages: {
      "1: Embodiment": decisionMessage("card.ast.option.embodiment"),
      "2: Search Skyzyk": decisionMessage("card.ast.option.skyzyk"),
      "3: Next attack +1": decisionMessage("card.ast.option.attack"),
    } }), ["1: Embodiment", "2: Search Skyzyk", "3: Next attack +1"]); },
    onPlay(ctx) { applySerenadeChoices(ctx, [ctx.getCounter("serenadeFirst"), ctx.getCounter("serenadeSecond")]); },
    onChoose(ctx, hook, option) {
      if (hook === "serenade-first") {
        const first = Number(option[0]);
        ctx.setCounter("serenadeFirst", first);
        ctx.requestChoice("serenade-second", decisionPrompt("Skyward Serenade: choose a different second mode", "card.ast.serenade.mode.second", { optionMessages: {
          "1: Embodiment": decisionMessage("card.ast.option.embodiment"),
          "2: Search Skyzyk": decisionMessage("card.ast.option.skyzyk"),
          "3: Next attack +1": decisionMessage("card.ast.option.attack"),
        } }), [1, 2, 3].filter((mode) => mode !== first).map((mode) => `${mode}: ${mode === 1 ? "Embodiment" : mode === 2 ? "Search Skyzyk" : "Next attack +1"}`));
      } else if (hook === "serenade-second") {
        ctx.setCounter("serenadeSecond", Number(option[0]));
      } else if (hook === "serenade-skyzyk") {
        const id = Number(option);
        const card = ctx.player(ctx.seat).deck.find((candidate) => candidate.instanceId === id);
        if (!card || !ctx.banish(id)) return;
        ctx.logPublic(localizedCardLog(
          ctx,
          `${ctx.data.name} reveals ${data(ctx, card).name} and banishes it`,
          "card.log.ast.search.banished",
          { result: { kind: "card", cardId: card.cardId } },
          { kind: "card-moved", cardId: card.cardId, ownerSeat: ctx.seat, from: "deck", to: "banish" },
        ));
        ctx.shuffleDeck();
        ctx.allowPlayFrom(id, "banish");
      }
    },
  },
  "skyzyk|1": {
    modifyAttack: (ctx) => ctx.link?.goAgain === true ? 1 : 0,
  },
  "spark spray|1": {
    onFriendlyDefended(ctx) { ctx.requestPayment("spark-spray", decisionPrompt("Pay 1 resource for +1 power?", "card.ast.power.pay", { values: { amount: 1 } }), 1); },
    onChoose(ctx, hook, option) { if (hook === "spark-spray" && option === "paid") ctx.addModifier({ scope: "chain-link", attack: 1 }); },
  },
  "written in the stars|3": {
    onPlay(ctx) {
      ctx.createToken(LIGHTNING);
      if (ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true) ctx.drawCards(ctx.seat, 1);
    },
  },
};
