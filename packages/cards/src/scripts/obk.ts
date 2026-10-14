import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  localizedCardLog,
  opponentSeat,
} from "./shared-helpers.js";

// Disease token names offered when an effect names a disease token.
const DISEASE_TOKEN_NAMES: readonly string[] = ["Bloodrot Pox", "Frailty", "Inertia"];
const EXTINCTION_WIN_THRESHOLD = 33;

function hasKeyword(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, keyword: string): boolean {
  const key = keyword.toLowerCase();
  if ((card.suppressedKeywords ?? []).includes(key)) return false;
  return [...(ctx.cardData(card.cardId).keywords ?? []), ...(card.grantedKeywords ?? [])]
    .some((candidate) => candidate.toLowerCase() === key);
}

function isArrow(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("arrow");
}

function isDisease(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.cardTypes(card).includes("disease");
}

function isDiseaseToken(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "token") && isDisease(ctx, card);
}

/** Each hero, in turn order, puts their deck top face-up into their arsenal;
 * returns the cards actually moved. */
function eachHeroArsenalsTopCard(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  const moved: DeepReadonly<CardInstance>[] = [];
  for (const seat of [ctx.seat, opponentSeat(ctx)]) {
    const top = ctx.player(seat).deck[0];
    if (top && ctx.putIntoArsenal(top.instanceId, "deck")) moved.push(top);
  }
  return moved;
}

function minFace(ownedCardTypes: CardScript["ownedCardTypes"], flip: (ctx: ScriptCtx) => void): CardScript {
  return {
    ownedCardTypes,
    triggers: [
      {
        event: "end-of-turn",
        label: "Flip this hero",
        labelMessage: decisionMessage("card.trigger.obk.min.flip"),
        effect: flip,
      },
    ],
  };
}

function flipToBack(ctx: ScriptCtx): void {
  const backId = ctx.cardData(ctx.self.cardId).backId;
  if (backId) ctx.becomeHero(backId);
}

function flipToFront(ctx: ScriptCtx): void {
  const frontId = ctx.self.originalHeroCardId;
  if (frontId) ctx.becomeHero(frontId);
}

const minGenius = minFace({ gain: ["mechanologist"] }, flipToBack);
const minMad = minFace({ loseClassTalent: true }, flipToFront);

const vyle: CardScript = {
  activated: {
    cost: 2,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    canActivate: (ctx) => ctx.state.activePlayer === ctx.seat,
    onActivate(ctx) {
      eachHeroArsenalsTopCard(ctx);
    },
  },
  modifyFriendlyAttack(ctx, attacking) {
    const opponentFaceUp = ctx.player(opponentSeat(ctx)).arsenal.some((card) => !card.faceDown);
    return opponentFaceUp && isArrow(ctx, attacking) ? 1 : 0;
  },
};

const huxley: CardScript = {
  triggers: [
    {
      event: "card-banished-for-boost",
      optional: true,
      label: "Tap this hero to play the banished card as though it were an instant this turn",
      labelMessage: decisionMessage("card.trigger.obk.huxley.instant"),
      condition: (ctx, banished) =>
        !!banished && !ctx.self.tapped && ctx.hasCardType(banished, "action") && hasKeyword(ctx, banished, "stealth"),
      canAccept: (ctx) => !ctx.self.tapped,
      effect(ctx, banished) {
        if (!banished || !ctx.tap(ctx.self.instanceId)) return;
        const card = ctx.player(ctx.seat).banish.find(
          (candidate) => candidate.instanceId === banished.instanceId && !candidate.faceDown,
        );
        if (!card) return;
        ctx.allowPlayFrom(card.instanceId, "banish", { asInstant: true });
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${ctx.cardData(card.cardId).name} ` +
              "may be played as though it were an instant this turn",
            "card.log.obk.huxley.instant",
            { target: { kind: "card", cardId: card.cardId } },
          ),
        );
      },
    },
  ],
};

const azalea: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    effectCardCosts: [
      {
        zone: "arsenal",
        move: "put-on-deck-bottom",
        count: 1,
        prompt: decisionPrompt(
          "Put a card from your arsenal on the bottom of your deck as a cost",
          "card.obk.azalea.cost.arsenal.bottom",
        ),
      },
    ],
    onActivate(ctx) {
      const top = ctx.player(ctx.seat).deck[0];
      if (!top || !ctx.putIntoArsenal(top.instanceId, "deck")) return;
      const target = { kind: "card", cardId: top.cardId } as const;
      const name = ctx.cardData(top.cardId).name;
      if (hasKeyword(ctx, top, "stealth")) {
        ctx.addCardTempPower(top.instanceId, 1);
        ctx.grantCardKeyword(top.instanceId, "go again");
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${name} gets +1 power and go again this turn`,
            "card.log.obk.azalea.stealth",
            { target },
          ),
        );
      }
      if (isArrow(ctx, top)) {
        ctx.grantCardKeyword(top.instanceId, "veil");
        ctx.logPublic(
          localizedCardLog(
            ctx,
            `${ctx.cardData(ctx.self.cardId).name}: ${name} gets veil this turn`,
            "card.log.obk.azalea.veil",
            { target },
          ),
        );
      }
    },
  },
};

const EXTINCTION_NAME_HOOK = "obk-extinction-name";

function diseaseTokensInArena(ctx: ScriptCtx): number {
  return ctx.state.players.flatMap((player) => player.board).filter((card) => isDiseaseToken(ctx, card)).length;
}

const extinctionLevelEvent: CardScript = {
  chosenNameLosesAbilities: { cardType: "token", subtype: "disease" },
  onEnterArena(ctx) {
    ctx.requestChoice(
      EXTINCTION_NAME_HOOK,
      decisionPrompt("Name a disease token", "card.obk.extinction.disease.name"),
      [...DISEASE_TOKEN_NAMES],
      undefined,
      DISEASE_TOKEN_NAMES.map((name) => ctx.cardIdsNamed(name)[0] ?? null),
    );
  },
  onChoose(ctx, hook, option) {
    if (hook !== EXTINCTION_NAME_HOOK || !DISEASE_TOKEN_NAMES.includes(option)) return;
    ctx.setChosenName(option);
    ctx.logPublic(
      localizedCardLog(
        ctx,
        `${ctx.data.name}: ${option} tokens lose and can't gain abilities`,
        "card.log.obk.extinction.named",
        { name: option },
      ),
    );
  },
  triggers: [
    {
      event: "start-of-turn",
      label: "Win the game if there are 33 or more disease tokens in the arena",
      labelMessage: decisionMessage("card.trigger.obk.extinction.win", { amount: EXTINCTION_WIN_THRESHOLD }),
      condition: (ctx) => diseaseTokensInArena(ctx) >= EXTINCTION_WIN_THRESHOLD,
      effect(ctx) {
        // Intervening if: recheck on resolution. With two heroes, winning is
        // the opponent losing.
        if (diseaseTokensInArena(ctx) >= EXTINCTION_WIN_THRESHOLD) ctx.loseGame(opponentSeat(ctx));
      },
    },
  ],
};

const swapSpit: CardScript = {
  onDefend(ctx) {
    const opponent = opponentSeat(ctx);
    const pick = (seat: number) => {
      const diseases = ctx.player(seat).board.filter((card) => isDiseaseToken(ctx, card));
      return diseases.length ? diseases[ctx.randomInt(diseases.length)] : undefined;
    };
    const mine = pick(ctx.seat);
    const theirs = pick(opponent);
    if (mine) ctx.giveControl(mine.instanceId, opponent);
    if (theirs) ctx.giveControl(theirs.instanceId, ctx.seat);
  },
};

const inciteAggression: CardScript = {
  onPlay(ctx) {
    if (eachHeroArsenalsTopCard(ctx).some((card) => ctx.cardColor(card) === 1)) {
      buffNextAttack(ctx, { goAgain: true });
    }
  },
};

const cogwerxDuelingPistol: CardScript = {
  activated: [
    {
      cost: 0,
      isAttack: true,
      goAgain: false,
      oncePerTurn: false,
      tap: true,
      label: "Remove a steam counter: Attack",
      removeCounterCost: { key: "steam", amount: 1 },
    },
    {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      tap: true,
      label: "Load a steam counter",
      onActivate(ctx) {
        if (ctx.getCounter("steam") === 0) ctx.setCounter("steam", 1);
      },
    },
  ],
};

const bootleggerBustUp: CardScript = {
  boostBanishPowerBonus: (ctx, banished) => (ctx.cardTypes(banished).includes("mechanologist") ? 0 : 2),
};

const PINPOINTER_BOTTOM_HOOK = "obk-pinpointer-bottom";
const PINPOINTER_ARROW_HOOK = "obk-pinpointer-arrow";

function controlsOtherTappedBow(ctx: ScriptCtx): boolean {
  return ctx.player(ctx.seat).weapons.some((weapon) =>
    weapon.instanceId !== ctx.self.instanceId && weapon.tapped === true && ctx.cardTypes(weapon).includes("bow")
  );
}

/** Bottom the arsenal one card at a time in the controller's chosen order,
 * then load an arrow from hand into the emptied arsenal. */
function continuePinpointer(ctx: ScriptCtx): void {
  const player = ctx.player(ctx.seat);
  if (player.arsenal.length > 1) {
    ctx.requestCardChoice(
      PINPOINTER_BOTTOM_HOOK,
      decisionPrompt(
        "Choose the next card to put on the bottom of your deck",
        "card.obk.pinpointer.arsenal.bottom",
      ),
      player.arsenal.map((card) => card.instanceId),
    );
    return;
  }
  const last = player.arsenal[0];
  if (last) ctx.putOnDeckBottom(last.instanceId);
  const arrows = ctx.player(ctx.seat).hand.filter((card) => isArrow(ctx, card));
  if (arrows.length) {
    ctx.requestCardChoice(
      PINPOINTER_ARROW_HOOK,
      decisionPrompt(
        "Put an arrow from your hand face-up into your arsenal",
        "card.obk.pinpointer.arrow.arsenal",
      ),
      arrows.map((card) => card.instanceId),
    );
  }
}

const oneClickPinpointer: CardScript = {
  activated: {
    cost: 0,
    isAttack: false,
    goAgain: true,
    oncePerTurn: false,
    tap: true,
    label: "Reload an arrow",
    // The bow being activated is untapped while its cost is determined.
    modifyCost: (ctx, baseCost) => baseCost + (controlsOtherTappedBow(ctx) ? 1 : 0),
    onActivate: continuePinpointer,
  },
  onChoose(ctx, hook, option) {
    if (hook === PINPOINTER_BOTTOM_HOOK) {
      if (ctx.player(ctx.seat).arsenal.some((card) => card.instanceId === Number(option))) {
        ctx.putOnDeckBottom(Number(option));
      }
      continuePinpointer(ctx);
    } else if (hook === PINPOINTER_ARROW_HOOK) {
      ctx.putIntoArsenal(Number(option), "hand", { faceUp: true });
    }
  },
};

const maxTensionShot: CardScript = {
  onAttackDeclared(ctx) {
    const top = ctx.player(ctx.seat).deck[0];
    if (top && ctx.revealCards([top.instanceId]) && ctx.cardColor(top) === 1) ctx.grantGoAgain();
  },
};

const CURE_ALL_HOOK = "obk-cure-all";

const cureAllElixir: CardScript = {
  onPlay(ctx) {
    buffNextAttack(ctx, { attack: 3 });
    const diseases = ctx.player(ctx.seat).board.filter((card) => isDisease(ctx, card));
    if (diseases.length) {
      ctx.requestCardChoice(
        CURE_ALL_HOOK,
        decisionPrompt("Cure a disease you control?", "card.obk.cureall.disease.cure", {
          optionMessages: commonOptionMessages("no"),
        }),
        ["no", ...diseases.map((card) => card.instanceId)],
      );
    }
  },
  onChoose(ctx, hook, option) {
    if (hook === CURE_ALL_HOOK && option !== "no" && ctx.destroyPermanent(Number(option))) ctx.gainLife(ctx.seat, 1);
  },
};

export const obk: Record<string, CardScript> = {
  "min, genius|0": minGenius,
  "min, half-genius|0": minGenius,
  "min, mad|0": minMad,
  "min, half-mad|0": minMad,
  "vyle, catalyst of collapse|0": vyle,
  "vyle|0": vyle,
  "huxley, racketeer|0": huxley,
  "huxley|0": huxley,
  "azalea, ace of spades|0": azalea,
  "azalea, lone vigilante|0": azalea,
  "extinction level event|1": extinctionLevelEvent,
  "swap spit|1": swapSpit,
  "incite aggression|1": inciteAggression,
  "pauper's knife|0": { activated: attackAbility(2, { goAgain: true, oncePerTurn: false, tap: true }) },
  "cogwerx dueling pistol|0": cogwerxDuelingPistol,
  "bootlegger bust-up|1": bootleggerBustUp,
  "one-click pinpointer|0": oneClickPinpointer,
  "max-tension shot|1": maxTensionShot,
  "cure-all elixir|0": cureAllElixir,
};
