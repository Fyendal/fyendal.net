import { randomUUID } from "node:crypto";
import type { StateFrame, StateMessage } from "@fyendal/shared";

/** One instance per socket. Runs only on an already authorized projection. */
export class StateLogTransport {
  private stream = randomUUID();
  private sequence = 0;
  private previous: {
    gameId: string; seat: number | null; version: number; keys: string[]; structured: boolean;
  } | null = null;

  reset(): void {
    this.stream = randomUUID();
    this.sequence = 0;
    this.previous = null;
  }

  encode(state: StateMessage): StateFrame {
    const keys = state.view.log.map((text, index) => JSON.stringify([text, state.view.logEntries?.[index]]));
    const structured = state.view.logEntries !== undefined;
    const previous = this.previous;
    let drop: number | null = null;
    let retained = 0;
    if (previous && state.transition?.kind !== "replace"
      && previous.gameId === state.view.gameId && previous.seat === state.yourSeat
      && previous.structured === structured && previous.version <= state.version
      && keys.length >= previous.keys.length) {
      // Find the longest suffix/prefix overlap, including the 200-entry rollover.
      for (let start = 0; start < previous.keys.length; start++) {
        const length = previous.keys.length - start;
        if (previous.keys.slice(start).every((key, index) => key === keys[index])) {
          drop = start;
          retained = length;
          break;
        }
      }
      if (previous.keys.length === 0) drop = 0;
    }
    const frame: StateFrame = {
      type: "state-frame", stream: this.stream, sequence: ++this.sequence, drop, state,
    };
    if (drop !== null) {
      frame.state = { ...state, view: { ...state.view, log: state.view.log.slice(retained),
        ...(structured ? { logEntries: state.view.logEntries!.slice(retained) } : {}),
      } };
    }
    this.previous = { gameId: state.view.gameId, seat: state.yourSeat, version: state.version, keys, structured };
    return frame;
  }
}
