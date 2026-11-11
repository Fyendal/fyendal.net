import { useEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { CardPoolMode, Format } from "@fyendal/shared";
import { UiIcon } from "../components/UiIcon.js";
import { DeckDropdown } from "../lobby/CreateRoomModal.js";
import { deckChoicesFor } from "../lobby/DeckGrid.js";
import { useStore } from "../store.js";

const COPIED_MS = 2_000;

/** One bar before an opponent arrives: a switchable deck, the wait status,
 *  and the ways to fill the open seat. */
export function OpenSeatPanel({
  mode,
  roomCode,
  format,
  cardPoolMode,
  deckId,
  switching,
}: {
  mode: "invite" | "search";
  roomCode: string;
  format: Format;
  cardPoolMode: CardPoolMode;
  deckId: string;
  /** A deck switch is loading; the room shows its progress. */
  switching: boolean;
}) {
  const intl = useIntl();
  const {
    decks, deckPlayedAt, refreshDecks, changeRoomDeck, friends, roomFriendInvites,
    inviteFriendToRoom, socialError, clearSocialError, setSocialOpen, deckSwitch,
  } = useStore(useShallow((state) => ({
    decks: state.decks,
    deckPlayedAt: state.deckPlayedAt,
    refreshDecks: state.refreshDecks,
    changeRoomDeck: state.changeRoomDeck,
    friends: state.friends,
    roomFriendInvites: state.roomFriendInvites,
    inviteFriendToRoom: state.inviteFriendToRoom,
    socialError: state.socialError,
    clearSocialError: state.clearSocialError,
    setSocialOpen: state.setSocialOpen,
    deckSwitch: state.deckSwitch,
  })));
  const [copied, setCopied] = useState(false);
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviteRef = useRef<HTMLDivElement>(null);
  const inviteTriggerRef = useRef<HTMLButtonElement>(null);
  const searching = mode === "search";
  const url = `${location.origin}/${roomCode}`;

  const choices = deckChoicesFor(format, decks, cardPoolMode);
  const shownDeckId = deckSwitch?.deckId ?? deckId;
  const selected = choices.find((deck) => deck.id === shownDeckId);
  const sortedFriends = useMemo(() => [...friends].sort((a, b) =>
    Number(b.presence === "online") - Number(a.presence === "online")
      || a.username.localeCompare(b.username)), [friends]);

  useEffect(() => {
    if (pendingInvite && (roomFriendInvites.includes(pendingInvite) || socialError)) {
      setPendingInvite(null);
    }
  }, [pendingInvite, roomFriendInvites, socialError]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  useEffect(() => {
    if (!inviteOpen) return;
    const pressOutside = (event: PointerEvent) => {
      if (!inviteRef.current?.contains(event.target as Node)) setInviteOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setInviteOpen(false);
      inviteTriggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", pressOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", pressOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [inviteOpen]);

  return (
    <section className="panel open-seat" aria-labelledby="open-seat-status">
      <div className="open-seat-deck-picker" aria-busy={switching}>
        <DeckDropdown
          decks={choices}
          selected={selected}
          cardPoolMode={cardPoolMode}
          deckPlayedAt={deckPlayedAt}
          onOpen={() => { void refreshDecks(true); }}
          onSelect={(id) => {
            const deck = choices.find((choice) => choice.id === id);
            if (deck) changeRoomDeck(deck.id, deck.name);
          }}
        />
      </div>

      <p className="open-seat-status" id="open-seat-status" role="status">
        {searching ? <span className="home-play-live-dot" aria-hidden="true" /> : null}
        {intl.formatMessage({ id: searching ? "prep.openSeat.searching" : "prep.waitingOpponent" })}
      </p>

      <div className="open-seat-invite" ref={inviteRef}>
        {friends.length === 0 ? (
          <button type="button" className="lobby-create-action" onClick={() => setSocialOpen(true)}>
            <UiIcon name="friends" />
            {intl.formatMessage({ id: "prep.openSeat.addFriends" })}
          </button>
        ) : (
          <button
            ref={inviteTriggerRef}
            type="button"
            className="lobby-create-action open-seat-invite-trigger"
            aria-haspopup="dialog"
            aria-expanded={inviteOpen}
            onClick={() => setInviteOpen((open) => !open)}
          >
            <UiIcon name="friends" />
            {intl.formatMessage({ id: "prep.openSeat.inviteFriends" })}
          </button>
        )}
        <button type="button" className="lobby-create-action" aria-live="polite" onClick={() => void copyLink()}>
          <UiIcon name={copied ? "check" : "invite-game"} />
          {intl.formatMessage({ id: copied ? "prep.copied" : "prep.openSeat.copyLink" })}
        </button>
        {inviteOpen && friends.length > 0 ? (
          <div
            className="open-seat-friends"
            role="dialog"
            aria-label={intl.formatMessage({ id: "prep.openSeat.inviteFriends" })}
          >
            <ul>
              {sortedFriends.map((friend) => {
                const online = friend.presence === "online";
                const invited = roomFriendInvites.includes(friend.username);
                return (
                  <li key={friend.username} className={online ? "online" : "offline"}>
                    <span className="open-seat-friend-avatar" aria-hidden="true">
                      {friend.username.charAt(0).toUpperCase()}
                      <i />
                    </span>
                    <span className="open-seat-friend-name" title={friend.username}>{friend.username}</span>
                    {invited ? (
                      <span className="open-seat-invited">
                        <UiIcon name="check" />
                        {intl.formatMessage({ id: "prep.openSeat.invited" })}
                      </span>
                    ) : online ? (
                      <button
                        type="button"
                        className="lobby-create-action"
                        disabled={pendingInvite === friend.username}
                        aria-label={intl.formatMessage(
                          { id: "prep.openSeat.inviteFriend" },
                          { username: friend.username },
                        )}
                        onClick={() => {
                          setPendingInvite(friend.username);
                          inviteFriendToRoom(friend.username);
                        }}
                      >
                        {intl.formatMessage({ id: "prep.openSeat.invite" })}
                      </button>
                    ) : (
                      <span className="open-seat-friend-status">
                        {intl.formatMessage({ id: "prep.openSeat.offline" })}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>

      {socialError ? (
        <div className="social-error" role="alert">
          <span>{intl.formatMessage({
            id: socialError === "FRIEND_UNAVAILABLE"
              ? "social.error.unavailable"
              : socialError === "MESSAGE_RATE_LIMITED"
                ? "social.error.rateLimited"
                : "social.error.friendRequired",
          })}</span>
          <button type="button" aria-label={intl.formatMessage({ id: "common.dismiss" })} onClick={clearSocialError}>×</button>
        </div>
      ) : null}
    </section>
  );
}
