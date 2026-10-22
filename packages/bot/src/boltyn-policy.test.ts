import { cardData, decklists, precon, scripts, validatePresentation } from "@fyendal/cards";
import { applyIntent, createGame, legalIntents, projectStateFor, type GameState } from "@fyendal/engine";
import type { Decklist, GameIntent } from "@fyendal/shared";
import { describe, expect, it } from "vitest";
import { chooseBoltynIntent } from "./boltyn-policy.js";
import { chooseHalaIntent } from "./hala-policy.js";
import { decklistsFromState } from "./deck-knowledge.js";
import { boltynPresentationFor, halaPresentationFor } from "./sideboard.js";
import type { BotPolicyInput } from "./policy.js";

const BOLTYN_POOL = precon("bot-boltyn-raydn")!.pool;

function boltynDeck(opponentHeroId = "MPW003"): Decklist {
  const presented = boltynPresentationFor({ heroId: opponentHeroId, weaponIds: [], equipment: {} });
  const validated = validatePresentation(BOLTYN_POOL, presented, "cc", { cardPoolMode: "open" });
  if (!validated.ok) throw new Error(validated.error);
  return validated.decklist;
}

function halaDeck(): Decklist {
  const pool = precon("precon-hala-masterclass")!.pool;
  return { heroId: pool.heroId, ...halaPresentationFor({ heroId: BOLTYN_POOL.heroId, weaponIds: [], equipment: {} }) };
}

function game(seed = 4040, startPlayer: 0 | 1 = 0, opponent: Decklist = decklists.dorinthea): GameState {
  const state = createGame({
    decklists: [boltynDeck(opponent.heroId), opponent], cards: cardData, scripts, seed, startPlayer,
  });
  state.turn = 3;
  return state;
}

/** The Fang-matchup list after Kabuto is destroyed and Solforge Gauntlet enters the soul. */
function fangGame(): GameState {
  const state = createGame({
    decklists: [boltynDeck("HNT098"), decklists.dorinthea], cards: cardData, scripts, seed: 4040, startPlayer: 0,
  });
  state.turn = 3;
  delete state.players[0]!.equipment.head;
  delete state.players[0]!.equipment.arms;
  return state;
}

function cards(state: GameState, cardIds: readonly string[], owner: 0 | 1 = 0) {
  return cardIds.map((cardId) => ({ instanceId: state.nextInstanceId++, cardId, owner }));
}

function hand(state: GameState, cardIds: readonly string[]): void {
  state.players[0]!.hand = cards(state, cardIds);
}

function input(state: GameState, seat: 0 | 1 = 0): BotPolicyInput {
  return {
    seat,
    view: projectStateFor(state, seat),
    legal: legalIntents(state, seat),
    cards: cardData,
    state,
    decklists: decklistsFromState(state, seat),
  };
}

/** The policy's choice at the current decision, which must be legal and apply. */
function choice(state: GameState): { intent: GameIntent; state: GameState } {
  const observed = input(state);
  const intent = chooseBoltynIntent(observed);
  // Staged defender sets are composed from the per-card legal entries.
  if (intent.kind !== "stage-defenders") expect(observed.legal).toContainEqual(intent);
  const result = applyIntent(state, 0, intent);
  if (!result.ok) throw new Error(`${JSON.stringify(intent)}: ${result.error}`);
  return { intent, state: result.state };
}

function name(state: GameState, intent: GameIntent): string {
  const id = intent.kind === "play-card" || intent.kind === "play-from-arsenal"
    ? intent.instanceId
    : intent.kind === "activate-ability" ? intent.sourceInstanceId : undefined;
  if (intent.kind === "defend" && intent.instanceIds.length > 0) return `defend(${intent.instanceIds.length})`;
  if (id === undefined) return intent.kind === "choose" ? `choose:${intent.optionId}` : intent.kind;
  const player = state.players[0]!;
  const all = [...player.hand, ...player.arsenal, ...player.weapons, player.hero,
    ...Object.values(player.equipment).flatMap((card) => card ? [card] : [])];
  return cardData[all.find((card) => card.instanceId === id)?.cardId ?? ""]?.name ?? intent.kind;
}

/** Drive the game with Boltyn's policy in seat 0 and the opponent policy in
 * seat 1 until the predicate holds, Boltyn's turn ends, or the step cap. */
function play(
  state: GameState,
  until: (state: GameState, intent: GameIntent | undefined) => boolean,
  opponentIntent: (state: GameState) => GameIntent = passOrNoBlock,
  steps = 120,
): { state: GameState; intents: string[] } {
  const intents: string[] = [];
  let current = state;
  for (let step = 0; step < steps; step++) {
    if (until(current, undefined) || current.phase === "game-over") return { state: current, intents };
    const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
    if (actor === 0) {
      const next = choice(current);
      intents.push(name(current, next.intent));
      current = next.state;
      if (until(current, next.intent)) return { state: current, intents };
    } else {
      const intent = opponentIntent(current);
      const result = applyIntent(current, 1, intent);
      if (!result.ok) throw new Error(`opponent ${JSON.stringify(intent)}: ${result.error}`);
      current = result.state;
    }
  }
  return { state: current, intents };
}

function passOrNoBlock(state: GameState): GameIntent {
  const legal = legalIntents(state, 1);
  return legal.find((intent) => intent.kind === "defend" && intent.instanceIds.length === 0)
    ?? legal.find((intent) => intent.kind === "choose" && ["no", "decline", "pass"].includes(intent.optionId))
    ?? legal.find((intent) => intent.kind === "pass")
    ?? legal.find((intent) => intent.kind === "choose")
    ?? legal.find((intent) => intent.kind !== "concede")!;
}

function turnOver(state: GameState): boolean {
  return state.activePlayer !== 0 || state.turn !== 3;
}

/** Resolve start-of-turn prompts (the Tunic counter) down to Boltyn's first
 * clean action decision. */
function settled(state: GameState): GameState {
  let current = state;
  for (let step = 0; step < 10; step++) {
    const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
    if (actor === 0 && current.phase === "action" && !current.pendingDecision && current.stack.length === 0) {
      return current;
    }
    if (actor === 0) current = choice(current).state;
    else {
      const result = applyIntent(current, 1, passOrNoBlock(current));
      if (!result.ok) throw new Error(result.error);
      current = result.state;
    }
  }
  throw new Error("turn did not settle");
}

function soul(state: GameState, count: number): void {
  state.players[0]!.soul = cards(state, Array<string>(count).fill("ASB007"));
}

/** An opponent attack of the given power reaching Boltyn's defend decision. */
function underAttack(state: GameState, attackId: string): GameState {
  state.activePlayer = 1;
  state.priorityPlayer = 1;
  state.players[0]!.actionPoints = 0;
  state.players[1]!.actionPoints = 1;
  const [attack] = cards(state, [attackId], 1);
  state.players[1]!.hand = [attack!];
  const play = legalIntents(state, 1).find((intent) =>
    intent.kind === "play-card" && intent.instanceId === attack!.instanceId
  );
  if (!play) throw new Error("opponent cannot attack");
  let current = applyIntent(state, 1, play);
  if (!current.ok) throw new Error(current.error);
  for (let step = 0; step < 10; step++) {
    if (current.state.priorityPlayer === 0 && current.state.pendingDecision?.kind === "defend") return current.state;
    current = applyIntent(current.state, current.state.priorityPlayer, { kind: "pass" });
    if (!current.ok) throw new Error(current.error);
  }
  throw new Error("attack did not reach defense");
}

function currentLinkPower(state: GameState): number | undefined {
  return projectStateFor(state, 0).chain.at(-1)?.attackValue;
}

/** Fang, wearing Grains of Bloodspill, swings Obsidian Fire Veins in turn;
 * returns Boltyn's defend decision on the given swing. */
function veinSwing(state: GameState, swing: 0 | 1): GameState {
  state.activePlayer = 1;
  state.priorityPlayer = 1;
  state.players[0]!.actionPoints = 0;
  const fang = state.players[1]!;
  fang.hero = { ...fang.hero, cardId: "HNT098" };
  fang.actionPoints = 2;
  fang.hand = cards(state, ["OMN245"], 1);
  fang.resources = 5;
  fang.weapons = cards(state, ["FNG002", "FNG002"], 1);
  fang.equipment.chest = cards(state, ["FAB182"], 1)[0];
  let current = state;
  let blocked = false;
  for (const vein of fang.weapons) {
    const activation = legalIntents(current, 1).find((intent) =>
      intent.kind === "activate-ability" && intent.sourceInstanceId === vein.instanceId
    );
    if (!activation) throw new Error("Fang cannot swing the Vein");
    let result = applyIntent(current, 1, activation);
    if (!result.ok) throw new Error(result.error);
    for (let step = 0; step < 30; step++) {
      const decision = result.state.pendingDecision;
      if (decision?.player === 0 && decision.kind === "defend") {
        if (vein === fang.weapons[swing]) {
          if (swing === 1) expect(currentLinkPower(result.state)).toBe(3);
          return result.state;
        }
        result = applyIntent(result.state, 0, { kind: "defend", instanceIds: [] });
        blocked = true;
      } else if (result.state.chain.length === 0 && result.state.stack.length === 0 && !decision) {
        break;
      } else {
        const actor = (decision?.player ?? result.state.priorityPlayer) as 0 | 1;
        const legal = legalIntents(result.state, actor);
        // As in the report, Draco Fire follows the first block and pumps the second Vein.
        const dracoFire = actor === 1 && blocked
          ? legal.find((intent) => intent.kind === "play-card" && intent.instanceId === fang.hand[0]?.instanceId)
          : undefined;
        const pass = dracoFire ?? legal.find((intent) => intent.kind === "pass") ??
          legal.find((intent) => intent.kind === "choose" && ["no", "decline", "pass"].includes(intent.optionId))!;
        result = applyIntent(result.state, actor, pass);
      }
      if (!result.ok) throw new Error(result.error);
    }
    current = result.state;
  }
  throw new Error("the Vein swing did not reach defense");
}

const HERO = "Ser Boltyn, Breaker of Dawn";
const RAYDN = "Raydn, Duskbane";
/** Wounding Blow: a plain four-power attack. */
const PLAIN_ATTACK = "WTR203";

describe("Boltyn policy", () => {
  it("plays complete games against the Hala bot with only legal, applicable intents", () => {
    for (const seed of [11, 12]) {
      let state = createGame({
        decklists: [boltynDeck(), halaDeck()], cards: cardData, scripts, seed, startPlayer: seed % 2 as 0 | 1,
      });
      let steps = 0;
      while (state.phase !== "game-over" && steps < 1_500) {
        const actor = (state.pendingDecision?.player ?? state.priorityPlayer) as 0 | 1;
        const observed = input(state, actor);
        const intent = actor === 0 ? chooseBoltynIntent(observed) : chooseHalaIntent(observed);
        if (intent.kind !== "stage-defenders") {
          expect(observed.legal, `${actor} ${JSON.stringify(intent)}`).toContainEqual(intent);
        }
        const result = applyIntent(state, actor, intent);
        if (!result.ok) throw new Error(`seat ${actor} ${JSON.stringify(intent)}: ${result.error}`);
        state = result.state;
        steps++;
      }
      expect(state.turn).toBeGreaterThan(4);
    }
  }, 120_000);

  it("charges a yellow card into Beaming Bravado, extends through the hero ability, and swings a charged Raydn", () => {
    const state = game();
    hand(state, ["ASB021", "PEN183", "ASB007"]);
    soul(state, 0);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents[0]).toBe("Beaming Bravado");
    expect(intents).toContain(HERO);
    expect(intents).toContain("Duty Bound Blitz");
    expect(intents).toContain(RAYDN);
    // Beaming 3+1, Duty Bound 5, Raydn 3: the yellow Bolt went to the soul and
    // fed the hero ability.
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(12);
    expect(intents[1]).toMatch(/^choose:\d+$/);
    const actions = intents.filter((name) => !name.startsWith("choose:") && name !== "order-triggers");
    for (let index = 1; index < actions.length; index++) {
      expect([actions[index - 1], actions[index]], "hero ability repeated on one attack").not.toEqual([HERO, HERO]);
    }
  });

  it("sequences a charge, Lumina Ascension, and two Raydn swings", () => {
    const state = game();
    hand(state, ["ASB007", "ASB026", "ASB021"]);
    soul(state, 1);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents.filter((name) => name === RAYDN)).toHaveLength(2);
    expect(intents.indexOf("Lumina Ascension")).toBeGreaterThan(intents.indexOf("Beaming Bravado"));
    expect(intents.indexOf("Lumina Ascension")).toBeLessThan(intents.indexOf(RAYDN));
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(11);
  });

  it("charges before Lumina Ascension so Raydn swings twice with Spirit of Eirina in arsenal", () => {
    const state = fangGame();
    hand(state, ["ASB026", "IAR254", "MON033"]);
    state.players[0]!.arsenal = cards(state, ["DYN066"]);
    soul(state, 1);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents.indexOf("Lumina Ascension")).toBeGreaterThan(intents.indexOf("Bravery of the Blade"));
    expect(intents.filter((name) => name === RAYDN)).toHaveLength(2);
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(11);
  });

  it("keeps Kabuto of Imperial Authority once Fang has no weapon swing left", () => {
    const state = settled(createGame({
      decklists: [boltynDeck("HNT098"), decklists.dorinthea], cards: cardData, scripts, seed: 4040, startPlayer: 0,
    }));
    hand(state, ["DYN066", "DYN066"]);
    const defending = veinSwing(state, 1);
    const kabuto = defending.players[0]!.equipment.head!;
    expect(cardData[kabuto.cardId]!.name).toBe("Kabuto of Imperial Authority");
    const intent = chooseBoltynIntent(input(defending));
    // Both Veins are spent, so Kabuto's weapon lock would deny nothing.
    expect(intent.kind === "defend" || intent.kind === "stage-defenders" ? intent.instanceIds : [])
      .not.toContain(kabuto.instanceId);
  });

  it("keeps Lumina Ascension when Raydn will not swing after it this turn", () => {
    const state = settled(game(4070));
    // Bolt of Courage is the turn's only attack: Raydn has no go-again path to follow it.
    hand(state, ["ASB026", "SUP266", "MON033", "ASB008", "PEN181"]);
    state.players[0]!.arsenal = cards(state, ["AHA012"]);
    soul(state, 0);
    const lumina = state.players[0]!.hand[0]!.instanceId;
    const { state: after, intents } = play(state, turnOver);
    expect(intents).toContain("Bolt of Courage");
    expect(intents).not.toContain("Lumina Ascension");
    const held = [...after.players[0]!.hand, ...after.players[0]!.arsenal];
    expect(held.some((card) => card.instanceId === lumina)).toBe(true);
  });

  it("holds Lumina Ascension for a charge turn instead of pumping an uncharged Raydn", () => {
    const base = createGame({
      decklists: [boltynDeck("HNT098"), decklists.dorinthea], cards: cardData, scripts, seed: 4040, startPlayer: 0,
    });
    base.turn = 3;
    delete base.players[0]!.equipment.arms;
    const state = settled(base);
    // Nothing charges this turn, so Lumina would only add +1 to a 0-power Raydn swing.
    hand(state, ["PEN181", "ASB026", "MON032"]);
    state.players[0]!.soul = cards(state, ["PEN179"]);
    const { intents } = play(state, turnOver);
    expect(intents).not.toContain("Lumina Ascension");
  });

  it("charges Spirit of Eirina, then follows the Beacon of Victory search into more Raydn swings", () => {
    const state = fangGame();
    hand(state, ["ASB026", "DYN066", "MON033"]);
    state.players[0]!.arsenal = cards(state, ["IAR254"]);
    soul(state, 1);
    const spirit = state.players[0]!.hand[1]!.instanceId;
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents.slice(0, 2)).toEqual(["Bravery of the Blade", `choose:${spirit}`]);
    // Spirit of Eirina makes Lumina an instant: it follows the first swing's blocks.
    expect(intents.indexOf("Lumina Ascension")).toBeGreaterThan(intents.indexOf(RAYDN));
    expect(intents.filter((name) => name === RAYDN).length).toBeGreaterThanOrEqual(2);
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(11);
  });

  it("plays an instant Lumina Ascension in Raydn's reaction step instead of before the swing", () => {
    const state = game();
    hand(state, ["ASB007", "ASB026", "ASB021"]);
    soul(state, 1);
    state.players[0]!.board = cards(state, ["DYN066"]);
    const lumina = state.players[0]!.hand[1]!.instanceId;
    let luminaLink: string | undefined;
    play(settled(state), (current, intent) => {
      if (intent?.kind === "play-card" && intent.instanceId === lumina) {
        luminaLink = cardData[current.chain.at(-1)?.attackingCard.cardId ?? ""]?.name;
      }
      return turnOver(current);
    });
    expect(luminaLink).toBe(RAYDN);
  });

  it("swings Raydn, charges through Roaring Beam, then reacts with Lumina Ascension for a second swing", () => {
    const state = game();
    hand(state, ["PEN178", "ASB026"]);
    soul(state, 0);
    state.players[0]!.board = cards(state, ["DYN066"]);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents.indexOf("Roaring Beam")).toBeGreaterThan(intents.indexOf(RAYDN));
    expect(intents.indexOf("Lumina Ascension")).toBeGreaterThan(intents.indexOf("Roaring Beam"));
    expect(intents.filter((name) => name === RAYDN)).toHaveLength(2);
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(8);
  });

  it("empties the soul into Beacon of Victory so Roaring Beam charges before the search", () => {
    const state = game();
    hand(state, ["MON033", "PEN178", "ASB026"]);
    soul(state, 2);
    state.players[0]!.board = cards(state, ["DYN066"]);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents.slice(0, 5)).toEqual([RAYDN, "pass", "pass", "Beacon of Victory", "choose:x:2"]);
    expect(intents.indexOf("Roaring Beam")).toBeGreaterThan(intents.indexOf("Beacon of Victory"));
    expect(intents.filter((name) => name === RAYDN).length).toBeGreaterThanOrEqual(2);
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(12);
  });

  it("holds Beacon of Victory instead of banishing a soul card for +1 without a charge", () => {
    const state = settled(fangGame());
    hand(state, ["MON033"]);
    soul(state, 1);
    const { intents } = play(state, turnOver);
    expect(intents).not.toContain("Beacon of Victory");
    expect(intents).not.toContain(RAYDN);
  });

  it("swings a sharpened, charged Raydn through a Flurry token instead of passing", () => {
    const state = settled(game());
    hand(state, []);
    soul(state, 2);
    state.players[0]!.board = cards(state, ["SBL036", "SBL036", "ASB028"]);
    state.players[0]!.flags.chargedThisTurn = true;
    state.players[0]!.flags.chargedCountThisTurn = 1;
    state.players[0]!.weapons[0]!.counters = { power: 1 };
    const { intent } = choice(state);
    expect(intent).toMatchObject({
      kind: "activate-ability", sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    });
  });

  it("swings a sharpened Raydn into a full hand instead of passing to keep its Flurry tokens", () => {
    const state = settled(game());
    // As after Blessing of Bellona and two Edicts of Steel with only Courageous Steelhand left.
    hand(state, ["ASB014"]);
    soul(state, 0);
    state.players[0]!.board = cards(state, ["PEN181", "SBL036", "SBL036"]);
    state.players[0]!.weapons[0]!.counters = { power: 2 };
    expect(state.players[1]!.hand.length).toBeGreaterThanOrEqual(4);
    const { intent } = choice(state);
    expect(intent).toMatchObject({
      kind: "activate-ability", sourceInstanceId: state.players[0]!.weapons[0]!.instanceId,
    });
  });

  it("keeps the soul once Kabuto of Imperial Authority stops Raydn swinging again", () => {
    const swing = (locked: boolean) => {
      const state = settled(game());
      // As in the report: Lumina Ascension grants Raydn a second swing.
      hand(state, ["ASB026"]);
      soul(state, 2);
      state.players[0]!.flags.chargedThisTurn = true;
      state.players[0]!.flags.chargedCountThisTurn = 1;
      state.players[0]!.resources = 6;
      const reacting = (current: GameState) => current.pendingDecision?.kind === "attack-reaction" &&
        current.pendingDecision.player === 0;
      const swung = play(state, (current) => reacting(current) || turnOver(current));
      expect(swung.intents).toContain(RAYDN);
      // As when the defender's Kabuto resolves its defend trigger.
      if (locked) swung.state.players[0]!.flags.cannotAttackWithWeaponsThisTurn = true;
      return play(swung.state, turnOver).intents;
    };
    expect(swing(false)).toContain(HERO);
    expect(swing(true)).not.toContain(HERO);
  });

  it("passes instead of swinging an uncharged Raydn for nothing", () => {
    const state = settled(game());
    hand(state, ["MON062", "MON033", "ASB026", "SBL020"]);
    soul(state, 0);
    // Warmonger's Diplomacy "war" from the opponent's previous turn: only
    // weapon and attack actions this turn.
    state.modifiers.push({
      id: state.nextModifierId++,
      seat: 0,
      scope: "until-end-of-turn",
      createdTurn: state.turn - 1,
      sourceCardId: "DTD230",
      sourceInstanceId: 0,
      expiresAtEndOfSeatTurn: 0,
      restrictActionsToWeaponOrAttack: true,
    } as (typeof state.modifiers)[number]);
    const observed = input(state);
    expect(observed.legal.some((intent) => intent.kind === "activate-ability")).toBe(true);
    expect(observed.legal.some((intent) => intent.kind === "play-card")).toBe(false);
    expect(chooseBoltynIntent(observed)).toEqual({ kind: "pass" });
  });

  it("answers Warmonger's Diplomacy by what the hand can still do", () => {
    const diplomacy = (cardIds: string[], soulCards: number) => {
      const state = settled(game());
      hand(state, cardIds);
      soul(state, soulCards);
      const view = projectStateFor(state, 0);
      view.pendingDecision = { player: 0, kind: "choose-target", prompt: "Choose war or peace", options: ["war", "peace"] };
      const legal: GameIntent[] = [{ kind: "choose", optionId: "war" }, { kind: "choose", optionId: "peace" }];
      return chooseBoltynIntent({ seat: 0, view, legal, cards: cardData });
    };
    // Setup cards only: peace keeps Edict's Flurry and Lumina stays for later.
    expect(diplomacy(["MON062", "MON033", "ASB026", "SBL020"], 0)).toEqual({ kind: "choose", optionId: "peace" });
    // Charge attacks and V: war keeps the engine running.
    expect(diplomacy(["ASB007", "ASB021", "DTD052", "ASB023"], 1)).toEqual({ kind: "choose", optionId: "war" });
  });

  it("plays V of the Vanguard from a three-card hand when the soul fuels the chain", () => {
    const state = game();
    hand(state, ["DYN066", "ASB021", "ASB023"]);
    soul(state, 2);
    state.players[0]!.board = cards(state, ["SBL036", "SBL036"]);
    const before = state.players[1]!.life;
    const { state: after, intents } = play(settled(state), turnOver);
    expect(intents[0]).toBe("V of the Vanguard");
    expect(intents.filter((name) => name === RAYDN)).toHaveLength(2);
    expect(before - after.players[1]!.life).toBeGreaterThanOrEqual(12);
    // Spirit of Eirina enters the arena when charged.
    expect(after.players[0]!.board.map((card) => cardData[card.cardId]?.name)).toContain("Spirit of Eirina");
  });

  it("plays Blessing of Bellona on its opening turn and keeps the attacks", () => {
    const state = createGame({
      decklists: [boltynDeck(), decklists.dorinthea], cards: cardData, scripts, seed: 303, startPlayer: 0,
    });
    hand(state, ["PEN181", "ASB007", "ASB021", "DTD052"]);
    const openingOver = (current: GameState) => current.activePlayer !== 0 || current.turn !== 1;
    const { state: after, intents } = play(settled(state), openingOver);
    expect(intents).toContain("Blessing of Bellona");
    expect(intents).not.toContain("Beaming Bravado");
    expect(intents).not.toContain(RAYDN);
    expect(after.players[0]!.board.map((card) => cardData[card.cardId]?.name)).toContain("Blessing of Bellona");
    expect(after.players[0]!.arsenal).toHaveLength(1);
  });

  it("keeps Lumina Ascension for its own turn even when Spirit of Eirina makes it an instant", () => {
    const state = settled(game());
    hand(state, ["ASB026", "ASB016"]);
    state.players[0]!.board = cards(state, ["DYN066"]);
    state.players[0]!.flags.chargedThisTurn = true;
    let current = underAttack(state, PLAIN_ATTACK);
    const lumina = current.players[0]!.hand[0]!.instanceId;
    let offered = false;
    for (let step = 0; step < 20 && current.activePlayer === 1; step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      if (actor === 0) {
        const observed = input(current);
        const intent = chooseBoltynIntent(observed);
        if (observed.legal.some((candidate) => candidate.kind === "play-card" && candidate.instanceId === lumina)) {
          offered = true;
          expect(intent).not.toMatchObject({ kind: "play-card", instanceId: lumina });
        }
        const result = applyIntent(current, 0, intent);
        if (!result.ok) throw new Error(result.error);
        current = result.state;
      } else {
        const result = applyIntent(current, 1, passOrNoBlock(current));
        if (!result.ok) throw new Error(result.error);
        current = result.state;
      }
    }
    expect(offered, "Lumina was never offered as an instant").toBe(true);
    const held = [...current.players[0]!.hand, ...current.players[0]!.arsenal];
    expect(held.some((card) => card.instanceId === lumina)).toBe(true);
  });

  it("does not spend Fyendal's Spring Tunic blocking a small attack", () => {
    const state = settled(game());
    hand(state, ["ASB021", "ASB016"]);
    const defending = underAttack(state, PLAIN_ATTACK);
    const tunic = defending.players[0]!.equipment.chest!;
    expect(cardData[tunic.cardId]?.name).toBe("Fyendal's Spring Tunic");
    const intent = chooseBoltynIntent(input(defending));
    expect(intent.kind === "stage-defenders" || intent.kind === "defend").toBe(true);
    if (intent.kind === "stage-defenders" || intent.kind === "defend") {
      expect(intent.instanceIds).not.toContain(tunic.instanceId);
    }
  });

  it("charges a yellow card into Helm of Halo's Grace when it blocks", () => {
    const state = settled(game());
    hand(state, ["ASB021", "ASB009"]);
    const [bolt, engulfing] = state.players[0]!.hand;
    const view = projectStateFor(state, 0);
    view.activePlayer = 1;
    view.priorityPlayer = 0;
    view.phase = "defend";
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Helm of Halo's Grace: charge a card, or decline",
      options: ["no", String(bolt!.instanceId), String(engulfing!.instanceId)],
      optionCards: [null, view.players[0].hand[0]!, view.players[0].hand[1]!],
    };
    const legal: GameIntent[] = view.pendingDecision.options!.map((optionId) => ({ kind: "choose", optionId }));
    expect(chooseBoltynIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(bolt!.instanceId) });
  });

  it("banishes one soul card for Beacon of Victory when charged and fetches Spirit of Eirina", () => {
    const state = settled(game());
    hand(state, ["MON033"]);
    soul(state, 3);
    state.players[0]!.flags.chargedThisTurn = true;
    state.players[0]!.flags.chargedCountThisTurn = 1;
    const view = projectStateFor(state, 0);
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Choose a nonzero X to banish from soul",
      options: ["x:1", "x:2", "x:3"],
    };
    expect(chooseBoltynIntent({
      seat: 0, view, legal: ["x:1", "x:2", "x:3"].map((optionId) => ({ kind: "choose", optionId })), cards: cardData,
    })).toEqual({ kind: "choose", optionId: "x:1" });

    const targets = cards(state, ["ASB026", "DYN066", "MON032"]);
    const search = projectStateFor(state, 0);
    search.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "Search for an action card",
      options: targets.map((card) => String(card.instanceId)),
      optionCards: targets,
    };
    expect(chooseBoltynIntent({
      seat: 0,
      view: search,
      legal: targets.map((card) => ({ kind: "choose", optionId: String(card.instanceId) })),
      cards: cardData,
    })).toEqual({ kind: "choose", optionId: String(targets[1]!.instanceId) });
  });

  it("charges a Light setup card into V of the Vanguard before a red attack", () => {
    const state = settled(game());
    hand(state, ["ASB008", "ASB025"]);
    soul(state, 1);
    const [bolt, grace] = state.players[0]!.hand;
    const view = projectStateFor(state, 0);
    view.pendingDecision = {
      player: 0,
      kind: "choose-target",
      prompt: "V of the Vanguard: choose a card from your hand to charge, or stop",
      options: ["no", String(bolt!.instanceId), String(grace!.instanceId)],
      optionCards: [null, view.players[0].hand[0]!, view.players[0].hand[1]!],
    };
    const legal: GameIntent[] = view.pendingDecision.options!.map((optionId) => ({ kind: "choose", optionId }));
    expect(chooseBoltynIntent({ seat: 0, view, legal, cards: cardData }))
      .toEqual({ kind: "choose", optionId: String(grace!.instanceId) });
  });

  it("blocks when the Soulbond stance faces lethal pressure and plays its defense reactions", () => {
    const cindraPool = precon("bot-cindra-head-jabs")!.pool;
    const state = createGame({
      decklists: [boltynDeck(cindraPool.heroId), decklists.dorinthea],
      cards: cardData,
      scripts,
      seed: 505,
      startPlayer: 1,
    });
    state.turn = 4;
    expect(cardData[state.players[0]!.equipment.chest!.cardId]?.name).toBe("Soulbond Resolve");
    hand(state, ["ASB025", "ASB021", "ASB009", "ASB016"]);
    state.players[0]!.life = 4;
    let current = underAttack(state, PLAIN_ATTACK);
    const played: string[] = [];
    for (let step = 0; step < 24 && current.chain.some((link) => !link.resolved); step++) {
      const actor = (current.pendingDecision?.player ?? current.priorityPlayer) as 0 | 1;
      const intent = actor === 0 ? chooseBoltynIntent(input(current)) : passOrNoBlock(current);
      if (actor === 0) played.push(name(current, intent));
      const result = applyIntent(current, actor, intent);
      if (!result.ok) throw new Error(result.error);
      current = result.state;
    }
    // Four damage at four life is stopped by blocks or defense reactions.
    expect(current.players[0]!.life).toBeGreaterThan(0);
    expect(played.some((entry) =>
      entry.startsWith("defend(") || entry === "Saving Grace" || entry === "Sink Below"
    )).toBe(true);
  });
});
