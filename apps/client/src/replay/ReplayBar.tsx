import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MAX_REPLAY_NOTE_LENGTH } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { useStore } from "../store.js";

type ReplayStepSize = 1 | 5;
type KeyboardTarget = EventTarget & { closest?: (selector: string) => Element | null };
const MOBILE_REPLAY_BREAKPOINT = 700;
const REPLAY_NOTES_PAGE_SIZE = 5;

export function paginateReplayNotes<T>(items: T[], requestedPage: number) {
  const pageCount = Math.max(1, Math.ceil(items.length / REPLAY_NOTES_PAGE_SIZE));
  const page = Math.max(0, Math.min(requestedPage, pageCount - 1));
  const start = page * REPLAY_NOTES_PAGE_SIZE;
  return {
    items: items.slice(start, start + REPLAY_NOTES_PAGE_SIZE),
    page,
    pageCount,
  };
}

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

type ReplayKeyEvent = Pick<
  KeyboardEvent,
  "code" | "repeat" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "target"
>;

/** The replay step a keypress requests, or null when the key belongs to the
 * focused element. Space and → step forward, ← steps back. */
export function replayKeyDirection(event: ReplayKeyEvent): "previous" | "next" | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  const direction = event.code === "ArrowLeft"
    ? "previous"
    : event.code === "ArrowRight" || event.code === "Space"
      ? "next"
      : null;
  if (!direction) return null;
  // Holding an arrow scrubs; a held Space would race through the game.
  if (event.repeat && event.code === "Space") return null;

  const target = event.target as KeyboardTarget | null;
  // Text entry and the notes panel keep their own keyboard behavior.
  if (target?.closest?.(
    "textarea, select, [contenteditable='true'], .replay-notes-panel",
  )) return null;
  // Focus left on a transport control by a click must not swallow the
  // shortcut: stepping wins over pressing that control again, and the
  // scrubber steps by the chosen size instead of a single frame.
  if (target?.closest?.(".replay-bar")) return direction;
  if (event.code === "Space") {
    return target?.closest?.(
      "input, button, a, [role='button']",
    ) ? null : direction;
  }
  // Buttons and links ignore arrows; other inputs and composite widgets use them.
  return target?.closest?.(
    "input, [role='slider'], [role='tab'], [role='menu'], [role='menuitem'], " +
      "[role='listbox'], [role='option'], [role='radiogroup'], [role='grid']",
  ) ? null : direction;
}

/** Back and Next. The full bar labels Next and shows its Space key. */
function ReplayStepButtons({
  replayStep,
  total,
  stepSize,
  setReplayStep,
  labeled = false,
}: {
  replayStep: number;
  total: number;
  stepSize: ReplayStepSize;
  setReplayStep: (step: number) => void;
  labeled?: boolean;
}) {
  const intl = useIntl();
  const nextLabel = intl.formatMessage({ id: "replay.controls.next" }, { count: stepSize });
  const step = (direction: "previous" | "next") =>
    setReplayStep(replayStepTarget(replayStep, total, direction, stepSize));
  return (
    <>
      <TooltipButton
        className="replay-control"
        tooltip={intl.formatMessage({ id: "replay.controls.previous" }, { count: stepSize })}
        tooltipSide="above"
        aria-keyshortcuts="ArrowLeft"
        disabled={replayStep <= 0}
        onClick={() => step("previous")}
      >
        <UiIcon name="chevron-left" />
      </TooltipButton>
      <TooltipButton
        className="replay-control replay-next-button"
        tooltip={intl.formatMessage({ id: "common.shortcut.space" }, { label: nextLabel })}
        tooltipSide="above"
        aria-label={nextLabel}
        aria-keyshortcuts="Space ArrowRight"
        disabled={replayStep >= total - 1}
        onClick={() => step("next")}
      >
        {labeled ? (
          <span className="replay-next-label">
            {intl.formatMessage({ id: "replay.controls.nextShort" })}
          </span>
        ) : null}
        <UiIcon name="chevron-right" />
        {labeled ? (
          <kbd
            className="shortcut-key replay-next-shortcut"
            aria-label={intl.formatMessage({ id: "common.spaceKey" })}
          />
        ) : null}
      </TooltipButton>
    </>
  );
}

export function CollapsedReplayControls({
  onExpand,
  ...steps
}: {
  replayStep: number;
  total: number;
  stepSize: ReplayStepSize;
  setReplayStep: (step: number) => void;
  onExpand: () => void;
}) {
  const intl = useIntl();
  return (
    <>
      <ReplayStepButtons {...steps} />
      <TooltipButton
        className="replay-control"
        tooltip={intl.formatMessage({ id: "replay.controls.maximize" })}
        tooltipSide="above"
        aria-expanded="false"
        onClick={onExpand}
      >
        <UiIcon name="chevron-up" />
      </TooltipButton>
    </>
  );
}

/** Frame positions, as track percentages, where a new turn begins. */
export function replayTurnBoundaries(turns: readonly number[]): number[] {
  if (turns.length <= 1) return [];
  const boundaries: number[] = [];
  for (let frame = 1; frame < turns.length; frame++) {
    if (turns[frame] !== turns[frame - 1]) {
      boundaries.push((frame / (turns.length - 1)) * 100);
    }
  }
  return boundaries;
}

/** Transport controls overlaid at the bottom of the board during replay. */
export function ReplayBar() {
  const intl = useIntl();
  const {
    replayViews,
    replayStep,
    replayNotes,
    setReplayStep,
    setReplayNote,
    closeReplay,
    downloadReplay,
    sharedOwner,
  } = useStore(
    useShallow((state) => ({
      replayViews: state.replayViews,
      replayStep: state.replayStep,
      replayNotes: state.replayNotes,
      setReplayStep: state.setReplayStep,
      setReplayNote: state.setReplayNote,
      closeReplay: state.closeReplay,
      downloadReplay: state.downloadReplay,
      sharedOwner: state.activeSharedReplay?.ownerUsername ?? null,
    })),
  );
  const [collapsed, setCollapsed] = useState(replayStartsCollapsed);
  const [stepSize, setStepSize] = useState<ReplayStepSize>(1);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesPage, setNotesPage] = useState(0);

  const total = replayViews?.length ?? 0;
  const progress = total <= 1 ? 0 : (replayStep / (total - 1)) * 100;
  const turnBoundaries = useMemo(
    () => replayTurnBoundaries(replayViews?.map((view) => view.turn) ?? []),
    [replayViews],
  );
  const replayNotesByFrame = useMemo(
    () => new Map(replayNotes.map((note) => [note.frame, note])),
    [replayNotes],
  );
  const currentNote = replayNotesByFrame.get(replayStep);
  const paginatedNotes = paginateReplayNotes(replayNotes, notesPage);

  useEffect(() => {
    if (notePanelOpen) setNoteDraft(currentNote?.text ?? "");
  }, [currentNote?.text, notePanelOpen, replayStep]);

  useEffect(() => {
    const stepOnKey = (event: KeyboardEvent) => {
      const direction = replayKeyDirection(event);
      if (!direction) return;
      const current = useStore.getState();
      const currentTotal = current.replayViews?.length ?? 0;
      if (currentTotal === 0) return;
      // Also cancels Space activating a focused bar control at either end.
      event.preventDefault();
      const target = replayStepTarget(current.replayStep, currentTotal, direction, stepSize);
      if (target !== current.replayStep) current.setReplayStep(target);
    };
    window.addEventListener("keydown", stepOnKey);
    return () => window.removeEventListener("keydown", stepOnKey);
  }, [stepSize]);

  if (!replayViews || total === 0) return null;

  const openNote = (frame = replayStep) => {
    if (frame !== replayStep) setReplayStep(frame);
    const noteIndex = replayNotes.findIndex((note) => note.frame === frame);
    if (noteIndex >= 0) setNotesPage(Math.floor(noteIndex / REPLAY_NOTES_PAGE_SIZE));
    setNoteDraft(replayNotesByFrame.get(frame)?.text ?? "");
    setNotePanelOpen(true);
  };

  const closeNote = () => {
    setNotePanelOpen(false);
    setNoteDraft("");
  };

  const turn = replayViews[replayStep]?.turn ?? 0;
  const noteLabel = intl.formatMessage(
    { id: currentNote ? "replay.notes.edit" : "replay.notes.add" },
    { frame: replayStep + 1 },
  );

  return (
    <div className={`replay-bar${collapsed ? " replay-bar-collapsed" : ""}`}>
      {!collapsed && notePanelOpen ? (
        <section
          className="replay-notes-panel"
          aria-label={intl.formatMessage({ id: "replay.notes.panel" })}
        >
          <div className="replay-notes-heading">
            <strong>{intl.formatMessage(
              { id: "replay.notes.frameTitle" },
              { frame: replayStep + 1 },
            )}</strong>
            <TooltipButton
              className="replay-control replay-note-close"
              tooltip={intl.formatMessage({ id: "replay.notes.close" })}
              onClick={closeNote}
            >
              <UiIcon name="close" />
            </TooltipButton>
          </div>
          <textarea
            autoFocus
            maxLength={MAX_REPLAY_NOTE_LENGTH}
            value={noteDraft}
            placeholder={intl.formatMessage({ id: "replay.notes.placeholder" })}
            aria-label={intl.formatMessage(
              { id: "replay.notes.input" },
              { frame: replayStep + 1 },
            )}
            onChange={(event) => setNoteDraft(event.target.value)}
          />
          <div className="replay-note-actions">
            {currentNote ? (
              <button
                type="button"
                className="secondary danger"
                onClick={() => {
                  setReplayNote(replayStep, "");
                  closeNote();
                }}
              >
                {intl.formatMessage({ id: "replay.notes.remove" })}
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={closeNote}>
              {intl.formatMessage({ id: "common.cancel" })}
            </button>
            <button
              type="button"
              className="replay-note-save"
              disabled={noteDraft.trim().length === 0}
              onClick={() => {
                setReplayNote(replayStep, noteDraft);
                closeNote();
              }}
            >
              {intl.formatMessage({ id: "replay.notes.save" })}
            </button>
          </div>
          {replayNotes.length > 0 ? (
            <div className="replay-note-list">
              <div className="replay-note-list-header">
                <span>{intl.formatMessage({ id: "replay.notes.saved" })}</span>
                {paginatedNotes.pageCount > 1 ? (
                  <div className="replay-note-pagination">
                    <TooltipButton
                      className="replay-control"
                      tooltip={intl.formatMessage({ id: "replay.notes.previousPage" })}
                      disabled={paginatedNotes.page === 0}
                      onClick={() => setNotesPage(paginatedNotes.page - 1)}
                    >
                      <UiIcon name="chevron-left" />
                    </TooltipButton>
                    <span>{paginatedNotes.page + 1} / {paginatedNotes.pageCount}</span>
                    <TooltipButton
                      className="replay-control"
                      tooltip={intl.formatMessage({ id: "replay.notes.nextPage" })}
                      disabled={paginatedNotes.page === paginatedNotes.pageCount - 1}
                      onClick={() => setNotesPage(paginatedNotes.page + 1)}
                    >
                      <UiIcon name="chevron-right" />
                    </TooltipButton>
                  </div>
                ) : null}
              </div>
              {paginatedNotes.items.map((note) => (
                <button
                  type="button"
                  className={note.frame === replayStep ? "active" : undefined}
                  key={note.frame}
                  onClick={() => openNote(note.frame)}
                >
                  <strong>{intl.formatMessage(
                    { id: "replay.notes.frame" },
                    { frame: note.frame + 1 },
                  )}</strong>
                  <span>{note.text}</span>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
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
          <div className="replay-position">
            {sharedOwner ? (
              <span className="replay-owner">
                {intl.formatMessage({ id: "replay.shared.title" }, { owner: sharedOwner })}
              </span>
            ) : null}
            <strong className="replay-turn">
              {turn >= 1
                ? intl.formatMessage({ id: "replay.controls.turn" }, { turn })
                : intl.formatMessage({ id: "replay.controls.gameStart" })}
            </strong>
            <span className="replay-pos">{replayStep + 1} / {total}</span>
          </div>
          <div className="replay-transport">
            <ReplayStepButtons
              replayStep={replayStep}
              total={total}
              stepSize={stepSize}
              setReplayStep={setReplayStep}
              labeled
            />
          </div>
          <div
            className="replay-scrubber"
            style={{ "--replay-progress": `${progress}%` } as CSSProperties}
          >
            <div className="replay-turn-marks" aria-hidden="true">
              {turnBoundaries.map((position) => (
                <span key={position} style={{ left: `${position}%` }} />
              ))}
            </div>
            <input
              aria-label={intl.formatMessage({ id: "replay.controls.frame" })}
              type="range"
              min={0}
              max={total - 1}
              value={replayStep}
              onChange={(e) => {
                setReplayStep(Number(e.target.value));
              }}
            />
            <div className="replay-note-markers">
              {replayNotes.map((note) => (
                <TooltipButton
                  className={note.frame === replayStep ? "active" : undefined}
                  key={note.frame}
                  style={{ left: `${total <= 1 ? 0 : (note.frame / (total - 1)) * 100}%` }}
                  tooltip={note.text}
                  tooltipSide="above"
                  aria-label={intl.formatMessage(
                    { id: "replay.notes.openFrame" },
                    { frame: note.frame + 1 },
                  )}
                  onClick={() => openNote(note.frame)}
                />
              ))}
            </div>
          </div>
          <div
            className="replay-step-size"
            role="group"
            aria-label={intl.formatMessage({ id: "replay.controls.stepGroup" })}
          >
            <span className="replay-step-size-label" aria-hidden="true">
              {intl.formatMessage({ id: "replay.controls.step" })}
            </span>
            {([1, 5] as const).map((size) => (
              <button
                type="button"
                key={size}
                className={size === stepSize ? "active" : undefined}
                aria-pressed={size === stepSize}
                aria-label={intl.formatMessage(
                  { id: "replay.controls.stepSize" },
                  { count: size },
                )}
                onClick={() => setStepSize(size)}
              >
                {size}
              </button>
            ))}
          </div>
          <div className="replay-tools">
            <TooltipButton
              className={`replay-control replay-note-button${currentNote ? " active" : ""}`}
              tooltip={noteLabel}
              tooltipSide="above"
              aria-expanded={notePanelOpen}
              onClick={() => notePanelOpen ? closeNote() : openNote()}
            >
              <UiIcon name="note" />
            </TooltipButton>
            <TooltipButton
              className="replay-control replay-export"
              tooltip={intl.formatMessage({ id: "replay.controls.export" })}
              tooltipSide="above"
              onClick={downloadReplay}
            >
              <UiIcon name="download" />
            </TooltipButton>
            <TooltipButton
              className="replay-control replay-collapse-toggle"
              tooltip={intl.formatMessage({ id: "replay.controls.minimize" })}
              tooltipSide="above"
              aria-expanded="true"
              onClick={() => setCollapsed(true)}
            >
              <UiIcon name="chevron-down" />
            </TooltipButton>
            <TooltipButton
              className="replay-control replay-exit"
              tooltip={intl.formatMessage({ id: "replay.controls.exit" })}
              tooltipSide="above"
              onClick={closeReplay}
            >
              <UiIcon name="close" />
              <span className="replay-exit-label">
                {intl.formatMessage({ id: "replay.controls.exitShort" })}
              </span>
            </TooltipButton>
          </div>
        </>
      )}
    </div>
  );
}
