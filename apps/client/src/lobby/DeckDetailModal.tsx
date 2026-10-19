import { useId, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { findPrinting } from "@fyendal/cards/client";
import type { DeckSummary } from "@fyendal/protocol";
import type { CardPoolMode } from "@fyendal/shared";
import { loadHomeGameMode, saveHomeFormat, saveHomeGameMode, type HomeGameMode } from "../storage.js";
import { useStore } from "../store.js";
import { cardImageUrl } from "../game/Card.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { CardPoolHelp } from "./CardPoolHelp.js";
import { CARD_POOL_MODES } from "./CardPoolModeControl.js";
import { deckBlockedCards } from "./DeckGrid.js";
import { shortFormatLabel } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";

const GAME_MODES = ["find-match", "invite-friend", "bot"] as const satisfies readonly HomeGameMode[];
const GAME_MODE_MESSAGES: Record<HomeGameMode, string> = {
  "find-match": "lobby.action.findMatch",
  "invite-friend": "lobby.action.inviteFriend",
  bot: "lobby.action.playBot",
};
const GAME_MODE_ICONS: Record<HomeGameMode, UiIconName> = {
  "find-match": "search",
  "invite-friend": "user-add",
  bot: "bot",
};

/**
 * A saved deck's hub: start a game with it in its own format, or open,
 * edit, or delete it. Game mode is shared with the home play panel.
 */
export function DeckDetailModal(props: {
  deck: DeckSummary;
  fabraryHref?: string;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const {
    authUser,
    cardPoolModes,
    createBotRoom,
    createRoom,
    queuedFormat,
    queueJoin,
    queueLeave,
    setCardPoolMode,
    setLobbyRail,
  } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    cardPoolModes: state.cardPoolModes,
    createBotRoom: state.createBotRoom,
    createRoom: state.createRoom,
    queuedFormat: state.queuedFormat,
    queueJoin: state.queueJoin,
    queueLeave: state.queueLeave,
    setCardPoolMode: state.setCardPoolMode,
    setLobbyRail: state.setLobbyRail,
  })));
  const [mode, setMode] = useState<HomeGameMode>(() =>
    typeof localStorage === "undefined" ? "find-match" : loadHomeGameMode(localStorage, authUser)
  );
  const [choosingBot, setChoosingBot] = useState(false);
  const [artOk, setArtOk] = useState(true);
  const [headshotOk, setHeadshotOk] = useState(true);
  const poolId = useId();

  const deck = props.deck;
  const format = deck.format;
  const cardPoolMode = cardPoolModes[format];
  const blocked = deckBlockedCards(deck, cardPoolMode);
  const queued = queuedFormat !== null;
  const heroCard = findPrinting(deck.heroName);
  const showArt = heroCard !== undefined && artOk;

  if (choosingBot) {
    return (
      <BotOpponentModal
        format={format}
        onSelect={(bot, searchForPlayer) => {
          createBotRoom(format, deck.id, bot, searchForPlayer);
          props.onClose();
        }}
        onClose={() => setChoosingBot(false)}
      />
    );
  }

  const selectMode = (next: HomeGameMode) => {
    setMode(next);
    if (typeof localStorage !== "undefined") saveHomeGameMode(localStorage, authUser, next);
  };

  const start = () => {
    if (queued || blocked.length > 0) return;
    if (mode === "bot") {
      setChoosingBot(true);
      return;
    }
    if (mode === "find-match") {
      queueJoin(format, deck.id);
      // The search status and its cancel control live on the home panel.
      if (typeof localStorage !== "undefined") saveHomeFormat(localStorage, authUser, format);
      setLobbyRail("home");
    } else {
      createRoom(format, deck.id, "private");
    }
    props.onClose();
  };

  return (
    <ModalSurface title={deck.name} className="deck-detail-modal" onClose={props.onClose}>
      <div className="deck-detail-banner">
        {showArt ? (
          <span className="deck-card-art">
            <img src={cardImageUrl(heroCard.id)} alt="" onError={() => setArtOk(false)} />
          </span>
        ) : headshotOk ? (
          <img className="deck-card-img" src={heroImageUrl(deck.heroName)} alt="" onError={() => setHeadshotOk(false)} />
        ) : null}
        <div className="deck-detail-overlay">
          <p className="deck-detail-meta">
            <span className="deck-card-format" data-format={format}>{shortFormatLabel(intl, format)}</span>
            <span>
              {intl.formatMessage({ id: "lobby.deck.heroAndCount" }, { hero: deck.heroName, count: deck.deckSize })}
            </span>
          </p>
          <div className="deck-detail-actions">
            {props.fabraryHref ? (
              <a href={props.fabraryHref} target="_blank" rel="noopener noreferrer">
                <UiIcon name="external-link" />
                {intl.formatMessage({ id: "lobby.deck.openFabrary" })}
              </a>
            ) : null}
            <button type="button" onClick={props.onEdit}>
              <UiIcon name="edit" />
              {intl.formatMessage({ id: "lobby.deck.edit" })}
            </button>
            <button type="button" className="deck-detail-delete" onClick={props.onDelete}>
              <UiIcon name="trash" />
              {intl.formatMessage({ id: "lobby.deck.delete" })}
            </button>
          </div>
        </div>
      </div>

      <div className="deck-detail-body">
        <div className="deck-detail-modes" role="group" aria-label={intl.formatMessage({ id: "lobby.home.gameMode" })}>
          {GAME_MODES.map((gameMode) => (
            <button
              key={gameMode}
              type="button"
              aria-pressed={mode === gameMode}
              disabled={queued}
              onClick={() => selectMode(gameMode)}
            >
              <UiIcon name={GAME_MODE_ICONS[gameMode]} />
              {intl.formatMessage({ id: GAME_MODE_MESSAGES[gameMode] })}
            </button>
          ))}
        </div>

        {blocked.length > 0 ? (
          <p className="deck-detail-blocked" role="status">
            {intl.formatMessage(
              { id: "lobby.deck.blocked" },
              { reason: intl.formatMessage({ id: "lobby.deck.illegalCards" }, { cards: blocked.join(", ") }) },
            )}
          </p>
        ) : null}

        <div className="deck-detail-launch">
          <div className="deck-detail-pool">
            <div className="home-play-field-label">
              <label htmlFor={poolId}>{intl.formatMessage({ id: "lobby.cardPool.title" })}</label>
              <CardPoolHelp />
            </div>
            <select
              id={poolId}
              value={cardPoolMode}
              disabled={queued}
              onChange={(event) => setCardPoolMode(format, event.target.value as CardPoolMode)}
            >
              {CARD_POOL_MODES.map((poolMode) => (
                <option key={poolMode} value={poolMode}>
                  {intl.formatMessage({ id: `lobby.cardPool.${poolMode}` })}
                </option>
              ))}
            </select>
          </div>
          {queued ? (
            <button type="button" className="btn-primary deck-detail-start" onClick={queueLeave}>
              {intl.formatMessage({ id: "lobby.action.cancelSearch" })}
            </button>
          ) : (
            <button
              type="button"
              className="btn-cta deck-detail-start"
              disabled={blocked.length > 0}
              data-modal-initial-focus={blocked.length > 0 ? undefined : ""}
              onClick={start}
            >
              {intl.formatMessage({ id: "lobby.home.start" })}
            </button>
          )}
        </div>
      </div>
    </ModalSurface>
  );
}
