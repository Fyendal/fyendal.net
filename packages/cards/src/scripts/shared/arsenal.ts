import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "@fyendal/engine";
import { functionalKey, functionalKeyOf } from "../../functional.js";
import { commonOptionMessages, decisionPrompt, localizedLog } from "./messages.js";

const RELOAD_HOOK = "reload";

/** Hooks of reload decisions persisted before reload was shared. */
const LEGACY_RELOAD_HOOKS: ReadonlySet<string> = new Set([
  "aaz-reload",
  "arc-reload",
  "cru-high-reload",
  "ele-reload",
  "high-reload",
  "over-flex-reload",
]);

/** Reload (CR 8.5.23): if your arsenal is empty, you may put a card from your
 * hand into it face down. Answer with `resolveReload`. */
export function reload(ctx: ScriptCtx, hook = RELOAD_HOOK): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length > 0 || player.hand.length === 0) return;
  ctx.requestCardChoice(
    hook,
    decisionPrompt("Reload: put a card from your hand into your arsenal?", "card.common.reload", {
      optionMessages: commonOptionMessages("pass"),
    }),
    ["pass", ...player.hand.map((card) => card.instanceId)],
  );
}

/** Answers a `reload` choice; true when `hook` was it. */
export function resolveReload(ctx: ScriptCtx, hook: string, option: string, expected = RELOAD_HOOK): boolean {
  if (hook !== expected && !(expected === RELOAD_HOOK && LEGACY_RELOAD_HOOKS.has(hook))) return false;
  if (option !== "pass") ctx.putIntoArsenal(Number(option), "hand", { faceUp: false });
  return true;
}

/** Mentor payoff: banish self from arsenal, search deck for a card into arsenal, shuffle. */
export function mentorPayoff(ctx: ScriptCtx, searchName: string, searchPitch?: number): void {
  const p = ctx.player(ctx.seat);
  if (p.arsenal.some((c) => c.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} is banished`,
        "card.log.common.banished",
        { card: { kind: "card", cardId: ctx.self.cardId } },
        {
          kind: "card-moved",
          cardId: ctx.self.cardId,
          ownerSeat: ctx.seat,
          from: "arsenal",
          to: "banish",
        },
      ),
    );
  }
  const key = functionalKey(searchName, searchPitch);
  const found = p.deck.find((c) => functionalKeyOf(ctx.cardData(c.cardId)) === key);
  if (found && ctx.putIntoArsenal(found.instanceId, "deck")) {
    ctx.logPrivate(
      ctx.seat,
      localizedLog(
        `searched ${ctx.cardData(found.cardId).name} into arsenal`,
        "card.log.common.mentor.search.private",
        { result: { kind: "card", cardId: found.cardId } },
        {
          kind: "card-moved",
          cardId: found.cardId,
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
      localizedLog("searched a card into arsenal", "card.log.common.mentor.search.public", undefined, {
        kind: "card-moved",
        ownerSeat: ctx.seat,
        from: "deck",
        to: "arsenal",
      }),
    );
  }
  ctx.shuffleDeck();
}

function isSpecialization(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return (ctx.cardData(card.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase().includes("specialization"));
}

/** Mentor payoff that searches for a specialization; answer with `resolveMentorSpecializationChoice`. */
export function mentorSpecializationPayoff(ctx: ScriptCtx, hook: string): void {
  if (ctx.player(ctx.seat).arsenal.some((card) => card.instanceId === ctx.self.instanceId)) {
    ctx.banish(ctx.self.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} is banished`,
        "card.log.common.banished",
        { card: { kind: "card", cardId: ctx.self.cardId } },
        {
          kind: "card-moved",
          cardId: ctx.self.cardId,
          ownerSeat: ctx.seat,
          from: "arsenal",
          to: "banish",
        },
      ),
    );
  }
  const choices = ctx.player(ctx.seat).deck.filter((card) => isSpecialization(ctx, card));
  if (choices.length === 0) {
    ctx.shuffleDeck();
    return;
  }
  ctx.requestCardChoice(
    hook,
    decisionPrompt(
      `${ctx.data.name}: choose a specialization card to put face up into arsenal`,
      "card.common.specialization.arsenal",
      { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
    ),
    choices.map((card) => card.instanceId),
  );
}

/** Answers `mentorSpecializationPayoff`; true when `receivedHook` was it. */
export function resolveMentorSpecializationChoice(
  ctx: ScriptCtx,
  hook: string,
  receivedHook: string,
  option: string,
): boolean {
  if (receivedHook !== hook) return false;
  const card = ctx
    .player(ctx.seat)
    .deck.find((candidate) => candidate.instanceId === Number(option) && isSpecialization(ctx, candidate));
  if (card && ctx.putIntoArsenal(card.instanceId, "deck")) {
    ctx.logPrivate(
      ctx.seat,
      localizedLog(
        `searched ${ctx.cardData(card.cardId).name} into arsenal`,
        "card.log.common.mentor.search.private",
        { result: { kind: "card", cardId: card.cardId } },
        {
          kind: "card-moved",
          cardId: card.cardId,
          ownerSeat: ctx.seat,
          from: "deck",
          to: "arsenal",
        },
      ),
      localizedLog("searched a card into arsenal", "card.log.common.mentor.search.public", undefined, {
        kind: "card-moved",
        ownerSeat: ctx.seat,
        from: "deck",
        to: "arsenal",
      }),
    );
  }
  ctx.shuffleDeck();
  return true;
}

/** Mentor flip: optional start-of-turn "Turn face up?" trigger while face down in arsenal. */
export function mentorFlipTrigger(): TriggerDef {
  return {
    event: "start-of-turn",
    condition: (ctx) => ctx.self.faceDown === true,
    optional: true,
    label: "Turn face up?",
    onAccept(ctx) {
      ctx.flipFaceUp();
    },
  };
}

/** Add a lesson counter to self; counters live on the card and persist across turns. */
export function lessonCounter(ctx: ScriptCtx): number {
  const n = ctx.getCounter("lessons") + 1;
  ctx.setCounter("lessons", n);
  ctx.logPublic(
    localizedLog(`${ctx.data.name} gets a lesson counter (${n})`, "card.log.common.lesson.counter.gained", {
      card: { kind: "card", cardId: ctx.self.cardId },
      count: n,
    }),
  );
  return n;
}

const SPIRE_SNIPING_FIRST_HOOK = "spire-sniping-first";

const SPIRE_SNIPING_LAST_HOOK = "spire-sniping-last";

function requestSpireSnipingCard(ctx: ScriptCtx, hook: string, cards: readonly DeepReadonly<CardInstance>[]): void {
  // Looking at the top cards is not a search, so this bypasses the
  // deck-search prohibition that requestCardChoice applies to deck cards.
  ctx.requestChoice(
    hook,
    decisionPrompt(
      "Choose the next card to put back on top of your deck; the last card put back ends on top",
      "card.common.spire.order.next",
    ),
    cards.map((card) => String(card.instanceId)),
    undefined,
    cards.map((card) => card.instanceId),
  );
}

/** Spire Sniping: the controller puts the top two cards back one at a time;
 * the last card put back ends on top. */
export function spireSnipingScript(): CardScript {
  return {
    onEnterArsenalWhenTurnedFaceUp: true,
    onEnterArsenal(ctx) {
      const top = ctx.player(ctx.seat).deck.slice(0, 2);
      for (const card of top) ctx.lookAt(card.instanceId);
      if (top.length === 2) requestSpireSnipingCard(ctx, SPIRE_SNIPING_FIRST_HOOK, top);
    },
    onChoose(ctx, hook, option) {
      const deck = ctx.player(ctx.seat).deck;
      const instanceId = Number(option);
      if (hook === SPIRE_SNIPING_FIRST_HOOK) {
        if (!deck.slice(0, 2).some((card) => card.instanceId === instanceId)) return;
        ctx.putOnDeckTop(instanceId);
        // The other card now sits directly beneath the one just put back.
        const last = ctx.player(ctx.seat).deck[1];
        if (last) requestSpireSnipingCard(ctx, SPIRE_SNIPING_LAST_HOOK, [last]);
      } else if (hook === SPIRE_SNIPING_LAST_HOOK && deck[1]?.instanceId === instanceId) {
        ctx.putOnDeckTop(instanceId);
      }
    },
  };
}
