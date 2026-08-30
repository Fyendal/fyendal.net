import type { ReplayFile } from "@fyendal/shared";
import type { PreReplaySnapshot, StoreState } from "./types.js";

export function snapshotBeforeReplay(state: StoreState): PreReplaySnapshot | null {
  if (state.screen !== "game") return null;
  return {
    view: state.view,
    legal: state.legal,
    actionCandidates: state.actionCandidates,
    yourSeat: state.yourSeat,
    spectating: state.spectating,
    spectatorCount: state.spectatorCount,
    playerProfiles: state.playerProfiles,
  };
}

export function replayViewerProjection(
  file: ReplayFile,
  savedReplayId: string | null,
): Partial<StoreState> {
  return {
    screen: "replay",
    replayViews: file.views,
    replayStep: 0,
    activeSavedReplayId: savedReplayId,
    view: file.views[0]!,
    legal: [],
    actionCandidates: [],
    yourSeat: file.seat,
    spectating: true,
    spectatorCount: 0,
    playerProfiles: null,
    botGame: false,
    error: null,
  };
}
