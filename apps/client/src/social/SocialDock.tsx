import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { ModalSurface } from "../components/ModalSurface.js";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { formatLabel } from "../lobby/FormatBadge.js";
import { useStore } from "../store.js";
import { FriendRoomModal } from "./FriendRoomModal.js";
import { UnreadMessageBadge } from "./MobileSocialControls.js";
import { keepSpaceLocal, ReportForm, useSentReport } from "./ReportForm.js";
import { useSocialAnchor } from "./socialAnchor.js";

const SOCIAL_DOCK_MARGIN = 8;
const SOCIAL_DOCK_DRAG_THRESHOLD = 5;
const SOCIAL_BUBBLE_SIZE = 44;

interface DockPosition {
  x: number;
  y: number;
}

interface DockDrag {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
  width: number;
  height: number;
  moved: boolean;
}

function axisBounds(viewportSize: number, itemSize: number) {
  const available = Math.max(0, viewportSize - itemSize);
  const inset = Math.min(SOCIAL_DOCK_MARGIN, available / 2);
  return { min: inset, max: available - inset };
}

export function clampSocialDockPosition(
  position: DockPosition,
  dockSize: { width: number; height: number },
  viewportSize: { width: number; height: number },
): DockPosition {
  const horizontal = axisBounds(viewportSize.width, dockSize.width);
  const vertical = axisBounds(viewportSize.height, dockSize.height);
  return {
    x: Math.max(horizontal.min, Math.min(position.x, horizontal.max)),
    y: Math.max(vertical.min, Math.min(position.y, vertical.max)),
  };
}

const SOCIAL_ERROR_IDS = {
  USER_NOT_FOUND: "social.error.userNotFound",
  INVALID_FRIEND_REQUEST: "social.error.self",
  FRIEND_REQUEST_CONFLICT: "social.error.conflict",
  FRIEND_REQUIRED: "social.error.friendRequired",
  FRIEND_UNAVAILABLE: "social.error.unavailable",
  MESSAGE_BOUNDS: "social.error.messageBounds",
  MESSAGE_RATE_LIMITED: "social.error.rateLimited",
} as const;

export function SocialDock() {
  const intl = useIntl();
  const dockRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DockDrag | null>(null);
  const suppressBubbleClickRef = useRef(false);
  const {
    authUser,
    screen,
    roomCode,
    open,
    friends,
    requests,
    invites,
    incomingChatToast,
    socialError,
    setOpen,
    clearSocialError,
    sendRequest,
    respondRequest,
    cancelRequest,
    removeFriend,
    openChat,
    dismissIncomingChatToast,
    beginInvite,
    dismissInvite,
    acceptInvite,
  } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    screen: state.screen,
    roomCode: state.roomCode,
    open: state.socialOpen,
    friends: state.friends,
    requests: state.friendRequests,
    invites: state.friendGameInvites,
    incomingChatToast: state.incomingChatToast,
    socialError: state.socialError,
    setOpen: state.setSocialOpen,
    clearSocialError: state.clearSocialError,
    sendRequest: state.sendFriendRequest,
    respondRequest: state.respondFriendRequest,
    cancelRequest: state.cancelFriendRequest,
    removeFriend: state.removeFriend,
    openChat: state.openChat,
    dismissIncomingChatToast: state.dismissIncomingChatToast,
    beginInvite: state.beginFriendInvite,
    dismissInvite: state.dismissFriendGameInvite,
    acceptInvite: state.acceptFriendGameInvite,
  })));
  const anchor = useSocialAnchor();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [adding, setAdding] = useState(false);
  const [username, setUsername] = useState("");
  const [dockPosition, setDockPosition] = useState<DockPosition | null>(null);
  const incoming = requests.filter((request) => request.direction === "incoming");
  const outgoing = requests.filter((request) => request.direction === "outgoing");
  const sortedFriends = useMemo(() => [...friends].sort((a, b) =>
    b.unreadCount - a.unreadCount
      || Number(b.presence === "online") - Number(a.presence === "online")
      || a.username.localeCompare(b.username)), [friends]);
  const notificationCount = friends.reduce((total, friend) => total + friend.unreadCount, 0)
    + incoming.length + invites.length;
  const canInviteFriends = screen === "lobby" && roomCode === null;

  useEffect(() => {
    if (!incomingChatToast) return;
    const timeout = window.setTimeout(dismissIncomingChatToast, 6_000);
    return () => window.clearTimeout(timeout);
  }, [dismissIncomingChatToast, incomingChatToast]);

  useEffect(() => {
    if (!authUser) return;
    const keepDockInViewport = () => {
      const dock = dockRef.current;
      if (!dock) return;
      setDockPosition((current) => {
        if (!current) return null;
        const rect = dock.getBoundingClientRect();
        const next = clampSocialDockPosition(current, rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        });
        return next;
      });
    };
    window.addEventListener("resize", keepDockInViewport);
    return () => window.removeEventListener("resize", keepDockInViewport);
  }, [authUser]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open, setOpen]);

  useEffect(() => {
    const dock = dockRef.current;
    if (screen !== "prep" || !dock) return;

    const readyFloat = document.querySelector<HTMLElement>(".prep-ready-float");
    if (!readyFloat) return;

    const updateOffset = () => {
      const gap = 12;
      const readyTop = readyFloat.getBoundingClientRect().top;
      dock.style.setProperty(
        "--prep-ready-float-offset",
        `${Math.max(gap, window.innerHeight - readyTop + gap)}px`,
      );
    };
    updateOffset();

    const observer = new ResizeObserver(updateOffset);
    observer.observe(readyFloat);
    window.addEventListener("resize", updateOffset);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateOffset);
      dock.style.removeProperty("--prep-ready-float-offset");
    };
  }, [screen]);

  useEffect(() => {
    if (!open) setAdding(false);
  }, [open]);

  if (!authUser) return null;

  const panelHorizontal = dockPosition
    ? dockPosition.x <= window.innerWidth - dockPosition.x - SOCIAL_BUBBLE_SIZE ? "start" : "end"
    : undefined;
  const panelVertical = dockPosition
    ? dockPosition.y <= window.innerHeight - dockPosition.y - SOCIAL_BUBBLE_SIZE ? "below" : "above"
    : undefined;
  const dockStyle: (CSSProperties & { "--social-panel-available-height"?: string }) | undefined = dockPosition
    ? {
        top: dockPosition.y,
        right: "auto",
        bottom: "auto",
        left: dockPosition.x,
        "--social-panel-available-height": `${Math.max(
          0,
          panelVertical === "below"
            ? window.innerHeight - dockPosition.y - SOCIAL_BUBBLE_SIZE - 20
            : dockPosition.y - 20,
        )}px`,
      }
    : undefined;

  const moveBubble = (event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < SOCIAL_DOCK_DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      suppressBubbleClickRef.current = true;
      dockRef.current?.setAttribute("data-dragging", "true");
      if (open) setOpen(false);
    }
    event.preventDefault();
    const next = clampSocialDockPosition(
      { x: drag.originX + deltaX, y: drag.originY + deltaY },
      drag,
      { width: window.innerWidth, height: window.innerHeight },
    );
    setDockPosition(next);
  };

  const finishBubbleDrag = (event: React.PointerEvent<HTMLButtonElement>, canceled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    dockRef.current?.removeAttribute("data-dragging");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (canceled) suppressBubbleClickRef.current = false;
  };

  const submitRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const target = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(target)) return;
    sendRequest(target);
    setUsername("");
  };

  const onlineCount = friends.filter((friend) => friend.presence === "online").length;
  const showAddForm = adding || friends.length === 0;
  const badge = notificationCount > 0 ? <span>{formatUnreadCount(notificationCount)}</span> : null;
  const toggleOpen = () => {
    if (!open) dismissIncomingChatToast();
    setOpen(!open);
  };
  const onRootKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    keepSpaceLocal(event);
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };
  const onRootBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!open) return;
    const nextFocus = event.relatedTarget;
    if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
    if (nextFocus !== null) setOpen(false);
  };

  const panel = open ? (
    <aside className="social-panel" aria-label={intl.formatMessage({ id: "social.friends" })}>
      <header className="social-panel-header">
        <h2>{intl.formatMessage({ id: "social.friends" })}</h2>
        <span className="social-online-count">
          {intl.formatMessage({ id: "social.onlineCount" }, { count: onlineCount })}
        </span>
        {friends.length > 0 ? (
          <button
            type="button"
            className="social-header-action"
            aria-label={intl.formatMessage({ id: "social.addFriend" })}
            aria-expanded={adding}
            onClick={() => setAdding(!adding)}
          >
            <UiIcon name="user-add" />
          </button>
        ) : null}
        <button
          type="button"
          className="social-header-action social-close"
          aria-label={intl.formatMessage({ id: "common.close" })}
          onClick={() => setOpen(false)}
        >
          <UiIcon name="close" />
        </button>
      </header>
      {showAddForm ? (
        <form className="social-add-form" onSubmit={submitRequest}>
          <input
            autoFocus={adding}
            id="social-add-username"
            value={username}
            minLength={3}
            maxLength={20}
            pattern="[A-Za-z0-9_]{3,20}"
            aria-label={intl.formatMessage({ id: "social.addFriend" })}
            placeholder={intl.formatMessage({ id: "social.addByUsername" })}
            onChange={(event) => setUsername(event.target.value)}
          />
          <button
            type="submit"
            className="btn-primary"
            aria-label={intl.formatMessage({ id: "social.addFriend" })}
            title={intl.formatMessage({ id: "social.addFriend" })}
          >
            <UiIcon name="plus" />
          </button>
        </form>
      ) : null}
      {socialError ? (
        <div className="social-error" role="alert">
          <span>{intl.formatMessage({ id: SOCIAL_ERROR_IDS[socialError as keyof typeof SOCIAL_ERROR_IDS] ?? "social.error.conflict" })}</span>
          <button type="button" aria-label={intl.formatMessage({ id: "common.dismiss" })} onClick={clearSocialError}>
            <UiIcon name="close" />
          </button>
        </div>
      ) : null}
      <div className="social-panel-scroll">
        {invites.length > 0 ? (
          <SocialSection title={intl.formatMessage({ id: "social.gameInvites" })} count={invites.length}>
            {invites.map((invite) => (
              <div className="social-request-card social-game-invite" key={invite.inviteId}>
                <div>
                  <strong translate="no">{invite.fromUsername}</strong>
                  <span>{formatLabel(intl, invite.room.format)}</span>
                </div>
                <div className="social-compact-actions">
                  <button type="button" className="btn-primary" onClick={() => acceptInvite(invite.inviteId)}>{intl.formatMessage({ id: "social.accept" })}</button>
                  <button type="button" onClick={() => dismissInvite(invite.inviteId)}>{intl.formatMessage({ id: "social.decline" })}</button>
                </div>
              </div>
            ))}
          </SocialSection>
        ) : null}
        {incoming.length > 0 ? (
          <SocialSection title={intl.formatMessage({ id: "social.requests.incoming" })} count={incoming.length}>
            {incoming.map((request) => (
              <div className="social-request-card" key={request.username}>
                <div><strong translate="no">{request.username}</strong></div>
                <div className="social-compact-actions">
                  <button type="button" className="btn-primary" onClick={() => respondRequest(request.username, true)}>{intl.formatMessage({ id: "social.accept" })}</button>
                  <button type="button" onClick={() => respondRequest(request.username, false)}>{intl.formatMessage({ id: "social.decline" })}</button>
                </div>
              </div>
            ))}
          </SocialSection>
        ) : null}
        {outgoing.length > 0 ? (
          <SocialSection title={intl.formatMessage({ id: "social.requests.outgoing" })} count={outgoing.length}>
            {outgoing.map((request) => (
              <div className="social-request-card" key={request.username}>
                <div><strong translate="no">{request.username}</strong><span>{intl.formatMessage({ id: "social.pending" })}</span></div>
                <div className="social-compact-actions">
                  <button type="button" onClick={() => cancelRequest(request.username)}>{intl.formatMessage({ id: "social.cancelRequest" })}</button>
                </div>
              </div>
            ))}
          </SocialSection>
        ) : null}
        <SocialSection title={intl.formatMessage({ id: "social.friends" })} count={friends.length}>
          {sortedFriends.length === 0 ? (
            <p className="social-empty">{intl.formatMessage({ id: "social.empty" })}</p>
          ) : sortedFriends.map((friend) => (
            <div className="social-friend" data-presence={friend.presence} key={friend.username}>
              <span
                className={`social-presence ${friend.presence}`}
                role="img"
                aria-label={intl.formatMessage({ id: `social.${friend.presence}` })}
                title={intl.formatMessage({ id: `social.${friend.presence}` })}
              >
                <i aria-hidden="true" />
              </span>
              <strong translate="no">{friend.username}</strong>
              <UnreadMessageBadge count={friend.unreadCount} />
              <div className="social-friend-actions">
                <TooltipButton
                  tooltip={intl.formatMessage({ id: "social.messageNamed" }, { username: friend.username })}
                  tooltipSide="above"
                  onClick={() => openChat(friend.username)}
                >
                  <UiIcon name="message" />
                </TooltipButton>
                {canInviteFriends ? (
                  <TooltipButton
                    tooltip={intl.formatMessage({ id: "social.invite.title" }, { username: friend.username })}
                    tooltipSide="above"
                    disabled={friend.presence === "offline"}
                    onClick={() => beginInvite(friend.username)}
                  >
                    <UiIcon name="invite-game" />
                  </TooltipButton>
                ) : null}
                <TooltipButton
                  className="social-remove"
                  tooltip={intl.formatMessage({ id: "social.removeNamed" }, { username: friend.username })}
                  tooltipSide="above"
                  onClick={() => {
                    if (window.confirm(intl.formatMessage({ id: "social.removeConfirm" }, { username: friend.username }))) removeFriend(friend.username);
                  }}
                >
                  <UiIcon name="trash" />
                </TooltipButton>
              </div>
            </div>
          ))}
        </SocialSection>
      </div>
    </aside>
  ) : null;

  const toast = !open && incomingChatToast ? (
    <div className="social-message-toast" role="status" aria-live="polite">
      <button
        type="button"
        aria-label={intl.formatMessage(
          { id: "social.chat.newMessageFrom" },
          { username: incomingChatToast.friendUsername, message: incomingChatToast.text },
        )}
        onClick={() => {
          dismissIncomingChatToast();
          openChat(incomingChatToast.friendUsername);
        }}
      >
        <span className="social-message-toast-avatar" aria-hidden="true">
          {incomingChatToast.friendUsername.charAt(0).toUpperCase()}
        </span>
        <span className="social-message-toast-copy">
          <strong>{incomingChatToast.friendUsername}</strong>
          <span>{incomingChatToast.text}</span>
        </span>
      </button>
    </div>
  ) : null;

  const modals = <><ChatModal /><FriendRoomModal /></>;

  // In a game the control sits on the player's own nameplate instead of floating over the board.
  if (anchor) {
    return (
      <>
        {createPortal(
          <div
            ref={dockRef}
            className="nameplate-actions nameplate-social"
            data-open={open}
            onKeyDown={onRootKeyDown}
            onBlur={onRootBlur}
          >
            <TooltipButton
              ref={triggerRef}
              className="nameplate-action nameplate-action-social"
              tooltip={intl.formatMessage({ id: "social.friends" })}
              tooltipSide="above"
              aria-haspopup="dialog"
              aria-expanded={open}
              onClick={toggleOpen}
            >
              <UiIcon name="friends" />
              {badge}
            </TooltipButton>
            {panel}
            {toast}
          </div>,
          anchor,
        )}
        {modals}
      </>
    );
  }

  return (
    <>
      <div
        ref={dockRef}
        className="social-dock"
        data-user-position={dockPosition ? "true" : undefined}
        data-panel-horizontal={panelHorizontal}
        data-panel-vertical={panelVertical}
        style={dockStyle}
        onKeyDown={onRootKeyDown}
        onBlur={onRootBlur}
      >
        {open ? (
          <button
            type="button"
            className="social-mobile-backdrop"
            tabIndex={-1}
            aria-label={intl.formatMessage(
              { id: "common.closeNamed" },
              { title: intl.formatMessage({ id: "social.friends" }) },
            )}
            onClick={() => setOpen(false)}
          />
        ) : null}
        {panel}
        {toast}
        <button
          ref={triggerRef}
          type="button"
          className="social-bubble"
          aria-label={intl.formatMessage({ id: "social.friends" })}
          aria-expanded={open}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            const rect = dockRef.current?.getBoundingClientRect();
            if (!rect) return;
            suppressBubbleClickRef.current = false;
            dragRef.current = {
              pointerId: event.pointerId,
              startX: event.clientX,
              startY: event.clientY,
              originX: rect.left,
              originY: rect.top,
              width: rect.width,
              height: rect.height,
              moved: false,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={moveBubble}
          onPointerUp={finishBubbleDrag}
          onPointerCancel={(event) => finishBubbleDrag(event, true)}
          onClick={() => {
            if (suppressBubbleClickRef.current) {
              suppressBubbleClickRef.current = false;
              return;
            }
            toggleOpen();
          }}
        >
          <UiIcon name="friends" />
          {badge}
        </button>
      </div>
      {modals}
    </>
  );
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function SocialSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return <section className="social-section"><h3>{title}<span>{count}</span></h3>{children}</section>;
}

function ChatModal() {
  const intl = useIntl();
  const {
    authUser,
    username,
    friends,
    messagesByFriend,
    hasMoreByFriend,
    closeChat,
    loadEarlier,
    sendMessage,
    markRead,
    reportFriend,
  } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    username: state.activeChat,
    friends: state.friends,
    messagesByFriend: state.chatMessages,
    hasMoreByFriend: state.chatHasMore,
    closeChat: state.closeChat,
    loadEarlier: state.loadEarlierChat,
    sendMessage: state.sendChatMessage,
    markRead: state.markChatRead,
    reportFriend: state.reportFriend,
  })));
  const [draft, setDraft] = useState("");
  const [reportingChat, setReportingChat] = useState<string | null>(null);
  const reportTitleId = useId();
  const flagRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const key = username?.toLowerCase() ?? "";
  const messages = messagesByFriend[key] ?? [];
  const latestId = messages.at(-1)?.id;
  const friend = friends.find((candidate) => candidate.username.toLowerCase() === key);
  const [reported, markReported] = useSentReport(`chat:${key}`);
  // Reporting belongs to one conversation; switching chats returns to messages.
  const reporting = reportingChat === key;

  useEffect(() => {
    if (!username) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [latestId, reporting, username]);

  useEffect(() => {
    if (!username) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") markRead(username);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [markRead, username]);

  if (!username) return null;
  const closeReport = () => {
    setReportingChat(null);
    flagRef.current?.focus();
  };
  const reportLabel = intl.formatMessage(
    { id: reported ? "game.report.reported" : "game.report.open" },
    { username },
  );
  const submit = () => {
    if (!draft.trim()) return;
    sendMessage(username, draft);
    setDraft("");
  };
  return (
    <ModalSurface title={username} nameTitle className="chat-modal" onClose={closeChat}>
      <div className="chat-contact-avatar" aria-hidden="true">
        {username.charAt(0).toUpperCase()}
      </div>
      <div className={`chat-presence social-presence ${friend?.presence ?? "offline"}`}>
        <i aria-hidden="true" />{intl.formatMessage({ id: `social.${friend?.presence ?? "offline"}` })}
      </div>
      <TooltipButton
        ref={flagRef}
        className="chat-report-toggle"
        data-reported={reported}
        tooltip={reportLabel}
        aria-pressed={reporting}
        aria-disabled={reported && !reporting}
        onClick={() => {
          if (reporting) closeReport();
          else if (!reported) setReportingChat(key);
        }}
      >
        <UiIcon name={reported ? "flag-filled" : "flag"} />
      </TooltipButton>
      {reporting ? (
        <section
          className="chat-report"
          aria-labelledby={reportTitleId}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              closeReport();
            }
          }}
        >
          <ReportForm
            username={username}
            source="chat"
            titleId={reportTitleId}
            chatOption={{ checked: true }}
            onReport={(reason, details, includeChat) => reportFriend(username, reason, details, includeChat)}
            onSent={markReported}
            onClose={closeReport}
          />
        </section>
      ) : (
        <>
          <div className="chat-log" aria-live="polite">
            {hasMoreByFriend[key] ? (
              <button type="button" className="chat-load-earlier" onClick={() => loadEarlier(username)}>{intl.formatMessage({ id: "social.chat.loadEarlier" })}</button>
            ) : null}
            {messages.length === 0 ? <p className="social-empty">{intl.formatMessage({ id: "social.chat.empty" })}</p> : null}
            {messages.map((message) => {
              const own = message.senderUsername.toLowerCase() === authUser?.toLowerCase();
              return (
                <div className={`chat-message${own ? " own" : ""}`} key={message.id}>
                  <p>{message.text}</p>
                  <time dateTime={new Date(message.sentAt).toISOString()}>{intl.formatTime(message.sentAt, { hour: "numeric", minute: "2-digit" })}</time>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <div className="chat-compose">
            <input
              type="text"
              value={draft}
              maxLength={1_000}
              data-modal-initial-focus
              aria-label={intl.formatMessage({ id: "social.chat.placeholder" })}
              placeholder={intl.formatMessage({ id: "social.chat.placeholder" })}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <TooltipButton
              className="btn-primary"
              tooltip={intl.formatMessage({ id: "social.chat.send" })}
              tooltipSide="above"
              disabled={!draft.trim()}
              onClick={submit}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m3 3 14 7-14 7 2.1-5.4L12 10 5.1 8.4 3 3Z" />
              </svg>
            </TooltipButton>
          </div>
        </>
      )}
    </ModalSurface>
  );
}
