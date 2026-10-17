import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { printingId, scenario, type SeatSpec } from "../harness.js";

const NO_EQUIPMENT = { head: null, chest: null, arms: null, legs: null } as const;

function hero(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "rhinar", weapons: [], resources: 3, ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

function foe(spec: Partial<SeatSpec> = {}): SeatSpec {
  return { hero: "dorinthea", weapons: [], ...spec, equipment: { ...NO_EQUIPMENT, ...(spec.equipment ?? {}) } };
}

const ongoing = (g: ReturnType<typeof scenario>, cardKey: string) =>
  projectStateFor(g.state, 0).ongoing.filter((effect) => effect.cardId === printingId(cardKey));

const labels = (g: ReturnType<typeof scenario>, cardKey: string) =>
  ongoing(g, cardKey).map((effect) => effect.label);

/** Dorinthea plays the card against Rhinar. */
const playing = (key: string) => {
  const g = scenario({ seats: [{ hero: "dorinthea", hand: [key], resources: 5 }, { hero: "rhinar" }] });
  return g.play(key);
};

const playOne = (key: string, seatHero: "rhinar" | "dorinthea" = "rhinar") => {
  const g = scenario({ seats: [{ hero: seatHero, hand: [key], resources: 5 }, { hero: "dorinthea" }] });
  g.play(key);
  return g;
};

/** A marker folded into its card's next-attack buff: one chip whose summary
 *  lists the buff's own phrase before the script label. */
const folded = (label: string, id: string, part0: string) =>
  expect.objectContaining({
    label,
    summaryMessage: expect.objectContaining({
      id: "engine.effect.summary.list.two",
      values: expect.objectContaining({
        part0: { kind: "term", id: part0 },
        part1: { kind: "term", id },
      }),
    }),
  });

const labelled = (label: string, id: string, values?: Record<string, unknown>) =>
  expect.objectContaining({ label, summaryMessage: { id, ...(values ? { values } : {}) } });

describe("folded wager riders", () => {
  it("folds Big Slick's wager into its sword buff and leaves no bare marker once it attacks", () => {
    const g = playing("big slick|2");
    expect(ongoing(g, "big slick|2")).toEqual([
      folded(
        "+4 power, wager with the defending hero when it attacks · next sword attack",
        "card.effect.common.wager.attack",
        "engine.effect.part.attack",
      ),
    ]);

    g.attackWithWeapon();
    expect(projectStateFor(g.state, 0).ongoing.map((effect) => effect.label).join("\n"))
      .not.toContain("ongoing effect");
  });

  it("says Belly Buster's wager is optional and needs a hero", () => {
    expect(ongoing(playing("belly buster|1"), "belly buster|1")).toEqual([
      folded(
        "+3 power, when it attacks a hero, you may wager with them · next Warrior attack",
        "card.effect.aol.bellybuster",
        "engine.effect.part.attack",
      ),
    ]);
  });

  it("folds Heads Up's dominate rider", () => {
    expect(ongoing(playing("heads up|1"), "heads up|1")).toEqual([
      folded("+3 power, dominate if it wagers · next sword attack", "card.effect.aol.headsup", "engine.effect.part.attack"),
    ]);
  });

  it("labels Check-Raise's bonus for the next wagering attack", () => {
    expect(ongoing(playing("check-raise|1"), "check-raise|1")).toEqual([
      labelled("the next attack you control that wagers gets +4 power · this turn", "card.effect.aol.checkraise", {
        wagerAttack: 4,
      }),
    ]);
  });
});

describe("folded next-attack riders", () => {
  it.each([
    [
      "terms of combat|1",
      "+4 power, draw a card whenever a defense reaction is played or activated against it · next weapon attack",
      "card.effect.mpw.termsofcombat",
    ],
    ["engage steel|1", "+3 power, +1 power if defended by a Warrior card · next sword attack", "card.effect.mpw.engagesteel"],
    [
      "lace with frailty|1",
      "+3 power, when it hits a hero, create a Frailty token under their control · next arrow attack",
      "card.effect.common.frailty.create.hit.hero",
    ],
    [
      "drop the anchor|1",
      "+3 power, when it hits a hero, tap them and all allies they control · next arrow attack",
      "card.effect.saz.droptheanchor",
    ],
    ["regain composure|3", "+1 power, untap your hero when it hits · next attack", "card.effect.sea.regaincomposure"],
    [
      "weave lightning|1",
      "+3 power, go again if it's fused · next Lightning or Elemental attack action card",
      "card.effect.ele.weavelightning",
    ],
  ])("%s", (key, label, id) => {
    expect(ongoing(playing(key), key)).toEqual([folded(label, id, "engine.effect.part.attack")]);
  });

  it("names Flying High's colour through a message value", () => {
    expect(ongoing(playing("flying high|1"), "flying high|1")).toEqual([
      expect.objectContaining({
        label: "go again, +1 power if it's red · next attack",
        summaryMessage: expect.objectContaining({
          values: expect.objectContaining({
            attackColor: "red",
            part1: { kind: "term", id: "card.effect.common.attack.if.color" },
          }),
        }),
      }),
    ]);
    expect(ongoing(playing("flying high|3"), "flying high|3").map((effect) => effect.label))
      .toEqual(["go again, +1 power if it's blue · next attack"]);
  });

  it("folds the Pirate ally Gold rider and labels a buff with no other phrase", () => {
    expect(ongoing(playing("heave ho!|3"), "heave ho!|3")).toEqual([
      folded(
        "overpower, create a Gold token when it hits a hero · next Pirate ally attack",
        "card.effect.common.gold.create.hit.hero",
        "engine.effect.part.overpower",
      ),
    ]);
    expect(ongoing(playing("loot the hold|3"), "loot the hold|3")).toEqual([
      labelled(
        "when it hits a hero, they discard a card, and if they do, create a Gold token · next Pirate ally attack",
        "card.effect.sgb.loothold",
      ),
    ]);
  });
});

describe("labelled markers", () => {
  it.each([
    [
      "all in|1",
      "your next sword attack destroys all your Gold for +2 power each, and you lose the game if it doesn't hit",
      "card.effect.mpw.allin",
    ],
    [
      "blade rush|2",
      "your first sword attack gets go again and your second sword attack gets +1 power",
      "card.effect.mpw.bladerush",
    ],
    [
      "not so fast|2",
      "the next time an opponent would draw a card from a Gold token, you draw it instead",
      "card.effect.sea.notsofast",
    ],
    [
      "prolonged illness|3",
      "whenever a disease token is destroyed, if it's the first with that name, " +
        "create a copy of it under the same hero's control",
      "card.effect.mpa.prolongedillness",
    ],
  ])("%s", (key, label, id) => {
    expect(ongoing(playing(key), key)).toEqual([labelled(`${label} · this turn`, id)]);
  });

  it("names Chart a Course's attack through an ordinal value", () => {
    expect(ongoing(playing("chart a course|2"), "chart a course|2")).toEqual([
      labelled("your second attack gets +3 power · this turn", "card.effect.sea.chartacourse", { attackOrdinal: 2 }),
    ]);
  });

  it("labels Burn Up's arcane rider", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["burn up // shock|1"], resources: 5 }, { hero: "rhinar" }],
    }).play("burn up // shock|1", { meldSide: "left" });
    expect(ongoing(g, "burn up // shock|1")).toEqual([
      labelled(
        "the next time an attack you control hits a hero, deal 4 arcane damage to them · this turn",
        "card.effect.sba.burnup",
      ),
    ]);
  });

  it.each([
    ["inverter's nightcowl|0", "chest", "gain 1 resource whenever you play a card with stealth", "card.effect.aac.invertersnightcowl"],
    ["target totalizer|0", "head", "draw a card whenever an arrow with an aim counter hits", "card.effect.aaz.targettotalizer"],
    [
      "drop dead bodice|0",
      "chest",
      "gain 1 resource whenever a zombie is put into your graveyard",
      "card.effect.ama.dropdeadbodice",
    ],
  ])("labels the destroyed %s's lingering effect", (key, slot, label, id) => {
    const g = scenario({
      seats: [{ hero: "dorinthea", equipment: { [slot]: key }, resources: 3 }, { hero: "rhinar" }],
    });
    g.activate(key);
    expect(ongoing(g, key)).toEqual([labelled(`${label} · this turn`, id)]);
  });
});

describe("labelled lingering markers (ELE, UPR, HVY, EVO, OUT)", () => {
  it("labels Electrify's next-hit damage with its amount", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["electrify|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("electrify|1");

    expect(ongoing(g, "electrify|1")).toEqual([
      expect.objectContaining({
        label: "the next time an attack action card hits a hero, it deals 3 damage to them · this turn",
        summaryMessage: { id: "card.effect.ele.electrify", values: { amount: 3 } },
      }),
    ]);
  });

  it("shows Ice Quake's turn-long Frostbite rider beside its next-attack bonus", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["ice quake|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("ice quake|1");

    expect(ongoing(g, "ice quake|1")).toEqual([
      expect.objectContaining({ label: "+3 power · next attack" }),
      expect.objectContaining({
        label: "whenever an attack hits a hero, create a Frostbite token under their control · this turn",
        summaryMessage: { id: "card.effect.common.frostbite.onhit" },
      }),
    ]);
  });

  it("folds Weave Lightning's fused go again into its next-attack bonus", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["weave lightning|2"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("weave lightning|2");

    const effects = ongoing(g, "weave lightning|2");
    expect(effects).toHaveLength(1);
    expect(effects[0]!.label).toMatch(/^\+2 power, go again if it's fused · next /);
    expect(effects[0]!.summaryMessage).toMatchObject({
      values: { part1: { kind: "term", id: "card.effect.ele.weavelightning" } },
    });
  });

  it("labels Weave Earth and Invigorate with their amounts", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["weave earth|1", "invigorate|2"], resources: 6 },
        { hero: "dorinthea" },
      ],
    });
    g.play("weave earth|1").play("invigorate|2");

    expect(ongoing(g, "weave earth|1")).toEqual([
      expect.objectContaining({
        label: "the next Earth or Elemental attack action card you play gets +3 power, +4 if it's fused · this turn",
        summaryMessage: { id: "card.effect.ele.weaveearth", values: { amount: 3, fusedAmount: 4 } },
      }),
    ]);
    expect(labels(g, "invigorate|2")).toEqual(["the next attack you fuse gets +3 power · this turn"]);
  });

  it("folds Transmogrify's base power into its next-attack grant", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["transmogrify|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("transmogrify|1");

    const effects = ongoing(g, "transmogrify|1");
    expect(effects).toHaveLength(1);
    expect(effects[0]!.label).toMatch(/^is also Illusionist, phantasm, has 8 base power · next /);
  });

  it("labels Strategic Planning's end-phase draw", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["strategic planning|3"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("strategic planning|3");

    expect(labels(g, "strategic planning|3")).toEqual([
      "draw a card at the beginning of the end phase · this turn",
    ]);
  });

  it("folds a next-attack wager rider into Edge Ahead's bonus", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["edge ahead|1"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("edge ahead|1");

    const effects = ongoing(g, "edge ahead|1");
    expect(effects).toHaveLength(1);
    expect(effects[0]!.label).toMatch(
      /^\+3 power, when it attacks a hero, you may wager an Agility token with them · next Warrior attack$/,
    );
  });

  it("labels Good Time Chapeau's granted wager on the next attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", board: ["gold|0"], equipment: { head: "good time chapeau|0" } },
        { hero: "dorinthea" },
      ],
    });
    g.activate("good time chapeau|0", { settle: false }).chooseCard("gold|0").settle();

    const effects = ongoing(g, "good time chapeau|0");
    expect(effects).toHaveLength(1);
    expect(effects[0]!.label).toMatch(/^when it attacks a hero, wager a Might and a Vigor token with them · /);
    expect(effects[0]!.summaryMessage).toEqual({ id: "card.effect.hvy.goodtimechapeau" });
  });

  it("labels Ripple Away's token replacement", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["ripple away|3"] }, { hero: "dorinthea" }],
    });
    g.activate("ripple away|3");

    expect(labels(g, "ripple away|3")).toEqual(["action card effects create 1 fewer of each token · this turn"]);
  });

  it("labels Warband of Bellona's charge on the next attack", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, equipment: { head: "warband of bellona|0" } },
        { hero: "dorinthea" },
      ],
    });
    g.activate("warband of bellona|0");

    expect(labels(g, "warband of bellona|0")).toEqual([
      "the next time you attack, you may charge your hero's soul, and draw a card if a yellow card is charged · this turn",
    ]);
  });

  it("clears Warband of Bellona's label once the next attack uses it", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: [], resources: 4, equipment: { head: "warband of bellona|0" } },
        { hero: "dorinthea" },
      ],
    });
    g.activate("warband of bellona|0").attackWithWeapon();

    expect(labels(g, "warband of bellona|0")).toEqual([]);
  });

  it("shows Premeditate's Ponder rider beside its arsenal bonus", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["premeditate|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("premeditate|1");

    const effects = labels(g, "premeditate|1");
    expect(effects).toHaveLength(2);
    expect(effects).toContain("the next time an attack action card hits a hero, create a Ponder token · this turn");
    expect(effects.some((label) => label.startsWith("+3 power · "))).toBe(true);
  });

  it("labels Burdens of the Past's restriction on the target hero", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["burdens of the past|3"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("burdens of the past|3");

    expect(ongoing(g, "burdens of the past|3")).toEqual([
      expect.objectContaining({
        seat: 1,
        label: "can't play defense reaction cards with the same name as a card in their graveyard · this turn",
        summaryMessage: { id: "card.effect.out.burdensofthepast" },
      }),
    ]);
  });
});

describe("lingering marker labels (MST, HNT, PEN, ROS, EVR, DTD, MON, OMN, CRU, ARC)", () => {
  it("folds Cheating Scoundrel's wager rider into its buff and labels the wager replacement", () => {
    const g = playOne("cheating scoundrel|1");

    expect(ongoing(g, "cheating scoundrel|1")).toEqual([
      expect.objectContaining({
        label: "+3 power, wager with the defending hero when it attacks · next attack action card",
        summaryMessage: {
          id: "engine.effect.summary.list.two",
          values: {
            attack: "+3",
            part0: { kind: "term", id: "engine.effect.part.attack" },
            part1: { kind: "term", id: "card.effect.common.wager.attack" },
          },
        },
      }),
      expect.objectContaining({
        label: "the next time you would lose a wager, you may discard a card to win it instead · this turn",
        summaryMessage: { id: "card.effect.pen.cheatingscoundrel.wager" },
      }),
    ]);
  });

  it.each([
    [
      "sense weakness|3",
      "rhinar",
      "+1 power, dominate, when it hits a hero, deal damage equal to the damage dealt to each ally they control · next Guardian attack",
      "card.effect.pen.senseweakness",
    ],
    [
      "unsheathed|1",
      "dorinthea",
      "+3 power, go again when it attacks if its power is more than twice its base power · next sword attack",
      "card.effect.ros.unsheathed",
    ],
    [
      "hack to reality|2",
      "rhinar",
      "+2 power, when it hits a hero, destroy a non-token aura they own with cost no greater than the damage dealt · next attack",
      "card.effect.dtd.hacktoreality",
    ],
  ] as const)("folds %s's marker into its next-attack buff", (key, hero, label, id) => {
    const effects = ongoing(playOne(key, hero), key);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toEqual(expect.objectContaining({ label }));
    expect(Object.values(effects[0]!.summaryMessage?.values ?? {})).toContainEqual({ kind: "term", id });
  });

  it("labels the Gauntlet of Sword and Sorcery grant on its otherwise bare next-attack buff", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 2, equipment: { arms: "gauntlet of sword and sorcery|0" } },
        { hero: "dorinthea" },
      ],
    });
    g.activate("gauntlet of sword and sorcery|0");

    expect(ongoing(g, "gauntlet of sword and sorcery|0")).toEqual([
      expect.objectContaining({
        label:
          "when it attacks, deal 1 arcane damage to the opposing hero; if damage is dealt, it gets +1 power · next attack action card",
        summaryMessage: { id: "card.effect.omn.gauntletofswordandsorcery" },
      }),
    ]);
  });

  it.each([
    [
      "poison the well|3",
      "the next time a hero would gain life, they lose that much life instead · this turn",
      { id: "card.effect.dtd.poisonthewell" },
    ],
    [
      "seeds of agony|1",
      "your next attack action card with cost 2 or less deals 1 arcane damage to target hero when it attacks · this turn",
      { id: "card.effect.mon.seedsofagony", values: { cost: 2 } },
    ],
    [
      "tempest aurora|3",
      "the next card you play with cost 0 or less and an arcane damage effect deals 1 more arcane damage · this turn",
      { id: "card.effect.dyn.tempestaurora", values: { cost: 0 } },
    ],
    [
      "high striker|2",
      "create 4 Copper tokens the next time an attack you control hits · this turn",
      { id: "card.effect.evr.highstriker", values: { count: 4 } },
    ],
    [
      "smashing good time|1",
      "the next time an attack action card hits a hero, you may destroy an item with cost 2 or less they control · this turn",
      { id: "card.effect.evr.smashinggoodtime" },
    ],
    [
      "plunder run|1",
      "draw a card the next time an attack action card you control hits · this turn",
      { id: "card.effect.arc.plunderrun" },
    ],
    [
      "mordred tide|1",
      "create 1 more Runechant token whenever you create Runechant tokens · this turn",
      { id: "card.effect.arc.mordredtide" },
    ],
    [
      "eclipse existence|3",
      "whenever an attack hits a Light hero, you may banish a card from their soul and they lose 1 life · this turn",
      { id: "card.effect.mon.eclipseexistence" },
    ],
    [
      "a bit off the side|1",
      "whenever an axe you control hits a hero, they discard a card · this turn",
      { id: "card.effect.omn.abitofftheside" },
    ],
    [
      "first tenet of chi: moon|3",
      "draw a card the next time you attack with a blue card · this turn",
      { id: "card.effect.mst.firsttenetofchimoon" },
    ],
  ] as const)("labels %s's lingering marker", (key, label, summaryMessage) => {
    expect(ongoing(playOne(key), key)).toEqual([expect.objectContaining({ label, summaryMessage })]);
  });

  it("labels a weapon-scoped marker with this-turn duration", () => {
    const g = playOne("slice and dice|1", "dorinthea");

    expect(ongoing(g, "slice and dice|1")).toEqual([
      expect.objectContaining({
        label: "your first sword or dagger weapon attack gets +1 power and your second gets +3 power · this turn",
        summaryMessage: { id: "card.effect.evr.sliceanddice", values: { amount: 3 } },
      }),
    ]);
  });

  it("shows a turn-long rider beside the next-attack buff it accompanies", () => {
    const g = playOne("spoils of war|1", "dorinthea");

    expect(ongoing(g, "spoils of war|1").map((effect) => effect.label)).toEqual([
      "+2 power, go again · next weapon attack",
      "create 2 Copper tokens whenever a weapon you control hits · this turn",
    ]);
  });
});

describe("lingering marker labels (AST, OMN, SVI, OUT, DYN)", () => {
  it("labels Arc Lightning's arcane trigger and its next action card go again", () => {
    const g = scenario({ seats: [hero({ heroKey: "aurora|0", hand: ["arc lightning|2"] }), foe()] });
    g.play("arc lightning|2").declareTarget(1);

    const effects = ongoing(g, "arc lightning|2");
    expect(effects.map((effect) => effect.label).sort()).toEqual([
      "deal 1 arcane damage to any target whenever you go again · this turn",
      "go again · next action card",
    ]);
    expect(effects.find((effect) => effect.lifetime === "turn")?.summaryMessage)
      .toEqual({ id: "card.effect.ast.arclightning" });
  });

  it("folds a Leech rider onto its next attack action card bonus", () => {
    const g = scenario({ seats: [hero({ hand: ["leech vitality|1"] }), foe()] });
    g.play("leech vitality|1");

    expect(labels(g, "leech vitality|1")).toEqual([
      "+3 power, gain 1 life whenever it damages a hero · next attack action card",
    ]);
  });

  it("labels Quick Succession's bonus for the next attacks with go again", () => {
    const g = scenario({ seats: [hero({ hand: ["quick succession|1"] }), foe()] });
    g.play("quick succession|1");

    const effects = ongoing(g, "quick succession|1");
    expect(effects.map((effect) => effect.label).sort()).toEqual([
      "go again · next Runeblade or Lightning attack",
      "your next 3 attacks get +1 power while they have go again · this turn",
    ]);
    expect(effects.find((effect) => effect.lifetime === "turn")?.summaryMessage)
      .toEqual({ id: "card.effect.omn.quicksuccession", values: { count: 3 } });
  });

  it("labels Livewire Press's granted hit damage", () => {
    const g = scenario({ seats: [hero({ hand: ["lightning surge|1", "livewire press|1"] }), foe()] });
    g.play("lightning surge|1").blockWith()
      .react("livewire press|1", { targetCard: "lightning surge|1", settle: false })
      .passPriority()
      .passPriority();

    expect(g.state.stack).toHaveLength(0);
    expect(labels(g, "livewire press|1")).toEqual(["deal 4 damage to them when it hits a hero · this turn"]);
    g.settle().expectLife(1, 12);
    expect(labels(g, "livewire press|1")).toEqual([]);
  });

  it("folds Toxic Tips' marker onto its next attack action card affliction", () => {
    const g = scenario({ seats: [hero({ equipment: { legs: "toxic tips|0" } }), foe()] });
    g.activate("toxic tips|0");

    expect(labels(g, "toxic tips|0")).toEqual([
      "create a Frailty, Inertia, or Bloodrot Pox token under their control when it hits a hero · next attack action card",
    ]);
  });

  it("labels Mask of Shifting Perspectives' dagger cycling", () => {
    const g = scenario({
      seats: [hero({ hand: ["lightning surge|1"], equipment: { head: "mask of shifting perspectives|0" } }), foe()],
    });
    g.play("lightning surge|1").blockWith().activate("mask of shifting perspectives|0");

    expect(labels(g, "mask of shifting perspectives|0")).toEqual([
      "whenever a dagger hits, may put a card from your hand on the bottom of your deck to draw a card · this turn",
    ]);
  });

  it("labels Berserk's discard replacement", () => {
    const g = scenario({ seats: [hero({ hand: ["berserk|2"] }), foe()] });
    g.play("berserk|2");

    expect(labels(g, "berserk|2")).toEqual([
      "whenever a card with 6 or more power is discarded at random, banish it and reveal the top card of your deck; " +
        "draw if it has 6 or more power · this turn",
    ]);
  });

  it("labels Brainstorm's draw trigger", () => {
    const g = scenario({ seats: [hero({ hand: ["brainstorm|3"] }), foe()] });
    g.play("brainstorm|3");

    expect(ongoing(g, "brainstorm|3")).toEqual([
      expect.objectContaining({
        label: "deal 1 arcane damage to any target whenever you draw a card during the action phase · this turn",
        summaryMessage: { id: "card.effect.dyn.brainstorm" },
      }),
    ]);
  });

  it("labels Amethyst Tiara's Runechant spellvoid", () => {
    const g = scenario({ seats: [hero({ equipment: { head: "amethyst tiara|0" } }), foe()] });
    g.activate("amethyst tiara|0");

    expect(labels(g, "amethyst tiara|0")).toEqual(["Runechants you control have spellvoid 1 · this turn"]);
  });

  it("merges Bios Update's boost bonus and item marker into one effect", () => {
    const g = scenario({ seats: [hero({ hand: ["bios update|1"] }), foe()] });
    g.play("bios update|1");

    expect(labels(g, "bios update|1")).toEqual([
      "the next attack you boost gets +3 power, put the next Mechanologist item with cost 2 or less banished " +
        "to pay a boost cost into the arena · this turn",
    ]);
  });

  it("labels Imperial Edict's named-card prohibition", () => {
    const g = scenario({ seats: [hero({ board: ["imperial edict|1"] }), foe()] });
    g.activate("imperial edict|1").chooseName("Sink Below");

    expect(ongoing(g, "imperial edict|1")).toEqual([
      expect.objectContaining({
        label: expect.stringMatching(/^Sink Below can't be played · /),
        summaryMessage: { id: "card.effect.dyn.imperialedict", values: { name: "Sink Below" } },
      }),
    ]);
  });
});
