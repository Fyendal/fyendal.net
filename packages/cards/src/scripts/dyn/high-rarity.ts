import type { CardInstance, CardScript, DeepReadonly, ScriptCtx } from "@fyendal/engine";
import {
  anyDamageTarget,
  bottomOrKeepPrompt,
  buffNextArcaneDamageCard,
  buffNextAttack,
  cardNamed,
  commonOptionMessages,
  consumeDelayedEffect,
  contractWithSilver,
  dealArcane,
  dealtByThis,
  dealToAnyTarget,
  decisionMessage,
  decisionPrompt,
  entersArenaTrigger,
  equipWithSilver,
  heroDamage,
  hitHookLabel,
  leavesArenaTrigger,
  ongoingLabel,
  opponentSeat,
  pendingDelayedEffect,
  previousAttackHasName,
  withdrawNextArcaneDamageCard,
  yesNoPrompt,
} from "../shared-helpers.js";

const CROUCHING_TIGER = "DYN065";
const SILVER = "DYN245";
const PONDER = "DYN244";

function has(ctx: ScriptCtx, card: DeepReadonly<CardInstance>, type: string): boolean {
  return ctx.cardTypes(card).includes(type);
}
function isAttack(ctx: ScriptCtx, card: DeepReadonly<CardInstance>): boolean {
  return ctx.hasCardType(card, "action") && has(ctx, card, "attack");
}
function weapon(cost: number, extra: CardScript = {}): CardScript {
  const base = { cost, isAttack: true, goAgain: false, oncePerTurn: true } as const;
  const activated = extra.activated;
  return {
    ...extra,
    activated: !activated || Array.isArray(activated) ? (activated ?? base) : { ...base, ...activated },
  };
}
function discardChoice(ctx: ScriptCtx, hook: string, seat = opponentSeat(ctx)): void {
  const hand = ctx.player(seat).hand;
  if (hand.length)
    ctx.requestCardChoice(
      hook,
      decisionPrompt("Choose a card to discard", "card.common.card.discard.choose"),
      hand.map((card) => card.instanceId),
      seat,
    );
}
function arcane(amount: number, extra?: (ctx: ScriptCtx, dealt: number) => void): CardScript {
  return {
    arcaneDamageEffect: true,
    arcaneDamageEffectAmounts: [amount],
    onPlay(ctx) {
      const dealt = dealArcane(ctx, opponentSeat(ctx), amount);
      extra?.(ctx, dealt);
    },
  };
}
function graveyardAssassinEquipment(extra: CardScript = {}): CardScript {
  return {
    ...extra,
    triggers: [equipWithSilver(2)],
  };
}
function typedPermanents(ctx: ScriptCtx, seat: number, type: string): readonly DeepReadonly<CardInstance>[] {
  return ctx.player(seat).board.filter((card) => has(ctx, card, type));
}
function advanceDiabolic(ctx: ScriptCtx, stage: "ally" | "aura", seat: number): void {
  if (seat > 1) {
    if (stage === "ally" && ctx.getState("diabolicAura") > 0) return advanceDiabolic(ctx, "aura", 0);
    for (const type of ["ally", "aura"] as const)
      for (const targetSeat of [0, 1]) {
        const id = ctx.getState(`diabolic:${type}:${targetSeat}`);
        if (id > 0) ctx.destroyPermanent(id);
      }
    return;
  }
  const cards = typedPermanents(ctx, seat, stage);
  if (!cards.length) return advanceDiabolic(ctx, stage, seat + 1);
  ctx.requestCardChoice(
    `diabolic:${stage}:${seat}`,
    decisionPrompt(
      `Choose a ${stage} to destroy`,
      stage === "ally" ? "card.dyn.diabolic.ally.choose" : "card.dyn.diabolic.aura.choose",
    ),
    cards.map((card) => card.instanceId),
    seat,
  );
}
function warhornPermanents(ctx: ScriptCtx, seat: number): readonly DeepReadonly<CardInstance>[] {
  return ctx
    .player(seat)
    .board.filter((card) => ["ally", "aura", "item", "landmark"].some((type) => has(ctx, card, type)));
}
function finishHarpoonReveal(ctx: ScriptCtx, ids: number[]): void {
  const x = ctx.getState("harpoonX");
  if (!ctx.revealCards(ids, opponentSeat(ctx))) return;
  const hand = ctx.player(opponentSeat(ctx)).hand;
  const actions = ids.flatMap((id) => {
    const card = hand.find((candidate) => candidate.instanceId === id);
    return card && ctx.hasCardType(card, "action") && (ctx.cardData(card.cardId).defense ?? 99) <= x ? [card] : [];
  });
  if (ids.length) {
    ctx.requestCardChoice(
      "harpoon-defender",
      decisionPrompt(
        actions.length ? "Choose a revealed action card to defend" : "No revealed cards can defend",
        actions.length ? "card.dyn.harpoon.defender.choose" : "card.dyn.harpoon.defender.none",
        actions.length ? {} : { optionMessages: { Close: decisionMessage("common.option.close") } },
      ),
      actions.length ? actions.map((card) => card.instanceId) : ["Close"],
      undefined,
      ids,
    );
  }
}
function advanceWarhorn(ctx: ScriptCtx, afterSeat: number): void {
  const next = [0, 1].find(
    (target) =>
      target > afterSeat &&
      (ctx.getState("warhornMask") & (1 << target)) !== 0 &&
      warhornPermanents(ctx, target).length > 0,
  );
  if (next !== undefined) {
    ctx.requestCardChoice(
      `warhorn:${next}`,
      decisionPrompt("Choose a permanent to destroy", "card.dyn.warhorn.permanent.choose"),
      warhornPermanents(ctx, next).map((card) => card.instanceId),
      has(ctx, ctx.player(ctx.seat).hero, "royal") ? ctx.seat : next,
    );
    return;
  }
  for (const target of [0, 1]) {
    const id = ctx.getState(`warhornChoice:${target}`);
    if (id) ctx.destroyPermanent(id);
  }
}

/** The engine records each hit as `hitType:<type>` on the attacking player. */
function swordHitThisTurn(ctx: ScriptCtx): boolean {
  return ctx.state.players.some((player) => player.flags["hitType:sword"] === true);
}

export const dynHighRarity: Record<string, CardScript> = {
  "dust from the golden plains|1": { materialKeywords: ["phantasm"] },
  "dust from the red desert|1": { materialKeywords: ["phantasm"] },
  "dust from the shadow crypts|1": { materialKeywords: ["phantasm"] },
  "rok|0": weapon(3, {
    activated: {
      cost: 3,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      canActivate: (ctx) => ctx.player(ctx.seat).hand.length === 0,
    },
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "unpreventable", true);
    },
  }),
  "skull crack|1": {
    triggers: [
      {
        event: "card-discarded",
        sourceZone: "graveyard",
        label: "Gain 1 resource",
        condition: (ctx, discarded, eventContext) =>
          eventContext?.atRandom === true && discarded?.instanceId === ctx.self.instanceId,
        effect: (ctx) => ctx.changeResources(ctx.seat, 1),
      },
    ],
  },
  "berserk|2": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "whenever a card with 6 or more power is discarded at random, banish it " +
            "and reveal the top card of your deck; draw if it has 6 or more power",
          "card.effect.dyn.berserk",
        ),
      });
    },
    triggers: [
      {
        event: "card-discarded",
        label: "Banish the discarded card",
        condition: (ctx, discarded, eventContext) =>
          eventContext?.atRandom === true && !!discarded && ctx.basePower(discarded) >= 6,
        effect(ctx, discarded) {
          if (
            !discarded ||
            !ctx.player(discarded.owner).graveyard.some((card) => card.instanceId === discarded.instanceId) ||
            !ctx.banish(discarded.instanceId)
          )
            return;
          const top = ctx.player(ctx.seat).deck[0];
          if (top) {
            ctx.revealCards([top.instanceId]);
            if (ctx.basePower(top) >= 6) ctx.drawCards(ctx.seat, 1);
          }
        },
      },
    ],
  },
  "seasoned saviour|0": {
    onGameStart(ctx) {
      ctx.addCounter(ctx.self.instanceId, "defense", -2);
    },
  },
  "buckle|3": {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 1,
        dominate: true,
        appliesToType: ["guardian"],
        onHitScriptHook: {
          hook: "buckle-hit",
          ...hitHookLabel(
            "destroy an equipment they control with a -1 defense counter on it",
            "card.effect.dyn.buckle",
          ),
          heroOnly: true,
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "buckle-hit") return;
      const player = ctx.player(opponentSeat(ctx));
      const equipment = [
        ...Object.values(player.equipment),
        ...player.weapons.filter((card) => ctx.cardData(card.cardId).cardType === "equipment"),
      ].filter((card): card is DeepReadonly<CardInstance> => card !== undefined && (card.defCounters ?? 0) > 0);
      if (equipment.length === 1) ctx.destroyPermanent(equipment[0]!.instanceId);
      else if (equipment.length > 1)
        ctx.requestCardChoice(
          "buckle-equipment",
          decisionPrompt(
            "Buckle: destroy an equipment with a -1 defense counter",
            "card.dyn.buckle.equipment.choose",
          ),
          equipment.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "buckle-equipment") ctx.destroyPermanent(Number(option));
    },
  },
  "never yield|3": {
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Destroy Never Yield",
        effect(ctx) {
          ctx.destroySelf();
          if (!ctx.player(ctx.seat).hand.length) ctx.drawCards(ctx.seat, 1);
          if (ctx.compareLife(ctx.seat, opponentSeat(ctx)) < 0) ctx.gainLife(ctx.seat, 2);
        },
      },
    ],
  },
  "blazen yoroi|0": {
    modifyDefense(ctx) {
      return ctx.currentChainLinkNumber() >= 4 ? 4 : 0;
    },
  },
  "tiger swipe|1": {
    modifyAttack: (ctx) => (previousAttackHasName(ctx, "crouching tiger") ? 2 : 0),
    onAttackDeclared(ctx) {
      if (previousAttackHasName(ctx, "crouching tiger")) ctx.grantGoAgain();
    },
    canTriggerOnHit(ctx) {
      return previousAttackHasName(ctx, "crouching tiger");
    },
    onHit(ctx) {
      const count = ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "crouching tiger")).length;
      for (let i = 0; i < count; i++) {
        const tiger = ctx.createToken(CROUCHING_TIGER);
        if (tiger) ctx.banish(tiger.instanceId);
      }
    },
  },
  "mindstate of tiger|3": {
    triggers: [
      {
        event: "start-of-turn",
        whose: "subject",
        label: "Create Crouching Tiger",
        effect(ctx) {
          ctx.destroySelf();
          ctx.createCardInHand(CROUCHING_TIGER);
        },
      },
    ],
  },
  "roar of the tiger|2": {
    onPlay(ctx) {
      ctx.createCardInHand(CROUCHING_TIGER);
      ctx.addModifier({ scope: "until-end-of-turn", attack: 1, appliesToName: "Crouching Tiger" });
    },
  },
  "spirit of eirina|2": {
    replacesSoulMoveWithArena: true,
    allowsFriendlyCardPlayAsInstant(ctx, card) {
      return cardNamed(ctx, card, "lumina ascension");
    },
  },
  "jubeel, spellbane|0": weapon(1, {
    canTriggerOnHit: (ctx) =>
      ctx.link?.targetAllyId === undefined &&
      !ctx.player(ctx.seat).board.some((card) => cardNamed(ctx, card, "spellbane aegis")),
    onHit(ctx) {
      ctx.createToken("DYN246");
    },
  }),
  "merciless battleaxe|0": weapon(3, {
    onAttackDeclared(ctx) {
      if ((ctx.link?.attackingCard.tempPower ?? 0) + (ctx.data.attack ?? 0) > 2 * (ctx.data.attack ?? 0))
        ctx.setFlag("link", "overpower", true);
    },
  }),
  "cleave|1": {
    onPlay(ctx) {
      buffNextAttack(ctx, { attack: 4, appliesToSubtype: "axe" });
    },
    canTriggerOnHit(ctx) {
      return ctx.state.modifiers.some(
        (modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
      );
    },
    onHit(ctx) {
      const allies = typedPermanents(ctx, opponentSeat(ctx), "ally").filter(
        (card) => card.instanceId !== ctx.link?.targetAllyId,
      );
      if (allies.length && (ctx.link?.damage ?? 0) > 0) {
        ctx.setState("cleaveDamage", ctx.link!.damage);
        ctx.requestCardChoice(
          "cleave-ally",
          decisionPrompt("Deal the hit damage to another ally?", "card.dyn.cleave.ally.choose", {
            optionMessages: commonOptionMessages("no"),
          }),
          ["no", ...allies.map((card) => card.instanceId)],
        );
      }
    },
    onChoose(ctx, hook, option) {
      if (hook === "cleave-ally" && option !== "no")
        ctx.dealDamage(opponentSeat(ctx), ctx.getState("cleaveDamage"), { targetAllyId: Number(option) });
    },
  },
  "ironsong pride|1": {
    triggers: [
      entersArenaTrigger(
        "Put a +1 power counter on target sword you control",
        decisionMessage("card.trigger.dyn.ironsongpride.counter.add"),
        (ctx) => {
          if (ctx.playTargetInstanceId !== undefined) ctx.addCounter(ctx.playTargetInstanceId, "power", 1);
        },
        {
          target: {
            options: (ctx) =>
              ctx
                .player(ctx.seat)
                .weapons.filter((card) => has(ctx, card, "sword"))
                .map((card) => card.instanceId),
            prompt: () => decisionPrompt("Choose target sword you control", "card.dyn.ironsong.sword.target"),
          },
        },
      ),
      leavesArenaTrigger(
        "Remove all +1 power counters from swords you control",
        decisionMessage("card.trigger.dyn.ironsongpride.counters.remove"),
        (ctx) => {
          for (const sword of ctx.player(ctx.seat).weapons.filter((card) => has(ctx, card, "sword")))
            ctx.setCardCounter(sword.instanceId, "power", 0);
        },
      ),
      {
        event: "end-of-turn",
        label: "Destroy this unless a sword has hit this turn",
        labelMessage: decisionMessage("card.trigger.dyn.ironsongpride.destroy"),
        condition: (ctx) => !swordHitThisTurn(ctx),
        effect(ctx) {
          if (!swordHitThisTurn(ctx)) ctx.destroySelf();
        },
      },
    ],
  },
  "hanabi blaster|0": {
    activated: {
      cost: 0,
      isAttack: true,
      goAgain: false,
      oncePerTurn: true,
      removeCounterCost: { key: "steam", amount: 2 },
    },
    triggers: [
      {
        event: "card-played",
        label: "Put a steam counter on Hanabi Blaster",
        condition: (ctx, played) =>
          !!played &&
          (ctx.cardData(played.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "boost") &&
          Number(ctx.getFlag("player", "playedKeywordCount:boost")) === 3,
        effect(ctx) {
          ctx.addCounter(ctx.self.instanceId, "steam", 1);
        },
      },
    ],
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "overpower", true);
    },
  },
  "pulsewave harpoon|1": {
    onAttackDeclared(ctx) {
      // X bounds the defender's {d}; only the reveal count is capped by hand size.
      const x = Number(ctx.getFlag("player", "boostCountThisChain")) || 0;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      const revealCount = Math.min(x, hand.length);
      ctx.setState("harpoonX", x);
      if (revealCount <= 0) return;
      if (hand.length === revealCount)
        finishHarpoonReveal(ctx, hand.map((card) => card.instanceId));
      else
        ctx.requestCardChoices(
          "harpoon-reveal",
          decisionPrompt(
            `Choose ${revealCount} card${revealCount === 1 ? "" : "s"} to reveal`,
            "card.dyn.harpoon.reveal.cards.choose",
            { values: { count: revealCount } },
          ),
          hand.map((card) => card.instanceId),
          revealCount,
          revealCount,
          opponentSeat(ctx),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "harpoon-defender" && option !== "Close") ctx.addDefenderFromHand(Number(option));
    },
    onChooseMany(ctx, hook, options) {
      if (hook === "harpoon-reveal") finishHarpoonReveal(ctx, options.map(Number));
    },
  },
  "bios update|1": {
    onPlay(ctx) {
      ctx.addModifier({ scope: "until-end-of-turn", onBoostAttack: 3 });
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "put the next Mechanologist item with cost 2 or less banished to pay a boost cost into the arena",
          "card.effect.dyn.biosupdate",
        ),
      });
    },
    triggers: [
      {
        event: "card-banished-for-boost",
        label: "Bios Update — put the banished item into the arena",
        condition(ctx, card) {
          return (
            !!pendingDelayedEffect(ctx, { match: (modifier) => modifier.onBoostAttack === undefined }) &&
            !!card &&
            has(ctx, card, "mechanologist") &&
            has(ctx, card, "item") &&
            (ctx.cardData(card.cardId).cost ?? 99) <= 2
          );
        },
        onTrigger(ctx) {
          consumeDelayedEffect(ctx, { match: (modifier) => modifier.onBoostAttack === undefined });
        },
        effect(ctx, triggeredCard) {
          const item =
            triggeredCard && ctx.player(ctx.seat).banish.find((card) => card.instanceId === triggeredCard.instanceId);
          if (
            item &&
            has(ctx, item, "mechanologist") &&
            has(ctx, item, "item") &&
            (ctx.cardData(item.cardId).cost ?? 99) <= 2
          )
            ctx.settleCard(item.instanceId);
        },
      },
    ],
  },
  "construct nitro mechanoid|2": (() => {
    const mechanologistEquipment = (ctx: ScriptCtx) =>
      (["head", "chest", "arms", "legs"] as const).flatMap((slot) => {
        const card = ctx.player(ctx.seat).equipment[slot];
        return card && has(ctx, card, "mechanologist") ? [card] : [];
      });
    const mechanologistWeapons = (ctx: ScriptCtx) =>
      ctx.player(ctx.seat).weapons.filter((card) => has(ctx, card, "mechanologist"));
    const hyperDrivers = (ctx: ScriptCtx) =>
      ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "hyper driver"));
    // The chosen weapon rides in the driver hook suffix so the resumable
    // driver choice transforms that weapon rather than the first one.
    const transform = (ctx: ScriptCtx, weaponId: number, driverIds?: readonly number[]) => {
      const equipment = mechanologistEquipment(ctx);
      const weapon = mechanologistWeapons(ctx).find((card) => card.instanceId === weaponId);
      const drivers = hyperDrivers(ctx);
      if (equipment.length !== 4 || !weapon || drivers.length < 3) return;
      if (!driverIds && drivers.length > 3) {
        ctx.requestCardChoices(
          `nitro-mechanoid-drivers:${weaponId}`,
          decisionPrompt(
            "Choose 3 Hyper Drivers to transform",
            "card.dyn.nitromechanoid.hyperdrivers.transform",
          ),
          drivers.map((card) => card.instanceId),
          3,
          3,
        );
        return;
      }
      const available = new Set(drivers.map((card) => card.instanceId));
      const chosen = driverIds ?? [...available];
      if (
        chosen.length !== 3 ||
        new Set(chosen).size !== 3 ||
        !chosen.every((instanceId) => available.has(instanceId))
      )
        return;
      ctx.transformInto("DYN092B", [
        ...equipment.map((card) => card.instanceId),
        weapon.instanceId,
        ...chosen,
      ]);
    };
    return {
      onPlay(ctx) {
        const weapons = mechanologistWeapons(ctx);
        if (mechanologistEquipment(ctx).length !== 4 || weapons.length === 0 || hyperDrivers(ctx).length < 3)
          return;
        if (weapons.length === 1) {
          transform(ctx, weapons[0]!.instanceId);
          return;
        }
        ctx.requestCardChoice(
          "nitro-mechanoid-weapon",
          decisionPrompt(
            "Choose a weapon to transform",
            "card.dyn.nitromechanoid.weapon.transform",
          ),
          weapons.map((card) => card.instanceId),
        );
      },
      onChoose(ctx, hook, option) {
        if (hook === "nitro-mechanoid-weapon") transform(ctx, Number(option));
      },
      onChooseMany(ctx, hook, options) {
        const prefix = "nitro-mechanoid-drivers:";
        // Decisions persisted before the weapon choice existed carry no
        // suffix and transformed the first Mechanologist weapon.
        const weaponId = hook === "nitro-mechanoid-drivers"
          ? mechanologistWeapons(ctx)[0]?.instanceId
          : hook.startsWith(prefix) ? Number(hook.slice(prefix.length)) : undefined;
        if (weaponId !== undefined) transform(ctx, weaponId, options.map(Number));
      },
    };
  })(),
  "nitro mechanoid|0": {
    additionalCardTypes: ["equipment"],
    activated: {
      cost: 0,
      isAttack: true,
      goAgain: false,
      effectCardCosts: [
        {
          zone: "under",
          move: "banish",
          count: 1,
          prompt: decisionPrompt(
            "Choose a card to banish from under Nitro Mechanoid",
            "card.dyn.nitromechanoid.card.banish",
          ),
        },
      ],
    },
    onAttackDeclared(ctx) {
      ctx.setFlag("link", "overpower", true);
    },
  },
  "plasma mainline|1": {
    destroyAtZeroCounter: "steam",
    onEnterArena(ctx) {
      ctx.addCounter(ctx.self.instanceId, "steam", 5);
    },
    onFriendlyEnterArena(ctx, card) {
      if (
        !has(ctx, card, "mechanologist") ||
        !has(ctx, card, "item") ||
        (ctx.cardData(card.cardId).cost ?? 99) > 2 ||
        ctx.getCounter("steam") <= 0
      )
        return;
      ctx.requestChoice(
        `plasma-mainline:${card.instanceId}`,
        yesNoPrompt(
          `Move a steam counter from Plasma Mainline to ${ctx.cardData(card.cardId).name}?`,
          "card.dyn.plasmamainline.counter.move",
          {
            card: { kind: "card", cardId: ctx.self.cardId },
            target: { kind: "card", cardId: card.cardId },
          },
        ),
        ["yes", "no"],
      );
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("plasma-mainline:") || option !== "yes" || ctx.getCounter("steam") <= 0) return;
      const targetId = Number(hook.split(":")[1]);
      const target = ctx.player(ctx.seat).board.find((card) => card.instanceId === targetId);
      if (
        !target ||
        !has(ctx, target, "mechanologist") ||
        !has(ctx, target, "item") ||
        (ctx.cardData(target.cardId).cost ?? 99) > 2
      )
        return;
      ctx.addCounter(ctx.self.instanceId, "steam", -1);
      ctx.addCounter(target.instanceId, "steam", 1);
    },
  },
  "powder keg|3": {
    canTriggerOnHit(ctx) {
      const source = ctx.link?.attackingCard;
      if (!source || !ctx.link?.defendingEquipment.length) return false;
      const sourceTypes = ctx.cardTypes(source);
      return (
        has(ctx, source, "gun") ||
        (ctx.cardData(source.cardId).cardType === "weapon" &&
          sourceTypes.includes("mechanologist") &&
          sourceTypes.includes("pistol"))
      );
    },
    onHit(ctx) {
      const equipment = ctx.link?.defendingEquipment ?? [];
      if (equipment.length)
        ctx.requestCardChoice(
          "powder-keg-equipment",
          decisionPrompt("Choose defending equipment to destroy", "card.dyn.powderkeg.equipment.choose"),
          equipment.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook !== "powder-keg-equipment") return;
      const equipmentId = Number(option);
      if (ctx.destroyPermanent(equipmentId)) {
        ctx.setFlag("link", `equipmentGone:${equipmentId}`, true);
        ctx.destroySelf();
      }
    },
  },
  "arakni, huntsman|0": {
    triggers: [
      {
        event: "card-played",
        label: "Look at the opponent's top card?",
        labelMessage: decisionMessage("card.dyn.arakni.opponenttop.look"),
        optional: true,
        defaultOption: "yes",
        condition: (ctx, played) =>
          !!played &&
          (ctx.cardData(played.cardId).keywords ?? []).some((keyword) => keyword.toLowerCase() === "contract"),
        effect(ctx) {
          const top = ctx.player(opponentSeat(ctx)).deck[0];
          if (!top) return;
          ctx.lookAt(top.instanceId);
          ctx.setState("arakniTop", top.instanceId);
          ctx.requestChoice("arakni-top", bottomOrKeepPrompt(), ["bottom", "keep"]);
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "arakni-top" && option === "bottom") {
        ctx.putOnDeckBottom(ctx.getState("arakniTop"));
      }
    },
  },
  "blacktek whisperers|0": graveyardAssassinEquipment({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => !!ctx.link && has(ctx, ctx.link.attackingCard, "assassin"),
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link", onHitGoAgain: true });
      },
    },
  }),
  "mask of perdition|0": graveyardAssassinEquipment({
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "attack-reaction",
      destroySelfCost: true,
      canActivate: (ctx) => ctx.link?.attackCardType === "action" && has(ctx, ctx.link.attackingCard, "assassin"),
      onActivate(ctx) {
        ctx.addModifier({ scope: "chain-link" });
      },
    },
    canTriggerOnHit: (ctx) =>
      ctx.link?.targetAllyId === undefined &&
      ctx.state.modifiers.some(
        (modifier) => modifier.sourceInstanceId === ctx.self.instanceId && modifier.scope === "chain-link",
      ),
    onHit(ctx) {
      const top = ctx.player(opponentSeat(ctx)).deck[0];
      if (top) ctx.banish(top.instanceId);
    },
  }),
  "eradicate|2": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 2),
    canTriggerOnHit: (ctx) => ctx.link?.targetAllyId === undefined,
    onHit(ctx) {
      const count = Math.max(0, ctx.link?.damage ?? 0);
      for (const card of ctx.player(opponentSeat(ctx)).deck.slice(0, count)) ctx.banish(card.instanceId);
    },
  },
  "leave no witnesses|1": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 1),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const opp = ctx.player(opponentSeat(ctx));
      const top = opp.deck[0];
      if (top) ctx.banish(top.instanceId);
      const arsenal = opp.arsenal[0];
      if (arsenal) {
        ctx.setCardFaceDown(arsenal.instanceId, false);
        ctx.banish(arsenal.instanceId);
      }
    },
  },
  "regicide|3": {
    canBeDefendedBy(ctx, defending) {
      const names = new Set(
        ctx
          .player(opponentSeat(ctx))
          .banish.filter((card) => !card.faceDown)
          .flatMap((card) => ctx.cardNames(card)),
      );
      return !ctx.cardNames(defending).some((name) => names.has(name));
    },
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && has(ctx, ctx.player(opponentSeat(ctx)).hero, "royal");
    },
    onHit(ctx) {
      ctx.loseGame(opponentSeat(ctx));
    },
    onCombatChainClosed(ctx) {
      ctx.loseGame(ctx.seat);
    },
  },
  "surgical extraction|3": {
    ...contractWithSilver((ctx, card) => ctx.cardColor(card) === 3),
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined;
    },
    onHit(ctx) {
      const opponent = ctx.player(opponentSeat(ctx));
      const top = opponent.deck[0];
      if (top) ctx.banish(top.instanceId);
      for (const card of opponent.hand) ctx.lookAt(card.instanceId);
      if (opponent.hand.length)
        ctx.requestCardChoice(
          "surgical-hand",
          decisionPrompt("Choose an opposing hand card to banish", "card.dyn.surgical.hand.banish"),
          opponent.hand.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "surgical-hand") ctx.banish(Number(option));
    },
  },
  "pay day|3": {
    canPlay: (ctx) => ctx.getFlag("player", "completedContractThisTurn") === true,
    onPlay(ctx) {
      ctx.createTokens(SILVER, 4);
    },
  },
  "sandscour greatbow|0": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      onActivate(ctx) {
        const top = ctx.player(ctx.seat).deck[0];
        if (top) ctx.lookAt(top.instanceId);
        const cards = [...ctx.player(ctx.seat).hand, ...ctx.player(ctx.seat).deck.slice(0, 1)].filter((card) =>
          has(ctx, card, "arrow"),
        );
        if (cards.length)
          ctx.requestCardChoice(
            "sandscour-load",
            decisionPrompt("Put an arrow face up in arsenal", "card.dyn.sandscour.arrow.load", {
              optionMessages: commonOptionMessages("no"),
            }),
            ["no", ...cards.map((card) => card.instanceId)],
          );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook !== "sandscour-load" || option === "no") return;
      const from = ctx.player(ctx.seat).hand.some((card) => card.instanceId === Number(option)) ? "hand" : "deck";
      ctx.putIntoArsenal(Number(option), from, { faceUp: true });
    },
    // A separate trigger, so arrows any effect loads from the deck qualify.
    // It resolves after the loading effect; skip an arrow that has since left.
    canTriggerOnEnterArsenal: (ctx, card, from) => from === "deck" && has(ctx, card, "arrow"),
    onEnterArsenal(ctx, card) {
      if (ctx.player(ctx.seat).arsenal.some((held) => held.instanceId === card.instanceId && !held.faceDown))
        ctx.addCounter(card.instanceId, "aim", 1);
    },
  },
  "heat seeker|1": {
    onHit(ctx) {
      ctx.setState("heatSeekerEndTurn", ctx.state.turn);
    },
    triggers: [
      {
        event: "end-of-turn",
        whose: "subject",
        sourceZone: "graveyard",
        condition: (ctx) => ctx.getState("heatSeekerEndTurn") === ctx.state.turn,
        label: "Put the top card face up into arsenal",
        effect(ctx) {
          const top = ctx.player(ctx.seat).deck[0];
          if (top) ctx.putIntoArsenal(top.instanceId, "deck", { faceUp: true });
          ctx.setState("heatSeekerEndTurn", 0);
        },
      },
    ],
  },
  "immobilizing shot|1": {
    canTriggerOnHit(ctx) {
      return ctx.link?.targetAllyId === undefined && ctx.getCounter("aim") > 0;
    },
    onHit(ctx) {
      const target = opponentSeat(ctx);
      ctx.addModifier({
        scope: "until-end-of-turn",
        seat: target,
        attackActionCardCap: 1,
        nonAttackActionCardCap: 1,
        expiresAtEndOfSeatTurn: target,
        ...ongoingLabel(
          "can't play more than 1 attack action card and 1 non-attack action card",
          "card.effect.dyn.immobilizingshot",
        ),
      });
    },
  },
  "dead eye|2": {
    onPlay(ctx) {
      buffNextAttack(ctx, {
        attack: 3,
        appliesToSubtype: "arrow",
        // "If it has an aim counter, it gains 'When this hits a hero, look at
        // their hand and choose a card. They discard it.'"
        onHitScriptHook: {
          hook: "dead-eye-hit",
          ...hitHookLabel(
            "look at their hand and choose a card for them to discard",
            "card.effect.common.hand.discard.choose",
          ),
          heroOnly: true,
          requiresAttackCounter: "aim",
        },
      });
    },
    onGrantedHit(ctx, hook) {
      if (hook !== "dead-eye-hit") return;
      const hand = ctx.player(opponentSeat(ctx)).hand;
      for (const card of hand) ctx.lookAt(card.instanceId);
      if (hand.length)
        ctx.requestCardChoice(
          "dead-eye-discard",
          decisionPrompt("Dead Eye: choose a card — they discard it", "card.dyn.deadeye.discard.choose"),
          hand.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "dead-eye-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  },
  "amethyst tiara|0": {
    grantsSpellvoidToRunechants: true,
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: false,
      timing: "instant",
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.addModifier({
          scope: "until-end-of-turn",
          ...ongoingLabel("Runechants you control have spellvoid 1", "card.effect.dyn.amethysttiara"),
        });
      },
    },
  },
  "cryptic crossing|2": {
    onPlayCostPaid(ctx, cards) {
      ctx.setState("mixedPitch",
        cards.some((card) => isAttack(ctx, card)) &&
          cards.some((card) => !isAttack(ctx, card) && ctx.hasCardType(card, "action"))
          ? 1
          : 0,
      );
    },
    triggers: [
      {
        event: "damage-dealt",
        sourceZone: "self",
        label: "The defending hero discards a card and you draw a card",
        labelMessage: { id: "card.trigger.common.defender.discard.draw" },
        // "The first time": the attack's link records that it triggered.
        condition: (ctx, eventCard, event) =>
          dealtByThis(ctx, eventCard) &&
          ctx.getState("mixedPitch") > 0 &&
          heroDamage(event)?.targetSeat === opponentSeat(ctx) &&
          ctx.getFlag("link", "crypticDamage") !== true,
        onTrigger: (ctx) => ctx.setFlag("link", "crypticDamage", true),
        effect(ctx) {
          discardChoice(ctx, "cryptic-discard");
          ctx.drawCards(ctx.seat, 1);
        },
      },
    ],
    onChoose(ctx, hook, option) {
      if (hook === "cryptic-discard") ctx.discardCard(opponentSeat(ctx), Number(option));
    },
  },
  "diabolic ultimatum|1": {
    onPlayCostPaid(ctx, cards) {
      ctx.setState("diabolicAlly", cards.some(isAttack.bind(undefined, ctx)) ? 1 : 0);
      ctx.setState("diabolicAura",
        cards.some((card) => ctx.hasCardType(card, "action") && !has(ctx, card, "attack")) ? 1 : 0,
      );
    },
    onPlay(ctx) {
      if (ctx.getState("diabolicAlly") > 0) advanceDiabolic(ctx, "ally", 0);
      else if (ctx.getState("diabolicAura") > 0) advanceDiabolic(ctx, "aura", 0);
    },
    onChoose(ctx, hook, option) {
      if (!hook.startsWith("diabolic:")) return;
      const [, stage, seatText] = hook.split(":");
      ctx.setCardState(ctx.self.instanceId, hook, Number(option));
      advanceDiabolic(ctx, stage as "ally" | "aura", Number(seatText) + 1);
    },
  },
  "looming doom|3": {
    triggers: [
      entersArenaTrigger(
        "Destroy your Runechants and put that many doom counters on Looming Doom",
        decisionMessage("card.trigger.dyn.loomingdoom.runechants.doom"),
        (ctx) => {
          const runechants = ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "runechant"));
          for (const card of runechants) ctx.destroyPermanent(card.instanceId);
          ctx.addCounter(ctx.self.instanceId, "doom", runechants.length);
        },
      ),
      {
        event: "end-of-turn",
        label: "Resolve Looming Doom",
        effect(ctx) {
          if (ctx.getCounter("doom") <= 0) {
            ctx.destroySelf();
            return;
          }
          ctx.addCounter(ctx.self.instanceId, "doom", -1);
          dealArcane(ctx, opponentSeat(ctx), 2);
        },
      },
    ],
  },
  "surgent aethertide|0": {
    activated: {
      cost: 2,
      isAttack: false,
      goAgain: true,
      oncePerTurn: true,
      onActivate(ctx) {
        dealArcane(ctx, opponentSeat(ctx), 1);
      },
    },
    // Until the first arcane damage card of the turn is played, it is the
    // next one, so the damage dealt joins the engine's next-card pool.
    onDamageDealt(ctx, _targetSeat, amount, arcane) {
      if (arcane && amount > 0 && ctx.arcaneDamageCardsPlayedThisTurn() === 0)
        buffNextArcaneDamageCard(ctx, amount);
    },
    onLeaveArena: withdrawNextArcaneDamageCard,
  },
  "swell tidings|1": arcane(5, (ctx, dealt) => {
    if (dealt > 5) ctx.createToken(PONDER);
  }),
  "brainstorm|3": {
    onPlay(ctx) {
      ctx.addModifier({
        scope: "until-end-of-turn",
        ...ongoingLabel(
          "deal 1 arcane damage to any target whenever you draw a card during the action phase",
          "card.effect.dyn.brainstorm",
        ),
      });
    },
    triggers: [
      {
        event: "card-drawn",
        label: "Deal 1 arcane damage to any target",
        labelMessage: decisionMessage("card.trigger.common.arcane.anytarget", { amount: 1 }),
        condition: (ctx) => ["action", "layer", "reaction"].includes(ctx.state.phase),
        target: anyDamageTarget((ctx) => {
          const amount = ctx.previewArcaneDamage(1);
          return decisionPrompt(`Choose a target for ${amount} arcane damage`, "card.dyn.brainstorm.target.choose", {
            values: { amount },
          });
        }),
        effect: (ctx) => dealToAnyTarget(ctx, ctx.playTargetInstanceId, 1, { arcane: true }),
      },
    ],
  },
  "invoke suraya|2": {
    onPlay(ctx) {
      const shields = ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "spectral shield"));
      if (shields.length)
        ctx.requestCardChoice(
          "suraya-transform",
          decisionPrompt("Choose a Spectral Shield", "card.dyn.suraya.shield.choose"),
          shields.map((card) => card.instanceId),
        );
    },
    onChoose(ctx, hook, option) {
      if (hook === "suraya-transform") ctx.transformInto("DYN212B", [Number(option)], ctx.self.instanceId);
    },
  },
  "suraya, archangel of knowledge|0": {
    activated: { cost: 0, isAttack: true, goAgain: false, oncePerTurn: true },
    triggers: [
      {
        event: "damage-dealt",
        label: "Gain life equal to the damage dealt",
        labelMessage: { id: "card.trigger.common.life.gain.damage" },
        condition: (ctx, eventCard) => dealtByThis(ctx, eventCard),
        effect(ctx, _eventCard, event) {
          const amount = event?.damage?.amount ?? 0;
          if (amount > 0) ctx.gainLife(ctx.seat, amount);
        },
      },
    ],
  },
  "celestial kimono|0": {
    onFriendlyDestroyed(ctx, card) {
      if (card.instanceId === ctx.self.instanceId || has(ctx, card, "ward")) ctx.changeResources(ctx.seat, 1);
    },
  },
  "phantasmal symbiosis|2": {
    onAttackDeclared(ctx) {
      ctx.requestNameChoice("symbiosis-name", decisionPrompt("Name a card", "card.common.card.name"));
    },
    onChoose(ctx, hook, option) {
      if (hook === "symbiosis-name")
        ctx.addModifier({
          scope: "until-end-of-turn",
          grantsTypeToName: option.toLowerCase(),
          grantsType: "illusionist",
        });
    },
  },
  "spectral procession|1": {
    modifyAttack(ctx) {
      return (
        ctx.player(ctx.seat).board.filter((card) => cardNamed(ctx, card, "spectral shield")).length - (ctx.data.attack ?? 0)
      );
    },
  },
  "tome of aeo|3": {
    triggers: [
      {
        event: "begin-action-phase",
        whose: "subject",
        label: "Destroy Tome of Aeo",
        effect(ctx) {
          ctx.destroySelf();
          ctx.drawCards(ctx.seat, 1);
        },
      },
    ],
  },
  "crown of dominion|0": {
    equippedHeroTypes: ["royal"],
    onGameStart(ctx) {
      ctx.createToken("DYN243");
    },
  },
  "imperial edict|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      destroySelfCost: true,
      onActivate(ctx) {
        if (has(ctx, ctx.player(ctx.seat).hero, "royal"))
          ctx.revealCards(
            ctx.player(opponentSeat(ctx)).hand.map((card) => card.instanceId),
            opponentSeat(ctx),
          );
        ctx.requestNameChoice("edict-name", decisionPrompt("Name a card", "card.common.card.name"));
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "edict-name")
        ctx.addModifier({
          scope: "until-end-of-turn",
          prohibitsName: option.toLowerCase(),
          expiresAtStartOfSeatTurn: ctx.seat,
          ...ongoingLabel(`${option} can't be played`, "card.effect.dyn.imperialedict", { name: option }),
        });
    },
  },
  "imperial ledger|1": {
    activated: {
      cost: 0,
      isAttack: false,
      goAgain: true,
      oncePerTurn: false,
      onActivate(ctx) {
        ctx.putOnDeckBottom(ctx.self.instanceId);
        ctx.createToken(has(ctx, ctx.player(ctx.seat).hero, "royal") ? "DYN243" : "DYN247");
      },
    },
  },
  "imperial warhorn|1": {
    activated: {
      cost: 1,
      isAttack: false,
      goAgain: false,
      oncePerTurn: false,
      destroySelfCost: true,
      onActivate(ctx) {
        ctx.requestChoice(
          "warhorn-heroes",
          decisionPrompt("Choose heroes", "card.dyn.warhorn.heroes.choose", {
            optionMessages: commonOptionMessages("both", "opponent", "self", "none"),
          }),
          ["both", "opponent", "self", "none"],
        );
      },
    },
    onChoose(ctx, hook, option) {
      if (hook === "warhorn-heroes") {
        const seats =
          option === "both" ? [0, 1] : option === "none" ? [] : [option === "self" ? ctx.seat : opponentSeat(ctx)];
        ctx.setState("warhornMask",
          seats.reduce((mask, target) => mask | (1 << target), 0),
        );
        advanceWarhorn(ctx, -1);
      } else if (hook.startsWith("warhorn:")) {
        const seat = Number(hook.split(":")[1]);
        ctx.setCardState(ctx.self.instanceId, `warhornChoice:${seat}`, Number(option));
        advanceWarhorn(ctx, seat);
      }
    },
  },
};
