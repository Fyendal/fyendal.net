import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { MAX_REPLAY_NOTE_LENGTH } from "@fyendal/protocol";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
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
  const intl = useIntl();
  const previousLabel = intl.formatMessage({ id: "replay.controls.previous" }, { count: stepSize });
  const nextLabel = intl.formatMessage({ id: "replay.controls.next" }, { count: stepSize });
  return (
    <>
      <button
        type="button"
        className="replay-step-button"
        aria-label={previousLabel}
        title={previousLabel}
        disabled={replayStep <= 0}
        onClick={() => setReplayStep(replayStepTarget(replayStep, total, "previous", stepSize))}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        className="replay-step-button replay-next-button shortcut-button"
        aria-label={nextLabel}
        aria-keyshortcuts="Space"
        title={intl.formatMessage({ id: "common.shortcut.space" }, { label: nextLabel })}
        disabled={replayStep >= total - 1}
        onClick={() => setReplayStep(replayStepTarget(replayStep, total, "next", stepSize))}
      >
        <span aria-hidden="true">→</span>
        <kbd
          className="shortcut-key replay-next-shortcut"
          aria-label={intl.formatMessage({ id: "common.spaceKey" })}
        />
      </button>
      <button
        type="button"
        className="replay-maximize"
        aria-label={intl.formatMessage({ id: "replay.controls.maximize" })}
        title={intl.formatMessage({ id: "replay.controls.maximize" })}
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
  const intl = useIntl();
  const {
    replayViews,
    replayStep,
    replayNotes,
    setReplayStep,
    setReplayNote,
    closeReplay,
    downloadReplay,
  } = useStore(
    useShallow((state) => ({
      replayViews: state.replayViews,
      replayStep: state.replayStep,
      replayNotes: state.replayNotes,
      setReplayStep: state.setReplayStep,
      setReplayNote: state.setReplayNote,
      closeReplay: state.closeReplay,
      downloadReplay: state.downloadReplay,
    })),
  );
  const [collapsed, setCollapsed] = useState(replayStartsCollapsed);
  const [stepSize, setStepSize] = useState<ReplayStepSize>(1);
  const [notePanelOpen, setNotePanelOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [notesPage, setNotesPage] = useState(0);

  const total = replayViews?.length ?? 0;
  const progress = total <= 1 ? 0 : (replayStep / (total - 1)) * 100;
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
            <button
              type="button"
              className="replay-note-close"
              aria-label={intl.formatMessage({ id: "replay.notes.close" })}
              title={intl.formatMessage({ id: "replay.notes.close" })}
              onClick={closeNote}
            >
              <span aria-hidden="true">×</span>
            </button>
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
                    <button
                      type="button"
                      aria-label={intl.formatMessage({ id: "replay.notes.previousPage" })}
                      title={intl.formatMessage({ id: "replay.notes.previousPage" })}
                      disabled={paginatedNotes.page === 0}
                      onClick={() => setNotesPage(paginatedNotes.page - 1)}
                    >
                      <span aria-hidden="true">‹</span>
                    </button>
                    <span>{paginatedNotes.page + 1} / {paginatedNotes.pageCount}</span>
                    <button
                      type="button"
                      aria-label={intl.formatMessage({ id: "replay.notes.nextPage" })}
                      title={intl.formatMessage({ id: "replay.notes.nextPage" })}
                      disabled={paginatedNotes.page === paginatedNotes.pageCount - 1}
                      onClick={() => setNotesPage(paginatedNotes.page + 1)}
                    >
                      <span aria-hidden="true">›</span>
                    </button>
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
          <span className="replay-title">{intl.formatMessage({ id: "replay.controls.title" })}</span>
          <button
            type="button"
            className="replay-collapse-toggle"
            aria-label={intl.formatMessage({ id: "replay.controls.minimize" })}
            title={intl.formatMessage({ id: "replay.controls.minimize" })}
            aria-expanded="true"
            onClick={() => setCollapsed(true)}
          >
            <span aria-hidden="true">—</span>
          </button>
          <button
            className="replay-step-button"
            aria-label={intl.formatMessage(
              { id: "replay.controls.previous" },
              { count: stepSize },
            )}
            title={intl.formatMessage(
              { id: "replay.controls.previous" },
              { count: stepSize },
            )}
            onClick={() => setReplayStep(
              replayStepTarget(replayStep, total, "previous", stepSize),
            )}
            disabled={replayStep <= 0}
          >
            <span aria-hidden="true">←</span>
          </button>
          <button
            className="replay-step-button replay-next-button shortcut-button"
            aria-label={intl.formatMessage(
              { id: "replay.controls.next" },
              { count: stepSize },
            )}
            aria-keyshortcuts="Space"
            title={intl.formatMessage(
              { id: "common.shortcut.space" },
              {
                label: intl.formatMessage(
                  { id: "replay.controls.next" },
                  { count: stepSize },
                ),
              },
            )}
            onClick={() => setReplayStep(
              replayStepTarget(replayStep, total, "next", stepSize),
            )}
            disabled={replayStep >= total - 1}
          >
            <span aria-hidden="true">→</span>
            <kbd
              className="shortcut-key replay-next-shortcut"
              aria-label={intl.formatMessage({ id: "common.spaceKey" })}
            />
          </button>
          <div
            className="replay-scrubber"
            style={{ "--replay-progress": `${progress}%` } as CSSProperties}
          >
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
                <button
                  type="button"
                  className={note.frame === replayStep ? "active" : undefined}
                  key={note.frame}
                  style={{ left: `${total <= 1 ? 0 : (note.frame / (total - 1)) * 100}%` }}
                  aria-label={intl.formatMessage(
                    { id: "replay.notes.openFrame" },
                    { frame: note.frame + 1 },
                  )}
                  title={note.text}
                  onClick={() => openNote(note.frame)}
                />
              ))}
            </div>
          </div>
          <span className="replay-pos">{replayStep + 1} / {total}</span>
          <button
            type="button"
            className="replay-step-size"
            aria-label={intl.formatMessage(
              { id: "replay.controls.stepSize" },
              { count: stepSize },
            )}
            title={intl.formatMessage(
              { id: "replay.controls.stepSize" },
              { count: stepSize },
            )}
            onClick={() => setStepSize((current) => current === 1 ? 5 : 1)}
          >
            {stepSize}×
          </button>
          <button
            type="button"
            className={`replay-action-icon replay-note-button${currentNote ? " active" : ""}`}
            aria-label={intl.formatMessage({
              id: currentNote ? "replay.notes.edit" : "replay.notes.add",
            }, { frame: replayStep + 1 })}
            title={intl.formatMessage({
              id: currentNote ? "replay.notes.edit" : "replay.notes.add",
            }, { frame: replayStep + 1 })}
            aria-expanded={notePanelOpen}
            onClick={() => notePanelOpen ? closeNote() : openNote()}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 3h14v18l-7-4-7 4V3Zm2 2v12.55l5-2.86 5 2.86V5H7Z" />
            </svg>
          </button>
          <button
            type="button"
            className="replay-action-icon"
            aria-label={intl.formatMessage({ id: "replay.controls.export" })}
            title={intl.formatMessage({ id: "replay.controls.export" })}
            onClick={downloadReplay}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M11 3h2v10.17l3.59-3.58L18 11l-6 6-6-6 1.41-1.41L11 13.17V3ZM5 19h14v2H5v-2Z" />
            </svg>
          </button>
          <button
            type="button"
            className="replay-action-icon"
            aria-label={intl.formatMessage({ id: "replay.controls.exit" })}
            title={intl.formatMessage({ id: "replay.controls.exit" })}
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
