import { useEffect, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";

type ReplayStepSize = 1 | 5;
type KeyboardTarget = EventTarget & { closest?: (selector: string) => Element | null };
const MOBILE_REPLAY_BREAKPOINT = 700;

export function replayStartsCollapsed(
  viewportWidth = typeof window === "undefined" ? undefined : window.innerWidth,
): boolean {
  return viewportWidth !== undefined && viewportWidth <= MOBILE_REPLAY_BREAKPOINT;
}

export function replayStepTarget(
  current: number,
  total: number,
  direction: "previous" | "next",
  stepSize: ReplayStepSize,
): number {
  const delta = direction === "next" ? stepSize : -stepSize;
  return Math.max(0, Math.min(current + delta, total - 1));
}

export function shouldAdvanceReplayOnSpace(
  event: Pick<KeyboardEvent, "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target">,
): boolean {
  if (
    event.code !== "Space" ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) return false;

  const target = event.target as KeyboardTarget | null;
  return !target?.closest?.(
    "input, textarea, select, button, a, [contenteditable='true'], [role='button']",
  );
}

export function CollapsedReplayControls({
  replayStep,
  total,
  stepSize,
  setReplayStep,
  onExpand,
}: {
  replayStep: number;
  total: number;
  stepSize: ReplayStepSize;
  setReplayStep: (step: number) => void;
  onExpand: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="replay-step-button"
        aria-label={`Previous ${stepSize} replay ${stepSize === 1 ? "frame" : "frames"}`}
        disabled={replayStep <= 0}
        onClick={() => setReplayStep(replayStepTarget(replayStep, total, "previous", stepSize))}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        className="replay-step-button replay-next-button shortcut-button"
        aria-label={`Next ${stepSize} replay ${stepSize === 1 ? "frame" : "frames"}`}
        aria-keyshortcuts="Space"
        title={`Next ${stepSize === 1 ? "frame" : `${stepSize} frames`} (Space)`}
        disabled={replayStep >= total - 1}
        onClick={() => setReplayStep(replayStepTarget(replayStep, total, "next", stepSize))}
      >
        <span aria-hidden="true">→</span>
        <kbd className="shortcut-key replay-next-shortcut" aria-label="Space key" />
      </button>
      <button
        type="button"
        className="replay-maximize"
        aria-label="Maximize replay controls"
        aria-expanded="false"
        onClick={onExpand}
      >
        <span aria-hidden="true">⌃</span>
      </button>
    </>
  );
}

/** Transport controls overlaid at the bottom of the board during replay. */
export function ReplayBar() {
  const { replayViews, replayStep, setReplayStep, closeReplay, downloadReplay } = useStore(
    useShallow((state) => ({
      replayViews: state.replayViews,
      replayStep: state.replayStep,
      setReplayStep: state.setReplayStep,
      closeReplay: state.closeReplay,
      downloadReplay: state.downloadReplay,
    })),
  );
  const [collapsed, setCollapsed] = useState(replayStartsCollapsed);
  const [stepSize, setStepSize] = useState<ReplayStepSize>(1);

  const total = replayViews?.length ?? 0;
  const progress = total <= 1 ? 0 : (replayStep / (total - 1)) * 100;

  useEffect(() => {
    const advanceOnSpace = (event: KeyboardEvent) => {
      if (!shouldAdvanceReplayOnSpace(event)) return;
      const current = useStore.getState();
      const currentTotal = current.replayViews?.length ?? 0;
      if (currentTotal === 0 || current.replayStep >= currentTotal - 1) return;
      event.preventDefault();
      current.setReplayStep(
        replayStepTarget(current.replayStep, currentTotal, "next", stepSize),
      );
    };
    window.addEventListener("keydown", advanceOnSpace);
    return () => window.removeEventListener("keydown", advanceOnSpace);
  }, [stepSize]);

  if (!replayViews || total === 0) return null;

  return (
    <div className={`replay-bar${collapsed ? " replay-bar-collapsed" : ""}`}>
      {collapsed ? (
        <CollapsedReplayControls
          replayStep={replayStep}
          total={total}
          stepSize={stepSize}
          setReplayStep={setReplayStep}
          onExpand={() => setCollapsed(false)}
        />
      ) : (
        <>
          <span className="replay-title">Replay</span>
          <button
            type="button"
            className="replay-collapse-toggle"
            aria-label="Minimize replay controls"
            aria-expanded="true"
            onClick={() => setCollapsed(true)}
          >
            <span aria-hidden="true">—</span>
          </button>
          <button
            className="replay-step-button"
            aria-label={`Previous ${stepSize} replay ${stepSize === 1 ? "frame" : "frames"}`}
            onClick={() => setReplayStep(
              replayStepTarget(replayStep, total, "previous", stepSize),
            )}
            disabled={replayStep <= 0}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            className="replay-step-button replay-next-button shortcut-button"
            aria-label={`Next ${stepSize} replay ${stepSize === 1 ? "frame" : "frames"}`}
            aria-keyshortcuts="Space"
            title={`Next ${stepSize === 1 ? "frame" : `${stepSize} frames`} (Space)`}
            onClick={() => setReplayStep(
              replayStepTarget(replayStep, total, "next", stepSize),
            )}
            disabled={replayStep >= total - 1}
          >
            <span aria-hidden="true">→</span>
            <kbd className="shortcut-key replay-next-shortcut" aria-label="Space key" />
          </button>
          <div
            className="replay-scrubber"
            style={{ "--replay-progress": `${progress}%` } as CSSProperties}
          >
            <input
              aria-label="Replay frame"
              type="range"
              min={0}
              max={total - 1}
              value={replayStep}
              onChange={(e) => {
                setReplayStep(Number(e.target.value));
              }}
            />
          </div>
          <span className="replay-pos">{replayStep + 1} / {total}</span>
          <button
            type="button"
            className="replay-step-size"
            aria-label={`Replay step size: ${stepSize} ${stepSize === 1 ? "frame" : "frames"}`}
            onClick={() => setStepSize((current) => current === 1 ? 5 : 1)}
          >
            {stepSize}×
          </button>
          <button
            type="button"
            className="replay-action-icon"
            aria-label="Export replay"
            title="Export replay"
            onClick={downloadReplay}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z" />
            </svg>
          </button>
          <button
            type="button"
            className="replay-action-icon"
            aria-label="Exit replay"
            title="Exit replay"
            onClick={closeReplay}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="m6.4 5-1.4 1.4 5.6 5.6L5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
