import type { ActivatedAbility, CardScript, ScriptCtx } from "@fyendal/engine";

/** Merge a set's partitions, rejecting duplicate functional keys. */
export function mergeSetScripts(
  set: string,
  ...parts: readonly Readonly<Record<string, CardScript>>[]
): Record<string, CardScript> {
  const merged: Record<string, CardScript> = {};
  for (const part of parts) {
    for (const [key, script] of Object.entries(part)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(`duplicate functional script key "${key}" within set ${set}`);
      }
      merged[key] = script;
    }
  }
  return merged;
}

/** An ability whose only effect is gaining `amount`; `resourceSource` reuses it so auto-pass can't drift. */
export function resourceAbility(
  amount: number,
  ability: Omit<ActivatedAbility, "onActivate" | "resourceSource">,
  afterGain?: (ctx: ScriptCtx, amount: number) => void,
): ActivatedAbility {
  return {
    ...ability,
    resourceSource: amount,
    onActivate(ctx) {
      ctx.gainResources(ctx.seat, amount);
      afterGain?.(ctx, amount);
    },
  };
}

/** Register one script under every pitch of a functional name. */
export function pitches(name: string, factory: (pitch: 1 | 2 | 3) => CardScript): Record<string, CardScript> {
  return Object.fromEntries(([1, 2, 3] as const).map((pitch) => [`${name}|${pitch}`, factory(pitch)]));
}

interface SplitSides {
  leftName: string;
  rightName: string;
  left(ctx: ScriptCtx): void;
  right(ctx: ScriptCtx): void;
}

/** A split meld card: action on the left, instant on the right. */
export function splitScript(sides: SplitSides): CardScript {
  return {
    meld: {
      leftName: sides.leftName,
      rightName: sides.rightName,
      leftCardType: "action",
      rightCardType: "instant",
    },
    onPlay(ctx) {
      if (ctx.self.meldSide === "left") sides.left(ctx);
      else if (ctx.self.meldSide === "right") sides.right(ctx);
      else if (ctx.self.meldSide === "both") {
        sides.right(ctx);
        sides.left(ctx);
      }
    },
  };
}
