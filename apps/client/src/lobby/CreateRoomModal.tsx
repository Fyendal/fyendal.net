import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { DeckSummary } from "@fyendal/protocol";
import type { BotOpponent, CardPoolMode, Format } from "@fyendal/shared";
import { useStore } from "../store.js";
import { deckChoicesFor, deckIsLegalForRoom, sortDecksForPicker } from "./DeckGrid.js";
import { FormatName } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { CardPoolModeControl } from "./CardPoolModeControl.js";
import { ListboxDropdown } from "../components/ListboxDropdown.js";
import { FORMATS } from "../domain.js";

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const {
    decks,
    createRoom,
    createBotRoom,
    cardPoolModes,
    deckPlayedAt,
    refreshDecks,
    setCardPoolMode,
  } = useStore(useShallow((state) => ({
    decks: state.decks,
    createRoom: state.createRoom,
    createBotRoom: state.createBotRoom,
    cardPoolModes: state.cardPoolModes,
    deckPlayedAt: state.deckPlayedAt,
    refreshDecks: state.refreshDecks,
    setCardPoolMode: state.setCardPoolMode,
  })));
  const [format, setFormat] = useState<Format>("cc");
  const [choosingBot, setChoosingBot] = useState(false);
  const [deckFor, setDeckFor] = useState<Record<Format, string>>({
    cc: "",
    "silver-age": "",
  });

  const cardPoolMode = cardPoolModes[format];
  const choices = deckChoicesFor(format, decks, cardPoolMode);
  const deckId = deckFor[format];
  const selectedDeck = choices.find((deck) => deck.id === deckId);
  const selectionValid = selectedDeck !== undefined && deckIsLegalForRoom(selectedDeck, cardPoolMode);

  const createHostedRoom = (visibility: "public" | "private") => {
    if (!selectionValid) return;
    createRoom(format, deckId, visibility);
    onClose();
  };

  const playBot = (bot: BotOpponent, searchForPlayer: boolean) => {
    if (!selectionValid) return;
    createBotRoom(format, deckId, bot, searchForPlayer);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="deck-pick-modal create-room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className="panel-title" id="create-room-title">
          {intl.formatMessage({ id: "lobby.createRoom.title" })}
        </h2>

        <fieldset className="create-room-fieldset">
          <legend>{intl.formatMessage({ id: "common.format" })}</legend>
          <div className="create-room-formats">
            {FORMATS.map((roomFormat) => (
              <button
                type="button"
                key={roomFormat}
                className={format === roomFormat ? "selected" : ""}
                aria-pressed={format === roomFormat}
                onClick={() => setFormat(roomFormat)}
              >
                <FormatName format={roomFormat} className="create-room-format-name" />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="create-room-fieldset">
          <legend>{intl.formatMessage({ id: "common.deck" })}</legend>
          <CardPoolModeControl
            className="create-room-card-pool-control"
            value={cardPoolMode}
            onChange={(mode) => setCardPoolMode(format, mode)}
          />
          <DeckDropdown
            key={format}
            decks={choices}
            selected={selectedDeck}
            cardPoolMode={cardPoolMode}
            deckPlayedAt={deckPlayedAt}
            onOpen={() => { void refreshDecks(true); }}
            onSelect={(id) => setDeckFor((current) => ({ ...current, [format]: id }))}
          />
        </fieldset>

        <div className="create-room-actions">
          <button className="btn-primary" disabled={!selectionValid} onClick={() => createHostedRoom("public")}>
            {intl.formatMessage({ id: "lobby.createRoom.open" })}
          </button>
          <button className="btn-private-room" disabled={!selectionValid} onClick={() => createHostedRoom("private")}>
            {intl.formatMessage({ id: "lobby.createRoom.private" })}
          </button>
          <button
            className="btn-bot"
            disabled={!selectionValid}
            onClick={() => {
              setChoosingBot(true);
            }}
          >
            {intl.formatMessage({ id: "lobby.action.playBot" })}
          </button>
          <button onClick={onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
        </div>
        {choosingBot ? (
          <BotOpponentModal
            format={format}
            onSelect={playBot}
            onClose={() => setChoosingBot(false)}
          />
        ) : null}
      </section>
    </div>
  );
}

export function DeckDropdown({
  decks,
  selected,
  cardPoolMode,
  deckPlayedAt,
  onOpen,
  onSelect,
}: {
  decks: DeckSummary[];
  selected: DeckSummary | undefined;
  cardPoolMode: CardPoolMode;
  deckPlayedAt: Readonly<Record<string, number>>;
  onOpen?: () => void;
  onSelect: (id: string) => void;
}) {
  const intl = useIntl();
  const orderedDecks = sortDecksForPicker(decks, deckPlayedAt);

  return (
    <ListboxDropdown
      ariaLabel={intl.formatMessage({ id: "common.deck" })}
      sections={[{ key: "decks", items: orderedDecks }]}
      trigger={selected
        ? <DeckOptionContent key={selected.id} deck={selected} />
        : <span className="muted">{intl.formatMessage({ id: "lobby.deck.choose" })}</span>}
      getKey={(deck) => deck.id}
      isSelected={(deck) => deck.id === selected?.id}
      isDisabled={(deck) => !deckIsLegalForRoom(deck, cardPoolMode)}
      renderOption={(deck) => <DeckOptionContent deck={deck} />}
      onOpen={onOpen}
      onSelect={(deck) => onSelect(deck.id)}
    />
  );
}

function DeckOptionContent({ deck }: { deck: DeckSummary }) {
  const intl = useIntl();
  const [imageAvailable, setImageAvailable] = useState(true);

  return (
    <span className="create-room-deck-option-content">
      {imageAvailable ? (
        <img
          src={heroImageUrl(deck.heroName)}
          alt=""
          width={42}
          height={42}
          onError={() => setImageAvailable(false)}
        />
      ) : (
        <span className="create-room-deck-image-fallback">{deck.heroName.charAt(0)}</span>
      )}
      <span className="create-room-deck-option-copy">
        <span title={deck.name}>{deck.name}</span>
        <small>
          {intl.formatMessage(
            { id: "lobby.deck.heroAndCount" },
            { hero: deck.heroName, count: deck.deckSize },
          )}
        </small>
      </span>
    </span>
  );
}
