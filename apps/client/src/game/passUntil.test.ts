import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChainLinkView, GameIntent, GameView, PendingDecision, StackLayerView } from "@fyendal/shared";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { passUntilHotkey, passUntilStopHotkey } from "./passHotkey.js";
import { chainLinkOpen, passUntilChoice, passUntilPaused } from "./passUntil.js";
import { PassUntilControl } from "./PassUntilControl.js";

function link(overrides: Partial<ChainLinkView> = {}): ChainLinkView {
  return { attackValue: 5, defenseValue: 0, damage: 0, resolved: false, ...overrides } as ChainLinkView;
}

function view(
  decision: Partial<PendingDecision> | null,
  chain: ChainLinkView[] = [link()],
  life = 20,
  stack: Partial<StackLayerView>[] = [],
): GameView {
  return {
    chain,
    stack,
    pendingDecision: decision ? { player: 1, prompt: "", ...decision } : null,
    players: [{ life: 20 }, { life }],
  } as unknown as GameView;
}

function key(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    code: "", key: "", repeat: false, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
    target: null, ...overrides,
  } as KeyboardEvent;
}

describe("pass until", () => {
  it("cancels when the armed mode is picked again, from any mode", () => {
    for (const mode of ["chain-link", "turn"] as const) {
      expect(passUntilChoice(mode, mode)).toBeNull();
      expect(passUntilChoice(null, mode)).toBe(mode);
    }
    expect(passUntilChoice("turn", "chain-link")).toBe("chain-link");
  });

  it("is paused on a lethal final pass only while the seat can respond", () => {
    const lethal = view({ kind: "defense-reaction" }, [link({ attackValue: 7, damage: 7 })], 5);
    const respond: GameIntent = { kind: "play-card", instanceId: 9, pitchInstanceIds: [] };
    expect(passUntilPaused(lethal, 1, "turn", [{ kind: "pass" }, respond])).toBe(true);
    expect(passUntilPaused(lethal, 1, "turn", [{ kind: "pass" }])).toBe(false);
  });

  it("distinguishes an open chain link from a resolved or empty chain", () => {
    expect(chainLinkOpen(view(null))).toBe(true);
    expect(chainLinkOpen(view(null, [link({ resolved: true })]))).toBe(false);
    expect(chainLinkOpen(view(null, []))).toBe(false);
  });

  it("is paused only on a choice the server will not answer for the seat", () => {
    expect(passUntilPaused(view({ kind: "defense-reaction" }), 1, "turn")).toBe(false);
    expect(passUntilPaused(view({ kind: "defend" }), 1, "turn")).toBe(false);
    expect(passUntilPaused(view({ kind: "optional-effect" }), 1, "turn")).toBe(true);
    expect(passUntilPaused(view({ kind: "optional-effect", player: 0 }), 1, "turn")).toBe(false);
    expect(passUntilPaused(view({ kind: "optional-effect" }), 1, null)).toBe(false);
  });

  it("pauses before an attack that could defeat the seat, net of prevention", () => {
    expect(passUntilPaused(view({ kind: "defend" }, [link({ attackValue: 6 })], 6), 1, "chain-link")).toBe(true);
    expect(passUntilPaused(view({ kind: "defend" }, [link({ attackValue: 6, damageToPrevent: 1 })], 6), 1, "turn"))
      .toBe(false);
  });

  it("pauses on a window over an opposing layer", () => {
    expect(passUntilPaused(view({ kind: "priority-window" }, [link()], 20, [{ seat: 0 }]), 1, "turn")).toBe(true);
    expect(passUntilPaused(view({ kind: "attack-reaction" }, [link()], 20, [{ seat: 0 }]), 1, "chain-link"))
      .toBe(true);
    expect(passUntilPaused(view({ kind: "priority-window" }, [link()], 20, [{ seat: 1 }]), 1, "turn")).toBe(false);
  });

  it("treats a chain-link shortcut waiting for its link as armed, not paused", () => {
    expect(passUntilPaused(view({ kind: "optional-effect" }, []), 1, "chain-link")).toBe(false);
    expect(passUntilPaused(view({ kind: "optional-effect" }, []), 1, "turn")).toBe(true);
  });

  it("maps Shift+Space to the chain link and F6 to the turn outside text entry", () => {
    expect(passUntilHotkey(key({ code: "Space", shiftKey: true }))).toBe("chain-link");
    expect(passUntilHotkey(key({ key: "F4" }))).toBeNull();
    expect(passUntilHotkey(key({ key: "F6" }))).toBe("turn");
    expect(passUntilHotkey(key({ code: "Space" }))).toBeNull();
    expect(passUntilHotkey(key({ key: "F6", repeat: true }))).toBeNull();
    expect(passUntilHotkey(key({ key: "F6", ctrlKey: true }))).toBeNull();
    const input = { closest: (selector: string) => selector.includes("input") ? {} : null };
    expect(passUntilHotkey(key({ code: "Space", shiftKey: true, target: input as unknown as EventTarget })))
      .toBeNull();
  });
});

describe("stop passing shortcut", () => {
  it("stops on Escape, and on Space only when Space has nothing to pass", () => {
    expect(passUntilStopHotkey(key({ key: "Escape" }), true)).toBe(true);
    expect(passUntilStopHotkey(key({ code: "Space", key: " " }), false)).toBe(true);
    expect(passUntilStopHotkey(key({ code: "Space", key: " " }), true)).toBe(false);
    expect(passUntilStopHotkey(key({ code: "Space", key: " ", shiftKey: true }), false)).toBe(false);
    expect(passUntilStopHotkey(key({ key: "Escape", repeat: true }), true)).toBe(false);
    const input = { closest: (selector: string) => selector.includes("input") ? {} : null };
    expect(passUntilStopHotkey(key({ key: "Escape", target: input as unknown as EventTarget }), true)).toBe(false);
  });
});

describe("PassUntilControl", () => {
  const render = (props: Partial<Parameters<typeof PassUntilControl>[0]>) => renderToStaticMarkup(createElement(
    TestI18nProvider,
    {
      locale: "en",
      children: createElement(PassUntilControl, {
        mode: null, linkOpen: true, paused: false, onArm: () => {}, onCancel: () => {}, ...props,
      }),
    },
  ));

  it("offers the menu from an unpressed toggle while disarmed", () => {
    const html = render({});
    expect(html).toContain('aria-label="Keep passing"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain("pass-until-toggle-armed");
  });

  it("shows the armed mode on the segment, running until a choice pauses it", () => {
    const html = render({ mode: "chain-link", linkOpen: false, paused: false });
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-label="Passing the next chain link"');
    expect(html).toContain("pass-until-run");
    const paused = render({ mode: "turn", paused: true });
    expect(paused).toContain('aria-label="Passing to end of turn (paused for your choice)"');
    expect(paused).not.toContain("pass-until-run");
  });

  it("announces the armed state only from the HUD instance", () => {
    expect(render({ mode: "turn" })).toContain('role="status"');
    expect(render({ mode: "turn", placement: "toolbar" })).not.toContain('role="status"');
  });
});
