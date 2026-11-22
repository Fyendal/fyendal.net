import { useState } from "react";
import { useIntl } from "react-intl";

type BugReportResult =
  | { kind: "submitting" }
  | { kind: "error"; message: string }
  | { kind: "sent"; reportId: string }
  | null;

export function BugReportDialog({
  roomCode,
  onReport,
  onClose,
}: {
  roomCode: string | null;
  onReport: (description: string) => Promise<
    { ok: true; reportId: string } | { ok: false; error: string }
  >;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [description, setDescription] = useState("");
  const [result, setResult] = useState<BugReportResult>(null);
  const close = () => {
    if (result?.kind !== "submitting") onClose();
  };
  const submit = async () => {
    const trimmed = description.trim();
    if (trimmed.length < 10 || trimmed.length > 2_000) {
      setResult({
        kind: "error",
        message: intl.formatMessage({ id: "game.bug.validation" }),
      });
      return;
    }
    setResult({ kind: "submitting" });
    const report = await onReport(trimmed);
    setResult(report.ok
      ? { kind: "sent", reportId: report.reportId }
      : { kind: "error", message: report.error });
  };

  return (
    <div className="overlay game-dialog-overlay" onClick={close}>
      <form
        className="overlay-panel bug-report-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bug-report-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (result?.kind !== "submitting" && result?.kind !== "sent") void submit();
        }}
      >
        <div className="overlay-title" id="bug-report-title">
          {intl.formatMessage({ id: "game.bug.dialogTitle" })}
        </div>
        {result?.kind === "sent" ? (
          <div className="bug-report-success" role="status">
            <strong>{intl.formatMessage({ id: "game.bug.sent" })}</strong>
            <p>
              {intl.formatMessage(
                { id: "game.bug.reference" },
                { reference: <code>{result.reportId}</code> },
              )}
            </p>
            <button type="button" className="btn-primary" onClick={close}>
              {intl.formatMessage({ id: "common.done" })}
            </button>
          </div>
        ) : (
          <>
            <p className="muted">
              {intl.formatMessage(
                { id: "game.bug.description" },
                { room: roomCode ?? intl.formatMessage({ id: "game.bug.currentRoom" }) },
              )}
            </p>
            <label className="bug-report-description">
              <span>{intl.formatMessage({ id: "game.bug.descriptionLabel" })}</span>
              <textarea
                autoFocus
                rows={7}
                maxLength={2_000}
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (result?.kind === "error") setResult(null);
                }}
                placeholder={intl.formatMessage({ id: "game.bug.placeholder" })}
              />
            </label>
            <div className="bug-report-meta">
              <span>{description.length} / 2000</span>
              {result?.kind === "error" ? (
                <span className="error" role="alert">{result.message}</span>
              ) : null}
            </div>
            <div className="bug-report-actions">
              <button type="button" onClick={close}>{intl.formatMessage({ id: "common.cancel" })}</button>
              <button
                type="submit"
                className="btn-primary"
                disabled={result?.kind === "submitting" || description.trim().length < 10}
              >
                {intl.formatMessage({
                  id: result?.kind === "submitting" ? "game.bug.sending" : "game.bug.send",
                })}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
