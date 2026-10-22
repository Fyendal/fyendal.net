import type {
  EffectLifetime,
  GameMessage,
  GameMessageValue,
  OngoingEffectFacts,
  OngoingEffectView,
} from "@fyendal/shared";
import type { EngineRuntime } from "./runtimePorts.js";
import type { GameStateInternal } from "./runtimeState.js";
import type { CardInstance, Modifier, PlayerState } from "./state.js";
import { dataOf, isClassOrTalentSupertype, scriptOf } from "./cardProperties.js";
import { firstActionExtraCost } from "./ruleQueries.js";
import { controlledPermanents } from "./sourceQueries.js";
import { currentLink, findCardAnywhere, opponent } from "./zoneQueries.js";

type MessageValues = Record<string, GameMessageValue>;

/** One effect phrase: its English fallback and, unless the text is a
 *  script-supplied label without one, the catalog message that renders it. */
interface Phrase {
  text: string;
  message?: GameMessage;
}

const message = (id: string, values?: MessageValues): GameMessage => ({
  id,
  ...(values ? { values } : {}),
});

const phrase = (text: string, id: string, values?: MessageValues): Phrase => ({
  text,
  message: message(id, values),
});

const signed = (amount: number): string => `${amount > 0 ? "+" : ""}${amount}`;
const titleCase = (text: string): string =>
  text.replace(/(^|\s)(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
const article = (word: string): "a" | "an" => (/^[aeiou]/i.test(word) ? "an" : "a");
const cardValue = (cardId: string): GameMessageValue => ({ kind: "card", cardId });

/** Type words as card text prints them: classes, talents, and Evo
 *  capitalized; other subtypes ("sword", "aura") lowercase. */
function typeWord(tag: string): string {
  const lower = tag.toLowerCase();
  return isClassOrTalentSupertype(lower) || lower === "evo" ? titleCase(lower) : lower;
}

const PITCH_NAMES: Record<number, "red" | "yellow" | "blue"> = { 1: "red", 2: "yellow", 3: "blue" };
const ACTION_PHASES: ReadonlySet<string> = new Set(["action", "layer", "reaction", "defend"]);

const subtypesOf = (m: Modifier): readonly string[] =>
  m.appliesToSubtype === undefined ? []
    : Array.isArray(m.appliesToSubtype) ? m.appliesToSubtype : [m.appliesToSubtype];

const phraseText = (phrases: readonly Phrase[]): string => phrases.map((part) => part.text).join(", ");

/** A modifier's play and activation cost reductions; negative costs more. */
function costReductions(m: Modifier): { play: number; activate: number } {
  if (m.attackCostReduction) {
    return {
      play: m.attackCostReduction,
      activate: m.appliesTo === "attack-action" ? 0 : m.attackCostReduction,
    };
  }
  return {
    play: m.playCostReduction ?? 0,
    activate: (m.activationCostReduction ?? 0) || (m.attackActivationCostReduction ?? 0),
  };
}

function costPhrases(m: Modifier): Phrase[] {
  const cost = (amount: number, action: "play" | "activate" | "both"): Phrase => {
    const change = amount < 0 ? "more" : "less";
    const verb = action === "both" ? "play or activate" : action;
    return phrase(
      `costs ${Math.abs(amount)} ${change} to ${verb}`,
      "engine.effect.part.cost",
      { cost: Math.abs(amount), costChange: change, costAction: action },
    );
  };
  const { play, activate } = costReductions(m);
  if (play && play === activate) return [cost(play, "both")];
  return [
    ...(play ? [cost(play, "play")] : []),
    ...(activate ? [cost(activate, "activate")] : []),
  ];
}

/** Lingering-modifier effect phrases, before the duration. */
function modifierPhrases(state: GameStateInternal, m: Modifier): Phrase[] {
  const parts: Phrase[] = [];
  const instanceCardId = (instanceId: number | undefined): string | undefined =>
    instanceId === undefined ? undefined : findCardAnywhere(state, instanceId)?.card.cardId;
  const nameOf = (cardId: string): string => dataOf(state, cardId).name;
  const tokenValues = (key: string, cardId: string): MessageValues => ({
    [key]: cardValue(cardId),
    [`${key}Article`]: article(nameOf(cardId)),
  });
  const tokens = (cardId: string, count: number): string => {
    const name = nameOf(cardId);
    return count === 1 ? `${article(name)} ${name} token` : `${count} ${name} tokens`;
  };

  if (m.basePower !== undefined) {
    parts.push(phrase(`${m.basePower} base power`, "engine.effect.part.base.attack", { basePower: m.basePower }));
  }
  if (m.attackFromBasePower) {
    parts.push(phrase("+X power, where X is its base power", "engine.effect.part.attack.base.power"));
  }
  if (m.attack) {
    const attack = signed(m.attack);
    parts.push(m.defendedLessThanNonEquip === undefined
      ? phrase(`${attack} power`, "engine.effect.part.attack", { attack })
      : phrase(
        `${attack} power while defended by fewer than ${m.defendedLessThanNonEquip} non-equipment cards`,
        "engine.effect.part.attack.lightly.defended",
        { attack, defenders: m.defendedLessThanNonEquip },
      ));
  }
  if (m.piercing) parts.push(phrase(`piercing ${m.piercing}`, "engine.effect.part.piercing", { piercing: m.piercing }));
  if (m.defense) {
    const defense = signed(m.defense);
    parts.push(phrase(`${defense} defense`, "engine.effect.part.defense", { defense }));
  }
  parts.push(...costPhrases(m));
  if (m.minimumAttackBasePower !== undefined) {
    parts.push(phrase(
      `can only play or activate attacks with ${m.minimumAttackBasePower} or more base power`,
      "engine.effect.part.minimum.base.attack",
      { minimumAttack: m.minimumAttackBasePower },
    ));
  }
  if (m.restrictActionsToWeaponOrAttack) {
    parts.push(phrase("can only play or activate weapon and attack actions", "engine.effect.part.only.weapon.attack.actions"));
  }
  if (m.restrictActionsToNonWeaponNonAttack) {
    parts.push(phrase(
      "can only play or activate non-weapon, non-attack actions",
      "engine.effect.part.only.non.weapon.attack.actions",
    ));
  }
  if (m.restrictCardPlaysToType) {
    const playType = typeWord(m.restrictCardPlaysToType);
    parts.push(phrase(`can only play ${playType} cards`, "engine.effect.part.only.play.type", { playType }));
  }
  if (m.grantType) {
    const grantedType = typeWord(m.grantType);
    parts.push(phrase(`is also ${grantedType}`, "engine.effect.part.grant.type", { grantedType }));
  }
  if (m.grantName) {
    parts.push(phrase(`is named ${m.grantName}`, "engine.effect.part.grant.name", { grantedName: m.grantName }));
  }
  if (m.grantKeyword) {
    const keyword = m.grantKeyword.toLowerCase();
    parts.push(phrase(keyword, "engine.effect.part.keyword", { keyword }));
  }
  if (m.suppressKeyword) {
    const lostKeyword = m.suppressKeyword.toLowerCase();
    parts.push(phrase(`loses ${lostKeyword}`, "engine.effect.part.keyword.lost", { lostKeyword }));
  }
  if (m.goAgain) parts.push(phrase("go again", "engine.effect.part.go.again"));
  if (m.onHitGoAgain) parts.push(phrase("go again when it hits", "engine.effect.part.go.again.on.hit"));
  if (m.goAgainIfPlayedOrCreatedSubtype) {
    const createdType = typeWord(m.goAgainIfPlayedOrCreatedSubtype);
    const createdArticle = article(createdType);
    parts.push(phrase(
      `go again if you've played or created ${createdArticle} ${createdType} this turn`,
      "engine.effect.part.go.again.if.played.or.created",
      { createdType, createdArticle },
    ));
  }
  if (m.goAgainIfAttackPowerAtLeast !== undefined) {
    parts.push(phrase(
      `go again while it has ${m.goAgainIfAttackPowerAtLeast} or more power`,
      "engine.effect.part.go.again.if.attack",
      { goAgainAttack: m.goAgainIfAttackPowerAtLeast },
    ));
  }
  if (m.goAgainIfDefendedByAttackAction) {
    parts.push(phrase(
      "go again if defended by an attack action card",
      "engine.effect.part.go.again.if.defended.by.attack.action",
    ));
  }
  if (m.dominate) parts.push(phrase("dominate", "engine.effect.part.dominate"));
  if (m.overpower) parts.push(phrase("overpower", "engine.effect.part.overpower"));
  if (m.intimidate) {
    parts.push(phrase(
      m.intimidate > 1 ? `intimidate ${m.intimidate}` : "intimidate",
      "engine.effect.part.intimidate",
      { intimidate: m.intimidate },
    ));
  }
  if (m.maxNonBlockDefenders !== undefined) {
    parts.push(phrase(
      `can't be defended by more than ${m.maxNonBlockDefenders} non-block cards`,
      "engine.effect.part.max.non.block.defenders",
      { maxDefenders: m.maxNonBlockDefenders },
    ));
  }
  if (m.damage) {
    const damageBonus = signed(m.damage);
    parts.push(phrase(
      `${damageBonus} ${m.damageArcaneOnly ? "arcane " : ""}damage`,
      "engine.effect.part.damage",
      { damageBonus, damageKind: m.damageArcaneOnly ? "arcane" : "any" },
    ));
  }
  if (m.damageUnpreventable) {
    parts.push(phrase("its damage can't be prevented", "engine.effect.part.damage.unpreventable"));
  }
  if (m.powerGainBonus) {
    parts.push(phrase(
      `the next time an attack would gain power, it gains ${m.powerGainBonus} more`,
      "engine.effect.part.attack.gain.bonus",
      { gainBonus: m.powerGainBonus },
    ));
  }
  if (m.onHitGainLife) {
    parts.push(phrase(
      `gain ${m.onHitGainLife} life the next time you hit`,
      "engine.effect.part.on.hit.gain.life",
      { life: m.onHitGainLife },
    ));
  }
  if (m.onHitGainResources) {
    const resources = m.onHitGainResources;
    parts.push(phrase(
      `gain ${resources} ${resources === 1 ? "resource" : "resources"} the next time you hit`,
      "engine.effect.part.on.hit.gain.resources",
      { resources },
    ));
  }
  if (m.onHitDraw) {
    parts.push(phrase(
      `draw ${m.onHitDraw === 1 ? "a card" : `${m.onHitDraw} cards`} when it hits`,
      "engine.effect.part.on.hit.draw",
      { draw: m.onHitDraw },
    ));
  }
  if (m.onHitCreateToken) {
    const { cardId, count } = m.onHitCreateToken;
    parts.push(phrase(
      `create ${tokens(cardId, count)} when it hits`,
      "engine.effect.part.on.hit.create.token",
      { ...tokenValues("token", cardId), tokenCount: count },
    ));
  }
  if (m.onHitLoseLife) {
    parts.push(phrase(
      `when it hits a hero, they lose ${m.onHitLoseLife} life`,
      "engine.effect.part.on.hit.lose.life",
      { lifeLoss: m.onHitLoseLife },
    ));
  }
  if (m.onHitDealDamage) {
    parts.push(phrase(
      `deal ${m.onHitDealDamage} damage when it hits`,
      "engine.effect.part.on.hit.deal.damage",
      { hitDamage: m.onHitDealDamage },
    ));
  }
  if (m.onHitMark) parts.push(phrase("mark the hero when it hits", "engine.effect.part.on.hit.mark"));
  if (m.onHitDestroyTopDeckCards) {
    const { count, minimumDamage } = m.onHitDestroyTopDeckCards;
    parts.push(phrase(
      `destroy the top ${count} cards of their deck when it deals ${minimumDamage} or more damage to a hero`,
      "engine.effect.part.crush.destroy.deck",
      { destroyCount: count, minimumDamage },
    ));
  }
  if (m.onHitScriptHook) {
    const { heroOnly, label, labelMessage } = m.onHitScriptHook;
    const text = `when it hits${heroOnly ? " a hero" : ""}: ${label}`;
    // The script's message is a term inside the phrase, so its values join
    // the phrase's; the term precedes the phrase so it resolves first.
    parts.push(labelMessage
      ? phrase(text, "engine.effect.part.on.hit.script", {
        ...labelMessage.values,
        hitTarget: heroOnly ? "hero" : "any",
        hitEffect: { kind: "term", id: labelMessage.id },
      })
      : { text });
  }
  if (m.onDamageDealtCreateTokenPerPoint) {
    const cardId = m.onDamageDealtCreateTokenPerPoint;
    parts.push(phrase(
      `whenever it deals damage to a hero, create that many ${nameOf(cardId)} tokens under their control`,
      "engine.effect.part.damage.create.tokens",
      { damageToken: cardValue(cardId) },
    ));
  }
  if (m.onDefendedDealDamage) {
    parts.push(phrase(
      `deal ${m.onDefendedDealDamage} damage to the defending hero when defended`,
      "engine.effect.part.on.defended.deal.damage",
      { defendedDamage: m.onDefendedDealDamage },
    ));
  }
  if (m.suppressHitEffects || m.suppressHitEffectsThisTurn) {
    parts.push(phrase("its hit effects don't trigger", "engine.effect.part.hit.effects.suppressed"));
  }
  if (m.onBoostAttack) {
    const boostAttack = signed(m.onBoostAttack);
    parts.push(phrase(
      `the next attack you boost gets ${boostAttack} power`,
      "engine.effect.part.on.boost.attack",
      { boostAttack },
    ));
  }
  if (m.onBoostDominate) {
    parts.push(phrase("the next attack you boost gets dominate", "engine.effect.part.on.boost.dominate"));
  }
  if (m.onActionPlayedGainActionPoints) {
    const actionPoints = m.onActionPlayedGainActionPoints;
    const actionMinCost = m.minCost ?? 0;
    parts.push(phrase(
      `gain ${actionPoints === 1 ? "an action point" : `${actionPoints} action points`} ` +
        `the next time you play an action card with cost ${actionMinCost} or more`,
      "engine.effect.part.action.played.gain.action.points",
      { actionPoints, actionMinCost },
    ));
  }
  if (m.onAttackActionPlayedFromBanishCreateToken) {
    const { cardId, count } = m.onAttackActionPlayedFromBanishCreateToken;
    parts.push(phrase(
      `create ${tokens(cardId, count)} when you play an attack action card from banish`,
      "engine.effect.part.banish.play.create.token",
      { ...tokenValues("banishToken", cardId), banishTokenCount: count },
    ));
  }
  if (m.onFriendlyActivateCreateToken) {
    parts.push(phrase(
      `create ${tokens(m.onFriendlyActivateCreateToken, 1)} whenever they activate an ability`,
      "engine.effect.part.activate.create.token",
      tokenValues("activateToken", m.onFriendlyActivateCreateToken),
    ));
  }
  if (m.extraDiceIgnoreLowest) {
    const extraDice = m.extraDiceIgnoreLowest;
    parts.push(phrase(
      `roll ${extraDice} more ${extraDice === 1 ? "die" : "dice"} and ignore the lowest`,
      "engine.effect.part.extra.dice",
      { extraDice },
    ));
  }
  if (m.suppressesOwnedClassTalentTypes) {
    parts.push(phrase("cards they own lose all class and talent types", "engine.effect.part.lose.class.talent.types"));
  }
  if (m.replaceCombatDamageWithDefendingEquipment) {
    parts.push(phrase(
      "may destroy a defending equipment instead of dealing damage",
      "engine.effect.part.destroy.defending.equipment",
    ));
  }
  const lockedCardId = instanceCardId(m.suppressesActivatedAbilitiesOfInstanceId);
  if (lockedCardId) {
    parts.push(phrase(
      `${nameOf(lockedCardId)}'s activated abilities can't be activated`,
      "engine.effect.part.activated.abilities.locked",
      { lockedCard: cardValue(lockedCardId) },
    ));
  }
  const benchedCardId = instanceCardId(m.cannotDefendWithInstanceId);
  if (benchedCardId) {
    parts.push(phrase(
      `${nameOf(benchedCardId)} can't defend`,
      "engine.effect.part.cannot.defend",
      { benchedCard: cardValue(benchedCardId) },
    ));
  }
  if (m.grantsTypeToName && m.grantsType) {
    const typedName = titleCase(m.grantsTypeToName);
    const namedType = typeWord(m.grantsType);
    parts.push(phrase(
      `cards named ${typedName} are ${namedType}`,
      "engine.effect.part.name.gains.type",
      { typedName, namedType },
    ));
  }
  if (m.preventNextDamagePool) {
    const chosenSource = instanceCardId(m.appliesToInstanceId);
    parts.push(chosenSource
      ? phrase(
        `prevent next ${m.preventNextDamagePool} damage from ${nameOf(chosenSource)}`,
        "engine.effect.summary.prevent.damage.from",
        { amount: m.preventNextDamagePool, source: cardValue(chosenSource) },
      )
      : phrase(
        `prevent next ${m.preventNextDamagePool} damage`,
        "engine.effect.summary.prevent.damage",
        { amount: m.preventNextDamagePool },
      ));
  }
  if (m.preventDamagePerEvent && m.preventDamageEventsRemaining) {
    const events = m.preventDamageEventsRemaining;
    parts.push(phrase(
      `prevent ${m.preventDamagePerEvent} damage the next ${events === 1 ? "time" : `${events} times`} ` +
        "you would be dealt damage",
      "engine.effect.part.prevent.each.event",
      { perEvent: m.preventDamagePerEvent, events },
    ));
  }
  if (m.preventNextDamageAmount) {
    if (m.maxDamageEventAmount !== undefined) {
      parts.push(phrase(
        `prevent the next damage of ${m.maxDamageEventAmount} or less`,
        "engine.effect.part.prevent.small.damage",
        { maxEvent: m.maxDamageEventAmount },
      ));
    } else if (m.appliesToDamageRecipientType) {
      const recipientType = typeWord(m.appliesToDamageRecipientType);
      parts.push(phrase(
        `prevent next ${m.preventNextDamageAmount} damage to you ` +
          `or ${article(recipientType)} ${recipientType} you control`,
        "engine.effect.part.prevent.damage.recipient.type",
        { amount: m.preventNextDamageAmount, recipientType, recipientTypeArticle: article(recipientType) },
      ));
    } else if (m.appliesToDamageSourceType) {
      const sourceType = typeWord(m.appliesToDamageSourceType);
      parts.push(phrase(
        `prevent next ${m.preventNextDamageAmount} damage from ${article(sourceType)} ${sourceType} source`,
        "engine.effect.part.prevent.damage.source.type",
        { amount: m.preventNextDamageAmount, sourceType, sourceTypeArticle: article(sourceType) },
      ));
    } else {
      parts.push(phrase(
        `prevent next ${m.preventNextDamageAmount} damage`,
        "engine.effect.summary.prevent.damage",
        { amount: m.preventNextDamageAmount },
      ));
    }
  }
  if (m.preventNextDamageFromPitch !== undefined) {
    const sourceColor = PITCH_NAMES[m.preventNextDamageFromPitch] ?? "any";
    parts.push(phrase(
      `prevent the next damage from a ${sourceColor} source`,
      "engine.effect.part.prevent.damage.color",
      { sourceColor },
    ));
  }
  if (m.preventAllDamageFromSource) {
    const chosenSource = instanceCardId(m.appliesToInstanceId);
    parts.push(chosenSource
      ? phrase(
        `prevent all damage from ${nameOf(chosenSource)}`,
        "engine.effect.part.prevent.all.damage.from",
        { source: cardValue(chosenSource) },
      )
      : phrase("prevent all damage from the chosen source", "engine.effect.part.prevent.all.damage.chosen"));
  }
  if (m.discardDamagePreventionAmount && m.discardDamagePreventionCardType) {
    const discardType = m.discardDamagePreventionCardType.toLowerCase();
    const discardDraw = m.discardDamagePreventionDraw ?? 0;
    parts.push(phrase(
      `discard ${article(discardType)} ${discardType} card to prevent ${m.discardDamagePreventionAmount} damage` +
        (discardDraw > 0 ? ` and draw ${discardDraw === 1 ? "a card" : `${discardDraw} cards`}` : ""),
      "engine.effect.part.discard.prevent",
      {
        discardType,
        discardArticle: article(discardType),
        discardPrevent: m.discardDamagePreventionAmount,
        discardDraw,
      },
    ));
  }
  if (m.preventLethalDamageByBanishingNamedCard) {
    const lethalCard = m.preventLethalDamageByBanishingNamedCard;
    parts.push(phrase(
      `may banish ${lethalCard} from hand or arsenal to prevent the next lethal damage`,
      "engine.effect.part.prevent.lethal.banish",
      { lethalCard },
    ));
  }
  if (m.onPreventCreateToken) {
    parts.push(phrase(
      `create ${tokens(m.onPreventCreateToken, 1)} when it prevents damage`,
      "engine.effect.part.on.prevent.create.token",
      tokenValues("preventToken", m.onPreventCreateToken),
    ));
  }
  if (m.suppressesHeroAbilities || m.suppressesHeroAbilitiesDuringActionPhase) {
    parts.push(phrase("hero loses all abilities", "engine.effect.summary.loses.all.abilities"));
  }
  // A script's label describes riders its fields can't, so it follows them.
  if (m.ongoingLabel) {
    parts.push({ text: m.ongoingLabel, ...(m.ongoingLabelMessage ? { message: m.ongoingLabelMessage } : {}) });
  }
  return parts;
}

/** Modifiers whose effect lands on matching attacks, cards, or defenders, so
 *  their duration names those objects ("next Brute attack"). */
function affectsObjects(m: Modifier): boolean {
  // Presence checks match the phrases modifierPhrases renders.
  const prevention =
    m.preventNextDamagePool || m.preventDamagePerEvent || m.preventNextDamageAmount ||
    m.preventNextDamageFromPitch !== undefined || m.preventAllDamageFromSource ||
    m.discardDamagePreventionAmount || m.preventLethalDamageByBanishingNamedCard;
  if (prevention) return false;
  return Boolean(
    m.attack || m.defense || m.piercing || m.goAgain || m.dominate || m.overpower || m.intimidate ||
    m.grantKeyword || m.suppressKeyword || m.grantType || m.grantName || m.basePower !== undefined || m.attackFromBasePower ||
    m.onHitGoAgain || m.onHitDraw || m.onHitCreateToken || m.onHitLoseLife || m.onHitDealDamage ||
    m.onHitMark || m.onHitScriptHook || m.onHitDestroyTopDeckCards || m.onDefendedDealDamage ||
    m.onDamageDealtCreateTokenPerPoint ||
    m.suppressHitEffects || m.suppressHitEffectsThisTurn || m.damage || m.damageUnpreventable || m.goAgainIfPlayedOrCreatedSubtype ||
    m.goAgainIfAttackPowerAtLeast !== undefined || m.goAgainIfDefendedByAttackAction ||
    m.maxNonBlockDefenders !== undefined || m.replaceCombatDamageWithDefendingEquipment ||
    m.attackCostReduction || m.playCostReduction || m.activationCostReduction ||
    m.attackActivationCostReduction,
  );
}

type SubjectNoun =
  | "attack" | "attackAction" | "weaponAttack" | "attackWith" | "instance" | "named"
  | "card" | "actionCard" | "nonAttackActionCard" | "instantCard" | "reactionCard"
  | "attackReactionCard" | "defenseReactionCard" | "equipment" | "weapon";

const SUBJECT_NOUNS: Record<Exclude<SubjectNoun, "attackWith" | "instance" | "named">, [string, string]> = {
  attack: ["attack", "attacks"],
  attackAction: ["attack action card", "attack action cards"],
  weaponAttack: ["weapon attack", "weapon attacks"],
  card: ["card", "cards"],
  actionCard: ["action card", "action cards"],
  nonAttackActionCard: ["non-attack action card", "non-attack action cards"],
  instantCard: ["instant card", "instant cards"],
  reactionCard: ["reaction card", "reaction cards"],
  attackReactionCard: ["attack reaction card", "attack reaction cards"],
  defenseReactionCard: ["defense reaction card", "defense reaction cards"],
  equipment: ["equipment", "equipment"],
  weapon: ["weapon", "weapons"],
};

/** The attacks or cards a modifier matches, as a singular and plural English
 *  noun phrase plus the values of `engine.effect.subject.one|other`. */
interface Subject {
  one: string;
  other: string;
  values: MessageValues;
  /** Anything narrower than "attack" or "card". */
  qualified: boolean;
}

function describeSubject(
  state: GameStateInternal,
  m: Modifier,
  base: "attack" | "card",
  options: { defending?: boolean; next?: boolean; weapon?: boolean } = {},
): Subject {
  const values: MessageValues = {};
  const subtypes = subtypesOf(m);
  const attackSubtype = subtypes.some((tag) => tag.toLowerCase() === "attack");
  const otherSubtypes = subtypes.filter((tag) => tag.toLowerCase() !== "attack");

  let noun: SubjectNoun;
  let name: string | undefined;
  const instance = m.appliesToInstanceId === undefined
    ? undefined
    : findCardAnywhere(state, m.appliesToInstanceId)?.card;
  if (instance) {
    noun = base === "attack" && options.next ? "attackWith" : "instance";
    name = dataOf(state, instance.cardId).name;
    values.name = cardValue(instance.cardId);
  } else if (m.appliesToName) {
    noun = "named";
    name = titleCase(m.appliesToName);
    values.name = name;
  } else if (m.appliesToEquipment) {
    noun = "equipment";
  } else if (m.appliesToCardType === "action") {
    noun = attackSubtype ? "attackAction" : m.excludesSubtype === "attack" ? "nonAttackActionCard" : "actionCard";
  } else if (m.appliesToCardType === "instant") {
    noun = "instantCard";
  } else if (m.appliesToCardType === "reaction") {
    noun = "reactionCard";
  } else if (m.appliesToCardType === "attack-reaction") {
    noun = "attackReactionCard";
  } else if (m.appliesToCardType === "defense-reaction") {
    noun = "defenseReactionCard";
  } else if (m.appliesTo === "attack-action" || (attackSubtype && base === "card")) {
    noun = "attackAction";
  } else if (m.appliesTo === "weapon") {
    noun = "weaponAttack";
  } else if (options.weapon) {
    noun = "weapon";
  } else {
    noun = base;
  }
  values.noun = noun;

  const andTags = [
    m.appliesToClass,
    m.appliesTo === "sword" ? "sword" : undefined,
    otherSubtypes.length === 1 ? otherSubtypes[0] : undefined,
  ].filter((tag): tag is string => tag !== undefined).map(typeWord);
  const orTags = [...(otherSubtypes.length > 1 ? otherSubtypes : []), ...(m.appliesToType ?? [])].map(typeWord);
  let types = orTags.length > 0
    ? orTags.map((tag) => [...andTags, tag].join(" "))
    : andTags.length > 0 ? [andTags.join(" ")] : [];
  if (types.length > 3) types = [types.slice(0, -2).join(", "), ...types.slice(-2)];
  values.typeCount = types.length;
  types.forEach((type, index) => { values[`type${index + 1}`] = type; });
  const typeText = types.length === 3
    ? `${types[0]}, ${types[1]}, or ${types[2]}`
    : types.join(" or ");

  const color = m.appliesToPitch === undefined ? undefined : PITCH_NAMES[m.appliesToPitch];
  values.color = color ?? "any";
  const via = options.defending
    ? "defending"
    : m.appliesToRuneGated ? "runeGate"
    : m.appliesToCharged ? "charge"
    : m.appliesToFromArsenal ? "arsenal"
    : "none";
  values.via = via;
  const keyword = m.appliesToKeyword
    ? m.appliesToKeyword.toLowerCase()
    : m.appliesToCounter === "power" ? "powerCounter" : "none";
  values.keyword = keyword;
  const limit = m.maxCost !== undefined ? ["costMax", m.maxCost] as const
    : m.minCost !== undefined ? ["costMin", m.minCost] as const
    : m.maxBasePower !== undefined ? ["powerMax", m.maxBasePower] as const
    : m.minBasePower !== undefined ? ["powerMin", m.minBasePower] as const
    : undefined;
  values.limit = limit?.[0] ?? "none";
  if (limit) values.limitValue = limit[1];
  const target = m.appliesToTargetType ? "type"
    : m.appliesToTargetNamePrefix ? "name"
    : m.appliesToMarkedHero ? "marked"
    : "none";
  values.target = target;
  const targetName = m.appliesToTargetType
    ? typeWord(m.appliesToTargetType)
    : m.appliesToTargetNamePrefix ? titleCase(m.appliesToTargetNamePrefix) : "";
  const targetArticle = article(targetName);
  if (targetName) values.targetName = targetName;
  if (target === "type") values.targetArticle = targetArticle;

  const prefix = [
    via === "defending" ? "defending" : via === "runeGate" ? "rune-gated" : via === "charge" ? "charged" : undefined,
    color,
    typeText || undefined,
  ].filter((word): word is string => word !== undefined).join(" ");
  const suffix = [
    keyword === "none" ? "" : keyword === "powerCounter" ? " with a +1 power counter" : ` with ${keyword}`,
    limit === undefined ? ""
      : limit[0] === "costMax" ? ` with cost ${limit[1]} or less`
      : limit[0] === "costMin" ? ` with cost ${limit[1]} or more`
      : limit[0] === "powerMax" ? ` with ${limit[1]} or less base power`
      : ` with ${limit[1]} or more base power`,
    via === "arsenal" ? " from arsenal" : "",
    target === "type" ? ` targeting ${targetArticle} ${targetName} hero`
      : target === "name" ? ` targeting ${targetName}`
      : target === "marked" ? " targeting a marked hero"
      : "",
  ].join("");
  const [nounOne, nounOther] = noun === "attackWith"
    ? [`attack with ${name}`, `attacks with ${name}`]
    : noun === "instance" || noun === "named" ? [name!, name!]
    : SUBJECT_NOUNS[noun];
  const phraseFor = (nounText: string): string => `${prefix ? `${prefix} ` : ""}${nounText}${suffix}`;
  return {
    one: phraseFor(nounOne),
    other: phraseFor(nounOther),
    values,
    qualified: noun !== base || prefix !== "" || suffix !== "",
  };
}

interface EffectDuration {
  lifetime: EffectLifetime;
  text: string;
  message: GameMessage;
  /** The effect waits for the next matching attack. */
  nextAttack?: true;
}

const awaitingNextAttack = (effectDuration: EffectDuration): EffectDuration =>
  ({ ...effectDuration, nextAttack: true });

const duration = (
  lifetime: EffectLifetime,
  text: string,
  id: string,
  values?: MessageValues,
): EffectDuration => ({ lifetime, text, message: message(id, values) });

/** A duration that names its subject through a composed term message. */
const subjectDuration = (
  lifetime: EffectLifetime,
  text: string,
  id: string,
  subject: Subject,
  form: "one" | "other",
  values: MessageValues = {},
): EffectDuration =>
  duration(lifetime, text, id, {
    ...subject.values,
    ...values,
    subject: { kind: "term", id: `engine.effect.subject.${form}` },
  });

/** "Next" modifiers: the next matching attack or played card. */
function nextDuration(state: GameStateInternal, m: Modifier, base: "attack" | "card"): EffectDuration {
  const effectDuration = nextSubjectDuration(state, m, base);
  return base === "attack" ? awaitingNextAttack(effectDuration) : effectDuration;
}

function nextSubjectDuration(state: GameStateInternal, m: Modifier, base: "attack" | "card"): EffectDuration {
  const subject = describeSubject(state, m, base, { next: true });
  if (m.expiresOnChainClose) {
    return subjectDuration(
      "once",
      `next ${subject.one} this combat chain`,
      "engine.effect.duration.next.subject.this.chain",
      subject,
      "one",
    );
  }
  if (!subject.qualified) {
    return base === "attack"
      ? duration("once", "next attack", "engine.effect.duration.next.attack")
      : duration("once", "next card", "engine.effect.duration.next.card");
  }
  return subjectDuration("once", `next ${subject.one}`, "engine.effect.duration.next.subject", subject, "one");
}

/** Until-end-of-turn (or chain-close) modifiers that act on matching objects
 *  name them: "Brute attacks this turn", "next defending action card this
 *  turn", "next 3 Draconic cards this turn". */
function lingeringSubjectDuration(state: GameStateInternal, m: Modifier): EffectDuration | undefined {
  if (!affectsObjects(m)) return undefined;
  const defending = Boolean(m.defense) && !m.attack;
  const cardDiscount = Boolean(m.playCostReduction || m.activationCostReduction) && !m.attack && !m.goAgain;
  const next = m.once === true || m.suppressHitEffects === true || m.remainingCostUses === 1;
  const base = defending || cardDiscount ? "card" : "attack";
  const subject = describeSubject(state, m, base, { defending, next });
  if (!subject.qualified) return undefined;
  const chain = m.expiresOnChainClose === true;
  const span = chain ? "this combat chain" : "this turn";
  if (m.remainingCostUses !== undefined && m.remainingCostUses > 1 && !chain) {
    return subjectDuration(
      "turn",
      `next ${m.remainingCostUses} ${subject.other} this turn`,
      "engine.effect.duration.next.uses.subject.this.turn",
      subject,
      "other",
      { uses: m.remainingCostUses },
    );
  }
  if (next) {
    const effectDuration = subjectDuration(
      "once",
      `next ${subject.one} ${span}`,
      chain ? "engine.effect.duration.next.subject.this.chain" : "engine.effect.duration.next.subject.this.turn",
      subject,
      "one",
    );
    return base === "attack" ? awaitingNextAttack(effectDuration) : effectDuration;
  }
  return subjectDuration(
    chain ? "chain" : "turn",
    `${subject.other} ${span}`,
    chain ? "engine.effect.duration.subject.this.chain" : "engine.effect.duration.subject.this.turn",
    subject,
    "other",
  );
}

// Stored replays still carry the earlier engine.effect.duration.next.card.* and
// cards.* durations, so the catalogs keep those keys.
const CHAIN_SPANS = {
  "combat-chain": {
    text: "this combat chain",
    whole: "engine.effect.duration.this.combat.chain",
    next: "engine.effect.duration.next.subject.this.chain",
    every: "engine.effect.duration.subject.this.chain",
  },
  "chain-link": {
    text: "this chain link",
    whole: "engine.effect.duration.this.chain.link",
    next: "engine.effect.duration.next.subject.this.link",
    every: "engine.effect.duration.subject.this.link",
  },
} as const;

type ChainSpan = (typeof CHAIN_SPANS)[keyof typeof CHAIN_SPANS];

/** A combat-chain or chain-link discount names the cards it applies to. A
 *  single-use one applies to the next matching card played or activated before
 *  its span ends; otherwise every matching card does until then. A weapon
 *  attack activation discount names weapons instead of cards. */
function chainCardDuration(state: GameStateInternal, m: Modifier, span: ChainSpan): EffectDuration {
  const subject = describeSubject(state, m, "card", {
    next: m.once === true,
    weapon: Boolean(m.attackActivationCostReduction),
  });
  if (m.once) return subjectDuration("once", `next ${subject.one} ${span.text}`, span.next, subject, "one");
  if (!subject.qualified) return duration("chain", span.text, span.whole);
  return subjectDuration("chain", `${subject.other} ${span.text}`, span.every, subject, "other");
}

function modifierDuration(state: GameStateInternal, m: Modifier): EffectDuration {
  if (m.suppressesHeroAbilitiesDuringActionPhase) {
    return m.seat === state.activePlayer && ACTION_PHASES.has(state.phase)
      ? duration("turn", "this action phase", "engine.effect.duration.this.action.phase")
      : duration("later", "next action phase", "engine.effect.duration.next.action.phase");
  }
  if (m.scope === "next-attack") return nextDuration(state, m, "attack");
  if (m.scope === "next-play") return nextDuration(state, m, "card");
  if (m.scope === "combat-chain" || m.scope === "chain-link") return chainCardDuration(state, m, CHAIN_SPANS[m.scope]);
  // An end-of-seat-turn effect lasts through the current turn only once that
  // seat's turn has begun since the effect was created.
  const endsThisTurn = m.expiresAtEndOfSeatTurn === state.activePlayer && (m.createdTurn ?? -1) < state.turn;
  if (m.expiresAtEndOfSeatTurn !== undefined && !endsThisTurn) {
    return duration("later", "next turn", "engine.effect.duration.next.turn");
  }
  // "Until the start of your next turn": turns alternate, so an absolute
  // expiry turn names the controller's next turn when its parity matches.
  const turnsLeft = (m.expiresAtStartOfTurn ?? 0) - state.turn;
  const untilOwnTurn = m.expiresAtStartOfSeatTurn === m.seat ||
    (turnsLeft > 0 && turnsLeft % 2 === (m.seat === state.activePlayer ? 0 : 1));
  if (untilOwnTurn) {
    return duration("later", "until the start of your next turn", "engine.effect.duration.until.your.next.turn");
  }
  const subject = lingeringSubjectDuration(state, m);
  if (subject) return subject;
  if (m.expiresOnChainClose) {
    return duration("chain", "this combat chain", "engine.effect.duration.this.combat.chain");
  }
  return duration("turn", "this turn", "engine.effect.duration.this.turn");
}

/** Delayed triggers fire at a turn boundary of their subject. Recurring ones
 * never leave the schedule, so they are rest-of-game effects. */
function delayedTriggerDuration(trigger: GameStateInternal["delayedTriggers"][number]): EffectDuration {
  if (trigger.recurring) {
    return trigger.event === "end-of-turn"
      ? duration("game", "each of their end phases", "engine.effect.duration.each.end.phase")
      : duration("game", "the start of each of their turns", "engine.effect.duration.each.turn.start");
  }
  return trigger.event === "end-of-turn"
    ? duration("turn", "end of this turn", "engine.effect.duration.end.of.turn")
    : duration("later", "start of their next turn", "engine.effect.duration.start.of.next.turn");
}

interface ProjectedEffect {
  seat: number;
  cardId: string;
  sourceHidden?: true;
  sourceSeat?: number;
  phrases: Phrase[];
  duration: EffectDuration;
  recurring?: true;
  inactive?: true;
  facts?: OngoingEffectFacts;
}

function modifierFacts(m: Modifier, effectDuration: EffectDuration): OngoingEffectFacts {
  const { play, activate } = costReductions(m);
  // Only "prevent next N damage" has an amount. A size cap ("the next damage
  // of N or less") prevents a whole event of unknown size, so it adds none.
  const preventDamage = (m.preventNextDamagePool ?? 0) +
    (m.maxDamageEventAmount === undefined ? m.preventNextDamageAmount ?? 0 : 0);
  return {
    ...(m.attack ? { power: m.attack } : {}),
    ...(play ? { playCostReduction: play } : {}),
    ...(activate ? { activationCostReduction: activate } : {}),
    ...(m.goAgain ? { goAgain: true as const } : {}),
    ...(m.dominate ? { dominate: true as const } : {}),
    ...(m.onHitDraw ? { onHitDraw: m.onHitDraw } : {}),
    ...(preventDamage ? { preventDamage } : {}),
    ...(effectDuration.nextAttack ? { nextAttack: true as const } : {}),
  };
}

/** Facts of two modifiers merged into one effect. */
function mergeFacts(a: OngoingEffectFacts, b: OngoingEffectFacts): OngoingEffectFacts {
  const sum = (
    key: "power" | "playCostReduction" | "activationCostReduction" | "onHitDraw" | "preventDamage",
  ) => {
    const total = (a[key] ?? 0) + (b[key] ?? 0);
    return total ? { [key]: total } : {};
  };
  return {
    ...sum("power"),
    ...sum("playCostReduction"),
    ...sum("activationCostReduction"),
    ...sum("onHitDraw"),
    ...sum("preventDamage"),
    ...(a.goAgain || b.goAgain ? { goAgain: true as const } : {}),
    ...(a.dominate || b.dominate ? { dominate: true as const } : {}),
    ...(a.nextAttack || b.nextAttack ? { nextAttack: true as const } : {}),
  };
}

const MAX_LIST_PHRASES = 4;
// Mirrors the wire limit on GameMessage values.
const MAX_MESSAGE_VALUES = 16;

/** Join phrases into one summary. Each phrase's message becomes a term in a
 *  list message, sharing one value namespace; when a phrase has no message, the
 *  list is too long, or two phrases bind one value name differently, only the
 *  English fallback remains. */
function summarize(phrases: readonly Phrase[]): { summary: string; summaryMessage?: GameMessage } {
  const summary = phraseText(phrases);
  if (phrases.length === 1) {
    return phrases[0]!.message ? { summary, summaryMessage: phrases[0]!.message } : { summary };
  }
  if (phrases.length > MAX_LIST_PHRASES || phrases.some((part) => !part.message)) return { summary };
  const values: MessageValues = {};
  for (const [index, part] of phrases.entries()) {
    for (const [key, value] of Object.entries(part.message!.values ?? {})) {
      if (key in values && JSON.stringify(values[key]) !== JSON.stringify(value)) return { summary };
      values[key] = value;
    }
    values[`part${index}`] = { kind: "term", id: part.message!.id };
  }
  if (Object.keys(values).length > MAX_MESSAGE_VALUES) return { summary };
  const id = phrases.length === 2 ? "engine.effect.summary.list.two"
    : phrases.length === 3 ? "engine.effect.summary.list.three"
    : "engine.effect.summary.list.four";
  return { summary, summaryMessage: message(id, values) };
}

function effectView(effect: ProjectedEffect): OngoingEffectView {
  const { summary, summaryMessage } = summarize(effect.phrases);
  return {
    seat: effect.seat,
    cardId: effect.cardId,
    ...(effect.sourceHidden ? { sourceHidden: true as const } : {}),
    label: `${summary} · ${effect.duration.text}`,
    ...(effect.sourceSeat !== undefined ? { sourceSeat: effect.sourceSeat } : {}),
    summary,
    ...(summaryMessage ? { summaryMessage } : {}),
    lifetime: effect.duration.lifetime,
    duration: effect.duration.text,
    durationMessage: effect.duration.message,
    ...(effect.recurring ? { recurring: true as const } : {}),
    ...(effect.inactive ? { inactive: true as const } : {}),
    ...(effect.facts ? { facts: effect.facts } : {}),
  };
}

/** Lingering (invisible) effects worth surfacing on the mat, grouped by source
 *  card. The source's identity follows the usual face-down secrecy rules. */
export function projectOngoingEffects(
  state: GameStateInternal,
  runtime: EngineRuntime,
  viewer: number | null | undefined,
): OngoingEffectView[] {
  const byKey = new Map<string, ProjectedEffect>();
  const add = (key: string, effect: ProjectedEffect): void => {
    const entry = byKey.get(key);
    if (!entry) {
      byKey.set(key, effect);
    } else if (phraseText(entry.phrases) === phraseText(effect.phrases)) {
      // Repeated identical effects stay separate so the client stacks them
      // ("+1 power ×3") instead of reading "+1 power, +1 power, +1 power".
      let copy = 2;
      while (byKey.has(`${key}#${copy}`)) copy += 1;
      byKey.set(`${key}#${copy}`, effect);
    } else {
      entry.phrases.push(...effect.phrases);
      if (entry.facts && effect.facts) entry.facts = mergeFacts(entry.facts, effect.facts);
    }
  };
  const sourceIdentity = (card: CardInstance): Pick<ProjectedEffect, "cardId" | "sourceHidden"> =>
    viewer !== undefined && card.faceDown && card.owner !== viewer
      ? { cardId: "", sourceHidden: true }
      : { cardId: card.cardId };

  const phrasesOf = new Map(state.modifiers.map((m) => [m, modifierPhrases(state, m)] as const));
  // A bare marker only keeps its source's script observable. When the source
  // owns a described modifier, even a consumed one, that modifier carries the
  // effect's label.
  const describedSources = new Set(
    state.modifiers
      .filter((m) => phrasesOf.get(m)!.length > 0)
      .map((m) => `${m.sourceInstanceId}:${m.seat}`),
  );
  for (const m of state.modifiers) {
    if (m.consumed) continue;
    const surfacedChainCost = (m.scope === "combat-chain" || m.scope === "chain-link") &&
      Boolean(m.playCostReduction || m.activationCostReduction || m.attackActivationCostReduction);
    if (!surfacedChainCost &&
      m.scope !== "next-attack" && m.scope !== "next-play" && m.scope !== "until-end-of-turn") continue;
    const phrases = phrasesOf.get(m)!;
    if (phrases.length === 0 && describedSources.has(`${m.sourceInstanceId}:${m.seat}`)) continue;
    const src = findCardAnywhere(state, m.sourceInstanceId);
    const effectDuration = modifierDuration(state, m);
    // One source's modifiers merge only when they share a duration, so each
    // qualifier ("next red attack", "next blue attack") keeps its own effect.
    add(`${m.sourceInstanceId}:${m.seat}:${m.scope}:${effectDuration.text}`, {
      seat: m.seat,
      ...(src ? { ...sourceIdentity(src.card), sourceSeat: src.seat } : { cardId: m.sourceCardId ?? "" }),
      phrases: phrases.length > 0 ? phrases : [phrase("ongoing effect", "engine.effect.summary.ongoing")],
      duration: effectDuration,
      facts: modifierFacts(m, effectDuration),
    });
  }

  state.delayedTriggers.forEach((trigger, index) => {
    add(`delayed:${index}`, {
      // subjectSeat is whose turn boundary fires the trigger. A one-shot
      // end-of-turn trigger may wait for the turn player's end phase while
      // acting for its controller, so it belongs to the controller;
      // recurring triggers affect their subject.
      seat: trigger.recurring || trigger.event !== "end-of-turn" ? trigger.subjectSeat : trigger.seat,
      ...sourceIdentity(trigger.source),
      sourceSeat: trigger.seat,
      phrases: [{ text: trigger.label, ...(trigger.labelMessage ? { message: trigger.labelMessage } : {}) }],
      duration: delayedTriggerDuration(trigger),
      ...(trigger.recurring ? { recurring: true as const } : {}),
    });
  });

  // Some effects are rules state on the affected hero (counters and flags)
  // rather than modifiers: delayed Crush restrictions, permanent ability loss,
  // prevention and amp pools. Surface them on that hero without a source card,
  // attributed to the seat that caused them, so an opponent's restriction is
  // not shown as the hero's own buff. The hero's script state remains the rules
  // authority and controls the lifetime; this projection adds no new mutable state.
  for (const player of state.players as PlayerState[]) {
    const heroState = player.hero.scriptState;
    const heroKey = `hero:${player.hero.instanceId}`;
    const opponentSeat = opponent(player.seat);
    const addHeroEffect = (
      key: string,
      summary: string,
      summaryMessage: GameMessage,
      effectDuration: EffectDuration,
      sourceSeat: number,
    ): void =>
      add(`${heroKey}:${key}`, {
        seat: player.seat,
        cardId: "",
        sourceSeat,
        phrases: [{ text: summary, message: summaryMessage }],
        duration: effectDuration,
      });
    const addArcaneBonusPool = (
      flagKey: string,
      sourcePrefix: string,
      effectKey: string,
      effectDuration: EffectDuration,
    ): void => {
      let untrackedArcaneBonus = Number(player.flags[flagKey] ?? 0);
      if (untrackedArcaneBonus <= 0) return;
      for (const [key, value] of Object.entries(player.flags)) {
        if (untrackedArcaneBonus <= 0) break;
        if (!key.startsWith(sourcePrefix) || typeof value !== "number" || value <= 0) continue;
        const amount = Math.min(value, untrackedArcaneBonus);
        const sourceInstanceId = Number(key.slice(sourcePrefix.length));
        const source = Number.isSafeInteger(sourceInstanceId)
          ? findCardAnywhere(state, sourceInstanceId)
          : undefined;
        add(`${effectKey}:${sourceInstanceId}:${player.seat}`, {
          seat: player.seat,
          ...(source ? sourceIdentity(source.card) : { cardId: "" }),
          sourceSeat: player.seat,
          phrases: [phrase(`amp ${amount}`, "engine.effect.summary.amp", { amount })],
          duration: effectDuration,
        });
        untrackedArcaneBonus -= amount;
      }
      if (untrackedArcaneBonus > 0) {
        addHeroEffect(
          effectKey,
          `amp ${untrackedArcaneBonus}`,
          message("engine.effect.summary.amp", { amount: untrackedArcaneBonus }),
          effectDuration,
          player.seat,
        );
      }
    };
    addArcaneBonusPool(
      "nextArcaneBonus",
      "nextArcaneBonusSource:",
      "next-arcane-bonus",
      duration("once", "next arcane damage event", "engine.effect.duration.next.arcane.damage"),
    );
    addArcaneBonusPool(
      "nextArcaneCardBonus",
      "nextArcaneCardBonusSource:",
      "next-arcane-card-bonus",
      duration("once", "next arcane damage card", "engine.effect.duration.next.arcane.card"),
    );
    if (heroState?.abilitiesDisabledPermanently === 1) {
      addHeroEffect(
        "abilities-lost",
        "hero loses all abilities",
        message("engine.effect.summary.loses.all.abilities"),
        duration("game", "rest of the game", "engine.effect.duration.rest.of.game"),
        opponentSeat,
      );
    }
    if ((heroState?.halveBaseAttackActionUntil ?? 0) >= state.turn) {
      addHeroEffect(
        "halve-base",
        "base power and defense of attack action cards are halved",
        message("engine.effect.summary.halve.base"),
        duration("later", "through next turn", "engine.effect.duration.through.next.turn"),
        opponentSeat,
      );
    }
    if ((heroState?.attackActionBasePowerLimitUntilTurn ?? 0) >= state.turn) {
      const limit = heroState?.attackActionBasePowerLimit ?? 0;
      addHeroEffect(
        "base-power-limit",
        `can't play attack action cards with base power ${limit} or less`,
        message("engine.effect.summary.base.power.limit", { limit }),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    if ((heroState?.attackActionNoPowerGainUntilTurn ?? 0) >= state.turn) {
      addHeroEffect(
        "no-power-gain",
        "attack action cards can't gain power",
        message("engine.effect.summary.no.power.gain"),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    if ((heroState?.cannotDrawActionTurn ?? 0) >= state.turn) {
      addHeroEffect(
        "cannot-draw",
        "can't draw cards",
        message("engine.effect.summary.cannot.draw"),
        duration("later", "next action phase", "engine.effect.duration.next.action.phase"),
        opponentSeat,
      );
    }
    // Stored replays still carry engine.effect.summary.next.action.cost and
    // engine.effect.duration.next.action, so the catalogs keep those keys.
    const firstActionCost = firstActionExtraCost(state, player);
    if (firstActionCost > 0) {
      addHeroEffect(
        "next-action-cost",
        `costs ${firstActionCost} more to play or activate`,
        message("engine.effect.part.cost", { cost: firstActionCost, costChange: "more", costAction: "both" }),
        duration("once", "first action this turn", "engine.effect.duration.first.action.this.turn"),
        opponentSeat,
      );
    }
    const trackedGenericPrevention = state.modifiers.reduce(
      (total, modifier) => total + (
        !modifier.consumed &&
        modifier.seat === player.seat &&
        modifier.scope === "until-end-of-turn" &&
        modifier.appliesToInstanceId === undefined
          ? Number(modifier.preventNextDamagePool ?? 0)
          : 0
      ),
      0,
    );
    const untrackedGenericPrevention = Math.max(
      0,
      Number(player.flags.preventNextDamage ?? 0) - trackedGenericPrevention,
    );
    const thisTurn = duration("turn", "this turn", "engine.effect.duration.this.turn");
    if (untrackedGenericPrevention > 0) {
      addHeroEffect(
        "prevent-next-damage",
        `prevent next ${untrackedGenericPrevention} damage`,
        message("engine.effect.summary.prevent.damage", { amount: untrackedGenericPrevention }),
        thisTurn,
        player.seat,
      );
    }
    const arcanePrevention = Number(player.flags.preventNextArcaneDamage ?? 0);
    if (arcanePrevention > 0) {
      addHeroEffect(
        "prevent-next-arcane",
        `prevent next ${arcanePrevention} arcane damage`,
        message("engine.effect.summary.prevent.arcane", { amount: arcanePrevention }),
        thisTurn,
        player.seat,
      );
    }
    const physicalPrevention = Number(player.flags.preventNextPhysicalDamage ?? 0);
    if (physicalPrevention > 0) {
      addHeroEffect(
        "prevent-next-physical",
        `prevent next ${physicalPrevention} physical damage`,
        message("engine.effect.summary.prevent.physical", { amount: physicalPrevention }),
        thisTurn,
        player.seat,
      );
    }

    // A static "first time you would be dealt damage each turn" prevention
    // is easy to misread once that first damage has passed. While its
    // condition holds, show it armed; after an unprevented first damage
    // event, show it inactive for the rest of the turn.
    const damageEvents = Number(player.flags.damageEventsThisTurn ?? 0);
    for (const source of controlledPermanents(state, player.seat, { faceDownEquipment: false })) {
      const fixed = scriptOf(state, source.cardId, source)?.fixedDamagePrevention;
      if (!fixed?.firstDamageEventEachTurn || fixed.amount <= 0) continue;
      if (Number(source.scriptState?.fixedPreventionUsedTurn ?? -1) === state.turn) continue;
      if (fixed.condition && !fixed.condition(
        runtime.makeCtx(state, player.seat, source, currentLink(state)),
      )) continue;
      const spent = damageEvents > 0;
      add(`first-damage-prevention:${source.instanceId}`, {
        seat: player.seat,
        ...sourceIdentity(source),
        sourceSeat: player.seat,
        phrases: [phrase(
          `prevent ${fixed.amount} of the first damage`,
          "engine.effect.summary.prevent.first.damage",
          { amount: fixed.amount },
        )],
        duration: spent
          ? duration("turn", "already dealt damage this turn", "engine.effect.duration.first.damage.passed")
          : thisTurn,
        ...(spent ? { inactive: true as const } : {}),
      });
    }
  }

  // Backward-compatible projection for source-filtered prevention created by
  // older persisted states, before source-aware modifier records were added.
  const seenSources = new Set<number>();
  const sourceCards = [
    ...state.players.flatMap((player) => [
      player.hero,
      ...player.hand,
      ...player.deck,
      ...player.arsenal,
      ...player.pitch,
      ...player.graveyard,
      ...player.banish,
      ...player.soul,
      ...(player.inventory ?? []),
      ...player.board,
      ...player.weapons,
      ...Object.values(player.equipment).filter((card): card is CardInstance => card !== undefined),
    ]),
    ...state.chain.flatMap((link) => [
      link.attackingCard,
      ...link.defendingCards,
      ...link.defendingEquipment,
      ...link.reactions,
    ]),
    ...state.resolving,
    ...state.stack.flatMap((layer) => [layer.card, layer.abilityCard].filter(
      (card): card is CardInstance => card !== undefined,
    )),
  ];
  for (const source of sourceCards) {
    if (seenSources.has(source.instanceId)) continue;
    seenSources.add(source.instanceId);
    const prevention = source.damagePrevented;
    if (!prevention || prevention.amount <= 0) continue;
    const tracked = state.modifiers.some((modifier) =>
      !modifier.consumed &&
      modifier.seat === prevention.targetSeat &&
      modifier.appliesToInstanceId === source.instanceId &&
      Number(modifier.preventNextDamagePool ?? 0) > 0
    );
    if (tracked) continue;
    add(
      `legacy-source-prevention:${source.instanceId}:${prevention.targetSeat}`,
      {
        seat: prevention.targetSeat,
        cardId: "",
        sourceSeat: prevention.targetSeat,
        phrases: [phrase(
          `prevent next ${prevention.amount} damage from ${dataOf(state, source.cardId).name}`,
          "engine.effect.summary.prevent.damage.from",
          { amount: prevention.amount, source: cardValue(source.cardId) },
        )],
        duration: duration("turn", "this turn", "engine.effect.duration.this.turn"),
      },
    );
  }
  return [...byKey.values()].map(effectView);
}
