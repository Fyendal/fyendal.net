import { describe, expect, it } from "vitest";
import type { GameView, ReplayFile } from "@fyendal/shared";
import type { ReplayServerNote } from "@fyendal/protocol";
import { withReplayNotes } from "./replayFileNotes.js";

const view = { gameId: "ABC123" } as GameView;

describe("annotated replay files", () => {
  it("adds current notes to an exported replay", () => {
    const file: ReplayFile = {
      version: 2,
      seat: 0,
      frames: [{ view, transition: null }],
    };

    const notes: ReplayServerNote[] = [
      { frame: 0, roomVersion: 12, text: "Review this defense." },
    ];
    expect(withReplayNotes(file, notes))
      .toEqual({
        version: 3,
        seat: 0,
        frames: file.frames,
        notes: [{ frame: 0, text: "Review this defense." }],
      });
  });

  it("replaces or removes notes from an imported annotated replay", () => {
    const file: ReplayFile = {
      version: 3,
      seat: 0,
      frames: [{ view, transition: null }],
      notes: [{ frame: 0, text: "Original thought" }],
    };

    expect(withReplayNotes(file, [{ frame: 0, text: "Updated thought" }])).toMatchObject({
      version: 3,
      notes: [{ frame: 0, text: "Updated thought" }],
    });
    expect(withReplayNotes(file, [])).toMatchObject({ version: 3, notes: [] });
  });

  it("leaves an unannotated replay in its existing format", () => {
    const file: ReplayFile = {
      version: 1,
      seat: 1,
      views: [view],
    };

    expect(withReplayNotes(file, [])).toBe(file);
  });
});
