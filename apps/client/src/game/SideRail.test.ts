import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SideRail, undoWithoutFocus } from "./SideRail.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function renderSideRail(
  props: ComponentProps<typeof SideRail>,
  locale: "en" | "zh-Hans" = "en",
): string {
  return renderToStaticMarkup(createElement(
    TestI18nProvider,
    { locale, children: createElement(SideRail, props) },
  ));
}

function sideRailProps(
  overrides: Partial<ComponentProps<typeof SideRail>> = {},
): ComponentProps<typeof SideRail> {
  return {
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    turn: 4,
    onUndo: vi.fn(),
    onLeave: vi.fn(),
    leaveAction: "leave",
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
    viewerSeat: 0,
    friendlyHeroName: "Dash",
    opponentHeroName: "Bravo",
    roomCode: "ROOM",
    onInspectCard: vi.fn(),
    mobilePrimaryAction: "end-turn",
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
    const html = renderSideRail(sideRailProps());

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
    const html = renderSideRail(sideRailProps({
      mobilePrimaryAction: null,
    }));

    expect(html).not.toContain("mobile-primary-action");
  });

  it("disables desktop and mobile undo while a room command is pending", () => {
    const html = renderSideRail(sideRailProps({
      undoDisabled: true,
    }));

    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Undo last action"');
  });

  it("renders game controls and status chrome in Simplified Chinese", () => {
    const html = renderSideRail(sideRailProps({
      spectating: true,
      spectatorCount: 2,
      opponentConnected: false,
    }), "zh-Hans");

    expect(html).toContain('aria-label="对局控制"');
    expect(html).toContain("对局日志");
    expect(html).toContain("你正在观战");
    expect(html).toContain("2 人正在观战");
    expect(html).toContain("对手已断开连接");
  });

});

describe("opponent connection status", () => {
  it("shows a disconnected opponent while the game is active", () => {
    const html = renderSideRail(sideRailProps({
      opponentConnected: false,
    }));

    expect(html.match(/opponent disconnected — waiting…/g)).toHaveLength(2);
  });

  it("hides a disconnected opponent after a winner is determined", () => {
    const html = renderSideRail(sideRailProps({
      opponentConnected: false,
      winnerText: "Victory!",
    }));

    expect(html).not.toContain("opponent disconnected");
    expect(html.match(/Victory!/g)).toHaveLength(2);
  });

  it("hides stale opponent connection state while viewing an earlier replay frame", () => {
    const html = renderSideRail(sideRailProps({
      opponentConnected: false,
      winnerText: null,
      replaying: true,
    }));

    expect(html).not.toContain("opponent disconnected");
  });
});

describe("game log hero colors", () => {
  it("marks the player's hero as friendly and the opponent's hero as opponent", () => {
    const html = renderSideRail(sideRailProps({
      log: [
        "— Turn 4: Dash's turn —",
        "Dash plays Zero to Sixty",
        "— Turn 5: Bravo's turn —",
        "Bravo blocks",
        "Dash creates a Quicken",
      ],
    }));

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

  it("renders structured log messages in the selected locale with card references", () => {
    const fallback = "Dash plays Razor Reflex";
    const html = renderSideRail(sideRailProps({
      log: [fallback],
      logEntries: [{
        fallback,
        sequence: 1,
        message: {
          id: "engine.log.card.played",
          values: {
            player: { kind: "player", seat: 0 },
            card: { kind: "card", cardId: "WTR209" },
          },
        },
        event: {
          kind: "card-moved",
          cardId: "WTR209",
          ownerSeat: 0,
          from: "hand",
          to: "stack",
        },
      }],
    }), "zh-Hans");

    expect(html).toContain("Dash");
    expect(html).toContain("打出");
    expect(html).toContain("Razor Reflex");
    expect(html).toContain('class="log-player-ref log-player-ref-friendly"');
    expect(html).toContain('data-cardid="WTR209"');
    expect(html).not.toContain(fallback);
  });

  it("composes localized trigger effects and keeps their source card inspectable", () => {
    const fallback = "Fyendal's Spring Tunic triggers: Add an energy counter";
    const html = renderSideRail(sideRailProps({
      log: [fallback],
      logEntries: [{
        fallback,
        sequence: 1,
        message: {
          id: "engine.log.trigger.card",
          values: {
            triggerSource: { kind: "card", cardId: "WTR150" },
            triggerEffect: { kind: "term", id: "card.trigger.energycounter.add" },
            occurrences: 1,
          },
        },
      }],
    }), "zh-Hans");

    expect(html).toContain("Fyendal&#x27;s Spring Tunic");
    expect(html).toContain("触发：增加一个能量指示物");
    expect(html).toContain('data-cardid="WTR150"');
    expect(html).not.toContain("Add an energy counter");
  });

  it("localizes face-down arsenal logs and keeps the hero inspectable", () => {
    const fallback = "Cindra, Dracai of Retribution puts a card face down into arsenal";
    const html = renderSideRail(sideRailProps({
      log: [fallback],
      logEntries: [{
        fallback,
        sequence: 1,
        message: {
          id: "engine.log.arsenal.facedown.public",
          values: { hero: { kind: "card", cardId: "HNT054" } },
        },
      }],
    }), "zh-Hans");

    expect(html).toContain("Cindra, Dracai of Retribution");
    expect(html).toContain("将一张牌面朝下置入 arsenal");
    expect(html).toContain('data-cardid="HNT054"');
    expect(html).not.toContain("puts a card face down into arsenal");
  });

  it("renders structured turn boundaries in Chinese with player styling", () => {
    const fallback = "— Turn 4: Dash's turn —";
    const html = renderSideRail(sideRailProps({
      log: [fallback],
      logEntries: [{
        fallback,
        sequence: 1,
        message: {
          id: "engine.log.turn.started",
          values: {
            turn: 4,
            player: { kind: "player", seat: 0 },
          },
        },
        event: { kind: "turn-start", turn: 4, activeSeat: 0 },
      }],
    }), "zh-Hans");

    expect(html).toContain("log-turn-divider");
    expect(html).toContain("第 4 回合");
    expect(html).toContain('class="log-player-ref log-player-ref-friendly"');
    expect(html).not.toContain(fallback);
  });
});
