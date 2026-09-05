import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { ModalSurface } from "../components/ModalSurface.js";
import { formatLabel } from "../lobby/FormatBadge.js";
import { useStore } from "../store.js";
import { FriendRoomModal } from "./FriendRoomModal.js";

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
  const [username, setUsername] = useState("");
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
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !dockRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  }, [open, setOpen]);

  if (!authUser) return null;

  const submitRequest = (event: React.FormEvent) => {
    event.preventDefault();
    const target = username.trim();
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(target)) return;
    sendRequest(target);
    setUsername("");
  };

  return (
    <>
      <div
        ref={dockRef}
        className="social-dock"
        onBlur={(event) => {
          if (!open) return;
          const nextFocus = event.relatedTarget;
          if (nextFocus instanceof Node && event.currentTarget.contains(nextFocus)) return;
          if (nextFocus !== null) setOpen(false);
        }}
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
        {open ? (
          <aside className="social-panel" aria-label={intl.formatMessage({ id: "social.friends" })}>
            <header className="social-panel-header">
              <div>
                <strong>{intl.formatMessage({ id: "social.friends" })}</strong>
                <span>{intl.formatMessage({ id: "social.friendCount" }, { count: friends.length })}</span>
              </div>
              <button type="button" className="social-close" aria-label={intl.formatMessage({ id: "common.close" })} onClick={() => setOpen(false)}>×</button>
            </header>
            <form className="social-add-form" onSubmit={submitRequest}>
              <label htmlFor="social-add-username">{intl.formatMessage({ id: "social.addFriend" })}</label>
              <div>
                <input
                  id="social-add-username"
                  value={username}
                  minLength={3}
                  maxLength={20}
                  pattern="[A-Za-z0-9_]{3,20}"
                  placeholder={intl.formatMessage({ id: "social.username" })}
                  onChange={(event) => setUsername(event.target.value)}
                />
                <button
                  type="submit"
                  className="btn-primary"
                  aria-label={intl.formatMessage({ id: "social.addFriend" })}
                  title={intl.formatMessage({ id: "social.addFriend" })}
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <circle cx="7.5" cy="6.5" r="3" />
                    <path d="M2.5 17v-1.5a5 5 0 0 1 10 0V17M15.5 6v6M12.5 9h6" />
                  </svg>
                </button>
              </div>
            </form>
            {socialError ? (
              <div className="social-error" role="alert">
                <span>{intl.formatMessage({ id: SOCIAL_ERROR_IDS[socialError as keyof typeof SOCIAL_ERROR_IDS] ?? "social.error.conflict" })}</span>
                <button type="button" aria-label={intl.formatMessage({ id: "common.dismiss" })} onClick={clearSocialError}>×</button>
              </div>
            ) : null}
            <div className="social-panel-scroll">
              {invites.length > 0 ? (
                <SocialSection title={intl.formatMessage({ id: "social.gameInvites" })}>
                  {invites.map((invite) => (
                    <div className="social-request-card social-game-invite" key={invite.inviteId}>
                      <div>
                        <strong>{invite.fromUsername}</strong>
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
                <SocialSection title={intl.formatMessage({ id: "social.requests.incoming" })}>
                  {incoming.map((request) => (
                    <div className="social-request-card" key={request.username}>
                      <strong>{request.username}</strong>
                      <div className="social-compact-actions">
                        <button type="button" className="btn-primary" onClick={() => respondRequest(request.username, true)}>{intl.formatMessage({ id: "social.accept" })}</button>
                        <button type="button" onClick={() => respondRequest(request.username, false)}>{intl.formatMessage({ id: "social.decline" })}</button>
                      </div>
                    </div>
                  ))}
                </SocialSection>
              ) : null}
              {outgoing.length > 0 ? (
                <SocialSection title={intl.formatMessage({ id: "social.requests.outgoing" })}>
                  {outgoing.map((request) => (
                    <div className="social-request-card" key={request.username}>
                      <div><strong>{request.username}</strong><span>{intl.formatMessage({ id: "social.pending" })}</span></div>
                      <button type="button" onClick={() => cancelRequest(request.username)}>{intl.formatMessage({ id: "social.cancelRequest" })}</button>
                    </div>
                  ))}
                </SocialSection>
              ) : null}
              <SocialSection title={intl.formatMessage({ id: "social.friends" })}>
                {sortedFriends.length === 0 ? (
                  <p className="social-empty">{intl.formatMessage({ id: "social.empty" })}</p>
                ) : sortedFriends.map((friend) => (
                  <div className="social-friend" key={friend.username}>
                    <div className="social-avatar" aria-hidden="true">{friend.username.charAt(0).toUpperCase()}</div>
                    <div className="social-friend-copy">
                      <strong>{friend.username}</strong>
                      <span
                        className={`social-presence ${friend.presence}`}
                        role="img"
                        aria-label={intl.formatMessage({ id: `social.${friend.presence}` })}
                        title={intl.formatMessage({ id: `social.${friend.presence}` })}
                      >
                        <i aria-hidden="true" />
                      </span>
                    </div>
                    <div className="social-friend-actions">
                      <button
                        type="button"
                        className="social-icon-action social-message-button"
                        aria-label={intl.formatMessage({ id: "social.messageNamed" }, { username: friend.username })}
                        data-tooltip={intl.formatMessage({ id: "social.messageNamed" }, { username: friend.username })}
                        onClick={() => openChat(friend.username)}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14v11H9.5L5 19.5v-14Z" /></svg>
                        {friend.unreadCount > 0 ? <span className="social-row-badge">{formatUnreadCount(friend.unreadCount)}</span> : null}
                      </button>
                      {canInviteFriends ? (
                        <button
                          type="button"
                          className="social-icon-action"
                          aria-label={intl.formatMessage({ id: "social.invite.title" }, { username: friend.username })}
                          data-tooltip={intl.formatMessage({ id: "social.invite.title" }, { username: friend.username })}
                          disabled={friend.presence === "offline"}
                          onClick={() => beginInvite(friend.username)}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8.5h8a4 4 0 0 1 3.8 2.8l1 3.2a2.7 2.7 0 0 1-4.7 2.5l-1.3-1.5H9.2L7.9 17a2.7 2.7 0 0 1-4.7-2.5l1-3.2A4 4 0 0 1 8 8.5ZM8 11v4M6 13h4M16.5 12h.01M18.5 14h.01" /></svg>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="social-remove"
                        aria-label={intl.formatMessage({ id: "social.removeNamed" }, { username: friend.username })}
                        data-tooltip={intl.formatMessage({ id: "social.removeNamed" }, { username: friend.username })}
                        onClick={() => {
                          if (window.confirm(intl.formatMessage({ id: "social.removeConfirm" }, { username: friend.username }))) removeFriend(friend.username);
                        }}
                      >×</button>
                    </div>
                  </div>
                ))}
              </SocialSection>
            </div>
          </aside>
        ) : null}
        {!open && incomingChatToast ? (
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
        ) : null}
        <button
          type="button"
          className="social-bubble"
          aria-label={intl.formatMessage({ id: "social.friends" })}
          aria-expanded={open}
          onClick={() => {
            if (!open) dismissIncomingChatToast();
            setOpen(!open);
          }}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M14 15a4.5 4.5 0 0 1 6.5 4v1"/></svg>
          {notificationCount > 0 ? <span>{notificationCount > 99 ? "99+" : notificationCount}</span> : null}
        </button>
      </div>
      <ChatModal />
      <FriendRoomModal />
    </>
  );
}

function formatUnreadCount(count: number) {
  return count > 99 ? "99+" : String(count);
}

function SocialSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="social-section"><h3>{title}</h3>{children}</section>;
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
  })));
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const key = username?.toLowerCase() ?? "";
  const messages = messagesByFriend[key] ?? [];
  const latestId = messages.at(-1)?.id;
  const friend = friends.find((candidate) => candidate.username.toLowerCase() === key);

  useEffect(() => {
    if (!username) return;
    endRef.current?.scrollIntoView({ block: "end" });
  }, [latestId, username]);

  useEffect(() => {
    if (!username) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") markRead(username);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [markRead, username]);

  if (!username) return null;
  const submit = () => {
    if (!draft.trim()) return;
    sendMessage(username, draft);
    setDraft("");
  };
  return (
    <ModalSurface title={username} className="chat-modal" onClose={closeChat}>
      <div className="chat-contact-avatar" aria-hidden="true">
        {username.charAt(0).toUpperCase()}
      </div>
      <div className={`chat-presence social-presence ${friend?.presence ?? "offline"}`}>
        <i aria-hidden="true" />{intl.formatMessage({ id: `social.${friend?.presence ?? "offline"}` })}
      </div>
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
        <button
          type="button"
          className="btn-primary"
          aria-label={intl.formatMessage({ id: "social.chat.send" })}
          title={intl.formatMessage({ id: "social.chat.send" })}
          disabled={!draft.trim()}
          onClick={submit}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m3 3 14 7-14 7 2.1-5.4L12 10 5.1 8.4 3 3Z" />
          </svg>
        </button>
      </div>
    </ModalSurface>
  );
}
