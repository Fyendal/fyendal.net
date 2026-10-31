import type { ReplayFile, ReplayNote } from "@fyendal/shared";
import { replayFileClock, replayFileTransitions, replayFileViews } from "@fyendal/protocol";

/** Combine the currently edited in-memory notes with a portable replay file. */
export function withReplayNotes(file: ReplayFile, notes: readonly ReplayNote[]): ReplayFile {
  if (notes.length === 0 && file.version !== 3) return file;
  const views = replayFileViews(file);
  const transitions = replayFileTransitions(file);
  const clock = replayFileClock(file);
  return {
    version: 3,
    seat: file.seat,
    ...(clock ? { clock } : {}),
    frames: views.map((view, index) => ({
      view,
      transition: transitions[index] ?? null,
    })),
    notes: notes.map(({ frame, text }) => ({ frame, text })),
  };
}
