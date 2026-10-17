import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const replayStore = vi.hoisted(() => {
  const state = {
    replayViews: [] as unknown[] | null,
    replayStep: 0,
    replayNotes: [] as Array<{ frame: number; text: string }>,
    setReplayStep: vi.fn(),
    setReplayNote: vi.fn(),
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
  paginateReplayNotes,
  replayStartsCollapsed,
  replayStepTarget,
  replayTurnBoundaries,
  replayKeyDirection,
} from "./ReplayBar.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

afterEach(() => {
  Object.assign(replayStore.state, {
    replayViews: null,
    replayStep: 0,
    replayNotes: [],
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

    const html = renderToStaticMarkup(
      createElement(TestI18nProvider, null, createElement(ReplayBar)),
    );

    expect(html).toContain('class="replay-bar"');
    expect(html).toContain('aria-label="Minimize replay controls"');
    expect(html).toContain('aria-label="Previous 1 replay frame"');
    expect(html).toContain('aria-label="Next 1 replay frame"');
    expect(html).toContain('aria-keyshortcuts="Space ArrowRight"');
    expect(html).toContain('class="replay-control replay-next-button"');
    expect(html).toContain('<kbd class="shortcut-key replay-next-shortcut" aria-label="Space key"></kbd>');
    expect(html).toContain('aria-label="Frames per step"');
    expect(html).toContain('aria-pressed="true" aria-label="Replay step size: 1 frame"');
    expect(html).toContain('aria-pressed="false" aria-label="Replay step size: 5 frames"');
    expect(html).toContain('aria-label="Export replay" class="replay-control replay-export"');
    expect(html).toContain('aria-label="Add a note to frame 2"');
    expect(html).toContain('aria-label="Exit replay" class="replay-control replay-exit"');
    expect(html).not.toContain(" title=");
    expect(html).not.toContain("<svg");
    expect(html).toContain("2 / 2");
    expect(html).not.toContain("Play replay");
    expect(html).not.toContain("replay-bar-collapsed");
  });

  it("highlights marked frames on the scrubber and current note control", () => {
    Object.assign(replayStore.state, {
      replayViews: [{}, {}, {}],
      replayStep: 1,
      replayNotes: [{ frame: 1, text: "Pitch differently here." }],
    });

    const html = renderToStaticMarkup(
      createElement(TestI18nProvider, null, createElement(ReplayBar)),
    );

    expect(html).toContain('class="replay-control replay-note-button active"');
    expect(html).toContain('aria-label="Edit the note on frame 2"');
    expect(html).toContain('aria-label="Open note on frame 2"');
    expect(html).not.toContain('title="Pitch differently here."');
  });

  it("reduces the minimized transport to back, next, and maximize", () => {
    const html = renderToStaticMarkup(createElement(
      TestI18nProvider,
      null,
      createElement(CollapsedReplayControls, {
        replayStep: 4,
        total: 10,
        stepSize: 5,
        setReplayStep: vi.fn(),
        onExpand: vi.fn(),
      }),
    ));

    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Previous 5 replay frames"');
    expect(html).toContain('aria-label="Next 5 replay frames"');
    expect(html).toContain('aria-label="Maximize replay controls"');
    expect(html).toContain('aria-keyshortcuts="Space ArrowRight"');
    expect(html).toContain('class="replay-control replay-next-button"');
    expect(html).toContain("/icons/ui/chevron-left.svg");
    expect(html).toContain("/icons/ui/chevron-right.svg");
  });

  it("marks where each new turn begins on the scrubber", () => {
    expect(replayTurnBoundaries([])).toEqual([]);
    expect(replayTurnBoundaries([1])).toEqual([]);
    expect(replayTurnBoundaries([0, 1, 1, 1, 2])).toEqual([25, 100]);
  });

  it("names the current turn and falls back before turn one", () => {
    Object.assign(replayStore.state, {
      replayViews: [{ turn: 0 }, { turn: 1 }, { turn: 2 }],
      replayStep: 0,
    });
    const render = () => renderToStaticMarkup(
      createElement(TestI18nProvider, null, createElement(ReplayBar)),
    );

    expect(render()).toContain(">Game start</strong>");
    replayStore.state.replayStep = 2;
    const html = render();
    expect(html).toContain(">Turn 2</strong>");
    expect(html).toContain("3 / 3");
    expect(html.match(/<span style="left:/g)).toHaveLength(2);
  });

  it("steps by the selected amount and clamps at replay boundaries", () => {
    expect(replayStepTarget(10, 20, "previous", 5)).toBe(5);
    expect(replayStepTarget(10, 20, "next", 5)).toBe(15);
    expect(replayStepTarget(2, 20, "previous", 5)).toBe(0);
    expect(replayStepTarget(18, 20, "next", 5)).toBe(19);
  });

  it("paginates marked frames in groups of five and clamps stale pages", () => {
    const notes = Array.from({ length: 12 }, (_, frame) => ({ frame, text: `Note ${frame}` }));

    expect(paginateReplayNotes(notes, 0)).toMatchObject({
      page: 0,
      pageCount: 3,
      items: notes.slice(0, 5),
    });
    expect(paginateReplayNotes(notes, 1).items).toEqual(notes.slice(5, 10));
    expect(paginateReplayNotes(notes, 99)).toMatchObject({
      page: 2,
      items: notes.slice(10),
    });
  });

  const keyEvent = {
    code: "Space",
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    target: null,
  };
  const focusedInside = (...matches: string[]) => ({
    closest: (selector: string) => matches.some((match) => selector.includes(match)) ? {} : null,
  }) as unknown as EventTarget;

  it("maps unmodified Space and arrows to replay steps", () => {
    expect(replayKeyDirection(keyEvent)).toBe("next");
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowRight" })).toBe("next");
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft" })).toBe("previous");
    expect(replayKeyDirection({ ...keyEvent, code: "KeyA" })).toBeNull();
    expect(replayKeyDirection({ ...keyEvent, repeat: true })).toBeNull();
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft", repeat: true })).toBe("previous");
    expect(replayKeyDirection({ ...keyEvent, ctrlKey: true })).toBeNull();
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft", altKey: true })).toBeNull();
  });

  it("keeps the shortcuts on the transport after a bar control takes focus", () => {
    for (const code of ["Space", "ArrowLeft", "ArrowRight"]) {
      const event = { ...keyEvent, code };
      expect(replayKeyDirection({ ...event, target: focusedInside(".replay-bar", "button") }))
        .not.toBeNull();
      expect(replayKeyDirection({ ...event, target: focusedInside(".replay-bar", "input") }))
        .not.toBeNull();
      expect(replayKeyDirection({
        ...event,
        target: focusedInside(".replay-bar", ".replay-notes-panel", "textarea"),
      })).toBeNull();
    }
  });

  it("leaves keys to focused controls outside the replay bar", () => {
    expect(replayKeyDirection({ ...keyEvent, target: focusedInside("button") })).toBeNull();
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowRight", target: focusedInside("button") }))
      .toBe("next");
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft", target: focusedInside("input") }))
      .toBeNull();
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft", target: focusedInside("textarea") }))
      .toBeNull();
    expect(replayKeyDirection({ ...keyEvent, code: "ArrowLeft", target: focusedInside("[role='tab']") }))
      .toBeNull();
  });

  it("renders transport accessibility labels in Simplified Chinese", () => {
    Object.assign(replayStore.state, {
      replayViews: [{ turn: 0 }, { turn: 1 }],
      replayStep: 1,
    });

    const html = renderToStaticMarkup(
      <TestI18nProvider locale="zh-Hans">
        <ReplayBar />
      </TestI18nProvider>,
    );

    expect(html).toContain(">第 1 回合</strong>");
    expect(html).toContain(">下一步</span>");
    expect(html).toContain('aria-label="收起回放控制栏"');
    expect(html).toContain('aria-label="导出回放"');
    expect(html).toContain('aria-label="退出回放"');
  });
});
