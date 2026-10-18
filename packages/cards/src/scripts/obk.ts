import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  attackAbility,
  buffNextAttack,
  commonOptionMessages,
  decisionMessage,
  decisionPrompt,
  effectPutSelfFaceUpFromDeck,
  entersArenaTrigger,
  heroChoiceSeat,
  localizedCardLog,
  opponentSeat,
  requestHeroChoice,
} from "./shared-helpers.js";

// Disease token names offered when an effect names a disease token.
const DISEASE_TOKEN_NAMES: readonly string[] = ["Bloodrot Pox", "Exertion", "Frailty", "Inertia"];
const EXERTION = "SLV035";
const BLOODROT_POX = "SAZ034";
const INERTIA = "SAZ036";
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
        // Boost can banish an opponent's deck top (Madness Spiral); that card
        // stays in its owner's banished zone.
        const card = ctx.player(banished.owner).banish.find(
          (candidate) => candidate.instanceId === banished.instanceId && !candidate.faceDown,
        );
        if (!card) return;
        ctx.allowPlayFrom(card.instanceId, "banish", {
          asInstant: true,
          ...(card.owner === ctx.seat ? {} : { forSeat: ctx.seat }),
        });
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

const ALPHA_ARROW_HOOK = "obk-alpha-arrow";

// Boost marks each card it banishes with a per-object `banishedFromBoost:<id>`
// turn flag on the booster; the engine clears it if the card re-enters banish.
function arrowsBanishedFromBoosting(ctx: ScriptCtx): DeepReadonly<CardInstance>[] {
  return ctx.player(ctx.seat).banish.filter((card) =>
    !card.faceDown &&
    isArrow(ctx, card) &&
    ctx.getPlayerFlag(ctx.seat, `banishedFromBoost:${card.instanceId}`) === true
  );
}

function arsenalBoostedArrow(ctx: ScriptCtx, instanceId: number): void {
  const arrow = arrowsBanishedFromBoosting(ctx).find((card) => card.instanceId === instanceId);
  if (!arrow || !ctx.putIntoArsenal(arrow.instanceId, "banish", { faceUp: true })) return;
  ctx.addCounter(arrow.instanceId, "power", 2);
  ctx.logPublic(
    localizedCardLog(
      ctx,
      `${ctx.cardData(ctx.self.cardId).name}: ${ctx.cardData(arrow.cardId).name} gets two +1 power counters`,
      "card.log.obk.alpha.counters",
      { target: { kind: "card", cardId: arrow.cardId }, amount: 2 },
    ),
  );
}

const alpha01: CardScript = {
  activated: [
    {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Arsenal a boosted arrow with two +1{p} counters",
      onActivate(ctx) {
        if (!ctx.hasArsenalSpace()) return;
        const arrows = arrowsBanishedFromBoosting(ctx);
        if (arrows.length === 1) {
          arsenalBoostedArrow(ctx, arrows[0]!.instanceId);
        } else if (arrows.length > 1) {
          ctx.requestCardChoice(
            ALPHA_ARROW_HOOK,
            decisionPrompt(
              "Put an arrow you banished from boosting this turn face-up into your arsenal",
              "card.obk.alpha.arrow.arsenal",
            ),
            arrows.map((card) => card.instanceId),
          );
        }
      },
    },
    {
      cost: 1,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      tap: true,
      label: "Next arrow with a +1{p} counter gets go again",
      onActivate(ctx) {
        ctx.addModifier({
          scope: "next-play",
          grantKeyword: "go again",
          appliesToSubtype: "arrow",
          appliesToCounter: "power",
        });
      },
    },
  ],
  onChoose(ctx, hook, option) {
    if (hook === ALPHA_ARROW_HOOK) arsenalBoostedArrow(ctx, Number(option));
  },
};

const MORTIMER_COPY_HOOK = "obk-mortimer-copy";

function copyDiseaseToOpponents(ctx: ScriptCtx, instanceId: number): void {
  const disease = ctx.player(ctx.seat).board.find(
    (card) => card.instanceId === instanceId && isDiseaseToken(ctx, card),
  );
  if (!disease) return;
  for (const player of ctx.state.players) {
    if (player.seat !== ctx.seat) ctx.createTokenCopyOf(disease, player.seat);
  }
}

const mortimer: CardScript = {
  activated: {
    cost: 1,
    isAttack: false,
    goAgain: false,
    timing: "instant",
    tap: true,
    canActivate: (ctx) => ctx.state.activePlayer === ctx.seat,
    onActivate(ctx) {
      // Same-name tokens are interchangeable copy sources; offer one of each.
      const diseases = ctx.player(ctx.seat).board
        .filter((card) => isDiseaseToken(ctx, card))
        .filter((card, index, all) => all.findIndex((other) => other.cardId === card.cardId) === index);
      if (diseases.length === 1) {
        copyDiseaseToOpponents(ctx, diseases[0]!.instanceId);
      } else if (diseases.length > 1) {
        ctx.requestCardChoice(
          MORTIMER_COPY_HOOK,
          decisionPrompt(
            "Choose a disease token you control to copy under each opponent's control",
            "card.obk.mortimer.disease.copy",
          ),
          diseases.map((card) => card.instanceId),
        );
      }
    },
  },
  onChoose(ctx, hook, option) {
    if (hook === MORTIMER_COPY_HOOK) copyDiseaseToOpponents(ctx, Number(option));
  },
};

const EXTINCTION_NAME_HOOK = "obk-extinction-name";

function diseaseTokensInArena(ctx: ScriptCtx): number {
  return ctx.state.players.flatMap((player) => player.board).filter((card) => isDiseaseToken(ctx, card)).length;
}

const extinctionLevelEvent: CardScript = {
  chosenNameLosesAbilities: { cardType: "token", subtype: "disease" },
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
    entersArenaTrigger("Name a disease token", decisionMessage("card.trigger.obk.extinction.name"), (ctx) =>
      ctx.requestChoice(
        EXTINCTION_NAME_HOOK,
        decisionPrompt("Name a disease token", "card.obk.extinction.disease.name"),
        [...DISEASE_TOKEN_NAMES],
        undefined,
        DISEASE_TOKEN_NAMES.map((name) => ctx.cardIdsNamed(name)[0] ?? null),
      ),
    ),
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

const inciteResolve: CardScript = {
  onPlay(ctx) {
    if (eachHeroArsenalsTopCard(ctx).some((card) => ctx.cardColor(card) === 3)) {
      buffNextAttack(ctx, { attack: 2 });
    }
  },
};

const exertionBloom: CardScript = {
  modifyPlayCost: (ctx, base) => (ctx.state.activePlayer === ctx.seat ? Math.max(0, base - 3) : base),
  onPlay(ctx) {
    for (const seat of [ctx.seat, opponentSeat(ctx)]) ctx.createToken(EXERTION, seat);
  },
};

const exertion: CardScript = {
  triggers: [
    {
      event: "card-played",
      label: "Lose 1 life",
      labelMessage: decisionMessage("card.trigger.common.life.lose", { amount: 1 }),
      condition: (_ctx, _played, event) => event?.from === "hand",
      effect: (ctx) => ctx.loseLife(ctx.seat, 1),
    },
    {
      event: "end-of-turn",
      label: "Destroy this",
      labelMessage: decisionMessage("card.trigger.common.self.destroy"),
      effect: (ctx) => ctx.destroySelf(),
    },
  ],
};

const PATIENT_ZERO_HOOK = "obk-patient-zero-give";

const patientZero: CardScript = {
  canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
  onHit(ctx) {
    const diseases = ctx.player(ctx.seat).board.filter((card) => isDiseaseToken(ctx, card));
    if (diseases.length === 1) {
      ctx.giveControl(diseases[0]!.instanceId, opponentSeat(ctx));
    } else if (diseases.length > 1) {
      ctx.requestCardChoice(
        PATIENT_ZERO_HOOK,
        decisionPrompt("Give a disease token you control to the hit hero", "card.obk.patientzero.disease.give"),
        diseases.map((card) => card.instanceId),
      );
    }
  },
  onChoose(ctx, hook, option) {
    if (hook !== PATIENT_ZERO_HOOK) return;
    const disease = ctx.player(ctx.seat).board.find(
      (card) => card.instanceId === Number(option) && isDiseaseToken(ctx, card),
    );
    if (disease) ctx.giveControl(disease.instanceId, opponentSeat(ctx));
  },
};

const CEREMONY_CURE_HOOK = "obk-ceremony-cure";
const CEREMONY_MODE_HOOK = "obk-ceremony-mode";
const CEREMONY_HERO = "ceremonyHero";
const CEREMONY_CURED = "ceremonyCured";
const CEREMONY_MODES = ["power", "go again", "veil"] as const;
type CeremonyMode = (typeof CEREMONY_MODES)[number];

const ceremonyModeKey = (mode: CeremonyMode) => `ceremonyMode:${mode}`;

function ceremonyHeroes(ctx: ScriptCtx): number[] {
  return [ctx.seat, opponentSeat(ctx)];
}

function controlledDiseases(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => isDisease(ctx, card));
}

function cureForCeremony(ctx: ScriptCtx, seat: number, instanceId: number): void {
  if (ctx.destroyPermanent(instanceId, seat)) ctx.setState(CEREMONY_CURED, ctx.getState(CEREMONY_CURED) + 1);
}

/** Each hero, in turn order, cures a disease they control if able, choosing
 * among several; then the controller picks one mode per cured disease. */
function continueCeremony(ctx: ScriptCtx): void {
  const heroes = ceremonyHeroes(ctx);
  for (let index = ctx.getState(CEREMONY_HERO); index < heroes.length; index++) {
    const seat = heroes[index]!;
    const diseases = controlledDiseases(ctx, seat);
    if (diseases.length > 1) {
      ctx.setState(CEREMONY_HERO, index);
      ctx.requestCardChoice(
        CEREMONY_CURE_HOOK,
        decisionPrompt("Cure a disease you control", "card.obk.ceremony.disease.cure"),
        diseases.map((card) => card.instanceId),
        seat,
      );
      return;
    }
    if (diseases.length === 1) cureForCeremony(ctx, seat, diseases[0]!.instanceId);
  }
  // Cures are complete; later mode picks resume here without curing again.
  ctx.setState(CEREMONY_HERO, heroes.length);
  const chosen = CEREMONY_MODES.filter((mode) => ctx.getState(ceremonyModeKey(mode)) > 0);
  const remaining = ctx.getState(CEREMONY_CURED) - chosen.length;
  const available = CEREMONY_MODES.filter((mode) => !chosen.includes(mode));
  if (remaining <= 0 || available.length === 0) return;
  ctx.requestChoice(
    CEREMONY_MODE_HOOK,
    decisionPrompt(`Choose a mode (${remaining} remaining)`, "card.obk.ceremony.mode.choose", {
      values: { amount: remaining },
      optionMessages: {
        power: decisionMessage("card.obk.ceremony.option.power", { amount: 2 }),
        "go again": decisionMessage("card.obk.ceremony.option.goagain"),
        veil: decisionMessage("card.obk.ceremony.option.veil"),
      },
    }),
    [...available],
  );
}

const curativeCeremony: CardScript = {
  additionalCost(ctx) {
    ctx.setState(CEREMONY_HERO, 0);
    ctx.setState(CEREMONY_CURED, 0);
    for (const mode of CEREMONY_MODES) ctx.setState(ceremonyModeKey(mode), 0);
    continueCeremony(ctx);
  },
  onChoose(ctx, hook, option) {
    if (hook === CEREMONY_CURE_HOOK) {
      const index = ctx.getState(CEREMONY_HERO);
      const seat = ceremonyHeroes(ctx)[index];
      if (seat === undefined) return;
      const disease = controlledDiseases(ctx, seat).find((card) => card.instanceId === Number(option));
      if (disease) cureForCeremony(ctx, seat, disease.instanceId);
      ctx.setState(CEREMONY_HERO, index + 1);
      continueCeremony(ctx);
    } else if (hook === CEREMONY_MODE_HOOK) {
      const mode = CEREMONY_MODES.find((candidate) => candidate === option);
      if (!mode || ctx.getState(ceremonyModeKey(mode)) > 0) return;
      ctx.setState(ceremonyModeKey(mode), 1);
      if (mode === "power") ctx.addCardTempPower(ctx.self.instanceId, 2);
      else ctx.grantCardKeyword(ctx.self.instanceId, mode);
      continueCeremony(ctx);
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

function courier(tokenId: string): CardScript {
  return {
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      for (const seat of [ctx.seat, opponentSeat(ctx)]) ctx.createToken(tokenId, seat);
    },
  };
}

const BACK_ALLEY_HOOK = "obk-back-alley-token";

function backAlleyBank(tokenId: string, tokenName: string): CardScript {
  const token = { kind: "card", cardId: tokenId } as const;
  return {
    triggers: [
      {
        event: "card-moved-from-deck-by-effect",
        sourceZone: "any",
        label: `Create ${tokenName} under a hero's control`,
        labelMessage: decisionMessage("card.trigger.obk.backalley.token", { token }),
        condition: effectPutSelfFaceUpFromDeck,
        effect(ctx) {
          requestHeroChoice(
            ctx,
            BACK_ALLEY_HOOK,
            `${ctx.data.name}: create ${tokenName} under which hero's control?`,
            "card.obk.backalley.hero.choose",
            { values: { card: { kind: "card", cardId: ctx.self.cardId }, token }, defaultOption: "opposing hero" },
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      const seat = hook === BACK_ALLEY_HOOK ? heroChoiceSeat(ctx, option) : undefined;
      if (seat !== undefined) ctx.createToken(tokenId, seat);
    },
  };
}

const INCUBATOR_INFECTED = "incubatorInfected";
const INCUBATOR_POX_HOOK = "obk-incubator-pox";

function infectedWithBloodrotPox(ctx: ScriptCtx, seat: number): boolean {
  return ctx.player(seat).board.some((card) => isDisease(ctx, card) && ctx.cardNames(card).includes("bloodrot pox"));
}

const incubatorImplanter: CardScript = {
  // "When this attacks a hero, if …" grants the hit ability only when the
  // defending hero is infected as the attack is declared.
  onAttackDeclared(ctx) {
    if (ctx.link?.targetAllyId === undefined && infectedWithBloodrotPox(ctx, opponentSeat(ctx))) {
      ctx.setFlag("link", INCUBATOR_INFECTED, true);
    }
  },
  canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined && ctx.getFlag("link", INCUBATOR_INFECTED) === true,
  onHit(ctx) {
    const seat = opponentSeat(ctx);
    ctx.scheduleRecurringEndOfTurnTrigger(
      INCUBATOR_POX_HOOK,
      decisionPrompt("Create a Bloodrot Pox token under the hit hero's control", "card.trigger.obk.incubator.pox", {
        values: { token: { kind: "card", cardId: BLOODROT_POX } },
      }),
      seat,
    );
    ctx.logPublic(
      localizedCardLog(
        ctx,
        `${ctx.data.name}: for the rest of the game, at the beginning of ` +
          `${ctx.cardData(ctx.player(seat).heroCardId).name}'s end phase, ` +
          "create a Bloodrot Pox token under their control",
        "card.log.obk.incubator.infected",
        { target: { kind: "player", seat }, token: { kind: "card", cardId: BLOODROT_POX } },
      ),
    );
  },
  onDelayedTrigger(ctx, hook) {
    if (hook === INCUBATOR_POX_HOOK) ctx.createToken(BLOODROT_POX, opponentSeat(ctx));
  },
};

// Weapon and ally attacks are attack-proxies, not cards on the chain link.
function streets(delta: number): CardScript {
  const sign = delta < 0 ? "-" : "+";
  const amount = Math.abs(delta);
  return {
    onPlay(ctx) {
      const link = ctx.link;
      if (!link) return;
      const cards = [
        ...(link.attackCardType === "action" && link.flags.attackGone !== true ? [link.attackingCard] : []),
        ...link.defendingCards,
      ].filter((card) => !ctx.hasCardType(card, "equipment"));
      if (!cards.length) return;
      const chosen = cards[ctx.randomInt(cards.length)]!;
      // Sourced chain-link modifiers attribute the change to this card in the
      // attack and defense breakdowns; the stat that cannot be shown for the
      // chosen card's role stays a temporary value on the card.
      if (chosen.instanceId === link.attackingCard.instanceId) {
        ctx.addModifier({ scope: "chain-link", attack: delta, appliesToInstanceId: chosen.instanceId });
        ctx.addCardTempDefense(chosen.instanceId, delta);
      } else {
        ctx.addModifier({
          scope: "chain-link",
          defense: delta,
          seat: chosen.owner,
          appliesToInstanceId: chosen.instanceId,
        });
        ctx.addCardTempPower(chosen.instanceId, delta);
      }
      ctx.logPublic(
        localizedCardLog(
          ctx,
          `${ctx.data.name}: ${ctx.cardData(chosen.cardId).name} gets ${sign}${amount} power and ` +
            `${sign}${amount} defense this chain link`,
          delta < 0 ? "card.log.obk.quietstreets.reduce" : "card.log.obk.ragingstreets.boost",
          { target: { kind: "card", cardId: chosen.cardId }, amount },
        ),
      );
    },
  };
}

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
  "α-01, first cogwarden|0": alpha01,
  "mortimer, living virus|0": mortimer,
  "extinction level event|1": extinctionLevelEvent,
  "swap spit|1": swapSpit,
  "incite aggression|1": inciteAggression,
  "incite resolve|3": inciteResolve,
  "exertion bloom|2": exertionBloom,
  "quiet streets|2": streets(-3),
  "raging streets|2": streets(3),
  "bloodrot courier|1": courier(BLOODROT_POX),
  "exertion courier|2": courier(EXERTION),
  "inertia courier|3": courier(INERTIA),
  "back alley bloodbank|1": backAlleyBank(BLOODROT_POX, "Bloodrot Pox"),
  "back alley bilebank|2": backAlleyBank(EXERTION, "Exertion"),
  "back alley plasmabank|3": backAlleyBank(INERTIA, "Inertia"),
  "incubator implanter|1": incubatorImplanter,
  "exertion|0": exertion,
  "patient zero|1": patientZero,
  "curative ceremony|1": curativeCeremony,
  "pauper's knife|0": { activated: attackAbility(2, { goAgain: true, oncePerTurn: false, tap: true }) },
  "cogwerx dueling pistol|0": cogwerxDuelingPistol,
  "bootlegger bust-up|1": bootleggerBustUp,
  "bootlegger bust-up|2": bootleggerBustUp,
  "bootlegger bust-up|3": bootleggerBustUp,
  "one-click pinpointer|0": oneClickPinpointer,
  "max-tension shot|1": maxTensionShot,
  "cure-all elixir|0": cureAllElixir,
};
