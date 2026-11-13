import type {
  ActivatedAbility,
  CardInstance,
  CardScript,
  DeepReadonly,
  ScriptCtx,
  ScriptDecisionPrompt,
} from "@fyendal/engine";
import { isAttackAction, isSixPlus, isSword } from "./cards.js";
import { commonOptionMessages, decisionPrompt, localizedCardLog, localizedLog } from "./messages.js";
import { defendsTogetherWithCardFromHand, draconicLinks, isSwordAttack, isWeaponAttack, opponentSeat } from "./state.js";

type Card = DeepReadonly<CardInstance>;

/** "When this attacks, draw a card then discard a random card" — returns the discard. */
function drawThenDiscard(ctx: ScriptCtx): DeepReadonly<CardInstance> | undefined {
  ctx.drawCards(ctx.seat, 1);
  return ctx.discardRandom(ctx.seat, 1)[0];
}

/** "When this attacks, draw a card then discard a random card. If a 6+ card was discarded, …" */
export function discardSixPlusPayoff(payoff: (ctx: ScriptCtx) => void): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (isSixPlus(ctx, drawThenDiscard(ctx))) payoff(ctx);
    },
  };
}

/** "Reveal the top card of your deck. If it has 6+, put it on top. Otherwise, on the bottom." */
export function revealTopSixPlusStays(ctx: ScriptCtx): void {
  const p = ctx.player(ctx.seat);
  const top = p.deck[0];
  if (!top) return;
  const d = ctx.cardData(top.cardId);
  if (ctx.basePower(top) >= 6) {
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} reveals ${d.name} — it stays on top`,
        "card.log.common.reveal.top.stays",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          revealed: { kind: "card", cardId: top.cardId },
        },
        {
          kind: "cards-revealed",
          cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }],
          sourceZone: "deck",
        },
      ),
    );
  } else {
    ctx.putOnDeckBottom(top.instanceId);
    ctx.logPublic(
      localizedLog(
        `${ctx.data.name} reveals ${d.name} — put on the bottom of the deck`,
        "card.log.common.reveal.top.bottom",
        {
          card: { kind: "card", cardId: ctx.self.cardId },
          revealed: { kind: "card", cardId: top.cardId },
        },
        {
          kind: "cards-revealed",
          cards: [{ cardId: top.cardId, ownerSeat: ctx.seat }],
          sourceZone: "deck",
        },
      ),
    );
  }
}

/** Weapon / ally tap-attack ability factory. */
export function attackAbility(
  cost: number,
  opts?: {
    goAgain?: boolean;
    oncePerTurn?: boolean;
    activationsPerTurn?: number;
    tap?: boolean;
    canActivate?: ActivatedAbility["canActivate"];
  },
): ActivatedAbility[] {
  return [
    {
      cost,
      isAttack: true,
      goAgain: opts?.goAgain ?? false,
      oncePerTurn: opts?.oncePerTurn ?? true,
      ...(opts?.activationsPerTurn === undefined ? {} : { activationsPerTurn: opts.activationsPerTurn }),
      tap: opts?.tap,
      label: "Attack",
      ...(opts?.canActivate ? { canActivate: opts.canActivate } : {}),
    },
  ];
}

/** Crush: this attack hit a hero for 4 or more damage. */
export function crushTriggered(ctx: ScriptCtx): boolean {
  return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.hit && ctx.link.damage >= 4;
}

type BanishReward = "power" | "discount" | "go-again";

function banishAttackPrompt(ctx: ScriptCtx, reward: BanishReward, links: number): ScriptDecisionPrompt {
  if (reward === "go-again")
    return decisionPrompt(`${ctx.data.name}: banish an eligible attack?`, "card.upr.attack.banish", {
      values: { card: { kind: "card", cardId: ctx.self.cardId } },
      optionMessages: commonOptionMessages("pass"),
    });
  return decisionPrompt(
    `${ctx.data.name}: banish an attack action with cost less than ${links} — ` +
      `it ${reward === "power" ? "gains +1{p}" : "costs {r} less to play"} and you may play it this turn`,
    reward === "power" ? "card.sfa.attack.banish.power" : "card.sfa.attack.banish.discount",
    {
      values: { card: { kind: "card", cardId: ctx.self.cardId }, amount: links },
      optionMessages: commonOptionMessages("pass"),
    },
  );
}

/** Mounting Anger family: on hit, banish an attack action from hand costing less than your Draconic links;
 * it gets `reward` and may be played from banish this turn. */
export function banishAttackOnHit(hook: string, reward: BanishReward): CardScript {
  return {
    onHit(ctx) {
      const links = draconicLinks(ctx);
      const choices = ctx.player(ctx.seat).hand.filter(
        (card) => isAttackAction(ctx, card) && (ctx.cardData(card.cardId).cost ?? 0) < links,
      );
      if (choices.length === 0) return;
      ctx.requestCardChoice(hook, banishAttackPrompt(ctx, reward, links), [
        "pass",
        ...choices.map((card) => card.instanceId),
      ]);
    },
    onChoose(ctx, chosenHook, option) {
      if (chosenHook !== hook || option === "pass") return;
      const id = Number(option);
      const selected = ctx.player(ctx.seat).hand.find((card) => card.instanceId === id);
      if (!selected || !ctx.banish(id)) return;
      if (reward === "power") ctx.addCounter(id, "power", 1);
      if (reward === "go-again") ctx.grantCardKeyword(id, "go again");
      ctx.allowPlayFrom(id, "banish", reward === "discount" ? { costReduction: 1 } : undefined);
      if (reward === "go-again") return;
      ctx.logPublic(
        localizedCardLog(
          ctx,
          `${ctx.data.name}: the banished card ${reward === "power" ? "gains +1{p}" : "costs {r} less to play"} — ` +
            "you may play it this turn",
          reward === "power" ? "card.log.sfa.banished.power" : "card.log.sfa.banished.discount",
          { result: { kind: "card", cardId: selected.cardId }, amount: 1 },
          { kind: "card-moved", cardId: selected.cardId, ownerSeat: ctx.seat, from: "hand", to: "banish" },
        ),
      );
    },
  };
}

/** A once-per-turn weapon attack ability; `extra.activated` fields override the base. */
export function attackingWeapon(cost: number, extra: CardScript = {}): CardScript {
  const base = { cost, isAttack: true, goAgain: false, oncePerTurn: true } as const;
  const activated = extra.activated;
  return {
    ...extra,
    activated: !activated || Array.isArray(activated) ? (activated ?? base) : { ...base, ...activated },
  };
}

export function swords(ctx: ScriptCtx): readonly Card[] {
  return ctx.player(ctx.seat).weapons.filter((card) => isSword(ctx, card));
}

export function weaponReaction(power: number, effect?: (ctx: ScriptCtx, weapon: Card) => void): CardScript {
  return {
    canPlay: (ctx) => ctx.link?.attacker === ctx.seat && isWeaponAttack(ctx),
    onPlay(ctx) {
      const weapon = ctx.link?.attackingCard;
      if (!weapon) return;
      if (power) ctx.addModifier({ scope: "chain-link", attack: power });
      effect?.(ctx, weapon);
    },
  };
}

export function swordReaction(power: number, effect?: (ctx: ScriptCtx, weapon: Card) => void): CardScript {
  const base = weaponReaction(power, effect);
  return { ...base, canPlay: (ctx) => ctx.link?.attacker === ctx.seat && isSwordAttack(ctx) };
}

export function wagerReaction(
  power: number,
  rewardLabel: string,
  reward: (ctx: ScriptCtx, winner: number) => void,
): CardScript {
  return {
    ...swordReaction(power, (ctx) => ctx.wager(opponentSeat(ctx), [], rewardLabel)),
    onWagerResolved(ctx, winner) {
      reward(ctx, winner);
    },
  };
}

/** Unity: +1{d} while another card from hand defends with this. */
export function unityEquipment(): CardScript {
  return {
    canTriggerOnDefend: defendsTogetherWithCardFromHand,
    onDefend(ctx) {
      ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  };
}

export function chokeslam(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const hero = ctx.player(opponentSeat(ctx)).hero;
      ctx.setCardState(hero.instanceId, "attackActionNoPowerGainUntilTurn", ctx.state.turn + 1);
      ctx.logPublic(
        localizedCardLog(
          ctx,
          "Chokeslam: opposing attack action cards can't gain {p} during their next action phase",
          "card.log.sbr.chokeslam.suppressed",
        ),
      );
    },
  };
}

export function boulderDrop(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const hand = ctx.player(opponentSeat(ctx)).hand;
      if (hand.length === 0) return;
      ctx.requestCardChoice(
        "boulder-drop-top",
        decisionPrompt(`${ctx.data.name}: put a card from your hand on top of your deck`, "card.sbr.hand.card.top", {
          values: { card: { kind: "card", cardId: ctx.self.cardId } },
        }),
        hand.map((card) => card.instanceId),
        opponentSeat(ctx),
      );
    },
    onChoose(ctx, hook, option) {
      if (hook === "boulder-drop-top") ctx.putOnDeckTop(Number(option));
    },
  };
}
