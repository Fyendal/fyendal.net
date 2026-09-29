import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { DeckSummary } from "@fyendal/protocol";
import { CONSTRUCTED_FORMATS, type ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { FormatBadge, formatSelectLabel } from "./FormatBadge.js";
import {
  DeckTile,
  DeleteDeckModal,
  EditDeckModal,
  ImportDeckModal,
  filterAndSortDecks,
  type DeckLegalityFilter,
} from "./DeckGrid.js";

export type DeckFormatFilter = "all" | ConstructedFormat;

/** Saved decks from both constructed formats, with management actions only. */
export function DeckLibrary(props: {
  formatFilter: DeckFormatFilter;
  onFormatFilterChange: (format: DeckFormatFilter) => void;
}) {
  const intl = useIntl();
  const { decks, decksLoading, cardPoolModes } = useStore(useShallow((state) => ({
    decks: state.decks,
    decksLoading: state.decksLoading,
    cardPoolModes: state.cardPoolModes,
  })));
  const [query, setQuery] = useState("");
  const [legality, setLegality] = useState<DeckLegalityFilter>("all");
  const [importing, setImporting] = useState(false);
  const [editingDeck, setEditingDeck] = useState<DeckSummary | null>(null);
  const [deletingDeck, setDeletingDeck] = useState<DeckSummary | null>(null);

  const visibleDecks = CONSTRUCTED_FORMATS
    .filter((format) => props.formatFilter === "all" || props.formatFilter === format)
    .flatMap((format) => filterAndSortDecks(
      decks.filter((deck) => deck.format === format),
      { query, legality, cardPoolMode: cardPoolModes[format] },
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const openImport = () => setImporting(true);

  return (
    <div className="panel deck-library-panel">
      <div className="deck-panel-heading">
        <h2 className="panel-title">{intl.formatMessage({ id: "lobby.nav.decks" })}</h2>
        <button className="btn-primary deck-import-action" onClick={openImport}>
          {intl.formatMessage({ id: "lobby.deck.createImport" })}
        </button>
      </div>

      <div className="deck-library-tools deck-library-management-tools">
        <label>
          <span>{intl.formatMessage({ id: "lobby.deck.search" })}</span>
          <input
            type="search"
            name="deck-search"
            value={query}
            autoComplete="off"
            placeholder={intl.formatMessage({ id: "lobby.deck.searchPlaceholder" })}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label>
          <span>{intl.formatMessage({ id: "common.format" })}</span>
          <select
            value={props.formatFilter}
            onChange={(event) => props.onFormatFilterChange(event.target.value as DeckFormatFilter)}
          >
            <option value="all">{intl.formatMessage({ id: "lobby.deck.allFormats" })}</option>
            {CONSTRUCTED_FORMATS.map((format) => (
              <option key={format} value={format}>{formatSelectLabel(intl, format)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{intl.formatMessage({ id: "lobby.deck.legality" })}</span>
          <select
            value={legality}
            onChange={(event) => setLegality(event.target.value as DeckLegalityFilter)}
          >
            <option value="all">{intl.formatMessage({ id: "common.all" })}</option>
            <option value="playable">{intl.formatMessage({ id: "lobby.deck.playable" })}</option>
            <option value="attention">{intl.formatMessage({ id: "lobby.deck.needsAttention" })}</option>
          </select>
        </label>
      </div>

      {decksLoading ? (
        <p className="muted" role="status">{intl.formatMessage({ id: "lobby.loadingDecks" })}</p>
      ) : visibleDecks.length > 0 ? (
        <div className="deck-grid deck-grid-saved">
          {visibleDecks.map((deck) => (
            <div className="deck-library-card" key={deck.id}>
              <DeckTile deck={deck} source="saved" onSelect={() => setEditingDeck(deck)} />
              <div className="deck-library-card-actions">
                <FormatBadge format={deck.format} />
                <div>
                  <button onClick={() => setEditingDeck(deck)}>
                    {intl.formatMessage({ id: "lobby.deck.edit" })}
                  </button>
                  <button className="deck-library-delete" onClick={() => setDeletingDeck(deck)}>
                    {intl.formatMessage({ id: "lobby.deck.delete" })}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="deck-library-empty">
          <h3>{intl.formatMessage({ id: decks.length === 0 ? "lobby.deck.emptySaved" : "lobby.deck.emptyFiltered" })}</h3>
          <p>{intl.formatMessage({ id: decks.length === 0 ? "lobby.deck.emptySavedBody" : "lobby.deck.emptyFilteredBody" })}</p>
          {decks.length === 0 ? (
            <button className="btn-primary" onClick={openImport}>
              {intl.formatMessage({ id: "lobby.deck.importFirst" })}
            </button>
          ) : null}
        </div>
      )}

      {importing ? (
        <ImportDeckModal
          format={props.formatFilter === "all" ? "cc" : props.formatFilter}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {editingDeck ? <EditDeckModal deck={editingDeck} onClose={() => setEditingDeck(null)} /> : null}
      {deletingDeck ? <DeleteDeckModal deck={deletingDeck} onClose={() => setDeletingDeck(null)} /> : null}
    </div>
  );
}
