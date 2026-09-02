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
import { CardRef, cardAffiliation, chooseWithoutFocus, handCardPlayLabel } from "./DecisionShared.js";
import type { ActionAnnouncementModel } from "./DecisionModels.js";

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
    pitchResourcesSelected,
    pitchResourcesRequired,
    onCancel,
  } = model;
  if (sel.kind === "none") return null;
  const offersMultipleBoosts = boostOptions.some((count) => count > 1);
  const presentedBoostOptions = orderedBoostOptions(boostOptions);
  const presentedBoostCount = boostCount ?? presentedBoostOptions.find((count) => count > 0);
  const selectedAlternativeCostIds = Array.isArray(alternativeCostCardInstanceIds)
    ? alternativeCostCardInstanceIds
    : [];
  const attackLabel = intl.formatMessage({ id: "game.chain.stat.attack" });

  return (
    <div className={`decision decision-options${
      stagedAdditionalCost && !additionalCostConfirmed ? " decision-additional-cost" : ""
    }`}>
      {sel.kind === "choose-hand-action" ? (
        <>
          <span className="decision-prompt">
            {intl.formatMessage(
              { id: "game.decision.useCard" },
              { card: selCardId ? <CardRef id={selCardId} /> : intl.formatMessage({ id: "game.card" }) },
            )}
          </span>
          <div className="decision-buttons">
            <button onClick={() => onChooseHandPlay(sel.instanceId)}>
              {handCardPlayLabel(intl, selCardId)}
            </button>
            <button onClick={() => onChooseHandAbility(sel.instanceId)}>
              {intl.formatMessage({ id: "game.decision.activateInstant" })}
            </button>
          </div>
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
                  { id: "game.decision.additionalCost.choose" },
                  { card: stagedAdditionalCost.cardLabel },
                )}
              </span>
              <div className="decision-additional-cost-groups">
                {stagedAdditionalCost.modes.map((mode) => {
                  const selectedInMode = mode.cards.filter((card) =>
                    selectedAlternativeCostIds.includes(card.instanceId)
                  ).length;
                  return (
                    <section key={mode.mode} className="decision-additional-cost-group">
                      <div className="decision-additional-cost-title">
                        <span>{intl.formatMessage({
                          id: mode.mode === "destroy"
                            ? "game.decision.additionalCost.destroy"
                            : "game.decision.additionalCost.discard",
                        })}</span>
                        <small>{selectedInMode}/{mode.maximum}</small>
                      </div>
                      <div className="decision-target-cards">
                        {mode.cards.map((card) => {
                          const selected = selectedAlternativeCostIds.includes(card.instanceId);
                          const atMaximum = selectedInMode >= mode.maximum;
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
                <button
                  onClick={(event) => chooseWithoutFocus(
                    event.currentTarget,
                    () => onSelectAlternativeCost(null),
                  )}
                >
                  {intl.formatMessage({ id: "game.decision.chooseNone" })}
                </button>
                <button
                  className="btn-primary"
                  disabled={!canConfirmAdditionalCost}
                  onClick={onConfirmAdditionalCost}
                >
                  {intl.formatMessage(
                    { id: "game.decision.confirmNamed" },
                    { name: stagedAdditionalCost.cardLabel },
                  )}
                </button>
                <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
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
                    {intl.formatMessage({ id: "game.decision.payResources" })}
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
                    .map((card) => card
                      ? (cardData[card.cardId]?.name ?? intl.formatMessage({ id: "game.card" }))
                      : intl.formatMessage({ id: "game.card" }))
                    .join(", ");
                  return (
                    <button
                      key={choice.key}
                      className={`decision-target-card ${selected ? "decision-target-selected" : ""}`}
                      aria-label={intl.formatMessage({ id: "game.decision.useNamed" }, { name: label })}
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
                      <span>{intl.formatMessage({ id: "game.decision.useNamed" }, { name: label })}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {(!stagedAdditionalCost || additionalCostConfirmed) && pitchResourcesRequired > 0 ? (
            <strong
              className="decision-resource-progress"
              aria-label={intl.formatMessage(
                { id: "game.decision.pitchProgress" },
                { selected: pitchResourcesSelected, required: pitchResourcesRequired },
              )}
            >
              {pitchResourcesSelected}/{pitchResourcesRequired}
            </strong>
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
          <div className="decision-buttons">
            {abilityChoices.map((choice) => (
              <button
                key={choice.index}
                aria-label={choice.label.replaceAll("{p}", ` ${attackLabel}`).trim()}
                onClick={(event) =>
                  chooseWithoutFocus(event.currentTarget, () => onSelectAbility(choice.index))}
              >
                {choice.label.split(/(\{p\})/g).map((part, index) =>
                  part === "{p}" ? (
                    <img
                      key={index}
                      className="ico"
                      src="/icons/attack.png"
                      alt=""
                      aria-hidden="true"
                    />
                  ) : part
                )}
              </button>
            ))}
            <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
          </div>
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
          <div className="decision-buttons">
            <button
              className={playMethod === "action" ? "btn-primary" : ""}
              onClick={(event) =>
                chooseWithoutFocus(event.currentTarget, () => onSelectPlayMethod("action"))}
            >
              {intl.formatMessage({ id: "game.cardType.action" })}
            </button>
            <button
              className={playMethod === "instant" ? "btn-primary" : ""}
              onClick={(event) =>
                chooseWithoutFocus(event.currentTarget, () => onSelectPlayMethod("instant"))}
            >
              {intl.formatMessage({ id: "game.cardType.instant" })}
            </button>
            <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
          </div>
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
          <div className="decision-buttons">
            {presentedBoostOptions.map((count) => {
              const label = boostOptionLabel(intl, count, offersMultipleBoosts);
              const spaceDefault = boostCount === null && presentedBoostCount === count;
              return (
                <button
                  key={count}
                  className={`${presentedBoostCount === count ? "btn-primary" : ""}${
                    spaceDefault ? " shortcut-button" : ""
                  }`}
                  onClick={(event) =>
                    chooseWithoutFocus(event.currentTarget, () => onSelectBoost(count))}
                  {...(spaceDefault
                    ? {
                        title: intl.formatMessage({ id: "common.shortcut.space" }, { label }),
                        "aria-keyshortcuts": "Space",
                      }
                    : {})}
                >
                  {label}
                  {spaceDefault ? (
                    <kbd className="shortcut-key" aria-label={intl.formatMessage({ id: "common.spaceKey" })} />
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="decision-buttons">
            <button onClick={onCancel}>{intl.formatMessage({ id: "common.cancel" })}</button>
          </div>
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
