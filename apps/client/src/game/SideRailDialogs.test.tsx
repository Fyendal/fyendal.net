import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GameSettingsDialog } from "./SideRailDialogs.js";

describe("game settings dialog", () => {
  it("offers default, full, and reduced animation preferences", () => {
    const html = renderToStaticMarkup(createElement(GameSettingsDialog, {
      turn: 1,
      onUndo: null,
      onConcede: null,
      priorityWindowMode: "always-pause",
      onPriorityWindowModeChange: null,
      lessGuidance: false,
      onLessGuidanceChange: vi.fn(),
      skipPlayConfirmation: true,
      onSkipPlayConfirmationChange: vi.fn(),
      motionPreference: "reduced",
      onMotionPreferenceChange: vi.fn(),
      onClose: vi.fn(),
    }));

    expect(html).toContain('aria-label="Animation preference"');
    expect(html).toContain('class="settings-control-row settings-motion-row"');
    expect(html).toContain(">Default</button>");
    expect(html).toContain(">Full</button>");
    expect(html).toContain(">Reduced</button>");
    expect(html).toContain("Default follows your operating system&#x27;s reduced-motion setting");
    expect(html).toContain('class="settings-selected" aria-pressed="true"');
  });
});
