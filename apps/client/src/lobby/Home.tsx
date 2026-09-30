import { useId, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { CardPoolMode } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { loadHomeFormat, loadHomeGameMode, saveHomeFormat, saveHomeGameMode, type HomeGameMode } from "../storage.js";
import { useStore } from "../store.js";
import playPoster from "../../../assets/play-poster.jpg";
import { deckChoicesFor, deckIsLegalForRoom } from "./DeckGrid.js";
import { DeckDropdown } from "./CreateRoomModal.js";
import { RoomCard } from "./RoomCard.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { formatSelectLabel } from "./FormatBadge.js";

/** Play setup and rooms the account can reclaim. */
export function Home() {
  const intl = useIntl();
  const {
    authUser,
    cardPoolModes,
    createBotRoom,
    createRoom,
    decks,
    decksLoading,
    joinRoom,
    lastPlayedDecks,
    queuedFormat,
    queueJoin,
    queueLeave,
    rooms,
    setCardPoolMode,
  } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    cardPoolModes: state.cardPoolModes,
    createBotRoom: state.createBotRoom,
    createRoom: state.createRoom,
    decks: state.decks,
    decksLoading: state.decksLoading,
    joinRoom: state.joinRoom,
    lastPlayedDecks: state.lastPlayedDecks,
    queuedFormat: state.queuedFormat,
    queueJoin: state.queueJoin,
    queueLeave: state.queueLeave,
    rooms: state.rooms,
    setCardPoolMode: state.setCardPoolMode,
  })));
  const [format, setFormat] = useState<ConstructedFormat>(() =>
    typeof localStorage === "undefined"
      ? "silver-age"
      : loadHomeFormat(localStorage, authUser)
  );
  const [selectedDeckId, setSelectedDeckId] = useState("");
  const [mode, setMode] = useState<HomeGameMode>(() =>
    typeof localStorage === "undefined"
      ? "find-match"
      : loadHomeGameMode(localStorage, authUser)
  );
  const [choosingBot, setChoosingBot] = useState(false);
  const cardPoolId = useId();
  const cardPoolHelpId = useId();

  if (decksLoading) {
    return <div className="panel home-panel"><p className="muted" role="status">{intl.formatMessage({ id: "lobby.loadingDecks" })}</p></div>;
  }

  const cardPoolMode = cardPoolModes[format];
  const choices = deckChoicesFor(format, decks, cardPoolMode);
  const selectedDeck = choices.find((deck) =>
    deck.id === selectedDeckId && deckIsLegalForRoom(deck, cardPoolMode)
  ) ?? choices.find((deck) =>
    deck.id === lastPlayedDecks[format] && deckIsLegalForRoom(deck, cardPoolMode)
  ) ?? choices.find((deck) => deckIsLegalForRoom(deck, cardPoolMode));
  const rejoinRooms = rooms.filter((room) => room.yours === true);

  const selectMode = (nextMode: HomeGameMode) => {
    setMode(nextMode);
    if (typeof localStorage !== "undefined") {
      saveHomeGameMode(localStorage, authUser, nextMode);
    }
  };

  const start = () => {
    if (!selectedDeck || queuedFormat !== null) return;
    if (mode === "find-match") {
      queueJoin(format, { deckId: selectedDeck.id });
    } else if (mode === "invite-friend") {
      createRoom(format, { deckId: selectedDeck.id }, "private");
    } else {
      setChoosingBot(true);
    }
  };

  return (
    <div className="panel home-panel">
      {rejoinRooms.length > 0 ? (
        <section className="room-section home-rejoin-section" aria-labelledby="rejoin-rooms-title">
          <h3 id="rejoin-rooms-title" className="panel-title">
            {intl.formatMessage({ id: "lobby.home.rejoinRooms" })}
          </h3>
          <div className="room-grid">
            {rejoinRooms.map((room) => (
              <RoomCard key={room.code} room={room} onRejoin={joinRoom} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="home-play" aria-label={intl.formatMessage({ id: "lobby.home.start" })}>
        <div className="home-play-poster">
          <img
            src={playPoster}
            alt=""
            width={2050}
            height={780}
          />
        </div>

        <form className="home-play-form" onSubmit={(event) => {
          event.preventDefault();
          start();
        }}>
          <div className="home-play-primary-fields">
            <label className="home-play-field">
              <span>{intl.formatMessage({ id: "common.format" })}</span>
              <span className="home-play-select">
                <select
                  value={format}
                  disabled={queuedFormat !== null}
                  onChange={(event) => {
                    const nextFormat = event.target.value as ConstructedFormat;
                    setFormat(nextFormat);
                    setSelectedDeckId("");
                    if (typeof localStorage !== "undefined") {
                      saveHomeFormat(localStorage, authUser, nextFormat);
                    }
                  }}
                >
                  <option value="silver-age">{formatSelectLabel(intl, "silver-age")}</option>
                  <option value="cc">{formatSelectLabel(intl, "cc")}</option>
                </select>
                <span className="create-room-deck-chevron" aria-hidden="true" />
              </span>
            </label>

            <div className="home-play-field home-play-deck-field">
              <span>{intl.formatMessage({ id: "common.deck" })}</span>
              <DeckDropdown
                key={format}
                decks={choices}
                selected={selectedDeck}
                cardPoolMode={cardPoolMode}
                onSelect={setSelectedDeckId}
              />
            </div>
          </div>

          <div className="home-play-field home-card-pool-field">
            <div className="home-play-field-label">
              <label htmlFor={cardPoolId}>{intl.formatMessage({ id: "lobby.cardPool.title" })}</label>
              <button
                type="button"
                className="home-card-pool-help"
                aria-label={intl.formatMessage({ id: "lobby.cardPool.help" })}
                aria-describedby={cardPoolHelpId}
              >?</button>
              <div className="home-card-pool-tooltip" id={cardPoolHelpId} role="tooltip">
                <dl>
                  {(["legal", "future", "open"] as const).map((poolMode) => (
                    <div key={poolMode}>
                      <dt>{intl.formatMessage({ id: `lobby.cardPool.${poolMode}` })}</dt>
                      <dd>{intl.formatMessage({ id: `lobby.cardPool.${poolMode}Description` })}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
            <span className="home-play-select">
              <select
                id={cardPoolId}
                value={cardPoolMode}
                disabled={queuedFormat !== null}
                onChange={(event) => setCardPoolMode(format, event.target.value as CardPoolMode)}
              >
                <option value="legal">{intl.formatMessage({ id: "lobby.cardPool.legal" })}</option>
                <option value="future">{intl.formatMessage({ id: "lobby.cardPool.future" })}</option>
                <option value="open">{intl.formatMessage({ id: "lobby.cardPool.open" })}</option>
              </select>
              <span className="create-room-deck-chevron" aria-hidden="true" />
            </span>
          </div>

          <div className="home-play-field home-play-mode-field">
            <span>{intl.formatMessage({ id: "lobby.home.gameMode" })}</span>
            <div className="home-play-mode-segments" role="group" aria-label={intl.formatMessage({ id: "lobby.home.gameMode" })}>
              {(["find-match", "invite-friend", "bot"] as const).map((gameMode) => (
                <button
                  key={gameMode}
                  type="button"
                  aria-pressed={mode === gameMode}
                  disabled={queuedFormat !== null}
                  onClick={() => selectMode(gameMode)}
                >
                  {intl.formatMessage({ id: gameMode === "find-match"
                    ? "lobby.action.findMatch"
                    : gameMode === "invite-friend"
                      ? "lobby.action.inviteFriend"
                      : "lobby.action.playBot" })}
                </button>
              ))}
            </div>
          </div>

          <div className="home-play-actions">
            {queuedFormat !== null ? (
              <button type="button" className="btn-primary" onClick={queueLeave}>
                {intl.formatMessage({ id: "lobby.action.cancelSearch" })}
              </button>
            ) : (
              <button type="submit" className="btn-primary" disabled={!selectedDeck}>
                {intl.formatMessage({ id: "lobby.home.start" })}
              </button>
            )}
          </div>
        </form>
      </section>

      {choosingBot && selectedDeck ? (
        <BotOpponentModal
          format={format}
          onSelect={(bot, searchForPlayer) => {
            createBotRoom(format, selectedDeck.id, bot, searchForPlayer);
            setChoosingBot(false);
          }}
          onClose={() => setChoosingBot(false)}
        />
      ) : null}
    </div>
  );
}
