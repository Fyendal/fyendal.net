import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { BotOpponent, CardPoolMode, Format } from "@fyendal/shared";
import type { DeckSummary } from "@fyendal/protocol";
import { ModalSurface } from "../components/ModalSurface.js";
import { UiIcon } from "../components/UiIcon.js";
import { loadHomeSoloOpponentDeck, saveHomeSoloOpponentDeck } from "../storage.js";
import { useStore } from "../store.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { DeckDropdown } from "./CreateRoomModal.js";
import { deckChoicesFor, deckIsLegalForRoom, ImportDeckModal, sortDecksForPicker } from "./DeckGrid.js";

type SoloStep = "choose" | "bot" | "both" | "import";

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

/** Solo start: practice against a bot, or play both seats yourself. */
export function SoloModeModal({
  format,
  deckId,
  onSelectBot,
  onStartSolo,
  onClose,
}: {
  format: Format;
  deckId: string;
  onSelectBot: (bot: BotOpponent | undefined, searchForPlayer: boolean) => void;
  onStartSolo: (opponentDeckId: string) => void;
  onClose: () => void;
}) {
  const authUser = useStore((state) => state.authUser);
  const [step, setStep] = useState<SoloStep>("choose");
  const [opponentDeckId, setOpponentDeckId] = useState<string | null>(() =>
    typeof localStorage === "undefined" ? null : loadHomeSoloOpponentDeck(localStorage, authUser, format)
  );

  const chooseOpponentDeck = (id: string) => {
    setOpponentDeckId(id);
    if (typeof localStorage !== "undefined") saveHomeSoloOpponentDeck(localStorage, authUser, format, id);
  };

  if (step === "bot") {
    return <BotOpponentModal format={format} onSelect={onSelectBot} onClose={() => setStep("choose")} />;
  }
  if (step === "import") {
    return (
      <ImportDeckModal
        format={format}
        onImported={(deck) => {
          if (deck.format === format) chooseOpponentDeck(deck.id);
          setStep("both");
        }}
        onClose={() => setStep("both")}
      />
    );
  }
  if (step === "both") {
    return (
      <PlayBothSidesModal
        format={format}
        deckId={deckId}
        opponentDeckId={opponentDeckId}
        onChooseOpponentDeck={chooseOpponentDeck}
        onImport={() => setStep("import")}
        onBack={() => setStep("choose")}
        onStart={onStartSolo}
        onClose={onClose}
      />
    );
  }
  return <SoloModeChoice onChoose={setStep} onClose={onClose} />;
}

function SoloModeChoice({
  onChoose,
  onClose,
}: {
  onChoose: (step: "bot" | "both") => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  return (
    <ModalSurface
      className="solo-mode-modal"
      title={intl.formatMessage({ id: "lobby.solo.title" })}
      onClose={onClose}
    >
      <div className="solo-mode-options">
        <button type="button" className="solo-mode-card" onClick={() => onChoose("bot")}>
          <UiIcon name="bot" className="solo-mode-icon" />
          <strong>{intl.formatMessage({ id: "lobby.solo.bot" })}</strong>
          <small>{intl.formatMessage({ id: "lobby.solo.botDescription" })}</small>
        </button>
        <button type="button" className="solo-mode-card" onClick={() => onChoose("both")}>
          <UiIcon name="swap" className="solo-mode-icon" />
          <strong>{intl.formatMessage({ id: "lobby.solo.bothSides" })}</strong>
          <small>{intl.formatMessage({ id: "lobby.solo.bothSidesDescription" })}</small>
        </button>
      </div>
    </ModalSurface>
  );
}

export function PlayBothSidesModal({
  format,
  deckId,
  opponentDeckId,
  onChooseOpponentDeck,
  onImport,
  onBack,
  onStart,
  onClose,
}: {
  format: Format;
  deckId: string;
  opponentDeckId: string | null;
  onChooseOpponentDeck: (id: string) => void;
  onImport: () => void;
  onBack: () => void;
  onStart: (opponentDeckId: string) => void;
  onClose: () => void;
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
    <ModalSurface
      className="solo-mode-modal solo-both-modal"
      title={intl.formatMessage({ id: "lobby.solo.bothSides" })}
      description={intl.formatMessage({ id: "lobby.solo.bothSidesDescription" })}
      onClose={onClose}
    >
      <form
        className="solo-both-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (opponentDeck) onStart(opponentDeck.id);
        }}
      >
        <div className="solo-both-field">
          <span>{intl.formatMessage({ id: "lobby.solo.yourDeck" })}</span>
          <strong className="solo-both-own">{ownDeck?.name ?? ""}</strong>
        </div>
        <div className="solo-both-field">
          <span>{intl.formatMessage({ id: "lobby.solo.opponentDeck" })}</span>
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
        <div className="solo-both-actions">
          <button type="button" onClick={onBack}>{intl.formatMessage({ id: "common.back" })}</button>
          <button type="submit" className="btn-cta" disabled={!opponentDeck}>
            {intl.formatMessage({ id: "lobby.solo.start" })}
          </button>
        </div>
      </form>
    </ModalSurface>
  );
}
