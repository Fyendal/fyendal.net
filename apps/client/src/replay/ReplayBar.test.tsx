import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const replayStore = vi.hoisted(() => {
  const state = {
    replayViews: [] as unknown[] | null,
    replayStep: 0,
    setReplayStep: vi.fn(),
    closeReplay: vi.fn(),
    downloadReplay: vi.fn(),
  };
  return {
    state,
    useStore: Object.assign(
      <T,>(selector: (value: typeof state) => T) => selector(state),
      { getState: () => state },
    ),
  };
});

vi.mock("../store.js", () => {
  return { useStore: replayStore.useStore };
});

import {
  CollapsedReplayControls,
  ReplayBar,
  replayStartsCollapsed,
  replayStepTarget,
  shouldAdvanceReplayOnSpace,
} from "./ReplayBar.js";

afterEach(() => {
  Object.assign(replayStore.state, {
    replayViews: null,
    replayStep: 0,
  });
});

describe("replay controls", () => {
  it("starts minimized on mobile-sized viewports", () => {
    expect(replayStartsCollapsed(700)).toBe(true);
    expect(replayStartsCollapsed(701)).toBe(false);
  });

  it("offers a minimize control while the full transport is open", () => {
    Object.assign(replayStore.state, {
      replayViews: [{}, {}],
      replayStep: 1,
    });

    const html = renderToStaticMarkup(createElement(ReplayBar));

    expect(html).toContain('class="replay-bar"');
    expect(html).toContain('aria-label="Minimize replay controls"');
    expect(html).toContain('aria-label="Previous 1 replay frame"');
    expect(html).toContain('aria-label="Next 1 replay frame"');
    expect(html).toContain('aria-keyshortcuts="Space"');
    expect(html).toContain('class="replay-step-button replay-next-button shortcut-button"');
    expect(html).toContain('<kbd class="shortcut-key replay-next-shortcut" aria-label="Space key"></kbd>');
    expect(html).toContain('aria-label="Replay step size: 1 frame"');
    expect(html).toContain('class="replay-action-icon" aria-label="Export replay"');
    expect(html).toContain('class="replay-action-icon" aria-label="Exit replay"');
    expect(html).not.toContain('>Export replay</button>');
    expect(html).not.toContain('>Exit replay</button>');
    expect(html).toContain("2 / 2");
    expect(html).not.toContain("Play replay");
    expect(html).toContain("1×");
    expect(html).not.toContain("replay-bar-collapsed");
  });

  it("reduces the minimized transport to back, next, and maximize", () => {
    const html = renderToStaticMarkup(createElement(CollapsedReplayControls, {
      replayStep: 4,
      total: 10,
      stepSize: 5,
      setReplayStep: vi.fn(),
      onExpand: vi.fn(),
    }));

    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Previous 5 replay frames"');
    expect(html).toContain('aria-label="Next 5 replay frames"');
    expect(html).toContain('aria-label="Maximize replay controls"');
    expect(html).toContain('aria-keyshortcuts="Space"');
    expect(html).toContain('class="replay-step-button replay-next-button shortcut-button"');
    expect(html).toContain("←");
    expect(html).toContain("→");
  });

  it("steps by the selected amount and clamps at replay boundaries", () => {
    expect(replayStepTarget(10, 20, "previous", 5)).toBe(5);
    expect(replayStepTarget(10, 20, "next", 5)).toBe(15);
    expect(replayStepTarget(2, 20, "previous", 5)).toBe(0);
    expect(replayStepTarget(18, 20, "next", 5)).toBe(19);
  });

  it("uses unmodified Space outside interactive controls", () => {
    const event = {
      code: "Space",
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
    } as KeyboardEvent;

    expect(shouldAdvanceReplayOnSpace(event)).toBe(true);
    expect(shouldAdvanceReplayOnSpace({ ...event, repeat: true })).toBe(false);
    expect(shouldAdvanceReplayOnSpace({ ...event, ctrlKey: true })).toBe(false);
    expect(shouldAdvanceReplayOnSpace({
      ...event,
      target: { closest: () => ({}) } as unknown as EventTarget,
    })).toBe(false);
  });
});
