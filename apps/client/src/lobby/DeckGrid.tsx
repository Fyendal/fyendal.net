import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { preconsForFormat } from "@fyendal/cards/client";
import type { DeckSummary } from "@fyendal/protocol";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { preconPrepDeck } from "../prep/prepDeck.js";
import { FORMAT_LABELS } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";
import { deckErrorMessages } from "./deckErrors.js";
import { BotOpponentModal } from "./BotOpponentModal.js";
import { ModalSurface } from "../components/ModalSurface.js";

export type DeckCatalogTab = "mine" | "precons";
export type DeckLegalityFilter = "all" | "playable" | "attention";

export function filterAndSortDecks(
  decks: readonly DeckSummary[],
  options: {
    query: string;
    legality: DeckLegalityFilter;
    allowFutureCards: boolean;
    catalog: DeckCatalogTab;
  },
): DeckSummary[] {
  const query = options.query.trim().toLocaleLowerCase();
  return decks
    .filter((deck) => {
      const legal = deckIsLegalForRoom(deck, options.allowFutureCards);
      if (options.legality === "playable" && !legal) return false;
      if (options.legality === "attention" && legal) return false;
      return !query || deck.name.toLocaleLowerCase().includes(query) ||
        deck.heroName.toLocaleLowerCase().includes(query);
    })
    .slice()
    .sort((left, right) => options.catalog === "mine"
      ? right.updatedAt - left.updatedAt
      : left.name.localeCompare(right.name));
}

/** Shared precons as deck tiles (synthesized, no DB row). */
export function preconSummaries(format: ConstructedFormat, allowFutureCards = false): DeckSummary[] {
  return preconsForFormat(format, { allowFutureCards }).map((p) => preconPrepDeck(p.id)!);
}

/**
 * Everything a format offers as a playable tile: the user's own saved decks
 * first, followed by the hardcoded precons (free for everyone, not editable).
 */
export function deckChoicesFor(
  format: ConstructedFormat,
  decks: DeckSummary[],
  allowFutureCards = false,
): DeckSummary[] {
  const own = decks.filter((d) => d.format === format);
  return [...own, ...preconSummaries(format, allowFutureCards)];
}

export function deckIsLegalForRoom(deck: DeckSummary, allowFutureCards: boolean): boolean {
  return !deck.bannedCards?.length && (allowFutureCards || !deck.futureCards?.length);
}

export function deckLegalityReason(deck: DeckSummary, allowFutureCards: boolean): string | undefined {
  const blocked = [
    ...(deck.bannedCards ?? []),
    ...(allowFutureCards ? [] : (deck.futureCards ?? [])),
  ];
  return blocked.length > 0 ? `Illegal cards: ${blocked.join(", ")}` : undefined;
}

function FutureCardsToggle(props: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="toggle-switch deck-future-toggle">
      <span>Allow Future Cards</span>
      <input
        type="checkbox"
        role="switch"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true" />
    </label>
  );
}

function DeckLibraryFilters(props: {
  className: string;
  query: string;
  legality: DeckLegalityFilter;
  onQueryChange: (query: string) => void;
  onLegalityChange: (legality: DeckLegalityFilter) => void;
}) {
  return (
    <div className={props.className}>
      <label>
        <span>Search decks</span>
        <input
          type="search"
          name="deck-search"
          value={props.query}
          autoComplete="off"
          placeholder="Deck or hero name…"
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </label>
      <label>
        <span>Legality</span>
        <select
          value={props.legality}
          onChange={(event) => props.onLegalityChange(event.target.value as DeckLegalityFilter)}
        >
          <option value="all">All</option>
          <option value="playable">Playable</option>
          <option value="attention">Needs Attention</option>
        </select>
      </label>
    </div>
  );
}

/**
 * One deck tile: hero headshot + deck name. Shared by the constructed play
 * grid and the room-join picker. A headshot slug that misses on Fabrary
 * just hides the image — the tile stays usable.
 */
export function DeckTile(props: {
  deck: DeckSummary;
  selected?: boolean;
  blocked?: boolean;
  source?: "Saved" | "Preconstructed";
  onSelect: () => void;
}) {
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
        <span>{d.deckSize} cards · {props.source ?? "Saved"}</span>
      </span>
      {bannedCards.length > 0 ? (
        <span
          className="deck-legality-hint banned"
          title={`Banned cards:\n${bannedCards.join("\n")}`}
        >
          Includes banned {bannedCards.length === 1 ? "card" : "cards"}
        </span>
      ) : null}
      {futureCards.length > 0 ? (
        <span
          className="deck-legality-hint future"
          title={`Future cards:\n${futureCards.join("\n")}`}
        >
          Includes future {futureCards.length === 1 ? "card" : "cards"}
        </span>
      ) : null}
    </button>
  );
}

/**
 * Constructed play view: the format's decks as a tile grid. Selecting a tile
 * opens its play actions in a menu anchored directly beneath that deck.
 */
export function DeckGrid(props: {
  format: ConstructedFormat;
  deckId: string;
  onSelect: (id: string) => void;
  onFormatChange?: (format: ConstructedFormat) => void;
}) {
  const {
    decks,
    queuedFormat,
    queueJoin,
    queueLeave,
    createRoom,
    createBotRoom,
    allowFutureCards,
    setAllowFutureCards,
  } = useStore(
    useShallow((state) => ({
      decks: state.decks,
      queuedFormat: state.queuedFormat,
      queueJoin: state.queueJoin,
      queueLeave: state.queueLeave,
      createRoom: state.createRoom,
      createBotRoom: state.createBotRoom,
      allowFutureCards: state.allowFutureCards,
      setAllowFutureCards: state.setAllowFutureCards,
    })),
  );
  const precons = preconSummaries(props.format, allowFutureCards[props.format]);
  const own = decks.filter((d) => d.format === props.format);
  const queued = queuedFormat === props.format;
  const [editingDeck, setEditingDeck] = useState<DeckSummary | null>(null);
  const [importing, setImporting] = useState(false);
  const [botDeckId, setBotDeckId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<DeckCatalogTab>("mine");
  const [query, setQuery] = useState("");
  const [legality, setLegality] = useState<DeckLegalityFilter>("all");
  const deckMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.deckId) return;

    const closeMenuOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !deckMenuRef.current?.contains(event.target)) {
        props.onSelect("");
      }
    };

    document.addEventListener("click", closeMenuOnOutsideClick, true);
    return () => document.removeEventListener("click", closeMenuOnOutsideClick, true);
  }, [props.deckId, props.onSelect]);

  const visibleDecks = filterAndSortDecks(
    catalog === "mine" ? own : precons,
    {
      query,
      legality,
      allowFutureCards: allowFutureCards[props.format],
      catalog,
    },
  );

  const tiles = (list: DeckSummary[], editable: boolean) => (
    <div className={`deck-grid${editable ? " deck-grid-saved" : " deck-grid-precons"}`}>
      {list.map((d) => {
        const selected = d.id === props.deckId;
        const allowFuture = allowFutureCards[props.format];
        const illegal = !deckIsLegalForRoom(d, allowFuture);
        const legalityReason = deckLegalityReason(d, allowFuture);
        return (
          <div
            className={`deck-choice${selected ? " selected" : ""}`}
            key={d.id}
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onSelect("");
            }}
          >
            <DeckTile
              deck={d}
              selected={selected}
              source={editable ? "Saved" : "Preconstructed"}
              onSelect={() => props.onSelect(selected ? "" : d.id)}
            />
            {selected ? (
              <div className="deck-menu-backdrop" onClick={() => props.onSelect("")}>
              <div
                ref={deckMenuRef}
                className="deck-menu"
                role="group"
                aria-label={`${d.name} actions`}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="deck-menu-close"
                  aria-label={`Close ${d.name} actions`}
                  onClick={() => props.onSelect("")}
                />
                {queued ? (
                  <button className="btn-primary" onClick={queueLeave}>
                    Cancel Match Search
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={illegal}
                    onClick={() => queueJoin(props.format, { deckId: d.id })}
                  >
                    Find Match
                  </button>
                )}
                <button
                  className="btn-private-room"
                  disabled={illegal}
                  onClick={() => createRoom(props.format, { deckId: d.id })}
                >
                  Invite Friend
                </button>
                <button
                  className="btn-bot"
                  disabled={illegal}
                  onClick={() => {
                    props.onSelect("");
                    setBotDeckId(d.id);
                  }}
                >
                  Play vs Bot
                </button>
                {editable ? (
                  <button onClick={() => {
                    props.onSelect("");
                    setEditingDeck(d);
                  }}>
                    Edit Deck
                  </button>
                ) : null}
                {illegal ? (
                  <p className="deck-menu-blocked" role="status">
                    {legalityReason}. Update the deck or card-pool setting to play it.
                  </p>
                ) : null}
              </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="panel deck-library-panel">
      {props.onFormatChange ? (
        <label className="mobile-deck-format-picker">
          <span>Format</span>
          <select
            aria-label="Deck format"
            value={props.format}
            onChange={(event) => props.onFormatChange?.(event.target.value as ConstructedFormat)}
          >
            <option value="cc">Classic Constructed</option>
            <option value="silver-age">Silver Age</option>
          </select>
        </label>
      ) : null}
      <div className="deck-panel-heading">
        <h2 className="panel-title">
          {props.format === "silver-age" ? "Silver Age Decks" : `${FORMAT_LABELS[props.format]} Decks`}
        </h2>
        <div className="deck-panel-actions">
          <FutureCardsToggle
            checked={allowFutureCards[props.format]}
            disabled={queued}
            onChange={(checked) => setAllowFutureCards(props.format, checked)}
          />
          <button className="btn-primary deck-import-action" onClick={() => setImporting(true)}>
            Import Deck
          </button>
        </div>
      </div>

      <div className="deck-catalog-tabs" role="tablist" aria-label="Deck catalog">
        <button
          type="button"
          role="tab"
          aria-selected={catalog === "mine"}
          className={catalog === "mine" ? "selected" : ""}
          onClick={() => {
            setCatalog("mine");
            props.onSelect("");
          }}
        >
          My Decks <span>{own.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={catalog === "precons"}
          className={catalog === "precons" ? "selected" : ""}
          onClick={() => {
            setCatalog("precons");
            props.onSelect("");
          }}
        >
          Preconstructed <span>{precons.length}</span>
        </button>
      </div>

      <div className="mobile-deck-toolbar">
        <button className="btn-primary" onClick={() => setImporting(true)}>Import</button>
        <details className="mobile-deck-options">
          <summary>Search &amp; Options</summary>
          <div className="mobile-deck-options-panel">
            <FutureCardsToggle
              checked={allowFutureCards[props.format]}
              disabled={queued}
              onChange={(checked) => setAllowFutureCards(props.format, checked)}
            />
            <DeckLibraryFilters
              className="deck-library-tools mobile-deck-library-tools"
              query={query}
              legality={legality}
              onQueryChange={setQuery}
              onLegalityChange={setLegality}
            />
          </div>
        </details>
      </div>

      <DeckLibraryFilters
        className="deck-library-tools desktop-deck-library-tools"
        query={query}
        legality={legality}
        onQueryChange={setQuery}
        onLegalityChange={setLegality}
      />

      {visibleDecks.length > 0 ? tiles(visibleDecks, catalog === "mine") : (
        <div className="deck-library-empty">
          <h3>{catalog === "mine" && own.length === 0 ? "No saved decks yet" : "No decks match these filters"}</h3>
          <p>{catalog === "mine" && own.length === 0
            ? "Import a Fabrary link or full deck list to start playing."
            : "Clear the search or choose a different legality filter."}</p>
          {catalog === "mine" && own.length === 0 ? (
            <button className="btn-primary" onClick={() => setImporting(true)}>Import Your First Deck</button>
          ) : null}
        </div>
      )}

      {editingDeck ? (
        <EditDeckModal deck={editingDeck} onClose={() => setEditingDeck(null)} />
      ) : null}
      {importing ? (
        <ImportDeckModal format={props.format} onClose={() => setImporting(false)} />
      ) : null}
      {botDeckId ? (
        <BotOpponentModal
          format={props.format}
          onSelect={(bot) => {
            createBotRoom(props.format, botDeckId, bot);
            setBotDeckId(null);
          }}
          onClose={() => setBotDeckId(null)}
        />
      ) : null}
    </div>
  );
}

export function ImportDeckModal(props: {
  format: ConstructedFormat;
  onClose: () => void;
  onImported?: () => void;
}) {
  const importDeck = useStore((state) => state.importDeck);
  const [source, setSource] = useState<"url" | "text">("url");
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
      format: props.format,
      ...(source === "url" ? { url: value } : { text: value }),
    });
    setBusy(false);
    if (result.ok) {
      props.onClose();
      props.onImported?.();
      return;
    }
    setErrors(deckErrorMessages(result, "import failed"));
  };

  return (
    <ModalSurface title="Import Deck" className="deck-import-modal" onClose={props.onClose}>
        <div className="deck-import-source" role="group" aria-label="Deck source">
          <button
            className={source === "url" ? "selected" : ""}
            aria-pressed={source === "url"}
            onClick={() => setSource("url")}
          >
            Fabrary link
          </button>
          <button
            className={source === "text" ? "selected" : ""}
            aria-pressed={source === "text"}
            onClick={() => setSource("text")}
          >
            Paste deck list
          </button>
        </div>
        <form
          className="deck-import-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {source === "url" ? (
            <label className="deck-import-primary">
              <span>Fabrary link</span>
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
              <span>Deck list</span>
              <textarea
                name="deck-list"
                value={decklist}
                onChange={(event) => setDecklist(event.target.value)}
                placeholder={"Hero: …\nWeapons: …\nDeck cards\n3x Card Name (red)\nSideboard cards\n…"}
                rows={12}
                spellCheck={false}
                data-modal-initial-focus
              />
            </label>
          )}
          <label className="deck-import-name">
            <span>Name (optional)</span>
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
            <button type="button" onClick={props.onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !value}>
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </form>
    </ModalSurface>
  );
}

function EditDeckModal(props: { deck: DeckSummary; onClose: () => void }) {
  const { updateDeck, deleteDeck } = useStore(useShallow((state) => ({
    updateDeck: state.updateDeck,
    deleteDeck: state.deleteDeck,
  })));
  const [name, setName] = useState(props.deck.name);
  const [url, setUrl] = useState(props.deck.fabraryUrl ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
    setErrors(deckErrorMessages(result, "update failed"));
  };

  const remove = async () => {
    setBusy(true);
    setErrors([]);
    const result = await deleteDeck(props.deck.id);
    setBusy(false);
    if (result.ok) {
      props.onClose();
      return;
    }
    setErrors([result.error]);
  };

  return (
    <ModalSurface title="Edit Deck" className="deck-edit-modal" onClose={props.onClose}>
        <div className="deck-import-form">
          <label>
            <span>Deck name</span>
            <input
              name="deck-name"
              value={name}
              autoComplete="off"
              data-modal-initial-focus
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            <span>Fabrary deck URL</span>
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
              Changing this URL reimports and revalidates the Fabrary deck.
            </small>
          </label>
          <label>
            <span>Replacement decklist</span>
            <textarea
              name="replacement-deck-list"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Leave blank to keep the current card list"
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
            {confirmingDelete ? (
              <>
                <button disabled={busy} onClick={() => setConfirmingDelete(false)}>Keep Deck</button>
                <button className="btn-danger" disabled={busy} onClick={() => void remove()}>
                  {busy ? "Deleting…" : "Confirm Delete"}
                </button>
              </>
            ) : (
              <>
                <button className="btn-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                  Delete Deck
                </button>
                <button onClick={props.onClose}>Cancel</button>
                <button
                  className="btn-primary"
                  disabled={busy || !name.trim()}
                  onClick={() => void submit()}
                >
                  {busy ? "Saving…" : "Save Changes"}
                </button>
              </>
            )}
          </div>
        </div>
    </ModalSurface>
  );
}
