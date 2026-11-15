import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CardView } from "@fyendal/shared";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { canOpenSandbox } from "../SandboxPanel.js";
import { ZoneOverlay, type ZoneOverlayMoves } from "./ZoneOverlay.js";
import {
  SandboxCardMoves,
  editableOverlaySource,
  sandboxMoveRefusalMessage,
  sandboxMoveShortcut,
  sandboxMoveTargets,
} from "./SandboxCardMoves.js";

const CARD: CardView = { instanceId: 7, cardId: "WTR098", name: "Sink Below", owner: 0 };

function moves(zone: ZoneOverlayMoves["zone"], overrides: Partial<ZoneOverlayMoves> = {}): ZoneOverlayMoves {
  return { zone, pending: false, refusal: null, onMove: vi.fn(), ...overrides };
}

function overlay(zone: ZoneOverlayMoves["zone"] | null, cards: CardView[] = [CARD], extra: Partial<ZoneOverlayMoves> = {}) {
  return renderToStaticMarkup(
    <TestI18nProvider locale="en">
      <ZoneOverlay
        overlay={{ title: "Pile", cards, inactiveZone: zone !== "hand" }}
        yourSeat={0}
        moves={zone ? moves(zone, extra) : undefined}
        onClose={vi.fn()}
        onInspectCard={vi.fn()}
      />
    </TestI18nProvider>,
  );
}

const offered = (html: string) => [...html.matchAll(/data-sandbox-move="([^"]+)"/g)].map((match) => match[1]);

describe("sandbox card moves", () => {
  it("offers every other zone, keeping deck top and bottom as draft moves in the deck", () => {
    expect(sandboxMoveTargets("hand", CARD)).toEqual(["deck-top", "deck-bottom", "graveyard", "banish"]);
    expect(sandboxMoveTargets("deck", CARD)).toEqual(["hand", "graveyard", "banish"]);
    expect(sandboxMoveTargets("graveyard", CARD)).toEqual(["hand", "deck-top", "deck-bottom", "banish"]);
    expect(sandboxMoveTargets("banish", CARD)).toEqual(["hand", "deck-top", "deck-bottom", "graveyard"]);
    expect(sandboxMoveTargets("banish", { faceDown: true })).toEqual([]);
  });

  it("maps deck-card shortcuts", () => {
    expect(["h", "G", "b", "x", "ArrowUp"].map(sandboxMoveShortcut)).toEqual(["hand", "graveyard", "banish", null, null]);
  });

  it("names the card in each button and disables them while a command is pending", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider locale="en">
        <SandboxCardMoves zone="graveyard" card={CARD} pending onMove={vi.fn()} />
      </TestI18nProvider>,
    );
    expect(html).toContain('aria-label="Move Head Jab to the hand"');
    expect(html).toContain('aria-label="Put Head Jab on top of the deck"');
    expect(html).toContain('aria-label="Banish Head Jab"');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).not.toContain('tabindex="-1"');
  });

  it("adds per-card actions to an editable pile and nothing otherwise", () => {
    expect(offered(overlay("hand"))).toEqual(["deck-top", "deck-bottom", "graveyard", "banish"]);
    expect(offered(overlay("graveyard"))).toEqual(["hand", "deck-top", "deck-bottom", "banish"]);
    expect(offered(overlay("banish"))).toEqual(["hand", "deck-top", "deck-bottom", "graveyard"]);
    expect(offered(overlay("banish", [{ ...CARD, faceDown: true }]))).toEqual([]);
    const plain = overlay(null);
    expect(offered(plain)).toEqual([]);
    expect(plain).not.toContain("zone-viewer-slot");
    expect(plain).not.toContain("Moves are silent");
    expect(overlay("graveyard")).toContain("Moves are silent");
    expect(overlay("graveyard", [])).toContain("No cards left here.");
  });

  it("explains a refused move", () => {
    const html = overlay("graveyard", [CARD], { refusal: "SANDBOX_EDIT_UNAVAILABLE" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("That card can&#x27;t move right now.");
    expect(sandboxMoveRefusalMessage("SANDBOX_SEAT_FORBIDDEN")).toBe("game.sandbox.refusal.seat");
  });

  it("offers moves only in sandbox games, to players, for seats they may edit", () => {
    const source = { seat: 1, zone: "graveyard" as const };
    const can = (overrides: Partial<Parameters<typeof canOpenSandbox>[0]>) => canOpenSandbox({
      sandbox: true, spectating: false, replaying: false, yourSeat: 0, gameOver: false, ...overrides,
    });
    expect(editableOverlaySource(source, can({}), [0, 1])).toBe(source);
    expect(editableOverlaySource(source, can({}), [0])).toBeNull();
    for (const blocked of [{ sandbox: false }, { spectating: true }, { replaying: true }, { yourSeat: null }, { gameOver: true }]) {
      expect(editableOverlaySource(source, can(blocked), [0, 1]), JSON.stringify(blocked)).toBeNull();
    }
    expect(editableOverlaySource(undefined, true, [0, 1])).toBeNull();
  });
});
