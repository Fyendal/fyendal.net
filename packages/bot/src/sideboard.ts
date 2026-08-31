import { cardData, precon } from "@fyendal/cards";
import type { CardData, Decklist, EquipmentSlot, PresentedDeck } from "@fyendal/shared";
import { briarMatchupForHeroName } from "./briar-strategy.js";

const BRIAR_BOT_DECK_ID = "bot-briar-broccoli";
const BRAVO_BOT_DECK_ID = "bot-bravo-flarvo";
const CINDRA_BOT_DECK_ID = "bot-cindra-head-jabs";
const HALA_MASTERCLASS_PRECON_ID = "precon-hala-masterclass";
const IRA_PRECON_ID = "precon-asr";
const JARL_BOT_DECK_ID = "bot-jarl";

const BRAVO_ARCANE_POLARITY = ["SBA030", "SBA030"];
const BRAVO_RED_CHOKESLAM = ["SBR016", "SBR016"];
const BRAVO_OASIS = ["SLY019", "SLY019"];
const BRAVO_PUMMEL = ["SBR020", "SBR020"];
const BRAVO_STAUNCH = ["SBR021", "SBR021"];
const BRAVO_CLASH_OF_HEADS = "MPG047";

const CINDRA_DREACTS = [
  "PEN321", "PEN321", "PEN321",
  "ANQ034", "ANQ034", "ANQ034",
];
const CINDRA_WARMONGERS = ["DTD230", "DTD230"];
const CINDRA_HUNTSMAN_CARDS = ["GEM015", "GEM015", "GEM015", "SUP216"];

type CindraMatchup =
  | "arakni-marionette"
  | "oscilio"
  | "gravy"
  | "vynnset"
  | "warrior"
  | "marlynn"
  | "cindra"
  | "huntsman"
  | "katsu"
  | "dorinthea"
  | "dash-io"
  | "boltyn"
  | "stock";

type BravoMatchup =
  | "blaze"
  | "bravo"
  | "briar"
  | "dromai"
  | "enigma"
  | "fai"
  | "iyslander"
  | "oldhim"
  | "olympia"
  | "oscilio"
  | "default";

type JarlMatchup =
  | "arakni-huntsman"
  | "arakni-marionette"
  | "aurora"
  | "cindra"
  | "dash-io"
  | "dorinthea"
  | "fai"
  | "fang"
  | "gravy"
  | "guardian"
  | "ira"
  | "jarl"
  | "kassai"
  | "kayo"
  | "marlynn"
  | "oscilio"
  | "rhinar"
  | "vynnset"
  | "default";

const JARL_FLEX_IDS = new Set([
  "AJV017", // Channel Mount Isen (blue)
  "WTR161", // Last Ditch Effort (blue)
  "AJV011", // Mangle (red)
  "HNT231", // Sigil of Solace (red)
  "SBR021", // Staunch Response (red)
]);

const JARL_MANGLE = ["AJV011", "AJV011"];
const JARL_LAST_DITCH = ["WTR161", "WTR161"];

const HALA_FLEX_IDS = new Set([
  "MPW076", // Big Blinder (red)
  "MPW126", // Showdown (red)
  "MPW130", // Swordmaster's Path (red)
  "MST192", // The Weakest Link (red)
  "PEN321", // Shelter from the Storm (red)
  "ASB016", // Sink Below (red)
  "MPW089", // Slice Up (red)
  "PEN049", // Blunten (yellow)
]);

const HALA_ASSERTIVE_PACKAGE = [
  "MPW076",
  "MPW126", "MPW126",
  "MPW130", "MPW130", "MPW130",
  "MST192", "MST192",
];

const HALA_DEFENSIVE_PACKAGE = [
  "PEN321", "PEN321", "PEN321",
  "ASB016", "ASB016", "ASB016",
];

function opponentHeroName(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): string {
  return cards[opponent.heroId]?.name.trim().toLowerCase() ?? "";
}

function briarMatchupFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): ReturnType<typeof briarMatchupForHeroName> {
  return briarMatchupForHeroName(opponentHeroName(opponent, cards));
}

function removeCopies(deck: string[], cardId: string, count: number): void {
  for (let copy = 0; copy < count; copy++) {
    const index = deck.indexOf(cardId);
    if (index < 0) throw new Error(`Matchup is missing ${cardId}`);
    deck.splice(index, 1);
  }
}

function swapCards(
  deck: string[],
  removals: readonly [cardId: string, count: number][],
  additions: readonly string[],
): void {
  for (const [cardId, count] of removals) removeCopies(deck, cardId, count);
  deck.push(...additions);
}

/**
 * Present the published Broccoli Briar list for the opponent hero. The source
 * has separate mirror plans for Briar going first and second; all other known
 * branches are selected solely by opponent hero.
 * Source: https://fabrary.net/decks/01KSQ4VJB4J94KJYYWCPMY996H
 */
export function briarPresentationFor(
  opponent: Decklist,
  turnOrder: "first" | "second" = "first",
  cards: Readonly<Record<string, CardData>> = cardData,
): PresentedDeck {
  const registered = precon(BRIAR_BOT_DECK_ID);
  if (!registered || registered.format !== "silver-age" || registered.botOnly !== true) {
    throw new Error("Briar bot deck is not registered");
  }
  const matchup = briarMatchupFor(opponent, cards);
  const deck = [...registered.pool.deck];

  if (matchup === "ninja") {
    swapCards(deck, [["SBA013", 1], ["SBA032", 1]], ["SBA023", "SBA023"]);
  } else if (matchup === "fatigue" || matchup === "enigma") {
    swapCards(deck, [["SBA033", 1], ["SBA020", 2]], ["ELE119", "ELE119", "OMN085"]);
  } else if (matchup === "wizard") {
    swapCards(deck, [["OMN085", 1], ["IRA009", 1]], ["SBA031", "SBA031"]);
  } else if (matchup === "dominate") {
    swapCards(deck, [
      ["SBA013", 1], ["SEA201", 1], ["SBA033", 1], ["OMN085", 1],
    ], ["SBA031", "SBA031", "SBA023", "SBA023"]);
  } else if (matchup === "briar" && turnOrder === "first") {
    swapCards(deck, [["SBA013", 2]], ["SBA023", "SBA023"]);
  } else if (matchup === "briar") {
    swapCards(deck, [["OMN085", 1]], ["SBA023"]);
  } else if (matchup === "iyslander") {
    swapCards(deck, [["SBA033", 1], ["IRA009", 2]], ["SBA031", "SBA031", "OMN085"]);
  }

  if (deck.length !== 40) {
    throw new Error(`Briar matchup presentation has ${deck.length} cards, expected 40`);
  }

  const magicHelm = ["wizard", "runeblade", "dromai", "briar", "iyslander"].includes(matchup);
  const swiftstrike = ["fatigue", "wizard", "runeblade", "dromai", "enigma"].includes(matchup);
  const nullrune = matchup === "wizard" || matchup === "iyslander";
  const equipment: Partial<Record<EquipmentSlot, string>> = {
    head: magicHelm ? "PEN093" : "SLY005",
    chest: "SBL005",
    arms: swiftstrike ? "SBA008" : "SBA007",
    legs: nullrune ? "SBL010" : "SBA009",
  };
  return { weaponIds: ["SBA003"], equipment, deck };
}

function cindraMatchupFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): CindraMatchup {
  const name = opponentHeroName(opponent, cards);
  if (name.includes("arakni, marionette")) return "arakni-marionette";
  if (name.includes("oscilio")) return "oscilio";
  if (name.includes("gravy bones")) return "gravy";
  if (name.includes("vynnset")) return "vynnset";
  if (name.includes("kassai") || name.includes("hala")) return "warrior";
  if (name.includes("marlynn")) return "marlynn";
  if (name.includes("cindra")) return "cindra";
  if (name.includes("arakni, huntsman")) return "huntsman";
  if (name.includes("katsu")) return "katsu";
  if (name.includes("dorinthea")) return "dorinthea";
  if (name.includes("dash i/o") || name.includes("dash io")) return "dash-io";
  if (name.includes("boltyn")) return "boltyn";
  return "stock";
}

function swapCindraCards(
  deck: string[],
  removals: readonly [cardId: string, count: number][],
  additions: readonly string[],
): void {
  for (const [cardId, count] of removals) removeCopies(deck, cardId, count);
  deck.push(...additions);
}

/**
 * Present Art of the Dragon: Head Jab using its published Fabrary matchup
 * plans. Unknown heroes retain the source deck's stock sixty and global
 * second-player preference.
 * Source: https://fabrary.net/decks/01KPKJKVM3ZRYQE7N6KZJS24CT
 */
export function cindraPresentationFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>> = cardData,
): PresentedDeck {
  const registered = precon(CINDRA_BOT_DECK_ID);
  if (!registered || registered.format !== "cc" || registered.botOnly !== true) {
    throw new Error("Cindra bot deck is not registered");
  }
  const matchup = cindraMatchupFor(opponent, cards);
  const deck = [...registered.pool.deck];

  if (matchup === "arakni-marionette") {
    swapCindraCards(deck, [
      ["UPR093", 2], ["GEM011", 3], ["OMN245", 3], ["GEM014", 2],
    ], [...CINDRA_HUNTSMAN_CARDS, ...CINDRA_DREACTS]);
  } else if (matchup === "oscilio" || matchup === "cindra" || matchup === "katsu" || matchup === "boltyn") {
    swapCindraCards(deck, [["UPR093", 1], ["GEM011", 3], ["GEM014", 2]], CINDRA_DREACTS);
  } else if (matchup === "dorinthea") {
    swapCindraCards(deck, [
      ["UPR093", 1], ["GEM011", 3], ["GEM014", 2], ["UPR098", 2],
    ], [...CINDRA_DREACTS, ...CINDRA_WARMONGERS]);
  } else if (matchup === "dash-io") {
    swapCindraCards(deck, [
      ["UPR093", 2], ["GEM011", 3], ["GEM014", 2], ["UPR098", 1],
    ], [...CINDRA_DREACTS, ...CINDRA_WARMONGERS]);
  } else if (
    matchup === "gravy" || matchup === "vynnset" || matchup === "warrior" || matchup === "marlynn"
  ) {
    swapCindraCards(deck, [["UPR098", 2]], CINDRA_WARMONGERS);
  } else if (matchup === "huntsman") {
    deck.push(...CINDRA_HUNTSMAN_CARDS);
  }

  const furnace = matchup === "arakni-marionette" || matchup === "oscilio" ||
    matchup === "cindra" || matchup === "katsu" || matchup === "dorinthea" ||
    matchup === "dash-io" || matchup === "boltyn";
  const claw = matchup === "oscilio" || matchup === "vynnset";
  return {
    weaponIds: claw ? ["GEM003", "SEA257"] : ["GEM003", "GEM003"],
    equipment: {
      head: "WTR079",
      chest: furnace ? "UPR084" : "HNT168",
      arms: "SUP244",
      legs: "HNT143",
    },
    deck,
  };
}

function jarlMatchupFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): JarlMatchup {
  const name = opponentHeroName(opponent, cards);
  const classes = cards[opponent.heroId]?.classes?.map((value) => value.toLowerCase()) ?? [];
  if (name.includes("arakni, huntsman")) return "arakni-huntsman";
  if (name.includes("arakni, marionette")) return "arakni-marionette";
  if (name.includes("aurora")) return "aurora";
  if (name.includes("cindra")) return "cindra";
  if (name.includes("dash i/o") || name.includes("dash io")) return "dash-io";
  if (name.includes("dorinthea")) return "dorinthea";
  if (name.includes("fai")) return "fai";
  if (name.includes("fang")) return "fang";
  if (name.includes("gravy bones")) return "gravy";
  if (name.includes("ira")) return "ira";
  if (name.includes("jarl")) return "jarl";
  if (name.includes("kassai")) return "kassai";
  if (name.includes("kayo")) return "kayo";
  if (name.includes("marlynn")) return "marlynn";
  if (name.includes("oscilio")) return "oscilio";
  if (name.includes("rhinar")) return "rhinar";
  if (name.includes("vynnset")) return "vynnset";
  if (classes.includes("guardian")) return "guardian";
  return "default";
}

function jarlPhysicalEquipment(): Partial<Record<EquipmentSlot, string>> {
  return {
    head: "PEN310",
    chest: "ROS028",
    arms: "AJV006",
    legs: "OMN204",
  };
}

function jarlArcaneEquipment(): Partial<Record<EquipmentSlot, string>> {
  return {
    head: "PEN215",
    chest: "ELE144",
    arms: "AJV006",
    legs: "SBL010",
  };
}

/**
 * Present the supplied Jarl Fabrary pool using each published matchup's main
 * deck quantities. The Fabrary guide declares no turn-order preference and
 * exposes the full arena pool rather than one equipment loadout, so the bot
 * uses Barkskin for physical games and the registered AB package for arcane
 * heroes. Unknown opponents get the guide's sixty-card Guardian branch.
 * Source: https://fabrary.net/decks/01M0K4BKRHN7J89ZSB6XGDHRSH
 */
export function jarlPresentationFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>> = cardData,
): PresentedDeck {
  const registered = precon(JARL_BOT_DECK_ID);
  if (!registered || registered.format !== "cc" || registered.botOnly !== true) {
    throw new Error("Jarl bot deck is not registered");
  }
  const matchup = jarlMatchupFor(opponent, cards);
  const allCards = [...registered.pool.deck, ...(registered.pool.sideboard ?? [])];
  const deck = allCards.filter((id) => !JARL_FLEX_IDS.has(id));
  if (deck.length !== 59) {
    throw new Error(`Jarl source main has ${deck.length} cards, expected 59`);
  }

  if (matchup === "arakni-huntsman") {
    deck.push("AJV017", ...JARL_LAST_DITCH, "AJV011", "AJV011", "AJV011", "HNT231", "HNT231");
  } else if (matchup === "arakni-marionette") {
    removeCopies(deck, "PEN321", 1);
    deck.push(...JARL_LAST_DITCH);
  } else if (matchup === "oscilio") {
    removeCopies(deck, "ROS042", 3);
    removeCopies(deck, "PEN321", 1);
    deck.push("AJV017", ...JARL_LAST_DITCH, ...JARL_MANGLE);
  } else if (matchup === "marlynn") {
    removeCopies(deck, "ELE147", 1);
    deck.push("SBR021", "SBR021");
  } else if (matchup === "jarl") {
    deck.push("AJV017", ...JARL_LAST_DITCH, "AJV011", "AJV011", "AJV011");
  } else if (matchup === "gravy" || matchup === "rhinar" || matchup === "vynnset") {
    deck.push(...JARL_MANGLE);
  } else {
    removeCopies(deck, "PEN321", 1);
    deck.push(...JARL_MANGLE);
  }

  const arcane = matchup === "aurora" || matchup === "oscilio" || matchup === "vynnset";
  return {
    weaponIds: ["SLY002", "EVR018"],
    equipment: arcane ? jarlArcaneEquipment() : jarlPhysicalEquipment(),
    deck,
  };
}

function bravoMatchupFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): BravoMatchup {
  const name = opponentHeroName(opponent, cards);
  if (name.includes("blaze")) return "blaze";
  if (name.includes("bravo, flattering")) return "bravo";
  if (name.includes("briar")) return "briar";
  if (name.includes("dromai")) return "dromai";
  if (name.includes("enigma")) return "enigma";
  if (name.includes("fai")) return "fai";
  if (name.includes("iyslander")) return "iyslander";
  if (name.includes("oldhim")) return "oldhim";
  if (name.includes("olympia")) return "olympia";
  if (name.includes("oscilio")) return "oscilio";
  return "default";
}

function bravoPhysicalEquipment(): Partial<Record<EquipmentSlot, string>> {
  return {
    head: "SLY005",
    chest: "SBR007",
    arms: "SBA007",
    legs: "TCC033",
  };
}

function bravoArcaneEquipment(): Partial<Record<EquipmentSlot, string>> {
  return {
    head: "SBR006",
    chest: "SBR007",
    arms: "SGB006",
    legs: "SBL010",
  };
}

/**
 * Trichr0matic's Skirmish Season 15 Bravo list, including the published
 * matchup-specific forty and equipment. Unknown heroes use the guide's common
 * proactive package (red Chokeslams and Pummels).
 * Source: https://fabrary.net/decks/01KZKV4909PJJ6PNK8PJQRY630
 */
export function bravoPresentationFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>> = cardData,
): PresentedDeck {
  const registered = precon(BRAVO_BOT_DECK_ID);
  if (!registered || registered.format !== "silver-age" || registered.botOnly !== true) {
    throw new Error("Bravo bot deck is not registered");
  }
  const matchup = bravoMatchupFor(opponent, cards);
  let deck = [...registered.pool.deck];
  let additions: string[];

  if (matchup === "blaze" || matchup === "iyslander") {
    deck = deck.filter((id) => id !== "SBR017");
    additions = [...BRAVO_ARCANE_POLARITY, ...BRAVO_OASIS, ...BRAVO_PUMMEL];
  } else if (matchup === "bravo") {
    additions = [...BRAVO_PUMMEL, ...BRAVO_STAUNCH];
  } else if (matchup === "briar") {
    additions = [...BRAVO_ARCANE_POLARITY, ...BRAVO_RED_CHOKESLAM];
  } else if (matchup === "oldhim" || matchup === "olympia") {
    deck = deck.filter((id) => id !== BRAVO_CLASH_OF_HEADS);
    additions = [...BRAVO_RED_CHOKESLAM, ...BRAVO_PUMMEL, ...BRAVO_STAUNCH];
  } else if (matchup === "oscilio") {
    deck = deck.filter((id) => id !== BRAVO_CLASH_OF_HEADS);
    additions = [...BRAVO_ARCANE_POLARITY, ...BRAVO_OASIS, ...BRAVO_PUMMEL];
  } else {
    additions = [...BRAVO_RED_CHOKESLAM, ...BRAVO_PUMMEL];
  }
  deck.push(...additions);
  if (deck.length !== 40) {
    throw new Error(`Bravo matchup presentation has ${deck.length} cards, expected 40`);
  }

  const arcaneEquipment = matchup === "blaze" || matchup === "iyslander" || matchup === "oscilio";
  const briarEquipment = matchup === "briar";
  return {
    weaponIds: ["SLY002", "SBR004"],
    equipment: arcaneEquipment
      ? bravoArcaneEquipment()
      : briarEquipment
      ? { ...bravoPhysicalEquipment(), head: "SBR006" }
      : bravoPhysicalEquipment(),
    deck,
  };
}

function opponentHasAttackActions(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>>,
): boolean {
  return opponent.deck.some((id) => {
    const card = cards[id];
    return card?.cardType === "action" && card.subtypes?.includes("attack");
  });
}

/**
 * Present Yuki Lee Bender's Hala Masterclass pool using the article's public
 * matchup packages. The registered sixty is the proactive default; the
 * eleven-card sideboard completes the defensive Cindra, Arakni, Warrior, and
 * fatigue configurations described in the guide.
 * Source: https://fabtcg.com/articles/masterclass-hala/
 * Deck setup: https://fabrary.net/decks/01M0EVE7YR9FCMQQCE438QF3E8
 */
export function halaPresentationFor(
  opponent: Decklist,
  cards: Readonly<Record<string, CardData>> = cardData,
): PresentedDeck {
  const registered = precon(HALA_MASTERCLASS_PRECON_ID);
  if (!registered || registered.format !== "cc") {
    throw new Error("Hala Masterclass precon is not registered");
  }
  const pool = registered.pool;
  const allCards = [...pool.deck, ...(pool.sideboard ?? [])];
  let core = allCards.filter((id) => !HALA_FLEX_IDS.has(id));
  if (core.length !== 52) {
    throw new Error(`Hala Masterclass core has ${core.length} cards, expected 52`);
  }

  const heroName = opponentHeroName(opponent, cards);
  const opponentHero = cards[opponent.heroId];
  const warrior = opponentHero?.classes?.some((value) => value.toLowerCase() === "warrior") === true;
  const arakniMarionette = heroName.includes("arakni, marionette");
  const cindra = heroName.includes("cindra");
  const oscilio = heroName.includes("oscilio");
  const fatigue = heroName.includes("jarl") || heroName.includes("betsy") ||
    heroName.includes("arakni, huntsman");

  let matchup: string[];
  if (arakniMarionette) {
    // The published package cuts one Point of Escalation to present sixty.
    const point = core.indexOf("MPW025");
    if (point >= 0) core = core.filter((_, index) => index !== point);
    matchup = [
      ...HALA_DEFENSIVE_PACKAGE,
      "PEN049", "PEN049", "PEN049",
    ];
  } else if (cindra) {
    matchup = [
      ...HALA_DEFENSIVE_PACKAGE,
      "MPW089", "MPW089",
    ];
  } else if (warrior) {
    matchup = [
      ...HALA_DEFENSIVE_PACKAGE,
      "MPW130", "MPW130", "MPW130",
      "PEN049", "PEN049", "PEN049",
    ];
  } else if (fatigue) {
    matchup = [
      ...HALA_ASSERTIVE_PACKAGE,
      ...HALA_DEFENSIVE_PACKAGE,
      "PEN049", "PEN049", "PEN049",
    ];
  } else if (oscilio && opponentHasAttackActions(opponent, cards)) {
    matchup = [
      "MST192", "MST192",
      "MPW089", "MPW089",
      "MPW126", "MPW126",
      "MPW130", "MPW130",
    ];
  } else {
    matchup = [...HALA_ASSERTIVE_PACKAGE];
  }

  const allArcaneOscilio = oscilio && !opponentHasAttackActions(opponent, cards);
  const aurora = heroName.includes("aurora");
  const vynnset = heroName.includes("vynnset");
  const equipment: Partial<Record<EquipmentSlot, string>> = {
    head: warrior && !heroName.includes("olympia")
      ? "HNT115"
      : allArcaneOscilio || aurora || vynnset
      ? "ARC155"
      : "PEN310",
    chest: allArcaneOscilio ? "ARC156" : "MPW010",
    arms: "AHA005",
    legs: allArcaneOscilio ? "ARC158" : "MPW012",
  };
  return {
    weaponIds: ["MPW005"],
    equipment,
    deck: [...core, ...matchup],
  };
}

/** Ira's Armory Deck is an exact sixty with one fixed piece in each slot. */
export function iraPresentation(): PresentedDeck {
  const registered = precon(IRA_PRECON_ID);
  if (!registered || registered.format !== "cc") {
    throw new Error("Ira precon is not registered");
  }
  const [head, chest, arms, legs] = registered.pool.equipmentPool;
  if (!head || !chest || !arms || !legs || registered.pool.deck.length !== 60) {
    throw new Error("Ira precon does not have its expected fixed presentation");
  }
  return {
    weaponIds: [...registered.pool.weaponIds],
    equipment: { head, chest, arms, legs },
    deck: [...registered.pool.deck],
  };
}
