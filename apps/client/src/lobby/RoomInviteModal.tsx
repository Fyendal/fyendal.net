import { useState } from "react";
import { useStore } from "../store.js";
import { useShallow } from "zustand/react/shallow";
import { Auth } from "../auth/AuthCard.js";
import type { ConstructedFormat } from "../domain.js";
import { DeckTile, deckChoicesFor } from "./DeckGrid.js";
import { FORMAT_LABELS } from "./FormatBadge.js";

/** URL-only room entry. Resolve the room first, then collect the deck or hero
 *  required to take its open player seat. */
export function RoomInviteModal() {
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
    ? "choose Rhinar or Dorinthea"
    : "choose a ready-to-play deck";

  let content;
  if (!authUser && inviteRoom.spectateOnly) {
    content = (
      <>
        <p>This room already has two players, but you can watch the match without an account.</p>
        <div className="invite-entry-actions">
          <button
            className="btn-primary"
            onClick={() => joinRoom(inviteRoom.code, undefined, true)}
          >
            Spectate
          </button>
        </div>
      </>
    );
  } else if (!authUser && entryMode === "choice") {
    content = (
      <div className="invite-onboarding">
        <p className="invite-lede">
          You’ve been invited to play {FORMAT_LABELS[inviteRoom.format]}.
        </p>
        <p className="muted">
          Create a free player account, {newPlayerChoice}, and join your friend.
        </p>
        <div className="invite-entry-actions">
          <button className="btn-primary" onClick={() => setEntryMode("register")}>
            Create Player Account
          </button>
          <button onClick={() => setEntryMode("login")}>I Have an Account</button>
        </div>
        <button
          className="linklike invite-spectate-link"
          onClick={() => joinRoom(inviteRoom.code, undefined, true)}
        >
          Just spectate without an account
        </button>
      </div>
    );
  } else if (!authUser) {
    const creatingAccount = entryMode === "register";
    content = (
      <div className="invite-auth-step">
        <p className="invite-lede">
          {creatingAccount ? "Create your player account" : "Sign in to join your friend"}
        </p>
        <p className="muted">
          {creatingAccount
            ? `You’ll ${newPlayerChoice} as soon as your account is ready.`
            : "This invitation will still be here after you sign in."}
        </p>
        <Auth initialMode={creatingAccount ? "register" : "login"} />
        <button className="linklike" onClick={() => setEntryMode("choice")}>Back</button>
      </div>
    );
  } else if (inviteRoom.yours) {
    content = (
      <>
        <p>You already have a seat in this room.</p>
        <button className="btn-primary" onClick={() => joinRoom(inviteRoom.code)}>
          Rejoin Room
        </button>
      </>
    );
  } else if (inviteRoom.spectateOnly) {
    content = (
      <>
        <p>This room already has two players, but you can watch the match.</p>
        <button className="btn-primary" onClick={() => joinRoom(inviteRoom.code, undefined, true)}>
          Spectate
        </button>
      </>
    );
  } else if (inviteRoom.format === "classic-battles") {
    content = (
      <>
        <p className="muted">Choose your hero to join this private room.</p>
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
        You need a {FORMAT_LABELS[inviteRoom.format]} deck before opening this invite.
      </p>
    ) : (
      <>
        <p className="muted">Choose a deck to join this private room.</p>
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
          Room invitation · {inviteRoom.code}
        </h2>
        {inviteRoom.allowFutureCards ? (
          <p className="future-cards-note">This room allows implemented future cards.</p>
        ) : null}
        {content}
        <div className="deck-actions">
          <button onClick={() => dismissInvite()}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
