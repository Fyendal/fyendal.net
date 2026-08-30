import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { DeckSummary } from "@fyendal/protocol";
import type { BotOpponent } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { deckChoicesFor, deckIsLegalForRoom } from "./DeckGrid.js";
import { FORMAT_LABELS } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";
import { BotOpponentModal } from "./BotOpponentModal.js";

const ROOM_FORMATS = ["cc", "silver-age"] as const satisfies readonly ConstructedFormat[];

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const {
    decks,
    createRoom,
    createBotRoom,
    allowFutureCards,
    setAllowFutureCards,
  } = useStore(useShallow((state) => ({
    decks: state.decks,
    createRoom: state.createRoom,
    createBotRoom: state.createBotRoom,
    allowFutureCards: state.allowFutureCards,
    setAllowFutureCards: state.setAllowFutureCards,
  })));
  const [format, setFormat] = useState<ConstructedFormat>("cc");
  const [choosingBot, setChoosingBot] = useState(false);
  const [deckFor, setDeckFor] = useState<Record<ConstructedFormat, string>>({
    cc: "",
    "silver-age": "",
  });

  const allowFuture = allowFutureCards[format];
  const choices = deckChoicesFor(format, decks, allowFuture);
  const deckId = deckFor[format];
  const selectedDeck = choices.find((deck) => deck.id === deckId);
  const selectionValid = selectedDeck !== undefined && deckIsLegalForRoom(selectedDeck, allowFuture);

  const createHostedRoom = (visibility: "public" | "private") => {
    if (!selectionValid) return;
    createRoom(format, { deckId }, visibility);
    onClose();
  };

  const playBot = (bot: BotOpponent) => {
    if (!selectionValid) return;
    createBotRoom(format, deckId, bot);
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
        <h2 className="panel-title" id="create-room-title">Create a room</h2>

        <fieldset className="create-room-fieldset">
          <legend>Format</legend>
          <div className="create-room-formats">
            {ROOM_FORMATS.map((roomFormat) => (
              <button
                type="button"
                key={roomFormat}
                className={format === roomFormat ? "selected" : ""}
                aria-pressed={format === roomFormat}
                onClick={() => setFormat(roomFormat)}
              >
                {FORMAT_LABELS[roomFormat]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="create-room-fieldset">
          <legend>Deck</legend>
          <label className="toggle-switch create-room-future-toggle">
            <span>Allow Future Cards</span>
            <input
              type="checkbox"
              role="switch"
              checked={allowFuture}
              onChange={(event) => setAllowFutureCards(format, event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          <DeckDropdown
            key={format}
            decks={choices}
            selected={selectedDeck}
            allowFuture={allowFuture}
            onSelect={(id) => setDeckFor((current) => ({ ...current, [format]: id }))}
          />
        </fieldset>

        <div className="create-room-actions">
          <button className="btn-primary" disabled={!selectionValid} onClick={() => createHostedRoom("public")}>
            Open Room
          </button>
          <button className="btn-private-room" disabled={!selectionValid} onClick={() => createHostedRoom("private")}>
            Private Room
          </button>
          <button
            className="btn-bot"
            disabled={!selectionValid}
            onClick={() => {
              setChoosingBot(true);
            }}
          >
            Play vs Bot
          </button>
          <button onClick={onClose}>Cancel</button>
        </div>
        {choosingBot ? (
          <BotOpponentModal
            format={format}
            onSelect={(bot) => playBot(bot)}
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
  allowFuture,
  onSelect,
}: {
  decks: DeckSummary[];
  selected: DeckSummary | undefined;
  allowFuture: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="create-room-deck-select">
      <button
        type="button"
        className="create-room-deck-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected
          ? <DeckOptionContent key={selected.id} deck={selected} />
          : <span className="muted">Choose a deck</span>}
        <span className="create-room-deck-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div className="create-room-deck-options" role="listbox" aria-label="Deck">
          {decks.map((deck) => {
            const blocked = !deckIsLegalForRoom(deck, allowFuture);
            return (
              <button
                type="button"
                key={deck.id}
                role="option"
                aria-selected={deck.id === selected?.id}
                disabled={blocked}
                onClick={() => {
                  onSelect(deck.id);
                  setOpen(false);
                }}
              >
                <DeckOptionContent deck={deck} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DeckOptionContent({ deck }: { deck: DeckSummary }) {
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
        <small>{deck.heroName} · {deck.deckSize} cards</small>
      </span>
    </span>
  );
}
