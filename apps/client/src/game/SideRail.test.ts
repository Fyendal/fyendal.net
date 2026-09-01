import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SideRail, undoWithoutFocus } from "./SideRail.js";

function sideRailProps(
  overrides: Partial<ComponentProps<typeof SideRail>> = {},
): ComponentProps<typeof SideRail> {
  return {
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    turn: 4,
    onUndo: vi.fn(),
    onLeave: vi.fn(),
    leaveLabel: "Leave",
    onConcede: vi.fn(),
    spectating: false,
    spectatorCount: 0,
    opponentConnected: true,
    connected: true,
    error: null,
    winnerText: null,
    replaying: false,
    emoteSeat: 0,
    onSendEmote: vi.fn(),
    onReportBug: async () => ({ ok: true as const, reportId: "report" }),
    onShowGameOver: null,
    priorityWindowMode: "auto-pass",
    onPriorityWindowModeChange: vi.fn(),
    lessGuidance: false,
    onLessGuidanceChange: vi.fn(),
    skipPlayConfirmation: false,
    onSkipPlayConfirmationChange: vi.fn(),
    motionPreference: "system",
    onMotionPreferenceChange: vi.fn(),
    playabilityCuePreference: "glow",
    onPlayabilityCuePreferenceChange: vi.fn(),
    soundEffectsEnabled: true,
    onSoundEffectsEnabledChange: vi.fn(),
    soundEffectsVolume: 35,
    onSoundEffectsVolumeChange: vi.fn(),
    log: [],
    friendlyHeroName: "Dash",
    opponentHeroName: "Bravo",
    roomCode: "ROOM",
    onInspectCard: vi.fn(),
    mobilePrimaryActionLabel: "END TURN",
    onMobilePrimaryAction: vi.fn(),
    ...overrides,
  };
}

describe("undo focus", () => {
  it("releases focus after undo so Space returns to the pass shortcut", () => {
    const calls: string[] = [];

    undoWithoutFocus(
      { blur: () => calls.push("blur") },
      () => calls.push("undo"),
    );

    expect(calls).toEqual(["undo", "blur"]);
  });
});

describe("game control icons", () => {
  it("uses the same SVG sizing hook for mobile emotes and the other icon controls", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps()));

    expect(html.match(/class="game-control-icon"/g)).toHaveLength(5);
    expect(html.match(/data-control-icon="undo"/g)).toHaveLength(2);
    expect(html.match(/data-control-icon="bug"/g)).toHaveLength(1);
    expect(html.match(/data-control-icon="settings"/g)).toHaveLength(1);
    expect(html.match(/data-control-icon="emote"/g)).toHaveLength(1);
    expect(html).toContain("hero-emote-toolbar");
    expect(html).toContain("mobile-primary-action");
    expect(html).toContain("End turn (Space)");
    const undoPosition = html.indexOf('aria-label="Undo last action"');
    const logPosition = html.indexOf('aria-label="Game log"');
    const actionPosition = html.indexOf("mobile-primary-action");
    const emotePosition = html.indexOf("hero-emote-toolbar");
    const morePosition = html.indexOf('aria-label="More game controls"');
    expect(undoPosition).toBeLessThan(logPosition);
    expect(logPosition).toBeLessThan(actionPosition);
    expect(actionPosition).toBeLessThan(emotePosition);
    expect(emotePosition).toBeLessThan(morePosition);
    expect(html).not.toContain("mobile-gamebar-status");
    expect(html).not.toContain("ACTION PHASE");
    expect(html).not.toContain("End Game");
    expect(html).toContain(">Leave</button>");
    expect(html.match(/aria-label="More game controls"/g)).toHaveLength(1);
    expect(html).not.toContain("⚙");
    expect(html).not.toContain("💬");
  });

  it("omits the mobile action slot when there is no contextual action", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      mobilePrimaryActionLabel: null,
    })));

    expect(html).not.toContain("mobile-primary-action");
  });

  it("disables desktop and mobile undo while a room command is pending", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      undoDisabled: true,
    })));

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Undo last action"');
  });

});

describe("opponent connection status", () => {
  it("shows a disconnected opponent while the game is active", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      opponentConnected: false,
    })));

    expect(html.match(/opponent disconnected — waiting…/g)).toHaveLength(2);
  });

  it("hides a disconnected opponent after a winner is determined", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      opponentConnected: false,
      winnerText: "Victory!",
    })));

    expect(html).not.toContain("opponent disconnected");
    expect(html.match(/Victory!/g)).toHaveLength(2);
  });

  it("hides stale opponent connection state while viewing an earlier replay frame", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      opponentConnected: false,
      winnerText: null,
      replaying: true,
    })));

    expect(html).not.toContain("opponent disconnected");
  });
});

describe("game log hero colors", () => {
  it("marks the player's hero as friendly and the opponent's hero as opponent", () => {
    const html = renderToStaticMarkup(createElement(SideRail, sideRailProps({
      log: [
        "— Turn 4: Dash's turn —",
        "Dash plays Zero to Sixty",
        "— Turn 5: Bravo's turn —",
        "Bravo blocks",
        "Dash creates a Quicken",
      ],
    })));

    expect(html).toContain("log-turn-divider");
    expect(html).toContain("Turn 4: Your turn");
    expect(html).toContain("Turn 5: Opponent&#x27;s turn");
    expect(html).not.toContain("— Turn");
    expect(html).toContain("log-card-ref-friendly");
    expect(html).toContain("log-card-ref-opponent");
    expect(html).toContain("log-card-ref-token");
    expect(html).toMatch(/log-card-ref-friendly[^>]*>Dash<\/button>/);
    expect(html).toMatch(/log-card-ref-opponent[^>]*>Bravo<\/button>/);
    expect(html).toMatch(/log-card-ref-token[^>]*>Quicken<\/button>/);
  });
});
