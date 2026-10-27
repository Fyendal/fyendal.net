import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { cardData } from "@fyendal/cards/client";
import type { DeckSummary } from "@fyendal/protocol";
import type { DeckArt, DeckPool } from "@fyendal/shared";
import { useStore } from "../store.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { CardArtVariants, cardArtOptions, shownCardArt } from "../components/CardArtVariants.js";
import { CardArtwork } from "../game/Card.js";
import { useCardArtCatalog, type CardArtCatalog } from "../game/cardArtCatalog.js";

type ArtFilter = "all" | "alternatives" | "picked";
const FILTERS: readonly ArtFilter[] = ["all", "alternatives", "picked"];
type ArtGroup = "arena" | "red" | "yellow" | "blue" | "other";
/** Display order, with each group's pitch marker. */
const GROUP_PITCH: Record<ArtGroup, number> = { arena: 0, red: 1, yellow: 2, blue: 3, other: 0 };
const GROUPS = Object.keys(GROUP_PITCH) as ArtGroup[];
const PITCH_GROUPS: Record<number, ArtGroup> = { 1: "red", 2: "yellow", 3: "blue" };

function groupOf(pool: DeckPool, cardId: string): ArtGroup {
  if (cardId === pool.heroId || pool.weaponIds.includes(cardId) || pool.equipmentPool.includes(cardId)) {
    return "arena";
  }
  return PITCH_GROUPS[cardData[cardId]?.pitch ?? 0] ?? "other";
}

/** Each distinct card in a saved deck, with the printing it shows. */
export function DeckArtModal(props: { deck: DeckSummary; onClose: () => void }) {
  const intl = useIntl();
  const { loadDeckDetail, setDeckArt } = useStore(useShallow((state) => ({
    loadDeckDetail: state.loadDeckDetail,
    setDeckArt: state.setDeckArt,
  })));
  const catalog = useCardArtCatalog();
  const [pool, setPool] = useState<DeckPool | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [art, setArt] = useState<DeckArt>(props.deck.art);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArtFilter>("all");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const checkboxId = useId();

  useEffect(() => {
    let active = true;
    void loadDeckDetail(props.deck.id).then((result) => {
      if (!active) return;
      if (result.ok) setPool(result.deck.decklist);
      else setLoadError(result.error);
    });
    return () => { active = false; };
  }, [loadDeckDetail, props.deck.id]);

  const dirty = art.highestRarity !== props.deck.art.highestRarity
    || JSON.stringify(art.picks) !== JSON.stringify(props.deck.art.picks);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setSaveError(null);
    const result = await setDeckArt(props.deck.id, art);
    setBusy(false);
    if (result.ok) props.onClose();
    else setSaveError(result.error);
  };

  return (
    <ModalSurface
      title={intl.formatMessage({ id: "lobby.deck.art.title" })}
      className="deck-art-modal"
      onClose={props.onClose}
    >
      <label className="card-art-checkbox" htmlFor={checkboxId}>
        <input
          id={checkboxId}
          type="checkbox"
          checked={art.highestRarity}
          onChange={(event) => setArt({ ...art, highestRarity: event.target.checked })}
        />
        <span>{intl.formatMessage({ id: "lobby.deck.art.highestRarity" })}</span>
        <small>{intl.formatMessage({ id: "lobby.deck.art.highestRarityHint" })}</small>
      </label>
      <div className="deck-art-toolbar">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={intl.formatMessage({ id: "lobby.deck.art.search" })}
          aria-label={intl.formatMessage({ id: "lobby.deck.art.search" })}
        />
        <div className="deck-art-filters" role="group" aria-label={intl.formatMessage({ id: "lobby.deck.art.filter" })}>
          {FILTERS.map((value) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {intl.formatMessage({ id: `lobby.deck.art.filter.${value}` })}
            </button>
          ))}
        </div>
      </div>
      <div className="deck-art-body">
        {loadError ? (
          <p className="import-errors" role="alert">
            {intl.formatMessage({ id: "lobby.deck.art.loadFailed" }, { error: loadError })}
          </p>
        ) : !pool || !catalog ? (
          <div className="deck-art-loading" role="status">
            <span className="deck-art-spinner" aria-hidden="true" />
            <span className="deck-art-loading-label">{intl.formatMessage({ id: "lobby.deck.art.loading" })}</span>
          </div>
        ) : (
          <DeckArtGroups
            catalog={catalog}
            pool={pool}
            art={art}
            open={open}
            filter={filter}
            query={query.trim().toLowerCase()}
            onOpen={setOpen}
            onChange={setArt}
          />
        )}
      </div>
      {saveError ? (
        <p className="import-errors" role="alert">
          {intl.formatMessage({ id: "lobby.deck.art.saveFailed" }, { error: saveError })}
        </p>
      ) : null}
      <div className="deck-edit-actions">
        {dirty ? <span className="deck-art-dirty">{intl.formatMessage({ id: "lobby.deck.art.unsaved" })}</span> : null}
        <button type="button" onClick={props.onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
        <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => void save()}>
          {intl.formatMessage({ id: busy ? "lobby.deck.saving" : "lobby.deck.saveChanges" })}
        </button>
      </div>
    </ModalSurface>
  );
}

function DeckArtGroups(props: {
  catalog: CardArtCatalog;
  pool: DeckPool;
  art: DeckArt;
  open: string | null;
  filter: ArtFilter;
  query: string;
  onOpen: (cardId: string | null) => void;
  onChange: (art: DeckArt) => void;
}) {
  const intl = useIntl();
  const { catalog, pool, art } = props;
  const cards = catalog.deckPoolCardIds(pool)
    .filter((cardId) => cardData[cardId])
    .sort((a, b) => cardData[a]!.name.localeCompare(cardData[b]!.name));
  const choices = (cardId: string) => cardArtOptions(catalog, cardId).length;
  const visible = cards.filter((cardId) =>
    (props.filter === "all"
      || props.filter === "alternatives" && choices(cardId) > 1
      || props.filter === "picked" && art.picks[cardId] !== undefined)
    && (!props.query || cardData[cardId]!.name.toLowerCase().includes(props.query)));

  if (visible.length === 0) {
    return <p className="muted">{intl.formatMessage({ id: "lobby.deck.art.empty" })}</p>;
  }
  return GROUPS.map((group) => {
    const ids = visible.filter((cardId) => groupOf(pool, cardId) === group);
    if (ids.length === 0) return null;
    return (
      <section key={group} className="deck-art-group">
        <h3 className="deck-art-group-title">
          <i className={`prep-pitch prep-pitch-${GROUP_PITCH[group]}`} aria-hidden="true" />
          {intl.formatMessage({ id: `lobby.deck.art.group.${group}` })}
        </h3>
        <div className="deck-art-grid">
          {ids.map((cardId) => {
            const name = cardData[cardId]!.name;
            const count = choices(cardId);
            const single = count < 2;
            const expanded = props.open === cardId;
            return (
              <Fragment key={cardId}>
                <button
                  type="button"
                  className="deck-art-tile"
                  data-art-tile={cardId}
                  disabled={single}
                  aria-expanded={single ? undefined : expanded}
                  aria-label={intl.formatMessage(
                    { id: single ? "lobby.deck.art.onlyOne" : "lobby.deck.art.chooseFor" },
                    { card: name },
                  )}
                  onClick={() => props.onOpen(expanded ? null : cardId)}
                >
                  <span className="deck-art-tile-frame">
                    <CardArtwork cardId={cardId} artImage={shownCardArt(catalog, cardId, art)} alt="" />
                    {single ? null : <span className="deck-art-tile-count">{count}</span>}
                  </span>
                  <span className="deck-art-tile-name">{name}</span>
                  {art.picks[cardId] !== undefined ? (
                    <span className="card-art-tag picked">{intl.formatMessage({ id: "lobby.deck.art.picked" })}</span>
                  ) : null}
                </button>
                {expanded ? (
                  <DeckArtDetail cardId={cardId}>
                    <CardArtVariants catalog={catalog} cardId={cardId} art={art} onChange={props.onChange} />
                  </DeckArtDetail>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      </section>
    );
  });
}

/** The open card's printings, on the row below it with a caret pointing up at it. */
function DeckArtDetail({ cardId, children }: { cardId: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState<number | null>(null);

  useLayoutEffect(() => {
    const detail = ref.current;
    const grid = detail?.parentElement;
    const tile = grid?.querySelector<HTMLElement>(`[data-art-tile="${CSS.escape(cardId)}"]`);
    if (!detail || !grid || !tile) return;
    const place = () => {
      const target = tile.getBoundingClientRect();
      setCaret(target.left + target.width / 2 - detail.getBoundingClientRect().left);
    };
    place();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    detail.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    const observer = new ResizeObserver(place);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [cardId]);

  return (
    <div
      ref={ref}
      className={`deck-art-detail${caret === null ? "" : " has-caret"}`}
      style={caret === null ? undefined : { "--caret-x": `${caret}px` } as CSSProperties}
    >
      {children}
    </div>
  );
}
