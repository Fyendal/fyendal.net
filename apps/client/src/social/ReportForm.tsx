import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import type { PlayerReportReason, PlayerReportSource } from "@fyendal/shared";
import { CHAT_REPORT_REASONS, GAME_REPORT_REASONS, PLAYER_REPORT_DETAILS_MAX } from "@fyendal/protocol";
import { UiIcon } from "../components/UiIcon.js";

const REASON_LABEL_ID: Readonly<Record<PlayerReportReason, string>> = {
  stalling: "game.report.reason.stalling",
  "emote-spam": "game.report.reason.emoteSpam",
  cheating: "game.report.reason.cheating",
  harassment: "game.report.reason.harassment",
  spam: "game.report.reason.spam",
  "offensive-name": "game.report.reason.offensiveName",
  other: "game.report.reason.other",
};

export type SubmitPlayerReport = (
  reason: PlayerReportReason,
  details: string,
  includeChat: boolean,
) => Promise<{ ok: true; reportId: string } | { ok: false; error: string }>;

// Keeps a sent report visible across remounts in this tab. The server returns
// the original game report when the same opponent is reported again.
const sentReports = new Set<string>();

export function useSentReport(key: string): [boolean, () => void] {
  const [, rerender] = useState(0);
  return [sentReports.has(key), () => {
    sentReports.add(key);
    rerender((count) => count + 1);
  }];
}

/** Space passes priority from anywhere on the table. Inside these controls it
 * belongs to the focused button, radio, or text field instead. */
export function keepSpaceLocal(event: KeyboardEvent) {
  if (event.key === " ") event.stopPropagation();
}

type ReportStatus =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "error" }
  | { kind: "sent" };

/** Reason, details, and optional chat attachment for one conduct report. The
 * caller supplies the surface: a popover on the nameplate or a chat view. */
export function ReportForm({
  username,
  source,
  titleId,
  chatOption,
  onReport,
  onSent,
  onClose,
}: {
  username: string;
  source: PlayerReportSource;
  titleId: string;
  /** Present only for a friend; `checked` is the initial choice. */
  chatOption: { checked: boolean } | null;
  onReport: SubmitPlayerReport;
  onSent: () => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const reasonName = useId();
  const chatHintId = useId();
  const [reason, setReason] = useState<PlayerReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [includeChat, setIncludeChat] = useState(chatOption?.checked ?? false);
  const [status, setStatus] = useState<ReportStatus>({ kind: "editing" });
  const firstReasonRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { firstReasonRef.current?.focus(); }, []);
  useEffect(() => {
    if (status.kind === "sent") doneRef.current?.focus();
  }, [status.kind]);

  const reasons = source === "chat" ? CHAT_REPORT_REASONS : GAME_REPORT_REASONS;
  const detailsRequired = reason === "other";
  const ready = reason !== null && (!detailsRequired || details.trim().length > 0);
  const submitting = status.kind === "submitting";
  const edited = () => {
    if (status.kind === "error") setStatus({ kind: "editing" });
  };
  const submit = async () => {
    if (!reason || !ready || submitting) return;
    setStatus({ kind: "submitting" });
    const result = await onReport(reason, details.trim(), chatOption !== null && includeChat);
    if (result.ok) {
      onSent();
      setStatus({ kind: "sent" });
    } else {
      // Server errors are English diagnostics; show localized copy instead.
      setStatus({ kind: "error" });
    }
  };

  if (status.kind === "sent") {
    return (
      <div className="report-form report-form-sent">
        <span className="report-form-sent-mark" aria-hidden="true">
          <UiIcon name="check" />
        </span>
        <h2 id={titleId}>{intl.formatMessage({ id: "game.report.sent" })}</h2>
        <p>{intl.formatMessage({ id: source === "chat" ? "game.report.sentChatDetail" : "game.report.sentDetail" })}</p>
        <button ref={doneRef} type="button" className="report-form-secondary" onClick={onClose}>
          {intl.formatMessage({ id: "common.done" })}
        </button>
      </div>
    );
  }

  return (
    <form
      className="report-form"
      onKeyDown={keepSpaceLocal}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h2 id={titleId} className="report-form-title">
        {intl.formatMessage({ id: "game.report.title" }, { username: <span translate="no">{username}</span> })}
      </h2>
      <fieldset className="report-form-reasons" disabled={submitting}>
        <legend>
          {intl.formatMessage({ id: source === "chat" ? "game.report.promptChat" : "game.report.prompt" })}
        </legend>
        {reasons.map((value, index) => (
          <label key={value} className="report-reason" data-selected={reason === value}>
            <input
              ref={index === 0 ? firstReasonRef : undefined}
              type="radio"
              name={reasonName}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                edited();
              }}
            />
            <span>{intl.formatMessage({ id: REASON_LABEL_ID[value] })}</span>
          </label>
        ))}
      </fieldset>
      <textarea
        className="report-form-details"
        aria-label={intl.formatMessage({ id: "game.report.detailsLabel" })}
        rows={3}
        maxLength={PLAYER_REPORT_DETAILS_MAX}
        value={details}
        disabled={submitting}
        required={detailsRequired}
        placeholder={intl.formatMessage({
          id: detailsRequired ? "game.report.detailsRequired" : "game.report.detailsOptional",
        })}
        onChange={(event) => {
          setDetails(event.target.value);
          edited();
        }}
      />
      {chatOption ? (
        <label className="report-form-chat" data-checked={includeChat}>
          <input
            type="checkbox"
            checked={includeChat}
            disabled={submitting}
            aria-describedby={chatHintId}
            onChange={(event) => setIncludeChat(event.target.checked)}
          />
          <span>
            <span className="report-form-chat-label">{intl.formatMessage({ id: "game.report.includeChat" })}</span>
            <span id={chatHintId} className="report-form-chat-hint">
              {intl.formatMessage({ id: "game.report.includeChatHint" }, { username })}
            </span>
          </span>
        </label>
      ) : null}
      <p className="report-form-note">
        {status.kind === "error"
          ? <span className="report-form-error" role="alert">{intl.formatMessage({ id: "game.report.failed" })}</span>
          : intl.formatMessage({ id: "game.report.privacy" }, { username })}
      </p>
      <div className="report-form-actions">
        <button type="button" className="report-form-secondary" onClick={onClose} disabled={submitting}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
        <button type="submit" className="report-form-submit" disabled={!ready || submitting}>
          {intl.formatMessage({ id: submitting ? "game.report.sending" : "game.report.send" })}
        </button>
      </div>
    </form>
  );
}
