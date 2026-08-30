import { describe, expect, it } from "vitest";
import type { CardData } from "@fyendal/shared";
import { cardData, formatLegalityIssues } from "@fyendal/cards";
import {
  deleteDeck,
  importDeck,
  listDecks,
  parseDecklistText,
  resolveFreshDeck,
  updateDeck,
  validateDeck,
  validatePresentation,
} from "../decks.js";
import { register } from "../auth.js";
import { freshDb } from "./testdb.js";

const printings = Object.values(cardData) as CardData[];
const hero = printings.find((c) => c.cardType === "hero" && c.name.includes("Rhinar"))!;
const weapon = printings.find((c) => c.cardType === "weapon")!;
const chest = printings.find((c) => c.cardType === "equipment" && c.subtypes?.includes("chest"))!;
const deckCards = printings.filter(
  (c) => !["hero", "weapon", "equipment", "token"].includes(c.cardType),
);
const legalCcDeckCards = deckCards.filter((candidate) =>
  formatLegalityIssues(
    cardData,
    { heroId: hero.id, weaponIds: [], equipmentPool: [], deck: [candidate.id], sideboard: [] },
    "cc",
  ).length === 0,
);

it("does not expose internal bot decks through player deck resolution", async () => {
  const db = await freshDb();
  for (const id of [
    "bot-briar-broccoli",
    "bot-bravo-flarvo",
    "bot-cindra-head-jabs",
    "precon-hala-masterclass",
    "bot-jarl",
  ]) {
    const result = await resolveFreshDeck(db, 1, id, {
      fetchDeck: async () => { throw new Error("should not fetch"); },
    });
    expect(result).toEqual({ ok: false, status: 404, error: "deck not found" });
  }
  await (db as unknown as { end(): Promise<void> }).end();
});

function deckLine(card: CardData, qty = 3): string {
  return `${qty}x ${card.name}${card.pitch ? ` (${card.pitch})` : ""}`;
}

/** Build a valid cc-sized export text (3x the first 20 pool cards = 60). */
function ccExportText(): string {
  const lines = [`Hero: ${hero.name}`, "", `1x ${weapon.name}`, `1x ${chest.name}`, ""];
  for (const c of legalCcDeckCards.slice(0, 20)) lines.push(deckLine(c));
  return lines.join("\n");
}

const vMaxFabraryExport = [
  "Name: V Max",
  "Hero: Dash I/O",
  "Format: Classic Constructed",
  "",
  "Arena cards",
  "1x Achilles Accelerator",
  "1x Adaptive Plating",
  "1x Cogwerx Tinker Rings",
  "1x Crown of Providence",
  "1x Goliath Gauntlet",
  "1x Symbiosis Shot",
  "1x Teklo Foundry Heart",
  "1x Viziertronic Model i",
  "",
  "Deck cards",
  "2x Backup Protocol: RED (red)",
  "3x Bios Update (red)",
  "3x Boom Grenade (red)",
  "3x Fast and Furious (red)",
  "3x Heist (red)",
  "3x Maximum Velocity (red)",
  "3x MetEx (red)",
  "3x Out Pace (red)",
  "3x Pulsewave Harpoon (red)",
  "3x Sprocket Rocket (red)",
  "2x Throttle (red)",
  "3x Twin Drive (red)",
  "3x Zero to Sixty (red)",
  "3x Zipper Hit (red)",
  "3x Boom Grenade (yellow)",
  "3x Spark of Genius (yellow)",
  "3x Zipper Hit (yellow)",
  "3x Cerebellum Processor (blue)",
  "3x Expedite (blue)",
  "1x Hyper Scrapper (blue)",
  "1x Null Time Zone (blue)",
  "3x Teklo Core (blue)",
  "3x Teklo Pounder (blue)",
  "3x Teklo Trebuchet 2000 (blue)",
  "3x Throttle (blue)",
  "3x Zero to Sixty (blue)",
  "",
  "Made with love at the FaBrary",
  "See the full deck @ https://fabrary.net/decks/01KS63D39R66WR68WPZ5ANRS78",
].join("\n");

const teklovossenFabraryExport = [
  "Name: Calling: Las Vegas 5th 🇺🇸",
  "Hero: Teklovossen, Esteemed Magnate",
  "Format: Classic Constructed",
  "",
  "Arena cards",
  "1x Adaptive Alpha Mold",
  "1x Adaptive Dissolver",
  "1x Cogwerx Base Chest",
  "1x Cogwerx Base Legs",
  "1x Synapse Sparkcap",
  "1x Teklo Foundry Heart",
  "1x Teklo Leveler",
  "",
  "Deck cards",
  "3x Blast Rig (red)",
  "2x Fabricate (red)",
  "3x Firewall (red)",
  "2x Ghost Protocol: Architect (red)",
  "3x Heavy Metal Hardcore (red)",
  "2x Maximum Velocity (red)",
  "3x Pulsewave Harpoon (red)",
  "1x Singularity (red)",
  "3x T-Bone (red)",
  "3x Terminator Tank (red)",
  "3x Twin Drive (red)",
  "2x War Machine (red)",
  "3x Zero to Sixty (red)",
  "2x Zipper Hit (red)",
  "2x Arcbane Grasp (blue)",
  "3x Evo Beta Base Arms (blue)",
  "2x Evo Beta Base Chest (blue)",
  "2x Evo Beta Base Head (blue)",
  "3x Evo Beta Base Legs (blue)",
  "1x Evo Recall (blue)",
  "1x Evo Speedslip (blue)",
  "3x Evo Steel Soul Controller (blue)",
  "3x Evo Steel Soul Memory (blue)",
  "3x Evo Steel Soul Processor (blue)",
  "3x Evo Steel Soul Tower (blue)",
  "3x Ghost Protocol: Mainframe (blue)",
  "3x Steel Street Enforcement (blue)",
  "2x T-Bone (blue)",
  "3x Teklo Trebuchet 2000 (blue)",
  "",
  "Made with love at the FaBrary",
  "See the full deck @ https://fabrary.net/decks/01KXY7MM2X13V9PX2D6Z8YP9HB",
].join("\n");

describe("parseDecklistText", () => {
  it("parses quantities, pitch suffixes and section headers", () => {
    const lines = parseDecklistText(
      [
        "# comment",
        "Hero: Rhinar, Reckless Rampage",
        "",
        "Deck:",
        "3x Awakening Bellow (red)",
        "2 Pack Hunt",
        "Sideboard:",
        "1x En Garde (1)",
      ].join("\n"),
    );
    expect(lines).toEqual([
      { qty: 1, name: "Rhinar, Reckless Rampage", pitch: undefined, section: "hero" },
      { qty: 3, name: "Awakening Bellow", pitch: 1, section: "deck" },
      { qty: 2, name: "Pack Hunt", pitch: undefined, section: "deck" },
      { qty: 1, name: "En Garde", pitch: 1, section: "sideboard" },
    ]);
  });

  it("maps yellow/blue/purple pitch words", () => {
    const [y, b, p] = parseDecklistText(
      "1x Foo (yellow)\n1x Bar (blue)\n1x Soul of Existence (purple)",
    );
    expect(y!.pitch).toBe(2);
    expect(b!.pitch).toBe(3);
    expect(p).toEqual({
      qty: 1,
      name: "Soul of Existence",
      pitch: 4,
      section: "deck",
    });
  });

  it("recognizes current Fabrary headings and ignores export metadata and footer", () => {
    const lines = parseDecklistText(
      [
        "Name: Example deck",
        "Hero: Dash I/O",
        "Format: Classic Constructed",
        "",
        "Arena cards",
        "1x Adaptive Plating",
        "",
        "Deck cards",
        "3x Zipper Hit (red)",
        "",
        "Made with love at the FaBrary",
        "See the full deck @ https://fabrary.net/decks/01EXAMPLE",
      ].join("\n"),
    );

    expect(lines).toEqual([
      { qty: 1, name: "Dash I/O", section: "hero" },
      { qty: 1, name: "Adaptive Plating", pitch: undefined, section: "deck" },
      { qty: 3, name: "Zipper Hit", pitch: 1, section: "deck" },
    ]);
  });

  it("clamps absurd line quantities instead of expanding them", () => {
    // "999999999x …" must not expand into ~1e9 array pushes downstream
    const lines = parseDecklistText(`999999999x ${deckCards[0]!.name}`);
    expect(lines[0]!.qty).toBe(99);
    // …and the deck is still rejected by the copies limit
    const r = validateDeck(lines, "cc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("too many copies"))).toBe(true);
  });
});

describe("validateDeck", () => {
  it("imports the current Fabrary V Max export", () => {
    const r = validateDeck(parseDecklistText(vMaxFabraryExport), "cc");

    expect(r).toMatchObject({ ok: true, heroName: "Dash I/O" });
    if (!r.ok) return;
    expect(r.decklist.equipmentPool.map((id) => cardData[id]!.name)).toContain("Adaptive Plating");
    expect(
      r.decklist.weaponIds.length + r.decklist.equipmentPool.length +
      r.decklist.deck.length + (r.decklist.sideboard?.length ?? 0),
    ).toBe(80);
  });

  it("imports pitched Evo equipment as main-deck cards", () => {
    const r = validateDeck(parseDecklistText(teklovossenFabraryExport), "cc");

    expect(r).toMatchObject({ ok: true, heroName: "Teklovossen, Esteemed Magnate" });
    if (!r.ok) return;
    expect(r.decklist.deck).toHaveLength(72);
    expect(r.decklist.equipmentPool).toHaveLength(6);
    expect(r.decklist.weaponIds).toHaveLength(1);
    expect(r.decklist.deck.map((id) => cardData[id]!.name)).toContain("Evo Steel Soul Memory");
    expect(r.decklist.equipmentPool.map((id) => cardData[id]!.name)).not.toContain("Evo Steel Soul Memory");
  });

  it("accepts a legal cc deck and classifies cards by type", () => {
    const r = validateDeck(parseDecklistText(ccExportText()), "cc");
    expect(r).toMatchObject({ ok: true, heroName: hero.name });
    if (!r.ok) return;
    expect(r.decklist.heroId).toBe(hero.id);
    expect(r.decklist.weaponIds).toEqual([weapon.id]);
    expect(r.decklist.equipmentPool).toEqual([chest.id]);
    expect(r.decklist.deck).toHaveLength(60);
  });

  it("imports red and blue Darkest Hour as distinct pitch variants", () => {
    const filler = legalCcDeckCards
      .filter((card) => card.name !== "Darkest Hour")
      .slice(0, 18)
      .map((card) => deckLine(card));
    const text = [
      "Hero: Malice, Domina of the Dead",
      "3x Darkest Hour (red)",
      "3x Darkest Hour (blue)",
      ...filler,
    ].join("\n");

    const r = validateDeck(parseDecklistText(text), "cc");

    expect(r).toMatchObject({ ok: true, heroName: "Malice, Domina of the Dead" });
    if (!r.ok) return;
    expect(r.decklist.deck.filter((id) => id === "IAR209")).toHaveLength(3);
    expect(r.decklist.deck.filter((id) => id === "IAR211")).toHaveLength(3);
  });

  it("counts the sideboard toward the minimum pool size", () => {
    // silver-age min is 40: 30 main + 10 sideboard is registrable
    const main = deckCards.slice(0, 10).map((c) => deckLine(c));
    const side = ["Sideboard:", ...deckCards.slice(10, 14).map((c, i) => deckLine(c, i === 3 ? 1 : 3))];
    const lines = parseDecklistText([`Hero: ${hero.name}`, ...main, ...side].join("\n"));
    const r = validateDeck(lines, "silver-age");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.deck).toHaveLength(30);
    expect(r.decklist.sideboard).toHaveLength(10);
  });

  it("rejects pools over the format maximum", () => {
    // cc max pool is 80: 84 main-deck cards + weapon + chest = 86
    const lines = parseDecklistText(
      [
        `Hero: ${hero.name}`,
        `1x ${weapon.name}`,
        `1x ${chest.name}`,
        ...deckCards.slice(0, 28).map((c) => deckLine(c)),
      ].join("\n"),
    );
    const r = validateDeck(lines, "cc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("too large"))).toBe(true);
  });

  it("allows multiple weapons and equipment per slot in the registered pool", () => {
    const weapons = printings.filter((c) => c.cardType === "weapon");
    const heads = printings.filter((c) => c.cardType === "equipment" && c.subtypes?.includes("head"));
    const lines = parseDecklistText(
      [
        `Hero: ${hero.name}`,
        `2x ${weapons[0]!.name}`,
        `1x ${weapons[1]!.name}`,
        ...heads.slice(0, 2).map((c) => `1x ${c.name}`),
        ...deckCards.slice(0, 20).map((c) => deckLine(c)),
      ].join("\n"),
    );
    const r = validateDeck(lines, "cc");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.weaponIds).toHaveLength(3);
    expect(r.decklist.equipmentPool).toHaveLength(2);
  });

  it("registers off-hand equipment in the weapon slots (CR)", () => {
    const offhand = printings.find(
      (c) => c.cardType === "equipment" && c.subtypes?.includes("off-hand"),
    )!;
    const lines = parseDecklistText(
      [
        `Hero: ${hero.name}`,
        `1x ${offhand.name}`,
        ...deckCards.slice(0, 20).map((c) => deckLine(c)),
      ].join("\n"),
    );
    const r = validateDeck(lines, "cc");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.weaponIds).toEqual([offhand.id]);
    expect(r.decklist.equipmentPool).toEqual([]);
  });

  it("registers Modular cards as equipment without a fixed slot subtype", () => {
    const adaptivePlating = printings.find((c) => c.name === "Adaptive Plating")!;
    const lines = parseDecklistText(
      [
        `Hero: ${hero.name}`,
        `1x ${adaptivePlating.name}`,
        ...legalCcDeckCards.slice(0, 20).map((c) => deckLine(c)),
      ].join("\n"),
    );

    const r = validateDeck(lines, "cc");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.equipmentPool).toEqual([adaptivePlating.id]);
  });

  it("imports the Lyath Goldmane Silver Age precon decklist (fabtcg.com)", () => {
    // https://fabtcg.com/decklists/silver-age-chapter-3-lyath-goldmane/
    const text = [
      "1x Lyath Goldmane",
      "1x Arcane Lantern",
      "1x Blade Beckoner Helm",
      "1x Blade Beckoner Plating",
      "1x Line Crossers",
      "1x Nullrune Hood",
      "1x Nullrune Robe",
      "1x Stand Strong",
      "1x Stonewall Impasse",
      "1x Titan's Fist",
      "2x Act of Glory (red)",
      "2x Drag Down (red)",
      "2x Edge of Their Seats (red)",
      "2x Mocking Blow (red)",
      "2x Oasis Respite (red)",
      "2x Prime the Crowd (red)",
      "2x Sadistic Scowl (red)",
      "2x Tension in the Air (red)",
      "2x Villainous Pose (red)",
      "2x Mocking Blow (yel)",
      "2x Short Shrift (yel)",
      "2x Walk in My Shoes (yel)",
      "2x Wee Wrecking Ball (yel)",
      "2x Booze! (blu)",
      "2x Brothers in Arms (blu)",
      "2x Concealed Object (blu)",
      "2x Edge of Their Seats (blu)",
      "2x Full of Bravado (blu)",
      "2x Goon Beatdown (blu)",
      "2x Goon Tactics (blu)",
      "2x Mocking Blow (blu)",
      "2x Power Play (blu)",
      "2x The Suspense is Killing Me (blu)",
    ].join("\n");
    const r = validateDeck(parseDecklistText(text), "silver-age");
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.heroId).toBe("SLY001");
    // Titan's Fist plus the two off-hands (Arcane Lantern, Stonewall Impasse)
    expect(r.decklist.weaponIds.map((id) => cardData[id]!.name).sort()).toEqual([
      "Arcane Lantern",
      "Stonewall Impasse",
      "Titan's Fist",
    ]);
    expect(r.decklist.equipmentPool).toHaveLength(6);
    expect(r.decklist.deck).toHaveLength(46);
  });

  it("rejects unknown cards with a missing list", () => {
    const text = ccExportText() + "\n3x Does Not Exist\n2x Flock of the Seagulls";
    const r = validateDeck(parseDecklistText(text), "cc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual(["Does Not Exist", "Flock of the Seagulls"]);
  });

  it("rejects undersized decks per format", () => {
    const lines = parseDecklistText(
      [`Hero: ${hero.name}`, ...deckCards.slice(0, 10).map((c) => deckLine(c))].join("\n"),
    );
    const r = validateDeck(lines, "silver-age");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("too small"))).toBe(true);
  });

  it("rejects more than 3 copies of a card", () => {
    const lines = parseDecklistText(
      [`Hero: ${hero.name}`, deckLine(deckCards[0]!, 4), ...deckCards.slice(1, 20).map((c) => deckLine(c))].join("\n"),
    );
    const r = validateDeck(lines, "cc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("too many copies"))).toBe(true);
  });

  it("imports banned cards so current legality can be checked per game", () => {
    const banned = printings.find((card) => card.name === "Art of War")!;
    const lines = parseDecklistText(ccExportText());
    const replaced = lines.find((line) => line.name === deckCards[0]!.name)!;
    replaced.name = banned.name;
    replaced.pitch = banned.pitch;
    const r = validateDeck(lines, "cc");
    expect(r).toMatchObject({ ok: true });
  });

  it("imports Living Legend heroes so current legality can be checked per game", () => {
    const text = ccExportText().replace(`Hero: ${hero.name}`, "Hero: Azalea, Ace in the Hole");
    const r = validateDeck(parseDecklistText(text), "cc");
    expect(r).toMatchObject({ ok: true, heroName: "Azalea, Ace in the Hole" });
  });

  it("imports Levia, Redeemed as a fixed inventory card instead of a second hero", () => {
    const text = ccExportText()
      .replace(`Hero: ${hero.name}`, "Hero: Levia, Shadowborn Abomination") +
      "\nArena cards\n1x Levia, Redeemed";
    const r = validateDeck(parseDecklistText(text), "cc");

    expect(r).toMatchObject({
      ok: true,
      heroName: "Levia, Shadowborn Abomination",
      decklist: { inventoryPool: ["DTD164"] },
    });
  });

  it("still rejects two ordinary starting heroes", () => {
    const text = ccExportText() + "\nHero: Dorinthea Ironsong";
    const r = validateDeck(parseDecklistText(text), "cc");

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain(`multiple heroes (${hero.name}, Dorinthea Ironsong)`);
  });

  it("rejects decks without a hero", () => {
    const lines = parseDecklistText(deckCards.slice(0, 20).map((c) => deckLine(c)).join("\n"));
    const r = validateDeck(lines, "cc");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toContain("no hero found in the decklist");
  });
});

describe("validatePresentation", () => {
  function ccPool() {
    const r = validateDeck(parseDecklistText(ccExportText()), "cc");
    if (!r.ok) throw new Error("pool invalid");
    return r.decklist;
  }

  it("accepts a full-pool presentation and returns an engine decklist", () => {
    const pool = ccPool();
    const r = validatePresentation(
      pool,
      { weaponIds: pool.weaponIds, equipment: { chest: chest.id }, deck: pool.deck },
      "cc",
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.decklist.heroId).toBe(hero.id);
    expect(r.decklist.deck).toHaveLength(60);
  });

  it("rejects cards outside the registered pool", () => {
    const pool = ccPool();
    const outsider = deckCards.find((c) => !pool.deck.includes(c.id))!;
    const r = validatePresentation(
      pool,
      { weaponIds: [], equipment: {}, deck: [...pool.deck.slice(0, 59), outsider.id] },
      "cc",
    );
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.error).toContain("not in your registered pool");
  });

  it("rechecks current format legality when a deck is presented", () => {
    const pool = ccPool();
    const banned = printings.find((card) => card.name === "Art of War")!;
    pool.sideboard = [banned.id];
    const r = validatePresentation(
      pool,
      { weaponIds: pool.weaponIds, equipment: { chest: chest.id }, deck: pool.deck },
      "cc",
    );
    expect(r).toEqual({
      ok: false,
      error: "Art of War is banned in Classic Constructed",
    });
  });

  it("rejects more than 2 presented weapons", () => {
    const oneHander = printings.find((c) => c.cardType === "weapon" && !c.subtypes?.includes("2h"))!;
    const pool = ccPool();
    pool.weaponIds.push(oneHander.id, oneHander.id, oneHander.id); // registered duplicates are fine
    const r = validatePresentation(
      pool,
      { weaponIds: [oneHander.id, oneHander.id, oneHander.id], equipment: {}, deck: pool.deck },
      "cc",
    );
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.error).toContain("too many weapons");
  });

  it("rejects equipment in the wrong slot", () => {
    const pool = ccPool();
    const r = validatePresentation(
      pool,
      { weaponIds: pool.weaponIds, equipment: { head: chest.id }, deck: pool.deck },
      "cc",
    );
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.error).toContain("not a head equipment");
  });

  it("rejects presented decks below the format minimum", () => {
    const pool = ccPool();
    const r = validatePresentation(
      pool,
      { weaponIds: pool.weaponIds, equipment: {}, deck: pool.deck.slice(0, 59) },
      "cc",
    );
    expect(r).toMatchObject({ ok: false });
    if (r.ok) return;
    expect(r.error).toContain("too small");
  });

  it("silver-age requires an exactly 40-card presentation", () => {
    // 14 distinct cards x3 = 42 registered main-deck cards
    const lines = parseDecklistText(
      [`Hero: ${hero.name}`, ...deckCards.slice(0, 14).map((c) => deckLine(c))].join("\n"),
    );
    const v = validateDeck(lines, "silver-age");
    if (!v.ok) throw new Error("pool invalid");
    const pool = v.decklist;
    const present = (deck: string[]) =>
      validatePresentation(pool, { weaponIds: [], equipment: {}, deck }, "silver-age");
    expect(present(pool.deck.slice(0, 40))).toMatchObject({ ok: true });
    const over = present(pool.deck);
    expect(over).toMatchObject({ ok: false });
    if (!over.ok) expect(over.error).toContain("exactly 40");
    expect(present(pool.deck.slice(0, 39))).toMatchObject({ ok: false });
  });

  it("rejects a two-hand weapon presented alongside another weapon", () => {
    // Briar's precon registers two 2h swords (Scorpio, Comet Tail / Star Fall)
    const lines = parseDecklistText(
      [
        "Hero: Briar",
        "1x Scorpio, Comet Tail",
        "1x Star Fall",
        ...deckCards.slice(0, 14).map((c) => deckLine(c)),
      ].join("\n"),
    );
    const v = validateDeck(lines, "silver-age");
    if (!v.ok) throw new Error("pool invalid");
    const pool = v.decklist;
    const deck = pool.deck.slice(0, 40);
    const both = validatePresentation(
      pool,
      { weaponIds: pool.weaponIds, equipment: {}, deck },
      "silver-age",
    );
    expect(both).toMatchObject({ ok: false });
    if (!both.ok) expect(both.error).toContain("two-hand");
    expect(
      validatePresentation(
        pool,
        { weaponIds: pool.weaponIds.slice(0, 1), equipment: {}, deck },
        "silver-age",
      ),
    ).toMatchObject({ ok: true });
  });
});

describe("deck storage", () => {
  async function freshUser() {
    const db = await freshDb();
    const username = `deckuser${Math.random().toString(36).slice(2, 10)}`;
    const r = await register(db, username, "password1");
    if (!r.ok) throw new Error("register failed");
    const { rows } = await db.query("SELECT id FROM users WHERE username_lc = $1", [username]);
    return { db, userId: Number(rows[0]!.id) };
  }

  it("imports, lists, updates and deletes decks", async () => {
    const { db, userId } = await freshUser();
    const imp = await importDeck(db, userId, {
      name: "Rhinar CC",
      format: "cc",
      fabraryUrl: "https://fabrary.net/decks/01ABC",
      text: ccExportText(),
    });
    expect(imp.ok).toBe(true);
    if (!imp.ok) return;
    expect(imp.deck.heroName).toBe(hero.name);
    expect(imp.deck.fabraryUrl).toBe("https://fabrary.net/decks/01ABC");

    const listed = await listDecks(db, userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]!.name).toBe("Rhinar CC");

    const upd = await updateDeck(db, userId, imp.deck.id, { name: "Rhinar CC v2" });
    expect(upd.ok && upd.deck.name).toBe("Rhinar CC v2");

    expect(await deleteDeck(db, userId, imp.deck.id)).toBe(true);
    expect(await listDecks(db, userId)).toHaveLength(0);
  });

  it("rejects invalid imports without storing anything", async () => {
    const { db, userId } = await freshUser();
    const r = await importDeck(db, userId, { name: "bad", format: "cc", text: "3x Does Not Exist" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toContain("Does Not Exist");
    expect(await listDecks(db, userId)).toHaveLength(0);
  });

  it("persists the latest Fabrary default but keeps matchup variants transient", async () => {
    const { db, userId } = await freshUser();
    const sourceUrl = "https://fabrary.net/decks/01G76G1DP5VVB050BT3YV9TQ7K";
    const defaultText = ccExportText();
    const variantLines = defaultText.split("\n");
    const sideboardLine = variantLines.pop();
    if (!sideboardLine) throw new Error("test deck should have a card to sideboard");
    const variantText = [...variantLines, "Sideboard cards", sideboardLine].join("\n");
    const imported = await importDeck(db, userId, {
      name: "My custom name",
      format: "cc",
      fabraryUrl: sourceUrl,
      text: defaultText,
    });
    if (!imported.ok) throw new Error("import failed");
    const matchups = [{
      id: "bravo-plan",
      name: "Into Bravo",
      preferredTurnOrder: null,
    }];
    const calls: Array<string | undefined> = [];
    const fabraryClient = {
      fetchDeck: async (_url: string, matchupId?: string) => {
        calls.push(matchupId);
        return {
          ok: true as const,
          deck: {
            canonicalUrl: sourceUrl,
            name: "Provider name",
            text: matchupId ? variantText : defaultText,
            matchups,
          },
        };
      },
    };

    const latest = await resolveFreshDeck(db, userId, imported.deck.id, fabraryClient);
    expect(latest.ok && latest.deck.name).toBe("My custom name");
    expect(latest.ok && latest.matchups).toEqual(matchups);

    const variant = await resolveFreshDeck(db, userId, imported.deck.id, fabraryClient, "bravo-plan");
    expect(variant.ok && variant.selectedMatchupId).toBe("bravo-plan");
    expect(variant.ok && variant.deck.decklist.sideboard).toHaveLength(3);
    expect(calls).toEqual([undefined, "bravo-plan"]);

    const stored = (await listDecks(db, userId))[0]!;
    expect(stored.name).toBe("My custom name");
    expect(stored.decklist.sideboard ?? []).toHaveLength(0);
  });

  it("does not let users touch other users' decks", async () => {
    const { db, userId: aId } = await freshUser();
    const r = await register(db, "otheruser", "password1");
    if (!r.ok) throw new Error("register failed");
    const { rows } = await db.query("SELECT id FROM users WHERE username_lc = 'otheruser'");
    const bId = Number(rows[0]!.id);
    const imp = await importDeck(db, aId, { name: "mine", format: "cc", text: ccExportText() });
    if (!imp.ok) throw new Error("import failed");
    const upd = await updateDeck(db, bId, imp.deck.id, { name: "hijacked" });
    expect(upd.ok).toBe(false);
    expect(await deleteDeck(db, bId, imp.deck.id)).toBe(false);
    // and the deck is untouched
    const decks = await listDecks(db, aId);
    expect(decks[0]!.name).toBe("mine");
  });

  it("rejects historical and malformed deck JSON instead of normalizing it", async () => {
    const { db, userId } = await freshUser();
    const insert = (id: string, decklist: unknown) => db.query(
      `INSERT INTO decks
       (id, user_id, name, format, fabrary_url, decklist, hero_name, created_at, updated_at)
       VALUES ($1, $2, 'corrupt', 'cc', NULL, $3, 'Hero', 1, 1)`,
      [id, userId, JSON.stringify(decklist)],
    );
    await insert("historical", {
      heroId: hero.id,
      weaponIds: [],
      equipment: { chest: chest.id },
      deck: [],
    });
    await expect(listDecks(db, userId)).rejects.toThrow(/decklist/);

    await db.query("DELETE FROM decks WHERE id = 'historical'");
    await insert("unknown-field", {
      heroId: hero.id,
      weaponIds: [],
      equipmentPool: [],
      deck: [],
      poison: "private-id",
    });
    await expect(listDecks(db, userId)).rejects.toThrow(/unknown field/);
  });
});
