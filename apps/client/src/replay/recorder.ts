import type { GameTransitionView, GameView, ReplayFile } from "@fyendal/shared";
import {
  decodeReplayFile,
  replayFileTransitions,
  replayFileViews,
} from "@fyendal/protocol";
import { REPLAY_STORAGE_PREFIX, replayStorageKey } from "../storage.js";

/** Minimal storage interface, so the recorder is testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EnumerableStorageLike extends StorageLike {
  readonly length: number;
  key(index: number): string | null;
}

interface LocalReplayEnvelope {
  storageVersion: 1;
  replay: ReplayFile;
}

function decodeLocalReplay(raw: string): ReplayFile | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Record<string, unknown>;
    if (
      Object.keys(envelope).length !== 2 ||
      envelope.storageVersion !== 1 ||
      !("replay" in envelope)
    ) return null;
    return decodeReplayFile(envelope.replay);
  } catch {
    return null;
  }
}

/** Remove pre-launch/corrupt local fallback recordings. Downloaded replay
 * files are unaffected; those are explicit user-owned files. */
export function removeUnsupportedLocalReplays(storage: EnumerableStorageLike): number {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(REPLAY_STORAGE_PREFIX)) keys.push(key);
    }
  } catch {
    return 0;
  }
  let removed = 0;
  for (const key of keys) {
    try {
      const raw = storage.getItem(key);
      if (raw && !decodeLocalReplay(raw)) {
        storage.removeItem(key);
        removed += 1;
      }
    } catch {
      // Storage access can be blocked independently for each operation.
    }
  }
  return removed;
}

/** Persist to storage at most every N new frames — a mid-game page reload
 *  loses only the unpersisted tail. */
export const PERSIST_EVERY = 25;

/**
 * Records every GameView the client receives during a match. This local copy
 * gives immediate playback and a reload fallback; the server separately keeps
 * authoritative full-information frames for its retained replay.
 */
export class ReplayRecorder {
  private views: GameView[] = [];
  private transitions: Array<Omit<GameTransitionView, "fromVersion"> | null> = [];
  private seat: number | null = null;
  private sincePersist = 0;
  private storageFailed = false;

  constructor(
    private code: string,
    private storage: StorageLike,
  ) {
    try {
      const raw = storage.getItem(replayStorageKey(code));
      if (raw) {
        const saved = decodeLocalReplay(raw);
        if (saved) {
          this.views = replayFileViews(saved);
          this.transitions = replayFileTransitions(saved);
          this.seat = saved.seat;
        } else {
          storage.removeItem(replayStorageKey(code));
        }
      }
    } catch {
      // corrupt entry — start fresh
    }
  }

  get length(): number {
    return this.views.length;
  }

  get recordedSeat(): number | null {
    return this.seat;
  }

  /**
   * Append a frame. Reconnects re-send the current state, so a frame identical
   * to the previous one is skipped. Returns true when a frame was added.
   */
  record(view: GameView, seat: number | null, transition?: GameTransitionView): boolean {
    this.seat = seat;
    const last = this.views[this.views.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(view)) return false;
    this.views.push(view);
    this.transitions.push(transition
      ? { kind: transition.kind, events: transition.events }
      : null);
    if (++this.sincePersist >= PERSIST_EVERY) this.persist();
    return true;
  }

  /** Force-persist — called when the game ends. */
  finish(): void {
    this.persist();
  }

  /** Persist the current tail before temporarily leaving a live room. */
  checkpoint(): void {
    this.persist();
  }

  /** Replace a partial local recording with the authoritative server copy. */
  replace(file: ReplayFile): void {
    this.views = replayFileViews(file);
    this.transitions = replayFileTransitions(file);
    this.seat = file.seat;
    this.sincePersist = 0;
    this.storageFailed = false;
    this.persist();
  }

  toFile(): ReplayFile {
    return {
      version: 2,
      seat: this.seat,
      frames: this.views.map((view, index) => ({
        view,
        transition: this.transitions[index] ?? null,
      })),
    };
  }

  /** All recorded frames (for end-of-game stats). */
  frames(): GameView[] {
    return [...this.views];
  }

  /** Drop the recording from storage (leave / room gone). */
  discard(): void {
    try {
      this.storage.removeItem(replayStorageKey(this.code));
    } catch {
      // storage unavailable — nothing to clean up
    }
    this.views = [];
    this.transitions = [];
  }

  private persist(): void {
    this.sincePersist = 0;
    if (this.storageFailed) return;
    try {
      const envelope: LocalReplayEnvelope = {
        storageVersion: 1,
        replay: this.toFile(),
      };
      this.storage.setItem(replayStorageKey(this.code), JSON.stringify(envelope));
    } catch {
      // quota exceeded — keep recording in memory only
      this.storageFailed = true;
    }
  }
}

/** Parse a downloaded replay JSON; returns an error message on invalid input. */
export function parseReplayFile(
  text: string,
): { ok: true; file: ReplayFile } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(text);
    const data = decodeReplayFile(parsed);
    if (!data || replayFileViews(data).length === 0) {
      return { ok: false, error: "not a valid replay file" };
    }
    return { ok: true, file: data };
  } catch {
    return { ok: false, error: "not valid JSON" };
  }
}
