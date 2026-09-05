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
  storageVersion: 2;
  roomVersions: number[];
  replay: ReplayFile;
}

function decodeLocalReplay(raw: string): { replay: ReplayFile; roomVersions: number[] } | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const envelope = value as Record<string, unknown>;
    if (
      Object.keys(envelope).length !== 3 ||
      envelope.storageVersion !== 2 ||
      !Array.isArray(envelope.roomVersions) ||
      !("replay" in envelope)
    ) return null;
    const replay = decodeReplayFile(envelope.replay);
    if (!replay) return null;
    const frameCount = replayFileViews(replay).length;
    const roomVersions = envelope.roomVersions;
    if (roomVersions.length !== frameCount || !roomVersions.every((version, index) =>
      typeof version === "number" && Number.isSafeInteger(version) && version >= 0
      && (index === 0 || version > Number(roomVersions[index - 1]))
    )) return null;
    return { replay, roomVersions: roomVersions as number[] };
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
  private roomVersions: number[] = [];
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
          this.views = replayFileViews(saved.replay);
          this.transitions = replayFileTransitions(saved.replay);
          this.roomVersions = saved.roomVersions;
          this.seat = saved.replay.seat;
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
   * Append a committed frame. Room versions make reconnect deduplication O(1).
   * A versioned restore truncates the invalidated tail and aliases the retained
   * baseline to the new monotonic version instead of recording an undo frame.
   */
  record(
    roomVersion: number,
    view: GameView,
    seat: number | null,
    transition?: GameTransitionView,
  ): boolean {
    this.seat = seat;
    if (transition?.kind === "replace" && transition.restoreVersion !== undefined) {
      return this.restore(roomVersion, transition.restoreVersion, view);
    }
    const lastVersion = this.roomVersions.at(-1);
    if (lastVersion !== undefined && roomVersion <= lastVersion) return false;
    this.views.push(view);
    this.roomVersions.push(roomVersion);
    this.transitions.push(transition
      ? {
          kind: transition.kind,
          ...(transition.restoreVersion === undefined
            ? {}
            : { restoreVersion: transition.restoreVersion }),
          events: transition.events,
        }
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
    this.roomVersions = this.views.map((_, index) => index);
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
    this.roomVersions = [];
  }

  private restore(roomVersion: number, restoreVersion: number, view: GameView): boolean {
    let retainedIndex = -1;
    for (let index = this.roomVersions.length - 1; index >= 0; index--) {
      if (this.roomVersions[index]! <= restoreVersion) {
        retainedIndex = index;
        break;
      }
    }
    this.views.length = retainedIndex + 1;
    this.transitions.length = retainedIndex + 1;
    this.roomVersions.length = retainedIndex + 1;
    if (retainedIndex >= 0) {
      // The retained projection now represents the restored content at the
      // new monotonic room version for any later action/undo pair.
      this.roomVersions[retainedIndex] = roomVersion;
    } else {
      // A late join or cleared checkpoint may not have the historical frame.
      // Keep the authoritative replacement as a safe local replay baseline.
      this.views.push(view);
      this.transitions.push(null);
      this.roomVersions.push(roomVersion);
    }
    this.sincePersist = 0;
    try {
      // A stale checkpoint is worse than temporarily having no reload
      // fallback. Future frames will establish a fresh bounded checkpoint.
      this.storage.removeItem(replayStorageKey(this.code));
    } catch {
      // Storage access is optional; the in-memory timeline remains correct.
    }
    return false;
  }

  private persist(): void {
    this.sincePersist = 0;
    if (this.storageFailed) return;
    try {
      const envelope: LocalReplayEnvelope = {
        storageVersion: 2,
        roomVersions: this.roomVersions,
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
