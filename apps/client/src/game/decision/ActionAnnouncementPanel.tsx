import { cardData } from "@fyendal/cards/client";
import { useIntl } from "react-intl";
import { CardFace } from "../Card.js";
import {
  ActionConfirmation,
  boostOptionLabel,
  ChainCloseConfirmation,
  orderedBoostOptions,
} from "./ActionConfirmations.js";
import { ActionTargetCards } from "./CardChoices.js";
import { ChoiceCancel, ChoiceList } from "./ChoiceModal.js";
import { CardRef, cardAffiliation, chooseWithoutFocus, handCardPlayLabel, PitchPaymentProgress } from "./DecisionShared.js";
import type { ActionAnnouncementModel } from "./DecisionModels.js";

const CARD_COST_LABEL_MESSAGES = {
  cards: "game.decision.cardCost.label.cards",
  allies: "game.decision.cardCost.label.allies",
  zombies: "game.decision.cardCost.label.zombies",
} as const;

export function ActionAnnouncementPanel({
  model,
  viewerSeat,
}: {
  model: ActionAnnouncementModel;
  viewerSeat: number;
}) {
  const intl = useIntl();
  const {
    sel,
    selCardId,
    step,
    abilityChoices,
    onSelectAbility,
    onChooseHandPlay,
    onChooseHandAbility,
    meldChoices,
    meldSide,
    onSelectMeldSide,
    playMethod,
    playMethodChoiceRequired,
    onSelectPlayMethod,
    targetChoices,
    targetAllyId,
    onSelectTarget,
    cardTargetChoices,
    targetCardInstanceId,
    onSelectCardTarget,
    boostCount,
    boostOptions,
    onSelectBoost,
    onConfirmChainClose,
    onConfirmAction,
    normalCostPayableWithoutPitch,
    alternativeCostChoices,
    alternativeCostCardInstanceIds,
    onSelectAlternativeCost,
    stagedAdditionalCost,
    additionalCostConfirmed,
    canConfirmAdditionalCost,
    onToggleAdditionalCostCard,
    onConfirmAdditionalCost,
    paymentProgress,
    onCancel,
  } = model;
  if (sel.kind === "none") return null;
  const offersMultipleBoosts = boostOptions.some((count) => count > 1);
  const presentedBoostOptions = orderedBoostOptions(boostOptions);
  const presentedBoostCount = boostCount ?? presentedBoostOptions.find((count) => count > 0);
  const selectedCardCostIds = stagedAdditionalCost?.selectedInstanceIds ?? [];
  const cardCostLabel = stagedAdditionalCost
    ? stagedAdditionalCost.cardLabel in CARD_COST_LABEL_MESSAGES
      ? intl.formatMessage({
          id: CARD_COST_LABEL_MESSAGES[
            stagedAdditionalCost.cardLabel as keyof typeof CARD_COST_LABEL_MESSAGES
          ],
        })
      : stagedAdditionalCost.cardLabel
    : "";
  const showPayment = !stagedAdditionalCost || additionalCostConfirmed;
  const attackLabel = intl.formatMessage({ id: "game.chain.stat.attack" });
  const choiceStep =
    sel.kind === "choose-hand-action" ||
    (sel.kind === "activate" && step === "ability") ||
    (step === "method" && playMethodChoiceRequired) ||
    step === "boost" ||
    step === "close-chain" ||
    step === "confirm";

  return (
    <div className={`decision decision-options${
      stagedAdditionalCost && !additionalCostConfirmed ? " decision-additional-cost" : ""
    }${
      step === "boost" || step === "target" || step === "close-chain" || step === "confirm"
        ? " decision-post-payment" : ""
    }${
      choiceStep ? " decision-choice" : ""
    }${
      step === "target" ? " decision-target-choice" : ""
    }`}>
      {sel.kind === "choose-hand-action" ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage(
              { id: "game.decision.useCard" },
              { card: selCardId ? <CardRef id={selCardId} /> : intl.formatMessage({ id: "game.card" }) },
            )}
          </span>
          <ChoiceList
            options={[
              {
                key: "play",
                label: handCardPlayLabel(intl, selCardId),
                onChoose: () => onChooseHandPlay(sel.instanceId),
              },
              {
                key: "activate",
                label: intl.formatMessage({ id: "game.decision.activateInstant" }),
                onChoose: () => onChooseHandAbility(sel.instanceId),
              },
            ]}
          />
          <ChoiceCancel onCancel={onCancel} />
        </>
      ) : null}
      {sel.kind !== "choose-hand-action" && step === "payment" ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage({ id: sel.kind === "activate" ? "game.action.activate" : "game.action.play" })}{" "}
            {selCardId ? <CardRef id={selCardId} /> : intl.formatMessage({ id: "game.card" })}
          </span>
          {meldChoices.length > 0 ? (
            <div className="decision-buttons">
              {meldChoices.map((choice) => (
                <button
                  key={choice.side}
                  className={choice.side === meldSide ? "btn-primary" : ""}
                  onClick={(event) =>
                    chooseWithoutFocus(event.currentTarget, () => onSelectMeldSide(choice.side))}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : null}
          {stagedAdditionalCost && !additionalCostConfirmed ? (
            <>
              <span className="decision-context">
                {intl.formatMessage(
                  {
                    id: stagedAdditionalCost.minimum === stagedAdditionalCost.maximum
                      ? "game.decision.cardCost.chooseExact"
                      : "game.decision.cardCost.chooseUpTo",
                  },
                  {
                    card: cardCostLabel,
                    count: stagedAdditionalCost.maximum,
                  },
                )}
              </span>
              <div className="decision-additional-cost-groups">
                {stagedAdditionalCost.modes.map((mode) => {
                  const selectedInMode = mode.cards.filter((card) =>
                    selectedCardCostIds.includes(card.instanceId)
                  ).length;
                  return (
                    <section key={mode.mode} className="decision-additional-cost-group">
                      <div className="decision-additional-cost-title">
                        <span>{intl.formatMessage({
                          id: mode.mode === "destroy"
                            ? "game.decision.additionalCost.destroy"
                            : mode.mode === "banish"
                              ? "game.decision.cardCost.banish"
                              : "game.decision.additionalCost.discard",
                        })}</span>
                        <small>{selectedInMode}/{mode.maximum}</small>
                      </div>
                      <div className="decision-target-cards">
                        {mode.cards.map((card) => {
                          const selected = selectedCardCostIds.includes(card.instanceId);
                          const atMaximum = selectedInMode >= mode.maximum ||
                            selectedCardCostIds.length >= stagedAdditionalCost.maximum;
                          const label = cardData[card.cardId]?.name ?? intl.formatMessage({ id: "game.card" });
                          return (
                            <button
                              key={card.instanceId}
                              className={`decision-target-card ${selected ? "decision-target-selected" : ""}`}
                              aria-label={intl.formatMessage(
                                { id: selected ? "game.decision.removeCard" : "game.decision.chooseCard" },
                                { card: label },
                              )}
                              aria-pressed={selected}
                              disabled={!selected && atMaximum}
                              onClick={(event) => chooseWithoutFocus(
                                event.currentTarget,
                                () => onToggleAdditionalCostCard(card.instanceId),
                              )}
                            >
                              <CardFace
                                card={card}
                                size="hand"
                                affiliation={cardAffiliation(card, viewerSeat)}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
              <div className="decision-buttons decision-additional-cost-actions">
                {stagedAdditionalCost.minimum === 0 ? (
                  <button
                    onClick={(event) => chooseWithoutFocus(
                      event.currentTarget,
                      () => onSelectAlternativeCost(null),
                    )}
                  >
                    {intl.formatMessage({ id: "game.decision.chooseNone" })}
                  </button>
                ) : null}
                <button
                  className="btn-primary"
                  disabled={!canConfirmAdditionalCost}
                  onClick={onConfirmAdditionalCost}
                >
                  {intl.formatMessage(
                    { id: "game.decision.confirmNamed" },
                    { name: cardCostLabel },
                  )}
                </button>
                <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
              </div>
            </>
          ) : !stagedAdditionalCost && alternativeCostChoices.length > 0 ? (
            <section
              className="decision-alternative-cost"
              aria-label={intl.formatMessage({ id: "game.decision.alternativeCost" })}
            >
              <span className="decision-context">
                {intl.formatMessage({ id: "game.decision.alternativeCost" })}
              </span>
              <div className="decision-alternative-cost-cards">
                {alternativeCostChoices.map((choice) => {
                  const selected =
                    Array.isArray(alternativeCostCardInstanceIds) &&
                    choice.instanceIds.length === alternativeCostCardInstanceIds.length &&
                    choice.instanceIds.every((id) => alternativeCostCardInstanceIds.includes(id));
                  const label = choice.cards
                    .map((card) => card
                      ? (cardData[card.cardId]?.name ?? intl.formatMessage({ id: "game.card" }))
                      : intl.formatMessage({ id: "game.card" }))
                    .join(", ");
                  return (
                    <button
                      key={choice.key}
                      className={`decision-target-card decision-alternative-cost-card ${selected ? "decision-target-selected" : ""}`}
                      aria-label={intl.formatMessage({ id: "game.decision.useNamed" }, { name: label })}
                      aria-pressed={selected}
                      onClick={(event) =>
                        chooseWithoutFocus(event.currentTarget, () =>
                          onSelectAlternativeCost(choice.instanceIds))}
                    >
                      <div className="decision-alternative-cost-faces">
                        {choice.cards.map((card, index) => card ? (
                          <CardFace
                            key={choice.instanceIds[index]}
                            card={card}
                            size="hand"
                            affiliation={cardAffiliation(card, viewerSeat)}
                          />
                        ) : null)}
                      </div>
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
              {normalCostPayableWithoutPitch ? (
                <div className="decision-buttons">
                  <button
                    className={alternativeCostCardInstanceIds === null ? "btn-primary" : ""}
                    onClick={(event) =>
                      chooseWithoutFocus(event.currentTarget, () => onSelectAlternativeCost(null))}
                  >
                    {intl.formatMessage({ id: "game.decision.payResources" })}
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
          {showPayment && paymentProgress.kind === "discard" && paymentProgress.required > 0 ? (
            <span className="decision-context">
              {intl.formatMessage({ id: "card.common.card.discard.choose" })}
            </span>
          ) : null}
          {showPayment && paymentProgress.kind === "resource" && paymentProgress.required > 0 ? (
            <PitchPaymentProgress selected={paymentProgress.selected} required={paymentProgress.required} />
          ) : null}
          {stagedAdditionalCost && !additionalCostConfirmed ? null : (
            <div className="decision-buttons">
              <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
            </div>
          )}
        </>
      ) : null}
      {sel.kind === "activate" && step === "ability" ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage(
              { id: "game.decision.chooseUse" },
              { card: selCardId ? <CardRef id={selCardId} /> : intl.formatMessage({ id: "game.card" }) },
            )}
          </span>
          <ChoiceList
            options={abilityChoices.map((choice) => ({
              key: String(choice.index),
              text: choice.label.replaceAll("{p}", ` ${attackLabel}`).trim(),
              label: choice.label.split(/(\{p\})/g).map((part, index) =>
                part === "{p}" ? (
                  <img
                    key={index}
                    className="ico"
                    src="/icons/attack.png"
                    alt=""
                    aria-hidden="true"
                  />
                ) : part
              ),
              onChoose: () => onSelectAbility(choice.index),
            }))}
          />
          <ChoiceCancel onCancel={onCancel} />
        </>
      ) : null}
      {sel.kind !== "choose-hand-action" && step === "method" && playMethodChoiceRequired ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage(
              { id: "game.decision.playAs.prompt" },
              { card: selCardId ? <CardRef id={selCardId} /> : intl.formatMessage({ id: "game.card" }) },
            )}
          </span>
          <ChoiceList
            options={[
              {
                key: "instant",
                label: intl.formatMessage({ id: "game.decision.playMethod.instant" }),
                selected: playMethod === "instant",
                onChoose: () => onSelectPlayMethod("instant"),
              },
              {
                key: "action",
                label: intl.formatMessage({ id: "game.decision.playMethod.action" }),
                selected: playMethod === "action",
                onChoose: () => onSelectPlayMethod("action"),
              },
            ]}
          />
          <ChoiceCancel onCancel={onCancel} />
        </>
      ) : null}
      {step === "boost" ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage(
              { id: "game.decision.boost.prompt" },
              {
                card: selCardId
                  ? <CardRef id={selCardId} />
                  : intl.formatMessage({ id: "game.attack.this" }),
              },
            )}
          </span>
          <span className="decision-context">
            {intl.formatMessage({ id: "game.decision.boost.context" })}
          </span>
          <ChoiceList
            options={presentedBoostOptions.map((count) => ({
              key: String(count),
              label: boostOptionLabel(intl, count, offersMultipleBoosts),
              selected: presentedBoostCount === count,
              spaceDefault: boostCount === null && presentedBoostCount === count,
              onChoose: () => onSelectBoost(count),
            }))}
          />
          <ChoiceCancel onCancel={onCancel} />
        </>
      ) : null}
      {step === "close-chain" ? (
        <ChainCloseConfirmation
          cardId={selCardId}
          onConfirm={onConfirmChainClose}
          onCancel={onCancel}
        />
      ) : null}
      {step === "confirm" ? (
        <ActionConfirmation
          cardId={selCardId}
          activation={sel.kind === "activate"}
          onConfirm={onConfirmAction}
          onCancel={onCancel}
        />
      ) : null}
      {step === "target" ? (
        <>
          <span className="decision-prompt">{intl.formatMessage({ id: "game.decision.chooseTarget" })}</span>
          {targetChoices.length > 0 ? (
            <ActionTargetCards
              choices={targetChoices}
              viewerSeat={viewerSeat}
              selectedId={targetAllyId ?? null}
              selectionMade={targetAllyId !== undefined}
              onSelect={onSelectTarget}
            />
          ) : null}
          {cardTargetChoices.length > 0 ? (
            <ActionTargetCards
              choices={cardTargetChoices}
              viewerSeat={viewerSeat}
              selectedId={targetCardInstanceId}
              selectionMade={targetCardInstanceId !== null}
              onSelect={(id) => {
                if (id !== null) onSelectCardTarget(id);
              }}
            />
          ) : null}
          <div className="decision-buttons">
            <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
          </div>
        </>
      ) : null}
    </div>
  );
}
