import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { Format } from "@fyendal/shared";
import { ModalSurface } from "../components/ModalSurface.js";
import { DeckDropdown } from "../lobby/CreateRoomModal.js";
import { deckChoicesFor, deckIsLegalForRoom } from "../lobby/DeckGrid.js";
import { useStore } from "../store.js";

/** Deck choice for opening a league match's room; the league fixes the format. */
export function LeagueRoomModal({
  matchId,
  format,
  opponent,
  onClose,
}: {
  matchId: string;
  format: Format;
  opponent: string;
  onClose: () => void;
}) {
  const intl = useIntl();
  const { decks, deckPlayedAt, refreshDecks, createLeagueRoom } = useStore(useShallow((state) => ({
    decks: state.decks,
    deckPlayedAt: state.deckPlayedAt,
    refreshDecks: state.refreshDecks,
    createLeagueRoom: state.createLeagueRoom,
  })));
  const [deckId, setDeckId] = useState("");
  const choices = deckChoicesFor(format, decks, "legal");
  const selected = choices.find((deck) => deck.id === deckId);
  const formatName = intl.formatMessage({ id: format === "cc" ? "format.classicConstructed" : "format.silverAge" });

  useEffect(() => { void refreshDecks(true); }, [refreshDecks]);

  return (
    <ModalSurface title={intl.formatMessage({ id: "league.room.title" })} className="league-room-modal" onClose={onClose}>
      <p className="modal-surface-description">
        {intl.formatMessage({ id: "league.room.description" }, { format: formatName, opponent })}
      </p>
      <fieldset className="create-room-fieldset">
        <legend>{intl.formatMessage({ id: "common.deck" })}</legend>
        <DeckDropdown
          decks={choices}
          selected={selected}
          cardPoolMode="legal"
          deckPlayedAt={deckPlayedAt}
          onOpen={() => { void refreshDecks(true); }}
          onSelect={setDeckId}
        />
      </fieldset>
      {choices.length === 0 ? <p className="muted">{intl.formatMessage({ id: "league.room.noDeck" }, { format: formatName })}</p> : null}
      <div className="social-modal-actions">
        <button type="button" onClick={onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
        <button
          type="button"
          className="btn-primary"
          disabled={!selected || !deckIsLegalForRoom(selected, "legal")}
          onClick={() => {
            if (!selected) return;
            createLeagueRoom(matchId, selected.id);
            onClose();
          }}
        >
          {intl.formatMessage({ id: "league.room.submit" })}
        </button>
      </div>
    </ModalSurface>
  );
}
