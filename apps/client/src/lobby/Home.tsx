import { useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { BotOpponent } from "@fyendal/shared";
import type { DeckSummary } from "@fyendal/protocol";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import silverAgeDeckArt from "../../../assets/Sage.jpg";
import classicConstructedDeckArt from "../../../assets/CC.jpg";
import silverAgePreconArt from "../../../assets/Sage Precon.png";
import {
  deckIsLegalForRoom,
  ImportDeckModal,
  preconSummaries,
} from "./DeckGrid.js";
import { DeckDropdown } from "./CreateRoomModal.js";
import { RoomCard } from "./RoomCard.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { FormatName } from "./FormatBadge.js";

/** The focused starting point: play choices and rooms the account can reclaim. */
export function Home(props: { onGoToFormat: (format: ConstructedFormat) => void }) {
  const intl = useIntl();
  const { rooms, joinRoom } = useStore(useShallow((state) => ({
    rooms: state.rooms,
    joinRoom: state.joinRoom,
  })));
  const rejoinRooms = rooms.filter((room) => room.yours === true);

  return (
    <div className="panel home-panel">
      <HomePlayOptions onGoToFormat={props.onGoToFormat}>
        {rejoinRooms.length > 0 ? (
          <section className="room-section home-rejoin-section" aria-labelledby="rejoin-rooms-title">
            <h3 id="rejoin-rooms-title" className="panel-title">
              {intl.formatMessage({ id: "lobby.home.rejoinRooms" })}
            </h3>
            <div className="room-grid">
              {rejoinRooms.map((room) => (
                <RoomCard
                  key={room.code}
                  room={room}
                  onRejoin={joinRoom}
                />
              ))}
            </div>
          </section>
        ) : null}
      </HomePlayOptions>
    </div>
  );
}

function HomePlayOptions(props: {
  children: ReactNode;
  onGoToFormat: (format: ConstructedFormat) => void;
}) {
  const intl = useIntl();
  const {
    authUser,
    allowFutureCards,
    createBotRoom,
    decks,
    decksLoading,
    lastPlayedDecks,
    queuedFormat,
    queueJoin,
    setAllowFutureCards,
  } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    allowFutureCards: state.allowFutureCards,
    createBotRoom: state.createBotRoom,
    decks: state.decks,
    decksLoading: state.decksLoading,
    lastPlayedDecks: state.lastPlayedDecks,
    queuedFormat: state.queuedFormat,
    queueJoin: state.queueJoin,
    setAllowFutureCards: state.setAllowFutureCards,
  })));
  const [importingFormat, setImportingFormat] = useState<ConstructedFormat | null>(null);

  if (decksLoading) {
    return <p className="muted" role="status">{intl.formatMessage({ id: "lobby.loadingDecks" })}</p>;
  }

  const hasSavedDecks = decks.length > 0;
  const silverAgeAllowFuture = allowFutureCards["silver-age"];
  const precons = hasSavedDecks
    ? []
    : preconSummaries("silver-age", silverAgeAllowFuture)
      .filter((deck) => deckIsLegalForRoom(deck, silverAgeAllowFuture));
  const silverAgeDecks = decks.filter((deck) => deck.format === "silver-age");
  const classicConstructedDecks = decks.filter((deck) => deck.format === "cc");

  return (
    <>
      <section className="new-player-welcome" aria-labelledby="new-player-welcome-title">
        <details className="card-pool-menu home-future-toggle">
          <summary>{intl.formatMessage({ id: "lobby.cardPool.title" })}</summary>
          <div className="card-pool-menu-panel">
            <strong>{intl.formatMessage({ id: "lobby.cardPool.allowFuture" })}</strong>
            <p>{intl.formatMessage({ id: "lobby.cardPool.description" })}</p>
            {(["cc", "silver-age"] as const).map((format) => (
              <label className="toggle-switch" key={format}>
                <FormatName format={format} className="home-card-pool-format" />
                <input
                  type="checkbox"
                  role="switch"
                  checked={allowFutureCards[format]}
                  disabled={queuedFormat !== null}
                  onChange={(event) => setAllowFutureCards(format, event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
            ))}
          </div>
        </details>
        <div className={`new-player-welcome-copy${hasSavedDecks ? " returning" : ""}`}>
          <h3 id="new-player-welcome-title">
            {intl.formatMessage(
              { id: hasSavedDecks ? "lobby.home.welcomeBack" : "lobby.home.welcome" },
              { username: authUser ?? "" },
            )}
          </h3>
          {!hasSavedDecks ? <p>{intl.formatMessage({ id: "lobby.home.chooseStart" })}</p> : null}
        </div>

        {props.children}

        <div className={`new-player-options${hasSavedDecks ? " two-options" : ""}`}>
          {!hasSavedDecks ? (
            <PlayableDeckCard
              title={intl.formatMessage({ id: "lobby.home.tryPrecon" })}
              art={silverAgePreconArt}
              artStyle="precon"
              format="silver-age"
              decks={precons}
              preferredDeckId={lastPlayedDecks["silver-age"]}
              allowFuture={silverAgeAllowFuture}
              onFindMatch={queueJoin}
              onPlayBot={createBotRoom}
            />
          ) : null}

          {silverAgeDecks.length > 0 ? (
            <PlayableDeckCard
              title={intl.formatMessage({ id: "lobby.home.playSilverAge" })}
              art={silverAgeDeckArt}
              format="silver-age"
              decks={silverAgeDecks}
              preferredDeckId={lastPlayedDecks["silver-age"]}
              allowFuture={silverAgeAllowFuture}
              onFindMatch={queueJoin}
              onPlayBot={createBotRoom}
            />
          ) : (
            <ImportDeckCard
              title={intl.formatMessage({ id: "lobby.home.importSilverAge" })}
              art={silverAgeDeckArt}
              onClick={() => setImportingFormat("silver-age")}
            />
          )}

          {classicConstructedDecks.length > 0 ? (
            <PlayableDeckCard
              title={intl.formatMessage({ id: "lobby.home.playCc" })}
              art={classicConstructedDeckArt}
              format="cc"
              decks={classicConstructedDecks}
              preferredDeckId={lastPlayedDecks.cc}
              allowFuture={allowFutureCards.cc}
              onFindMatch={queueJoin}
              onPlayBot={createBotRoom}
            />
          ) : (
            <ImportDeckCard
              title={intl.formatMessage({ id: "lobby.home.importCc" })}
              art={classicConstructedDeckArt}
              onClick={() => setImportingFormat("cc")}
            />
          )}
        </div>
      </section>

      {importingFormat ? (
        <ImportDeckModal
          format={importingFormat}
          onClose={() => setImportingFormat(null)}
          onImported={() => props.onGoToFormat(importingFormat)}
        />
      ) : null}
    </>
  );
}

function PlayableDeckCard(props: {
  title: string;
  art: string;
  artStyle?: "precon";
  format: ConstructedFormat;
  decks: DeckSummary[];
  preferredDeckId: string | null;
  allowFuture: boolean;
  onFindMatch: (format: ConstructedFormat, choice: { deckId: string }) => void;
  onPlayBot: (format: ConstructedFormat, deckId: string, bot?: BotOpponent) => void;
}) {
  const intl = useIntl();
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [choosingBot, setChoosingBot] = useState(false);
  const selectedDeck = props.decks.find((deck) =>
    deck.id === selectedDeckId && deckIsLegalForRoom(deck, props.allowFuture)
  ) ?? props.decks.find((deck) =>
    deck.id === props.preferredDeckId && deckIsLegalForRoom(deck, props.allowFuture)
  ) ??
    props.decks.find((deck) => deckIsLegalForRoom(deck, props.allowFuture));
  const selectionValid = selectedDeck !== undefined &&
    deckIsLegalForRoom(selectedDeck, props.allowFuture);

  return (
    <article className={`new-player-card new-player-play-card${props.artStyle === "precon" ? " new-player-precon-card" : ""}`}>
      <img
        className={`new-player-card-art${props.artStyle === "precon" ? " precon-art" : ""}`}
        src={props.art}
        alt=""
        width={960}
        height={540}
      />
      <h3 className="new-player-card-title">{props.title}</h3>
      <div className="new-player-card-content">
        <div className="new-player-deck-select">
          <DeckDropdown
            decks={props.decks}
            selected={selectedDeck}
            allowFuture={props.allowFuture}
            onSelect={setSelectedDeckId}
          />
        </div>
        <div className="new-player-play-actions">
          <button
            className="btn-primary"
            disabled={!selectionValid}
            onClick={() => {
              if (selectedDeck) props.onFindMatch(props.format, { deckId: selectedDeck.id });
            }}
          >
            {intl.formatMessage({ id: "lobby.action.findMatch" })}
          </button>
          <button
            className="btn-bot"
            disabled={!selectionValid}
            onClick={() => {
              if (!selectedDeck) return;
              setChoosingBot(true);
            }}
          >
            {intl.formatMessage({ id: "lobby.action.playBot" })}
          </button>
        </div>
      </div>
      {choosingBot && selectedDeck ? (
        <BotOpponentModal
          format={props.format}
          onSelect={(bot) => {
            props.onPlayBot(props.format, selectedDeck.id, bot);
            setChoosingBot(false);
          }}
          onClose={() => setChoosingBot(false)}
        />
      ) : null}
    </article>
  );
}

function ImportDeckCard(props: { title: string; art: string; onClick: () => void }) {
  const intl = useIntl();
  return (
    <button
      className="new-player-card new-player-import-card"
      aria-label={props.title}
      onClick={props.onClick}
    >
      <img className="new-player-card-art" src={props.art} alt="" width={960} height={540} />
      <span className="new-player-card-content">
        <span className="new-player-card-eyebrow">
          {intl.formatMessage({ id: "lobby.home.bringDeck" })}
        </span>
        <strong>{props.title}</strong>
      </span>
    </button>
  );
}
