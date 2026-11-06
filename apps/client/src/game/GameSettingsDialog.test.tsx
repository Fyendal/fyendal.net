import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GameSettingsDialog } from "./GameSettingsDialog.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { PLAYMAT_IDS } from "../playmats.js";

type DialogProps = ComponentProps<typeof GameSettingsDialog>;

function baseProps(): DialogProps {
  return {
    turn: 1,
    onUndo: vi.fn(),
    onConcede: vi.fn(),
    priorityWindowMode: "always-pause",
    onPriorityWindowModeChange: vi.fn(),
    lessGuidance: false,
    onLessGuidanceChange: vi.fn(),
    skipPlayConfirmation: true,
    onSkipPlayConfirmationChange: vi.fn(),
    warnLethalPass: true,
    onWarnLethalPassChange: vi.fn(),
    optionHotkeys: false,
    onOptionHotkeysChange: vi.fn(),
    showGameClock: true,
    onShowGameClockChange: vi.fn(),
    cardDisplayPreference: "full",
    onCardDisplayPreferenceChange: vi.fn(),
    playmat: "leather",
    onPlaymatChange: vi.fn(),
    botPlaymat: "leather",
    onBotPlaymatChange: vi.fn(),
    motionPreference: "reduced",
    onMotionPreferenceChange: vi.fn(),
    playabilityCuePreference: "high-contrast",
    onPlayabilityCuePreferenceChange: vi.fn(),
    soundEffectsEnabled: true,
    onSoundEffectsEnabledChange: vi.fn(),
    soundEffectsVolume: 35,
    onSoundEffectsVolumeChange: vi.fn(),
    priorityAlertMode: "unfocused",
    onPriorityAlertModeChange: vi.fn(),
    onClose: vi.fn(),
  };
}

function settingsDialog(overrides: Partial<DialogProps> = {}, locale: "en" | "zh-Hans" = "en") {
  return renderToStaticMarkup(
    <TestI18nProvider locale={locale}>
      <GameSettingsDialog {...baseProps()} {...overrides} />
    </TestI18nProvider>,
  );
}

describe("game settings dialog", () => {
  it("offers one tab per settings area and a match tab for in-game actions", () => {
    const html = settingsDialog();

    expect(html).toContain('class="modal-backdrop modal-surface-backdrop settings-backdrop"');
    expect(html).toContain('class="modal-surface settings-surface"');
    expect(html).toContain('role="tablist" aria-label="Settings"');
    expect(html.match(/role="tab"/g)).toHaveLength(5);
    expect(html).toContain('aria-selected="true" aria-controls=');
    expect(html).toContain('class="settings-nav-item settings-nav-selected" aria-selected="true"');
    for (const label of ["Gameplay", "Interface", "Playmat", "Sound", "Match"]) {
      expect(html).toContain(`>${label}</button>`);
    }
    expect(html).toContain('class="settings-nav-divider" role="separator"');
    expect(html).toContain('role="tabpanel"');
    expect(html).toContain('class="settings-pane-title">Gameplay</h3>');
  });

  it("hides the match tab when the viewer has no in-game actions", () => {
    const html = settingsDialog({ onUndo: null, onConcede: null, onDrawIntent: null });

    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html).not.toContain(">Match</button>");
    expect(html).not.toContain('role="separator"');
  });

  it("explains the selected priority choice and describes each toggle in place", () => {
    const html = settingsDialog();

    expect(html).toContain('aria-label="Priority behavior"');
    expect(html).toContain('class="settings-selected" aria-pressed="true">Always pause</button>');
    expect(html).toContain('aria-pressed="false">Auto-pass</button>');
    expect(html).toContain("Stops at every priority and reaction window, even when nothing can be played.");
    expect(html).not.toContain("Passes priority for you whenever");
    expect(html).toContain(">Confirm actions</span>");
    expect(html).toContain("Asks for confirmation before playing a card or activating an ability.");
    expect(html).toContain('type="checkbox" role="switch" aria-labelledby=');
    expect(html).not.toContain("Instant bot moves");
  });

  it("offers instant bot moves and hides the priority choice when the room lacks them", () => {
    const html = settingsDialog({ onPriorityWindowModeChange: null, onSkipBotDelayChange: vi.fn() });

    expect(html).not.toContain("Priority behavior");
    expect(html).toContain(">Instant bot moves</span>");
    expect(html).toContain("Beta: the practice bot acts as soon as it decides");
  });

  it("groups language, card display, playable cue, animations and the clock under Interface", () => {
    const html = settingsDialog({ initialTab: "interface" });

    expect(html).toContain('class="settings-pane-title">Interface</h3>');
    expect(html).toContain('class="settings-row settings-language-row"');
    expect(html).toContain('<select aria-label="Language">');
    expect(html).toContain('<option value="en" lang="en" selected="">English</option>');
    expect(html).toContain('aria-label="Card display"');
    expect(html).toContain('class="settings-selected" aria-pressed="true">Full card</button>');
    expect(html).toContain("Cards on the table show their whole face.");
    expect(html).toContain('aria-label="Playable card cue"');
    expect(html).toContain("A crisp outline marks the cards you can play right now.");
    expect(html).toContain('aria-label="Animation preference" aria-describedby=');
    expect(html).toContain('data-count="3"');
    expect(html).toContain("Hides card travel and connections, keeping only local card fades.");
    expect(html).toContain(">Show game clock</span>");
  });

  it("keeps sound, volume and the priority alert together", () => {
    const html = settingsDialog({ initialTab: "sound", soundEffectsEnabled: false });

    expect(html).toContain(">Sound effects</span>");
    expect(html).toContain('aria-label="Sound effects volume"');
    expect(html).toContain('style="--volume-progress:35%"');
    expect(html).toContain('class="settings-row settings-volume-row settings-row-disabled"');
    expect(html).toContain('aria-label="Priority alert"');
    expect(html).toContain("Chimes when priority returns to you while the game is out of focus.");
    expect(html.match(/aria-pressed="(?:true|false)" disabled=""/g)).toHaveLength(3);
  });

  it("lists undo, draw and concede on the match tab", () => {
    const html = settingsDialog({
      initialTab: "match",
      turn: 4,
      undoDisabled: true,
      onDrawIntent: vi.fn(),
    });

    expect(html).toContain('class="settings-group-title">Undo</h4>');
    expect(html).toContain(">Undo last action</button>");
    expect(html).toContain(">Beginning of turn 4</button>");
    expect(html).toContain(">Beginning of turn 3</button>");
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain('class="settings-group-title">Draw</h4>');
    expect(html).toContain(">Offer a draw</button>");
    expect(html).toContain('class="settings-group settings-group-danger"');
    expect(html).toContain("Ends the game as a loss for you.");
    expect(html).toContain('class="settings-danger-button">Concede game</button>');
  });

  it("falls back to gameplay when the requested tab is unavailable", () => {
    const html = settingsDialog({ initialTab: "match", onUndo: null, onConcede: null });

    expect(html).toContain('class="settings-pane-title">Gameplay</h3>');
  });

  it("renders tabs, labels and accessible controls in Simplified Chinese", () => {
    const html = settingsDialog({ initialTab: "interface", priorityWindowMode: "auto-pass" }, "zh-Hans");

    expect(html).toContain('aria-label="卡牌显示"');
    expect(html).toContain('aria-pressed="false">方形</button>');
    expect(html).toContain('class="settings-selected" aria-pressed="true">完整卡牌</button>');
    expect(html).toContain(">设置</h2>");
    expect(html).toContain(">游戏操作</button>");
    expect(html).toContain(">界面</button>");
    expect(html).toContain(">对局</button>");
    expect(html).toContain('aria-label="动画偏好"');
  });

  it("offers every playmat as a radio swatch and marks the chosen one", () => {
    const html = settingsDialog({ initialTab: "playmat", playmat: "monarch" });

    expect(html).toContain('class="settings-pane-title">Playmat</h3>');
    expect(html).toMatch(/role="radiogroup" aria-labelledby="[^"]+-tab-playmat"/);
    expect(html.match(/type="radio" name="playmat-own"/g)).toHaveLength(PLAYMAT_IDS.length);
    expect(html).toContain('class="playmat-swatch playmat-swatch-selected" data-playmat="monarch"');
    expect(html).toContain('name="playmat-own" checked="" value="monarch"');
    expect(html).toContain('aria-label="Side"');
    expect(html).toContain('class="settings-selected" aria-pressed="true">Yours</button>');
    expect(html).toContain('aria-pressed="false">Practice bots</button>');
    expect(html).toContain("Your half of the table. Opponents see it too.");
    expect(html).toContain('src="/playmats/thumbs/monarch.jpg"');
    expect(html).toContain(">Map of Rathe</span>");
    expect(html).toContain(">Leather</span>");
    expect(html).not.toContain('src="/playmats/thumbs/leather.jpg"');
    expect(html).toContain(">Artwork by Legend Story Studios</p>");
  });
});
