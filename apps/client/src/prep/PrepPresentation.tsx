import { memo, useLayoutEffect, useRef } from "react";
import { useIntl } from "react-intl";
import type { DeckPool, EquipmentSlot } from "@fyendal/shared";
import { cardData, equipmentFitsSlot } from "@fyendal/cards/client";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  cardImageUrl,
} from "../game/Card.js";
import { EQUIPMENT_SLOTS } from "../domain.js";
import type { PrepSelection } from "./selection.js";

const PREP_CARD_WIDTH = 105;
const PREP_CARD_HEIGHT = Math.round(
  (PREP_CARD_WIDTH * CARD_PREVIEW_HEIGHT) / CARD_PREVIEW_WIDTH,
);
const STACK_COPY_OFFSET = 25;
const STACK_CARD_ASPECT_PERCENT = (CARD_PREVIEW_HEIGHT / CARD_PREVIEW_WIDTH) * 100;

function WrappingPrepGroups({ children }: { children: React.ReactNode }) {
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

function CardStack({
  id,
  count,
  destination,
  locked,
  onMove,
}: {
  id: string;
  count: number;
  destination?: "main" | "inventory";
  locked: boolean;
  onMove?: () => void;
}) {
  const intl = useIntl();
  const name = cardData[id]?.name ?? id;
  const stackOffset = (count - 1) * STACK_COPY_OFFSET;
  const immovable = locked || !onMove || !destination;
  const destinationLabel = destination
    ? intl.formatMessage({ id: `prep.zone.${destination}` })
    : null;
  const actionLabel = immovable || !destinationLabel
    ? name
    : intl.formatMessage(
        { id: "prep.presentation.moveCopy" },
        { card: name, destination: destinationLabel },
      );
  return (
    <button
      type="button"
      className="prep-stack-button"
      style={{ paddingBottom: `calc(${STACK_CARD_ASPECT_PERCENT}% + ${stackOffset}px)` }}
      data-cardid={id}
      aria-disabled={immovable}
      aria-label={actionLabel}
      title={actionLabel}
      onClick={immovable ? undefined : onMove}
    >
      {Array.from({ length: count }, (_, index) => (
        <img
          key={index}
          className="prep-stack-card"
          style={{ top: index * STACK_COPY_OFFSET }}
          src={cardImageUrl(id)}
          alt=""
          draggable={false}
          loading="eager"
        />
      ))}
    </button>
  );
}

export const PrepPresentation = memo(function PrepPresentation({
  pool,
  selection,
  selectionKey,
  locked,
  mainCount,
  minimumMainCount,
  exactMainCount,
  inventoryCount,
  poolMainEntries,
  fixedInventoryCounts,
  onToggleWeapon,
  onToggleEquipment,
  onMoveMainCopy,
}: {
  pool: DeckPool;
  selection: PrepSelection;
  selectionKey: string;
  locked: boolean;
  mainCount: number;
  minimumMainCount: number;
  exactMainCount?: number;
  inventoryCount: number;
  poolMainEntries: [string, number][];
  fixedInventoryCounts: ReadonlyMap<string, number>;
  onToggleWeapon: (index: number) => void;
  onToggleEquipment: (slot: EquipmentSlot, id: string) => void;
  onMoveMainCopy: (id: string, delta: -1 | 1) => void;
}) {
  const intl = useIntl();
  const mainRequirement = exactMainCount === undefined
    ? intl.formatMessage({ id: "prep.presentation.minimum" }, { count: minimumMainCount })
    : intl.formatMessage({ id: "prep.presentation.exact" }, { count: exactMainCount });

  return (
    <section className="panel prep-pool">
      <h3 className="panel-title">{intl.formatMessage({ id: "prep.presentation.title" })}</h3>
      <div className="prep-section">
        <span className="play-label">{intl.formatMessage({ id: "prep.presentation.hero" })}</span>
        <div className="prep-cardrow">
          <img
            className="prep-card selected"
            src={cardImageUrl(pool.heroId)}
            alt={cardData[pool.heroId]?.name ?? intl.formatMessage({ id: "prep.presentation.hero" })}
            width={PREP_CARD_WIDTH}
            height={PREP_CARD_HEIGHT}
            data-cardid={pool.heroId}
          />
        </div>
      </div>
      <div className="prep-section">
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
                    aria-pressed={selected}
                    aria-label={intl.formatMessage(
                      { id: selected ? "prep.presentation.removeCard" : "prep.presentation.selectCard" },
                      { card: cardData[id]?.name ?? id },
                    )}
                    data-cardid={id}
                    onClick={() => onToggleWeapon(index)}
                  >
                    <img
                      className="prep-card"
                      src={cardImageUrl(id)}
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
                <span className="play-label">{intl.formatMessage({ id: `prep.slot.${slot}` })}</span>
                <div className="prep-cardrow">
                  {options.map((id, index) => (
                    <button
                      key={`${id}-${index}`}
                      type="button"
                      className={`prep-card-choice${selection.equipment[slot] === id ? " selected" : ""}`}
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
                      <img
                        className="prep-card"
                        src={cardImageUrl(id)}
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
      </div>
      <div className="prep-section">
        <div className="prep-deck-zone">
          <div className="prep-zone-heading">
            <h4>{intl.formatMessage(
              { id: "prep.presentation.mainCount" },
              { count: mainCount, requirement: mainRequirement },
            )}</h4>
            {!locked ? <span>{intl.formatMessage({ id: "prep.presentation.moveToInventoryHint" })}</span> : null}
          </div>
          <div className="prep-card-grid">
            {poolMainEntries.map(([id]) => {
              const count = selection.main.get(id) ?? 0;
              return count > 0 ? (
                <CardStack
                  key={id}
                  id={id}
                  count={count}
                  destination="inventory"
                  locked={locked}
                  onMove={() => onMoveMainCopy(id, -1)}
                />
              ) : null;
            })}
          </div>
        </div>
        <div className="prep-deck-zone prep-inventory-zone">
          <div className="prep-zone-heading">
            <h4>{intl.formatMessage({ id: "prep.presentation.inventoryCount" }, { count: inventoryCount })}</h4>
            {!locked ? <span>{intl.formatMessage({ id: "prep.presentation.moveToMainHint" })}</span> : null}
          </div>
          <div className="prep-card-grid">
            {poolMainEntries.map(([id, total]) => {
              const count = total - (selection.main.get(id) ?? 0);
              return count > 0 ? (
                <CardStack
                  key={id}
                  id={id}
                  count={count}
                  destination="main"
                  locked={locked}
                  onMove={() => onMoveMainCopy(id, 1)}
                />
              ) : null;
            })}
            {[...fixedInventoryCounts].map(([id, count]) => (
              <CardStack key={`fixed-${id}`} id={id} count={count} locked />
            ))}
            {inventoryCount === 0 ? (
              <p className="prep-empty-zone muted">
                {intl.formatMessage({ id: "prep.presentation.emptyInventory" })}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}, (previous, current) =>
  previous.pool === current.pool &&
  previous.selection === current.selection &&
  previous.selectionKey === current.selectionKey &&
  previous.locked === current.locked &&
  previous.mainCount === current.mainCount &&
  previous.minimumMainCount === current.minimumMainCount &&
  previous.exactMainCount === current.exactMainCount &&
  previous.inventoryCount === current.inventoryCount
);
