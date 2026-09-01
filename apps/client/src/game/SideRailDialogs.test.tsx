import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GameSettingsDialog } from "./SideRailDialogs.js";

describe("game settings dialog", () => {
  it("groups game settings into clear responsive sections", () => {
    const html = renderToStaticMarkup(createElement(GameSettingsDialog, {
      turn: 1,
      onUndo: vi.fn(),
      onConcede: vi.fn(),
      priorityWindowMode: "always-pause",
      onPriorityWindowModeChange: null,
      lessGuidance: false,
      onLessGuidanceChange: vi.fn(),
      skipPlayConfirmation: true,
      onSkipPlayConfirmationChange: vi.fn(),
      motionPreference: "reduced",
      onMotionPreferenceChange: vi.fn(),
      playabilityCuePreference: "high-contrast",
      onPlayabilityCuePreferenceChange: vi.fn(),
      soundEffectsEnabled: true,
      onSoundEffectsEnabledChange: vi.fn(),
      soundEffectsVolume: 35,
      onSoundEffectsVolumeChange: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(html).toContain('aria-label="Animation preference"');
    expect(html).toContain('class="settings-grid"');
    expect(html.match(/class="settings-section/g)).toHaveLength(4);
    expect(html).toContain(">Gameplay</h3>");
    expect(html).toContain(">Audio &amp; Visuals</h3>");
    expect(html).toContain(">Game History</h3>");
    expect(html).toContain(">Danger Zone</h3>");
    expect(html).toContain('class="settings-control-row settings-motion-row"');
    expect(html).toContain(">Default</button>");
    expect(html).toContain(">Full</button>");
    expect(html).toContain(">Reduced</button>");
    expect(html).toContain("Default follows your operating system&#x27;s reduced-motion setting");
    expect(html).toContain('class="settings-selected" aria-pressed="true"');
    expect(html).toContain('aria-label="Sound effects"');
    expect(html).toContain('aria-label="Sound effects volume"');
    expect(html).toContain('style="--volume-progress:35%"');
    expect(html).toContain("35%");
    expect(html).toContain('aria-label="Playable card cue"');
    expect(html).toContain(">Glow</button>");
    expect(html).toContain(">High contrast</button>");
    expect(html).toContain("Glow adds a restrained green halo");
  });
});
