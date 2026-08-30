import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { attackAbility, bloodDebtScript as bloodDebt, buffNextAttack, opponentSeat, queueIntimidate } from "../shared-helpers.js";

const COURAGE = "DTD232";
const EARTH = "ELE109";
const ELOQUENCE = "DTD233";
const LIGHTNING = "ELE110";
const PONDER = "DYN244";
const QUICKEN = "DTD234";
const RUNECHANT = "DTD214";
const SEISMIC = "DTD204";
const SPELLBANE = "DTD235";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) { return ctx.cardData(card.cardId); }
function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string) {
  return ctx.cardTypes(card).some((candidate) => candidate.toLowerCase() === type.toLowerCase());
}
function named(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string) {
  return ctx.cardNames(card).some((candidate) => candidate.toLowerCase() === name.toLowerCase());
}
function requestWidespreadBanish(ctx: ScriptCtx, zone: "hand" | "arsenal", startSeat = 0): void {
  for (let seat = startSeat; seat < ctx.state.players.length; seat++) {
    const player = ctx.player(seat);
    if (player.flags.lostLifeThisTurn !== true || player[zone].length === 0) continue;
    ctx.requestCardChoice(
      `widespread-${zone}:${seat}`,
      `Choose a card from your ${zone} to banish`,
      player[zone].map((card) => card.instanceId),
      seat,
    );
    return;
  }
}
function widespreadBanish(zone: "hand" | "arsenal"): CardScript {
  return {
    runeGate: true,
    ...bloodDebt({
      onCombatChainClosed(ctx) {
        requestWidespreadBanish(ctx, zone);
      },
      onChoose(ctx, hook, option) {
        const match = new RegExp(`^widespread-${zone}:(\\d+)$`).exec(hook);
        if (!match) return;
        const seat = Number(match[1]);
        const instanceId = Number(option);
        ctx.setCardFaceDown(instanceId, false);
        ctx.banish(instanceId);
        requestWidespreadBanish(ctx, zone, seat + 1);
      },
    }),
  };
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function defendsTogetherWithCardFromHand(ctx: ScriptCtx): boolean {
  if (!ctx.link) return false;
  const handDefenders = Number(ctx.link.flags.defendedFromHandCount ?? 0);
  const selfWasFromHand = ctx.link.flags[`defendedFromHand:${ctx.self.instanceId}`] === true ? 1 : 0;
  return handDefenders > selfWasFromHand;
}
function soulChoice(ctx: ScriptCtx, hook: string, prompt: string) {
  const soul = ctx.player(ctx.seat).soul;
  if (soul.length) ctx.requestCardChoice(hook, prompt, ["no", ...soul.map((card) => card.instanceId)]);
}
function angel(effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    activated: attackAbility(2),
    onAttackDeclared(ctx) {
      if (ctx.link?.attackingCard.instanceId === ctx.self.instanceId) soulChoice(ctx, "angel-soul", "Banish a soul card for this angel's ability?");
    },
    onChoose(ctx, hook, option) {
      if (hook === "angel-soul" && option !== "no" && ctx.banish(Number(option))) effect(ctx);
    },
  };
}
function figment(effect: (ctx: ScriptCtx) => void): CardScript { return { onEnterArena: effect }; }
function awakenFigment(ctx: ScriptCtx) {
  const choices = ctx.player(ctx.seat).board.filter((card) => has(ctx, card, "figment") && data(ctx, card).backId);
  if (choices.length) ctx.requestCardChoice("prism-awaken", "Choose a Figment to awaken", choices.map((card) => card.instanceId));
}
function prismAdult(): CardScript {
  return {
    onCardPutIntoSoul(ctx, card) {
      if (ctx.state.phase !== "action" || !data(ctx, card).name.toLowerCase().includes("herald")) return;
      const figments = ctx.player(ctx.seat).deck.filter((candidate) => has(ctx, candidate, "figment"));
      if (figments.length) ctx.requestCardChoice("prism-figment", "Search for a Figment?", ["no", ...figments.map((card) => card.instanceId)]);
    },
    activated: {
      cost: 2, banishSoulCost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true,
      label: "Awaken a Figment", canActivate: (ctx) => ctx.player(ctx.seat).board.some((card) => has(ctx, card, "figment") && !!data(ctx, card).backId),
      onActivate: awakenFigment,
    },
    onChoose(ctx, hook, option) {
      if (hook === "prism-figment") {
        if (option !== "no") ctx.settleCard(Number(option));
        ctx.shuffleDeck();
      }
      if (hook === "prism-awaken") {
        const card = ctx.player(ctx.seat).board.find((candidate) => candidate.instanceId === Number(option));
        const back = card ? data(ctx, card).backId : undefined;
        if (card && back) ctx.transformInto(back, [], card.instanceId);
      }
    },
  };
}
function solflareToken(cardId: string): CardScript { return { onCharged: (ctx) => { ctx.createToken(cardId); } }; }
function topYellowToSoul(): CardScript {
  return {
    triggers: [{
      event: "card-pitched",
      sourceZone: "pitch",
      label: "Reveal the top card",
      condition: (ctx, pitched) => pitched?.instanceId === ctx.self.instanceId,
      effect(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top) return;
      ctx.revealCards([top.instanceId]);
      if (ctx.cardColor(top) === 2) ctx.requestChoice("light-sol", "Put the revealed yellow card into your soul?", ["yes", "no"]);
      },
    }],
    onChoose(ctx, hook, option) {
      const top = ctx.player(ctx.seat).deck[0];
      if (hook === "light-sol" && option === "yes" && top && ctx.cardColor(top) === 2) ctx.putIntoSoul(top.instanceId);
    },
  };
}
function replaceActionPhaseDraw(ctx: ScriptCtx, drawingSeat: number, count: number): number | undefined {
  if (ctx.state.phase !== "action" || count <= 0) return count;
  const drawing = ctx.player(drawingSeat);
  for (let i = 0; i < count; i++) {
    const top = drawing.deck[0];
    if (!top || !ctx.banish(top.instanceId)) continue;
    ctx.allowPlayFrom(top.instanceId, "banish", { forSeat: drawingSeat });
  }
  return 0;
}
function requestSkullChoice(ctx: ScriptCtx): void {
  const chosen = [ctx.getCounter("skull-1"), ctx.getCounter("skull-2")].filter(Boolean);
  const chosenNames = new Set(chosen.flatMap((id) => {
    const card = ctx.player(ctx.seat).banish.find((candidate) => candidate.instanceId === id);
    return card ? ctx.cardNames(card).map((name) => name.toLowerCase()) : [];
  }));
  const actions = ctx.player(ctx.seat).banish.filter((card) =>
    !card.faceDown &&
    ctx.hasCardType(card, "action") &&
    !ctx.cardNames(card).some((name) => chosenNames.has(name.toLowerCase())),
  );
  if (actions.length) ctx.requestCardChoice("spoiled-skull", "Choose a differently named banished action", actions.map((card) => card.instanceId));
}
export const dtdHighRarity: Record<string, CardScript> = {
  "light of sol|2": topYellowToSoul(),
  "prism, awakener of sol|0": prismAdult(),
  "empyrean rapture|0": {
    activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: true, label: "Gain ward 1", onActivate(ctx) { ctx.grantCardKeyword(ctx.self.instanceId, "ward 1"); } },
    onCardPutIntoSoul(ctx, card) {
      if (ctx.state.phase === "action" && data(ctx, card).name.toLowerCase().includes("herald")) {
        ctx.setPlayerFlag(ctx.seat, "empyreanHeroDiscount", true);
      }
    },
    modifyActivatedAbilityCost(ctx, source, base) {
      return source.instanceId === ctx.player(ctx.seat).hero.instanceId && ctx.getPlayerFlag(ctx.seat, "empyreanHeroDiscount") === true
        ? Math.max(0, base - 2)
        : base;
    },
    modifyAttackActivationCost(ctx, attacker, base) {
      return attacker.instanceId === ctx.player(ctx.seat).hero.instanceId && ctx.getPlayerFlag(ctx.seat, "empyreanHeroDiscount") === true
        ? Math.max(0, base - 2)
        : base;
    },
    onFriendlyActivate(ctx, activated) {
      if (activated.instanceId === ctx.player(ctx.seat).hero.instanceId) ctx.setPlayerFlag(ctx.seat, "empyreanHeroDiscount", false);
    },
  },
  "figment of erudition|2": figment((ctx) => { ctx.createToken(PONDER); }),
  "suraya, archangel of erudition|0": angel((ctx) => ctx.drawCards(ctx.seat, 2)),
  "figment of judgment|2": figment((ctx) => {
    const cards = ctx.state.players.flatMap((player) => player.banish).filter((card) => !card.faceDown);
    if (cards.length) ctx.requestCardChoice("figment-down", "Turn a banished card face down?", ["no", ...cards.map((card) => card.instanceId)]);
  }),
  "themis, archangel of judgment|0": angel((ctx) => {
    const cards = ctx.state.players.flatMap((player) => player.banish).filter((card) => !card.faceDown);
    if (cards.length) ctx.requestCardChoice("angel-down", "Turn a banished card face down", cards.map((card) => card.instanceId));
  }),
  "figment of ravages|2": figment((ctx) => ctx.dealDamage(opponentSeat(ctx), 1, { arcane: true })),
  "sekem, archangel of ravages|0": angel((ctx) => ctx.dealDamage(opponentSeat(ctx), 2, { arcane: true })),
  "figment of rebirth|2": figment((ctx) => {
    const cards = ctx.player(ctx.seat).graveyard.filter((card) => ctx.hasCardType(card, "action") && ctx.cardColor(card) === 2);
    if (cards.length) ctx.requestCardChoice("figment-top", "Put a yellow action on top", cards.map((card) => card.instanceId));
  }),
  "avalon, archangel of rebirth|0": angel((ctx) => {
    const cards = ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardColor(card) === 2);
    if (cards.length) ctx.requestCardChoice("angel-top", "Put a yellow card on top", cards.map((card) => card.instanceId));
  }),
  "figment of tenacity|2": figment((ctx) => buffNextAttack(ctx, { dominate: true })),
  "metis, archangel of tenacity|0": angel((ctx) => ctx.addModifier({ scope: "until-end-of-turn", dominate: true, appliesTo: "attack" })),
  "figment of triumph|2": figment((ctx) => ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), attack: -1, appliesTo: "attack-action" })),
  "victoria, archangel of triumph|0": angel((ctx) => ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), attack: -1, appliesTo: "attack-action", expiresAtStartOfSeatTurn: opponentSeat(ctx) })),
  "figment of war|2": figment((ctx) => { ctx.createToken(COURAGE); }),
  "bellona, archangel of war|0": angel((ctx) => {
    for (const card of ctx.player(ctx.seat).board.filter((candidate) => has(ctx, candidate, "angel"))) ctx.addCounter(card.instanceId, "power", 1);
  }),
  "soulbond resolve|0": {
    onDefend(ctx) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("soulbond", "Charge a card?", ["no", ...hand.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) { if (hook === "soulbond" && option !== "no" && ctx.charge(Number(option))) ctx.preventNextDamage(ctx.seat, 1); },
  },
  "banneret of courage|2": solflareToken(COURAGE),
  "banneret of gallantry|2": solflareToken(QUICKEN),
  "banneret of protection|2": solflareToken(SPELLBANE),
  "beckoning light|1": {
    additionalCost(ctx) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("beckon-charge", "Charge a card?", ["no", ...hand.map((card) => card.instanceId)]); },
    onChoose(ctx, hook, option) {
      if (hook === "beckon-charge" && option !== "no") {
        const charged = ctx.charge(Number(option));
        if (charged && ctx.cardColor(charged) === 2) ctx.addModifier({ scope: "combat-chain" });
      } else if (hook === "beckon-top") ctx.putOnDeckTop(Number(option));
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.attackCardType === "action" && ctx.state.modifiers.some((modifier) =>
        modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "combat-chain"
      );
    },
    onHit(ctx) {
      const attacks = ctx.player(ctx.seat).graveyard.filter((card) => isAttack(ctx, card));
      if (attacks.length) ctx.requestCardChoice("beckon-top", "Put an attack action on top of your deck?", ["no", ...attacks.map((card) => card.instanceId)]);
    },
  },
  "spirit of war|1": { additionalCost(ctx) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("spirit-charge", "Charge a card?", ["no", ...hand.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "spirit-charge" && option !== "no" && ctx.charge(Number(option))) ctx.addModifier({ scope: "combat-chain", onHitCreateToken: { cardId: COURAGE, count: 1 }, appliesTo: "attack-action" }); } },
  "prayer of bellona|2": {
    onPlay(ctx) { buffNextAttack(ctx, { attack: 2 }); const top = ctx.player(ctx.seat).deck[0]; if (top) { ctx.revealCards([top.instanceId]); if (ctx.cardColor(top) === 2 && ctx.moveToHand(top.instanceId)) { const hand = ctx.player(ctx.seat).hand; if (hand.length) ctx.requestCardChoice("prayer-charge", "Charge your hero's soul", hand.map((card) => card.instanceId)); } } },
    onChoose(ctx, hook, option) { if (hook === "prayer-charge") ctx.charge(Number(option)); },
  },
  "united we stand|2": { canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(COURAGE); }, onChoose() {} },
  "lumina lance|2": {
    additionalCost(ctx) { const soul = ctx.player(ctx.seat).soul; if (soul.length) ctx.requestCardChoice("lance-soul", "Banish up to 3 cards from soul", ["done", ...soul.map((card) => card.instanceId)]); },
    onPlay(ctx) {
      if (ctx.getCounter("lance-mode:power") > 0) ctx.addModifier({ scope: "chain-link", attack: 2, appliesToSubtype: "light" });
      if (ctx.getCounter("lance-mode:draw") > 0) ctx.addModifier({ scope: "chain-link", onHitDraw: 1, appliesToSubtype: "light" });
      if (ctx.getCounter("lance-mode:go-again") > 0) ctx.addModifier({ scope: "chain-link", onHitGoAgain: true, appliesToSubtype: "light" });
    },
    onChoose(ctx, hook, option) {
      if (hook === "lance-soul") {
        if (option !== "done" && ctx.banish(Number(option))) {
          const count = ctx.getCounter("lance-count") + 1; ctx.setCounter("lance-count", count);
          const soul = ctx.player(ctx.seat).soul;
          if (count < 3 && soul.length) {
            ctx.requestCardChoice("lance-soul", "Banish another soul card?", ["done", ...soul.map((card) => card.instanceId)]);
            return;
          }
        }
        if (ctx.getCounter("lance-count") > 0) ctx.requestChoice("lance-mode", "Choose a Lumina Lance mode", ["power", "draw", "go-again"]);
      } else if (hook === "lance-mode") {
        ctx.setCounter(`lance-mode:${option}`, 1);
        const used = ctx.getCounter("lance-modes") + 1; ctx.setCounter("lance-modes", used);
        if (used < ctx.getCounter("lance-count")) ctx.requestChoice("lance-mode", "Choose another Lumina Lance mode", ["power", "draw", "go-again"].filter((mode) => ctx.getCounter(`lance-mode:${mode}`) <= 0));
      }
    },
  },
  "radiant forcefield|2": { banishSoulToPreventDamage: 1 },
  "spoiled skull|0": bloodDebt({
    activated: { cost: 1, isAttack: false, goAgain: true, timing: "action", banishSelfCost: true, label: "Banish: choose 3 actions, play one at random", onActivate: requestSkullChoice },
    onChoose(ctx, hook, option) {
      if (hook !== "spoiled-skull") return;
      if (!ctx.getCounter("skull-1")) { ctx.setCounter("skull-1", Number(option)); requestSkullChoice(ctx); return; }
      if (!ctx.getCounter("skull-2")) { ctx.setCounter("skull-2", Number(option)); requestSkullChoice(ctx); return; }
      const choices = [ctx.getCounter("skull-1"), ctx.getCounter("skull-2"), Number(option)];
      ctx.allowPlayFrom(choices[ctx.randomInt(choices.length)]!, "banish");
    },
  }),
  "diabolic offering|3": bloodDebt({ modifyAttack: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true ? 6 - (data(ctx, ctx.self).attack ?? 0) : 0, modifyDefense: (ctx) => ctx.getFlag("player", "banishedSixPlusThisTurn") === true ? 6 - (data(ctx, ctx.self).defense ?? 0) : -(data(ctx, ctx.self).defense ?? 0) }),
  "shaden death hydra|2": bloodDebt({ onAttackDeclared(ctx) { const count = ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && data(ctx, card).text.includes("Blood Debt")).length; ctx.dealDamage(ctx.seat, Math.max(0, 13 - count)); } }),
  "slithering shadowpede|1": bloodDebt({ onCardBanished(ctx, card, from) { if (card.instanceId === ctx.self.instanceId && from === "hand") ctx.allowPlayFrom(card.instanceId, "banish"); } }),
  "expendable limbs|3": { additionalCost(ctx) { const hand = ctx.player(ctx.seat).hand; const card = hand[ctx.randomInt(hand.length)]; if (card && ctx.banish(card.instanceId) && ctx.basePower(card) >= 6) ctx.allowPlayFrom(card.instanceId, "banish", { untilEndOfNextTurn: true }); }, triggers: [] },
  "blood dripping frenzy|3": { additionalCost(ctx) { let sixes = 0; let bloodDebtCards = 0; for (const card of [...ctx.player(ctx.seat).hand]) { if (ctx.basePower(card) >= 6) sixes++; if (data(ctx, card).text.includes("Blood Debt")) bloodDebtCards++; ctx.banish(card.instanceId); } ctx.drawCards(ctx.seat, bloodDebtCards); ctx.addModifier({ scope: "until-end-of-turn", attack: sixes, appliesToType: ["brute", "shadow"] }); } },
  "vynnset, iron maiden|0": {
    triggers: [
      { event: "start-of-turn", whose: "subject", label: "Banish a card and create a Runechant", condition: (ctx) => ctx.player(ctx.seat).hand.length > 0, effect(ctx) { ctx.requestCardChoice("vynnset-adult", "Banish a card", ctx.player(ctx.seat).hand.map((card) => card.instanceId)); } },
      { event: "card-played", label: "Pay 1 life to make the next Runechant unpreventable?", condition: (ctx, card) => !!card && ctx.hasCardType(card, "action") && !has(ctx, card, "attack") && has(ctx, card, "shadow") && ctx.player(ctx.seat).life > 1, effect(ctx) { ctx.requestChoice("vynnset-life", "Pay 1 life to make the next Runechant unpreventable?", ["yes", "no"]); } },
    ],
    onChoose(ctx, hook, option) { if (hook === "vynnset-adult" && ctx.banish(Number(option))) ctx.createToken(RUNECHANT); if (hook === "vynnset-life" && option === "yes") { ctx.loseLife(ctx.seat, 1); ctx.setPlayerFlag(ctx.seat, "nextRunechantUnpreventable", true); } },
  },
  "grimoire of the haunt|0": bloodDebt({ activated: { cost: 1, isAttack: false, goAgain: false, timing: "instant", banishSelfCost: true, label: "Create Eloquence", onActivate(ctx) { ctx.createToken(ELOQUENCE); } } }),
  "widespread annihilation|3": widespreadBanish("hand"),
  "widespread destruction|2": widespreadBanish("arsenal"),
  "widespread ruin|1": { runeGate: true, ...bloodDebt({ onCombatChainClosed(ctx) { for (const player of ctx.state.players) if (player.flags.lostLifeThisTurn && player.deck[0]) ctx.banish(player.deck[0].instanceId); } }) },
  "funeral moon|1": bloodDebt({ staticPlayableFrom: ["banish"], playAsInstant: (ctx) => ctx.state.players.some((player) => player.flags.lostLifeThisTurn === true), onPlay(ctx) { ctx.createToken(RUNECHANT); } }),
  "requiem for the damned|1": bloodDebt({ staticPlayableFrom: ["banish"], playAsInstant: (ctx) => ctx.state.players.some((player) => player.flags.lostLifeThisTurn === true), onPlay(ctx) { ctx.createToken(ELOQUENCE); } }),
  "oblivion|3": { canPlay: (ctx) => ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "runechant")).length === 6, onPlay(ctx) { ctx.createToken("DTD216"); } },

  "blasmophet, levia consumed|0": { allowsFriendlyCardPlayFrom: (_ctx, card, zone) => zone === "banish" && !card.faceDown && data(_ctx, card).text.includes("Blood Debt"), onCardBanished(ctx, card) { ctx.setCardFaceDown(card.instanceId, true); } },
  "levia, redeemed|0": { onGameStart(ctx) { ctx.setPlayerFlag(ctx.seat, "leviaRedeemedInInventory", true); }, activated: { cost: 0, isAttack: false, goAgain: false, timing: "action", label: "Transform into Levia, Redeemed", canActivate: (ctx) => ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && data(ctx, card).text.includes("Blood Debt")).length >= 13, onActivate(ctx) { for (const card of ctx.player(ctx.seat).banish) ctx.setCardFaceDown(card.instanceId, true); ctx.becomeHero("DTD164B"); } } },
  "dabble in darkness|1": bloodDebt({ onAttackDeclared(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && ctx.banish(top.instanceId)) ctx.addModifier({ scope: "chain-link", attack: -ctx.cardColor(top) }); } }),
  "chains of mephetis|3": bloodDebt({ staticPlayableFrom: ["banish"], onEnterArena(ctx) { ctx.setCounter("doom", 1); }, replaceFriendlyDraw(ctx, count) { return replaceActionPhaseDraw(ctx, ctx.seat, count); }, replaceOpponentDraw: replaceActionPhaseDraw, triggers: [{ event: "start-of-turn", whose: "subject", label: "Remove doom or destroy", effect(ctx) { if (ctx.getCounter("doom") > 0) ctx.addCounter(ctx.self.instanceId, "doom", -1); else ctx.destroySelf(); } }] }),
  "dimenxxional vortex|0": bloodDebt({ staticPlayableFrom: ["banish"], modifyPlayCost: (ctx, base) => ctx.player(ctx.seat).banish.some((card) => card.instanceId === ctx.self.instanceId) ? Math.max(0, base - 2) : base, onPlay(ctx) { for (const player of ctx.state.players) if (player.arsenal[0]) ctx.banish(player.arsenal[0].instanceId); } }),
  "anthem of spring|3": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1, appliesTo: "attack-action" }); }, canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(EARTH); } },
  "northern winds|3": { onPlay(ctx) { for (const player of ctx.state.players) for (const card of [...Object.values(player.equipment), ...player.board].filter((c): c is DeepReadonly<CardInstance> => !!c).slice(0, 3)) ctx.setCardCounter(card.instanceId, "frozenUntilTurn", ctx.state.turn + 1); }, canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(SPELLBANE); } },
  "call down the lightning|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", onHitDealDamage: 1, appliesTo: "attack" }); }, canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(LIGHTNING); } },
  "scowling flesh bag|0": { onDefend: queueIntimidate },
  "numbskull|1": { unmodifiableCharacteristics: ["cost", "power", "defense"] },
  "dig up dinner|3": { onPlay(ctx) { const pool = [...ctx.player(ctx.seat).graveyard]; const chosen: DeepReadonly<CardInstance>[] = []; while (pool.length && chosen.length < 3) chosen.push(pool.splice(ctx.randomInt(pool.length), 1)[0]!); const attacks = chosen.filter((card) => isAttack(ctx, card) && ctx.basePower(card) >= 6); for (const card of attacks) ctx.putOnDeckBottom(card.instanceId); ctx.shuffleDeck(); ctx.gainLife(ctx.seat, attacks.length); ctx.banish(ctx.self.instanceId); } },
  "star struck|2": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && (ctx.link?.damage ?? 0) >= 4; }, onHit(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), minBasePower: ctx.link!.damage + 1, restrictCardPlaysToType: "attack", expiresAtEndOfSeatTurn: opponentSeat(ctx) }); }, canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(SEISMIC); } },
  "bastion of unity|0": { canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 1); } },
  "ironsong versus|0": { activated: { cost: 1, isAttack: false, goAgain: true, oncePerTurn: true, label: "Next sword hit creates Courage", onActivate(ctx) { buffNextAttack(ctx, { appliesTo: "sword", onHitCreateToken: { cardId: COURAGE, count: 1 } }); } } },
  "chorus of ironsong|2": { onPlay(ctx) { const dawnblade = ctx.link?.attackingCard; if (dawnblade && named(ctx, dawnblade, "dawnblade")) ctx.addModifier({ scope: "until-end-of-turn", attack: 1, damageUnpreventable: true, appliesToInstanceId: dawnblade.instanceId }); }, canTriggerOnDefend: defendsTogetherWithCardFromHand, onDefend(ctx) { ctx.createToken(COURAGE); } },
  "morlock hill|3": { onPlay(ctx) { ctx.setPlayerFlag(ctx.seat, "morlockLethalReplacement", true); }, onChoose(ctx, hook, option) { if (hook === "morlock-minerva" && option !== "no") ctx.banish(Number(option)); } },
  "bequest the vast beyond|1": { onPlay(ctx) { buffNextAttack(ctx, { attackCostReduction: ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "runechant")).length, appliesToType: ["runeblade"] }); } },
  "runic reckoning|1": { modifyPlayCost(ctx, base) { return Math.max(0, base - ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "runechant")).length); }, onPlay(ctx) { buffNextAttack(ctx, { attack: 3, appliesToType: ["runeblade"] }); } },
  "alluring inducement|2": {
    onAttackDeclared(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      const revealedIds = hand.map((card) => card.instanceId);
      if (!ctx.revealCards(revealedIds, opponentSeat(ctx))) return;
      const attacks = hand.filter((card) => isAttack(ctx, card));
      ctx.requestCardChoice(
        "inducement",
        attacks.length ? "Choose a revealed attack" : "No revealed attacks can be chosen",
        attacks.length ? ["no", ...attacks.map((card) => card.instanceId)] : ["Close"],
        undefined,
        revealedIds,
      );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "inducement" || option === "no" || option === "Close") return;
      const chosen = ctx.player(opponentSeat(ctx)).hand.find(
        (card) => card.instanceId === Number(option),
      );
      if (chosen) ctx.becomeCardCopy(ctx.self.instanceId, chosen.cardId);
    },
    canTriggerOnDefend: defendsTogetherWithCardFromHand,
    onDefend(ctx) { ctx.createToken(ELOQUENCE); },
  },
  "diadem of dreamstate|0": { onFriendlyDestroyed(ctx, card) { if (ctx.getPlayerFlag(ctx.seat, "diademTriggered") === true || data(ctx, card).cardType === "token" || !data(ctx, card).text.toLowerCase().includes("ward")) return; ctx.setPlayerFlag(ctx.seat, "diademTriggered", true); if (ctx.player(ctx.seat).resources > 0) ctx.requestPayment("diadem", "Pay 1 to create Ponder?", 1); }, onChoose(ctx, hook, option) { if (hook === "diadem" && option === "paid") ctx.createToken(PONDER); } },
  "lost in thought|1": { onPlay(ctx) { const hand = ctx.player(opponentSeat(ctx)).hand; for (const card of hand) ctx.lookAt(card.instanceId); const attacks = hand.filter((card) => isAttack(ctx, card)); if (attacks.length) ctx.requestCardChoice("lost-thought", "Choose an attack to bottom", attacks.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "lost-thought" && ctx.revealCards([Number(option)], opponentSeat(ctx)) && ctx.putOnDeckBottom(Number(option))) ctx.createToken(PONDER, opponentSeat(ctx)); } },
  "censor|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { ctx.requestNameChoice("censor-name", "Name a card", ctx.seat); }, onChoose(ctx, hook, option) { if (hook === "censor-name") ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), prohibitsName: option.toLowerCase(), expiresAtEndOfSeatTurn: opponentSeat(ctx) }); } },
  "mischievous meeps|1": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined; }, onHit(ctx) { const items = ctx.player(opponentSeat(ctx)).board.filter((card) => has(ctx, card, "item") && (data(ctx, card).cost ?? 0) <= 2); if (items.length) ctx.requestCardChoice("meeps", "Steal an item", items.map((card) => card.instanceId)); else ctx.drawCards(ctx.seat, 1); }, onChoose(ctx, hook, option) { if (hook === "meeps" && !ctx.steal(Number(option), { duration: "indefinite" })) ctx.drawCards(ctx.seat, 1); } },
  "hold the line|3": { onPlay(ctx) { if (Number(ctx.getPlayerFlag(opponentSeat(ctx), "cardsDrawnThisTurn")) >= 2) ctx.preventNextDamage(ctx.seat, 3); } },
  "hack to reality|2": { onPlay(ctx) { buffNextAttack(ctx, { attack: 2 }); ctx.addModifier({ scope: "until-end-of-turn" }); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.state.modifiers.some((modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link"); }, onHit(ctx) { const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => has(ctx, card, "aura") && data(ctx, card).cardType !== "token" && (data(ctx, card).cost ?? 0) <= (ctx.link?.damage ?? 0)); if (auras.length) ctx.requestCardChoice("hack-aura", "Destroy a non-token aura", auras.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "hack-aura") ctx.destroyPermanent(Number(option)); } },
  "warmonger's diplomacy|3": {
    additionalCostToOpponents: 0,
    onPlay(ctx) {
      ctx.requestChoice("diplomacy-opponent", "Choose war or peace", ["war", "peace"], opponentSeat(ctx));
    },
    onChoose(ctx, hook, option) {
      const target = hook === "diplomacy-opponent"
        ? opponentSeat(ctx)
        : hook === "diplomacy-self"
          ? ctx.seat
          : undefined;
      if (target === undefined) return;
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: target,
        ...(option === "war"
          ? { restrictActionsToWeaponOrAttack: true }
          : { restrictActionsToNonWeaponNonAttack: true }),
        ongoingLabel: option === "war" ? "War" : "Peace",
        expiresAtEndOfSeatTurn: target,
      });
      if (hook === "diplomacy-opponent") {
        ctx.requestChoice("diplomacy-self", "Choose war or peace", ["war", "peace"]);
      }
    },
  },
  "poison the well|3": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn" }); }, replaceHeroLifeGain(ctx, gainingSeat, amount) { if (amount <= 0 || ctx.getCounter("used") > 0) return amount; ctx.setCounter("used", 1); ctx.loseLife(gainingSeat, amount); return 0; }, onHeroGainedLife() {} },
};

for (const script of [dtdHighRarity["figment of judgment|2"], dtdHighRarity["themis, archangel of judgment|0"]]) {
  const previous = script!.onChoose;
  script!.onChoose = (ctx, hook, option) => {
    if ((hook === "figment-down" || hook === "angel-down") && option !== "no") ctx.setCardFaceDown(Number(option), true);
    else previous?.(ctx, hook, option);
  };
}
for (const script of [dtdHighRarity["figment of rebirth|2"], dtdHighRarity["avalon, archangel of rebirth|0"]]) {
  const previous = script!.onChoose;
  script!.onChoose = (ctx, hook, option) => {
    if (hook === "figment-top" || hook === "angel-top") ctx.putOnDeckTop(Number(option));
    else previous?.(ctx, hook, option);
  };
}
