import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { preconsForFormat } from "@fyendal/cards/client";
import type { DeckSummary } from "@fyendal/protocol";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { preconPrepDeck } from "../prep/prepDeck.js";
import { formatLabel, formatSelectLabel } from "./FormatBadge.js";
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
  const intl = useIntl();
  return (
    <label className="toggle-switch deck-future-toggle">
      <span>{intl.formatMessage({ id: "lobby.cardPool.allowFuture" })}</span>
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
  const intl = useIntl();
  return (
    <div className={props.className}>
      <label>
        <span>{intl.formatMessage({ id: "lobby.deck.search" })}</span>
        <input
          type="search"
          name="deck-search"
          value={props.query}
          autoComplete="off"
          placeholder={intl.formatMessage({ id: "lobby.deck.searchPlaceholder" })}
          onChange={(event) => props.onQueryChange(event.target.value)}
        />
      </label>
      <label>
        <span>{intl.formatMessage({ id: "lobby.deck.legality" })}</span>
        <select
          value={props.legality}
          onChange={(event) => props.onLegalityChange(event.target.value as DeckLegalityFilter)}
        >
          <option value="all">{intl.formatMessage({ id: "common.all" })}</option>
          <option value="playable">{intl.formatMessage({ id: "lobby.deck.playable" })}</option>
          <option value="attention">{intl.formatMessage({ id: "lobby.deck.needsAttention" })}</option>
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
  const intl = useIntl();
  const selectedDeckId = props.deckId;
  const closeDeckMenu = props.onSelect;
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
    if (!selectedDeckId) return;

    const closeMenuOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !deckMenuRef.current?.contains(event.target)) {
        closeDeckMenu("");
      }
    };

    document.addEventListener("click", closeMenuOnOutsideClick, true);
    return () => document.removeEventListener("click", closeMenuOnOutsideClick, true);
  }, [closeDeckMenu, selectedDeckId]);

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
        const blockedCards = [
          ...(d.bannedCards ?? []),
          ...(allowFuture ? [] : (d.futureCards ?? [])),
        ];
        const legalityReason = blockedCards.length > 0
          ? intl.formatMessage({ id: "lobby.deck.illegalCards" }, { cards: blockedCards.join(", ") })
          : undefined;
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
              source={editable ? "saved" : "preconstructed"}
              onSelect={() => props.onSelect(selected ? "" : d.id)}
            />
            {selected ? (
              <div className="deck-menu-backdrop" onClick={() => props.onSelect("")}>
              <div
                ref={deckMenuRef}
                className="deck-menu"
                role="group"
                aria-label={intl.formatMessage({ id: "lobby.deck.actions" }, { name: d.name })}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="deck-menu-close"
                  aria-label={intl.formatMessage({ id: "lobby.deck.closeActions" }, { name: d.name })}
                  onClick={() => props.onSelect("")}
                />
                {queued ? (
                  <button className="btn-primary" onClick={queueLeave}>
                    {intl.formatMessage({ id: "lobby.action.cancelSearch" })}
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={illegal}
                    onClick={() => queueJoin(props.format, { deckId: d.id })}
                  >
                    {intl.formatMessage({ id: "lobby.action.findMatch" })}
                  </button>
                )}
                <button
                  className="btn-private-room"
                  disabled={illegal}
                  onClick={() => createRoom(props.format, { deckId: d.id })}
                >
                  {intl.formatMessage({ id: "lobby.action.inviteFriend" })}
                </button>
                <button
                  className="btn-bot"
                  disabled={illegal}
                  onClick={() => {
                    props.onSelect("");
                    setBotDeckId(d.id);
                  }}
                >
                  {intl.formatMessage({ id: "lobby.action.playBot" })}
                </button>
                {editable ? (
                  <button onClick={() => {
                    props.onSelect("");
                    setEditingDeck(d);
                  }}>
                    {intl.formatMessage({ id: "lobby.deck.edit" })}
                  </button>
                ) : null}
                {illegal ? (
                  <p className="deck-menu-blocked" role="status">
                    {intl.formatMessage(
                      { id: "lobby.deck.blocked" },
                      { reason: legalityReason },
                    )}
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
          <span>{intl.formatMessage({ id: "common.format" })}</span>
          <select
            aria-label={intl.formatMessage({ id: "lobby.deck.format" })}
            value={props.format}
            onChange={(event) => props.onFormatChange?.(event.target.value as ConstructedFormat)}
          >
            <option value="cc">{formatSelectLabel(intl, "cc")}</option>
            <option value="silver-age">{formatSelectLabel(intl, "silver-age")}</option>
          </select>
        </label>
      ) : null}
      <div className="deck-panel-heading">
        <h2 className="panel-title">
          {intl.formatMessage(
            { id: "lobby.deck.formatDecks" },
            { format: formatLabel(intl, props.format) },
          )}
        </h2>
        <div className="deck-panel-actions">
          <FutureCardsToggle
            checked={allowFutureCards[props.format]}
            disabled={queued}
            onChange={(checked) => setAllowFutureCards(props.format, checked)}
          />
          <button className="btn-primary deck-import-action" onClick={() => setImporting(true)}>
            {intl.formatMessage({ id: "lobby.deck.import" })}
          </button>
        </div>
      </div>

      <div
        className="deck-catalog-tabs"
        role="tablist"
        aria-label={intl.formatMessage({ id: "lobby.deck.catalog" })}
      >
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
          {intl.formatMessage({ id: "lobby.deck.mine" })} <span>{own.length}</span>
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
          {intl.formatMessage({ id: "lobby.deck.preconstructed" })} <span>{precons.length}</span>
        </button>
      </div>

      <div className="mobile-deck-toolbar">
        <button className="btn-primary" onClick={() => setImporting(true)}>
          {intl.formatMessage({ id: "common.import" })}
        </button>
        <details className="mobile-deck-options">
          <summary>{intl.formatMessage({ id: "lobby.deck.searchOptions" })}</summary>
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
          <h3>{intl.formatMessage({
            id: catalog === "mine" && own.length === 0
              ? "lobby.deck.emptySaved"
              : "lobby.deck.emptyFiltered",
          })}</h3>
          <p>{intl.formatMessage({
            id: catalog === "mine" && own.length === 0
              ? "lobby.deck.emptySavedBody"
              : "lobby.deck.emptyFilteredBody",
          })}</p>
          {catalog === "mine" && own.length === 0 ? (
            <button className="btn-primary" onClick={() => setImporting(true)}>
              {intl.formatMessage({ id: "lobby.deck.importFirst" })}
            </button>
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
  const intl = useIntl();
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
      title={intl.formatMessage({ id: "lobby.deck.import" })}
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

function EditDeckModal(props: { deck: DeckSummary; onClose: () => void }) {
  const intl = useIntl();
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
            {confirmingDelete ? (
              <>
                <button disabled={busy} onClick={() => setConfirmingDelete(false)}>
                  {intl.formatMessage({ id: "lobby.deck.keep" })}
                </button>
                <button className="btn-danger" disabled={busy} onClick={() => void remove()}>
                  {intl.formatMessage({ id: busy ? "lobby.deck.deleting" : "lobby.deck.confirmDelete" })}
                </button>
              </>
            ) : (
              <>
                <button className="btn-danger" disabled={busy} onClick={() => setConfirmingDelete(true)}>
                  {intl.formatMessage({ id: "lobby.deck.delete" })}
                </button>
                <button onClick={props.onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
                <button
                  className="btn-primary"
                  disabled={busy || !name.trim()}
                  onClick={() => void submit()}
                >
                  {intl.formatMessage({ id: busy ? "lobby.deck.saving" : "lobby.deck.saveChanges" })}
                </button>
              </>
            )}
          </div>
        </div>
    </ModalSurface>
  );
}
