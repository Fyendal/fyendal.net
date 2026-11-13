import type { CardInstance, DamageEventContext, DeepReadonly, ScriptCtx, TriggerEventContext } from "@fyendal/engine";
import { cardNameContains, cardNamed, isAura, isSixPlus, isSword } from "./cards.js";

type Card = DeepReadonly<CardInstance>;

export function targetsHero(ctx: ScriptCtx): boolean {
  return ctx.link?.targetAllyId === undefined;
}

/** "If you are X": whether the seat's current hero has that moniker. A suffix
 * after the comma is not part of the moniker (CR 2.7.3). */
export function heroHasMoniker(ctx: ScriptCtx, seat: number, moniker: string): boolean {
  const personalName = ctx.cardData(ctx.player(seat).heroCardId).name.split(",")[0]!;
  return personalName.toLowerCase().split(/\s+/).includes(moniker.toLowerCase());
}

export function opponentSeat(ctx: ScriptCtx): number {
  return ctx.seat === 0 ? 1 : 0;
}

/** Graveyard cards an effect may refer to; face-down ones are private (CR 3.0.4e). */
export function faceUpGraveyard(ctx: ScriptCtx, seat = ctx.seat): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).graveyard.filter((card) => !card.faceDown);
}

/** Grant `seat` +1 intellect during the end phase of `turn`; repeated grants for that turn stack. */
export function grantEndPhaseIntellect(ctx: ScriptCtx, seat: number, turn: number): void {
  const hero = ctx.player(seat).hero;
  const pending = Number(hero.scriptState?.bonusIntellectAtEndPhaseTurn ?? 0) === turn
    ? Number(hero.scriptState?.bonusIntellectAtEndPhaseCount ?? 1)
    : 0;
  ctx.setCardState(hero.instanceId, "bonusIntellectAtEndPhaseTurn", turn);
  ctx.setCardState(hero.instanceId, "bonusIntellectAtEndPhaseCount", pending + 1);
}

/** "card-moved-from-deck-by-effect" condition for "when an activated ability
 * or action card effect puts this face-up into a zone from your deck". The
 * engine reports only face-up deck moves. */
export function effectPutSelfFaceUpFromDeck(
  ctx: ScriptCtx,
  card: DeepReadonly<CardInstance> | undefined,
  event: TriggerEventContext | undefined,
): boolean {
  return card?.instanceId === ctx.self.instanceId && event?.to !== "hand" &&
    (event?.effectSource === "action-card" || event?.effectSource === "activated-ability");
}

/** A "damage-dealt" event's facts when a hero, not an ally, was dealt the damage. */
export function heroDamage(event: TriggerEventContext | undefined): DamageEventContext | undefined {
  const damage = event?.damage;
  return damage && damage.targetAllyInstanceId === undefined ? damage : undefined;
}

/** Hero damage dealt to a hero other than this trigger controller's. */
export function opposingHeroDamage(
  ctx: ScriptCtx,
  event: TriggerEventContext | undefined,
): DamageEventContext | undefined {
  const damage = heroDamage(event);
  return damage && damage.targetSeat !== ctx.seat ? damage : undefined;
}

/** The damage-dealt event's source is this trigger's own card. */
export function dealtByThis(ctx: ScriptCtx, eventCard: DeepReadonly<CardInstance> | undefined): boolean {
  return eventCard?.instanceId === ctx.self.instanceId;
}

/** The latest resolved link's attack; the active link is unresolved during Combo checks. */
function previousAttack(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  return [...ctx.state.chain].reverse().find((link) => link.resolved)?.attackingCard;
}

/** Match a Combo name against every effective name of the previous attack,
 * including names gained by effects such as Be Like Water. */
export function previousAttackHasName(ctx: ScriptCtx, ...names: readonly string[]): boolean {
  const previous = previousAttack(ctx);
  if (!previous) return false;
  const wanted = new Set(names.map((name) => name.trim().toLowerCase()));
  return ctx.cardNames(previous).some((name) => wanted.has(name));
}

/** Match "with WORDS in its name" Combo conditions using whole words, as
 * required by the name-property rules, across every effective name. */
export function previousAttackNameContains(ctx: ScriptCtx, ...parts: readonly string[]): boolean {
  const previous = previousAttack(ctx);
  return !!previous && cardNameContains(ctx, previous, ...parts);
}

export function isWeaponAttack(ctx: ScriptCtx): boolean {
  return ctx.link?.attackCardType === "weapon";
}

export function isSwordAttack(ctx: ScriptCtx): boolean {
  const link = ctx.link;
  if (!link || link.attackCardType !== "weapon") return false;
  return isSword(ctx, link.attackingCard);
}

export function attackedWithWeapon(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "attackedWithWeaponThisTurn") === true;
}

/** Reprise: the current attack was defended by a card from hand. */
export function reprise(ctx: ScriptCtx): boolean {
  return ctx.link?.flags.defendedFromHand === true;
}

export function weaponAttackCount(ctx: ScriptCtx): number {
  return Number(ctx.getFlag("player", "weaponAttackCount")) || 0;
}

/** Flip the controller's double-faced hero; returns the face it flipped into. */
export function flipHero(ctx: ScriptCtx): "front" | "back" | undefined {
  const hero = ctx.player(ctx.seat).hero;
  const backId = ctx.cardData(hero.cardId).backId;
  if (backId) {
    ctx.becomeHero(backId);
    return "back";
  }
  const frontId = hero.originalHeroCardId;
  if (frontId && ctx.cardData(frontId).backId === hero.cardId) {
    ctx.becomeHero(frontId);
    return "front";
  }
  return undefined;
}

/** Whether this source's until-end-of-turn effect is still live, even after the source left the arena. */
export function hasLiveTurnEffect(ctx: ScriptCtx): boolean {
  return ctx.state.modifiers.some(
    (modifier) =>
      modifier.sourceInstanceId === ctx.self.instanceId &&
      modifier.scope === "until-end-of-turn" &&
      !modifier.consumed,
  );
}

/** Cards in a player's equipment zones only; see `equippedCards` for "equipment you control". */
export function equipmentZoneCards(player: Pick<ReturnType<ScriptCtx["player"]>, "equipment">): Card[] {
  return Object.values(player.equipment).filter((card): card is Card => card !== undefined);
}

/** Equipment the seat controls: equipment zones plus equipment-typed weapons (Parry Blade, Nitro Mechanoid). */
export function equippedCards(ctx: ScriptCtx, seat: number): Card[] {
  const player = ctx.player(seat);
  return [
    ...equipmentZoneCards(player),
    ...player.weapons.filter((card) => ctx.hasCardType(card, "equipment")),
  ];
}

/** Non-hero permanents the seat controls: board, weapon zones and equipment zones. */
export function controlledPermanents(ctx: ScriptCtx, seat = ctx.seat): Card[] {
  const player = ctx.player(seat);
  return [
    ...player.board,
    ...player.weapons,
    ...equipmentZoneCards(player),
  ];
}

export function controlsNamed(ctx: ScriptCtx, name: string): boolean {
  return controlledPermanents(ctx).some((card) => cardNamed(ctx, card, name));
}

export function countAuras(ctx: ScriptCtx): number {
  return ctx.player(ctx.seat).board.filter((card) => isAura(ctx, card)).length;
}

export function isOnCombatChain(ctx: ScriptCtx, instanceId: number): boolean {
  return ctx.state.chain.some((link) =>
    [link.attackingCard, ...link.defendingCards, ...link.defendingEquipment, ...link.reactions].some(
      (card) => card.instanceId === instanceId,
    ),
  );
}

export function reactionCount(ctx: ScriptCtx): number {
  return Number(ctx.getFlag("link", "reactionCount"));
}

/** Another card from hand defends alongside this one. */
export function defendsTogetherWithCardFromHand(ctx: ScriptCtx): boolean {
  if (!ctx.link) return false;
  const count = Number(ctx.link.flags.defendedFromHandCount ?? 0);
  const selfWasFromHand = ctx.link.flags[`defendedFromHand:${ctx.self.instanceId}`] === true ? 1 : 0;
  return count > selfWasFromHand;
}

/** Both heroes, controller first. */
export function bothHeroSeats(ctx: ScriptCtx): number[] {
  return [ctx.seat, opponentSeat(ctx)];
}

/** The active link is this seat's unresolved attack. */
export function isOwnAttack(ctx: ScriptCtx): boolean {
  return !!ctx.link && !ctx.link.resolved && ctx.link.attacker === ctx.seat;
}

export function attackTypes(ctx: ScriptCtx): readonly string[] {
  if (!ctx.link) return [];
  return ctx.cardTypes(ctx.link.attackingCard);
}

/** The action phase, including its combat steps and layers not resolving at a phase boundary. */
export function duringActionPhase(ctx: ScriptCtx): boolean {
  if (ctx.state.phase === "action" || ctx.state.phase === "defend" || ctx.state.phase === "reaction") return true;
  return (
    ctx.state.phase === "layer" &&
    ctx.state.stackResume !== "begin-action-phase" &&
    ctx.state.stackResume !== "end-phase"
  );
}

export function chargedThisTurn(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "chargedThisTurn") === true;
}

export function boostedThisTurn(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "boostedThisTurn") === true;
}

export function boostedLinks(ctx: ScriptCtx): number {
  return ctx.state.chain.filter((link) => link.attacker === ctx.seat && link.flags.boosted === true).length;
}

export function pitchedBlue(ctx: ScriptCtx): boolean {
  return ctx.pitchedThisTurn({ color: "blue" }) > 0;
}

export function playedLightning(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "playedSubtype:lightning") === true;
}

export function playedOrCreatedAura(ctx: ScriptCtx): boolean {
  return ctx.getFlag("player", "playedSubtype:aura") === true || ctx.getFlag("player", "createdSubtype:aura") === true;
}

/** A token was created this turn. */
export function createdThisTurn(ctx: ScriptCtx): boolean {
  return Number(ctx.getFlag("player", "createdThisTurn")) > 0;
}

/** High tide: two or more blue cards in your pitch zone. */
export function highTide(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).pitch.filter((card) => ctx.cardColor(card) === 3).length >= 2;
}

export function hasSixPlusInPitch(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).pitch.some((card) => isSixPlus(ctx, card));
}

export function draconicLinks(ctx: ScriptCtx): number {
  return ctx.chainLinksControlled(ctx.seat, "draconic");
}

export function currentAttackDraconic(ctx: ScriptCtx): boolean {
  return ctx.currentAttackHasType("draconic");
}

/** The resolving card is already counted, so 2 means another red. */
export function playedAnotherRed(ctx: ScriptCtx): boolean {
  return ctx.playedThisTurn("red") >= 2;
}

/** The resolving card is already counted, so 2 means another blue. */
export function playedAnotherBlue(ctx: ScriptCtx): boolean {
  return ctx.playedThisTurn("blue") >= 2;
}

export function transcendIfBlue(ctx: ScriptCtx): void {
  if (playedAnotherBlue(ctx)) ctx.transcend();
}
