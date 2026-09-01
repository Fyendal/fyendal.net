import type { CardScript, DeepReadonly, CardInstance, ScriptCtx } from "@fyendal/engine";
import { buffNextAttack, opponentSeat } from "./shared-helpers.js";

const SEISMIC_SURGE = "SBR035";

function data(ctx: ScriptCtx, card: DeepReadonly<CardInstance>) {
  return ctx.cardData(card.cardId);
}

function hasType(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type.toLowerCase());
}

function isNamed(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, name: string): boolean {
  return data(ctx, card).name.toLowerCase() === name.toLowerCase();
}

function isAura(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return hasType(ctx, card, "aura");
}

function isAuraToken(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return data(ctx, card).cardType === "token" && isAura(ctx, card);
}

function isGuardianAttack(ctx: ScriptCtx): boolean {
  const link = ctx.link;
  return !!link && hasType(ctx, link.attackingCard, "guardian");
}

function applyFearlessConfrontation(ctx: ScriptCtx, attackInstanceId: number): void {
  const attack = ctx.state.chain.find(
    (link) => link.attackingCard.instanceId === attackInstanceId,
  )?.attackingCard;
  if (!attack) return;
  ctx.addModifier({
    scope: "chain-link",
    appliesToInstanceId: attack.instanceId,
    attack: -1,
  });
  ctx.suppressCardKeyword(attack.instanceId, "dominate");
}

function crushTriggered(ctx: ScriptCtx): boolean {
  return !!ctx.link && ctx.link.targetAllyId === undefined && ctx.link.hit && ctx.link.damage >= 4;
}

function controlsSeismicSurge(ctx: ScriptCtx, seat = ctx.seat): boolean {
  return ctx.player(seat).board.some((card) => isNamed(ctx, card, "Seismic Surge"));
}

function seismicSurges(ctx: ScriptCtx, seat = ctx.seat): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => isNamed(ctx, card, "Seismic Surge"));
}

function equipmentCards(ctx: ScriptCtx, seat: number): DeepReadonly<CardInstance>[] {
  const player = ctx.player(seat);
  return [
    ...Object.values(player.equipment).filter(
      (card): card is DeepReadonly<CardInstance> => card !== undefined,
    ),
    ...player.weapons.filter((card) => data(ctx, card).cardType === "equipment"),
  ];
}

function canEquip(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  const controller = ctx.player(ctx.seat);
  const ordinarySlot = (["head", "chest", "arms", "legs"] as const).find((slot) =>
    hasType(ctx, card, slot),
  );
  if (ordinarySlot) return controller.equipment[ordinarySlot] === undefined;
  const occupiedHands = controller.weapons.reduce((total, weapon) =>
    total + (hasType(ctx, weapon, "2h") ? 2 : 1), 0);
  const requiredHands = hasType(ctx, card, "2h") ? 2 : 1;
  return occupiedHands + requiredHands <= 2;
}

function guardianArsenalBuff(attack = 0, dominate = false): CardScript {
  return {
    activated: {
      cost: 3,
      destroySelfCost: true,
      isAttack: false,
      goAgain: true,
      label: `Next Guardian attack from arsenal${attack ? ` +${attack}{p}` : " gets dominate"}`,
      onActivate(ctx) {
        buffNextAttack(ctx, {
          ...(attack ? { attack } : {}),
          ...(dominate ? { dominate: true } : {}),
          appliesTo: "attack-action",
          appliesToClass: "guardian",
          appliesToFromArsenal: true,
        });
      },
    },
  };
}

function oldOneDestroyAuras(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      for (const aura of [...ctx.player(opponentSeat(ctx)).board].filter((card) => isAura(ctx, card))) {
        ctx.destroyPermanent(aura.instanceId);
      }
    },
  };
}

function oldOneSmeltEquipment(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      for (const equipment of equipmentCards(ctx, opponentSeat(ctx))) {
        if ((equipment.defCounters ?? 0) > 0) ctx.destroyPermanent(equipment.instanceId);
      }
    },
  };
}

function blindOwnedCards(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
            ctx.suppressOwnedCardAbilitiesNextTurn(opponentSeat(ctx));
    },
  };
}

function annexAura(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const auras = ctx.player(opponentSeat(ctx)).board.filter((card) => isAura(ctx, card));
      if (auras.length) {
        ctx.requestCardChoice(
          "annex-aura",
          "Annexation of Grandeur: gain control of an aura",
          auras.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "annex-aura") ctx.steal(Number(option), { duration: "indefinite" });
    },
  };
}

function annexFaceUpArsenal(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
            ctx.annexFaceUpArsenalThroughNextTurn(opponentSeat(ctx));
    },
  };
}

function annexEquipment(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const equipment = equipmentCards(ctx, opponentSeat(ctx)).filter((card) => canEquip(ctx, card));
      if (equipment.length) {
        ctx.requestCardChoice(
          "annex-equipment",
          "Annexation of the Forge: equip opposing equipment",
          equipment.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "annex-equipment") ctx.equipOpposingEquipment(Number(option));
    },
  };
}

function hostileEncroachment(): CardScript {
  return {
    onAttackDeclared(ctx) {
      if (ctx.link?.targetAllyId === undefined) ctx.drawCards(opponentSeat(ctx), 1);
    },
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const target = opponentSeat(ctx);
      const hand = ctx.player(target).hand;
      if (hand.length) {
        ctx.requestCardChoice(
          "hostile-discard",
          "Hostile Encroachment: discard a card",
          hand.map((card) => card.instanceId),
          target,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "hostile-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  };
}

function renounceGrandeur(): CardScript {
  return {
    modifyAttack(ctx) {
      if (ctx.link?.targetAllyId !== undefined) return 0;
      return ctx.player(opponentSeat(ctx)).board.some((card) => isAuraToken(ctx, card)) ? 1 : 0;
    },
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      ctx.preventAuraTokenCreationNextTurn(opponentSeat(ctx));
      ctx.logPublic("Renounce Grandeur: the defending hero can't create aura tokens next turn");
    },
  };
}

function aftershock(): CardScript {
  return {
    onAttackDeclared(ctx) {
      const controlledThisTurn = ctx.getFlag("player", "controlledName:seismic surge") === true;
      const createdThisTurn = ctx.getFlag("player", "createdName:seismic surge") === true;
      if (controlledThisTurn || createdThisTurn || controlsSeismicSurge(ctx)) {
        ctx.createToken(SEISMIC_SURGE);
      }
    },
  };
}

function littleBigFoot(bonus: number): CardScript {
  return {
    modifyAttack(ctx) {
      const bigPitch = ctx.player(ctx.seat).pitch.filter((card) => (data(ctx, card).cost ?? 0) >= 3);
      return bigPitch.length >= 2 ? bonus : 0;
    },
  };
}

function delayedGuardianAura(attack: number): CardScript {
  return {
    triggers: [
      {
        event: "begin-action-phase",
        label: `Destroy ${attack === 3 ? "Draw a Crowd" : "aura"} — next Guardian attack +${attack}{p}`,
        effect(ctx) {
          ctx.destroySelf();
          buffNextAttack(ctx, {
            attack,
            appliesTo: "attack-action",
            appliesToClass: "guardian",
          });
        },
      },
    ],
  };
}

function drawACrowd(): CardScript {
  const delayed = delayedGuardianAura(3);
  return {
    ...delayed,
    onPlay(ctx) {
      for (const player of ctx.state.players) ctx.drawCards(player.seat, 1);
    },
  };
}

function promisingTerrain(): CardScript {
  return {
    replaceFriendlyTokenCreation(ctx, cardId, count) {
      return ctx.cardData(cardId).name === "Seismic Surge" && count > 0 ? count + 1 : count;
    },
    triggers: [
      {
        event: "begin-action-phase",
        label: "Destroy Promising Terrain",
        effect(ctx) {
          ctx.destroySelf();
          if (seismicSurges(ctx).length >= 3) {
            ctx.drawCards(ctx.seat, 1);
            ctx.gainLife(ctx.seat, 1);
          }
        },
      },
    ],
  };
}

function valdaSeismicImpact(): CardScript {
  return {
    onOpponentDraws(ctx, _drawingSeat, count) {
      if (ctx.state.phase !== "start" && ctx.state.phase !== "end" && ctx.state.phase !== "game-over") {
        ctx.createTokens(SEISMIC_SURGE, count);
      }
    },
    triggers: [{
      event: "start-of-turn",
      label: "Valda, Seismic Impact",
      condition(ctx) {
        return seismicSurges(ctx).length >= 3;
      },
      effect(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          dominate: true,
          appliesToKeyword: "crush",
        });
      },
    }],
  };
}

function advanceTectonicInstability(ctx: ScriptCtx): void {
  const step = ctx.getCounter("tectonicStep");
  if (step >= ctx.state.players.length) {
    ctx.createTokens(SEISMIC_SURGE, ctx.getCounter("tectonicDraws"));
    return;
  }
  const seat = (ctx.state.activePlayer + step) % ctx.state.players.length;
  ctx.setCounter("tectonicStep", step + 1);
  const arsenal = ctx.player(seat).arsenal;
  if (arsenal.length === 0) {
    advanceTectonicInstability(ctx);
    return;
  }
  ctx.requestCardChoice(
    `tectonic-bottom:${seat}`,
    "Tectonic Instability: put an arsenal card on the bottom of your deck",
    arsenal.map((card) => card.instanceId),
    seat,
  );
}

function tectonicInstability(): CardScript {
  return {
    onPlay(ctx) {
      ctx.setCounter("tectonicStep", 0);
      ctx.setCounter("tectonicDraws", 0);
      advanceTectonicInstability(ctx);
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("tectonic-bottom:")) return;
      const seat = Number(hook.slice("tectonic-bottom:".length));
      const card = ctx.player(seat).arsenal.find((candidate) => candidate.instanceId === Number(option));
      if (card && ctx.putOnDeckBottom(card.instanceId)) {
        ctx.drawCards(seat, 1);
        ctx.setCounter("tectonicDraws", ctx.getCounter("tectonicDraws") + 1);
      }
      advanceTectonicInstability(ctx);
    },
  };
}

type ClashSlot = "head" | "chest" | "arms" | "legs" | "off-hand";

function clashEquipment(slot: ClashSlot): CardScript {
  const equippedInSlot = (ctx: ScriptCtx, seat: number): readonly DeepReadonly<CardInstance>[] => {
    if (slot === "off-hand") {
      return ctx.player(seat).weapons.filter((card) => hasType(ctx, card, "off-hand"));
    }
    const card = ctx.player(seat).equipment[slot];
    return card ? [card] : [];
  };
  return {
    canTriggerOnDefend: isGuardianAttack,
    onDefend(ctx) {
      if (ctx.link) ctx.requestClash(ctx.link.attacker, `clash-${slot}`);
    },
    onClashResult(ctx, hook, winner) {
      if (hook !== `clash-${slot}` || winner < 0) return;
      const loser = winner === ctx.seat ? ctx.link?.attacker : ctx.seat;
      if (loser === undefined) return;
      const equipment = equippedInSlot(ctx, loser);
      if (equipment.length === 0) {
        ctx.loseLife(loser, 1);
      } else if (equipment.length === 1) {
        ctx.addCardDefenseCounters(equipment[0]!.instanceId, 1);
      } else {
        ctx.setCounter("clashEquipmentLoser", loser);
        ctx.requestCardChoice(
          `clash-equipment:${slot}`,
          `Clash: put a -1{d} counter on an equipped ${slot}`,
          equipment.map((card) => card.instanceId),
          loser,
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === `clash-equipment:${slot}`) ctx.addCardDefenseCounters(Number(option), 1);
    },
  };
}

function clashOfMountains(): CardScript {
  return {
    canTriggerOnDefend: isGuardianAttack,
    onDefend(ctx) {
      if (ctx.link) ctx.requestClash(ctx.link.attacker, "clash-mountains");
    },
    onClashResult(ctx, hook, winner) {
      if (hook === "clash-mountains" && winner >= 0) ctx.createToken(SEISMIC_SURGE, winner);
    },
  };
}

function flattenTheField(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const token = seismicSurges(ctx, opponentSeat(ctx))[0];
      if (token) ctx.destroyPermanent(token.instanceId);
    },
  };
}

function grindThemDown(): CardScript {
  return {
    canTriggerOnHit: crushTriggered,
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.moveToGraveyard(top.instanceId, "deck");
    },
  };
}

function heave(amount: number, extra: CardScript = {}): CardScript {
  return {
    ...extra,
    triggers: [
      ...(extra.triggers ?? []),
      {
        event: "end-of-turn",
        sourceZone: "hand",
        label: `Heave ${amount}`,
        condition: (ctx) => ctx.player(ctx.seat).arsenal.length === 0,
        effect(ctx) {
          ctx.requestPayment(
            `heave-${amount}`,
            `${ctx.data.name}: pay ${Array(amount).fill("{r}").join("")} to heave it?`,
            amount,
          );
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === `heave-${amount}` && option === "paid") {
        if (ctx.putIntoArsenal(ctx.self.instanceId, "hand")) {
          ctx.createTokens(SEISMIC_SURGE, amount);
        }
        return;
      }
      extra.onChoose?.(ctx, hook, option);
    },
  };
}

function overswing(attack: number): CardScript {
  return heave(2, {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack,
        appliesTo: "attack-action",
        appliesToClass: "guardian",
      });
    },
  });
}

function geyser(energy: number): CardScript {
  return {
    onEnterArena(ctx) {
      ctx.setCardCounter(ctx.self.instanceId, "energy", energy);
    },
    destroyAtZeroCounter: "energy",
    triggers: [
      {
        event: "end-of-turn",
        label: "Remove an energy counter and create a Seismic Surge",
        effect(ctx) {
          ctx.setCardCounter(ctx.self.instanceId, "energy", Math.max(0, ctx.getCounter("energy") - 1));
          ctx.createToken(SEISMIC_SURGE);
        },
      },
    ],
  };
}

function crashAndBash(): CardScript {
  return {
    onDefend(ctx) {
      const crush = ctx.player(ctx.seat).hand.filter((card) =>
        (data(ctx, card).keywords ?? []).some((keyword) => keyword.toLowerCase() === "crush"),
      );
      if (crush.length) {
        ctx.requestCardChoice(
          "crash-reveal",
          "Crash and Bash: reveal a card with crush?",
          ["no", ...crush.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "crash-reveal" || option === "no") return;
      const card = ctx.player(ctx.seat).hand.find((candidate) => candidate.instanceId === Number(option));
      if (!card) return;
      ctx.logPublic(`Crash and Bash reveals ${data(ctx, card).name} from hand`);
      ctx.createToken(SEISMIC_SURGE);
    },
  };
}

function sunkwater(): CardScript {
  return {
    onDefend(ctx) {
      const faceUp = ctx.player(ctx.seat).arsenal.filter((card) => !card.faceDown);
      if (faceUp.length) {
        ctx.requestCardChoice(
          "sunkwater-bottom",
          `${ctx.data.name}: put a face-up arsenal card on the bottom`,
          faceUp.map((card) => card.instanceId),
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook !== "sunkwater-bottom") return;
      const card = ctx.player(ctx.seat).arsenal.find(
        (candidate) => candidate.instanceId === Number(option) && !candidate.faceDown,
      );
      if (!card || !ctx.putOnDeckBottom(card.instanceId)) return;
      ctx.drawCards(ctx.seat, 1);
      ctx.addCardTempDefense(ctx.self.instanceId, 1);
    },
  };
}

export const mpg: Record<string, CardScript> = {
  "richter scale|0": {
    activated: {
      cost: 0,
      destroySelfCost: true,
      isAttack: false,
      goAgain: false,
      onActivate(ctx) {
        ctx.createTokens(SEISMIC_SURGE, 2);
      },
    },
  },
  "gauntlet of boulderhold|0": guardianArsenalBuff(2),
  "craterhoof|0": guardianArsenalBuff(0, true),
  "hoarding of denial|0": {
    modifyDefense(ctx) {
      const defenders = ctx.state.chain.flatMap((link) => [
        ...link.defendingCards,
        ...link.defendingEquipment,
      ]);
      return new Set(
        defenders
          .filter((card) => (data(ctx, card).cost ?? 0) >= 3)
          .map((card) => card.instanceId),
      ).size;
    },
  },
  "tremor of resistance|0": {
    modifyDefense: (ctx) => (controlsSeismicSurge(ctx) ? 2 : 0),
  },

  "blinding of the old ones|1": heave(2, blindOwnedCards()),
  "disenchantment of the old ones|1": heave(2, oldOneDestroyAuras()),
  "smelting of the old ones|1": heave(2, oldOneSmeltEquipment()),
  "annexation of all things known|2": annexFaceUpArsenal(),
  "annexation of grandeur|2": annexAura(),
  "annexation of the forge|2": annexEquipment(),
  "hostile encroachment|1": hostileEncroachment(),
  "renounce grandeur|1": renounceGrandeur(),
  "aftershock|1": aftershock(),
  "aftershock|2": aftershock(),
  "aftershock|3": aftershock(),
  "little big foot|1": littleBigFoot(6),
  "little big foot|2": littleBigFoot(5),
  "little big foot|3": littleBigFoot(4),
  "draw a crowd|3": drawACrowd(),
  "promising terrain|3": promisingTerrain(),
  "tectonic instability|3": tectonicInstability(),

  "clash of heads|2": clashEquipment("head"),
  "clash of chests|2": clashEquipment("chest"),
  "clash of arms|2": clashEquipment("arms"),
  "clash of legs|2": clashEquipment("legs"),
  "clash of shields|2": clashEquipment("off-hand"),
  "clash of mountains|1": clashOfMountains(),
  "clash of mountains|2": clashOfMountains(),
  "clash of mountains|3": clashOfMountains(),
  "flatten the field|1": flattenTheField(),
  "flatten the field|2": flattenTheField(),
  "grind them down|1": grindThemDown(),
  "grind them down|2": grindThemDown(),
  "grind them down|3": grindThemDown(),
  "rubble raiser|1": heave(2),
  "rubble raiser|2": heave(2),
  "rubble raiser|3": heave(2),
  "overswing|1": overswing(3),
  "overswing|2": overswing(2),
  "overswing|3": overswing(1),
  "geyser of seismic stirrings|1": geyser(3),
  "geyser of seismic stirrings|2": geyser(2),
  "geyser of seismic stirrings|3": geyser(1),
  "crash and bash|2": crashAndBash(),
  "crash and bash|3": crashAndBash(),

  "sunkwater lookout|0": sunkwater(),
  "sunkwater exoshell|0": sunkwater(),
  "sunkwater pincers|0": sunkwater(),
  "sunkwater scalers|0": sunkwater(),
};

function destroyAuraChoice(ctx: ScriptCtx, seat: number, hook: string): void {
  const auras = ctx.player(seat).board.filter((card) => isAura(ctx, card));
  if (auras.length) ctx.requestCardChoice(hook, `${ctx.data.name}: destroy an aura`, auras.map((card) => card.instanceId), seat);
}

function clashAndDestroyAura(): CardScript {
  return {
    onDefend(ctx) { ctx.requestClash(opponentSeat(ctx), "bravado-clash"); },
    onClashResult(ctx, hook, winner) {
      if (hook !== "bravado-clash" || winner < 0) return;
      destroyAuraChoice(ctx, winner === ctx.seat ? opponentSeat(ctx) : ctx.seat, "bravado-aura");
      ctx.setCounter("bravadoWinner", winner);
    },
    onChoose(ctx, hook, option) {
      if (hook === "bravado-aura" && ctx.getCounter("bravadoWinner") >= 0) ctx.destroyPermanent(Number(option));
    },
  };
}

Object.assign(mpg, {
  "valda, seismic impact|0": valdaSeismicImpact(),
  "testament of valahai|0": {
    modifyDefense(ctx: ScriptCtx) {
      const count = seismicSurges(ctx).length;
      return count >= 6 ? 4 : count >= 3 ? 2 : 0;
    },
  },
  "ley line of the old ones|3": {
    onEnterArena(ctx: ScriptCtx) { ctx.createToken(SEISMIC_SURGE); },
    onFriendlyDamageDealt(ctx: ScriptCtx, _source: DeepReadonly<CardInstance>, _target: number, amount: number) {
      if (amount > 0) ctx.createToken(SEISMIC_SURGE);
    },
    onFriendlyCombatDamageDealt(ctx: ScriptCtx, _source: DeepReadonly<CardInstance>, _target: number, amount: number) {
      if (amount > 0) ctx.createToken(SEISMIC_SURGE);
    },
    triggers: [{ event: "end-of-turn", label: "Destroy Ley Line if you control no Seismic Surges", effect(ctx: ScriptCtx) {
      if (!controlsSeismicSurge(ctx)) ctx.destroySelf();
    } }],
  },
  "break stature|2": {
    canTriggerOnHit: crushTriggered,
    onHit(ctx: ScriptCtx) {
      const target = opponentSeat(ctx);
      const tokens = ctx.player(target).board.filter((card) => isAuraToken(ctx, card));
      if (tokens.length) ctx.requestCardChoice("break-aura", "Break Stature: destroy an aura token", tokens.map((card) => card.instanceId));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook !== "break-aura") return;
      if (ctx.destroyPermanent(Number(option))) ctx.preventAuraTokenCreationNextTurn(opponentSeat(ctx));
    },
  },
  "clash of bravado|2": clashAndDestroyAura(),
  "headbutt|3": {
    canBeDefendedBy(ctx: ScriptCtx, defending: DeepReadonly<CardInstance>) {
      return data(ctx, defending).cardType !== "equipment" || hasType(ctx, defending, "head");
    },
    modifyAttack(ctx: ScriptCtx) {
      const ownHead = ctx.player(ctx.seat).equipment.head !== undefined;
      const theirHead = ctx.player(opponentSeat(ctx)).equipment.head !== undefined;
      return ownHead && !theirHead ? 1 : 0;
    },
    canTriggerOnHit: crushTriggered,
    onHit(ctx: ScriptCtx) {
      const head = ctx.player(opponentSeat(ctx)).equipment.head;
      if (!head) return;
      ctx.addCardDefenseCounters(head.instanceId, -1);
      if ((head.defCounters ?? 0) <= 1) ctx.destroyPermanent(head.instanceId);
    },
  },
  "pec perfect|1": {
    onFriendlyDefended(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "pec-clash"); },
    onClashResult(ctx: ScriptCtx, hook: string, winner: number) {
      if (hook !== "pec-clash" || winner < 0) return;
      const loser = winner === ctx.seat ? opponentSeat(ctx) : ctx.seat;
      const top = ctx.player(loser).deck[0];
      if (top) ctx.moveToGraveyard(top.instanceId, "deck");
    },
  },
  "put 'em in their place|1": {
    canTriggerOnHit: crushTriggered,
    onHit(ctx: ScriptCtx) {
      const target = opponentSeat(ctx);
      const hand = [...ctx.player(target).hand];
      for (const card of hand) ctx.discardCard(target, card.instanceId);
      ctx.drawCards(target, hand.length);
    },
  },
  "solid ground|3": {
    modifyPlayCost(ctx: ScriptCtx, base: number) { return Math.max(0, base - seismicSurges(ctx).length); },
  },
  "leave a dent|3": {
    onPlay(ctx: ScriptCtx) {
      buffNextAttack(ctx, {
        appliesTo: "attack-action",
        appliesToClass: "guardian",
        onHitDestroyTopDeckCards: { count: 4, minimumDamage: 4 },
      });
    },
  },
  "visit anvilheim|3": {
    variablePlayCost: { base: 0, counterKey: "anvilheimX", prompt: "Choose X", maximum(ctx: ScriptCtx) { return ctx.player(ctx.seat).weapons.filter((card) => hasType(ctx, card, "off-hand")).reduce((maximum, card) => Math.max(maximum, -(card.defCounters ?? 0)), 0); } },
    onPlay(ctx: ScriptCtx) {
      const x = ctx.getCounter("anvilheimX");
      const offHands = ctx.player(ctx.seat).weapons.filter((card) => hasType(ctx, card, "off-hand") && -(card.defCounters ?? 0) >= x);
      if (x > 0 && offHands.length) ctx.requestCardChoice("anvilheim", `Remove ${x} -1 defense counter${x === 1 ? "" : "s"}`, offHands.map((card) => card.instanceId));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook === "anvilheim") ctx.addCardDefenseCounters(Number(option), ctx.getCounter("anvilheimX"));
    },
  },
  "daily grind|3": {
    triggers: [{ event: "start-of-turn", label: "Destroy Daily Grind", effect(ctx: ScriptCtx) { ctx.destroySelf(); } }],
    onFriendlyDefended(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "daily-clash"); },
    onClashResult(ctx: ScriptCtx, hook: string, winner: number) {
      if (hook !== "daily-clash" || winner < 0) return;
      const loser = winner === ctx.seat ? opponentSeat(ctx) : ctx.seat;
      const top = ctx.player(loser).deck[0];
      if (top) ctx.moveToGraveyard(top.instanceId, "deck");
    },
  },
  "seismic shelter|3": {
    triggers: [{ event: "start-of-turn", label: "Destroy Seismic Shelter", effect(ctx: ScriptCtx) { ctx.destroySelf(); } }],
    modifyDefense(ctx: ScriptCtx) { return seismicSurges(ctx).length; },
  },
  "seismic eruption|2": { onPlay(ctx: ScriptCtx) { ctx.createTokens(SEISMIC_SURGE, 3); } },
  "test of iron grip|1": {
    onDefend(ctx: ScriptCtx) { ctx.requestClash(opponentSeat(ctx), "iron-grip"); },
    onClashResult(ctx: ScriptCtx, hook: string, winner: number) {
      if (hook !== "iron-grip" || winner < 0) return;
      const loser = winner === ctx.seat ? opponentSeat(ctx) : ctx.seat;
      const hand = ctx.player(loser).hand;
      if (hand.length) ctx.requestCardChoice("iron-discard", "Test of Iron Grip: discard a card", hand.map((card) => card.instanceId), loser);
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "iron-discard") ctx.discardCard(opponentSeat(ctx), Number(option)); },
  },
  "base of the mountain|0": {
    modifyDefense(ctx: ScriptCtx) { return ctx.link?.defendingCards.filter((card) => ctx.hasCardType(card, "action")).length ?? 0; },
  },
  "call for backup|1": {
    onDefend(ctx: ScriptCtx) {
      const attacks = ctx.player(ctx.seat).graveyard.filter((card) => ctx.hasCardType(card, "action") && hasType(ctx, card, "attack"));
      if (attacks.length) ctx.requestCardChoice("backup-top", "Call for Backup: put an attack on top", attacks.map((card) => card.instanceId));
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) { if (hook === "backup-top") ctx.putOnDeckTop(Number(option)); },
  },
  "captain of the guard|3": {
    modifyDefense(ctx: ScriptCtx) { return ctx.link && ctx.currentPower(ctx.self) > ctx.currentAttackPower() ? 1 : 0; },
  },
  "fearless confrontation|3": {
    activated: {
      cost: 0, isAttack: false, goAgain: false, timing: "instant", fromHand: true,
      canActivate(ctx: ScriptCtx) { return ctx.state.chain.length > 0; },
      onActivate(ctx: ScriptCtx) {
        const attacks = ctx.state.chain.map((link) => link.attackingCard);
        if (attacks.length === 1) applyFearlessConfrontation(ctx, attacks[0]!.instanceId);
        else ctx.requestCardChoice(
          "fearless-attack",
          "Fearless Confrontation: choose an attack",
          attacks.map((attack) => attack.instanceId),
        );
      },
    },
    onChoose(ctx: ScriptCtx, hook: string, option: string) {
      if (hook === "fearless-attack") applyFearlessConfrontation(ctx, Number(option));
    },
  },
} satisfies Record<string, CardScript>);
