import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChainLinkView, GameView, PendingDecision } from "@fyendal/shared";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { passUntilHotkey } from "./passHotkey.js";
import { chainLinkOpen, passUntilPaused } from "./passUntil.js";
import { PassUntilControl } from "./PassUntilControl.js";

function link(overrides: Partial<ChainLinkView> = {}): ChainLinkView {
  return { attackValue: 5, defenseValue: 0, damage: 0, resolved: false, ...overrides } as ChainLinkView;
}

function view(
  decision: Partial<PendingDecision> | null,
  chain: ChainLinkView[] = [link()],
  life = 20,
): GameView {
  return {
    chain,
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

  it("leaves every block to the seat under the opponent shortcut", () => {
    expect(passUntilPaused(view({ kind: "defend" }), 1, "opponent")).toBe(true);
    expect(passUntilPaused(view({ kind: "defense-reaction" }), 1, "opponent")).toBe(false);
  });

  it("treats a chain-link shortcut waiting for its link as armed, not paused", () => {
    expect(passUntilPaused(view({ kind: "optional-effect" }, []), 1, "chain-link")).toBe(false);
    expect(passUntilPaused(view({ kind: "optional-effect" }, []), 1, "turn")).toBe(true);
  });

  it("maps Shift+Space to the opponent, F4 to the chain link, and F6 to the turn outside text entry", () => {
    expect(passUntilHotkey(key({ code: "Space", shiftKey: true }))).toBe("opponent");
    expect(passUntilHotkey(key({ key: "F4" }))).toBe("chain-link");
    expect(passUntilHotkey(key({ key: "F6" }))).toBe("turn");
    expect(passUntilHotkey(key({ code: "Space" }))).toBeNull();
    expect(passUntilHotkey(key({ key: "F6", repeat: true }))).toBeNull();
    expect(passUntilHotkey(key({ key: "F6", ctrlKey: true }))).toBeNull();
    const input = { closest: (selector: string) => selector.includes("input") ? {} : null };
    expect(passUntilHotkey(key({ code: "Space", shiftKey: true, target: input as unknown as EventTarget })))
      .toBeNull();
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
