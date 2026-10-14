import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";
import { useStore } from "../store.js";
import { useFriendRelation, type FriendRelation } from "./friendRelation.js";
import { keepSpaceLocal, ReportForm, useSentReport, type SubmitPlayerReport } from "./ReportForm.js";

const FLASH_MS = 2_600;

const FRIEND_ICON: Readonly<Record<Exclude<FriendRelation["kind"], "unavailable">, UiIconName>> = {
  none: "user-add",
  incoming: "user-add",
  outgoing: "user-pending",
  friend: "message",
};

/** A panel anchored under the nameplate. Escape closes it and returns focus
 * to the control that opened it. */
function NameplatePopover({
  className,
  titleId,
  onClose,
  children,
}: {
  className: string;
  titleId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`nameplate-popover ${className}`}
      role="dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {children}
    </div>
  );
}

function FriendRequestPrompt({
  username,
  titleId,
  onRespond,
}: {
  username: string;
  titleId: string;
  onRespond: (accept: boolean) => void;
}) {
  const intl = useIntl();
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { acceptRef.current?.focus(); }, []);
  return (
    <div className="friend-prompt">
      <h2 id={titleId}>
        {intl.formatMessage(
          { id: "game.opponent.requestTitle" },
          { username: <span translate="no">{username}</span> },
        )}
      </h2>
      <p>{intl.formatMessage({ id: "game.opponent.requestBody" })}</p>
      <div className="report-form-actions">
        <button type="button" className="report-form-secondary" onClick={() => onRespond(false)}>
          {intl.formatMessage({ id: "social.decline" })}
        </button>
        <button ref={acceptRef} type="button" className="friend-prompt-accept" onClick={() => onRespond(true)}>
          {intl.formatMessage({ id: "social.accept" })}
        </button>
      </div>
    </div>
  );
}

/** Friend and report controls attached to the opponent's nameplate. */
export function OpponentActions({
  username,
  roomCode,
  onReport,
}: {
  username: string;
  roomCode: string;
  onReport: SubmitPlayerReport;
}) {
  const intl = useIntl();
  const relation = useFriendRelation(username);
  const { sendRequest, respondRequest, openChat } = useStore(useShallow((state) => ({
    sendRequest: state.sendFriendRequest,
    respondRequest: state.respondFriendRequest,
    openChat: state.openChat,
  })));
  const [reported, markReported] = useSentReport(`game:${roomCode}:${username.toLowerCase()}`);
  const [open, setOpen] = useState<"report" | "friend" | null>(null);
  const [flash, setFlash] = useState<{ text: string; visible: boolean }>({ text: "", visible: false });
  const rootRef = useRef<HTMLDivElement>(null);
  const friendRef = useRef<HTMLButtonElement>(null);
  const flagRef = useRef<HTMLButtonElement>(null);
  const previousRelation = useRef(relation.kind);
  const popoverTitleId = useId();

  // Confirm friendship changes observed while this game is open, including an
  // opponent accepting a request sent earlier in the match.
  useEffect(() => {
    const previous = previousRelation.current;
    previousRelation.current = relation.kind;
    let text: string | null = null;
    if (previous === "none" && relation.kind === "outgoing") {
      text = intl.formatMessage({ id: "game.opponent.requestSent" });
    } else if ((previous === "outgoing" || previous === "incoming") && relation.kind === "friend") {
      text = intl.formatMessage({ id: "game.opponent.nowFriends" }, { username });
    }
    if (text === null) return;
    setFlash({ text, visible: true });
    const timer = window.setTimeout(() => setFlash((current) => ({ ...current, visible: false })), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [intl, relation.kind, username]);

  // A request withdrawn or answered elsewhere leaves nothing to respond to.
  useEffect(() => {
    if (open === "friend" && relation.kind !== "incoming") setOpen(null);
  }, [open, relation.kind]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  if (relation.kind === "unavailable") return null;

  const friendLabel = relation.kind === "friend"
    ? intl.formatMessage({ id: "social.messageNamed" }, { username: relation.username })
    : relation.kind === "incoming"
      ? intl.formatMessage({ id: "game.opponent.respondFriend" }, { username })
      : relation.kind === "outgoing"
        ? intl.formatMessage({ id: "game.opponent.requestPending" }, { username })
        : intl.formatMessage({ id: "game.opponent.addFriend" }, { username });
  const onFriend = () => {
    if (relation.kind === "friend") openChat(relation.username);
    else if (relation.kind === "incoming") setOpen(open === "friend" ? null : "friend");
    else if (relation.kind === "none") sendRequest(username);
  };
  const reportLabel = intl.formatMessage(
    { id: reported ? "game.report.reported" : "game.report.open" },
    { username },
  );
  const close = (returnFocus: HTMLButtonElement | null) => {
    setOpen(null);
    returnFocus?.focus();
  };

  return (
    <div
      ref={rootRef}
      className="nameplate-actions"
      role="group"
      aria-label={intl.formatMessage({ id: "game.opponent.actions" }, { username })}
      data-open={open !== null}
      onKeyDown={keepSpaceLocal}
    >
      <TooltipButton
        ref={friendRef}
        className="nameplate-action nameplate-action-friend"
        data-relation={relation.kind}
        tooltip={friendLabel}
        aria-disabled={relation.kind === "outgoing"}
        aria-haspopup={relation.kind === "incoming" ? "dialog" : undefined}
        aria-expanded={relation.kind === "incoming" ? open === "friend" : undefined}
        onClick={onFriend}
      >
        <UiIcon name={FRIEND_ICON[relation.kind]} />
      </TooltipButton>
      <TooltipButton
        ref={flagRef}
        className="nameplate-action nameplate-action-report"
        data-reported={reported}
        tooltip={reportLabel}
        aria-expanded={open === "report"}
        aria-haspopup="dialog"
        aria-disabled={reported && open !== "report"}
        onClick={() => {
          if (open === "report") setOpen(null);
          else if (!reported) setOpen("report");
        }}
      >
        <UiIcon name={reported ? "flag-filled" : "flag"} />
      </TooltipButton>
      <span className="nameplate-flash" role="status" data-visible={flash.visible}>
        {flash.text ? <><UiIcon name="check" />{flash.text}</> : null}
      </span>
      {open === "report" ? (
        <NameplatePopover className="report-popover" titleId={popoverTitleId} onClose={() => close(flagRef.current)}>
          <ReportForm
            username={username}
            source="game"
            titleId={popoverTitleId}
            chatOption={relation.kind === "friend" ? { checked: false } : null}
            onReport={onReport}
            onSent={markReported}
            onClose={() => close(flagRef.current)}
          />
        </NameplatePopover>
      ) : null}
      {open === "friend" && relation.kind === "incoming" ? (
        <NameplatePopover className="friend-popover" titleId={popoverTitleId} onClose={() => close(friendRef.current)}>
          <FriendRequestPrompt
            username={relation.username}
            titleId={popoverTitleId}
            onRespond={(accept) => {
              respondRequest(relation.username, accept);
              close(friendRef.current);
            }}
          />
        </NameplatePopover>
      ) : null}
    </div>
  );
}
