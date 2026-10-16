import type { OngoingEffectView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { TooltipButton } from "../../components/TooltipButton.js";
import { UiIcon } from "../../components/UiIcon.js";
import { CardBack, CardFace } from "../Card.js";
import { hasLegacySquareCardFrame, isMarvelCardImageUrl, resolveCardImageUrls } from "../cardImageUrl.js";
import {
  effectCount,
  effectIcon,
  effectImposed,
  effectText,
  sentenceCase,
  splitByPlacement,
  type OngoingEffectStack,
} from "./effectModel.js";
import { effectSourceHero, useEffectHeroes } from "./effectHeroes.js";

const ARENA_FRAME_TYPES = new Set(["hero", "weapon", "equipment", "token"]);

/** Which printed layout the source image uses, so the crop lands on its art
 *  window. Mirrors the square-card presentation in Card.tsx. */
function artFrame(cardId: string, imageUrl: string): string {
  if (isMarvelCardImageUrl(imageUrl)) return "marvel";
  const arena = ARENA_FRAME_TYPES.has(cardData[cardId]?.cardType ?? "");
  const legacy = hasLegacySquareCardFrame(imageUrl);
  return `${arena ? "arena" : "standard"}${legacy ? "-legacy" : ""}`;
}

function SourceArt({ cardId }: { cardId: string }) {
  const urls = resolveCardImageUrls(cardId, cardData[cardId]);
  const [failure, setFailure] = useState<{ cardId: string; attempts: number } | null>(null);
  const imageUrl = urls[failure?.cardId === cardId ? failure.attempts : 0];
  return (
    <span className="effect-art" data-frame={imageUrl ? artFrame(cardId, imageUrl) : undefined} aria-hidden="true">
      {imageUrl ? (
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          onError={() => setFailure((current) => ({
            cardId,
            attempts: current?.cardId === cardId ? current.attempts + 1 : 1,
          }))}
        />
      ) : null}
    </span>
  );
}

/** Cropped source art: the source card, the hero behind a cardless hero
 *  effect, a card back for a face-down source, or else the lifetime glyph. */
export function EffectArt({ effect }: { effect: OngoingEffectView }) {
  const sourceHero = effectSourceHero(effect, useEffectHeroes());
  if (effect.cardId) return <SourceArt cardId={effect.cardId} />;
  if (sourceHero) return <SourceArt cardId={sourceHero.heroCardId} />;
  return (
    <span className={`effect-art ${effect.sourceHidden ? "effect-art-hidden" : "effect-art-neutral"}`} aria-hidden="true">
      {effect.sourceHidden ? null : <UiIcon name={effectIcon(effect)} />}
    </span>
  );
}

const stackKey = ({ effect }: OngoingEffectStack) =>
  JSON.stringify([effect.seat, effect.cardId, effect.label, effect.sourceSeat ?? null]);

/** Keys that were not present on the previous render. The first render has no
 *  arrivals, so loading into a game does not flash every standing effect. */
function useArrivals(stacks: readonly OngoingEffectStack[]): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const keys = stacks.map(stackKey);
  const arrivals = seen.current === null
    ? new Set<string>()
    : new Set(keys.filter((key) => !seen.current!.has(key)));
  useEffect(() => {
    seen.current = new Set(keys);
  });
  return arrivals;
}

const CHIP_MIN_WIDTH = 150;
const CHIP_MAX_WIDTH = 240;
const CHIP_HEIGHT = 32;
const CHIP_GAP = 5;
const MAX_CHIP_ROWS = 3;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ChipGrid {
  columns: number;
  rows: number;
  /** Something covers the slot's lower part, so rows start at its top. */
  obstructed: boolean;
}

const DEFAULT_GRID: ChipGrid = { columns: 2, rows: MAX_CHIP_ROWS, obstructed: false };

/** Chip columns by width and rows by the height left clear above anything
 *  overlapping the slot, such as resting hand cards on narrower screens. */
export function chipGridFor(slot: Box, obstacles: readonly Box[]): ChipGrid {
  let height = slot.bottom - slot.top;
  let obstructed = false;
  for (const obstacle of obstacles) {
    const overlaps = obstacle.left < slot.right && obstacle.right > slot.left &&
      obstacle.top < slot.bottom && obstacle.bottom > slot.top;
    if (!overlaps) continue;
    height = Math.min(height, obstacle.top - slot.top);
    obstructed = true;
  }
  return {
    columns: Math.max(1, Math.floor((slot.right - slot.left + CHIP_GAP) / (CHIP_MIN_WIDTH + CHIP_GAP))),
    rows: Math.min(MAX_CHIP_ROWS, Math.max(1, Math.floor((height + CHIP_GAP) / (CHIP_HEIGHT + CHIP_GAP)))),
    obstructed,
  };
}

/** Resting hand cards. A hovered or selected card is lifted temporarily and
 *  would understate the room left for chips. */
function restingHandCards(): Box[] {
  return [...document.querySelectorAll<HTMLElement>("#player-hand > .card-hand")]
    .filter((card) => !card.matches(":hover, .card-selected"))
    .map((card) => card.getBoundingClientRect());
}

function useChipGrid(slot: HTMLElement | null, avoidHand: boolean): ChipGrid {
  const [grid, setGrid] = useState(DEFAULT_GRID);
  useLayoutEffect(() => {
    if (!slot || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const next = chipGridFor(slot.getBoundingClientRect(), avoidHand ? restingHandCards() : []);
      setGrid((current) =>
        current.columns === next.columns && current.rows === next.rows && current.obstructed === next.obstructed
          ? current
          : next
      );
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(slot);
    window.addEventListener("resize", measure);
    // Cards entering or leaving the hand move the remaining ones.
    const hand = avoidHand ? document.getElementById("player-hand") : null;
    const mutations = hand ? new MutationObserver(measure) : null;
    if (hand) mutations?.observe(hand, { childList: true });
    return () => {
      resize.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [slot, avoidHand]);
  return grid;
}

/** The lingering-effects slot beside the legs. The whole slot is one button
 *  that opens the ledger; rest-of-game effects are pinned to the hero instead. */
export function EffectSlot({
  effects,
  area,
  heroName,
  compact,
  avoidHand = false,
  onOpen,
}: {
  /** Effects on this seat only. */
  effects: readonly OngoingEffectView[];
  /** Grid area on the mat half. */
  area: string;
  heroName: string;
  /** Phone layouts show mat-sized card tiles instead of text chips. */
  compact: boolean;
  /** Keep chips clear of the viewer's resting hand cards. */
  avoidHand?: boolean;
  onOpen: () => void;
}) {
  const intl = useIntl();
  const heroes = useEffectHeroes();
  const [slotElement, setSlotElement] = useState<HTMLButtonElement | null>(null);
  const grid = useChipGrid(compact ? null : slotElement, avoidHand);
  const tileCapacity = useTileCapacity(compact ? slotElement : null);
  const capacity = grid.columns * grid.rows;
  const { slot } = splitByPlacement(effects);
  const arrivals = useArrivals(slot);
  if (slot.length === 0) return null;

  const label = intl.formatMessage({ id: "game.effects.open" }, { hero: heroName, count: effectCount(slot) });

  if (compact) {
    // The last tile turns into the overflow pile when the row cannot hold all.
    const shown = slot.length > tileCapacity ? slot.slice(0, Math.max(0, tileCapacity - 1)) : slot;
    const more = slot.length - shown.length;
    return (
      <button
        type="button"
        ref={setSlotElement}
        className="effects-row effect-cards"
        style={{ gridArea: area }}
        aria-label={label}
        onClick={onOpen}
      >
        {shown.map((stack) => (
          <EffectCardTile key={stackKey(stack)} stack={stack} arriving={arrivals.has(stackKey(stack))} />
        ))}
        {more > 0 ? (
          <span className="card-zone effect-card-more">
            <span className="effect-card-more-count">+{more}</span>
            <span className="effect-card-more-label">{intl.formatMessage({ id: "game.effects.moreLabel" })}</span>
          </span>
        ) : null}
      </button>
    );
  }

  // Every cell shows a real effect; the last one carries the hidden count.
  const visible = slot.slice(0, capacity);
  const hidden = slot.length - visible.length;
  return (
    <button
      type="button"
      ref={setSlotElement}
      className="effects-row effect-chips"
      style={{
        gridArea: area,
        gridTemplateColumns: `repeat(${grid.columns}, minmax(0, ${CHIP_MAX_WIDTH}px))`,
        gridTemplateRows: `repeat(${grid.rows}, ${CHIP_HEIGHT}px)`,
        ...(grid.obstructed ? { alignContent: "start" } : {}),
      }}
      aria-label={label}
      onClick={onOpen}
    >
      {visible.map((stack, index) => {
        const { effect, count } = stack;
        const last = index === visible.length - 1;
        const text = effectText(intl, effect);
        const key = stackKey(stack);
        const previewCardId = effect.cardId || effectSourceHero(effect, heroes)?.heroCardId;
        return (
          <span
            key={key}
            className={[
              "effect-chip",
              effectImposed(effect) ? "effect-imposed" : "",
              arrivals.has(key) ? "effect-arrive" : "",
            ].filter(Boolean).join(" ")}
            data-effect-label={`${sentenceCase(text.summary)}\n${sentenceCase(text.duration)}${count > 1 ? ` ×${count}` : ""}`}
            {...(previewCardId ? { "data-cardid": previewCardId } : {})}
          >
            <EffectArt effect={effect} />
            <span className="effect-text">
              <span className="effect-summary">{sentenceCase(text.summary)}</span>
              <span className="effect-life">{sentenceCase(text.duration)}</span>
            </span>
            {count > 1 ? <span className="effect-count">×{count}</span> : null}
            {last && hidden > 0 ? <span className="effect-more">+{hidden}</span> : null}
          </span>
        );
      })}
    </button>
  );
}

const TILE_GAP = 5;

/** How many card-sized tiles fit across the phone slot. Tiles take the mat's
 *  own card size, so the first rendered tile is the measure. */
function useTileCapacity(slot: HTMLElement | null): number {
  const [capacity, setCapacity] = useState(2);
  useLayoutEffect(() => {
    if (!slot || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const tile = slot.firstElementChild as HTMLElement | null;
      if (!tile || tile.offsetWidth === 0) return;
      setCapacity(Math.max(1, Math.floor((slot.clientWidth + TILE_GAP) / (tile.offsetWidth + TILE_GAP))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);
  return capacity;
}

/** A phone-sized effect: the source card at mat size with its lifetime badge,
 *  a card back for a face-down source, or the effect's text when there is no
 *  source card (a hero card face here would read as a second hero). */
function EffectCardTile({ stack, arriving }: { stack: OngoingEffectStack; arriving: boolean }) {
  const intl = useIntl();
  const { effect, count } = stack;
  return (
    <span
      className={[
        "effect-card",
        effectImposed(effect) ? "effect-imposed" : "",
        count > 1 ? "effect-card-stacked" : "",
        arriving ? "effect-arrive" : "",
      ].filter(Boolean).join(" ")}
    >
      {effect.cardId ? (
        <CardFace
          card={{ instanceId: -1, cardId: effect.cardId, owner: effect.seat }}
          size="zone"
          showOverlays={false}
          showStats={false}
          showTapped={false}
        />
      ) : effect.sourceHidden ? (
        <CardBack label="" />
      ) : (
        <span className="card-zone effect-card-neutral">
          <span className="effect-card-neutral-text">{sentenceCase(effectText(intl, effect).summary)}</span>
        </span>
      )}
      <span className="effect-card-life">
        <UiIcon name={effectIcon(effect)} />
      </span>
      {count > 1 ? <span className="effect-card-count">×{count}</span> : null}
    </span>
  );
}

const MAX_PINS = 3;

/** Rest-of-game effects pinned down the hero card's left edge, clear of its
 *  name. Identical effects share one pin; its tooltip adds how many more. */
export function EffectPins({
  effects,
  onOpen,
}: {
  /** Effects on this seat only. */
  effects: readonly OngoingEffectView[];
  onOpen: () => void;
}) {
  const intl = useIntl();
  const { pins } = splitByPlacement(effects);
  const arrivals = useArrivals(pins);
  if (pins.length === 0) return null;
  const shown = pins.length > MAX_PINS ? pins.slice(0, MAX_PINS - 1) : pins;
  const hidden = pins.length - shown.length;

  return (
    <span className="effect-pins">
      {shown.map((stack) => {
        const text = effectText(intl, stack.effect);
        const key = stackKey(stack);
        return (
          <TooltipButton
            key={key}
            className={[
              "effect-pin",
              effectImposed(stack.effect) ? "effect-imposed" : "",
              arrivals.has(key) ? "effect-arrive" : "",
            ].filter(Boolean).join(" ")}
            tooltip={intl.formatMessage(
              { id: "game.effects.pin" },
              { summary: sentenceCase(text.summary), duration: text.duration, more: stack.count - 1 },
            )}
            tooltipSide="above"
            onClick={onOpen}
          >
            <UiIcon name={effectIcon(stack.effect)} />
          </TooltipButton>
        );
      })}
      {hidden > 0 ? (
        <TooltipButton
          className="effect-pin effect-pin-more"
          tooltip={intl.formatMessage({ id: "game.effects.more" }, { count: hidden })}
          tooltipSide="above"
          onClick={onOpen}
        >
          +{hidden}
        </TooltipButton>
      ) : null}
    </span>
  );
}
