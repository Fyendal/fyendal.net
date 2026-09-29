import { useState } from "react";
import { useIntl } from "react-intl";
import { preconsForFormat } from "@fyendal/cards/client";
import type { DeckSummary } from "@fyendal/protocol";
import type { CardPoolMode } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { preconPrepDeck } from "../prep/prepDeck.js";
import { formatSelectLabel } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";
import { deckErrorMessages } from "./deckErrors.js";
import { ModalSurface } from "../components/ModalSurface.js";

export type DeckLegalityFilter = "all" | "playable" | "attention";

export function filterAndSortDecks(
  decks: readonly DeckSummary[],
  options: {
    query: string;
    legality: DeckLegalityFilter;
    cardPoolMode: CardPoolMode;
  },
): DeckSummary[] {
  const query = options.query.trim().toLocaleLowerCase();
  return decks
    .filter((deck) => {
      const legal = deckIsLegalForRoom(deck, options.cardPoolMode);
      if (options.legality === "playable" && !legal) return false;
      if (options.legality === "attention" && legal) return false;
      return !query || deck.name.toLocaleLowerCase().includes(query) ||
        deck.heroName.toLocaleLowerCase().includes(query);
    })
    .slice()
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** Shared precons as deck tiles (synthesized, no DB row). */
export function preconSummaries(format: ConstructedFormat, cardPoolMode: CardPoolMode = "legal"): DeckSummary[] {
  return preconsForFormat(format, { cardPoolMode }).map((p) => preconPrepDeck(p.id)!);
}

/**
 * Everything a format offers as a playable tile: the user's own saved decks
 * first, followed by the hardcoded precons (free for everyone, not editable).
 */
export function deckChoicesFor(
  format: ConstructedFormat,
  decks: DeckSummary[],
  cardPoolMode: CardPoolMode = "legal",
): DeckSummary[] {
  const own = decks.filter((d) => d.format === format);
  return [...own, ...preconSummaries(format, cardPoolMode)];
}

export function deckIsLegalForRoom(deck: DeckSummary, cardPoolMode: CardPoolMode): boolean {
  return (cardPoolMode === "open" || !deck.bannedCards?.length) &&
    (cardPoolMode !== "legal" || !deck.futureCards?.length);
}

/**
 * One deck tile: hero headshot + deck name. Shared by the deck library
 * and room-join picker. A headshot slug that misses on Fabrary
 * just hides the image — the tile stays usable.
 */
export function DeckTile(props: {
  deck: DeckSummary;
  selected?: boolean;
  blocked?: boolean;
  source?: "saved" | "preconstructed";
  onSelect: () => void;
}) {
  const intl = useIntl();
  const [imgOk, setImgOk] = useState(true);
  const d = props.deck;
  const bannedCards = d.bannedCards ?? [];
  const futureCards = d.futureCards ?? [];
  return (
    <button
      className={`deck-card${props.selected ? " selected" : ""}${props.blocked ? " blocked" : ""}`}
      aria-disabled={props.blocked || undefined}
      aria-expanded={props.selected || undefined}
      onClick={() => {
        if (!props.blocked) props.onSelect();
      }}
    >
      {imgOk && (
        <img
          className="deck-card-img"
          src={heroImageUrl(d.heroName)}
          alt={d.heroName}
          width={96}
          height={96}
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      )}
      <span className="deck-card-name">{d.name}</span>
      <span className="deck-card-details">
        <span>{d.heroName}</span>
        <span>
          {intl.formatMessage(
            { id: "lobby.deck.countAndSource" },
            {
              count: d.deckSize,
              source: intl.formatMessage({
                id: props.source === "preconstructed"
                  ? "lobby.deck.source.preconstructed"
                  : "lobby.deck.source.saved",
              }),
            },
          )}
        </span>
      </span>
      {bannedCards.length > 0 ? (
        <span
          className="deck-legality-hint banned"
          title={intl.formatMessage({ id: "lobby.deck.bannedList" }, { cards: bannedCards.join("\n") })}
        >
          {intl.formatMessage({ id: "lobby.deck.includesBanned" }, { count: bannedCards.length })}
        </span>
      ) : null}
      {futureCards.length > 0 ? (
        <span
          className="deck-legality-hint future"
          title={intl.formatMessage({ id: "lobby.deck.futureList" }, { cards: futureCards.join("\n") })}
        >
          {intl.formatMessage({ id: "lobby.deck.includesFuture" }, { count: futureCards.length })}
        </span>
      ) : null}
    </button>
  );
}

export function ImportDeckModal(props: {
  format: ConstructedFormat;
  onClose: () => void;
}) {
  const intl = useIntl();
  const importDeck = useStore((state) => state.importDeck);
  const [source, setSource] = useState<"url" | "text">("url");
  const [format, setFormat] = useState<ConstructedFormat>(props.format);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [decklist, setDecklist] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const value = source === "url" ? url.trim() : decklist.trim();
  const submit = async () => {
    if (!value || busy) return;
    setBusy(true);
    setErrors([]);
    const result = await importDeck({
      name: name.trim(),
      format,
      ...(source === "url" ? { url: value } : { text: value }),
    });
    setBusy(false);
    if (result.ok) {
      props.onClose();
      return;
    }
    setErrors(deckErrorMessages(
      result,
      intl.formatMessage({ id: "lobby.deck.error.importFailed" }),
      {
        unknownCards: (cards) => intl.formatMessage({ id: "lobby.deck.error.unknownCards" }, { cards }),
        unimplementedCards: (cards) => intl.formatMessage(
          { id: "lobby.deck.error.unimplementedCards" },
          { cards },
        ),
      },
    ));
  };

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "lobby.deck.createImport" })}
      className="deck-import-modal"
      onClose={props.onClose}
    >
        <div
          className="deck-import-source"
          role="group"
          aria-label={intl.formatMessage({ id: "lobby.deck.source" })}
        >
          <button
            className={source === "url" ? "selected" : ""}
            aria-pressed={source === "url"}
            onClick={() => setSource("url")}
          >
            {intl.formatMessage({ id: "lobby.deck.fabraryLink" })}
          </button>
          <button
            className={source === "text" ? "selected" : ""}
            aria-pressed={source === "text"}
            onClick={() => setSource("text")}
          >
            {intl.formatMessage({ id: "lobby.deck.pasteList" })}
          </button>
        </div>
        <form
          className="deck-import-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <label>
            <span>{intl.formatMessage({ id: "common.format" })}</span>
            <select value={format} onChange={(event) => setFormat(event.target.value as ConstructedFormat)}>
              <option value="cc">{formatSelectLabel(intl, "cc")}</option>
              <option value="silver-age">{formatSelectLabel(intl, "silver-age")}</option>
            </select>
          </label>
          {source === "url" ? (
            <label className="deck-import-primary">
              <span>{intl.formatMessage({ id: "lobby.deck.fabraryLink" })}</span>
              <input
                name="fabrary-url"
                type="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://fabrary.net/decks/…"
                autoComplete="off"
                spellCheck={false}
                data-modal-initial-focus
              />
            </label>
          ) : (
            <label className="deck-import-primary">
              <span>{intl.formatMessage({ id: "lobby.deck.deckList" })}</span>
              <textarea
                name="deck-list"
                value={decklist}
                onChange={(event) => setDecklist(event.target.value)}
                placeholder={intl.formatMessage({ id: "lobby.deck.deckListPlaceholder" })}
                rows={12}
                spellCheck={false}
                data-modal-initial-focus
              />
            </label>
          )}
          <label className="deck-import-name">
            <span>{intl.formatMessage({ id: "lobby.deck.optionalName" })}</span>
            <input
              name="deck-name"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {errors.length > 0 ? (
            <div className="import-errors" role="alert">
              {errors.map((error, index) => <p key={index}>{error}</p>)}
            </div>
          ) : null}
          <div className="deck-edit-actions">
            <button type="button" onClick={props.onClose}>
              {intl.formatMessage({ id: "common.cancel" })}
            </button>
            <button type="submit" className="btn-primary" disabled={busy || !value}>
              {intl.formatMessage({ id: busy ? "lobby.deck.importing" : "common.import" })}
            </button>
          </div>
        </form>
    </ModalSurface>
  );
}

export function EditDeckModal(props: { deck: DeckSummary; onClose: () => void }) {
  const intl = useIntl();
  const updateDeck = useStore((state) => state.updateDeck);
  const [name, setName] = useState(props.deck.name);
  const [url, setUrl] = useState(props.deck.fabraryUrl ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    const result = await updateDeck({
      id: props.deck.id,
      name: name.trim(),
      url: url.trim() || undefined,
      text: text.trim() || undefined,
    });
    setBusy(false);
    if (result.ok) {
      props.onClose();
      return;
    }
    setErrors(deckErrorMessages(
      result,
      intl.formatMessage({ id: "lobby.deck.error.updateFailed" }),
      {
        unknownCards: (cards) => intl.formatMessage({ id: "lobby.deck.error.unknownCards" }, { cards }),
        unimplementedCards: (cards) => intl.formatMessage(
          { id: "lobby.deck.error.unimplementedCards" },
          { cards },
        ),
      },
    ));
  };

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "lobby.deck.edit" })}
      className="deck-edit-modal"
      onClose={props.onClose}
    >
        <div className="deck-import-form">
          <label>
            <span>{intl.formatMessage({ id: "lobby.deck.name" })}</span>
            <input
              name="deck-name"
              value={name}
              autoComplete="off"
              data-modal-initial-focus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>{intl.formatMessage({ id: "lobby.deck.fabraryUrl" })}</span>
            <input
              name="fabrary-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://fabrary.net/decks/…"
              autoComplete="off"
              spellCheck={false}
            />
            <small className="deck-edit-source-note">
              {intl.formatMessage({ id: "lobby.deck.fabraryUrlHint" })}
            </small>
          </label>
          <label>
            <span>{intl.formatMessage({ id: "lobby.deck.replacementList" })}</span>
            <textarea
              name="replacement-deck-list"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={intl.formatMessage({ id: "lobby.deck.replacementPlaceholder" })}
              rows={7}
              spellCheck={false}
            />
          </label>
          {errors.length > 0 ? (
            <div className="import-errors" role="alert">
              {errors.map((error, index) => <p key={index}>{error}</p>)}
            </div>
          ) : null}
          <div className="deck-edit-actions">
            <button onClick={props.onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
            <button
              className="btn-primary"
              disabled={busy || !name.trim()}
              onClick={() => void submit()}
            >
              {intl.formatMessage({ id: busy ? "lobby.deck.saving" : "lobby.deck.saveChanges" })}
            </button>
          </div>
        </div>
    </ModalSurface>
  );
}

export function DeleteDeckModal(props: { deck: DeckSummary; onClose: () => void }) {
  const intl = useIntl();
  const deleteDeck = useStore((state) => state.deleteDeck);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteDeck(props.deck.id);
    setBusy(false);
    if (result.ok) {
      props.onClose();
    } else {
      setError(result.error);
    }
  };

  const close = () => {
    if (!busy) props.onClose();
  };

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "lobby.deck.delete" })}
      description={intl.formatMessage({ id: "lobby.deck.deletePrompt" }, { name: props.deck.name })}
      className="deck-delete-modal"
      onClose={close}
    >
      {error ? <p className="import-errors" role="alert">{error}</p> : null}
      <div className="deck-edit-actions">
        <button data-modal-initial-focus disabled={busy} onClick={close}>
          {intl.formatMessage({ id: "lobby.deck.keep" })}
        </button>
        <button className="btn-danger" disabled={busy} onClick={() => void remove()}>
          {intl.formatMessage({ id: busy ? "lobby.deck.deleting" : "lobby.deck.confirmDelete" })}
        </button>
      </div>
    </ModalSurface>
  );
}
