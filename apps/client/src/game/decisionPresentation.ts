import type { CardView, PendingDecision } from "@fyendal/shared";

export type BloodAllocationMode = "power" | "go-again" | "extra-attack";

export interface BloodAllocationControl {
  mode: BloodAllocationMode;
  count: number;
  decrementOption: string;
  incrementOption: string;
}

export interface BloodAllocationWeapon {
  card: CardView;
  controls: BloodAllocationControl[];
}

export interface BloodModeAllocation {
  selected: number;
  required: number;
  confirmOption: string;
  weapons: BloodAllocationWeapon[];
}

const BLOOD_MODE_ORDER: BloodAllocationMode[] = ["power", "go-again", "extra-attack"];

/** Decode Blood on Her Hands' authoritative adjustment options into the
 * weapon-by-mode grid used by the decision window. Counts remain engine-owned;
 * the client only renders the current snapshot and submits one adjustment. */
export function bloodModeAllocation(
  decision: PendingDecision | null,
): BloodModeAllocation | null {
  if (decision?.kind !== "choose-target" || !decision.options || !decision.optionCards) return null;
  const confirmOption = decision.options.find((option) => /^blood-mode:confirm:\d+:\d+$/.test(option));
  if (!confirmOption) return null;
  const confirm = /^blood-mode:confirm:(\d+):(\d+)$/.exec(confirmOption)!;
  const selected = Number(confirm[1]);
  const required = Number(confirm[2]);
  const weapons = new Map<number, { card: CardView; controls: Map<BloodAllocationMode, BloodAllocationControl> }>();

  decision.options.forEach((option, index) => {
    const match = /^blood-mode:(decrement|increment):(power|go-again|extra-attack):(\d+):(\d+):(\d+):(\d+)$/.exec(option);
    if (!match) return;
    const operation = match[1]!;
    const mode = match[2] as BloodAllocationMode;
    const weaponId = Number(match[3]);
    const count = Number(match[4]);
    if (Number(match[5]) !== selected || Number(match[6]) !== required) return;
    const card = decision.optionCards?.[index];
    if (!card || card.instanceId !== weaponId) return;
    let weapon = weapons.get(weaponId);
    if (!weapon) {
      weapon = { card, controls: new Map() };
      weapons.set(weaponId, weapon);
    }
    const control = weapon.controls.get(mode) ?? {
      mode,
      count,
      decrementOption: "",
      incrementOption: "",
    };
    if (control.count !== count) return;
    if (operation === "decrement") control.decrementOption = option;
    else control.incrementOption = option;
    weapon.controls.set(mode, control);
  });

  const parsedWeapons = [...weapons.values()].map(({ card, controls }) => ({
    card,
    controls: BLOOD_MODE_ORDER.flatMap((mode) => {
      const control = controls.get(mode);
      return control?.decrementOption && control.incrementOption ? [control] : [];
    }),
  }));
  if (parsedWeapons.length === 0 || parsedWeapons.some((weapon) => weapon.controls.length !== BLOOD_MODE_ORDER.length)) return null;
  return { selected, required, confirmOption, weapons: parsedWeapons };
}

export function optDecisionCards(
  decision: PendingDecision | null,
): Array<{ id: string; card: CardView }> | null {
  if (
    decision === null ||
    decision.kind === "defend" ||
    decision.kind === "arsenal" ||
    !(decision.options?.length) ||
    // per-card top/bottom pairs plus an optional early-exit "pass"
    !decision.options.every((option) => option === "pass" || /^(top|bottom):\d+$/.test(option))
  ) return null;

  const cards: Array<{ id: string; card: CardView }> = [];
  const seen = new Set<string>();
  decision.options.forEach((option, index) => {
    const id = option.split(":")[1]!;
    const card = decision.optionCards?.[index];
    if (card && !seen.has(id)) {
      seen.add(id);
      cards.push({ id, card });
    }
  });
  // a pass-only option set (look-at acknowledgment) is not an opt decision
  return cards.length > 0 ? cards : null;
}

/** Map a scripted choice whose complete option set is in hand to card clicks. */
export function handCardChoiceOptions(
  decision: PendingDecision | null,
  hand: readonly CardView[],
): Map<number, string> | null {
  if (
    decision === null ||
    decision.kind === "defend" ||
    decision.kind === "arsenal" ||
    optDecisionCards(decision) !== null ||
    !(decision.options?.length) ||
    decision.options.length !== (decision.optionCards?.length ?? 0)
  ) return null;

  const handIds = new Set(hand.map((card) => card.instanceId));
  const options = new Map<number, string>();
  for (let index = 0; index < decision.options.length; index += 1) {
    const card = decision.optionCards?.[index];
    if (!card || !handIds.has(card.instanceId)) return null;
    options.set(card.instanceId, decision.options[index]!);
  }
  return options;
}
