import type { CardInstance, CardScript, DeepReadonly, ScriptCtx, TriggerDef } from "@fyendal/engine";
import type { GameMessage } from "@fyendal/shared";
import { FROSTBITE } from "../tokens.js";
import { hasCardSubtype } from "./cards.js";
import { commonOptionMessages, decisionMessage, decisionPrompt } from "./messages.js";
import { faceUpGraveyard } from "./state.js";

/** Channel Lightning: at the beginning of the controller's end phase add a
 * flow counter, then put one Lightning card from pitch on the bottom per flow
 * counter or destroy this. `remainingKey` tracks unpaid cards across the
 * resumable `hook` choices. */
export function channelLightning(
  remainingKey: string,
  hook: string,
): { triggers: TriggerDef[]; onChoose: NonNullable<CardScript["onChoose"]> } {
  const payNext = (ctx: ScriptCtx): void => {
    const remaining = ctx.getState(remainingKey);
    if (remaining <= 0) return;
    const lightning = ctx.player(ctx.seat).pitch.filter((card) => hasCardSubtype(ctx, card, "lightning"));
    if (lightning.length < remaining) {
      ctx.destroySelf();
      return;
    }
    ctx.requestCardChoice(
      hook,
      decisionPrompt("Put a Lightning card from pitch on the bottom", "card.ele.pitch.card.bottom", {
        values: { type: "Lightning" },
      }),
      lightning.map((card) => card.instanceId),
    );
  };
  return {
    triggers: [
      {
        event: "end-of-turn",
        label: "Channel Lightning",
        labelMessage: { id: "card.trigger.common.channel.lightning" },
        effect(ctx) {
          const flow = ctx.getCounter("flow") + 1;
          ctx.setCounter("flow", flow);
          ctx.setState(remainingKey, flow);
          payNext(ctx);
        },
      },
    ],
    onChoose(ctx, choiceHook, option) {
      if (choiceHook !== hook) return;
      if (ctx.putOnDeckBottom(Number(option))) {
        ctx.setState(remainingKey, ctx.getState(remainingKey) - 1);
        payNext(ctx);
      }
    },
  };
}

type FusionType = "earth" | "ice" | "lightning";

const ELEMENTAL_FUSION_HOOK = "elemental-fusion";

/** Hooks of decisions persisted before fusion was shared. */
const LEGACY_FUSION_HOOKS: Readonly<Record<string, string>> = {
  fusion: "lightning-fusion",
  "high-fuse:earth": "earth-fusion",
  "high-fuse:ice": "ice-fusion",
  "high-fuse:lightning": "lightning-fusion",
  "upr-high-fuse": "ice-fusion",
  "ajv-fusion": ELEMENTAL_FUSION_HOOK,
  "oaken-fuse-ice": "ice-fusion",
};

function fusionLabel(type: FusionType): string {
  return type[0]!.toUpperCase() + type.slice(1);
}

/** Whether this card was fused. */
export function isFused(ctx: ScriptCtx): boolean {
  return ctx.getState("fused") > 0;
}

/** Whether this card was fused with a card of `type`. */
export function isFusedWith(ctx: ScriptCtx, type: FusionType): boolean {
  return ctx.getState(`fused:${type}`) > 0;
}

/** Isenhowl Weathervane: "the next time you Ice fuse this turn". */
export function isenhowlFrostbitesKey(targetSeat: number): string {
  return `nextIceFusionFrostbites:${targetSeat}`;
}

function completeFusion(
  ctx: ScriptCtx,
  revealed: readonly { card: DeepReadonly<CardInstance>; type: FusionType }[],
): void {
  if (revealed.length === 0 || !ctx.revealCards([...new Set(revealed.map(({ card }) => card.instanceId))])) return;
  ctx.setState("fused", 1);
  ctx.setFlag("player", "fusedThisTurn", true);
  for (const { type } of revealed) {
    ctx.setState(`fused:${type}`, 1);
    ctx.setFlag("player", `${type}FusedThisTurn`, true);
  }
  if (!revealed.some(({ type }) => type === "ice")) return;
  for (const player of ctx.state.players) {
    const key = isenhowlFrostbitesKey(player.seat);
    const count = Number(ctx.getPlayerFlag(ctx.seat, key));
    if (count > 0) ctx.createTokens(FROSTBITE, count, player.seat);
    ctx.setPlayerFlag(ctx.seat, key, 0);
  }
}

function fusionCandidates(ctx: ScriptCtx, type: FusionType): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).hand.filter((card) => hasCardSubtype(ctx, card, type));
}

function handCard(ctx: ScriptCtx, option: string | number, type: FusionType): DeepReadonly<CardInstance> | undefined {
  return fusionCandidates(ctx, type).find((card) => card.instanceId === Number(option));
}

function requestFusionReveal(ctx: ScriptCtx, type: FusionType): void {
  const matches = fusionCandidates(ctx, type);
  if (matches.length === 0) return;
  const label = fusionLabel(type);
  ctx.requestCardChoice(
    `${type}-fusion`,
    decisionPrompt(
      `${ctx.data.name}: reveal ${type === "lightning" ? "a" : "an"} ${label} card to fuse?`,
      "card.ele.fusion.reveal.named",
      {
        values: { card: { kind: "card", cardId: ctx.self.cardId }, type: label },
        optionMessages: commonOptionMessages("no"),
      },
    ),
    ["no", ...matches.map((card) => card.instanceId)],
  );
}

function requestElementalFusion(ctx: ScriptCtx, first: FusionType, second: FusionType): void {
  const hand = ctx.player(ctx.seat).hand;
  const firstCards = fusionCandidates(ctx, first);
  const secondCards = fusionCandidates(ctx, second);
  const firstLabel = fusionLabel(first);
  const secondLabel = fusionLabel(second);
  const options = new Set<string>(["no"]);
  for (const card of firstCards) options.add(`${first}:${card.instanceId}`);
  for (const card of secondCards) options.add(`${second}:${card.instanceId}`);
  for (const a of firstCards)
    for (const b of secondCards) options.add(`both:${a.instanceId}:${b.instanceId}`);
  if (options.size === 1) return;
  const optionMessages: Record<string, GameMessage> = { ...commonOptionMessages("no") };
  for (const option of options) {
    const [kind, firstId, secondId] = option.split(":");
    const a = hand.find((card) => card.instanceId === Number(firstId));
    const b = hand.find((card) => card.instanceId === Number(secondId));
    if (!a) continue;
    optionMessages[option] =
      kind !== "both"
        ? decisionMessage("card.ele.fusion.option.single", {
            card: { kind: "card", cardId: a.cardId },
            type: kind === first ? firstLabel : secondLabel,
          })
        : a.instanceId === b?.instanceId
          ? decisionMessage("card.ele.fusion.option.both.single", {
              card: { kind: "card", cardId: a.cardId },
              firstType: firstLabel,
              secondType: secondLabel,
            })
          : decisionMessage("card.ele.fusion.option.both", {
              first: { kind: "card", cardId: a.cardId },
              second: { kind: "card", cardId: b!.cardId },
              firstType: firstLabel,
              secondType: secondLabel,
            });
  }
  ctx.requestChoice(
    ELEMENTAL_FUSION_HOOK,
    decisionPrompt(`Reveal ${first} and/or ${second} cards to fuse?`, "card.ele.fusion.multiple", {
      values: { firstType: firstLabel, secondType: secondLabel },
      optionMessages,
    }),
    [...options],
  );
}

type FusionChoice = Required<Pick<CardScript, "additionalCost">> & {
  /** True when `hook` was this fusion's choice. */
  onChoose(ctx: ScriptCtx, hook: string, option: string): boolean;
};

function fusionChoice(types: FusionType | readonly [FusionType, FusionType], mode: "and" | "and/or"): FusionChoice {
  if (typeof types === "string") {
    const type = types;
    return {
      additionalCost: (ctx) => requestFusionReveal(ctx, type),
      onChoose(ctx, rawHook, option) {
        if ((LEGACY_FUSION_HOOKS[rawHook] ?? rawHook) !== `${type}-fusion`) return false;
        const card = option === "no" ? undefined : handCard(ctx, option, type);
        if (card) completeFusion(ctx, [{ card, type }]);
        return true;
      },
    };
  }
  const [first, second] = types;
  if (mode === "and")
    return {
      additionalCost(ctx) {
        if (fusionCandidates(ctx, second).length > 0) requestFusionReveal(ctx, first);
      },
      onChoose(ctx, rawHook, option) {
        const hook = LEGACY_FUSION_HOOKS[rawHook] ?? rawHook;
        if (hook === `${first}-fusion`) {
          const card = option === "no" ? undefined : handCard(ctx, option, first);
          ctx.setState("fusionFirstReveal", card?.instanceId ?? 0);
          if (card) requestFusionReveal(ctx, second);
          return true;
        }
        if (hook !== `${second}-fusion`) return false;
        const firstCard = handCard(ctx, ctx.getState("fusionFirstReveal"), first);
        const secondCard = option === "no" ? undefined : handCard(ctx, option, second);
        ctx.setState("fusionFirstReveal", 0);
        if (firstCard && secondCard)
          completeFusion(ctx, [
            { card: firstCard, type: first },
            { card: secondCard, type: second },
          ]);
        return true;
      },
    };
  return {
    additionalCost: (ctx) => requestElementalFusion(ctx, first, second),
    onChoose(ctx, rawHook, option) {
      if ((LEGACY_FUSION_HOOKS[rawHook] ?? rawHook) !== ELEMENTAL_FUSION_HOOK) return false;
      if (option === "no") return true;
      const [kind, firstId, secondId] = option.split(":");
      const revealed =
        kind === "both"
          ? [
              { card: handCard(ctx, firstId!, first), type: first },
              { card: handCard(ctx, secondId!, second), type: second },
            ]
          : kind === first || kind === second
            ? [{ card: handCard(ctx, firstId!, kind), type: kind }]
            : [];
      completeFusion(
        ctx,
        revealed.filter((entry): entry is { card: DeepReadonly<CardInstance>; type: FusionType } => !!entry.card),
      );
      return true;
    },
  };
}

/** Fusion: an optional additional cost to reveal a card of each element from
 * hand. `"ice"` is single-element fusion; a pair is "X and/or Y Fusion", or
 * "X and Y Fusion" with `mode: "and"`, where both must be revealed (one card
 * may count for both). Read the result with `isFused`/`isFusedWith`; revealing
 * Ice consumes Isenhowl Weathervane's Frostbites. `script`'s additional cost
 * and choices follow the fusion. */
export function withFusion(
  types: FusionType | readonly [FusionType, FusionType],
  script: CardScript = {},
  mode: "and" | "and/or" = "and/or",
): CardScript {
  const fuse = fusionChoice(types, mode);
  return {
    ...script,
    additionalCost(ctx) {
      fuse.additionalCost(ctx);
      script.additionalCost?.(ctx);
    },
    onChoose(ctx, hook, option) {
      if (!fuse.onChoose(ctx, hook, option)) script.onChoose?.(ctx, hook, option);
    },
  };
}

/** Decompose: banish two Earth cards and an action card from your graveyard; if you do, `payoff`.
 * `before` is the card's own effect that resolves ahead of the offer. */
export function decompose(
  trigger: "attack" | "play",
  payoff: (ctx: ScriptCtx) => void,
  before?: (ctx: ScriptCtx) => void,
): CardScript {
  const offer = (ctx: ScriptCtx) => {
    before?.(ctx);
    const grave = faceUpGraveyard(ctx);
    const firstEarth = grave.filter(
      (first) =>
        hasCardSubtype(ctx, first, "earth") &&
        grave.some(
          (second) =>
            second.instanceId !== first.instanceId &&
            hasCardSubtype(ctx, second, "earth") &&
            grave.some(
              (action) =>
                action.instanceId !== first.instanceId &&
                action.instanceId !== second.instanceId &&
                ctx.hasCardType(action, "action"),
            ),
        ),
    );
    if (firstEarth.length === 0) return;
    ctx.requestCardChoice(
      "decompose-earth-1",
      decisionPrompt(
        `${ctx.data.name}: decompose? Choose the first Earth card to banish`,
        "card.ros.decompose.earth.first",
        { values: { card: { kind: "card", cardId: ctx.self.cardId } }, optionMessages: commonOptionMessages("no") },
      ),
      ["no", ...firstEarth.map((card) => card.instanceId)],
    );
  };
  return {
    ...(trigger === "attack" ? { onAttackDeclared: offer } : { onPlay: offer }),
    onChoose(ctx, rawHook, option) {
      // PEN used "pen-"-prefixed hooks; pending decisions in stored games may still carry them.
      const hook = rawHook.replace(/^pen-/, "");
      if (hook === "decompose-earth-1") {
        if (option === "no") return;
        const first = faceUpGraveyard(ctx).find((card) => card.instanceId === Number(option));
        if (!first || !hasCardSubtype(ctx, first, "earth")) return;
        ctx.setState("decomposeEarth1", first.instanceId);
        const secondEarth = faceUpGraveyard(ctx).filter(
          (second) =>
            second.instanceId !== first.instanceId &&
            hasCardSubtype(ctx, second, "earth") &&
            faceUpGraveyard(ctx).some(
              (action) =>
                action.instanceId !== first.instanceId &&
                action.instanceId !== second.instanceId &&
                ctx.hasCardType(action, "action"),
            ),
        );
        ctx.requestCardChoice(
          "decompose-earth-2",
          decisionPrompt(
            `${ctx.data.name}: choose the second Earth card to banish`,
            "card.ros.decompose.earth.second",
            { values: { card: { kind: "card", cardId: ctx.self.cardId } } },
          ),
          secondEarth.map((card) => card.instanceId),
        );
        return;
      }
      if (hook === "decompose-earth-2") {
        const firstId = ctx.getState("decomposeEarth1");
        const second = faceUpGraveyard(ctx).find((card) => card.instanceId === Number(option));
        if (!second || second.instanceId === firstId || !hasCardSubtype(ctx, second, "earth")) return;
        ctx.setState("decomposeEarth2", second.instanceId);
        const actions = faceUpGraveyard(ctx).filter(
          (card) =>
            card.instanceId !== firstId && card.instanceId !== second.instanceId && ctx.hasCardType(card, "action"),
        );
        ctx.requestCardChoice(
          "decompose-action",
          decisionPrompt(`${ctx.data.name}: choose the action card to banish`, "card.ros.decompose.action", {
            values: { card: { kind: "card", cardId: ctx.self.cardId } },
          }),
          actions.map((card) => card.instanceId),
        );
        return;
      }
      if (hook !== "decompose-action") return;
      const ids = [ctx.getState("decomposeEarth1"), ctx.getState("decomposeEarth2"), Number(option)];
      const grave = faceUpGraveyard(ctx);
      const chosen = ids.map((id) => grave.find((card) => card.instanceId === id));
      if (
        new Set(ids).size !== 3 ||
        !chosen.every(Boolean) ||
        !hasCardSubtype(ctx, chosen[0]!, "earth") ||
        !hasCardSubtype(ctx, chosen[1]!, "earth") ||
        !ctx.hasCardType(chosen[2]!, "action") ||
        !ids.every((id) => ctx.banish(id))
      )
        return;
      payoff(ctx);
    },
  };
}
