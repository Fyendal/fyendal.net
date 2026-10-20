import type { CardView, GameIntent, GameMessage, GameView, TurnTriggerEvent } from "@fyendal/shared";
import { cardData, functionalKeyOf } from "@fyendal/cards/client";
import { heroCard } from "./board/heroCard.js";
import type {
  OptionalTriggerOrder,
  PriorityWindowOrder,
  StandingOrder,
  StandingOrders,
} from "../storage.js";

export type StandingOrderKind = "priority-window" | "optional-trigger";

/** A repeating question the viewer could answer automatically right now. */
export interface StandingOrderQuestion {
  kind: StandingOrderKind;
  /** Functional card identity (`name lowercase|pitch`). */
  key: string;
  /** The arena card the question came from, for display. */
  card: CardView;
  /** Seat whose arena holds that card. */
  seat: number;
  /** Semantic label of the trigger that asked, when the server projected one. */
  label: GameMessage | null;
  /** English fallback for `label`. */
  fallback: string;
}

export interface StandingOrderAnswer {
  question: StandingOrderQuestion;
  intent: GameIntent;
  value: "pass" | "yes" | "no";
}

/** One question seen this game, remembered so the card keeps its chip row
 * between occurrences. */
export interface ObservedStandingOrderQuestion {
  kind: StandingOrderKind;
  label: GameMessage | null;
  fallback: string;
}

export interface StandingOrderRow {
  kind: StandingOrderKind;
  /** When the printed trigger fires, so "Destroy Fealty" reads as the end-phase
   * trigger rather than the token's instant ability. */
  timing: TurnTriggerEvent | null;
  label: GameMessage | null;
  fallback: string | null;
  order: PriorityWindowOrder | OptionalTriggerOrder;
}

export interface StandingOrderCardModel {
  key: string;
  /** A printing for naming the card in copy. */
  cardId: string;
  rows: StandingOrderRow[];
}

export function standingOrderKey(card: Pick<CardView, "cardId">): string | null {
  const data = cardData[card.cardId];
  return data ? functionalKeyOf(data) : null;
}

/** Arena permanents of one seat: hero, weapons, equipment, and board cards. */
export function arenaCards(view: GameView, seat: number): CardView[] {
  const player = view.players[seat];
  if (!player) return [];
  return [
    heroCard(player),
    ...player.weapons,
    ...Object.values(player.equipment).filter((card): card is CardView => card !== undefined),
    ...player.board,
  ];
}

function arenaCardByInstance(view: GameView, instanceId: number): { card: CardView; seat: number } | null {
  for (const seat of [0, 1]) {
    const card = arenaCards(view, seat).find((candidate) => candidate.instanceId === instanceId);
    if (card) return { card, seat };
  }
  return null;
}

function layerLabel(layer: { label: string; labelMessage?: GameMessage }): {
  label: GameMessage | null;
  fallback: string;
} {
  return { label: layer.labelMessage ?? null, fallback: layer.label };
}

function isYesNo(options: readonly string[] | undefined): boolean {
  return options !== undefined
    && options.length === 2
    && options.includes("yes")
    && options.includes("no");
}

/** The repeating question the viewer is being asked now, if any. */
export function currentStandingOrderQuestion(
  view: GameView,
  viewerSeat: number,
): StandingOrderQuestion | null {
  const decision = view.pendingDecision;
  if (!decision || decision.player !== viewerSeat) return null;
  if (decision.kind === "priority-window") {
    const top = view.stack[0];
    if (!top?.card) return null;
    const source = arenaCardByInstance(view, top.card.instanceId);
    if (!source) return null;
    const key = standingOrderKey(source.card);
    if (!key) return null;
    return { kind: "priority-window", key, card: source.card, seat: source.seat, ...layerLabel(top) };
  }
  if (decision.kind === "optional-effect") {
    if (decision.sourceInstanceId === undefined || !isYesNo(decision.options)) return null;
    const source = arenaCardByInstance(view, decision.sourceInstanceId);
    if (!source || source.seat !== viewerSeat) return null;
    const key = standingOrderKey(source.card);
    if (!key) return null;
    return {
      kind: "optional-trigger",
      key,
      card: source.card,
      seat: source.seat,
      label: decision.promptMessage ?? null,
      fallback: decision.prompt,
    };
  }
  return null;
}

/** The intent a standing order answers the current question with, when one
 * is set and the authoritative legal intents allow it. */
export function standingOrderAnswer(
  view: GameView,
  viewerSeat: number,
  orders: StandingOrders,
  legal: readonly GameIntent[],
): StandingOrderAnswer | null {
  const question = currentStandingOrderQuestion(view, viewerSeat);
  if (!question) return null;
  const order: StandingOrder | undefined = orders[question.key];
  if (question.kind === "priority-window") {
    // A decided optional trigger of the viewer's own card runs through its
    // priority windows too; the single row stands for both questions.
    const decidedOwnTrigger = question.seat === viewerSeat
      && (order?.optionalTrigger === "yes" || order?.optionalTrigger === "no");
    if (order?.priorityWindow !== "pass" && !decidedOwnTrigger) return null;
    if (!legal.some((intent) => intent.kind === "pass")) return null;
    return { question, intent: { kind: "pass" }, value: "pass" };
  }
  const value = order?.optionalTrigger;
  if (value !== "yes" && value !== "no") return null;
  if (!legal.some((intent) => intent.kind === "choose" && intent.optionId === value)) return null;
  return { question, intent: { kind: "choose", optionId: value }, value };
}

/** Functional key of the stack's top layer source, for the "Passed for you"
 * marker. */
export function topStackLayerKey(view: GameView): string | null {
  const top = view.stack[0];
  return top?.card ? standingOrderKey(top.card) : null;
}

const KIND_ORDER: StandingOrderKind[] = ["priority-window", "optional-trigger"];

/** Rows for one functional card: its printed turn triggers, every question
 * seen this game, and orders remembered in settings. Opponent-controlled cards
 * show only the viewer's own priority windows; their "you may" choices are
 * never the viewer's to answer. A card the viewer controls with an optional
 * trigger shows that choice alone, since deciding it also passes its windows. */
export function standingOrderRows(
  card: CardView,
  key: string,
  orders: StandingOrders,
  observed: ReadonlyMap<string, readonly ObservedStandingOrderQuestion[]>,
  controlledByViewer: boolean,
): StandingOrderRow[] {
  const stored = orders[key];
  const seen = observed.get(key) ?? [];
  const printed = card.turnTriggers ?? [];
  const optionalTrigger = printed.find((entry) => entry.optional);
  const asksToUse = controlledByViewer
    && (optionalTrigger !== undefined || seen.some((entry) => entry.kind === "optional-trigger"));
  return KIND_ORDER.flatMap((kind): StandingOrderRow[] => {
    if (kind === "optional-trigger" && !controlledByViewer) return [];
    if (kind === "priority-window" && asksToUse) return [];
    const observation = seen.find((entry) => entry.kind === kind);
    const trigger = kind === "priority-window" ? printed[0] : optionalTrigger;
    const storedOrder = kind === "priority-window" ? stored?.priorityWindow : stored?.optionalTrigger;
    if (!observation && !trigger && storedOrder === undefined) return [];
    return [{
      kind,
      timing: trigger?.event ?? null,
      label: observation?.label ?? trigger?.labelMessage ?? null,
      fallback: observation?.fallback ?? trigger?.label ?? null,
      order: storedOrder ?? "ask",
    }];
  });
}

/** Chip models for every arena card on the table that has at least one
 * automatable question, keyed by functional identity. */
export function standingOrderCardModels(
  view: GameView,
  viewerSeat: number,
  orders: StandingOrders,
  observed: ReadonlyMap<string, readonly ObservedStandingOrderQuestion[]>,
): Map<string, StandingOrderCardModel> {
  const models = new Map<string, StandingOrderCardModel>();
  for (const seat of [viewerSeat, 1 - viewerSeat]) {
    for (const card of arenaCards(view, seat)) {
      const key = standingOrderKey(card);
      if (!key || models.has(key)) continue;
      const rows = standingOrderRows(card, key, orders, observed, seat === viewerSeat);
      if (rows.length === 0) continue;
      models.set(key, { key, cardId: card.cardId, rows });
    }
  }
  return models;
}

/** Short order words shown on a set chip, in row order. */
export function activeOrderValues(rows: readonly StandingOrderRow[]): Array<"pass" | "yes" | "no"> {
  return rows.flatMap((row) => row.order === "ask" ? [] : [row.order]);
}

export interface StandingOrderFenceState {
  /** Room version the last automatic answer was sent against. */
  sentVersion: number | null;
  /** Question put on hold after an undo, until a different question comes up. */
  suspended: { key: string; kind: StandingOrderKind } | null;
}

export const INITIAL_STANDING_ORDER_FENCE: StandingOrderFenceState = {
  sentVersion: null,
  suspended: null,
};

/** Decide whether to send an automatic answer for this exact authoritative
 * state. Each room version is answered at most once, so a re-rendered or
 * re-delivered view never double-sends, and a question suspended by undo
 * waits until the viewer faces a different question. */
export function fenceStandingOrderAnswer(
  state: StandingOrderFenceState,
  input: {
    question: StandingOrderQuestion | null;
    answer: StandingOrderAnswer | null;
    roomVersion: number | null;
    enabled: boolean;
  },
): { state: StandingOrderFenceState; send: StandingOrderAnswer | null } {
  const { question, answer, roomVersion, enabled } = input;
  let suspended = state.suspended;
  if (
    suspended
    && (!question || question.key !== suspended.key || question.kind !== suspended.kind)
  ) {
    suspended = null;
  }
  const next = suspended === state.suspended ? state : { ...state, suspended };
  if (!enabled || !answer || roomVersion === null) return { state: next, send: null };
  if (suspended) return { state: next, send: null };
  if (state.sentVersion === roomVersion) return { state: next, send: null };
  return { state: { ...next, sentVersion: roomVersion }, send: answer };
}

/** Put the most recent automatic answer on hold: an undo means the viewer
 * wants to act in that window themselves. */
export function suspendStandingOrder(
  state: StandingOrderFenceState,
  last: { key: string; kind: StandingOrderKind } | null,
): StandingOrderFenceState {
  return last ? { ...state, suspended: { key: last.key, kind: last.kind } } : state;
}
