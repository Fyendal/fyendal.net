import { describe, expect, it } from "vitest";
import {
  anyTargetChoice,
  arcaneSpell,
  chargeAttack,
  decompose,
  galvanize,
  heroChoiceSeat,
  isChargeDecline,
  isFused,
  isFusedWith,
  maintenanceItem,
  resolveReload,
  withFusion,
} from "../../scripts/shared-helpers.js";
import { registry } from "../../scripts/index.js";
import { fakeCtx, fakePlayer } from "../fakeCtx.js";

// Pending decisions in stored games still carry these pre-consolidation hooks and options.

describe("legacy charge-cost hooks", () => {
  it.each(["charge-cost", "asb-charge", "dtd-charge", "iar-bravery-charge", "mon-charge"])(
    "%s charges the chosen card and records its pitch",
    (hook) => {
      const extra: string[] = [];
      const script = chargeAttack({ onChoose: (_ctx, h) => void extra.push(h) });
      const { ctx, called } = fakeCtx({
        cardData: { BLUE: { name: "Blue", pitch: 3 } },
        returns: { charge: { instanceId: 7, cardId: "BLUE" } },
      });

      script.onChoose!(ctx, hook, "7");

      expect(called("charge")).toEqual([[7]]);
      expect(ctx.getState("chargedPitch")).toBe(3);
      expect(extra).toEqual([]);
    },
  );

  it("declines with the old \"no\" option as well as \"pass\"", () => {
    expect(isChargeDecline("no")).toBe(true);
    expect(isChargeDecline("pass")).toBe(true);
    const { ctx, called } = fakeCtx();
    chargeAttack().onChoose!(ctx, "mon-charge", "no");
    expect(called("charge")).toEqual([]);
  });
});

describe("legacy reload hooks", () => {
  it.each(["reload", "aaz-reload", "arc-reload", "cru-high-reload", "ele-reload", "high-reload", "over-flex-reload"])(
    "%s reloads the chosen card face down",
    (hook) => {
      const { ctx, called } = fakeCtx();
      expect(resolveReload(ctx, hook, "7")).toBe(true);
      expect(called("putIntoArsenal")).toEqual([[7, "hand", { faceUp: false }]]);
    },
  );

  it("accepts old hooks only for the default reload hook", () => {
    const { ctx, called } = fakeCtx();
    expect(resolveReload(ctx, "arc-reload", "7", "custom-reload")).toBe(false);
    expect(called("putIntoArsenal")).toEqual([]);
  });
});

describe("legacy fusion hooks", () => {
  const fusing = (type: string) => {
    const card = { instanceId: 7, cardId: "FUSE", types: [type] };
    return fakeCtx({ players: [fakePlayer(0, { hand: [card] }), fakePlayer(1)], returns: { revealCards: true } });
  };

  it.each([
    ["fusion", "lightning"],
    ["high-fuse:earth", "earth"],
    ["high-fuse:ice", "ice"],
    ["high-fuse:lightning", "lightning"],
    ["upr-high-fuse", "ice"],
    ["oaken-fuse-ice", "ice"],
  ] as const)("%s completes a %s fusion", (hook, type) => {
    const { ctx, called } = fusing(type);
    const passed: string[] = [];
    withFusion(type, { onChoose: (_ctx, h) => void passed.push(h) }).onChoose!(ctx, hook, "7");

    expect(called("revealCards")).toEqual([[[7]]]);
    expect(isFused(ctx)).toBe(true);
    expect(isFusedWith(ctx, type)).toBe(true);
    expect(passed).toEqual([]);
  });

  it("ajv-fusion completes an and/or fusion", () => {
    const { ctx } = fusing("ice");
    withFusion(["earth", "ice"]).onChoose!(ctx, "ajv-fusion", "ice:7");
    expect(isFusedWith(ctx, "ice")).toBe(true);
    expect(isFusedWith(ctx, "earth")).toBe(false);
  });

  it("passes a hook of another element on to the card", () => {
    const { ctx } = fusing("ice");
    const passed: string[] = [];
    withFusion("ice", { onChoose: (_ctx, h) => void passed.push(h) }).onChoose!(ctx, "high-fuse:earth", "7");
    expect(passed).toEqual(["high-fuse:earth"]);
    expect(isFused(ctx)).toBe(false);
  });
});

describe("legacy maintenance hooks", () => {
  it.each(["maintenance", "evo-maintenance", "aio-maintenance"])("%s removes a steam counter or destroys", (hook) => {
    const script = maintenanceItem(2);
    const remove = fakeCtx({ self: { instanceId: 1, cardId: "SELF", counters: { steam: 2 } } });
    script.onChoose!(remove.ctx, hook, "remove");
    expect(remove.called("setCounter")).toEqual([["steam", 1]]);

    const destroy = fakeCtx();
    script.onChoose!(destroy.ctx, hook, "destroy");
    expect(destroy.called("destroySelf")).toEqual([[]]);
  });

  it("SEA cogs keep their sea-cog-maintenance hook for saved standing orders", () => {
    const cog = registry["golden cog|0"]!;
    expect(cog.triggers?.[0]?.standingChoice?.hook).toBe("sea-cog-maintenance");
    const { ctx, called } = fakeCtx({ self: { instanceId: 1, cardId: "SELF", counters: { steam: 1 } } });
    cog.onChoose!(ctx, "sea-cog-maintenance", "remove");
    expect(called("setCounter")).toEqual([["steam", 0]]);
  });
});

describe("legacy galvanize hook", () => {
  it("evo-galvanize destroys the chosen item for +2 defense", () => {
    const { ctx, called } = fakeCtx({ returns: { destroyPermanent: true } });
    galvanize().onChoose!(ctx, "evo-galvanize", "9");
    expect(called("destroyPermanent")).toEqual([[9]]);
    expect(called("addModifier")).toEqual([[{ scope: "chain-link", defense: 2 }]]);
  });

  it("evo-galvanize's old \"no\" destroys nothing", () => {
    const { ctx, called } = fakeCtx({ returns: { destroyPermanent: true } });
    galvanize().onChoose!(ctx, "evo-galvanize", "no");
    expect(called("destroyPermanent")).toEqual([]);
  });
});

describe("legacy decompose hooks", () => {
  const graveyard = [
    { instanceId: 11, types: ["earth"] },
    { instanceId: 12, types: ["earth"] },
    { instanceId: 13, cardTypes: ["action"] },
  ];

  it("pen-prefixed hooks walk the same three choices and pay off", () => {
    let paid = 0;
    const script = decompose("play", () => void paid++);
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, { graveyard }), fakePlayer(1)],
      returns: { banish: true },
    });

    script.onChoose!(ctx, "pen-decompose-earth-1", "11");
    expect(called("requestCardChoice").at(-1)?.[0]).toBe("decompose-earth-2");
    script.onChoose!(ctx, "pen-decompose-earth-2", "12");
    expect(called("requestCardChoice").at(-1)?.[0]).toBe("decompose-action");
    script.onChoose!(ctx, "pen-decompose-action", "13");

    expect(called("banish")).toEqual([[11], [12], [13]]);
    expect(paid).toBe(1);
  });
});

describe("legacy hero options", () => {
  it("UPR's \"you\"/\"opponent\" still name heroes", () => {
    const { ctx } = fakeCtx({ seat: 1 });
    expect(heroChoiceSeat(ctx, "you")).toBe(1);
    expect(heroChoiceSeat(ctx, "opponent")).toBe(0);
    expect(anyTargetChoice(ctx, "opponent")).toEqual({ seat: 0 });
    expect(heroChoiceSeat(ctx, "pass")).toBeUndefined();
  });

  it("UPR's \"arcane\" hook still takes hero and ally instance ids", () => {
    const ally = { instanceId: 55, types: ["ally"] };
    const players = [fakePlayer(0), fakePlayer(1, { board: [ally] })];
    const script = arcaneSpell(2);

    const hero = fakeCtx({ players });
    script.onChoose!(hero.ctx, "arcane", String(players[1]!.hero.instanceId));
    expect(hero.called("dealDamage")).toEqual([[1, 2, { arcane: true, targetAllyId: undefined }]]);

    const allyCtx = fakeCtx({ players });
    script.onChoose!(allyCtx.ctx, "arcane", "55");
    expect(allyCtx.called("dealDamage")).toEqual([[1, 2, { arcane: true, targetAllyId: 55 }]]);
  });

  it("AJV Exposed to the Elements still takes an old seat-number option", () => {
    const script = registry["exposed to the elements|3"]!;
    const { ctx, called } = fakeCtx({ returns: { requestPayment: true } });
    script.onChoose!(ctx, "exposed-hero", "1");
    expect(ctx.getState("exposedTarget")).toBe(1);
    expect(called("requestPayment")[0]?.[3]).toBe(1);
  });
});

describe("legacy Construct Nitro Mechanoid hook", () => {
  it("an unsuffixed driver choice transforms the first Mechanologist weapon", () => {
    const mech = (instanceId: number) => ({ instanceId, types: ["mechanologist"] });
    const drivers = [50, 51, 52, 53].map((instanceId) => ({ instanceId, names: ["Hyper Driver"] }));
    const { ctx, called } = fakeCtx({
      players: [
        fakePlayer(0, {
          equipment: { head: mech(1), chest: mech(2), arms: mech(3), legs: mech(4) },
          weapons: [mech(40), mech(41)],
          board: drivers,
        }),
        fakePlayer(1),
      ],
    });

    registry["construct nitro mechanoid|2"]!.onChooseMany!(ctx, "nitro-mechanoid-drivers", ["51", "52", "53"]);

    expect(called("transformInto")).toEqual([["DYN092B", [1, 2, 3, 4, 40, 51, 52, 53]]]);
  });
});
