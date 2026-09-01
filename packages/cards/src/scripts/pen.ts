import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  buffNextAttack,
  bloodDebtScript as bloodDebt,
  contractWithSilver,
  dealArcane,
  isSixPlus,
  mergeSetScripts,
  opponentSeat,
  optN,
  optOnChoose,
  queueIntimidate,
  requestDiscardChoice,
  resolveDiscardChoice,
} from "./shared-helpers.js";
import { penHighRarity } from "./pen/high-rarity.js";

// Compendium of Rathe (PEN) — complete set and required tokens.

const AGILITY = "SBL034";
const BLOODROT = "SAZ034";
const COURAGE = "DTD232";
const EARTH = "DTD194";
const FANG_STRIKE = "MST023";
const FRAILTY = "SAZ035";
const FROSTBITE = "EVR197";
const GOLD = "DYN243";
const HYPER_DRIVER = "ARC036";
const INERTIA = "SAZ036";
const LIGHTNING = "DTD195";
const MIGHT = "SKA035";
const PONDER = "DYN244";
const RUNECHANT = "ROS162";
const SEISMIC_SURGE = "CRU044";
const SIGIL_OF_FATE = "PEN120";
const SLITHER = "MST024";
const SPELLBANE_AEGIS = "DTD235";
const SPECTRAL_SHIELD = "DTD220";
const VIGOR = "SBR036";

// CR 9.4 delegates Living Legend status to the official resource. Keep the
// names here so newly imported printings become available automatically.
// Snapshot: official Classic Constructed list, 2026-01-20.
const LIVING_LEGEND_HERO_NAMES = [
  "Aurora, Shooting Star",
  "Azalea, Ace in the Hole",
  "Bravo, Star of the Show",
  "Briar, Warden of Thorns",
  "Chane, Bound by Shadow",
  "Dash, Inventor Extraordinaire",
  "Dromai, Ash Artist",
  "Enigma, Ledger of Ancestry",
  "Florian, Rotwood Harbinger",
  "Iyslander, Stormbind",
  "Kano, Dracai of Aether",
  "Lexi, Livewire",
  "Nuu, Alluring Desire",
  "Oldhim, Grandfather of Eternity",
  "Prism, Sculptor of Arc Light",
  "Viserai, Rune Blood",
  "Zen, Tamer of Purpose",
] as const;

type Card = DeepReadonly<CardInstance>;

function data(ctx: ScriptCtx, card: Card | string) {
  return ctx.cardData(typeof card === "string" ? card : card.cardId);
}

function hasTag(ctx: ScriptCtx, card: Card | string, tag: string): boolean {
  const wanted = tag.toLowerCase();
  if (typeof card !== "string") return ctx.cardTypes(card).includes(wanted);
  const d = data(ctx, card);
  return [...(d.classes ?? []), ...(d.subtypes ?? [])].some(
    (value) => value.toLowerCase() === wanted,
  );
}

function named(ctx: ScriptCtx, card: Card | string, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return typeof card === "string"
    ? data(ctx, card).name.trim().toLowerCase() === wanted
    : ctx.cardNames(card).includes(wanted);
}

function requestDeepRecessesBanish(ctx: ScriptCtx, startSeat = 0): void {
  for (let seat = startSeat; seat < ctx.state.players.length; seat++) {
    const player = ctx.player(seat);
    if (player.flags.lostLifeThisTurn !== true || player.graveyard.length === 0) continue;
    ctx.requestCardChoice(
      `deep-recesses-graveyard:${seat}`,
      `Choose a card from hero ${seat + 1}'s graveyard to banish`,
      player.graveyard.map((card) => card.instanceId),
    );
    return;
  }
}

function hasKeyword(ctx: ScriptCtx, card: Card, keyword: string): boolean {
  const wanted = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).some((entry) => entry.toLowerCase() === wanted)) return false;
  return [...(data(ctx, card).keywords ?? []), ...(card.grantedKeywords ?? [])]
    .some((entry) => entry.toLowerCase() === wanted);
}

function pitches(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries([1, 2, 3].map((pitch) => [`${name}|${pitch}`, factory(pitch as 1 | 2 | 3)]));
}

function controls(ctx: ScriptCtx, name: string): boolean {
  return [...ctx.player(ctx.seat).board, ...ctx.player(ctx.seat).weapons,
    ...Object.values(ctx.player(ctx.seat).equipment).filter((card): card is Card => card !== undefined)]
    .some((card) => named(ctx, card, name));
}

function controlledType(ctx: ScriptCtx, tag: string): Card[] {
  return [...ctx.player(ctx.seat).board, ...ctx.player(ctx.seat).weapons,
    ...Object.values(ctx.player(ctx.seat).equipment).filter((card): card is Card => card !== undefined)]
    .filter((card) => hasTag(ctx, card, tag));
}

function allPermanents(ctx: ScriptCtx): Card[] {
  return ctx.state.players.flatMap((player) => [
    ...player.board,
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is Card => card !== undefined),
  ]);
}

function heroesAndAllies(ctx: ScriptCtx): Card[] {
  return ctx.state.players.flatMap((player) => [
    player.hero,
    ...player.board.filter((card) => hasTag(ctx, card, "ally")),
  ]);
}

function create(ctx: ScriptCtx, cardId: string, count = 1, seat = ctx.seat): void {
  ctx.createTokens(cardId, count, seat);
}

function lowerLife(ctx: ScriptCtx): boolean {
  return ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0;
}

function higherLife(ctx: ScriptCtx): boolean {
  return ctx.compareLife(ctx.seat, opponentSeat(ctx)) > 0;
}

function arcaneSpell(amount: number, createSigil = false): CardScript {
  return {
    arcaneDamageEffect: true,
    onPlay(ctx) {
      ctx.requestChoice("pen-arcane", `${ctx.data.name}: deal ${ctx.previewArcaneDamage(amount)} arcane damage to which hero?`, ["opponent", "you"]);
    },
    onDamageDealt(ctx, _target, dealt, arcane) {
      if (createSigil && arcane && dealt > 0) create(ctx, SIGIL_OF_FATE);
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-arcane") dealArcane(ctx, option === "you" ? ctx.seat : opponentSeat(ctx), amount);
    },
  };
}

function bond(tag: "earth" | "ice" | "lightning", effect: (ctx: ScriptCtx) => void): CardScript {
  return {
    onPlayCostPaid(ctx, paid) {
      if (paid.some((card) => hasTag(ctx, card, tag))) ctx.setCounter("bonded", 1);
    },
    onPlay(ctx) {
      if (ctx.getCounter("bonded") > 0) effect(ctx);
    },
  };
}

function nextAttack(amount: number, extra: Partial<Parameters<typeof buffNextAttack>[1]> = {}): CardScript {
  return { onPlay(ctx) { buffNextAttack(ctx, { attack: amount, ...extra }); } };
}

function unityEquipment(): CardScript {
  return {
    canTriggerOnDefend(ctx) {
      if (!ctx.link) return false;
      const count = Number(ctx.link.flags.defendedFromHandCount ?? 0);
      const selfWasFromHand = ctx.link.flags[`defendedFromHand:${ctx.self.instanceId}`] === true ? 1 : 0;
      return count > selfWasFromHand;
    },
    onDefend(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 1); },
  };
}

function discardAllyAttack(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const allies = ctx.player(ctx.seat).hand.filter((card) => hasTag(ctx, card, "ally"));
      if (allies.length) ctx.requestCardChoice("pen-discard-ally", `${ctx.data.name}: discard an ally?`, ["no", ...allies.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-discard-ally" || option === "no" || !ctx.discardCard(ctx.seat, Number(option))) return;
      ctx.addModifier({ scope: "chain-link", attack: 1 });
      ctx.grantGoAgain();
    },
  };
}

function auraFromGraveArcane(): CardScript {
  return {
    arcaneDamageEffect: true,
    onAttackDeclared(ctx) {
      const auras = ctx.player(ctx.seat).graveyard.filter((card) => hasTag(ctx, card, "aura"));
      if (auras.length) ctx.requestCardChoice("pen-banish-aura", `${ctx.data.name}: banish an aura for ${ctx.previewArcaneDamage(1)} arcane damage?`, ["no", ...auras.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-banish-aura" || option === "no" || !ctx.banish(Number(option))) return;
      dealArcane(ctx, opponentSeat(ctx), 1);
    },
  };
}

function contractColor(color: 1 | 2 | 3, repeat = false): CardScript {
  return {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === color),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const first = ctx.player(target).deck[0];
      if (!first) return;
      const matches = ctx.cardColor(first) === color;
      ctx.banish(first.instanceId);
      if (repeat && matches) {
        const second = ctx.player(target).deck[0];
        if (second) ctx.banish(second.instanceId);
      }
    },
  };
}

function leaveToken(cardId: string): CardScript {
  return { onDestroyed(ctx) { create(ctx, cardId); } };
}

function createSigils(count: number): CardScript {
  return { onPlay(ctx) { create(ctx, SIGIL_OF_FATE, count); } };
}

function gravenEquipment(slot: "head" | "chest" | "arms" | "legs"): CardScript {
  return {
    onGameStart(ctx) { ctx.addCardDefenseCounters(ctx.self.instanceId, 1); },
    triggers: [{
      event: "start-of-turn",
      sourceZone: "graveyard",
      optional: true,
      label: "Destroy 2 Silver to equip this",
      condition(ctx) {
        return !ctx.player(ctx.seat).equipment[slot] &&
          ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Silver")).length >= 2;
      },
      effect(ctx) {
        const silver = ctx.player(ctx.seat).board
          .filter((card) => named(ctx, card, "Silver"))
          .slice(0, 2);
        if (
          silver.length === 2 &&
          ctx.destroyPermanent(silver[0]!.instanceId) &&
          ctx.destroyPermanent(silver[1]!.instanceId)
        ) {
          ctx.equipFromGraveyard(ctx.self.instanceId);
        }
      },
    }],
  };
}

function evoBeta(slot: "head" | "chest" | "arms" | "legs"): CardScript {
  return {
    playableEquipment: true,
    canPlay(ctx) { return !!ctx.player(ctx.seat).equipment[slot] && hasTag(ctx, ctx.player(ctx.seat).equipment[slot]!, "base"); },
    playAsInstant(ctx) { return ctx.getPlayerFlag(ctx.seat, "nextEvoAsInstant") === true; },
    modifyFriendlyCardPlayCost(ctx, card, _zone, base) {
      return hasTag(ctx, card, "evo") && hasTag(ctx, card, slot) ? Math.max(0, base - 1) : base;
    },
  };
}

function decompose(payoff: (ctx: ScriptCtx) => void): CardScript {
  return {
    onPlay(ctx) {
      const grave = ctx.player(ctx.seat).graveyard;
      const firstEarth = grave.filter((first) => hasTag(ctx, first, "earth") &&
        grave.some((second) => second.instanceId !== first.instanceId && hasTag(ctx, second, "earth") &&
          grave.some((action) => action.instanceId !== first.instanceId &&
            action.instanceId !== second.instanceId && ctx.hasCardType(action, "action"))));
      if (firstEarth.length) ctx.requestCardChoice("pen-decompose-earth-1", `${ctx.data.name}: decompose? Choose the first Earth card`, ["no", ...firstEarth.map((card) => card.instanceId)]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-decompose-earth-1") {
        if (option === "no") return;
        const first = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
        if (!first || !hasTag(ctx, first, "earth")) return;
        ctx.setCounter("decomposeEarth1", first.instanceId);
        const secondEarth = ctx.player(ctx.seat).graveyard.filter((second) =>
          second.instanceId !== first.instanceId && hasTag(ctx, second, "earth") &&
          ctx.player(ctx.seat).graveyard.some((action) => action.instanceId !== first.instanceId &&
            action.instanceId !== second.instanceId && ctx.hasCardType(action, "action")));
        ctx.requestCardChoice("pen-decompose-earth-2", "Choose the second Earth card", secondEarth.map((card) => card.instanceId));
      } else if (hook === "pen-decompose-earth-2") {
        const firstId = ctx.getCounter("decomposeEarth1");
        const second = ctx.player(ctx.seat).graveyard.find((card) => card.instanceId === Number(option));
        if (!second || second.instanceId === firstId || !hasTag(ctx, second, "earth")) return;
        ctx.setCounter("decomposeEarth2", second.instanceId);
        const actions = ctx.player(ctx.seat).graveyard.filter((card) =>
          card.instanceId !== firstId && card.instanceId !== second.instanceId && ctx.hasCardType(card, "action"));
        ctx.requestCardChoice("pen-decompose-action", "Choose the action card", actions.map((card) => card.instanceId));
      } else if (hook === "pen-decompose-action") {
        const ids = [ctx.getCounter("decomposeEarth1"), ctx.getCounter("decomposeEarth2"), Number(option)];
        const grave = ctx.player(ctx.seat).graveyard;
        const chosen = ids.map((id) => grave.find((card) => card.instanceId === id));
        if (new Set(ids).size !== 3 || !chosen.every(Boolean) ||
          !hasTag(ctx, chosen[0]!, "earth") || !hasTag(ctx, chosen[1]!, "earth") ||
          !ctx.hasCardType(chosen[2]!, "action") || !ids.every((id) => ctx.banish(id))) return;
        payoff(ctx);
      }
    },
  };
}

function oathOfOak(count: number): CardScript {
  return { onPlay(ctx) { create(ctx, EARTH, count); } };
}

function putOnIce(count: number): CardScript {
  return {
    onPlay(ctx) {
      const allies = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "ally"));
      if (allies.length) ctx.requestCardChoice("pen-freeze-ally", `Freeze an ally (${count} maximum; repeat as desired)`, ["done", ...allies.map((card) => card.instanceId)]);
      if (ctx.fromArsenal) ctx.drawCards(ctx.seat, 1);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-freeze-ally" || option === "done" || ctx.getCounter("frozen") >= count) return;
      ctx.setCardCounter(Number(option), "frozenUntilTurn", ctx.state.turn + 2);
      ctx.setCounter("frozen", ctx.getCounter("frozen") + 1);
      const remaining = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "ally") && Number(card.counters?.frozenUntilTurn ?? 0) <= ctx.state.turn);
      if (remaining.length && ctx.getCounter("frozen") < count) ctx.requestCardChoice("pen-freeze-ally", "Freeze another ally?", ["done", ...remaining.map((card) => card.instanceId)]);
    },
  };
}

function phoenixBannerman(token: string): CardScript {
  return {
    onPlay(ctx) {
      const flame = ctx.player(ctx.seat).deck.find((card) => named(ctx, card, "Phoenix Flame"));
      if (flame) ctx.moveToHand(flame.instanceId);
      ctx.shuffleDeck();
      create(ctx, token);
    },
  };
}

function createdThisTurn(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "createdThisTurn")) > 0;
}

function chooseTokenToDestroy(ctx: ScriptCtx, hook: string, name: string): void {
  const choices = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, name));
  if (choices.length) ctx.requestCardChoice(hook, `${ctx.data.name}: destroy a ${name}?`, ["no", ...choices.map((card) => card.instanceId)]);
}

function elixir(tokenName: string): CardScript {
  return {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 3 });
      chooseTokenToDestroy(ctx, "pen-elixir", tokenName);
    },
    onChoose(ctx, hook, option) {
      if (hook === "pen-elixir" && option !== "no" && ctx.destroyPermanent(Number(option))) ctx.gainLife(ctx.seat, 1);
    },
  };
}

export const pen: Record<string, CardScript> = mergeSetScripts("PEN", penHighRarity, {
  "buzzard helm|0": {
    onDefend(ctx) {
      ctx.drawCards(ctx.seat, 1);
      if (isSixPlus(ctx, ctx.discardRandom(ctx.seat, 1)[0])) ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  },
  "skera strapping|0": { spellvoidValue: (ctx) => ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) ? 3 : 0 },
  "rip off the top|2": {
    onPlay(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand;
      const pitched = hand[ctx.randomInt(hand.length)];
      if (pitched && ctx.pitchCard(pitched.instanceId) && isSixPlus(ctx, pitched)) buffNextAttack(ctx, { attack: 3 });
    },
  },
  ...pitches("aggressive pounce", () => ({ onAttackDeclared(ctx) { if (ctx.getFlag("player", "intimidatedThisTurn") === true) ctx.grantGoAgain(); } })),
  "bear hug|1": { canPlay: (ctx) => ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) },
  "bear hug|2": { canPlay: (ctx) => ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card)) },

  "volcanic vice|0": { spellvoidValue: (ctx) => ctx.getFlag("player", "createdName:seismic surge") === true ? 3 : 0 },
  "valahai riven|2": {
    defendCost: 3,
    onDefend(ctx) { ctx.requestXPayment("pen-valahai", "Pay up to 3 resources for Seismic Surge tokens", ctx.seat, 3); },
    onChoose(ctx, hook, option) { if (hook === "pen-valahai" && option.startsWith("x:")) create(ctx, SEISMIC_SURGE, Number(option.slice(2))); },
  },
  ...pitches("distant rumbling", (pitch) => ({
    onEnterArena(ctx) {
      ctx.drawCards(ctx.seat, 1);
      const hand = ctx.player(ctx.seat).hand;
      if (hand.length) ctx.requestCardChoice("pen-rumbling-hand", "Put a card from hand fifth from the top", hand.map((card) => card.instanceId));
    },
    triggers: [{ event: "start-of-turn", label: "Destroy this and create Seismic Surges", effect(ctx) { ctx.destroySelf(); create(ctx, SEISMIC_SURGE, 4 - pitch); } }],
    onChoose(ctx, hook, option) { if (hook === "pen-rumbling-hand") ctx.putOnDeckAtDepth(Number(option), 5); },
  })),
  ...pitches("rites of earthlore", (pitch) => ({
    onEnterArena(ctx) { create(ctx, SEISMIC_SURGE); },
    triggers: [{ event: "start-of-turn", label: "Destroy this and empower the next Guardian attack", effect(ctx) { ctx.destroySelf(); buffNextAttack(ctx, { attack: 4 - pitch, appliesToClass: "guardian" }); } }],
  })),

  "dyed silk sleeves|0": {
    activated: {
      cost: 1, isAttack: false, goAgain: false, timing: "attack-reaction", tap: true,
      canActivate: (ctx) => !!ctx.link && hasTag(ctx, ctx.link.attackingCard, "ninja") && ctx.player(ctx.seat).weapons.some((card) => hasTag(ctx, card, "dagger") && card.instanceId !== ctx.link?.attackingCard.instanceId),
      effectCardCosts: [{ zone: "arena", move: "destroy", count: 1, subtype: "dagger", prompt: "Destroy an off-chain dagger" }],
      onActivate(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.setCounter("armed", 1); },
    },
    onMiss(ctx) { if (ctx.getCounter("armed")) ctx.destroySelf(); },
  },
  "two steps forward|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.hitsThisCombatChain() >= 2, onActivate(ctx) { create(ctx, AGILITY); } } },
  "feign vengeance|3": { onAttackResolved(ctx) { if ((ctx.link?.defendingCards.length ?? 0) + (ctx.link?.defendingEquipment.length ?? 0) > 0) ctx.drawCards(ctx.seat, 1); } },
  ...pitches("become the bottle", () => ({
    onAttackDeclared(ctx) {
      const cards = ctx.state.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards, ...link.defendingEquipment, ...link.reactions]);
      if (cards.length) ctx.requestCardChoice("pen-bottle-name", "Choose a card on the combat chain", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-bottle-name") return;
      const chosen = ctx.state.chain.flatMap((link) => [link.attackingCard, ...link.defendingCards, ...link.defendingEquipment, ...link.reactions]).find((card) => card.instanceId === Number(option));
      if (!chosen) return;
      for (const name of ctx.cardNames(chosen)) {
        const canonicalCardId = ctx.cardIdsNamed(name)[0];
        ctx.grantCardName(
          ctx.self.instanceId,
          canonicalCardId ? ctx.cardData(canonicalCardId).name : name,
        );
      }
    },
  })),
  ...pitches("become the cup", () => ({
    additionalCost(ctx) {
      ctx.requestChoice("pen-cup-color", "Choose a color", ["red", "yellow", "blue"]);
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-cup-color") return;
      ctx.setCardColor(ctx.self.instanceId, option === "red" ? 1 : option === "yellow" ? 2 : 3);
    },
  })),

  "plating of unity|0": unityEquipment(),
  "pillar of unity|0": unityEquipment(),
  "rend flesh|3": { onPlay(ctx) { ctx.setFlag("player", "penRendFlesh", true); } },
  ...pitches("display of craftsmanship", (pitch) => ({
    canPlay: (ctx) => ctx.link?.attackCardType === "weapon",
    onPlay(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: 5 - pitch });
      const weapon = ctx.link?.attackingCard;
      if (weapon && Number(weapon.counters?.sharpenedTurn ?? 0) === ctx.state.turn) ctx.addCounter(weapon.instanceId, "power", 1);
    },
  })),
  ...pitches("cut n' carve", (pitch) => ({
    onPlay(ctx) {
      const swords = ctx.player(ctx.seat).weapons.filter((card) => hasTag(ctx, card, "sword"));
      if (swords.length) ctx.requestCardChoice("pen-sharpen", "Choose a sword to sharpen", swords.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-sharpen") return;
      const id = Number(option);
      ctx.addCounter(id, "power", 1);
      ctx.setCardCounter(id, "sharpenedTurn", ctx.state.turn);
      const sword = ctx.player(ctx.seat).weapons.find((card) => card.instanceId === id);
      if (Number(sword?.counters?.power ?? 0) + 1 >= pitch) buffNextAttack(ctx, { dominate: true, appliesToInstanceId: id });
    },
  })),

  "mbrio base vizier|0": { preventArcaneDamage: 1 },
  "mbrio base cortex|0": { modifyDefense: (ctx) => controls(ctx, "Hyper Driver") ? 2 : 0 },
  "mbrio base digits|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", tap: true, effectCardCosts: [{ zone: "arena", move: "tap", count: 1, subtype: "cog", prompt: "Tap a cog" }], onActivate(ctx) { ctx.addCardTempDefense(ctx.self.instanceId, 1); } } },
  "blast rig|1": { modifyAttack: (ctx) => controlledType(ctx, "evo").length },
  "speed demon|1": {
    additionalCost(ctx) {
      const choices = [...ctx.player(ctx.seat).board, ...Object.values(ctx.player(ctx.seat).equipment).filter((card): card is Card => card !== undefined)];
      if (choices.length) ctx.requestCardChoice("pen-scrap", "Scrap an item, equipment, or token?", ["no", ...choices.map((card) => card.instanceId)]);
    },
    modifyAttack: (ctx) => controls(ctx, "Hyper Driver") ? 1 : 0,
    onChoose(ctx, hook, option) {
      if (hook !== "pen-scrap" || option === "no") return;
      const target = [...ctx.player(ctx.seat).board, ...Object.values(ctx.player(ctx.seat).equipment).filter((card): card is Card => card !== undefined)].find((card) => card.instanceId === Number(option));
      if (!target) return;
      const driver = named(ctx, target, "Hyper Driver");
      if (ctx.destroyPermanent(target.instanceId) && driver) ctx.setCounter("scrappedDriver", 1);
    },
    onAttackDeclared(ctx) { if (ctx.getCounter("scrappedDriver")) { const driver = ctx.createToken(HYPER_DRIVER); if (driver) ctx.setCardCounter(driver.instanceId, "steam", 2); } },
  },
  "assembly module|3": {
    onEnterArena(ctx) { ctx.setCounter("steam", 1); },
    triggers: [{ event: "start-of-turn", label: "Remove a steam counter or destroy this", effect(ctx) { if (ctx.getCounter("steam") <= 0) ctx.destroySelf(); else ctx.setCounter("steam", ctx.getCounter("steam") - 1); } }],
    activated: { cost: 0, isAttack: false, goAgain: true, tap: true, onActivate(ctx) { const driver = ctx.player(ctx.seat).deck.find((card) => named(ctx, card, "Hyper Driver")); if (driver) ctx.settleCard(driver.instanceId); ctx.shuffleDeck(); } },
  },
  "evo beta base head|3": evoBeta("head"),
  "evo beta base chest|3": evoBeta("chest"),
  "evo beta base arms|3": evoBeta("arms"),
  "evo beta base legs|3": evoBeta("legs"),
  ...pitches("heavy metal hardcore", () => ({ modifyAttack: (ctx) => ctx.getFlag("player", "boostedSubtype:evo") === true ? 1 : 0 })),

  "concealed nerve gas|0": { triggersWhileFaceDown: true, onHeroDealtDamage(ctx) { if (ctx.link?.goAgain) { ctx.destroySelf(); create(ctx, FRAILTY, 1, opponentSeat(ctx)); } } },
  "concealed pathogen|0": { triggersWhileFaceDown: true, onHeroDealtDamage(ctx) { if (ctx.link?.flags.playedAttackReaction === true) { ctx.destroySelf(); create(ctx, BLOODROT, 1, opponentSeat(ctx)); } } },
  "concealed sedative|0": { triggersWhileFaceDown: true, onHeroDealtDamage(ctx) { if (ctx.attackBonusAboveBase() > 0) { ctx.destroySelf(); create(ctx, INERTIA, 1, opponentSeat(ctx)); } } },
  "rainbow goo trap|1": {
    canTriggerOnDefend: (ctx) => ctx.attackBonusAboveBase() > 0 && ctx.currentAttackHasDominate() && ctx.link?.goAgain === true,
    onDefend(ctx) {
      ctx.addModifier({ scope: "chain-link", attack: -2, seat: opponentSeat(ctx) });
      ctx.suppressAttackAbilities();
    },
  },
  "courageous crossing|3": {
    onPlay(ctx) { create(ctx, COURAGE, 1, opponentSeat(ctx)); },
    canTriggerOnDefend: (ctx) => ctx.attackBonusAboveBase() > 0,
    onDefend(ctx) {
      const cards = allPermanents(ctx).filter((card) => Number(card.counters?.power ?? 0) > 0);
      if (cards.length) ctx.requestCardChoice("pen-remove-power", "Remove a +1 power counter", cards.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "pen-remove-power") ctx.addCounter(Number(option), "power", -1); },
  },
  "frail swingline|3": {
    onPlay(ctx) { create(ctx, FRAILTY, 1, opponentSeat(ctx)); },
    canTriggerOnDefend: (ctx) => !!ctx.link && ctx.currentAttackPower() < ctx.basePower(ctx.link.attackingCard),
    onDefend(ctx) { requestDiscardChoice(ctx, "frail-swingline-discard", "Choose a card to discard", ctx.seat); },
    onChoose(ctx, hook, option) { if (hook === "frail-swingline-discard") resolveDiscardChoice(ctx, option, ctx.seat); },
  },
  "quickening sand|3": {
    onPlay(ctx) { create(ctx, "DVR028", 1, opponentSeat(ctx)); },
    canTriggerOnDefend: (ctx) => ctx.link?.goAgain === true,
    onDefend(ctx) {
      const targets = heroesAndAllies(ctx);
      if (targets.length) ctx.requestCardChoice("pen-quickening-tap", "Tap target hero or ally", targets.map((card) => card.instanceId));
    },
    onChoose(ctx, hook, option) { if (hook === "pen-quickening-tap") ctx.tap(Number(option)); },
  },
  ...pitches("spellbane trap", (pitch) => ({
    onPlay(ctx) { buffNextAttack(ctx, { attack: 4 - pitch, appliesToSubtype: "arrow" }); },
    canTriggerOnDefend: (ctx) => ctx.getPlayerFlag(opponentSeat(ctx), "arcaneDamageDealtThisTurn") === true,
    onDefend(ctx) { create(ctx, SPELLBANE_AEGIS); },
  })),

  "blackstone greaves|0": { modifyDefense: (ctx) => ctx.getFlag("player", "arcaneDamageDealtThisTurn") === true ? 1 : 0 },
  "runic fellingsong|2": auraFromGraveArcane(),
  "runic fellingsong|3": auraFromGraveArcane(),
  ...pitches("weeping battleground", () => ({ onPlay(ctx) { const auras = ctx.player(ctx.seat).graveyard.filter((card) => hasTag(ctx, card, "aura")); if (auras.length) ctx.requestCardChoice("pen-weeping", `Banish an aura for ${ctx.previewArcaneDamage(1)} arcane damage?`, ["no", ...auras.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "pen-weeping" && option !== "no" && ctx.banish(Number(option))) dealArcane(ctx, opponentSeat(ctx), 1); } })),

  "shroud of the fate watcher|0": { onLeaveArena(ctx) { create(ctx, SIGIL_OF_FATE); } },
  "robe of resourcefulness|0": { onLeaveArena(ctx) { ctx.changeResources(ctx.seat, 2); } },
  "gloves of erasure|0": { onLeaveArena(ctx) { const tokens = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "aura") && hasTag(ctx, card, "token")); if (tokens.length) ctx.requestCardChoice("pen-erase-aura", "Destroy an aura token", tokens.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-erase-aura") ctx.destroyPermanent(Number(option)); } },
  "glyph power spell|1": arcaneSpell(4),
  "painful premonition|1": arcaneSpell(3, true),
  "painful premonition|2": arcaneSpell(2, true),
  "painful premonition|3": arcaneSpell(1, true),
  "future sight|1": createSigils(3),
  "future sight|2": createSigils(2),
  "future sight|3": createSigils(1),
  "sigil of fate|0": { onLeaveArena(ctx) { optN(ctx, 1); }, triggers: [{ event: "begin-action-phase", label: "Destroy Sigil of Fate", effect(ctx) { ctx.destroySelf(); } }], onChoose: optOnChoose },
  "embody greatness|2": {
    additionalCost(ctx) {
      const available = LIVING_LEGEND_HERO_NAMES.filter((name) =>
        ctx.cardIdsNamed(name).some((cardId) => ctx.cardData(cardId).cardType === "hero"),
      );
      if (available.length) {
        ctx.requestChoice("pen-embody-hero", "Name a living legend hero", [...available]);
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "pen-embody-hero") return;
      const heroId = ctx.cardIdsNamed(option).find(
        (cardId) => ctx.cardData(cardId).cardType === "hero",
      );
      if (heroId) ctx.becomeHeroUntilNextTurn(heroId);
    },
  },

  "silken shroud|0": leaveToken(PONDER),
  "silken shawl|0": leaveToken(VIGOR),
  "silken symphony|0": leaveToken(MIGHT),
  "silken slippers|0": leaveToken(AGILITY),
  "shimmering mirage|3": {
    onChainLinkResolved(ctx) {
      if (ctx.banish(ctx.self.instanceId)) {
        ctx.allowPlayFrom(ctx.self.instanceId, "banish", { untilChainClose: true });
      }
    },
  },
  ...pitches("power of make believe", () => ({ modifyAttack(ctx) { return (ctx.link?.defendingCards ?? []).filter((card) => isSixPlus(ctx, card)).length; } })),
  ...pitches("shimmering specter", () => ({ onLeaveArena(ctx) { if (ctx.link) create(ctx, SPECTRAL_SHIELD); } })),

  "graven cowl|0": gravenEquipment("head"),
  "graven vestment|0": gravenEquipment("chest"),
  "graven gloves|0": gravenEquipment("arms"),
  "graven walkers|0": gravenEquipment("legs"),
  "mist hunter|1": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 3),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && hasTag(ctx, ctx.player(opponentSeat(ctx)).hero, "mystic");
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      for (const card of [...ctx.player(target).deck]) {
        if (named(ctx, card, "Inner Chi")) ctx.banish(card.instanceId);
      }
      ctx.shuffleDeck(target);
    },
  },
  ...pitches("excessive bloodloss", () => contractColor(1, true)),
  ...pitches("knife through", () => ({ onAttackDeclared(ctx) { if (ctx.hitsThisCombatChain() > 0) ctx.grantGoAgain(); } })),
  "song of larinkmorth white|3": { onPlay(ctx) { create(ctx, FROSTBITE, 1, opponentSeat(ctx)); } },
  "reach beyond the grave|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, onActivate(ctx) { const allies = ctx.player(ctx.seat).graveyard.filter((card) => hasTag(ctx, card, "ally")); if (allies.length) ctx.requestCardChoice("pen-reach-ally", "Return an ally", allies.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "pen-reach-ally" && ctx.moveToHand(Number(option))) requestDiscardChoice(ctx, "pen-reach-discard", "Choose a card to discard", ctx.seat); else if (hook === "pen-reach-discard") resolveDiscardChoice(ctx, option, ctx.seat); } },
  "beneath the surface|2": {},
  ...pitches("man overboard", discardAllyAttack),
  ...pitches("tentacular toll", (pitch) => ({ onPlay(ctx) { const allies = ctx.player(ctx.seat).graveyard.filter((card) => hasTag(ctx, card, "ally") && !card.faceDown).slice(0, 4 - pitch); for (const ally of allies) ctx.setCardFaceDown(ally.instanceId, true); create(ctx, GOLD, allies.length); } })),
  "skywarden no.161803|2": { onDefend(ctx) { const items = ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "item")); if (items.length) ctx.requestCardChoice("pen-galvanize", "Destroy an item for +1 defense?", ["no", ...items.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook !== "pen-galvanize" || option === "no") return; const card = ctx.player(ctx.seat).board.find((item) => item.instanceId === Number(option)); if (card && ctx.destroyPermanent(card.instanceId)) { ctx.addModifier({ scope: "chain-link", defense: 1 }); if (named(ctx, card, "Golden Cog")) create(ctx, GOLD); } } },
  "shallow water shark harpoon|2": { canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.getFlag("player", "activatedCannonThisTurn") === true; }, onHit(ctx) { const arsenal = ctx.player(opponentSeat(ctx)).arsenal[0]; if (arsenal) { ctx.moveToGraveyard(arsenal.instanceId, "arsenal"); create(ctx, GOLD); } } },
  "trench of watery depths|0": { onDefend(ctx) { const blues = ctx.player(ctx.seat).graveyard.filter((card) => ctx.cardColor(card) === 3); if (blues.length) ctx.requestCardChoice("pen-trench-pitch", "Pitch a blue from graveyard?", ["no", ...blues.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "pen-trench-pitch" && option !== "no") ctx.pitchCard(Number(option)); } },
  "break open the chests!|2": { onPlay(ctx) { let yellow = false; for (const player of ctx.state.players) for (const card of player.arsenal) { ctx.turnArsenalFaceUp(card.instanceId); if (ctx.cardColor(card) === 2) yellow = true; } if (yellow) create(ctx, GOLD, 2); } },
  ...pitches("lighten the load", () => ({ onAttackDeclared(ctx) { const options: (number | string)[] = ["no", ...ctx.player(ctx.seat).hand.map((card) => card.instanceId), ...ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "item")).map((card) => `item:${card.instanceId}`)]; if (options.length > 1) ctx.requestCardChoice("pen-lighten", "Discard a card or destroy an item for go again?", options); }, onChoose(ctx, hook, option) { if (hook !== "pen-lighten" || option === "no") return; const paid = option.startsWith("item:") ? ctx.destroyPermanent(Number(option.slice(5))) : !!ctx.discardCard(ctx.seat, Number(option)); if (paid) ctx.grantGoAgain(); } })),
  ...pitches("submerge", () => ({ additionalCost(ctx) { const hand = ctx.player(ctx.seat).hand.filter((card) => card.instanceId !== ctx.self.instanceId); if (hand.length) ctx.requestCardChoice("pen-submerge", "Put a card fifth from the top", hand.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-submerge") ctx.putOnDeckAtDepth(Number(option), 5); } })),

  "herald of victoria|2": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true, onActivate(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: opponentSeat(ctx), attack: -1, appliesTo: "attack-action" }); } } },
  "solray plating|0": { optionalDamagePrevention: { amount: 1, moveSource: "destroy" } },
  "blessing of themis|2": { triggers: [{ event: "start-of-turn", label: "Put Blessing of Themis into your soul", effect(ctx) { ctx.putIntoSoul(ctx.self.instanceId); } }] },
  "duty bound blitz|3": { canPlay: (ctx) => Number(ctx.getFlag("player", "soulPitch:2")) > 0 },
  ...pitches("soul bond belief", () => ({ onAttackDeclared(ctx) { const top = ctx.player(ctx.seat).deck[0]; if (top && ctx.cardColor(top) === 2 && ctx.putIntoSoul(top.instanceId)) ctx.addModifier({ scope: "chain-link", attack: 1 }); } })),
  "pound of flesh|3": { onPlay(ctx) { for (const player of ctx.state.players) { const hand = player.hand; if (!hand.length) { ctx.loseLife(player.seat, 1); continue; } const card = hand[ctx.randomInt(hand.length)]!; const big = isSixPlus(ctx, card); ctx.banish(card.instanceId); if (!big) ctx.loseLife(player.seat, 1); } } },
  "deep recesses of existence|3": bloodDebt({
    runeGate: true,
    onCombatChainClosed(ctx) {
      ctx.requestChoice("deep-recesses-self", "Banish Deep Recesses of Existence face-down?", ["yes", "no"]);
    },
    onChoose(ctx, hook, option) {
      if (hook === "deep-recesses-self") {
        if (option === "yes" && ctx.banish(ctx.self.instanceId, { faceDown: true })) {
          requestDeepRecessesBanish(ctx);
        }
        return;
      }
      const match = /^deep-recesses-graveyard:(\d+)$/.exec(hook);
      if (!match) return;
      const seat = Number(match[1]);
      const instanceId = Number(option);
      ctx.setCardFaceDown(instanceId, false);
      ctx.banish(instanceId);
      requestDeepRecessesBanish(ctx, seat + 1);
    },
  }),
  "embraforged gauntlet|0": bloodDebt({ graveyardReplacement: "banish" }),
  "engulfing shadows|2": bloodDebt({ graveyardReplacement: "banish" }),
  ...pitches("depths of despair", () => bloodDebt({ onDefend(ctx) { ctx.setFlag("link", `banishOnClose:${ctx.self.instanceId}`, true); } })),
  ...pitches("fasting carcass", (pitch) => bloodDebt({
    onPlay(ctx) {
      ctx.addModifier({
        scope: "next-play",
        grantKeyword: "go again",
        appliesToCardType: "action",
        appliesToPitch: pitch,
      });
    },
  })),

  "seeds of strength|1": { ...bond("earth", (ctx) => create(ctx, MIGHT, 4)), onPlay(ctx) { create(ctx, MIGHT, ctx.getCounter("bonded") ? 4 : 3); } },
  "arc bending|1": { ...bond("lightning", (ctx) => ctx.grantGoAgain()), onAttackDeclared(ctx) { if (ctx.getCounter("bonded")) ctx.grantGoAgain(); ctx.addModifier({ scope: "combat-chain", damage: 1, appliesToType: ["lightning", "elemental"] }); } },
  "verdant tide|1": { ...bond("earth", (ctx) => create(ctx, EARTH)), replaceFriendlyTokenCreation(ctx, cardId, count) { return hasTag(ctx, cardId, "aura") && (hasTag(ctx, cardId, "elemental") || hasTag(ctx, cardId, "runeblade")) ? count + 1 : count; } },
  "voltic veil|1": { ...bond("lightning", (ctx) => dealArcane(ctx, opponentSeat(ctx), 1)), onPlay(ctx) { ctx.preventNextDamage(ctx.seat, 4); if (ctx.getCounter("bonded")) dealArcane(ctx, opponentSeat(ctx), 1); } },
  "colors of aria|1": { allZoneTypes: ["earth", "ice", "lightning"] },
  "frosthaven sheath|1": bond("ice", (ctx) => create(ctx, FROSTBITE, 1, ctx.link?.attacker ?? opponentSeat(ctx))),
  "leaven sheath|1": bond("earth", (ctx) => create(ctx, EARTH)),
  "stormwind sheath|1": bond("lightning", (ctx) => create(ctx, LIGHTNING)),
  "laden with earth|1": { ...bond("earth", (ctx) => create(ctx, EARTH)), onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); if (ctx.getCounter("bonded")) create(ctx, EARTH); } },
  "laden with frost|1": { ...bond("ice", (ctx) => create(ctx, FROSTBITE, 1, opponentSeat(ctx))), onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); if (ctx.getCounter("bonded")) create(ctx, FROSTBITE, 1, opponentSeat(ctx)); } },
  "laden with lightning|1": { ...bond("lightning", (ctx) => create(ctx, LIGHTNING)), onPlay(ctx) { buffNextAttack(ctx, { attack: 3 }); if (ctx.getCounter("bonded")) create(ctx, LIGHTNING); } },
  "chorus of rotwood|1": { ...decompose((ctx) => create(ctx, EARTH)), onPlay(ctx) { create(ctx, RUNECHANT, 3); decompose((inner) => create(inner, EARTH)).onPlay?.(ctx); }, onChoose: decompose((ctx) => create(ctx, EARTH)).onChoose },
  "sowing thorns|1": { ...decompose(() => {}), onPlay(ctx) { ctx.gainLife(ctx.seat, 1); decompose(() => {}).onPlay?.(ctx); }, onChoose: decompose(() => {}).onChoose },
  "limbs of lignum vitae|0": { modifyDefense: (ctx) => ctx.player(ctx.seat).banish.filter((card) => !card.faceDown && hasTag(ctx, card, "earth")).length >= 4 ? 1 : 0 },
  "doubling season|1": { replacePowerGain: (_ctx, amount) => amount + 1 },
  "oath of oak|1": oathOfOak(3),
  "oath of oak|2": oathOfOak(2),
  "oath of oak|3": oathOfOak(1),
  "sprout strength|2": nextAttack(2),
  "sprout strength|3": nextAttack(1),

  "monolith of galcia|3": { onPlay(ctx) { const frozen = ctx.state.players.flatMap((player) => [...player.board, ...Object.values(player.equipment).filter((card): card is Card => card !== undefined)]).filter((card) => Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn); if (frozen.length) ctx.requestCardChoice("pen-destroy-frozen", "Destroy a frozen permanent", frozen.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-destroy-frozen") ctx.destroyPermanent(Number(option)); } },
  "shattering grasp|0": { activated: { cost: 0, isAttack: false, goAgain: true, destroySelfCost: true, canActivate: (ctx) => ctx.state.players.flatMap((player) => player.board).some((card) => hasTag(ctx, card, "ally") && Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn), onActivate(ctx) { const allies = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "ally") && Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn); ctx.requestCardChoice("pen-shatter-ally", "Destroy a frozen ally", allies.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "pen-shatter-ally") ctx.destroyPermanent(Number(option)); } },
  "channel galcia's cradle|3": { onEnterArena(ctx) { const cards = ctx.state.players.flatMap((player) => [...player.board, ...Object.values(player.equipment).filter((card): card is Card => card !== undefined)]); if (cards.length) ctx.requestCardChoice("pen-channel-freeze", "Freeze a permanent", cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-channel-freeze") ctx.setCardCounter(Number(option), "frozenUntilTurn", Number.MAX_SAFE_INTEGER); } },
  ...pitches("conquer the icy terrain", () => ({ canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const target = opponentSeat(ctx); if (!ctx.requestPayment("pen-conquer-pay", "Pay 2 resources to prevent destruction?", 2, target)) { const frozen = [...ctx.player(target).arsenal, ...ctx.player(target).board, ...Object.values(ctx.player(target).equipment).filter((card): card is Card => card !== undefined)].filter((card) => Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn); if (frozen.length) ctx.requestCardChoice("pen-conquer-destroy", "Destroy a frozen card", ["no", ...frozen.map((card) => card.instanceId)]); } }, onChoose(ctx, hook, option) { if (hook === "pen-conquer-pay" && option === "declined") { const target = opponentSeat(ctx); const frozen = [...ctx.player(target).arsenal, ...ctx.player(target).board, ...Object.values(ctx.player(target).equipment).filter((card): card is Card => card !== undefined)].filter((card) => Number(card.counters?.frozenUntilTurn ?? 0) > ctx.state.turn); if (frozen.length) ctx.requestCardChoice("pen-conquer-destroy", "Destroy a frozen card", ["no", ...frozen.map((card) => card.instanceId)]); } else if (hook === "pen-conquer-destroy" && option !== "no") ctx.destroyPermanent(Number(option)); } })),
  "put on ice|1": putOnIce(3),
  "put on ice|2": putOnIce(2),
  "put on ice|3": putOnIce(1),

  "sigil of voltaris|3": { arcaneDamageEffect: true, onEnterArena(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); }, onLeaveArena(ctx) { dealArcane(ctx, opponentSeat(ctx), 1); }, triggers: [{ event: "begin-action-phase", label: "Destroy Sigil of Voltaris", effect(ctx) { ctx.destroySelf(); } }] },
  "strike twice|1": { ...arcaneSpell(3), playAsInstant: (ctx) => ctx.getFlag("player", "arcaneDamageDealtToOpposingHeroThisTurn") === true },
  "voltic vanguard|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => ctx.getFlag("player", "playedCardType:instant") === true, onActivate(ctx) { ctx.preventNextDamage(ctx.seat, 2); } } },
  "ion charged|2": { onPlay(ctx) { ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToType: ["lightning", "elemental"], appliesToKeyword: "go again" }); } },
  ...pitches("overcharge", (pitch) => ({ modifyAttack: (ctx) => ctx.link?.flags.playedInstant === true ? 4 - pitch : 0 })),
  "cloud cover|2": { onPlay(ctx) { ctx.preventNextDamage(ctx.seat, 2); } },
  "cloud cover|3": { onPlay(ctx) { ctx.preventNextDamage(ctx.seat, 1); } },

  "haboob|1": { modifyOpposingAttack: () => -1, modifyOpposingPower: () => -1, triggers: [{ event: "start-of-turn", whose: "any", label: "Haboob storm upkeep", effect(ctx) { const n = ctx.getCounter("storm") + 1; ctx.setCounter("storm", n); const ash = ctx.player(ctx.seat).board.filter((card) => named(ctx, card, "Ash")).slice(0, n); if (ash.length < n) ctx.destroySelf(); else for (const card of ash) ctx.destroyPermanent(card.instanceId); } }] },
  "smoldering steel|1": { canPlay: (ctx) => !!ctx.link && hasTag(ctx, ctx.link.attackingCard, "dagger"), onPlay(ctx) { ctx.addModifier({ scope: "chain-link", attack: 1 }); ctx.setFlag("link", "penSmolderingSteel", true); } },
  "smoldering scales|0": {
    optionalFriendlyTokenCreationReplacement: {
      label: "Destroy Smoldering Scales instead of creating Frostbite?",
      condition(ctx, cardId, count) {
        return count > 0 && named(ctx, cardId, "Frostbite");
      },
      effect(ctx) { ctx.destroySelf(); },
    },
  },
  "four feathers one crown|1": { modifyAttack: (ctx) => ctx.player(ctx.seat).graveyard.filter((card) => data(ctx, card).name.includes("Phoenix Bannerman")).length },
  "phoenix bannerman: head|1": phoenixBannerman(PONDER),
  "phoenix bannerman: chest|1": phoenixBannerman(VIGOR),
  "phoenix bannerman: arms|1": phoenixBannerman(MIGHT),
  "phoenix bannerman: legs|1": phoenixBannerman(AGILITY),

  "serpent's kiss|3": { onAttackDeclared(ctx) { if (ctx.getFlag("player", "transcendedThisTurn") === true) { ctx.createCardInHand(FANG_STRIKE); ctx.createCardInHand(SLITHER); } else ctx.requestChoice("pen-serpent-token", "Create Fang Strike or Slither", [FANG_STRIKE, SLITHER]); }, canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined, onHit(ctx) { const top = ctx.player(opponentSeat(ctx)).deck.slice(0, 2); if (top.length) { for (const card of top) ctx.lookAt(card.instanceId); ctx.requestCardChoice("pen-serpent-banish", "Banish one of the top 2 cards", top.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "pen-serpent-token") ctx.createCardInHand(option); else if (hook === "pen-serpent-banish") ctx.banish(Number(option)); } },
  "wax and wane|3": { onPlay(ctx) { const auras = ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "aura")); if (auras.length) ctx.requestCardChoice("pen-wax-aura", "Put a +1 power counter on an aura", auras.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-wax-aura") ctx.addCounter(Number(option), "power", 1); } },
  "shapeless form|3": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "combat-chain" });
    },
    triggers: [{
      event: "card-played",
      label: "Choose a name for the ephemeral attack",
      condition: (ctx, played) => !!played &&
        played.instanceId !== ctx.self.instanceId &&
        hasTag(ctx, played, "attack") &&
        hasKeyword(ctx, played, "ephemeral"),
      effect(ctx, played) {
      if (!played) return;
      ctx.setCounter("shapelessTarget", played.instanceId);
      ctx.requestNameChoice("pen-shapeless-name", "Choose a name for the ephemeral attack");
      },
    }],
    onChoose(ctx, hook, option) {
      if (hook !== "pen-shapeless-name") return;
      const target = ctx.getCounter("shapelessTarget");
      if (target > 0) ctx.grantCardName(target, option);
    },
  },
  "kimono of layered lessons|0": { activated: { cost: 0, chiCost: 3, isAttack: false, goAgain: false, timing: "instant", turnsFaceUp: true, onActivate(ctx) { ctx.addCardDefenseCounters(ctx.self.instanceId, -1); } }, triggers: [{ event: "start-of-turn", label: "Destroy Kimono of Layered Lessons", effect(ctx) { ctx.destroySelf(); } }] },
  "recede to mistform|3": { variablePlayCost: { base: 0, counterKey: "recedeX", prompt: "Choose X", maximum(ctx) { return Object.values(ctx.player(ctx.seat).equipment).filter((card) => card && !card.faceDown && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "cloaked")).length; } }, onPlay(ctx) { if (ctx.getCounter("recedeX") <= 0) return; const equipment = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && !card.faceDown && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "cloaked")); if (equipment.length) ctx.requestCardChoice("recede-equipment", "Choose equipment with cloaked to turn face-down", equipment.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook !== "recede-equipment") return; if (ctx.setCardFaceDown(Number(option), true)) ctx.addCounter(ctx.self.instanceId, "recedeChosen", 1); if (ctx.getCounter("recedeChosen") >= ctx.getCounter("recedeX")) return; const equipment = Object.values(ctx.player(ctx.seat).equipment).filter((card): card is DeepReadonly<CardInstance> => !!card && !card.faceDown && (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "cloaked")); if (equipment.length) ctx.requestCardChoice("recede-equipment", "Choose another equipment with cloaked", equipment.map((card) => card.instanceId)); } },
  "mistborn protector|3": { modifyDefense: (ctx) => createdThisTurn(ctx) ? 1 : 0 },
  "billowing mist|3": { onPlay(ctx) { buffNextAttack(ctx, { attack: 1 }); ctx.setFlag("player", "penExtraEphemeral", true); } },
  "look within|3": { onPlay(ctx) { const chi = ctx.player(ctx.seat).deck.find((card) => hasTag(ctx, card, "chi")); if (chi) ctx.putOnDeckTop(chi.instanceId); ctx.shuffleDeck(); } },
  "spreading mist|3": { onPlay(ctx) { buffNextAttack(ctx, { goAgain: true }); ctx.setFlag("player", "penExtraEphemeral", true); } },
  "descend into madness|3": { onPlay(ctx) { const target = opponentSeat(ctx); const hand = ctx.player(target).hand; if (!hand.length) return; ctx.banish(hand[ctx.randomInt(hand.length)]!.instanceId); ctx.drawCards(target, 1); } },
  "concoct disorder|2": { onAttackDeclared(ctx) { let moved = 0; for (const player of ctx.state.players) { const top = player.deck[0]; if (top && player.arsenal.length === 0 && ctx.putIntoArsenal(top.instanceId, "deck")) moved++; } if (moved >= 2) ctx.grantGoAgain(); } },
  "concoct disorder|3": { onAttackDeclared(ctx) { let moved = 0; for (const player of ctx.state.players) { const top = player.deck[0]; if (top && player.arsenal.length === 0 && ctx.putIntoArsenal(top.instanceId, "deck")) moved++; } if (moved >= 2) ctx.grantGoAgain(); } },
  "hyper inflation|2": { onAttackDeclared(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: 0, appliesTo: "any", playCostReduction: -1 }); ctx.addModifier({ scope: "until-end-of-turn", seat: 1, appliesTo: "any", playCostReduction: -1 }); } },
  "hyper inflation|3": { onAttackDeclared(ctx) { ctx.addModifier({ scope: "until-end-of-turn", seat: 0, appliesTo: "any", playCostReduction: -1 }); ctx.addModifier({ scope: "until-end-of-turn", seat: 1, appliesTo: "any", playCostReduction: -1 }); } },

  "tough as a rok|3": { modifyBasePower: (ctx, card, base) => card.instanceId === ctx.self.instanceId ? (lowerLife(ctx) ? 6 : 0) : base },
  "energy of the audience|2": { modifyAttack: (ctx) => lowerLife(ctx) ? ctx.player(ctx.seat).board.filter((card) => hasTag(ctx, card, "suspense")).length : 0 },
  "comeback kicks|0": { onCheered(ctx) { if (lowerLife(ctx)) ctx.requestChoice("pen-comeback", "Destroy Comeback Kicks to gain an action point?", ["yes", "no"]); }, onChoose(ctx, hook, option) { if (hook === "pen-comeback" && option === "yes") { ctx.destroySelf(); ctx.gainActionPoint(); } } },
  "emboldened by the crowd|2": { modifyPlayCost: (ctx, base) => ctx.getFlag("player", "cheeredThisTurn") === true ? Math.max(0, base - 3) : base },
  ...pitches("hulk up", () => ({ modifyPlayCost: (ctx, base) => lowerLife(ctx) ? Math.max(0, base - 1) : base })),
  ...pitches("stadium security", () => ({
    canDefendFromArsenal: (ctx) => ctx.getFlag("player", "controlledName:toughness") === true,
  })),
  "chain of brutality|1": { onAttackDeclared(ctx) { if (ctx.currentAttackPower() >= 6) ctx.grantGoAgain(); }, canTriggerOnHit(ctx) { return ctx.link?.targetAllyId === undefined && ctx.currentAttackPower() >= 6; }, onHit(ctx) { ctx.setFlag("player", "penNextBaseSix", true); } },
  "snarky prick|1": { onAttackDeclared(ctx) { if (ctx.link?.targetAllyId !== undefined) return; const top = ctx.player(opponentSeat(ctx)).deck[0]; if (!top) return; ctx.lookAt(top.instanceId); if (ctx.cardColor(top) === 1) ctx.requestCardChoice("pen-snarky", "Destroy the red card?", ["no", top.instanceId]); }, onChoose(ctx, hook, option) { if (hook === "pen-snarky" && option !== "no" && ctx.moveToGraveyard(Number(option), "deck")) ctx.addModifier({ scope: "chain-link", attack: 4 }); } },
  ...pitches("insult to injury", () => ({ onAttackDeclared(ctx) { if (higherLife(ctx)) ctx.grantGoAgain(); } })),
  ...pitches("bad breath", (pitch) => ({ onPlay(ctx) { queueIntimidate(ctx); ctx.addModifier({ scope: "until-end-of-turn", onHitCreateToken: { cardId: MIGHT, count: 4 - pitch } }); } })),

  "myrkhellir helm|0": { modifyDefense: (ctx) => controls(ctx, "Gold") ? 1 : 0 },
  "burnished bunkerplate|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "defense-reaction", destroySelfCost: true, canActivate: (ctx) => !!ctx.link && ctx.player(ctx.seat).arsenal.some((card) => ctx.hasCardType(card, "action")), onActivate(ctx) { const cards = ctx.player(ctx.seat).arsenal.filter((card) => ctx.hasCardType(card, "action")); ctx.requestCardChoice("pen-bunkerplate", "Add an action from arsenal as a defender", cards.map((card) => card.instanceId)); } }, onChoose(ctx, hook, option) { if (hook === "pen-bunkerplate") ctx.addDefenderFromArsenal(Number(option)); } },
  "unyielding grip|0": { modifyDefense: (ctx) => ctx.player(ctx.seat).hand.length === 0 ? 3 : 0 },
  "unflinching foothold|0": { activated: { cost: 0, isAttack: false, goAgain: false, timing: "instant", destroySelfCost: true, canActivate: (ctx) => !!ctx.link, onActivate(ctx) { if (ctx.link) ctx.suppressCardKeyword(ctx.link.attackingCard.instanceId, "dominate"); } } },
  "clearwater elixir|1": elixir("Bloodrot Pox"),
  "restvine elixir|1": elixir("Inertia"),
  "sapwood elixir|1": elixir("Frailty"),
  "ransack and raze|3": {
    variablePlayCost: { base: 0, counterKey: "ransackX", prompt: "Choose X", maximum(ctx) { const target = ctx.globalCards().find((card) => card.instanceId === ctx.playTargetInstanceId); return target ? (data(ctx, target).cost ?? 0) : 0; }, canDeclareX(ctx, x) { const target = ctx.globalCards().find((card) => card.instanceId === ctx.playTargetInstanceId); return !!target && (data(ctx, target).cost ?? 0) === x; } },
    playTargetOptions(ctx) {
      return ctx.globalCards()
        .filter((card) => hasTag(ctx, card, "landmark"))
        .map((card) => card.instanceId);
    },
    onPlay(ctx) {
      const target = ctx.globalCards().find(
        (card) => card.instanceId === ctx.playTargetInstanceId,
      );
      const x = ctx.getCounter("ransackX");
      if (target && ctx.destroyGlobal(target.instanceId)) create(ctx, GOLD, x);
    },
  },
  "destructive tendencies|3": { onPlay(ctx) { const tokens = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "token") && Object.values(card.counters ?? {}).some((n) => Number(n) > 0)); if (tokens.length) ctx.requestCardChoice("pen-remove-counters", "Remove all counters from an item or aura token", tokens.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook !== "pen-remove-counters") return; const card = ctx.state.players.flatMap((player) => player.board).find((candidate) => candidate.instanceId === Number(option)); if (card) for (const key of Object.keys(card.counters ?? {})) ctx.setCardCounter(card.instanceId, key, 0); } },
  "pilfer the tomb|3": { onPlay(ctx) { const cards = ctx.player(opponentSeat(ctx)).graveyard.filter((card) => ctx.hasCardType(card, "instant") || ctx.cardColor(card) === 2); if (cards.length) ctx.requestCardChoice("pen-pilfer", "Banish an instant or yellow card", cards.map((card) => card.instanceId)); }, onChoose(ctx, hook, option) { if (hook === "pen-pilfer") ctx.banish(Number(option)); } },
  "shatter sorcery|3": { onPlay(ctx) { ctx.preventNextArcaneDamage(ctx.seat, 1); const sigils = ctx.state.players.flatMap((player) => player.board).filter((card) => hasTag(ctx, card, "aura") && data(ctx, card).name.includes("Sigil")); if (sigils.length) ctx.requestCardChoice("pen-shatter-sigil", "Destroy a Sigil aura?", ["no", ...sigils.map((card) => card.instanceId)]); }, onChoose(ctx, hook, option) { if (hook === "pen-shatter-sigil" && option !== "no") ctx.destroyPermanent(Number(option)); } },
  "drag down|2": { onDefend(ctx) { ctx.addModifier({ scope: "chain-link", attack: -2, seat: opponentSeat(ctx) }); } },
  "drag down|3": { onDefend(ctx) { ctx.addModifier({ scope: "chain-link", attack: -1, seat: opponentSeat(ctx) }); } },

  "kano|0": {
    activated: {
      cost: 3, isAttack: false, goAgain: false, timing: "instant", oncePerTurn: false,
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (!top) return;
        ctx.lookAt(top.instanceId);
        if (ctx.hasCardType(top, "action") && !hasTag(ctx, top, "attack")) ctx.requestCardChoice("pen-kano", "Banish the top card and play it as an instant?", ["no", top.instanceId]);
      },
    },
    onChoose(ctx, hook, option) { if (hook === "pen-kano" && option !== "no" && ctx.banish(Number(option))) ctx.allowPlayFrom(Number(option), "banish"); },
    allowsFriendlyCardPlayAsInstant(ctx, card, zone) { return zone === "banish" && ctx.getFlag("player", `playFrom:banish:${card.instanceId}`) === true; },
  },
});
