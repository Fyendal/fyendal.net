import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { findPrinting } from "@fyendal/cards/client";
import type { BotOpponent, CardPoolMode, Format } from "@fyendal/shared";
import type { DeckSummary } from "@fyendal/protocol";
import { ModalSurface } from "../components/ModalSurface.js";
import { shownCardArt } from "../components/CardArtVariants.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";
import { cardImageUrl } from "../game/Card.js";
import { deckArtIsCustom, useCardArtCatalog } from "../game/cardArtCatalog.js";
import {
  loadHomeSoloOpponentDeck,
  loadSoloBothSidesSeen,
  saveHomeSoloOpponentDeck,
  saveSoloBothSidesSeen,
} from "../storage.js";
import { useStore } from "../store.js";
import { BotOpponentPicker } from "./BotOpponentModal.js";
import { DeckDropdown } from "./CreateRoomModal.js";
import { heroImageUrl } from "./heroImage.js";
import { deckChoicesFor, deckIsLegalForRoom, ImportDeckModal, sortDecksForPicker } from "./DeckGrid.js";

type SoloTab = "bot" | "both";

const TABS: readonly { tab: SoloTab; icon: UiIconName; label: string }[] = [
  { tab: "bot", icon: "bot", label: "lobby.solo.bot" },
  { tab: "both", icon: "swap", label: "lobby.solo.bothSides" },
];

/** The remembered opponent deck when it is still playable, else the most recent other deck, else a mirror. */
export function defaultSoloOpponentDeck(
  choices: readonly DeckSummary[],
  cardPoolMode: CardPoolMode,
  deckPlayedAt: Readonly<Record<string, number>>,
  ownDeckId: string,
  rememberedId: string | null,
): DeckSummary | undefined {
  const playable = sortDecksForPicker(choices, deckPlayedAt)
    .filter((deck) => deckIsLegalForRoom(deck, cardPoolMode));
  return playable.find((deck) => deck.id === rememberedId)
    ?? playable.find((deck) => deck.id !== ownDeckId)
    ?? playable[0];
}

/** Solo start: the bot roster first, with playing both seats yourself one tab away. */
export function SoloModeModal({
  format,
  deckId,
  onSelectBot,
  onStartSolo,
  onClose,
}: {
  format: Format;
  deckId: string;
  onSelectBot: (bot: BotOpponent, searchForPlayer: boolean) => void;
  onStartSolo: (opponentDeckId: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const authUser = useStore((state) => state.authUser);
  const [tab, setTab] = useState<SoloTab>("bot");
  const [bothSidesSeen, setBothSidesSeen] = useState(() =>
    typeof localStorage === "undefined" ? true : loadSoloBothSidesSeen(localStorage)
  );
  const [importing, setImporting] = useState(false);
  const [opponentDeckId, setOpponentDeckId] = useState<string | null>(() =>
    typeof localStorage === "undefined" ? null : loadHomeSoloOpponentDeck(localStorage, authUser, format)
  );
  const id = useId();
  const tabs = useRef<Partial<Record<SoloTab, HTMLButtonElement | null>>>({});

  const selectTab = (next: SoloTab) => {
    setTab(next);
    if (next === "both" && !bothSidesSeen) {
      setBothSidesSeen(true);
      if (typeof localStorage !== "undefined") saveSoloBothSidesSeen(localStorage);
    }
  };
  const chooseOpponentDeck = (deck: string) => {
    setOpponentDeckId(deck);
    if (typeof localStorage !== "undefined") saveHomeSoloOpponentDeck(localStorage, authUser, format, deck);
  };

  if (importing) {
    return (
      <ImportDeckModal
        format={format}
        onImported={(deck) => {
          if (deck.format === format) chooseOpponentDeck(deck.id);
          setImporting(false);
        }}
        onClose={() => setImporting(false)}
      />
    );
  }

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: SoloTab = event.key === "Home" ? "bot" : event.key === "End" ? "both" : tab === "bot" ? "both" : "bot";
    tabs.current[next]?.focus();
    selectTab(next);
  };

  return (
    <ModalSurface
      className={`bot-opponent-modal solo-play-modal solo-play-modal-${tab}`}
      backdropClassName="solo-play-backdrop"
      title={intl.formatMessage({ id: "lobby.solo.title" })}
      onClose={onClose}
    >
      <div
        className="solo-play-tabs"
        role="tablist"
        aria-label={intl.formatMessage({ id: "lobby.solo.title" })}
        onKeyDown={onTabKeyDown}
      >
        {TABS.map((option) => {
          const selected = option.tab === tab;
          return (
            <button
              key={option.tab}
              ref={(element) => { tabs.current[option.tab] = element; }}
              id={`${id}-tab-${option.tab}`}
              type="button"
              role="tab"
              className={selected ? "selected" : undefined}
              aria-selected={selected}
              aria-controls={`${id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => selectTab(option.tab)}
            >
              <UiIcon name={option.icon} />
              {intl.formatMessage({ id: option.label })}
              {option.tab === "both" && !bothSidesSeen ? (
                <span className="solo-tab-unseen" aria-hidden="true" />
              ) : null}
            </button>
          );
        })}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`}>
        {tab === "bot" ? (
          <BotOpponentPicker format={format} onSelect={onSelectBot} />
        ) : (
          <PlayBothSides
            format={format}
            deckId={deckId}
            opponentDeckId={opponentDeckId}
            onChooseOpponentDeck={chooseOpponentDeck}
            onImport={() => setImporting(true)}
            onStart={onStartSolo}
          />
        )}
      </div>
    </ModalSurface>
  );
}

/** The matchup for a self-played game: your deck facing the one you pick for the other seat. */
export function PlayBothSides({
  format,
  deckId,
  opponentDeckId,
  onChooseOpponentDeck,
  onImport,
  onStart,
}: {
  format: Format;
  deckId: string;
  opponentDeckId: string | null;
  onChooseOpponentDeck: (id: string) => void;
  onImport: () => void;
  onStart: (opponentDeckId: string) => void;
}) {
  const intl = useIntl();
  const { cardPoolModes, decks, deckPlayedAt, refreshDecks } = useStore(useShallow((state) => ({
    cardPoolModes: state.cardPoolModes,
    decks: state.decks,
    deckPlayedAt: state.deckPlayedAt,
    refreshDecks: state.refreshDecks,
  })));
  const cardPoolMode = cardPoolModes[format];
  const choices = deckChoicesFor(format, decks, cardPoolMode);
  const ownDeck = choices.find((deck) => deck.id === deckId);
  const opponentDeck = defaultSoloOpponentDeck(choices, cardPoolMode, deckPlayedAt, deckId, opponentDeckId);

  return (
    <form
      className="solo-both-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (opponentDeck) onStart(opponentDeck.id);
      }}
    >
      <div className="solo-matchup">
        <MatchupSeat key={ownDeck?.id ?? "own"} label={intl.formatMessage({ id: "lobby.solo.yourDeck" })} deck={ownDeck} />
        <span className="solo-matchup-versus">{intl.formatMessage({ id: "common.versusShort" })}</span>
        <MatchupSeat
          key={opponentDeck?.id ?? "opponent"}
          label={intl.formatMessage({ id: "lobby.solo.opponentDeck" })}
          deck={opponentDeck}
          opposing
        />
        <p className="solo-both-lead">{intl.formatMessage({ id: "lobby.solo.bothSidesDescription" })}</p>
        <div className="solo-both-pick">
          <DeckDropdown
            decks={choices}
            selected={opponentDeck}
            cardPoolMode={cardPoolMode}
            deckPlayedAt={deckPlayedAt}
            ariaLabel={intl.formatMessage({ id: "lobby.solo.opponentDeck" })}
            onOpen={() => { void refreshDecks(true); }}
            onSelect={onChooseOpponentDeck}
          />
          <button type="button" className="solo-both-import" onClick={onImport}>
            <UiIcon name="plus" />
            {intl.formatMessage({ id: "lobby.solo.importDeck" })}
          </button>
        </div>
      </div>
      <div className="solo-both-actions">
        <button type="submit" className="btn-cta" disabled={!opponentDeck}>
          {intl.formatMessage({ id: "lobby.solo.start" })}
        </button>
      </div>
    </form>
  );
}

/** One side of the matchup as a deck banner; the opposing side mirrors so the heroes face each other. */
function MatchupSeat({ label, deck, opposing }: { label: string; deck: DeckSummary | undefined; opposing?: boolean }) {
  const intl = useIntl();
  const betaTester = useStore((state) => state.betaTester);
  const [artOk, setArtOk] = useState(true);
  const [headshotOk, setHeadshotOk] = useState(true);
  const heroCard = deck ? findPrinting(deck.heroName) : undefined;
  const showArt = heroCard !== undefined && artOk;
  const artCatalog = useCardArtCatalog(betaTester && showArt && deck !== undefined && deckArtIsCustom(deck.art));
  const heroArt = artCatalog && heroCard && deck ? shownCardArt(artCatalog, heroCard.id, deck.art) : undefined;

  return (
    <div className={`solo-matchup-seat${opposing ? " opposing" : ""}`}>
      {showArt ? (
        <span className="deck-card-art">
          <img src={cardImageUrl(heroCard.id, heroArt)} alt="" onError={() => setArtOk(false)} />
        </span>
      ) : deck && headshotOk ? (
        <img className="deck-card-img" src={heroImageUrl(deck.heroName)} alt="" onError={() => setHeadshotOk(false)} />
      ) : null}
      <span className="solo-matchup-label">{label}</span>
      {deck ? (
        <>
          <strong className="solo-matchup-name">{deck.name}</strong>
          <span className="solo-matchup-hero">
            {intl.formatMessage({ id: "lobby.deck.heroAndCount" }, { hero: deck.heroName, count: deck.deckSize })}
          </span>
        </>
      ) : (
        <span className="solo-matchup-hero">{intl.formatMessage({ id: "lobby.deck.choose" })}</span>
      )}
    </div>
  );
}
