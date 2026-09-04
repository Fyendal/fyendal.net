import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { ConstructedFormat } from "../domain.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { useStore } from "../store.js";
import { CardPoolModeControl } from "../lobby/CardPoolModeControl.js";
import { DeckDropdown } from "../lobby/CreateRoomModal.js";
import { deckChoicesFor, deckIsLegalForRoom } from "../lobby/DeckGrid.js";
import { FormatName } from "../lobby/FormatBadge.js";

const FORMATS = ["cc", "silver-age"] as const;

export function FriendRoomModal() {
  const intl = useIntl();
  const {
    target,
    decks,
    cardPoolModes,
    socialError,
    clearSocialError,
    setCardPoolMode,
    createFriendRoom,
    cancelFriendInvite,
  } = useStore(useShallow((state) => ({
    target: state.friendInviteTarget,
    decks: state.decks,
    cardPoolModes: state.cardPoolModes,
    socialError: state.socialError,
    clearSocialError: state.clearSocialError,
    setCardPoolMode: state.setCardPoolMode,
    createFriendRoom: state.createFriendRoom,
    cancelFriendInvite: state.cancelFriendInvite,
  })));
  const [format, setFormat] = useState<ConstructedFormat>("cc");
  const [deckFor, setDeckFor] = useState<Record<ConstructedFormat, string>>({ cc: "", "silver-age": "" });
  if (!target) return null;

  const cardPoolMode = cardPoolModes[format];
  const choices = deckChoicesFor(format, decks, cardPoolMode);
  const selected = choices.find((deck) => deck.id === deckFor[format]);
  const valid = selected !== undefined && deckIsLegalForRoom(selected, cardPoolMode);

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "social.invite.modalTitle" }, { username: target })}
      className="friend-room-modal"
      onClose={cancelFriendInvite}
    >
      <div className="friend-room-avatar" aria-hidden="true">{target.charAt(0).toUpperCase()}</div>
      <fieldset className="create-room-fieldset friend-room-section">
        <legend>{intl.formatMessage({ id: "common.format" })}</legend>
        <div className="create-room-formats">
          {FORMATS.map((candidate) => (
            <button
              type="button"
              key={candidate}
              className={format === candidate ? "selected" : ""}
              aria-pressed={format === candidate}
              onClick={() => setFormat(candidate)}
            >
              <FormatName format={candidate} className="create-room-format-name" />
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="create-room-fieldset friend-room-section friend-room-deck-section">
        <legend>{intl.formatMessage({ id: "common.deck" })}</legend>
        <CardPoolModeControl
          className="friend-room-card-pool-control"
          value={cardPoolMode}
          onChange={(mode) => setCardPoolMode(format, mode)}
        />
        <DeckDropdown
          key={format}
          decks={choices}
          selected={selected}
          cardPoolMode={cardPoolMode}
          onSelect={(id) => setDeckFor((current) => ({ ...current, [format]: id }))}
        />
      </fieldset>
      {choices.length === 0 ? (
        <p className="muted">{intl.formatMessage({ id: "social.invite.noDeck" })}</p>
      ) : null}
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
      <div className="social-modal-actions">
        <button type="button" onClick={cancelFriendInvite}>{intl.formatMessage({ id: "common.cancel" })}</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!valid}
          onClick={() => selected && createFriendRoom(target, format, selected.id)}
        >
          {intl.formatMessage({ id: "social.invite.send" })}
        </button>
      </div>
    </ModalSurface>
  );
}
