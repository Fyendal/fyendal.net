import { describe, expect, it } from "vitest";
import { projectStateFor } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";

const ongoing = (g: ReturnType<typeof scenario>, cardKey: string) =>
  projectStateFor(g.state, 0).ongoing.filter((effect) => effect.cardId === printingId(cardKey));

const subjectValues = (values: Record<string, unknown>) => ({
  noun: "attack",
  typeCount: 0,
  color: "any",
  via: "none",
  keyword: "none",
  limit: "none",
  target: "none",
  ...values,
});

describe("lingering effect labels", () => {
  it("names the class a next-attack bonus applies to", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["bonebreaker bellow|2"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("bonebreaker bellow|2");

    expect(ongoing(g, "bonebreaker bellow|2")).toEqual([
      expect.objectContaining({
        label: "+2 power · next Brute attack",
        lifetime: "once",
        summaryMessage: { id: "engine.effect.part.attack", values: { attack: "+2" } },
        durationMessage: {
          id: "engine.effect.duration.next.subject",
          values: subjectValues({
            typeCount: 1,
            type1: "Brute",
            subject: { kind: "term", id: "engine.effect.subject.one" },
          }),
        },
      }),
    ]);
  });

  it("keeps each colour of Prismatic Leyline as its own effect", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["prismatic leyline|2"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("prismatic leyline|2");

    expect(ongoing(g, "prismatic leyline|2").map((effect) => effect.label)).toEqual([
      "+1 power · next red attack",
      "+2 power · next yellow attack",
      "+3 power · next blue attack",
    ]);
  });

  it("projects repeated identical bonuses separately so the client stacks them", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["sprout strength|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("sprout strength|1");

    expect(ongoing(g, "sprout strength|1").map((effect) => effect.label))
      .toEqual(Array(3).fill("+1 power · next attack"));
  });

  it("composes a localizable list of several phrases for one attack", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["driving blade|1"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("driving blade|1");

    expect(ongoing(g, "driving blade|1")).toEqual([
      expect.objectContaining({
        label: "+3 power, go again · next weapon attack",
        summaryMessage: {
          id: "engine.effect.summary.list.two",
          values: {
            attack: "+3",
            part0: { kind: "term", id: "engine.effect.part.attack" },
            part1: { kind: "term", id: "engine.effect.part.go.again" },
          },
        },
        durationMessage: expect.objectContaining({
          id: "engine.effect.duration.next.subject",
          values: expect.objectContaining({ noun: "weaponAttack" }),
        }),
      }),
    ]);
  });

  it("names the attacks a this-turn bonus applies to", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["bloodrush bellow|2", "wounded bull|3"], resources: 3 },
        { hero: "dorinthea" },
      ],
    });
    g.play("bloodrush bellow|2");

    expect(ongoing(g, "bloodrush bellow|2")).toEqual([
      expect.objectContaining({
        label: "+2 power · Brute attacks this turn",
        lifetime: "turn",
        durationMessage: {
          id: "engine.effect.duration.subject.this.turn",
          values: subjectValues({
            typeCount: 1,
            type1: "Brute",
            subject: { kind: "term", id: "engine.effect.subject.other" },
          }),
        },
      }),
    ]);
  });

  it("states cost limits on the next attack action card", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["nimblism|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("nimblism|1");

    expect(ongoing(g, "nimblism|1")).toEqual([
      expect.objectContaining({ label: "+3 power · next attack action card with cost 1 or less" }),
    ]);
  });
  it("names the weapons a combat-chain activation discount applies to", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", resources: 3, weapons: ["kunai of retribution|0"], hand: ["wrath of retribution|1"] },
        { hero: "dorinthea" },
      ],
    });
    g.play("wrath of retribution|1");

    expect(ongoing(g, "wrath of retribution|1")).toEqual([
      expect.objectContaining({
        label: "costs 1 less to activate · dagger weapons this combat chain",
        lifetime: "chain",
        durationMessage: {
          id: "engine.effect.duration.subject.this.chain",
          values: subjectValues({
            noun: "weapon",
            typeCount: 1,
            type1: "dagger",
            subject: { kind: "term", id: "engine.effect.subject.other" },
          }),
        },
      }),
    ]);
  });
});

describe("script-supplied lingering effect labels", () => {
  it("localizes a granted on-hit rider through a composed term", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["shadow puppetry|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("shadow puppetry|1");

    expect(ongoing(g, "shadow puppetry|1")).toEqual([
      expect.objectContaining({
        label: "+1 power, go again, when it hits: look at the top card of your deck and you may banish it · next attack",
        summaryMessage: {
          id: "engine.effect.summary.list.three",
          values: {
            attack: "+1",
            part0: { kind: "term", id: "engine.effect.part.attack" },
            part1: { kind: "term", id: "engine.effect.part.go.again" },
            hitTarget: "any",
            hitEffect: { kind: "term", id: "card.effect.mon.shadowpuppetry" },
            part2: { kind: "term", id: "engine.effect.part.on.hit.script" },
          },
        },
      }),
    ]);
  });

  it("says a granted on-hit rider needs a hero to be hit", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["rend flesh|3"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("rend flesh|3");

    expect(ongoing(g, "rend flesh|3")).toEqual([
      expect.objectContaining({
        label: "when it hits a hero: remove a +1 power counter for the hit hero to lose 2 life · sword attacks this turn",
        summaryMessage: {
          id: "engine.effect.part.on.hit.script",
          values: { hitTarget: "hero", hitEffect: { kind: "term", id: "card.effect.pen.rendflesh" } },
        },
      }),
    ]);
  });

  it("localizes a script's ongoing label", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["embrace sin|2"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("embrace sin|2");

    expect(ongoing(g, "embrace sin|2")).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: "may play an aura with Runechant in its name from your banished zone · this turn",
        summaryMessage: { id: "card.effect.iar.embracesin" },
      }),
    ]));
  });
});

describe("prevention shields", () => {
  it("names the Pirates a Sawbones shield also covers", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", heroKey: "gravy bones|0", board: ["sawbones, dock hand|2"] },
        { hero: "rhinar" },
      ],
    });
    g.activate("sawbones, dock hand|2", { ability: 1 });

    expect(ongoing(g, "sawbones, dock hand|2")).toEqual([
      expect.objectContaining({
        label: "prevent next 1 damage to you or a Pirate you control · this turn",
        summaryMessage: {
          id: "engine.effect.part.prevent.damage.recipient.type",
          values: { amount: 1, recipientType: "Pirate", recipientTypeArticle: "a" },
        },
      }),
    ]);
  });
});

describe("effects that outlast the turn", () => {
  it("says an effect lasts until the start of its controller's next turn", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["this round's on me|3"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("this round's on me|3");

    expect(ongoing(g, "this round's on me|3")).toEqual([
      expect.objectContaining({
        label: "attacks that target you get -1 power · until the start of your next turn",
        lifetime: "later",
        durationMessage: { id: "engine.effect.duration.until.your.next.turn" },
      }),
    ]);
    g.endTurn();
    expect(ongoing(g, "this round's on me|3").map((effect) => effect.label))
      .toEqual(["attacks that target you get -1 power · until the start of your next turn"]);
  });
});

describe("whole-turn riders beside a next-attack buff", () => {
  it("keeps Glistening Steelblade's Dawnblade counter rider as its own effect", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["glistening steelblade|2"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("glistening steelblade|2");

    expect(ongoing(g, "glistening steelblade|2").map((effect) => effect.label)).toEqual([
      "go again · next weapon attack",
      "whenever Dawnblade hits a hero, put a +1 power counter on it · this turn",
    ]);
  });
});

describe("structured effect facts", () => {
  it("reports Draco Fire's power and both cost reductions for the next attack", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["draco fire|1"] }, { hero: "dorinthea" }],
    });
    g.play("draco fire|1");

    expect(ongoing(g, "draco fire|1")).toEqual([
      expect.objectContaining({
        label: "+2 power, costs 1 less to play or activate · next Draconic attack",
        facts: { power: 2, playCostReduction: 1, activationCostReduction: 1, nextAttack: true },
      }),
    ]);
  });

  it("reports a typed next-attack bonus", () => {
    const g = scenario({ seats: [{ hero: "rhinar", hand: ["sizzle|1"] }, { hero: "dorinthea" }] });
    g.play("sizzle|1");

    expect(ongoing(g, "sizzle|1")).toEqual([
      expect.objectContaining({
        label: "+3 power · next Lightning or Elemental attack",
        facts: { power: 3, nextAttack: true },
      }),
    ]);
  });

  it("reports Toe the Line's pending prevention", () => {
    const g = scenario({
      seats: [
        { hero: "rhinar", hand: ["snatch|1"] },
        { hero: "dorinthea", hand: ["toe the line|1"] },
      ],
    });
    g.play("snatch|1", { settle: false })
      .passPriority().passPriority().passPriority().passPriority()
      .blockWith()
      .passPriority()
      .react("toe the line|1", { settle: false })
      .passPriority().passPriority();

    expect(projectStateFor(g.state, 1).ongoing.filter((effect) =>
      effect.cardId === printingId("toe the line|1")
    ).map((effect) => effect.facts)).toEqual([{ preventDamage: 2 }]);
  });

  it("keeps a whole-turn rider out of the next-attack facts", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["glistening steelblade|2"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("glistening steelblade|2");

    expect(ongoing(g, "glistening steelblade|2").map((effect) => effect.facts)).toEqual([
      { goAgain: true, nextAttack: true },
      {},
    ]);
  });
});
