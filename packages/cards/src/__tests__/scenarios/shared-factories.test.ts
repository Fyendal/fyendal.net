import { describe, expect, it } from "vitest";
import type { CardScript, ScriptCtx, TriggerDef } from "@fyendal/engine";
import {
  attackingWeapon,
  beatChest,
  channelLightning,
  chargeAttack,
  clashForToken,
  contractWithSilver,
  decompose,
  discardUnlessPay,
  equipWithSilver,
  evoEquipment,
  galvanize,
  hyperDriver,
  hyperDriverCounterFromBoostBanish,
  isFused,
  isFusedWith,
  isMarked,
  maintenanceItem,
  markHero,
  optN,
  optOnChoose,
  payForDefenseBoost,
  pitches,
  reload,
  requestCrankSteam,
  requestDiscardChoice,
  resolveCrankSteam,
  resourceAbility,
  splitScript,
  suspenseAura,
  withFusion,
  wizardActionAsInstant,
} from "../../scripts/shared-helpers.js";
import { SILVER } from "../../scripts/tokens.js";
import { fakeCtx, fakePlayer, type FakeCard } from "../fakeCtx.js";
import { scenario } from "../harness.js";

const trigger = (script: CardScript, index = 0): TriggerDef => script.triggers![index]!;
const run = (fn: ((ctx: ScriptCtx) => void) | undefined, ctx: ScriptCtx) => fn!(ctx);

describe("withFusion", () => {
  const hand = (...cards: FakeCard[]) => fakeCtx({
    players: [fakePlayer(0, { hand: cards }), fakePlayer(1)],
    returns: { revealCards: true },
  });

  it("asks for the fusion before the card's own additional cost and passes other choices on", () => {
    const order: string[] = [];
    const script = withFusion("ice", {
      additionalCost: () => void order.push("card cost"),
      onChoose: (_ctx, hook) => void order.push(`card ${hook}`),
    });
    const { ctx, called } = hand({ instanceId: 7, types: ["ice"] });

    script.additionalCost!(ctx);
    expect(called("requestCardChoice")[0]?.slice(0, 1)).toEqual(["ice-fusion"]);
    expect(called("requestCardChoice")[0]?.[2]).toEqual(["no", 7]);
    script.onChoose!(ctx, "other", "1");
    script.onChoose!(ctx, "ice-fusion", "no");

    expect(order).toEqual(["card cost", "card other"]);
    expect(isFused(ctx)).toBe(false);
  });

  it("skips the fusion offer, but not the card's cost, with no matching card in hand", () => {
    const order: string[] = [];
    const { ctx, called } = hand({ instanceId: 7, types: ["earth"] });
    withFusion("ice", { additionalCost: () => void order.push("card cost") }).additionalCost!(ctx);
    expect(called("requestCardChoice")).toEqual([]);
    expect(order).toEqual(["card cost"]);
  });

  it("\"and\" fusion asks for the first element only when the second is also in hand", () => {
    const { ctx, called } = hand({ instanceId: 7, types: ["earth"] });
    withFusion(["earth", "lightning"], {}, "and").additionalCost!(ctx);
    expect(called("requestCardChoice")).toEqual([]);
  });

  it("\"and\" fusion lets one card with both elements count for both", () => {
    const script = withFusion(["earth", "lightning"], {}, "and");
    const { ctx, called } = hand({ instanceId: 7, types: ["earth", "lightning"] });

    script.additionalCost!(ctx);
    script.onChoose!(ctx, "earth-fusion", "7");
    expect(called("requestCardChoice").at(-1)?.[0]).toBe("lightning-fusion");
    script.onChoose!(ctx, "lightning-fusion", "7");

    expect(called("revealCards")).toEqual([[[7]]]);
    expect(isFusedWith(ctx, "earth") && isFusedWith(ctx, "lightning")).toBe(true);
  });

  it("\"and\" fusion fails when the second reveal is declined", () => {
    const script = withFusion(["earth", "lightning"], {}, "and");
    const { ctx, called } = hand({ instanceId: 7, types: ["earth"] }, { instanceId: 8, types: ["lightning"] });
    script.onChoose!(ctx, "earth-fusion", "7");
    script.onChoose!(ctx, "lightning-fusion", "no");
    expect(called("revealCards")).toEqual([]);
    expect(isFused(ctx)).toBe(false);
  });

  it("and/or fusion offers each element and each pair", () => {
    const { ctx, called } = hand({ instanceId: 7, types: ["earth"] }, { instanceId: 8, types: ["lightning"] });
    withFusion(["earth", "lightning"]).additionalCost!(ctx);
    expect(called("requestChoice")[0]?.[0]).toBe("elemental-fusion");
    expect(called("requestChoice")[0]?.[2]).toEqual(["no", "earth:7", "lightning:8", "both:7:8"]);
  });

  it("Ice fusion creates the Frostbites Isenhowl Weathervane set up, once", () => {
    const { ctx, called } = hand({ instanceId: 7, types: ["ice"] });
    ctx.setPlayerFlag(0, "nextIceFusionFrostbites:1", 2);
    withFusion("ice").onChoose!(ctx, "ice-fusion", "7");
    expect(called("createTokens")).toEqual([["AJV029", 2, 1]]);
    expect(ctx.getPlayerFlag(0, "nextIceFusionFrostbites:1")).toBe(0);
  });
});

describe("chargeAttack", () => {
  it("runs the card's own additional cost even with nothing to charge", () => {
    const order: string[] = [];
    const { ctx, called } = fakeCtx();
    chargeAttack({ additionalCost: () => void order.push("card cost") }).additionalCost!(ctx);
    expect(called("requestCardChoice")).toEqual([]);
    expect(order).toEqual(["card cost"]);
  });

  it("offers decline first, then each hand card", () => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, { hand: [{ instanceId: 7 }, { instanceId: 8 }] }), fakePlayer(1)] });
    chargeAttack().additionalCost!(ctx);
    expect(called("requestCardChoice")[0]?.[2]).toEqual(["pass", 7, 8]);
  });

  it("leaves chargedPitch unset when the charge fails", () => {
    const { ctx } = fakeCtx({ returns: { charge: undefined } });
    chargeAttack().onChoose!(ctx, "charge-cost", "7");
    expect(ctx.getState("chargedPitch")).toBe(0);
  });
});

describe("reload", () => {
  it("offers pass, then each hand card, into an empty arsenal", () => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, { hand: [{ instanceId: 7 }] }), fakePlayer(1)] });
    reload(ctx);
    expect(called("requestCardChoice")).toEqual([["reload", expect.anything(), ["pass", 7]]]);
  });

  it.each([
    ["the arsenal is full", { hand: [{ instanceId: 7 }], arsenal: [{ instanceId: 9 }] }],
    ["the hand is empty", {}],
  ])("does nothing when %s", (_case, spec) => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, spec), fakePlayer(1)] });
    reload(ctx);
    expect(called("requestCardChoice")).toEqual([]);
  });
});

describe("maintenanceItem", () => {
  it("AIO Cerebellum Processor asks to remove a steam counter at the start of its controller's turn", () => {
    const g = scenario({
      active: 1,
      seats: [{ hero: "rhinar", board: ["cerebellum processor|3"] }, { hero: "dorinthea" }],
    });
    g.state.players[0]!.board[0]!.counters = { steam: 2 };

    g.endTurn();
    expect(g.state.pendingDecision).toMatchObject({ player: 0, chooseHook: "maintenance", options: ["remove", "destroy"] });
    g.chooseOption("remove");

    expect(g.state.players[0]!.board[0]!.counters?.steam).toBe(1);
  });

  it("destroys itself without asking once its steam is gone", () => {
    const { ctx, called } = fakeCtx();
    trigger(maintenanceItem(1)).effect!(ctx);
    expect(called("destroySelf")).toEqual([[]]);
    expect(called("requestChoice")).toEqual([]);
  });

  it("declares a standing choice on its hook and keeps the card's own hooks", () => {
    const seen: string[] = [];
    const extraTrigger = { event: "end-of-turn", label: "extra" } as TriggerDef;
    const script = maintenanceItem(3, {
      onEnterArena: () => void seen.push("enter"),
      onChoose: (_ctx, hook) => void seen.push(hook),
      triggers: [extraTrigger],
    }, "custom");
    const { ctx, called } = fakeCtx();

    script.onEnterArena!(ctx);
    script.onChoose!(ctx, "other", "x");

    expect(called("setCounter")).toEqual([["steam", 3]]);
    expect(trigger(script).standingChoice).toMatchObject({ hook: "custom", options: ["remove", "destroy"] });
    expect(script.triggers![1]).toBe(extraTrigger);
    expect(seen).toEqual(["enter", "other"]);
  });
});

describe("crank and Hyper Driver", () => {
  const items = [
    { instanceId: 7, types: ["item"], crank: true },
    { instanceId: 8, types: ["item"] },
    { instanceId: 9, types: ["ally"], crank: true },
  ];

  it("requestCrankSteam offers only items with crank, optionally with \"no\"", () => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, { board: items }), fakePlayer(1)] });
    requestCrankSteam(ctx, "hook");
    requestCrankSteam(ctx, "hook", true);
    expect(called("requestCardChoice").map((args) => args[2])).toEqual([[7], ["no", 7]]);
  });

  it("requestCrankSteam does nothing without a crank item", () => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, { board: [items[1]!] }), fakePlayer(1)] });
    requestCrankSteam(ctx, "hook", true);
    expect(called("requestCardChoice")).toEqual([]);
  });

  it("resolveCrankSteam adds steam only to a card its controller still has", () => {
    const { ctx, called } = fakeCtx({ players: [fakePlayer(0, { board: items }), fakePlayer(1)] });
    resolveCrankSteam(ctx, "7");
    resolveCrankSteam(ctx, "99");
    resolveCrankSteam(ctx, "no");
    expect(called("addCounter")).toEqual([[7, "steam", 1]]);
  });

  it("hyperDriver gains resources from steam once per turn", () => {
    const script = hyperDriver(2);
    const { ctx, called } = fakeCtx();
    script.onEnterArena!(ctx);
    const boost = trigger(script);
    expect(boost.condition!(ctx, undefined, undefined)).toBe(true);
    boost.onTrigger!(ctx, undefined, undefined);
    expect(boost.condition!(ctx, undefined, undefined)).toBe(false);
    run(boost.effect as (ctx: ScriptCtx) => void, ctx);
    expect(ctx.getCounter("steam")).toBe(1);
    expect(called("gainResources")).toEqual([[0, 1]]);
  });

  it("a boost-banished card puts steam on a lone Hyper Driver and asks among several", () => {
    const driver = (instanceId: number): FakeCard => ({ instanceId, names: ["Hyper Driver"], counters: { steam: 1 } });
    const script = hyperDriverCounterFromBoostBanish();

    const one = fakeCtx({ players: [fakePlayer(0, { board: [driver(5)] }), fakePlayer(1)] });
    script.onBanishedForBoost!(one.ctx, { instanceId: 9 } as never);
    expect(one.called("addCounter")).toEqual([[5, "steam", 1]]);

    const two = fakeCtx({ players: [fakePlayer(0, { board: [driver(5), driver(6)] }), fakePlayer(1)] });
    script.onBanishedForBoost!(two.ctx, { instanceId: 9 } as never);
    expect(two.called("requestCardChoice")[0]?.[2]).toEqual([5, 6]);
    script.onChoose!(two.ctx, "common-hyper-driver-steam-from-boost", "6");
    expect(two.called("addCounter")).toEqual([[6, "steam", 1]]);
  });
});

describe("galvanize and evo equipment", () => {
  it("galvanize offers \"none\" and each item, after which the card's own defend effect runs", () => {
    const order: string[] = [];
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, { board: [{ instanceId: 7, types: ["item"] }, { instanceId: 8 }] }), fakePlayer(1)],
    });
    galvanize({ onDefend: () => void order.push("card defend") }).onDefend!(ctx);
    expect(called("requestCardChoice")[0]?.slice(0, 1)).toEqual(["galvanize"]);
    expect(called("requestCardChoice")[0]?.[2]).toEqual(["none", 7]);
    expect(order).toEqual(["card defend"]);
  });

  it("galvanize without items asks nothing", () => {
    const { ctx, called } = fakeCtx();
    galvanize().onDefend!(ctx);
    expect(called("requestCardChoice")).toEqual([]);
  });

  it("evo equipment is an instant while a next-Evo effect is live, else as the card says", () => {
    const { ctx } = fakeCtx();
    expect(evoEquipment().playAsInstant!(ctx)).toBe(false);
    expect(evoEquipment({ playAsInstant: () => true }).playAsInstant!(ctx)).toBe(true);
    ctx.setPlayerFlag(0, "nextEvoAsInstant", true);
    expect(evoEquipment().playAsInstant!(ctx)).toBe(true);
  });
});

describe("beatChest", () => {
  it("offers only cards with 6 or more base power and records a paid beat chest", () => {
    const hand = [{ instanceId: 7, cardId: "BIG" }, { instanceId: 8, cardId: "SMALL" }];
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, { hand }), fakePlayer(1)],
      props: { basePower: (card: FakeCard) => (card.cardId === "BIG" ? 6 : 5) },
      returns: { discardCard: { instanceId: 7 } },
    });
    const script = beatChest();

    script.additionalCost!(ctx);
    expect(called("requestCardChoice")[0]?.[2]).toEqual(["no", 7]);
    script.onChoose!(ctx, "beat-chest", "7");

    expect(called("discardCard")).toEqual([[0, 7]]);
    expect(ctx.getFlag("player", "beatenChestThisTurn")).toBe(true);
    expect(ctx.getFlag("player", "discardingToBeatChest")).toBe(false);
  });

  it("declining discards nothing and leaves the chest unbeaten", () => {
    const { ctx, called } = fakeCtx();
    beatChest().onChoose!(ctx, "beat-chest", "no");
    expect(called("discardCard")).toEqual([]);
    expect(ctx.getFlag("player", "beatenChestThisTurn")).toBe(false);
  });
});

describe("discards", () => {
  it("requestDiscardChoice asks the target and fails on an empty hand", () => {
    const players = [fakePlayer(0), fakePlayer(1, { hand: [{ instanceId: 7 }] })];
    const { ctx, called } = fakeCtx({ players });
    expect(requestDiscardChoice(ctx, "hook", "prompt", 0)).toBe(false);
    expect(requestDiscardChoice(ctx, "hook", "prompt", 1)).toBe(true);
    expect(called("requestCardChoice")).toEqual([["hook", "prompt", [7], 1]]);
  });

  it("discardUnlessPay asks for a discard only when the payment can't be offered", () => {
    const players = [fakePlayer(0), fakePlayer(1, { hand: [{ instanceId: 7 }] })];
    const paying = fakeCtx({ players, returns: { requestPayment: true } });
    discardUnlessPay(paying.ctx, 1, 2, "key");
    expect(paying.called("requestPayment")[0]?.[0]).toBe("key:pay:1");
    expect(paying.called("requestCardChoice")).toEqual([]);

    const broke = fakeCtx({ players, returns: { requestPayment: false } });
    discardUnlessPay(broke.ctx, 1, 2, "key");
    expect(broke.called("requestCardChoice")).toEqual([["key:discard:1", expect.anything(), [7], 1]]);
  });
});

describe("payForDefenseBoost", () => {
  it("asks on defend, and a payment adds defense and marks the card for destruction", () => {
    const script = payForDefenseBoost(1, 2, { destroyOnClose: true });
    const { ctx, called } = fakeCtx();
    expect(script.defendCost).toBe(1);
    script.onDefend!(ctx);
    script.onChoose!(ctx, "pay-boost", "paid");
    expect(called("requestPayment")[0]?.[0]).toBe("pay-boost");
    expect(called("addModifier")).toEqual([[{ scope: "chain-link", defense: 2 }]]);
    expect(ctx.getFlag("link", "destroyOnClose:1")).toBe(true);
  });

  it("asks on play with onPlay and ignores a declined payment", () => {
    const script = payForDefenseBoost(1, 1, { onPlay: true });
    const { ctx, called } = fakeCtx();
    expect(script.onDefend).toBeUndefined();
    script.onPlay!(ctx);
    script.onChoose!(ctx, "pay-boost", "no");
    expect(called("addModifier")).toEqual([]);
  });
});

describe("decompose", () => {
  it("offers nothing without two Earth cards and an action card, but still runs the card's own effect", () => {
    const order: string[] = [];
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, { graveyard: [{ instanceId: 11, types: ["earth"] }, { instanceId: 13, cardTypes: ["action"] }] }), fakePlayer(1)],
    });
    decompose("play", () => void order.push("payoff"), () => void order.push("before")).onPlay!(ctx);
    expect(order).toEqual(["before"]);
    expect(called("requestCardChoice")).toEqual([]);
  });

  it("ignores face-down graveyard cards", () => {
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, {
        graveyard: [
          { instanceId: 11, types: ["earth"] },
          { instanceId: 12, types: ["earth"], faceDown: true },
          { instanceId: 13, cardTypes: ["action"] },
        ],
      }), fakePlayer(1)],
    });
    decompose("attack", () => undefined).onAttackDeclared!(ctx);
    expect(called("requestCardChoice")).toEqual([]);
  });
});

describe("silver and contracts", () => {
  it("contractWithSilver completes the contract and creates Silver only when the condition holds", () => {
    const script = contractWithSilver((_ctx, card) => card.instanceId === 7);
    const { ctx, called } = fakeCtx();
    script.onFriendlyBanishesOpponentCard!(ctx, { instanceId: 8 } as never);
    script.onFriendlyBanishesOpponentCard!(ctx, { instanceId: 7 } as never);
    expect(called("completeContract")).toEqual([[]]);
    expect(called("createToken")).toEqual([[SILVER]]);
  });

  it("equipWithSilver needs enough Silver and equips after destroying them", () => {
    const silver = (instanceId: number): FakeCard => ({ instanceId, names: ["Silver"] });
    const t = equipWithSilver(2);
    const few = fakeCtx({ players: [fakePlayer(0, { board: [silver(5)] }), fakePlayer(1)] });
    expect(t.condition!(few.ctx, undefined, undefined)).toBe(false);

    const enough = fakeCtx({
      players: [fakePlayer(0, { board: [silver(5), silver(6), silver(7)] }), fakePlayer(1)],
      returns: { destroyPermanent: true },
    });
    expect(t.condition!(enough.ctx, undefined, undefined)).toBe(true);
    run(t.effect as (ctx: ScriptCtx) => void, enough.ctx);
    expect(enough.called("destroyPermanent")).toEqual([[5], [6]]);
    expect(enough.called("equipFromGraveyard")).toEqual([[1]]);
  });
});

describe("markHero", () => {
  it("marks an unmarked hero once and logs it", () => {
    const players = [fakePlayer(0), fakePlayer(1)];
    const { ctx, called } = fakeCtx({
      players,
      props: {
        addCardState: (instanceId: number, key: string, n: number) => {
          players[1]!.hero.scriptState = { [key]: n };
        },
      },
    });
    expect(isMarked(ctx, 1)).toBe(false);
    markHero(ctx, 1);
    markHero(ctx, 1);
    expect(isMarked(ctx, 1)).toBe(true);
    expect(called("logPublic")).toHaveLength(1);
  });
});

describe("suspenseAura", () => {
  it("enters with two suspense counters, loses one each start of turn and is destroyed at zero", () => {
    const script = suspenseAura({ logCounterRemoval: true });
    const { ctx, called } = fakeCtx();
    script.onEnterArena!(ctx);
    const tick = script.triggers!.find((t) => t.event === "start-of-turn")!;
    run(tick.effect as (ctx: ScriptCtx) => void, ctx);
    run(tick.effect as (ctx: ScriptCtx) => void, ctx);
    expect(ctx.getCounter("suspense")).toBe(0);
    expect(called("destroySelf")).toEqual([[]]);
    expect(called("logPublic")).toHaveLength(2);
    expect(script.destroyAtZeroCounter).toBe("suspense");
  });

  it("turns enter and leave abilities into arena triggers and counts auras that left", () => {
    const effect = () => undefined;
    const script = suspenseAura({
      enters: { label: "in", labelMessage: { id: "in" }, effect },
      leaves: [{ label: "out", labelMessage: { id: "out" }, effect, optional: true }],
    });
    expect(script.triggers!.map((t) => [t.event, t.label])).toEqual([
      ["card-entered-arena", "in"],
      ["card-left-arena", "out"],
      ["start-of-turn", "Remove a suspense counter"],
    ]);
    expect(script.triggers![1]!.optional).toBe(true);
    const { ctx } = fakeCtx();
    script.onLeaveArena!(ctx, "graveyard");
    expect(ctx.getFlag("player", "suspenseAurasLeftThisTurn")).toBe(1);
  });
});

describe("channelLightning", () => {
  it("adds a flow counter and destroys itself when pitch lacks enough Lightning cards", () => {
    const { ctx, called } = fakeCtx();
    const channel = channelLightning("remaining", "channel");
    run(channel.triggers[0]!.effect as (ctx: ScriptCtx) => void, ctx);
    expect(ctx.getCounter("flow")).toBe(1);
    expect(called("destroySelf")).toEqual([[]]);
  });

  it("asks for one Lightning card per flow counter", () => {
    const { ctx, called } = fakeCtx({
      players: [fakePlayer(0, { pitch: [{ instanceId: 7, types: ["lightning"] }, { instanceId: 8 }] }), fakePlayer(1)],
      returns: { putOnDeckBottom: true },
    });
    const channel = channelLightning("remaining", "channel");
    run(channel.triggers[0]!.effect as (ctx: ScriptCtx) => void, ctx);
    expect(called("requestCardChoice")[0]?.[2]).toEqual([7]);
    channel.onChoose(ctx, "channel", "7");
    expect(ctx.getState("remaining")).toBe(0);
    expect(called("destroySelf")).toEqual([]);
  });
});

describe("hero ability gates", () => {
  const blaze = (disabled: boolean) => fakeCtx({
    players: [fakePlayer(0, { heroCardId: "BLAZE", deck: [{ instanceId: 7 }] }), fakePlayer(1)],
    cardData: { BLAZE: { name: "Blaze, Firemind" } },
    heroAbilitiesDisabled: disabled,
  });

  it("Blaze, Firemind's opt charges energy only while its abilities are intact", () => {
    const live = blaze(false);
    optN(live.ctx, 1);
    expect(live.called("requestChoice")[0]?.[0]).toBe("optc:1:7");
    optOnChoose(live.ctx, "optc:1:7", "top:7");
    expect(live.called("setCardCounter")).toEqual([[100, "energy", 1]]);

    const disabled = blaze(true);
    optN(disabled.ctx, 1);
    expect(disabled.called("requestChoice")[0]?.[0]).toBe("opt:1:7");
  });

  it("optOnChoose ignores other hooks and finishes early on pass", () => {
    const { ctx, called } = blaze(false);
    expect(optOnChoose(ctx, "other", "pass")).toBe(false);
    let done = 0;
    expect(optOnChoose(ctx, "opt:2:7,8", "pass", () => void done++)).toBe(true);
    expect(done).toBe(1);
    expect(called("putOnDeckTop")).toEqual([]);
  });

  it("Iyslander's blue arsenal instants need her abilities intact", () => {
    const self = { instanceId: 7, cardId: "BLUE", cardTypes: ["action"] };
    const iyslander = (disabled: boolean) => fakeCtx({
      self,
      players: [fakePlayer(0, { heroCardId: "IYS", arsenal: [self] }), fakePlayer(1)],
      cardData: { IYS: { name: "Iyslander" }, BLUE: { name: "Blue", pitch: 3 } },
      heroAbilitiesDisabled: disabled,
    });
    const opposingTurn = (ctx: ScriptCtx) => {
      (ctx.state as { activePlayer: number }).activePlayer = 1;
      return ctx;
    };
    expect(wizardActionAsInstant(opposingTurn(iyslander(false).ctx))).toBe(true);
    expect(wizardActionAsInstant(opposingTurn(iyslander(true).ctx))).toBe(false);
  });
});

describe("composition factories", () => {
  it("pitches registers one script under every pitch", () => {
    expect(Object.keys(pitches("x", (pitch) => ({ arcaneDamageEffectAmounts: [pitch] })))).toEqual(["x|1", "x|2", "x|3"]);
  });

  it("splitScript resolves the right side before the left when both are played", () => {
    const order: string[] = [];
    const script = splitScript({
      leftName: "L",
      rightName: "R",
      left: () => void order.push("left"),
      right: () => void order.push("right"),
    });
    for (const meldSide of ["left", "right", "both"]) {
      script.onPlay!(fakeCtx({ self: { instanceId: 1, meldSide } as FakeCard }).ctx);
    }
    expect(order).toEqual(["left", "right", "right", "left"]);
  });

  it("resourceAbility gains exactly its resourceSource amount", () => {
    const ability = resourceAbility(2, { cost: 0, isAttack: false, goAgain: false, label: "Gain" });
    const { ctx, called } = fakeCtx();
    ability.onActivate!(ctx);
    expect(ability.resourceSource).toBe(2);
    expect(called("gainResources")).toEqual([[0, 2]]);
  });

  it("attackingWeapon merges an activated override into the once-per-turn base", () => {
    expect(attackingWeapon(1).activated).toEqual({ cost: 1, isAttack: true, goAgain: false, oncePerTurn: true });
    expect(attackingWeapon(1, { activated: { goAgain: true } as never }).activated)
      .toMatchObject({ cost: 1, goAgain: true, oncePerTurn: true });
  });

  it("clashForToken lets only the winner create the token", () => {
    const script = clashForToken("TOKEN");
    const { ctx, called } = fakeCtx();
    script.onDefend!(ctx);
    script.onClashResult!(ctx, "create-token", -1);
    script.onClashResult!(ctx, "create-token", 1);
    expect(called("requestClash")).toEqual([[1, "create-token"]]);
    expect(called("heroCreatesTokens")).toEqual([[1, "TOKEN"]]);
  });
});
