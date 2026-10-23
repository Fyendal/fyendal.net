import { memo, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import type { CardData, DeckPool, EquipmentSlot } from "@fyendal/shared";
import { cardData, equipmentFitsSlot } from "@fyendal/cards/client";
import {
  CardArtwork,
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
} from "../game/Card.js";
import { CardSortToggle, sortCards } from "../game/CardSort.js";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon } from "../components/UiIcon.js";
import { EQUIPMENT_SLOTS } from "../domain.js";
import { loadPrepSortOrder, savePrepSortOrder, type PrepSortOrder } from "../storage.js";
import type { PrepSelection } from "./selection.js";

const PREP_CARD_WIDTH = 105;
const PREP_CARD_HEIGHT = Math.round(
  (PREP_CARD_WIDTH * CARD_PREVIEW_HEIGHT) / CARD_PREVIEW_WIDTH,
);

const ANCHOR_MAX_AGE_MS = 1000;

const PREP_SORT_OPTIONS: readonly PrepSortOrder[] = ["name", "pitch"];

const PITCH_MESSAGES: Record<1 | 2 | 3, string> = {
  1: "prep.presentation.pitch.red",
  2: "prep.presentation.pitch.yellow",
  3: "prep.presentation.pitch.blue",
};

const CARD_TYPE_MESSAGES: Partial<Record<CardData["cardType"], string>> = {
  action: "prep.presentation.type.action",
  "attack-reaction": "prep.presentation.type.attackReaction",
  "defense-reaction": "prep.presentation.type.defenseReaction",
  instant: "prep.presentation.type.instant",
  block: "prep.presentation.type.block",
  resource: "prep.presentation.type.resource",
  mentor: "prep.presentation.type.mentor",
};

/** Attacks are the ledger's default row; only other types carry a label. */
function cardTypeMessage(data: CardData | undefined): string | null {
  if (!data) return null;
  const subtypes = data.subtypes ?? [];
  if (subtypes.includes("item")) return "prep.presentation.type.item";
  if (data.cardType === "action" && subtypes.includes("attack")) return null;
  return CARD_TYPE_MESSAGES[data.cardType] ?? null;
}

function pitchGroup(id: string): 0 | 1 | 2 | 3 {
  const pitch = cardData[id]?.pitch;
  return pitch === 1 || pitch === 2 || pitch === 3 ? pitch : 0;
}

function countCopies(ids: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return counts;
}

interface LedgerEntry {
  id: string;
  count: number;
  fixed: boolean;
}

interface LedgerGroup {
  pitch: 0 | 1 | 2 | 3;
  total: number;
  rows: LedgerEntry[];
}

/** Under the pitch sort each color becomes a titled run of rows. */
function groupLedger(rows: readonly LedgerEntry[], sortOrder: PrepSortOrder): LedgerGroup[] {
  if (sortOrder !== "pitch") {
    return rows.length ? [{ pitch: 0, total: 0, rows: [...rows] }] : [];
  }
  const groups: LedgerGroup[] = [];
  for (const row of rows) {
    const pitch = pitchGroup(row.id);
    const group = groups.at(-1);
    if (group && group.pitch === pitch) {
      group.rows.push(row);
      group.total += row.count;
    } else {
      groups.push({ pitch, total: row.count, rows: [row] });
    }
  }
  return groups;
}

function WrappingPrepGroups({ children }: { children: ReactNode }) {
  const groupsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const groups = groupsRef.current;
    if (!groups) return;
    const markRowStarts = () => {
      let rowTop: number | null = null;
      for (const child of groups.children) {
        if (!(child instanceof HTMLElement)) continue;
        const startsRow = rowTop === null || child.offsetTop !== rowTop;
        child.classList.toggle("prep-group-row-start", startsRow);
        rowTop = child.offsetTop;
      }
    };
    markRowStarts();
    const observer = new ResizeObserver(markRowStarts);
    observer.observe(groups);
    for (const child of groups.children) observer.observe(child);
    return () => observer.disconnect();
  }, []);

  return <div ref={groupsRef} className="prep-groups">{children}</div>;
}

function scrollParent(el: HTMLElement): HTMLElement {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement;
}

function LedgerHead() {
  const intl = useIntl();
  return (
    <div className="prep-ledger-head" aria-hidden="true">
      <span />
      <span>{intl.formatMessage({ id: "prep.presentation.column.card" })}</span>
      <span className="prep-col-stat">{intl.formatMessage({ id: "prep.presentation.column.cost" })}</span>
      <span className="prep-col-stat">{intl.formatMessage({ id: "prep.presentation.column.power" })}</span>
      <span className="prep-col-stat">{intl.formatMessage({ id: "prep.presentation.column.defense" })}</span>
      <span>{intl.formatMessage({ id: "prep.presentation.column.copies" })}</span>
    </div>
  );
}

function LedgerRow({
  id,
  changed,
  fixed,
  onInspect,
  children,
}: {
  id: string;
  changed: boolean;
  fixed: boolean;
  onInspect: (id: string) => void;
  children: ReactNode;
}) {
  const intl = useIntl();
  const data = cardData[id];
  const name = data?.name ?? id;
  const typeMessage = cardTypeMessage(data);
  const stat = (value: number | undefined) => (
    <span className={`prep-row-stat${value === undefined ? " empty" : ""}`}>
      {value ?? "–"}
    </span>
  );
  return (
    <li
      className={`prep-row${changed ? " changed" : ""}${fixed ? " fixed" : ""}`}
      data-cardid={id}
    >
      <button
        type="button"
        className="prep-row-art"
        aria-label={intl.formatMessage({ id: "prep.presentation.showCard" }, { card: name })}
        onClick={() => onInspect(id)}
      >
        <CardArtwork className="prep-row-tile" cardId={id} alt="" />
      </button>
      <span className="prep-row-name">
        <i className={`prep-pitch prep-pitch-${pitchGroup(id)}`} aria-hidden="true" />
        <span className="prep-row-title">{name}</span>
        {fixed ? (
          <span className="prep-row-type">{intl.formatMessage({ id: "prep.presentation.fixedInventory" })}</span>
        ) : typeMessage ? (
          <span className="prep-row-type">{intl.formatMessage({ id: typeMessage })}</span>
        ) : null}
      </span>
      {stat(data?.cost)}
      {stat(data?.attack)}
      {stat(data?.defense)}
      <span className="prep-row-controls">{children}</span>
    </li>
  );
}

export const PrepPresentation = memo(function PrepPresentation({
  pool,
  selection,
  selectionKey,
  locked,
  sections,
  showHero,
  mainCount,
  minimumMainCount,
  exactMainCount,
  inventoryCount,
  poolMainEntries,
  fixedInventoryCounts,
  onToggleWeapon,
  onToggleEquipment,
  onMoveMainCopy,
  onRestoreMain,
  onInspectCard,
}: {
  pool: DeckPool;
  selection: PrepSelection;
  selectionKey: string;
  locked: boolean;
  sections: "arena" | "deck";
  /** The desktop match sheet already shows the hero beside its arena. */
  showHero: boolean;
  mainCount: number;
  minimumMainCount: number;
  exactMainCount?: number;
  inventoryCount: number;
  poolMainEntries: [string, number][];
  fixedInventoryCounts: ReadonlyMap<string, number>;
  onToggleWeapon: (index: number) => void;
  onToggleEquipment: (slot: EquipmentSlot, id: string) => void;
  onMoveMainCopy: (id: string, delta: -1 | 1) => void;
  /** Puts the registered main deck back, undoing every move. */
  onRestoreMain: () => void;
  /** Opens the full card from a ledger row's art. */
  onInspectCard: (id: string) => void;
}) {
  const intl = useIntl();
  const mainRequirement = exactMainCount === undefined
    ? intl.formatMessage({ id: "prep.presentation.minimum" }, { count: minimumMainCount })
    : intl.formatMessage({ id: "prep.presentation.exact" }, { count: exactMainCount });
  // Moving a copy can add or remove a row in the other zone and shift the row
  // under the pointer; keep the pressed control at the same viewport position
  // so repeated clicks hit the same card.
  const anchorRef = useRef<{ button: HTMLElement; top: number; at: number } | null>(null);
  const moveCopy = (button: HTMLElement, id: string, delta: -1 | 1) => {
    anchorRef.current = { button, top: button.getBoundingClientRect().top, at: performance.now() };
    onMoveMainCopy(id, delta);
  };
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    if (!anchor.button.isConnected || performance.now() - anchor.at > ANCHOR_MAX_AGE_MS) return;
    const shift = anchor.button.getBoundingClientRect().top - anchor.top;
    if (shift !== 0) scrollParent(anchor.button).scrollTop += shift;
  }, [selection]);
  const [sortOrder, setSortOrder] = useState(() => loadPrepSortOrder(globalThis.localStorage));
  const changeSortOrder = (order: PrepSortOrder) => {
    setSortOrder(order);
    savePrepSortOrder(globalThis.localStorage, order);
  };

  const registered = countCopies(pool.deck);
  const mainOf = (id: string) => selection.main.get(id) ?? 0;
  const changed = (id: string) => mainOf(id) !== (registered.get(id) ?? 0);
  const sortedMainEntries = sortCards(poolMainEntries, sortOrder, ([cardId]) => ({ cardId }));
  const spareCopies = new Map(poolMainEntries.map(([id, total]) => [id, total - mainOf(id)]));
  const mainGroups = groupLedger(
    sortedMainEntries.flatMap(([id]) => (mainOf(id) > 0 ? [{ id, count: mainOf(id), fixed: false }] : [])),
    sortOrder,
  );
  const inventoryGroups = groupLedger(
    sortCards<LedgerEntry>(
      [
        ...poolMainEntries.map(([id]) => ({ id, count: spareCopies.get(id) ?? 0, fixed: false })),
        ...[...fixedInventoryCounts].map(([id, count]) => ({ id, count, fixed: true })),
      ].filter(({ count }) => count > 0),
      sortOrder,
      ({ id }) => ({ cardId: id }),
    ),
    sortOrder,
  );
  const pitchTotals: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
  for (const [id, count] of selection.main) {
    const pitch = pitchGroup(id);
    if (pitch !== 0) pitchTotals[pitch] += count;
  }
  const pitchLabel = (pitch: 1 | 2 | 3) =>
    intl.formatMessage({ id: PITCH_MESSAGES[pitch] }, { count: pitchTotals[pitch] });
  const dirty = poolMainEntries.some(([id]) => changed(id));
  const moveLabel = (id: string, destination: "main" | "inventory") =>
    intl.formatMessage(
      { id: "prep.presentation.moveCopy" },
      {
        card: cardData[id]?.name ?? id,
        destination: intl.formatMessage({ id: `prep.zone.${destination}` }),
      },
    );
  const Container = sections === "arena" ? "div" : "section";

  const renderGroups = (groups: LedgerGroup[], render: (entry: LedgerEntry) => ReactNode) =>
    groups.map((group) => (
      <li key={group.pitch} className="prep-ledger-group">
        {sortOrder === "pitch" && group.pitch !== 0 ? (
          <span className="prep-group-title">
            <i className={`prep-pitch prep-pitch-${group.pitch}`} aria-hidden="true" />
            {intl.formatMessage({ id: PITCH_MESSAGES[group.pitch] }, { count: group.total })}
          </span>
        ) : null}
        <ul className="prep-ledger-rows">{group.rows.map(render)}</ul>
      </li>
    ));

  return (
    <Container className={sections === "arena" ? "prep-arena-selection" : "panel prep-pool"}>
      {sections === "deck" ? (
        <div className="prep-pool-heading">
          <h3 className="panel-title">{intl.formatMessage({ id: "prep.presentation.title" })}</h3>
          <CardSortToggle options={PREP_SORT_OPTIONS} value={sortOrder} onChange={changeSortOrder} />
        </div>
      ) : null}
      {sections !== "deck" && showHero ? <div className="prep-section">
        <span className="play-label">{intl.formatMessage({ id: "prep.presentation.hero" })}</span>
        <div className="prep-cardrow">
          <CardArtwork
            className="prep-card selected"
            cardId={pool.heroId}
            alt={cardData[pool.heroId]?.name ?? intl.formatMessage({ id: "prep.presentation.hero" })}
            width={PREP_CARD_WIDTH}
            height={PREP_CARD_HEIGHT}
          />
        </div>
      </div> : null}
      {sections !== "deck" ? <div className="prep-section">
        <WrappingPrepGroups key={selectionKey}>
          <div className="prep-group">
            <span className="play-label">
              {intl.formatMessage(
                { id: "prep.presentation.weapons" },
                { count: selection.weaponIndexes.length },
              )}
            </span>
            <div className="prep-cardrow">
              {pool.weaponIds.map((id, index) => {
                const selected = selection.weaponIndexes.includes(index);
                return (
                  <button
                    key={`${id}-${index}`}
                    type="button"
                    className={`prep-card-choice${selected ? " selected" : ""}`}
                    disabled={locked}
                    aria-pressed={selected}
                    aria-label={intl.formatMessage(
                      { id: selected ? "prep.presentation.removeCard" : "prep.presentation.selectCard" },
                      { card: cardData[id]?.name ?? id },
                    )}
                    data-cardid={id}
                    onClick={() => onToggleWeapon(index)}
                  >
                    <CardArtwork
                      className="prep-card"
                      cardId={id}
                      alt=""
                      width={PREP_CARD_WIDTH}
                      height={PREP_CARD_HEIGHT}
                    />
                    <span className="prep-card-check" aria-hidden="true">✓</span>
                  </button>
                );
              })}
              {pool.weaponIds.length === 0 ? (
                <span className="muted">{intl.formatMessage({ id: "prep.presentation.noneRegistered" })}</span>
              ) : null}
            </div>
          </div>
          {EQUIPMENT_SLOTS.map((slot) => {
            const options = pool.equipmentPool.filter((id) => equipmentFitsSlot(cardData[id], slot));
            if (options.length === 0) return null;
            return (
              <div className="prep-group" key={slot}>
                <span className="play-label">{intl.formatMessage({ id: `game.zone.${slot}` })}</span>
                <div className="prep-cardrow">
                  {options.map((id, index) => (
                    <button
                      key={`${id}-${index}`}
                      type="button"
                      className={`prep-card-choice${selection.equipment[slot] === id ? " selected" : ""}`}
                      disabled={locked}
                      aria-pressed={selection.equipment[slot] === id}
                      aria-label={intl.formatMessage(
                        {
                          id: selection.equipment[slot] === id
                            ? "prep.presentation.removeEquipment"
                            : "prep.presentation.selectEquipment",
                        },
                        {
                          card: cardData[id]?.name ?? id,
                          slot: intl.formatMessage({ id: `prep.slot.${slot}` }),
                        },
                      )}
                      data-cardid={id}
                      onClick={() => onToggleEquipment(slot, id)}
                    >
                      <CardArtwork
                        className="prep-card"
                        cardId={id}
                        alt=""
                        width={PREP_CARD_WIDTH}
                        height={PREP_CARD_HEIGHT}
                      />
                      <span className="prep-card-check" aria-hidden="true">✓</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </WrappingPrepGroups>
      </div> : null}
      {sections !== "arena" ? <div className="prep-section prep-ledgers">
        <div className="prep-deck-zone">
          <div className="prep-zone-heading">
            <h4>{intl.formatMessage(
              { id: "prep.presentation.mainCount" },
              { count: mainCount, requirement: mainRequirement },
            )}</h4>
            {dirty && !locked ? (
              <button type="button" className="prep-restore" onClick={onRestoreMain}>
                {intl.formatMessage({ id: "prep.presentation.restore" })}
              </button>
            ) : null}
          </div>
          {mainCount > 0 ? (
            <div
              className="prep-pitch-bar"
              role="img"
              aria-label={intl.formatMessage(
                { id: "prep.presentation.pitchSplit" },
                { red: pitchLabel(1), yellow: pitchLabel(2), blue: pitchLabel(3) },
              )}
            >
              {([1, 2, 3] as const).map((pitch) => (
                <span
                  key={pitch}
                  className={`prep-pitch-${pitch}`}
                  style={{ flexGrow: pitchTotals[pitch] }}
                />
              ))}
            </div>
          ) : null}
          <div className="prep-pitch-legend" aria-hidden="true">
            {([1, 2, 3] as const).map((pitch) => (
              <span key={pitch}>
                <i className={`prep-pitch prep-pitch-${pitch}`} />
                {pitchLabel(pitch)}
              </span>
            ))}
          </div>
          <LedgerHead />
          <ul className="prep-ledger">
            {renderGroups(mainGroups, ({ id, count }) => (
              <LedgerRow key={id} id={id} changed={changed(id)} fixed={false} onInspect={onInspectCard}>
                <TooltipButton
                  className="prep-step"
                  tooltip={moveLabel(id, "inventory")}
                  disabled={locked}
                  onClick={(event) => moveCopy(event.currentTarget, id, -1)}
                >
                  <UiIcon name="minus" />
                </TooltipButton>
                <span className="prep-copies">{count}</span>
                <TooltipButton
                  className="prep-step"
                  tooltip={moveLabel(id, "main")}
                  disabled={locked || (spareCopies.get(id) ?? 0) === 0}
                  onClick={(event) => moveCopy(event.currentTarget, id, 1)}
                >
                  <UiIcon name="plus" />
                </TooltipButton>
              </LedgerRow>
            ))}
          </ul>
        </div>
        <div className="prep-deck-zone prep-inventory-zone">
          <div className="prep-zone-heading">
            <h4>{intl.formatMessage({ id: "prep.presentation.inventoryCount" }, { count: inventoryCount })}</h4>
          </div>
          {inventoryCount > 0 ? <LedgerHead /> : null}
          <ul className="prep-ledger">
            {renderGroups(inventoryGroups, ({ id, count, fixed }) => (
              <LedgerRow
                key={fixed ? `fixed-${id}` : id}
                id={id}
                changed={!fixed && changed(id)}
                fixed={fixed}
                onInspect={onInspectCard}
              >
                <span className="prep-copies">{count}</span>
                {fixed ? (
                  <span className="prep-row-fixed"><UiIcon name="lock" /></span>
                ) : (
                  <TooltipButton
                    className="prep-step"
                    tooltip={moveLabel(id, "main")}
                    disabled={locked}
                    onClick={(event) => moveCopy(event.currentTarget, id, 1)}
                  >
                    <UiIcon name="plus" />
                  </TooltipButton>
                )}
              </LedgerRow>
            ))}
          </ul>
          {inventoryCount === 0 ? (
            <p className="prep-empty-zone muted">
              {intl.formatMessage({ id: "prep.presentation.emptyInventory" })}
            </p>
          ) : null}
        </div>
      </div> : null}
    </Container>
  );
});
