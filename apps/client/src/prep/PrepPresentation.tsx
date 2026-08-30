import { memo, useLayoutEffect, useRef } from "react";
import type { DeckPool, EquipmentSlot } from "@fyendal/shared";
import { cardData, equipmentFitsSlot } from "@fyendal/cards/client";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  cardImageUrl,
} from "../game/Card.js";
import { EQUIPMENT_SLOTS } from "../domain.js";
import type { PrepSelection } from "./selection.js";

const STACK_CARD_WIDTH = 118;
const STACK_CARD_HEIGHT = Math.round(
  (STACK_CARD_WIDTH * CARD_PREVIEW_HEIGHT) / CARD_PREVIEW_WIDTH,
);
const STACK_COPY_OFFSET = 25;

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
  destination?: "Main Deck" | "Inventory";
  locked: boolean;
  onMove?: () => void;
}) {
  const name = cardData[id]?.name ?? id;
  const stackHeight = STACK_CARD_HEIGHT + (count - 1) * STACK_COPY_OFFSET;
  const immovable = locked || !onMove || !destination;
  return (
    <button
      type="button"
      className="prep-stack-button"
      style={{ height: stackHeight }}
      data-cardid={id}
      aria-disabled={immovable}
      aria-label={immovable ? name : `Move one copy of ${name} to ${destination}`}
      title={immovable ? name : `Move one copy of ${name} to ${destination}`}
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
          loading="lazy"
        />
      ))}
      <span className="prep-stack-count" aria-hidden="true">×{count}</span>
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
  onToggleWeapon: (id: string) => void;
  onToggleEquipment: (slot: EquipmentSlot, id: string) => void;
  onMoveMainCopy: (id: string, delta: -1 | 1) => void;
}) {
  return (
    <section className="panel prep-pool">
      <h3 className="panel-title">Your presentation</h3>
      <div className="prep-section">
        <span className="play-label">Hero</span>
        <div className="prep-cardrow">
          <img
            className="prep-card selected"
            src={cardImageUrl(pool.heroId)}
            alt={cardData[pool.heroId]?.name ?? "Hero"}
            width={97}
            height={134}
            data-cardid={pool.heroId}
          />
        </div>
      </div>
      <div className="prep-section">
        <WrappingPrepGroups key={selectionKey}>
          <div className="prep-group">
            <span className="play-label">Weapons ({selection.weapons.length})</span>
            <div className="prep-cardrow">
              {pool.weaponIds.map((id, index) => (
                <button
                  key={`${id}-${index}`}
                  type="button"
                  className={`prep-card-choice${selection.weapons.includes(id) ? " selected" : ""}`}
                  aria-pressed={selection.weapons.includes(id)}
                  aria-label={`${selection.weapons.includes(id) ? "Remove" : "Select"} ${cardData[id]?.name ?? id}`}
                  data-cardid={id}
                  onClick={() => onToggleWeapon(id)}
                >
                  <img className="prep-card" src={cardImageUrl(id)} alt="" width={97} height={134} />
                  <span className="prep-card-check" aria-hidden="true">✓</span>
                </button>
              ))}
              {pool.weaponIds.length === 0 ? <span className="muted">none registered</span> : null}
            </div>
          </div>
          {EQUIPMENT_SLOTS.map((slot) => {
            const options = pool.equipmentPool.filter((id) => equipmentFitsSlot(cardData[id], slot));
            if (options.length === 0) return null;
            return (
              <div className="prep-group" key={slot}>
                <span className="play-label">{slot}</span>
                <div className="prep-cardrow">
                  {options.map((id, index) => (
                    <button
                      key={`${id}-${index}`}
                      type="button"
                      className={`prep-card-choice${selection.equipment[slot] === id ? " selected" : ""}`}
                      aria-pressed={selection.equipment[slot] === id}
                      aria-label={`${selection.equipment[slot] === id ? "Remove" : "Select"} ${cardData[id]?.name ?? id} for ${slot}`}
                      data-cardid={id}
                      onClick={() => onToggleEquipment(slot, id)}
                    >
                      <img className="prep-card" src={cardImageUrl(id)} alt="" width={97} height={134} />
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
            <h4>Main Deck ({mainCount} / {exactMainCount ? `${exactMainCount} exact` : `${minimumMainCount} min`})</h4>
            {!locked ? <span>Click a card to move one copy to Inventory.</span> : null}
          </div>
          <div className="prep-card-grid">
            {poolMainEntries.map(([id]) => {
              const count = selection.main.get(id) ?? 0;
              return count > 0 ? (
                <CardStack
                  key={id}
                  id={id}
                  count={count}
                  destination="Inventory"
                  locked={locked}
                  onMove={() => onMoveMainCopy(id, -1)}
                />
              ) : null;
            })}
          </div>
        </div>
        <div className="prep-deck-zone prep-inventory-zone">
          <div className="prep-zone-heading">
            <h4>Inventory ({inventoryCount})</h4>
            {!locked ? <span>Click a card to move one copy to Main Deck.</span> : null}
          </div>
          <div className="prep-card-grid">
            {poolMainEntries.map(([id, total]) => {
              const count = total - (selection.main.get(id) ?? 0);
              return count > 0 ? (
                <CardStack
                  key={id}
                  id={id}
                  count={count}
                  destination="Main Deck"
                  locked={locked}
                  onMove={() => onMoveMainCopy(id, 1)}
                />
              ) : null;
            })}
            {[...fixedInventoryCounts].map(([id, count]) => (
              <CardStack key={`fixed-${id}`} id={id} count={count} locked />
            ))}
            {inventoryCount === 0 ? (
              <p className="prep-empty-zone muted">No cards in inventory.</p>
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
