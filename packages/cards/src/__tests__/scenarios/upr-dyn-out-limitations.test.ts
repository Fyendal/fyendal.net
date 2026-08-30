import { describe, expect, it } from "vitest";
import type { CardScript } from "@fyendal/engine";
import { printingId, scenario } from "../harness.js";
import { scripts } from "../../index.js";

function implementation(key: string, check: (script: CardScript) => boolean): void {
  const script = scripts[printingId(key)];
  expect(script, `${key} has no registered script`).toBeDefined();
  expect(check(script!), `${key} is missing its resolved rules support`).toBe(true);
}

describe("Uprising, Dynasty, and Outsiders rules regression coverage", () => {
  it("Tomeltai applies defense counters and destroys zero-defense equipment", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 3, board: ["tomeltai|0"], deck: ["wrecker romp|1", "wrecker romp|1"], weapons: [] },
      { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
    ] });
    g.activate("tomeltai|0").chooseCard("ironrot helm|0").blockWith().settle();
    g.expectInZone(1, "ironrot helm|0", "graveyard");
  });
  it("Dominia privately banishes a chosen defending-hand card", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 3, board: ["dominia|0"], deck: ["wrecker romp|1"], weapons: [] },
      { hero: "dorinthea", hand: ["snatch|1"] },
    ] });
    g.activate("dominia|0").chooseCard("snatch|1").blockWith().settle();
    g.expectInZone(1, "snatch|1", "banish");
  });
  it("Thaw activates from graveyard at start of turn", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", graveyard: ["thaw|1"], board: ["frostbite|0"] },
      { hero: "dorinthea" },
    ] });
    g.endTurn().chooseOption("yes").chooseCard("frostbite|0");
    g.expectInZone(0, "thaw|1", "banish").expectNotInZone(0, "frostbite|0", "board");
  });
  it("Frost Hex grants triggers to opposing Frostbites", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", board: ["frost hex|3", "frostbite|0"] },
      { hero: "dorinthea" },
    ] });
    g.endTurn().expectLife(0, 19).expectNotInZone(0, "frostbite|0", "board");
  });
  it("Channel the Bleak Expanse prohibits effect operations", () => implementation("channel the bleak expanse|3", (script) => script.prohibitsReveals === true && script.prohibitsEffectDraws === true && script.prohibitsDeckSearches === true));
  it("Ghostly Touch becomes an ally with haunt-based stats", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 1, hand: ["phantasmal symbiosis|2"], equipment: { arms: "ghostly touch|0" } },
      { hero: "dorinthea", hand: ["wrecker romp|1"] },
    ] });
    g.play("phantasmal symbiosis|2").chooseName("Snatch").blockWith("wrecker romp|1").settle();
    const ghostly = g.state.players[0]!.equipment.arms!;
    expect(ghostly.counters?.haunt).toBe(1);
    g.endTurn().endTurn();
    g.activate("ghostly touch|0");
    expect(g.state.players[0]!.equipment.arms?.temporaryAlly).toEqual({ power: 0, life: 0 });
  });
  it("Double Strike can be replayed after link settlement", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["double strike|1"] }, { hero: "dorinthea" },
    ] });
    g.play("double strike|1").blockWith().settle().expectInZone(0, "double strike|1", "banish");
    expect(g.state.players[0]!.banish[0]?.playableFrom).toContain("banish");
    g.play("double strike|1", { fromZone: "banish" }).blockWith().settle();
    expect(g.state.chain).toHaveLength(2);
  });
  it("Take the Tempo permission lasts through next turn", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 1, hand: ["ravenous rabble|1", "ravenous rabble|1", "take the tempo|1"], deck: ["wounding blow|1"] },
      { hero: "dorinthea" },
    ] });
    g.play("ravenous rabble|1").blockWith().settle()
      .play("ravenous rabble|1").blockWith().settle()
      .play("take the tempo|1").blockWith().settle()
      .expectInZone(0, "wounding blow|1", "banish")
      .endTurn().endTurn()
      .play("wounding blow|1", { fromZone: "banish" });
  });
  it("Alluvion observes prevention and discounts a staff", () => implementation("alluvion constellas|0", (script) => script.preventArcaneDamage === 1 && !!script.activated));
  it("Rewind negates a non-attack action, returns it, and grants an action point", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", hand: ["rewind|3", "wrecker romp|3"] },
      { hero: "dorinthea", resources: 1, hand: ["come to fight|1"] },
    ] });
    g.play("come to fight|1", { settle: false }).passPriority()
      .react("rewind|3", { pitch: ["wrecker romp|3"] });
    const targetId = Number(g.state.pendingDecision?.options?.[0]);
    g.chooseOption(String(targetId));
    g.expectInZone(1, "come to fight|1", "hand");
    expect(g.state.players[1]!.actionPoints).toBe(1);
  });
  it("Erase Face temporarily removes all card types", () => implementation("erase face|1", (script) => !!script.onHit));
  it("Berserk registers a random-discard trigger", () => implementation("berserk|2", (script) => script.triggers?.some((trigger) => trigger.event === "card-discarded") === true));
  it("Spirit of Eirina replaces a soul-zone move", () => implementation("spirit of eirina|2", (script) => script.replacesSoulMoveWithArena === true && !!script.allowsFriendlyCardPlayAsInstant));
  it("Cleave deals resolved hit damage to another ally", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 4, hand: ["cleave|1"], weapons: ["merciless battleaxe|0"] },
      { hero: "dorinthea", board: ["aether ashwing|0"] },
    ] });
    g.play("cleave|1").attackWithWeapon("merciless battleaxe|0").blockWith().settle().chooseCard("aether ashwing|0");
    g.expectNotInZone(1, "aether ashwing|0", "board");
  });
  it("Pulsewave Harpoon inserts a forced defender", () => implementation("pulsewave harpoon|1", (script) => !!script.onAttackDeclared && !!script.onChoose));
  it("Bios Update puts its delayed item trigger on the stack and offers Crank on resolution", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 1, hand: ["bios update|1", "zipper hit|1"], deck: ["prismatic lens|2"] },
      { hero: "dorinthea", hand: ["sigil of solace|1"] },
    ] });
    g.play("bios update|1").play("zipper hit|1", { boost: true, settle: false });

    g.expectInZone(0, "prismatic lens|2", "banish")
      .expectNotInZone(0, "prismatic lens|2", "board");
    expect(g.state.stack).toHaveLength(1);
    expect(g.state.stack[0]?.label).toContain("Bios Update");

    g.passPriority().passPriority();
    g.expectInZone(0, "prismatic lens|2", "board");
    expect(g.state.stack).toHaveLength(0);
    expect(g.state.pendingDecision?.chooseHook).toBe("engine-crank");

    g.chooseOption("yes");
    const lens = g.state.players[0]!.board.find(
      (card) => card.cardId === printingId("prismatic lens|2"),
    )!;
    expect(lens.counters?.steam ?? 0).toBe(0);
    expect(g.state.players[0]!.flags.crankedThisTurn).toBe(true);
  });
  it("Nitro Mechanoid transforms six component groups", () => implementation("construct nitro mechanoid|2", (script) => !!script.onPlay));
  it("Powder Keg destroys itself and defending equipment on a gun hit", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 2, board: ["powder keg|3"], weapons: ["teklo plasma pistol|0"] },
      { hero: "dorinthea", equipment: { head: "ironrot helm|0" } },
    ] });
    g.activate("teklo plasma pistol|0", { ability: 1 })
      .attackWithWeapon("teklo plasma pistol|0").blockWith("ironrot helm|0").settle().chooseCard("ironrot helm|0");
    g.expectInZone(0, "powder keg|3", "graveyard").expectInZone(1, "ironrot helm|0", "graveyard");
  });
  it("Mask of Perdition grants a top-deck banish hit trigger", () => implementation("mask of perdition|0", (script) => !!script.activated && !!script.onHit));
  it("Regicide applies name defense rules and game loss", () => implementation("regicide|3", (script) => !!script.canBeDefendedBy && !!script.onHit && !!script.onCombatChainClosed));
  it("Surgical Extraction privately chooses a hand card to banish", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 2, hand: ["surgical extraction|3"] },
      { hero: "dorinthea", hand: ["snatch|1"], deck: ["wrecker romp|1"] },
    ] });
    g.play("surgical extraction|3").blockWith().settle().chooseCard("snatch|1");
    g.expectInZone(1, "snatch|1", "banish").expectInZone(1, "wrecker romp|1", "banish");
  });
  it("Heat Seeker resolves at a future end phase", () => implementation("heat seeker|1", (script) => !!script.onHit && !!script.triggers?.some((trigger) => trigger.event === "end-of-turn")));
  it("Amethyst Tiara grants spellvoid to Runechants", () => implementation("amethyst tiara|0", (script) => script.grantsSpellvoidToRunechants === true && !!script.activated));
  it("Diabolic Ultimatum makes simultaneous choices", () => implementation("diabolic ultimatum|1", (script) => !!script.onPlayCostPaid && !!script.onChoose));
  it("Brainstorm observes every action-phase draw", () => implementation("brainstorm|3", (script) => !!script.onFriendlyDraws));
  it("Phantasmal Symbiosis rewrites arbitrary named cards", () => implementation("phantasmal symbiosis|2", (script) => !!script.onAttackDeclared && !!script.onChoose));
  it("Imperial Edict prohibits an arbitrary named card", () => implementation("imperial edict|1", (script) => !!script.activated && !!script.onChoose));
  it("Imperial Warhorn coordinates per-hero choices", () => implementation("imperial warhorn|1", (script) => !!script.activated && !!script.onChoose));
  it("Uzuri swaps the active stealth attacking card", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", heroKey: "uzuri, switchblade|0", hand: ["infect|1", "snatch|1", "wounding blow|3"] },
      { hero: "dorinthea" },
    ] });
    g.play("infect|1").blockWith().activate("uzuri, switchblade|0")
      .chooseCard("wounding blow|3").chooseCard("snatch|1");
    expect(g.state.chain.at(-1)!.attackingCard.cardId).toBe(printingId("snatch|1"));
  });
  it("Redback Shroud destroys two Silvers and equips from graveyard", () => {
    const g = scenario({ active: 1, seats: [
      { hero: "rhinar", graveyard: ["redback shroud|0"], board: ["silver|0", "silver|0"], equipment: { chest: null } },
      { hero: "dorinthea" },
    ] });
    g.endTurn().chooseOption("yes");
    expect(g.state.players[0]!.equipment.chest?.cardId).toBe(printingId("redback shroud|0"));
    expect(g.state.players[0]!.board).toHaveLength(0);
  });
  it("Cyclone Roundhouse banishes a random defender from every prior link", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 3, hand: ["spinning wheel kick|1", "cyclone roundhouse|2"] },
      { hero: "dorinthea", hand: ["wounding blow|1", "wounding blow|2"] },
    ] });
    g.play("spinning wheel kick|1").blockWith("wounding blow|1").settle()
      .play("cyclone roundhouse|2").blockWith("wounding blow|2").settle();
    expect(g.state.players[1]!.banish).toHaveLength(2);
  });
  it("Dishonor permanently suppresses hero abilities", () => implementation("dishonor|3", (script) => !!script.onHit));
  it("Head Leads the Tail buffs the chosen name for the combat chain", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", resources: 1, hand: ["head leads the tail|1", "snatch|1"] }, { hero: "dorinthea" },
    ] });
    g.play("head leads the tail|1").chooseName("Snatch").blockWith().settle()
      .play("snatch|1").expectAttackValue(5);
  });
  it("Visit the Floating Dojo orders multiple zone moves", () => implementation("visit the floating dojo|3", (script) => !!script.onPlay && !!script.onChoose));
  it("Concealed Blade equips a dagger from inventory", () => implementation("concealed blade|3", (script) => !!script.onHit && !!script.onChoose));
  it("Codex of Bloodrot makes simultaneous hidden choices", () => implementation("codex of bloodrot|2", (script) => !!script.onPlay && !!script.onChoose));
  it("Vambrace replaces the next prevention effect", () => implementation("vambrace of determination|0", (script) => !!script.activated && !!script.onDefend));
  it("Amnesia temporarily suppresses card names", () => implementation("amnesia|1", (script) => !!script.onHit));
  it("Down and Dirty defends directly from arsenal", () => {
    const g = scenario({ seats: [
      { hero: "rhinar", hand: ["wounding blow|1"] },
      { hero: "dorinthea", arsenalFaceDown: ["down and dirty|1"] },
    ] });
    g.play("wounding blow|1").blockWith("down and dirty|1");
    expect(g.state.chain.at(-1)?.defendingCards.some((card) => card.cardId === printingId("down and dirty|1"))).toBe(true);
  });
});
