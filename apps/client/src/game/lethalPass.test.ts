import { describe, expect, it } from "vitest";
import type { ChainLinkView, GameIntent, GameView, PendingDecision } from "@fyendal/shared";
import { lethalPassRisk } from "./lethalPass.js";

const PASS: GameIntent = { kind: "pass" };
const REACT: GameIntent = { kind: "play-card", instanceId: 9, pitchInstanceIds: [] };

function view(
  decision: Partial<PendingDecision>,
  link: Partial<ChainLinkView> = {},
  { life = 5, stack = [] as unknown[] } = {},
): GameView {
  return {
    chain: [{ attackValue: 7, defenseValue: 0, damage: 7, resolved: false, ...link }],
    stack,
    pendingDecision: { player: 1, prompt: "", ...decision },
    players: [{ life: 20 }, { life }],
  } as unknown as GameView;
}

describe("lethal pass risk", () => {
  it("warns on the defender's final pass when a response is available", () => {
    expect(lethalPassRisk(view({ kind: "defense-reaction" }), 1, [PASS, REACT]))
      .toEqual({ damage: 7, life: 5, window: "reaction" });
  });

  it("stays quiet when passing is the only option", () => {
    expect(lethalPassRisk(view({ kind: "defense-reaction" }), 1, [PASS])).toBeNull();
  });

  it("stays quiet while a layer can still resolve or the damage is survivable", () => {
    expect(lethalPassRisk(view({ kind: "defense-reaction" }, {}, { stack: [{}] }), 1, [PASS, REACT])).toBeNull();
    expect(lethalPassRisk(view({ kind: "defense-reaction" }, {}, { life: 8 }), 1, [PASS, REACT])).toBeNull();
  });

  it("nets established prevention unless the damage can't be prevented", () => {
    const prevented = { damageToPrevent: 3 };
    expect(lethalPassRisk(view({ kind: "defense-reaction" }, prevented), 1, [PASS, REACT])).toBeNull();
    expect(lethalPassRisk(
      view({ kind: "defense-reaction" }, { ...prevented, damageUnpreventable: true }),
      1,
      [PASS, REACT],
    )?.damage).toBe(7);
  });

  it("ignores attacks aimed at an ally and other seats' decisions", () => {
    expect(lethalPassRisk(view({ kind: "defense-reaction" }, { targetAllyName: "Ally" }), 1, [PASS, REACT])).toBeNull();
    expect(lethalPassRisk(view({ kind: "defense-reaction", player: 0 }), 1, [PASS, REACT])).toBeNull();
    expect(lethalPassRisk(view({ kind: "attack-reaction" }), 1, [PASS, REACT])).toBeNull();
  });

  it("warns on an unblocked lethal attack when a defender is available", () => {
    const defenderDefense = [{ instanceId: 4, defense: 3, attack: 7 }];
    expect(lethalPassRisk(view({ kind: "defend", defenderDefense }), 1, [{ kind: "defend", instanceIds: [] }]))
      .toEqual({ damage: 7, life: 5, window: "defend" });
  });

  it("prices staged blocks, including a staged power change", () => {
    const defenderDefense = [{ instanceId: 4, defense: 3, attack: 7 }, { instanceId: 6, defense: 3, attack: 7 }];
    const stagedCards = [{ instanceId: 4 }] as PendingDecision["stagedCards"];
    expect(lethalPassRisk(view({ kind: "defend", defenderDefense, stagedCards, stagedDefense: 3 }), 1, [])).toBeNull();
    expect(lethalPassRisk(
      view({ kind: "defend", defenderDefense, stagedCards, stagedDefense: 3, stagedAttack: 9 }),
      1,
      [],
    )?.damage).toBe(6);
  });

  it("keeps a flat damage bonus when pricing blocks", () => {
    const decision = {
      kind: "defend" as const,
      defenderDefense: [{ instanceId: 4, defense: 2, attack: 6 }, { instanceId: 6, defense: 2, attack: 6 }],
      stagedCards: [{ instanceId: 4 }] as PendingDecision["stagedCards"],
      stagedDefense: 2,
    };
    expect(lethalPassRisk(view(decision, { attackValue: 6, damage: 7 }), 1, [])?.damage).toBe(5);
  });

  it("does not warn at defend when every useful defender is already staged", () => {
    expect(lethalPassRisk(view({
      kind: "defend",
      defenderDefense: [{ instanceId: 4, defense: 1, attack: 7 }],
      stagedCards: [{ instanceId: 4 }] as PendingDecision["stagedCards"],
      stagedDefense: 1,
    }), 1, [])).toBeNull();
  });
});
