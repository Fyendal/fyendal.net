import type { GameView } from "@fyendal/shared";
import type { ViewUpdate } from "../../store/types.js";

export type MotionUpdateClassification =
  | { kind: "animate"; direction: "forward" | "backward" }
  | { kind: "settle"; reason: "initial" | "replacement" | "jump" | "different-game" | "undo" | "discontinuous-log" };

type LogRelationship = "continuous" | "undo" | "discontinuous";

function logRelationship(
  previous: readonly string[],
  current: readonly string[],
): LogRelationship {
  if (previous.length === 0 || current.length === 0) return "continuous";
  if (
    current.length < previous.length
    && current.every((line, index) => previous[index] === line)
  ) return "undo";

  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    const previousStart = previous.length - overlap;
    let matches = true;
    for (let index = 0; index < overlap; index++) {
      if (previous[previousStart + index] !== current[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return "continuous";
  }
  return "discontinuous";
}

export function classifyViewUpdate(
  previous: GameView | null,
  current: GameView,
  update: ViewUpdate,
): MotionUpdateClassification {
  if (!previous) return { kind: "settle", reason: "initial" };
  if (previous.gameId !== current.gameId) {
    return { kind: "settle", reason: "different-game" };
  }
  if (update.transition === "replace") {
    return { kind: "settle", reason: "replacement" };
  }
  if (update.transition === "jump") return { kind: "settle", reason: "jump" };

  const relationship = update.transition === "backward"
    ? logRelationship(current.log, previous.log)
    : logRelationship(previous.log, current.log);
  if (relationship === "undo") return { kind: "settle", reason: "undo" };
  if (relationship === "discontinuous") {
    return { kind: "settle", reason: "discontinuous-log" };
  }
  return { kind: "animate", direction: update.transition };
}
