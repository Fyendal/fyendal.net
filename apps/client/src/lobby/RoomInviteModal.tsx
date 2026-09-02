import { useState } from "react";
import { useIntl } from "react-intl";
import { useStore } from "../store.js";
import { useShallow } from "zustand/react/shallow";
import { Auth } from "../auth/AuthCard.js";
import type { ConstructedFormat } from "../domain.js";
import { DeckTile, deckChoicesFor } from "./DeckGrid.js";
import { formatLabel } from "./FormatBadge.js";

/** URL-only room entry. Resolve the room first, then collect the deck or hero
 *  required to take its open player seat. */
export function RoomInviteModal() {
  const intl = useIntl();
  const [entryMode, setEntryMode] = useState<"choice" | "login" | "register">("choice");
  const { inviteRoom, authUser, decks, joinRoom, dismissInvite } = useStore(
    useShallow((state) => ({
      inviteRoom: state.inviteRoom,
      authUser: state.authUser,
      decks: state.decks,
      joinRoom: state.joinRoom,
      dismissInvite: state.dismissInvite,
    })),
  );
  if (!inviteRoom) return null;

  const joinAsHero = (hero: "rhinar" | "dorinthea") => {
    joinRoom(inviteRoom.code, undefined, undefined, hero);
  };
  const newPlayerChoice = inviteRoom.format === "classic-battles"
    ? intl.formatMessage({ id: "lobby.invite.choiceHero" })
    : intl.formatMessage({ id: "lobby.invite.choiceDeck" });

  let content;
  if (!authUser && inviteRoom.spectateOnly) {
    content = (
      <>
        <p>{intl.formatMessage({ id: "lobby.invite.fullGuest" })}</p>
        <div className="invite-entry-actions">
          <button
            className="btn-primary"
            onClick={() => joinRoom(inviteRoom.code, undefined, true)}
          >
            {intl.formatMessage({ id: "lobby.action.spectate" })}
          </button>
        </div>
      </>
    );
  } else if (!authUser && entryMode === "choice") {
    content = (
      <div className="invite-onboarding">
        <p className="invite-lede">
          {intl.formatMessage(
            { id: "lobby.invite.invited" },
            { format: formatLabel(intl, inviteRoom.format) },
          )}
        </p>
        <p className="muted">
          {intl.formatMessage({ id: "lobby.invite.createThenJoin" }, { choice: newPlayerChoice })}
        </p>
        <div className="invite-entry-actions">
          <button className="btn-primary" onClick={() => setEntryMode("register")}>
            {intl.formatMessage({ id: "lobby.invite.createAccount" })}
          </button>
          <button onClick={() => setEntryMode("login")}>
            {intl.formatMessage({ id: "lobby.invite.haveAccount" })}
          </button>
        </div>
        <button
          className="linklike invite-spectate-link"
          onClick={() => joinRoom(inviteRoom.code, undefined, true)}
        >
          {intl.formatMessage({ id: "lobby.invite.spectateGuest" })}
        </button>
      </div>
    );
  } else if (!authUser) {
    const creatingAccount = entryMode === "register";
    content = (
      <div className="invite-auth-step">
        <p className="invite-lede">
          {intl.formatMessage({
            id: creatingAccount ? "lobby.invite.createAccountTitle" : "lobby.invite.signInTitle",
          })}
        </p>
        <p className="muted">
          {creatingAccount
            ? intl.formatMessage({ id: "lobby.invite.afterCreate" }, { choice: newPlayerChoice })
            : intl.formatMessage({ id: "lobby.invite.afterSignIn" })}
        </p>
        <Auth initialMode={creatingAccount ? "register" : "login"} />
        <button className="linklike" onClick={() => setEntryMode("choice")}>
          {intl.formatMessage({ id: "common.back" })}
        </button>
      </div>
    );
  } else if (inviteRoom.yours) {
    content = (
      <>
        <p>{intl.formatMessage({ id: "lobby.invite.alreadySeated" })}</p>
        <button className="btn-primary" onClick={() => joinRoom(inviteRoom.code)}>
          {intl.formatMessage({ id: "lobby.action.rejoinRoom" })}
        </button>
      </>
    );
  } else if (inviteRoom.spectateOnly) {
    content = (
      <>
        <p>{intl.formatMessage({ id: "lobby.invite.full" })}</p>
        <button className="btn-primary" onClick={() => joinRoom(inviteRoom.code, undefined, true)}>
          {intl.formatMessage({ id: "lobby.action.spectate" })}
        </button>
      </>
    );
  } else if (inviteRoom.format === "classic-battles") {
    content = (
      <>
        <p className="muted">{intl.formatMessage({ id: "lobby.invite.chooseHero" })}</p>
        <div className="lobby-row invite-hero-actions">
          <button onClick={() => joinAsHero("rhinar")}>Rhinar</button>
          <button onClick={() => joinAsHero("dorinthea")}>Dorinthea</button>
        </div>
      </>
    );
  } else {
    const choices = deckChoicesFor(
      inviteRoom.format as ConstructedFormat,
      decks,
      inviteRoom.allowFutureCards === true,
    );
    content = choices.length === 0 ? (
      <p className="muted">
        {intl.formatMessage(
          { id: "lobby.invite.needDeck" },
          { format: formatLabel(intl, inviteRoom.format) },
        )}
      </p>
    ) : (
      <>
        <p className="muted">{intl.formatMessage({ id: "lobby.invite.chooseDeck" })}</p>
        <div className="deck-grid">
          {choices.map((deck) => (
            <DeckTile
              key={deck.id}
              deck={deck}
              onSelect={() => joinRoom(inviteRoom.code, deck.id)}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <div className="modal-backdrop" onClick={() => dismissInvite()}>
      <div
        className="deck-pick-modal invite-room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-room-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") dismissInvite();
        }}
      >
        <h2 className="panel-title" id="invite-room-title">
          {intl.formatMessage({ id: "lobby.invite.title" }, { code: inviteRoom.code })}
        </h2>
        {inviteRoom.allowFutureCards ? (
          <p className="future-cards-note">{intl.formatMessage({ id: "lobby.futureCardsNote" })}</p>
        ) : null}
        {content}
        <div className="deck-actions">
          <button onClick={() => dismissInvite()}>{intl.formatMessage({ id: "common.cancel" })}</button>
        </div>
      </div>
    </div>
  );
}
