import type { GameIntent, MeldSide, PendingDecision } from "@fyendal/shared";
import type { Sel } from "./useActionAnnouncement.js";

type PaidIntent = Extract<
  GameIntent,
  { kind: "play-card" | "play-from-arsenal" | "play-from-zone" | "activate-ability" }
>;

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function sameOrderedIds(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function startsWithIds(sequence: readonly number[], prefix: readonly number[]): boolean {
  return prefix.length <= sequence.length && prefix.every((id, index) => id === sequence[index]);
}

type ResourcePayment = NonNullable<PendingDecision["resourcePayment"]>;

const MELD_SIDE_ORDER: readonly MeldSide[] = ["left", "right", "both"];

/** Meld modes the server currently permits for this selected card. This is
 * authoritative for timing/AP restrictions: during an opponent's priority
 * window, for example, an action/instant split offers only its instant side. */
export function offeredMeldSides(
  legal: readonly GameIntent[],
  sel: Sel,
): MeldSide[] {
  const offered = new Set<MeldSide>();
  for (const intent of legal) {
    if (intent.kind === "play-card" && sel.kind === "play-hand" &&
      intent.instanceId === sel.instanceId && intent.meldSide) {
      offered.add(intent.meldSide);
    } else if (intent.kind === "play-from-arsenal" && sel.kind === "play-arsenal" &&
      intent.instanceId === sel.instanceId && intent.meldSide) {
      offered.add(intent.meldSide);
    } else if (intent.kind === "play-from-zone" && sel.kind === "play-zone" &&
      intent.instanceId === sel.instanceId && intent.zone === sel.zone && intent.meldSide) {
      offered.add(intent.meldSide);
    }
  }
  return MELD_SIDE_ORDER.filter((side) => offered.has(side));
}

export function intentBoostCount(intent: PaidIntent): number {
  return intent.kind !== "activate-ability" && intent.boost === true
    ? (intent.boostCount ?? 1)
    : 0;
}

/** Exact server-owned payment option matching the hand cards selected so far. */
export function selectedResourcePaymentOption(
  payment: ResourcePayment,
  selected: readonly number[],
): ResourcePayment["options"][number] | null {
  return payment.options.find((option) => sameOrderedIds(option.pitchInstanceIds, selected)) ?? null;
}

/** A hand card is pitchable while at least one authoritative payment option
 * contains the resulting selection. */
export function canAddResourcePaymentPitch(
  payment: ResourcePayment,
  selected: readonly number[],
  instanceId: number,
): boolean {
  const next = [...selected, instanceId];
  return payment.options.some((option) => startsWithIds(option.pitchInstanceIds, next));
}

function sameOptionalIds(
  a: readonly number[] | undefined,
  b: readonly number[] | null,
): boolean {
  if (a === undefined || b === null) return a === undefined && b === null;
  return sameIds(a, b);
}

/** Server-offered variants for the selected source, play mode, and Meld side.
 * Target and Boost stay unresolved so the client can stage payment first. */
export function actionSelectionVariants(
  legal: readonly GameIntent[],
  sel: Sel,
  meldSide: MeldSide | null,
  asInstant = false,
): PaidIntent[] {
  return legal.filter((intent): intent is PaidIntent => {
    if (
      intent.kind !== "play-card" &&
      intent.kind !== "play-from-arsenal" &&
      intent.kind !== "play-from-zone" &&
      intent.kind !== "activate-ability"
    ) return false;
    // Activated abilities already have their timing fixed by the server-side
    // ability definition. They do not offer an action/instant play method.
    if (intent.kind === "activate-ability" && asInstant) return false;
    if (intent.kind !== "activate-ability" && (intent.asInstant ?? false) !== asInstant) return false;
    if (sel.kind === "play-hand" && intent.kind === "play-card") {
      return intent.instanceId === sel.instanceId && (intent.meldSide ?? null) === meldSide;
    }
    if (sel.kind === "play-arsenal" && intent.kind === "play-from-arsenal") {
      return intent.instanceId === sel.instanceId && (intent.meldSide ?? null) === meldSide;
    }
    if (sel.kind === "play-zone" && intent.kind === "play-from-zone") {
      return intent.instanceId === sel.instanceId && intent.zone === sel.zone &&
        (intent.meldSide ?? null) === meldSide;
    }
    if (sel.kind === "activate" && intent.kind === "activate-ability") {
      return intent.sourceInstanceId === sel.sourceInstanceId &&
        (intent.abilityIndex ?? 0) === (sel.abilityIndex ?? 0);
    }
    return false;
  });
}

/** Server-offered action variants matching every non-payment choice. */
export function actionVariants(
  legal: readonly GameIntent[],
  sel: Sel,
  meldSide: MeldSide | null,
  targetAllyId: number | null,
  targetCardInstanceId: number | null,
  boostCount = 0,
  asInstant = false,
): PaidIntent[] {
  return actionSelectionVariants(legal, sel, meldSide, asInstant).filter((intent) => {
    if ((intent.targetAllyId ?? null) !== targetAllyId) return false;
    if (
      intent.kind !== "activate-ability" &&
      (intent.targetCardInstanceId ?? null) !== targetCardInstanceId
    ) return false;
    return intentBoostCount(intent) === boostCount;
  });
}

/** Variants matching the payment staged in the first announcement step. */
export function paidActionVariants(
  variants: readonly PaidIntent[],
  pitchInstanceIds: readonly number[],
  alternativeCostCardInstanceIds: readonly number[] | null,
): PaidIntent[] {
  return variants.filter((intent) =>
    sameOrderedIds(intent.pitchInstanceIds, pitchInstanceIds) &&
    sameOptionalIds(intent.alternativeCostCardInstanceIds, alternativeCostCardInstanceIds),
  );
}

function pitchTotal(
  instanceIds: readonly number[],
  pitchValue: (instanceId: number) => number,
): number {
  return instanceIds.reduce((total, id) => total + pitchValue(id), 0);
}

/** Whether an exact client-selected pitch order pays this candidate. Pitching
 * must stop on the card that reaches the declared requirement. The server
 * repeats the full rules validation when the reconstructed intent arrives. */
export function candidatePaymentReady(
  intent: PaidIntent,
  selected: readonly number[],
  pitchValue: (instanceId: number) => number,
): boolean {
  if (intent.pitchRequired === undefined) {
    return sameOrderedIds(intent.pitchInstanceIds, selected);
  }
  if (selected.length === 0) return intent.pitchRequired === 0;
  const total = pitchTotal(selected, pitchValue);
  const beforeLast = pitchTotal(selected.slice(0, -1), pitchValue);
  return total >= intent.pitchRequired && beforeLast < intent.pitchRequired;
}

export function paidActionCandidates(
  variants: readonly PaidIntent[],
  selected: readonly number[],
  pitchValue: (instanceId: number) => number,
): PaidIntent[] {
  return variants.filter((intent) => candidatePaymentReady(intent, selected, pitchValue));
}

/** Resolve the selected structural candidate. For ordinary payment candidates,
 * attach the user's exact pitch order for authoritative server validation. */
export function selectedActionIntent(
  legal: readonly GameIntent[],
  sel: Sel,
  meldSide: MeldSide | null,
  targetAllyId: number | null,
  targetCardInstanceId: number | null,
  pitchInstanceIds: readonly number[],
  boostCount: number | null = 0,
  asInstant = false,
  alternativeCostCardInstanceIds: readonly number[] | null = null,
  pitchValue?: (instanceId: number) => number,
): PaidIntent | null {
  if (boostCount === null) return null;
  const variants = actionVariants(
    legal,
    sel,
    meldSide,
    targetAllyId,
    targetCardInstanceId,
    boostCount,
    asInstant,
  );
  const paymentVariants = variants.filter((intent) =>
    sameOptionalIds(intent.alternativeCostCardInstanceIds, alternativeCostCardInstanceIds),
  );
  const exactMatches = paidActionVariants(
    paymentVariants,
    pitchInstanceIds,
    alternativeCostCardInstanceIds,
  );
  const exact = pitchValue
    ? exactMatches.find((intent) => candidatePaymentReady(intent, pitchInstanceIds, pitchValue))
    : exactMatches[0];
  if (exact) return exact;
  if (!pitchValue) return null;
  const candidate = paidActionCandidates(paymentVariants, pitchInstanceIds, pitchValue)[0];
  return candidate ? { ...candidate, pitchInstanceIds: [...pitchInstanceIds] } : null;
}

/** Candidate mode allows any next pitch until the declared resource total is
 * reached. The legacy path still follows exact server-enumerated prefixes. */
export function canAddPitch(
  variants: readonly PaidIntent[],
  selected: readonly number[],
  instanceId: number,
  pitchValue?: (instanceId: number) => number,
): boolean {
  if (pitchValue) {
    const selectedTotal = pitchTotal(selected, pitchValue);
    return variants.some((intent) =>
      intent.pitchRequired !== undefined && selectedTotal < intent.pitchRequired
    );
  }
  const next = [...selected, instanceId];
  return variants.some((intent) => startsWithIds(intent.pitchInstanceIds, next));
}

/** Compact progress for a partially selected server-offered payment. The
 * denominator is the tightest offered pitch total that can still include the
 * current selection, so staged payment stays aligned with legal intents. */
export function pitchResourceProgress(
  variants: readonly PaidIntent[],
  selected: readonly number[],
  pitchValue: (instanceId: number) => number,
): { selected: number; required: number } | null {
  const explicitRequirements = variants.flatMap((intent) =>
    intent.pitchRequired === undefined ? [] : [intent.pitchRequired]
  );
  if (explicitRequirements.length > 0) {
    return {
      selected: pitchTotal(selected, pitchValue),
      required: Math.min(...explicitRequirements),
    };
  }
  const compatible = variants.filter((intent) =>
    startsWithIds(intent.pitchInstanceIds, selected),
  );
  if (compatible.length === 0) return null;
  return {
    selected: selected.reduce((total, id) => total + pitchValue(id), 0),
    required: Math.min(...compatible.map((intent) =>
      intent.pitchRequired ??
      intent.pitchInstanceIds.reduce((total, id) => total + pitchValue(id), 0)
    )),
  };
}

export function selectedDefendIntent(
  legal: readonly GameIntent[],
  defenderIds: readonly number[],
  pitchInstanceIds: readonly number[],
): Extract<GameIntent, { kind: "defend" }> | null {
  return legal.find(
    (intent): intent is Extract<GameIntent, { kind: "defend" }> =>
      intent.kind === "defend" &&
      sameIds(intent.instanceIds, defenderIds) &&
      sameOrderedIds(intent.pitchInstanceIds ?? [], pitchInstanceIds),
  ) ?? null;
}
