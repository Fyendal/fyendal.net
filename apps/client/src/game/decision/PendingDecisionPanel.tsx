import { cardData } from "@fyendal/cards/client";
import type { CardView } from "@fyendal/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { formatGameMessage, GameMessageText } from "../../i18n/GameMessage.js";
import { CardBack, CardFace } from "../Card.js";
import {
  isPriorityGuidanceDecision,
  shouldShowDecisionPass,
} from "../decisionPass.js";
import {
  boundedCardChoiceModel,
  bloodModeAllocation,
  handCardChoiceOptions,
  heroTargetSide,
  optDecisionCards,
  toggleBoundedCardChoice,
} from "../decisionPresentation.js";
import { decisionSpaceOption } from "../passHotkey.js";
import { ArsenalSkipConfirmation, OptDecisionInstructions } from "./ActionConfirmations.js";
import { BloodModeDecision } from "./BloodModeDecision.js";
import {
  ChoiceButton,
  ChoiceList,
  type ChoiceModalChosen,
  type ChoiceModalOption,
} from "./ChoiceModal.js";
import { RevealedChoiceCards } from "./CardChoices.js";
import { CardRef, cardAffiliation, DecisionPrompt, PitchPaymentProgress } from "./DecisionShared.js";
import type { PendingDecisionModel } from "./DecisionModels.js";
import { NameChoiceAutocomplete } from "./NameChoiceAutocomplete.js";
import { TriggerOrderDecision } from "./TriggerOrderDecision.js";

/** Legacy literal option values that render through shared catalog labels. */
const LITERAL_OPTION_MESSAGES = {
  yes: "common.option.yes",
  no: "common.option.no",
  pass: "common.option.pass",
  decline: "common.option.decline",
  reroll: "common.option.reroll",
  keep: "common.option.keep",
} as const;

const localizedOptionResolvers = {
  card: (cardId: string) => cardData[cardId]?.name ?? cardId,
};

function BoundedCardChoiceConfirm({
  selectedOptionIds,
  minimumSelections,
  maximumSelections,
  onConfirm,
}: {
  selectedOptionIds: readonly string[];
  minimumSelections: number;
  maximumSelections: number;
  onConfirm: (optionIds: readonly string[]) => void;
}) {
  const intl = useIntl();
  const canConfirm = selectedOptionIds.length >= minimumSelections &&
    selectedOptionIds.length <= maximumSelections;
  return (
    <div className="decision-buttons">
      <button
        type="button"
        className="btn-primary"
        disabled={!canConfirm}
        onClick={() => onConfirm(selectedOptionIds)}
      >
        {selectedOptionIds.length === 0
          ? intl.formatMessage({ id: "common.done" })
          : intl.formatMessage(
              { id: "game.search.submit" },
              { count: selectedOptionIds.length },
            )}
      </button>
    </div>
  );
}

function BoundedCardChoiceDecision({
  choice,
  viewerSeat,
  onConfirm,
}: {
  choice: NonNullable<ReturnType<typeof boundedCardChoiceModel>>;
  viewerSeat: number;
  onConfirm: (optionIds: readonly string[]) => void;
}) {
  const [selectedOptionIds, setSelectedOptionIds] = useState<readonly string[]>([]);

  return (
    <>
      <div className="decision-cards">
        {choice.choices.map(({ optionId, card }) => {
          const selected = selectedOptionIds.includes(optionId);
          const canSelect = selected || selectedOptionIds.length < choice.maximumSelections;
          return (
            <CardFace
              key={optionId}
              card={card}
              size="hand"
              selected={selected}
              highlighted={canSelect && !selected}
              dimmed={!canSelect}
              affiliation={cardAffiliation(card, viewerSeat)}
              onClick={canSelect
                ? () => setSelectedOptionIds((current) =>
                    toggleBoundedCardChoice(current, optionId, choice.maximumSelections)
                  )
                : undefined}
            />
          );
        })}
      </div>
      <BoundedCardChoiceConfirm
        selectedOptionIds={selectedOptionIds}
        minimumSelections={choice.minimumSelections}
        maximumSelections={choice.maximumSelections}
        onConfirm={onConfirm}
      />
    </>
  );
}

export function GuidanceSettingsPopover({
  onDisableGuidance,
}: {
  onDisableGuidance: () => void;
}) {
  const intl = useIntl();
  return (
    <>
      {intl.formatMessage({ id: "settings.guidance.disableHint" })}{" "}
      <button
        type="button"
        className="decision-guidance-disable"
        onClick={onDisableGuidance}
      >
        {intl.formatMessage({ id: "settings.guidance.disableNow" })}
      </button>
      .
    </>
  );
}

function GuidanceSettingsInfo({
  onDisableGuidance,
}: {
  onDisableGuidance: () => void;
}) {
  const intl = useIntl();
  const guidanceId = useId();
  const descriptionId = `guidance-settings-description-${guidanceId}`;
  const popoverId = `guidance-settings-popover-${guidanceId}`;
  const anchorRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null);

  const cancelClose = () => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const showPopover = () => {
    cancelClose();
    setOpen(true);
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 150);
  };

  useEffect(() => () => cancelClose(), []);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const bounds = anchor.getBoundingClientRect();
      const tooltipHalfWidth = Math.min(120, window.innerWidth * 0.36);
      setPosition({
        left: Math.min(
          window.innerWidth - tooltipHalfWidth - 8,
          Math.max(tooltipHalfWidth + 8, bounds.left + bounds.width / 2),
        ),
        bottom: window.innerHeight - bounds.top + 8,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={anchorRef}
        className="decision-guidance-info"
        aria-label={intl.formatMessage({ id: "settings.guidance.title" })}
        aria-describedby={descriptionId}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onMouseEnter={showPopover}
        onMouseLeave={scheduleClose}
        onFocus={showPopover}
        onBlur={scheduleClose}
        onClick={showPopover}
      >
        i
        <span id={descriptionId} className="decision-guidance-tooltip-accessible">
          {intl.formatMessage({ id: "settings.guidance.tooltip" })}
        </span>
      </button>
      {open && position && typeof document !== "undefined"
        ? createPortal(
            <span
              id={popoverId}
              role="dialog"
              aria-label={intl.formatMessage({ id: "settings.guidance.title" })}
              className="decision-guidance-tooltip-floating"
              style={position}
              onMouseEnter={showPopover}
              onMouseLeave={scheduleClose}
              onFocus={showPopover}
              onBlur={scheduleClose}
            >
              <GuidanceSettingsPopover onDisableGuidance={onDisableGuidance} />
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

export function PendingDecisionPanel({
  model,
  viewerSeat,
}: {
  model: PendingDecisionModel;
  viewerSeat: number;
}) {
  const intl = useIntl();
  const {
    decision: pd,
    isMine,
    decidingName,
    playerName,
    optionCardLabels,
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
    onDisableGuidance,
    onConfirmSkipArsenal,
    onCancelSkipArsenal,
    boundedChoiceSelectedOptionIds,
    onConfirmBoundedChoice,
    onSend,
  } = model;
  if (!pd) return null;
  if (isMine && pd.kind === "defend" && defendPitchIds.size === 0) return null;
  const optionResolvers = playerName
    ? { ...localizedOptionResolvers, player: playerName }
    : localizedOptionResolvers;

  const optCards = optDecisionCards(pd);
  const optDecision = optCards !== null;
  const bloodAllocation = bloodModeAllocation(pd);
  const boundedCardChoice = boundedCardChoiceModel(pd);
  const handPickDecision = handCardChoiceOptions(pd, hand) !== null;
  const revealedCards = pd.revealedCards ?? [];
  const revealedChoice = revealedCards.length > 0;
  const lookedCards = pd.lookedCards ?? [];
  const offeredCardIds = new Set<number>();
  const choiceGridCards = (pd.optionCards ?? []).flatMap((card, index) => {
    if (!card) return [];
    offeredCardIds.add(card.instanceId);
    const message = pd.optionMessages?.[index];
    return [{
      card,
      key: `option:${index}`,
      optionId: pd.options?.[index],
      label: optionCardLabels?.get(card.instanceId) ??
        (message ? formatGameMessage(intl, message, optionResolvers) : undefined),
    }];
  });
  for (const card of lookedCards) {
    if (offeredCardIds.has(card.instanceId)) continue;
    choiceGridCards.push({
      card,
      key: `looked:${card.instanceId}`,
      optionId: undefined,
      label: optionCardLabels?.get(card.instanceId),
    });
  }
  const showChoiceGrid =
    !optDecision &&
    !bloodAllocation &&
    !boundedCardChoice &&
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
  const priorityGuidanceDecision = isPriorityGuidanceDecision(pd);

  if (!isMine) {
    return (
      <div className={`decision decision-passive${revealedChoice ? " decision-options" : ""}`}>
        <span className="decision-prompt muted">
          {intl.formatMessage({ id: "game.decision.playerDeciding" }, { player: decidingName })}
        </span>
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
      <div className="decision decision-options decision-choice">
        <ArsenalSkipConfirmation
          onConfirm={onConfirmSkipArsenal}
          onCancel={onCancelSkipArsenal}
        />
      </div>
    );
  }

  const textOptions: ChoiceModalOption[] = [];
  if (
    (pd.kind === "optional-effect" || pd.kind === "choose-target" || pd.kind === "arsenal") &&
    !bloodAllocation
  ) {
    (pd.options ?? []).forEach((option, index) => {
      if (pd.optionCards?.[index]) return;
      if (pd.resourcePayment?.options.some((candidate) => candidate.optionId === option)) return;
      const onChoose = () => onSend({ kind: "choose", optionId: option });
      const spaceDefault = option === defaultSpaceOption;
      const optionMessage = pd.optionMessages?.[index];
      const side = heroTargetSide(option, viewerSeat) ?? undefined;
      // Hero-name labels need the side spelled out; relative values already say it.
      const sideTag = side !== undefined && option.startsWith("hero:");
      if (optionMessage) {
        const text = formatGameMessage(intl, optionMessage, optionResolvers);
        textOptions.push({
          key: option,
          label: <GameMessageText message={optionMessage} resolvers={optionResolvers} />,
          text: sideTag
            ? `${text}, ${intl.formatMessage({ id: `game.decision.target.${side}` })}`
            : text,
          spaceDefault,
          side,
          sideTag,
          onChoose,
        });
        return;
      }
      const literalMessageId = Object.hasOwn(LITERAL_OPTION_MESSAGES, option)
        ? LITERAL_OPTION_MESSAGES[option as keyof typeof LITERAL_OPTION_MESSAGES]
        : undefined;
      const payAmount = /^pay (\d+)$/.exec(option)?.[1];
      const optionLabel = payAmount !== undefined
        ? intl.formatMessage({ id: "game.decision.payAmount" }, { amount: payAmount })
        : literalMessageId
          ? intl.formatMessage({ id: literalMessageId })
          : option;
      const shortcutLabel = literalMessageId || payAmount !== undefined
        ? optionLabel
        : option.length > 0
          ? `${option[0]!.toUpperCase()}${option.slice(1)}`
          : option;
      textOptions.push({
        key: option,
        label: optionLabel,
        text: spaceDefault ? shortcutLabel : undefined,
        spaceDefault,
        side,
        sideTag,
        onChoose,
      });
    });
    // Hero targets list the opponent first; the stable sort keeps other options in order.
    textOptions.sort((a, b) => Number(a.side !== "opponent") - Number(b.side !== "opponent"));
  }
  const chosenOptions: ChoiceModalChosen[] = (pd.chosenOptions ?? []).map((option, index) => {
    const message = pd.chosenOptionMessages?.[index];
    return {
      key: `${index}:${option}`,
      label: message
        ? <GameMessageText message={message} resolvers={optionResolvers} />
        : option,
    };
  });
  if (shouldShowDecisionPass(pd, canPass)) {
    textOptions.push({
      key: "__pass",
      label: intl.formatMessage({ id: "common.option.pass" }),
      text: intl.formatMessage({ id: "common.option.pass" }),
      spaceDefault: true,
      onChoose: onRequestPass,
    });
  }
  // Pure text choices use the shared choice modal; card-driven and payment
  // decisions keep their wider layouts and list any text options beneath.
  const choiceModal =
    textOptions.length > 0 &&
    !priorityGuidanceDecision &&
    !optDecision &&
    !bloodAllocation &&
    !boundedCardChoice &&
    !handPickDecision &&
    !revealedChoice &&
    !showChoiceGrid &&
    !pd.resourcePayment &&
    pd.kind !== "defend" &&
    pd.kind !== "arsenal" &&
    pd.kind !== "choose-name" &&
    pd.kind !== "order-triggers";

  return (
    <div className={`decision decision-options${
      priorityGuidanceDecision ? " decision-priority-guidance" : ""
    }${choiceModal ? " decision-choice" : ""}${pd.kind === "choose-name" ? " decision-name-choice" : ""}${
      pd.kind === "order-triggers" ? " decision-trigger-order" : ""
    }`}>
      <DecisionPrompt
        prompt={pd.kind === "arsenal"
          ? intl.formatMessage({ id: "game.decision.arsenal.choosePrompt" })
          : pd.prompt}
        message={pd.promptMessage}
        breakOnDash={priorityGuidanceDecision}
        suffix={priorityGuidanceDecision ? (
          <GuidanceSettingsInfo onDisableGuidance={onDisableGuidance} />
        ) : undefined}
      />
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
            `${option}:${pd.optionCounts?.[index] ?? 1}:${pd.optionMessages?.[index]?.id ?? ""}:${JSON.stringify(pd.optionMessages?.[index]?.values ?? {})}:${index}`
          ).join("|")}
          options={pd.options ?? []}
          labels={pd.optionLabels ?? []}
          messages={pd.optionMessages ?? []}
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
          {intl.formatMessage({ id: "game.decision.defensePitchList" })}{" "}
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
        <PitchPaymentProgress selected={resourcePaymentSelected} required={resourcePaymentRequired} />
      ) : null}
      {bloodAllocation ? (
        <BloodModeDecision
          allocation={bloodAllocation}
          viewerSeat={viewerSeat}
          onChoose={(optionId) => onSend({ kind: "choose", optionId })}
        />
      ) : null}
      {boundedCardChoice &&
      boundedChoiceSelectedOptionIds !== undefined &&
      onConfirmBoundedChoice ? (
        <BoundedCardChoiceConfirm
          selectedOptionIds={boundedChoiceSelectedOptionIds}
          minimumSelections={boundedCardChoice.minimumSelections}
          maximumSelections={boundedCardChoice.maximumSelections}
          onConfirm={onConfirmBoundedChoice}
        />
      ) : boundedCardChoice ? (
        <BoundedCardChoiceDecision
          key={JSON.stringify([
            pd.player,
            pd.promptMessage ?? pd.prompt,
            pd.options,
            pd.minimumSelections,
            pd.maximumSelections,
          ])}
          choice={boundedCardChoice}
          viewerSeat={viewerSeat}
          onConfirm={(optionIds) => onSend({ kind: "choose-many", optionIds: [...optionIds] })}
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
                  {intl.formatMessage({ id: "game.decision.opt.top" })}
                </button>
                <CardFace card={card} size="hand" affiliation={cardAffiliation(card, viewerSeat)} />
                <button onClick={() => onSend({ kind: "choose", optionId: `bottom:${id}` })}>
                  {intl.formatMessage({ id: "game.decision.opt.bottom" })}
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {showChoiceGrid ? (
        <div className="decision-cards">
          {choiceGridCards.map(({ card, key, optionId, label }) => {
            const onChoose = optionId !== undefined
              ? () => onSend({ kind: "choose", optionId })
              : undefined;
            const affiliation = cardAffiliation(card, viewerSeat);
            return (
              <div key={key} className="decision-card-option">
                {card.hidden ? (
                  <CardBack
                    label=""
                    ariaLabel={label}
                    size="hand"
                    className={`card-${affiliation}${onChoose ? " card-highlight" : ""}`}
                    onClick={onChoose}
                  />
                ) : (
                  <CardFace
                    card={card}
                    size="hand"
                    accessibleLabel={label}
                    highlighted={onChoose !== undefined}
                    affiliation={affiliation}
                    onClick={onChoose}
                  />
                )}
                {label ? (
                  <span className={`decision-card-caption decision-card-caption-${affiliation}`} aria-hidden="true">
                    {label}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {pd.kind === "choose-name" ? (
        <NameChoiceAutocomplete
          key={`${pd.player}:${pd.prompt}`}
          onChoose={(name) => onSend({ kind: "choose", optionId: name })}
        />
      ) : null}
      {pd.resourcePayment ? (
        <div className="decision-buttons">
          {textOptions.map((option) => (
            <ChoiceButton
              key={option.key}
              option={option}
              className={option.spaceDefault ? "btn-primary" : undefined}
            />
          ))}
        </div>
      ) : (
        <ChoiceList options={textOptions} chosen={chosenOptions} />
      )}
    </div>
  );
}
