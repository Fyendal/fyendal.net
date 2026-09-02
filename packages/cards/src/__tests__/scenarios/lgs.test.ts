import { projectStateFor } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { printingId, scenario } from "../harness.js";

/** Scenarios for the LGS set: Wrecking Ball and the Chief Ruk'utan mentor. */

describe("LGS — Wrecking Ball (draw then discard on attack)", () => {
  it("discarding a 6+ card intimidates — and Rhinar's hero adds a second", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3", "dodge|3"] },
        {
          hero: "rhinar",
          hand: ["wrecking ball|1", "wrecker romp|3", "muscle mutt|2"],
          deck: ["pack hunt|1"], // drawn card is 6+, so either random discard qualifies
        },
      ],
      active: 1,
    });
    g.play("wrecking ball|1", { pitch: ["wrecker romp|3"] })
      .expectLog("Wrecking Ball: intimidate")
      .expectLog("Rhinar's ability triggers")
      .expectAttackValue(6)
      .expectPendingReturn(0, 2) // Wrecking Ball's trigger + the hero's
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });

  it("no intimidate when the discard is smaller than 6", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: ["dodge|3"] },
        {
          hero: "rhinar",
          hand: ["wrecking ball|1", "wrecker romp|3", "clearing bellow|3"],
          deck: ["dodge|3"], // drawn card and the only other hand card are both below 6
        },
      ],
      active: 1,
    });
    g.play("wrecking ball|1", { pitch: ["wrecker romp|3"] })
      .expectNoLog("Wrecking Ball: intimidate")
      .expectNoLog("Rhinar's ability triggers")
      .expectPendingReturn(0, 0)
      .blockWith()
      .settle()
      .expectLife(0, 14);
  });
});

describe("LGS — Chief Ruk'utan (mentor)", () => {
  it("flip, two 6+ plays in one turn → lesson counters, intimidate, payoff searches Alpha Rampage", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        {
          hero: "rhinar",
          mentor: true,
          hand: [
            "wild ride|1",
            "raging onslaught|2",
            "muscle mutt|2",
            "pack hunt|1",
            "wrecker romp|3",
          ],
          // Wild Ride draws the Raging Onslaught; every hand card is 6+, so
          // any random discard gives it go again. Alpha Rampage stays in deck.
          deck: ["raging onslaught|2", "alpha rampage|1"],
        },
      ],
      active: 1,
    });
    g.endTurn() // turn 2, Dorinthea
      .endTurn() // turn 3, Rhinar — flip trigger pends
      .chooseOption("yes")
      .expectFaceDown(1, "chief ruk'utan|0", false)
      .play("wild ride|1", { pitch: ["raging onslaught|2"] })
      .expectLog("Chief Ruk'utan gets a lesson counter (1)")
      .expectLog("Wild Ride gains go again")
      .blockWith()
      .settle()
      .expectAP(1, 1)
      .play("pack hunt|1", { pitch: ["wrecker romp|3"] })
      .expectLog("Chief Ruk'utan gets a lesson counter (2)")
      .expectInZone(1, "chief ruk'utan|0", "banish")
      .expectInZone(1, "alpha rampage|1", "arsenal")
      .expectFaceDown(1, "alpha rampage|1", false) // put into arsenal face up
      .blockWith()
      .settle()
      .expectLife(0, 8); // 6 (Wild Ride) + 6 (Pack Hunt)

    const ownerLog = projectStateFor(g.state, 1).logEntries ?? [];
    const opponentLog = projectStateFor(g.state, 0).logEntries ?? [];
    expect(ownerLog).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.common.lesson.counter.gained",
        values: {
          card: { kind: "card", cardId: printingId("chief ruk'utan|0") },
          count: 2,
        },
      },
    }));
    expect(ownerLog).toContainEqual(expect.objectContaining({
      message: {
        id: "card.log.common.mentor.search.private",
        values: {
          result: { kind: "card", cardId: printingId("alpha rampage|1") },
        },
      },
      event: expect.objectContaining({
        kind: "card-moved",
        cardId: printingId("alpha rampage|1"),
        from: "deck",
        to: "arsenal",
      }),
    }));
    const publicSearch = opponentLog.find(
      (entry) => "message" in entry &&
        entry.message.id === "card.log.common.mentor.search.public",
    );
    expect(publicSearch).toMatchObject({
      event: {
        kind: "card-moved",
        ownerSeat: 1,
        from: "deck",
        to: "arsenal",
      },
    });
    expect(JSON.stringify(publicSearch)).not.toContain(printingId("alpha rampage|1"));
  });

  // lesson counters live on the mentor card itself (persistent counters), so
  // they survive end-of-turn cleanup and accumulate across turns
  it("lesson counters persist across turns", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        {
          hero: "rhinar",
          mentor: true,
          hand: ["pack hunt|1", "raging onslaught|2", "wounded bull|2", "wrecker romp|3"],
          // two draws after the first turn take the Dodges; Alpha Rampage stays findable
          deck: ["dodge|3", "dodge|3", "alpha rampage|1"],
        },
      ],
      active: 1,
    });
    g.endTurn() // turn 2, Dorinthea
      .endTurn() // turn 3, Rhinar — flip trigger pends
      .chooseOption("yes")
      .play("pack hunt|1", { pitch: ["raging onslaught|2"] })
      .expectLog("Chief Ruk'utan gets a lesson counter (1)")
      .blockWith()
      .settle()
      .endTurn() // turn 4, Dorinthea — end-of-turn cleanup must keep the counter
      .endTurn() // turn 5, Rhinar
      .play("wounded bull|2", { pitch: ["wrecker romp|3"] })
      .expectLog("Chief Ruk'utan gets a lesson counter (2)")
      .expectInZone(1, "chief ruk'utan|0", "banish")
      .expectInZone(1, "alpha rampage|1", "arsenal")
      .blockWith()
      .settle();
  });

  it("the flip can be declined; the mentor stays face down", () => {
    const g = scenario({
      seats: [
        { hero: "dorinthea", hand: [] },
        { hero: "rhinar", hand: [], mentor: true },
      ],
      active: 1,
    });
    g.endTurn()
      .endTurn()
      .chooseOption("no")
      .expectFaceDown(1, "chief ruk'utan|0", true)
      .expectInZone(1, "chief ruk'utan|0", "arsenal");
  });
});
