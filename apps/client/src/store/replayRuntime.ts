import type { GameTransitionView, GameView, ReplayFile } from "@fyendal/shared";
import { ReplayRecorder } from "../replay/recorder.js";
import { replayStorageKey } from "../storage.js";

export interface ReplayRuntime {
  recordFrame: (code: string, view: GameView, seat: number | null, transition?: GameTransitionView) => number;
  discard: (code?: string | null) => void;
  detach: () => void;
  replace: (code: string, file: ReplayFile) => number;
  getFile: () => ReplayFile | null;
  getViews: () => GameView[];
}

export function createReplayRuntime(storage: Storage): ReplayRuntime {
  let recorder: ReplayRecorder | null = null;
  let recorderCode: string | null = null;

  const ensureRecorder = (code: string) => {
    if (recorderCode !== code) {
      recorder = new ReplayRecorder(code, storage);
      recorderCode = code;
    }
    return recorder!;
  };

  return {
    recordFrame: (code, view, seat, transition) => {
      const activeRecorder = ensureRecorder(code);
      activeRecorder.record(view, seat, transition);
      if (view.winner !== null) activeRecorder.finish();
      return activeRecorder.length;
    },
    discard: (code) => {
      if (recorder) recorder.discard();
      else if (code) storage.removeItem(replayStorageKey(code));
      recorder = null;
      recorderCode = null;
    },
    detach: () => {
      recorder?.checkpoint();
      recorder = null;
      recorderCode = null;
    },
    replace: (code, file) => {
      const activeRecorder = ensureRecorder(code);
      activeRecorder.replace(file);
      return activeRecorder.length;
    },
    getFile: () => recorder && recorder.length > 0 ? recorder.toFile() : null,
    getViews: () => recorder?.frames() ?? [],
  };
}

export function downloadReplayFile(file: ReplayFile): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(file)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `fyendal-replay-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
