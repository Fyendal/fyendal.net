import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { DeckSummary } from "@fyendal/protocol";
import { CONSTRUCTED_FORMATS, type ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { FormatBadge, formatSelectLabel } from "./FormatBadge.js";
import { ModalSurface } from "../components/ModalSurface.js";
import {
  DeckTile,
  DeleteDeckModal,
  EditDeckModal,
  ImportDeckModal,
  filterAndSortDecks,
  type DeckLegalityFilter,
} from "./DeckGrid.js";

export type DeckFormatFilter = "all" | ConstructedFormat;

function fabraryDeckHref(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    const match = /^\/decks\/([0-9A-HJKMNP-TV-Z]{26})\/?$/i.exec(url.pathname);
    if (url.protocol !== "https:" || !["fabrary.net", "www.fabrary.net"].includes(url.hostname)
      || url.port || url.username || url.password || !match) return undefined;
    return `https://fabrary.net/decks/${match[1]!.toUpperCase()}`;
  } catch {
    return undefined;
  }
}

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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeletingDecks, setBulkDeletingDecks] = useState<DeckSummary[] | null>(null);

  const visibleDecks = CONSTRUCTED_FORMATS
    .filter((format) => props.formatFilter === "all" || props.formatFilter === format)
    .flatMap((format) => filterAndSortDecks(
      decks.filter((deck) => deck.format === format),
      { query, legality, cardPoolMode: cardPoolModes[format] },
    ))
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const openImport = () => setImporting(true);
  const selectedDecks = decks.filter((deck) => selectedIds.has(deck.id));
  const toggleSelected = (id: string) => setSelectedIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  return (
    <div className="panel deck-library-panel">
      <div className="deck-panel-heading">
        <h2 className="panel-title">{intl.formatMessage({ id: "lobby.nav.decks" })}</h2>
        <button className="btn-primary lobby-panel-action" onClick={openImport}>
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

      {selectedDecks.length > 0 ? (
        <div className="deck-bulk-actions" role="group" aria-label={intl.formatMessage({ id: "lobby.deck.selectionActions" })}>
          <span role="status">{intl.formatMessage({ id: "lobby.deck.selectedCount" }, { count: selectedDecks.length })}</span>
          <button onClick={() => setSelectedIds(new Set())}>
            {intl.formatMessage({ id: "lobby.deck.clearSelection" })}
          </button>
          <button className="btn-danger" onClick={() => setBulkDeletingDecks(selectedDecks)}>
            {intl.formatMessage({ id: "lobby.deck.deleteSelected" })}
          </button>
        </div>
      ) : null}

      {decksLoading ? (
        <p className="muted" role="status">{intl.formatMessage({ id: "lobby.loadingDecks" })}</p>
      ) : visibleDecks.length > 0 ? (
        <div className="deck-grid deck-grid-saved">
          {visibleDecks.map((deck) => (
            <div className="deck-library-card" key={deck.id}>
              <label className="deck-library-select">
                <input type="checkbox" checked={selectedIds.has(deck.id)}
                  aria-label={intl.formatMessage({ id: "lobby.deck.selectNamed" }, { name: deck.name })}
                  onChange={() => toggleSelected(deck.id)} />
              </label>
              <DeckTile deck={deck} source="saved" href={fabraryDeckHref(deck.fabraryUrl)}
                onSelect={() => setEditingDeck(deck)} />
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
      {bulkDeletingDecks ? (
        <DeleteSelectedDecksModal decks={bulkDeletingDecks}
          onDeleted={(id) => setSelectedIds((current) => {
            const next = new Set(current);
            next.delete(id);
            return next;
          })}
          onClose={() => setBulkDeletingDecks(null)} />
      ) : null}
    </div>
  );
}

function DeleteSelectedDecksModal(props: {
  decks: DeckSummary[];
  onDeleted: (id: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const deleteDeck = useStore((state) => state.deleteDeck);
  const [remaining, setRemaining] = useState(props.decks);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setErrors([]);
    const failed: DeckSummary[] = [];
    const nextErrors: string[] = [];
    for (const deck of remaining) {
      const result = await deleteDeck(deck.id);
      if (result.ok) props.onDeleted(deck.id);
      else {
        failed.push(deck);
        nextErrors.push(`${deck.name}: ${result.error}`);
      }
    }
    setRemaining(failed);
    setBusy(false);
    if (failed.length === 0) props.onClose();
    else setErrors(nextErrors);
  };
  const close = () => { if (!busy) props.onClose(); };

  return (
    <ModalSurface title={intl.formatMessage({ id: "lobby.deck.deleteSelected" })}
      description={intl.formatMessage({ id: "lobby.deck.deleteSelectedPrompt" }, { count: remaining.length })}
      className="deck-delete-modal" onClose={close}>
      <ul className="deck-bulk-delete-list">
        {remaining.map((deck) => <li key={deck.id}>{deck.name}</li>)}
      </ul>
      {errors.length > 0 ? (
        <div className="import-errors" role="alert">
          {errors.map((error, index) => <p key={index}>{error}</p>)}
        </div>
      ) : null}
      <div className="deck-edit-actions">
        <button data-modal-initial-focus disabled={busy} onClick={close}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
        <button className="btn-danger" disabled={busy} onClick={() => void remove()}>
          {intl.formatMessage({ id: busy ? "lobby.deck.deleting" : "lobby.deck.confirmDelete" })}
        </button>
      </div>
    </ModalSurface>
  );
}
