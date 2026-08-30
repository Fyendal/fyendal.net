import { cardData } from "@fyendal/cards/client";
import { CardFace } from "../Card.js";
import {
  ActionConfirmation,
  boostOptionLabel,
  ChainCloseConfirmation,
} from "./ActionConfirmations.js";
import { ActionTargetCards } from "./CardChoices.js";
import { CardRef, cardAffiliation, chooseWithoutFocus, handCardPlayLabel } from "./DecisionShared.js";
import type { ActionAnnouncementModel } from "./DecisionModels.js";

export function ActionAnnouncementPanel({
  model,
  viewerSeat,
}: {
  model: ActionAnnouncementModel;
  viewerSeat: number;
}) {
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
    pitchResourcesSelected,
    pitchResourcesRequired,
    onCancel,
  } = model;
  if (sel.kind === "none") return null;
  const offersMultipleBoosts = boostOptions.some((count) => count > 1);
  const selectedAlternativeCostIds = Array.isArray(alternativeCostCardInstanceIds)
    ? alternativeCostCardInstanceIds
    : [];

  return (
    <div className={`decision decision-options${
      stagedAdditionalCost && !additionalCostConfirmed ? " decision-additional-cost" : ""
    }`}>
      {sel.kind === "choose-hand-action" ? (
        <>
          <span className="decision-prompt">
            Use {selCardId ? <CardRef id={selCardId} /> : "card"}
          </span>
          <div className="decision-buttons">
            <button onClick={() => onChooseHandPlay(sel.instanceId)}>
              {handCardPlayLabel(selCardId)}
            </button>
            <button onClick={() => onChooseHandAbility(sel.instanceId)}>
              Activate instant ability
            </button>
          </div>
        </>
      ) : null}
      {sel.kind !== "choose-hand-action" && step === "payment" ? (
        <>
          <span className="decision-prompt">
            {sel.kind === "activate" ? "Activate " : "Play "}
            {selCardId ? <CardRef id={selCardId} /> : "card"}
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
                Choose up to 3 {stagedAdditionalCost.cardLabel} from each zone
              </span>
              <div className="decision-additional-cost-groups">
                {stagedAdditionalCost.modes.map((mode) => {
                  const selectedInMode = mode.cards.filter((card) =>
                    selectedAlternativeCostIds.includes(card.instanceId)
                  ).length;
                  return (
                    <section key={mode.mode} className="decision-additional-cost-group">
                      <div className="decision-additional-cost-title">
                        <span>{mode.mode === "destroy" ? "Destroy from arena" : "Discard from hand"}</span>
                        <small>{selectedInMode}/{mode.maximum}</small>
                      </div>
                      <div className="decision-target-cards">
                        {mode.cards.map((card) => {
                          const selected = selectedAlternativeCostIds.includes(card.instanceId);
                          const atMaximum = selectedInMode >= mode.maximum;
                          const label = cardData[card.cardId]?.name ?? "card";
                          return (
                            <button
                              key={card.instanceId}
                              className={`decision-target-card ${selected ? "decision-target-selected" : ""}`}
                              aria-label={`${selected ? "Remove" : "Choose"} ${label}`}
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
                <button
                  onClick={(event) => chooseWithoutFocus(
                    event.currentTarget,
                    () => onSelectAlternativeCost(null),
                  )}
                >
                  Choose none
                </button>
                <button
                  className="btn-primary"
                  disabled={!canConfirmAdditionalCost}
                  onClick={onConfirmAdditionalCost}
                >
                  Confirm {stagedAdditionalCost.cardLabel}
                </button>
                <button onClick={onCancel}>Cancel</button>
              </div>
            </>
          ) : !stagedAdditionalCost && alternativeCostChoices.length > 0 ? (
            <>
              <div className="decision-buttons">
                {normalCostPayableWithoutPitch ? (
                  <button
                    className={alternativeCostCardInstanceIds === null ? "btn-primary" : ""}
                    onClick={(event) =>
                      chooseWithoutFocus(event.currentTarget, () => onSelectAlternativeCost(null))}
                  >
                    Pay resources
                  </button>
                ) : null}
              </div>
              <div className="decision-target-cards">
                {alternativeCostChoices.map((choice) => {
                  const selected =
                    Array.isArray(alternativeCostCardInstanceIds) &&
                    choice.instanceIds.length === alternativeCostCardInstanceIds.length &&
                    choice.instanceIds.every((id) => alternativeCostCardInstanceIds.includes(id));
                  const label = choice.cards
                    .map((card) => card ? (cardData[card.cardId]?.name ?? "card") : "card")
                    .join(", ");
                  return (
                    <button
                      key={choice.key}
                      className={`decision-target-card ${selected ? "decision-target-selected" : ""}`}
                      aria-label={`Use ${label}`}
                      aria-pressed={selected}
                      onClick={(event) =>
                        chooseWithoutFocus(event.currentTarget, () =>
                          onSelectAlternativeCost(choice.instanceIds))}
                    >
                      {choice.cards.map((card, index) => card ? (
                        <CardFace
                          key={choice.instanceIds[index]}
                          card={card}
                          size="hand"
                          affiliation={cardAffiliation(card, viewerSeat)}
                        />
                      ) : null)}
                      <span>Use {label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {(!stagedAdditionalCost || additionalCostConfirmed) && pitchResourcesRequired > 0 ? (
            <strong
              className="decision-resource-progress"
              aria-label={`${pitchResourcesSelected} of ${pitchResourcesRequired} pitch resources selected`}
            >
              {pitchResourcesSelected}/{pitchResourcesRequired}
            </strong>
          ) : null}
          {stagedAdditionalCost && !additionalCostConfirmed ? null : (
            <div className="decision-buttons">
              <button onClick={onCancel}>Cancel</button>
            </div>
          )}
        </>
      ) : null}
      {sel.kind === "activate" && step === "ability" ? (
        <>
          <span className="decision-prompt">
            Choose how to use {selCardId ? <CardRef id={selCardId} /> : "card"}
          </span>
          <div className="decision-buttons">
            {abilityChoices.map((choice) => (
              <button
                key={choice.index}
                onClick={(event) =>
                  chooseWithoutFocus(event.currentTarget, () => onSelectAbility(choice.index))}
              >
                {choice.label}
              </button>
            ))}
            <button onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : null}
      {sel.kind !== "choose-hand-action" && step === "method" && playMethodChoiceRequired ? (
        <>
          <span className="decision-prompt">
            Play {selCardId ? <CardRef id={selCardId} /> : "card"} as…
          </span>
          <div className="decision-buttons">
            <button
              className={playMethod === "action" ? "btn-primary" : ""}
              onClick={(event) =>
                chooseWithoutFocus(event.currentTarget, () => onSelectPlayMethod("action"))}
            >
              Action
            </button>
            <button
              className={playMethod === "instant" ? "btn-primary" : ""}
              onClick={(event) =>
                chooseWithoutFocus(event.currentTarget, () => onSelectPlayMethod("instant"))}
            >
              Instant
            </button>
            <button onClick={onCancel}>Cancel</button>
          </div>
        </>
      ) : null}
      {step === "boost" ? (
        <>
          <span className="decision-prompt">
            Boost {selCardId ? <CardRef id={selCardId} /> : "this attack"}?
          </span>
          <span className="decision-context">Each Boost banishes the top card of your deck.</span>
          <div className="decision-buttons">
            {boostOptions.map((count) => (
              <button
                key={count}
                className={boostCount === count ? "btn-primary" : ""}
                onClick={(event) =>
                  chooseWithoutFocus(event.currentTarget, () => onSelectBoost(count))}
              >
                {boostOptionLabel(count, offersMultipleBoosts)}
              </button>
            ))}
          </div>
          <div className="decision-buttons"><button onClick={onCancel}>Cancel</button></div>
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
          <span className="decision-prompt">Choose a target</span>
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
          <div className="decision-buttons"><button onClick={onCancel}>Cancel</button></div>
        </>
      ) : null}
    </div>
  );
}
