import { useState } from "react";
import type { CardView } from "@fyendal/shared";
import { CardFace } from "../Card.js";
import { shouldShowDecisionPass } from "../decisionPass.js";
import {
  bloodModeAllocation,
  handCardChoiceOptions,
  optDecisionCards,
} from "../decisionPresentation.js";
import { decisionSpaceOption } from "../passHotkey.js";
import { ArsenalSkipConfirmation, OptDecisionInstructions } from "./ActionConfirmations.js";
import { BloodModeDecision } from "./BloodModeDecision.js";
import { RevealedChoiceCards } from "./CardChoices.js";
import { CardRef, cardAffiliation, DecisionPrompt } from "./DecisionShared.js";
import type { PendingDecisionModel } from "./DecisionModels.js";
import { TriggerOrderDecision } from "./TriggerOrderDecision.js";

export function PendingDecisionPanel({
  model,
  viewerSeat,
}: {
  model: PendingDecisionModel;
  viewerSeat: number;
}) {
  const {
    decision: pd,
    isMine,
    decidingName,
    canPass,
    defendPitchIds,
    hand,
    defendSel,
    selectedPitchIds,
    onTogglePitch,
    resourcePaymentSelected,
    resourcePaymentRequired,
    confirmSkipArsenal,
    onRequestPass,
    onConfirmSkipArsenal,
    onCancelSkipArsenal,
    onSend,
  } = model;
  const [chosenName, setChosenName] = useState("");
  if (!pd) return null;
  if (isMine && pd.kind === "defend" && defendPitchIds.size === 0) return null;

  const optCards = optDecisionCards(pd);
  const optDecision = optCards !== null;
  const bloodAllocation = bloodModeAllocation(pd);
  const handPickDecision = handCardChoiceOptions(pd, hand) !== null;
  const revealedCards = pd.revealedCards ?? [];
  const revealedChoice = revealedCards.length > 0;
  const lookedCards = pd.lookedCards ?? [];
  const cardChoiceOptionIds = new Map<number, string>();
  (pd.options ?? []).forEach((option, index) => {
    const optionCard = pd.optionCards?.[index];
    if (optionCard) cardChoiceOptionIds.set(optionCard.instanceId, option);
  });
  const choiceGridCards: CardView[] = [
    ...(pd.optionCards ?? []).filter((card): card is CardView => !!card),
    ...lookedCards.filter((card) => !cardChoiceOptionIds.has(card.instanceId)),
  ];
  const showChoiceGrid =
    !optDecision &&
    !bloodAllocation &&
    !handPickDecision &&
    !revealedChoice &&
    (pd.kind === "optional-effect" || pd.kind === "choose-target") &&
    choiceGridCards.length > 0;
  const revealedSelectableIds = new Set(
    (pd.options ?? []).flatMap((option) => {
      const instanceId = Number(option);
      return Number.isSafeInteger(instanceId) ? [instanceId] : [];
    }),
  );
  const defaultSpaceOption = decisionSpaceOption(pd);

  if (!isMine) {
    return (
      <div className={`decision decision-passive${revealedChoice ? " decision-options" : ""}`}>
        <span className="decision-prompt muted">{decidingName} is deciding…</span>
        {revealedChoice ? (
          <RevealedChoiceCards
            cards={revealedCards}
            selectableIds={revealedSelectableIds}
            viewerSeat={viewerSeat}
          />
        ) : null}
      </div>
    );
  }

  if (pd.kind === "arsenal" && confirmSkipArsenal) {
    return (
      <div className="decision decision-options">
        <ArsenalSkipConfirmation
          onConfirm={onConfirmSkipArsenal}
          onCancel={onCancelSkipArsenal}
        />
      </div>
    );
  }

  return (
    <div className="decision decision-options">
      <DecisionPrompt prompt={pd.kind === "defend" ? "Pitch to pay this defense cost" : pd.prompt} />
      {lookedCards.length > 0 && !showChoiceGrid ? (
        <div className="decision-cards">
          {lookedCards.map((card) => (
            <CardFace
              key={card.instanceId}
              card={card}
              size="hand"
              affiliation={cardAffiliation(card, viewerSeat)}
            />
          ))}
        </div>
      ) : null}
      {pd.kind === "order-triggers" ? (
        <TriggerOrderDecision
          key={(pd.options ?? []).map((option, index) =>
            `${option}:${pd.optionCounts?.[index] ?? 1}:${index}`
          ).join("|")}
          options={pd.options ?? []}
          labels={pd.optionLabels ?? []}
          counts={pd.optionCounts ?? []}
          cards={pd.optionCards ?? []}
          viewerSeat={viewerSeat}
          onConfirm={(optionIds) => onSend({ kind: "order-triggers", optionIds })}
        />
      ) : null}
      {revealedChoice ? (
        <RevealedChoiceCards
          cards={revealedCards}
          selectableIds={revealedSelectableIds}
          viewerSeat={viewerSeat}
          onChoose={(instanceId) => onSend({ kind: "choose", optionId: String(instanceId) })}
        />
      ) : null}
      {pd.kind === "defend" && defendPitchIds.size > 0 ? (
        <span className="decision-prompt">
          {"Pitch to pay this defense cost: "}
          {hand
            .filter((card) => !defendSel.includes(card.instanceId) && defendPitchIds.has(card.instanceId))
            .map((card) => (
              <button
                key={card.instanceId}
                className={selectedPitchIds.includes(card.instanceId) ? "btn-primary" : ""}
                onClick={() => onTogglePitch(card.instanceId)}
              >
                <CardRef id={card.cardId} name={card.name} />
              </button>
            ))}
        </span>
      ) : null}
      {pd.resourcePayment ? (
        <>
          <span className="decision-context">Choose cards from your hand to pitch.</span>
          <strong
            className="decision-resource-progress"
            aria-label={`${resourcePaymentSelected} of ${resourcePaymentRequired} pitch resources selected`}
          >
            {resourcePaymentSelected}/{resourcePaymentRequired}
          </strong>
        </>
      ) : null}
      {bloodAllocation ? (
        <BloodModeDecision
          allocation={bloodAllocation}
          viewerSeat={viewerSeat}
          onChoose={(optionId) => onSend({ kind: "choose", optionId })}
        />
      ) : null}
      {optDecision ? (
        <>
          <OptDecisionInstructions cardCount={optCards.length} />
          <div className="decision-cards">
            {optCards.map(({ id, card }) => (
              <div className="decision-optcard" key={id}>
                <button
                  className="btn-primary"
                  onClick={() => onSend({ kind: "choose", optionId: `top:${id}` })}
                >
                  Top
                </button>
                <CardFace card={card} size="hand" affiliation={cardAffiliation(card, viewerSeat)} />
                <button onClick={() => onSend({ kind: "choose", optionId: `bottom:${id}` })}>
                  Bottom
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {showChoiceGrid ? (
        <div className="decision-cards">
          {choiceGridCards.map((card) => {
            const optionId = cardChoiceOptionIds.get(card.instanceId);
            return (
              <CardFace
                key={card.instanceId}
                card={card}
                size="hand"
                highlighted={optionId !== undefined}
                affiliation={cardAffiliation(card, viewerSeat)}
                onClick={optionId !== undefined
                  ? () => onSend({ kind: "choose", optionId })
                  : undefined}
              />
            );
          })}
        </div>
      ) : null}
      {pd.kind === "choose-name" ? (
        <form
          className="decision-buttons"
          onSubmit={(event) => {
            event.preventDefault();
            const name = chosenName.trim();
            if (!name) return;
            onSend({ kind: "choose", optionId: name });
            setChosenName("");
          }}
        >
          <input
            aria-label="Card name"
            autoComplete="off"
            placeholder="Enter an exact card name"
            value={chosenName}
            onChange={(event) => setChosenName(event.target.value)}
          />
          <button className="btn-primary" disabled={!chosenName.trim()} type="submit">
            Choose name
          </button>
        </form>
      ) : null}
      <div className="decision-buttons">
        {(pd.kind === "optional-effect" || pd.kind === "choose-target" || pd.kind === "arsenal") &&
          !bloodAllocation &&
          (pd.options ?? []).map((option, index) => {
            if (pd.optionCards?.[index]) return null;
            if (pd.resourcePayment?.options.some((candidate) => candidate.optionId === option)) return null;
            const spaceDefault = option === defaultSpaceOption;
            const shortcutLabel = option.length > 0
              ? `${option[0]!.toUpperCase()}${option.slice(1)}`
              : option;
            return (
              <button
                key={option}
                className={spaceDefault ? "btn-primary shortcut-button" : undefined}
                onClick={() => onSend({ kind: "choose", optionId: option })}
                {...(spaceDefault
                  ? { title: `${shortcutLabel} (Space)`, "aria-keyshortcuts": "Space" }
                  : {})}
              >
                {option}
                {spaceDefault ? <kbd className="shortcut-key" aria-label="Space key" /> : null}
              </button>
            );
          })}
        {shouldShowDecisionPass(pd, canPass) ? (
          <button
            className="shortcut-button"
            onClick={onRequestPass}
            title="Pass (Space)"
            aria-keyshortcuts="Space"
          >
            Pass
            <kbd className="shortcut-key" aria-label="Space key" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
