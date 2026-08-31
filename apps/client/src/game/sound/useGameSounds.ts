import { useEffect, useRef } from "react";
import type { GameView } from "@fyendal/shared";
import type { ViewUpdate } from "../../store/types.js";
import { detectDeckCardEvents } from "../deckCardEvents.js";
import { classifyViewUpdate } from "../motion/classifyViewUpdate.js";
import { detectGameMotionEvents } from "../motion/detectMotionEvents.js";
import { GameAudioPlayer } from "./gameAudioPlayer.js";
import { gameSoundCuesForEvents } from "./gameSoundCues.js";

export function useGameSounds({
  view,
  viewUpdate,
  enabled,
  volume,
}: {
  view: GameView | null;
  viewUpdate: ViewUpdate;
  enabled: boolean;
  volume: number;
}): void {
  const playerRef = useRef<GameAudioPlayer | null>(null);
  if (!playerRef.current) playerRef.current = new GameAudioPlayer();
  const previousViewRef = useRef<GameView | null>(view);
  const processedSequenceRef = useRef(viewUpdate.sequence);

  useEffect(() => {
    const player = playerRef.current!;
    player.setEnabled(enabled);
    player.setVolume(volume);
    if (!enabled) return;

    void player.prepare();
    const unlock = () => void player.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });
    // Entering the game normally follows lobby interaction, so browsers with
    // sticky user activation can start immediately. Others retry on the next
    // in-game gesture through the listeners above.
    void player.unlock();
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("keydown", unlock, { capture: true });
    };
  }, [enabled, volume]);

  useEffect(() => () => playerRef.current?.dispose(), []);

  useEffect(() => {
    if (processedSequenceRef.current === viewUpdate.sequence) return;
    const previous = previousViewRef.current;
    previousViewRef.current = view;
    processedSequenceRef.current = viewUpdate.sequence;
    if (!enabled || !previous || !view) return;
    const classification = classifyViewUpdate(previous, view, viewUpdate);
    if (classification.kind !== "animate" || classification.direction !== "forward") return;
    const cues = gameSoundCuesForEvents(
      detectGameMotionEvents(previous, view),
      detectDeckCardEvents(previous, view),
    );
    playerRef.current?.play(cues);
  }, [enabled, view, viewUpdate]);
}
