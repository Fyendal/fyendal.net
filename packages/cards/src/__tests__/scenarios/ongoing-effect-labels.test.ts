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
        label: "+2 attack · next Brute attack",
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
      "+1 attack · next red attack",
      "+2 attack · next yellow attack",
      "+3 attack · next blue attack",
    ]);
  });

  it("projects repeated identical bonuses separately so the client stacks them", () => {
    const g = scenario({
      seats: [{ hero: "rhinar", hand: ["sprout strength|1"], resources: 3 }, { hero: "dorinthea" }],
    });
    g.play("sprout strength|1");

    expect(ongoing(g, "sprout strength|1").map((effect) => effect.label))
      .toEqual(Array(3).fill("+1 attack · next attack"));
  });

  it("composes a localizable list of several phrases for one attack", () => {
    const g = scenario({
      seats: [{ hero: "dorinthea", hand: ["driving blade|1"], resources: 3 }, { hero: "rhinar" }],
    });
    g.play("driving blade|1");

    expect(ongoing(g, "driving blade|1")).toEqual([
      expect.objectContaining({
        label: "+3 attack, go again · next weapon attack",
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
        label: "+2 attack · Brute attacks this turn",
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
      expect.objectContaining({ label: "+3 attack · next attack action card with cost 1 or less" }),
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
          id: "engine.effect.duration.cards.this.chain",
          values: { subtype: "dagger", cardType: "any", noun: "weapon" },
        },
      }),
    ]);
  });
});
