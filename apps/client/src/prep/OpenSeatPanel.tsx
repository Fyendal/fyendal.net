import { useEffect, useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { CardPoolMode, Format } from "@fyendal/shared";
import { UiIcon } from "../components/UiIcon.js";
import { DeckDropdown } from "../lobby/CreateRoomModal.js";
import { deckChoicesFor } from "../lobby/DeckGrid.js";
import { useStore } from "../store.js";

const COPIED_MS = 2_000;

/** Waiting room before an opponent arrives: your seat with a switchable deck,
 *  and the open seat with every way to fill it, including a matchmaking search. */
export function OpenSeatPanel({
  mode,
  roomCode,
  format,
  cardPoolMode,
  deckId,
  switching,
  searchers,
}: {
  mode: "invite" | "search";
  roomCode: string;
  format: Format;
  cardPoolMode: CardPoolMode;
  deckId: string;
  /** A deck switch is loading; the room shows its progress. */
  switching: boolean;
  /** Other players this search could pair with. */
  searchers: number;
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
  const searching = mode === "search";
  const url = `${location.origin}/${roomCode}`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

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

  const shareLink = () => {
    void navigator.share({
      title: intl.formatMessage({ id: "prep.openSeat.shareTitle" }),
      url,
    }).catch(() => undefined);
  };

  return (
    <section className="panel open-seat" aria-labelledby="open-seat-title">
      <h3 className="panel-title" id="open-seat-title">
        {intl.formatMessage({ id: "prep.waitingOpponent" })}
      </h3>
      <div className="open-seat-table">
        <div className="open-seat-you">
          <span className="open-seat-label">{intl.formatMessage({ id: "prep.openSeat.yourDeck" })}</span>
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
          <p className="open-seat-hint">{intl.formatMessage({ id: "prep.openSeat.deckHint" })}</p>
        </div>

        <div className="open-seat-chair">
          {searching ? (
            <div className="open-seat-search">
              <h4 className="open-seat-chair-title">{intl.formatMessage({ id: "prep.openSeat.searchTitle" })}</h4>
              <p className="open-seat-searching">
                <span className="home-play-live-dot" aria-hidden="true" />
                {searchers > 0
                  ? intl.formatMessage({ id: "lobby.home.othersSearchingNow" }, { count: searchers })
                  : intl.formatMessage({ id: "prep.openSeat.nobodySearching" })}
              </p>
              <p className="open-seat-hint">{intl.formatMessage({ id: "prep.openSeat.searchHint" })}</p>
              <span className="open-seat-label open-seat-or">{intl.formatMessage({ id: "prep.openSeat.orInvite" })}</span>
            </div>
          ) : (
            <h4 className="open-seat-chair-title">{intl.formatMessage({ id: "prep.openSeat.seatTitle" })}</h4>
          )}
          <div className="open-seat-link">
            <div className="open-seat-link-field">
              <input
                readOnly
                value={url}
                aria-label={intl.formatMessage({ id: "prep.openSeat.linkLabel" })}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button type="button" className="lobby-create-action open-seat-copy" aria-live="polite" onClick={() => void copyLink()}>
                <UiIcon name={copied ? "check" : "invite-game"} />
                {intl.formatMessage({ id: copied ? "prep.copied" : "prep.openSeat.copyLink" })}
              </button>
            </div>
            {canShare ? (
              <button type="button" className="lobby-create-action" onClick={shareLink}>
                <UiIcon name="share" />
                {intl.formatMessage({ id: "prep.openSeat.share" })}
              </button>
            ) : null}
          </div>

          <div className="open-seat-friends">
            <span className="open-seat-label">{intl.formatMessage({ id: "prep.openSeat.friends" })}</span>
            {sortedFriends.length === 0 ? (
              <p className="open-seat-empty">
                {intl.formatMessage({ id: "prep.openSeat.noFriends" })}{" "}
                <button type="button" className="linklike" onClick={() => setSocialOpen(true)}>
                  {intl.formatMessage({ id: "prep.openSeat.addFriends" })}
                </button>
              </p>
            ) : (
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
                      <span className="open-seat-friend-name">
                        {friend.username}
                        {!online ? (
                          <span className="open-seat-friend-status">
                            {intl.formatMessage({ id: "prep.openSeat.offline" })}
                          </span>
                        ) : null}
                      </span>
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
                          onClick={() => {
                            setPendingInvite(friend.username);
                            inviteFriendToRoom(friend.username);
                          }}
                        >
                          <UiIcon name="invite-game" />
                          {intl.formatMessage({ id: "prep.openSeat.invite" })}
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
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
          </div>
        </div>
      </div>
    </section>
  );
}
