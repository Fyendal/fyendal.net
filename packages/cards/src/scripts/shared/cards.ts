import type { CardInstance, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import { functionalKey } from "../../functional.js";

type Card = DeepReadonly<CardInstance>;

/** Effective class, talent or subtype (case-insensitive). Card types use `ctx.hasCardType`. */
export function hasCardSubtype(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.trim().toLowerCase());
}

export function isAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && hasCardSubtype(ctx, card, "attack");
}

export function isNonAttackAction(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && !hasCardSubtype(ctx, card, "attack");
}

export function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "aura");
}

/** An aura of suspense: an aura with Suspense. */
export function isSuspenseAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return isAura(ctx, card) && ctx.hasKeyword(card, "suspense");
}

export function isTokenAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "token") && isAura(ctx, card);
}

export function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "arrow");
}

export function isSword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "sword");
}

export function isDagger(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasCardSubtype(ctx, card, "dagger");
}

/** Whether a card currently has a name: printed, gained from an effect, or
 * held in all zones. Cards whose names are suppressed have no name. */
export function cardNamed(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return ctx.cardNames(card).includes(name.trim().toLowerCase());
}

/** Active face's printed name while the card still has it, else its first effective name. */
export function effectiveCardName(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): string | undefined {
  const front = ctx.cardData(card.cardId);
  const printed = card.flipped && front.backId ? ctx.cardData(front.backId).name : front.name;
  return cardNamed(ctx, card, printed) ? printed : ctx.cardNames(card)[0];
}

/** Whether two cards share at least one effective name. */
export function sharesName(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  other: DeepReadonly<CardInstance>,
): boolean {
  const names = ctx.cardNames(other);
  return ctx.cardNames(card).some((name) => names.includes(name));
}

/** Match "with WORDS in its name" using whole words across every effective
 * name, including names gained from effects. */
export function cardNameContains(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance>,
  ...parts: readonly string[]
): boolean {
  return ctx.cardNames(card).some((name) => {
    const words = name.split(/\s+/);
    return parts.some((part) => {
      const wanted = part.trim().toLowerCase().split(/\s+/);
      return words.some((_, index) => wanted.every((word, offset) => words[index + offset] === word));
    });
  });
}

/** Reprint-safe identity check: true if the card is functionally the named card. */
export function isCard(ctx: ScriptCtx, cardId: string, name: string, pitch?: number): boolean {
  const d = ctx.cardData(cardId);
  return functionalKey(d.name, d.pitch) === functionalKey(name, pitch);
}

export function isSixPlus(ctx: ScriptCtx, card: DeepReadonly<CardInstance> | undefined): boolean {
  if (!card) return false;
  return ctx.basePower(card) >= 6;
}

export function isItem(ctx: ScriptCtx, card: Card): boolean {
  return hasCardSubtype(ctx, card, "item");
}

export function isAlly(ctx: ScriptCtx, card: Card): boolean {
  return hasCardSubtype(ctx, card, "ally");
}

export function isPirate(ctx: ScriptCtx, card: Card): boolean {
  return hasCardSubtype(ctx, card, "pirate");
}

export function isLight(ctx: ScriptCtx, card: Card): boolean {
  return hasCardSubtype(ctx, card, "light");
}

export function isWizardNonAttack(ctx: ScriptCtx, card: Card): boolean {
  return isNonAttackAction(ctx, card) && hasCardSubtype(ctx, card, "wizard");
}
