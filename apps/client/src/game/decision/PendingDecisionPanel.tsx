import type { CardView } from "@fyendal/shared";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { formatGameMessage } from "../../i18n/GameMessage.js";
import { CardFace } from "../Card.js";
import {
  isPriorityGuidanceDecision,
  shouldShowDecisionPass,
} from "../decisionPass.js";
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
import { NameChoiceAutocomplete } from "./NameChoiceAutocomplete.js";
import { TriggerOrderDecision } from "./TriggerOrderDecision.js";

function LocalizedDecisionOptionButton({
  message,
  option,
  spaceDefault,
  onChoose,
}: {
  message: NonNullable<NonNullable<PendingDecisionModel["decision"]>["optionMessages"]>[number];
  option: string;
  spaceDefault: boolean;
  onChoose: () => void;
}) {
  const intl = useIntl();
  if (!message) return null;
  const label = formatGameMessage(intl, message);
  return (
    <button
      key={option}
      className={spaceDefault ? "btn-primary shortcut-button" : undefined}
      onClick={onChoose}
      {...(spaceDefault
        ? {
            title: intl.formatMessage({ id: "common.shortcut.space" }, { label }),
            "aria-keyshortcuts": "Space",
          }
        : {})}
    >
      {label}
      {spaceDefault ? <kbd className="shortcut-key" aria-label="Space key" /> : null}
    </button>
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
    onDisableGuidance,
    onConfirmSkipArsenal,
    onCancelSkipArsenal,
    onSend,
  } = model;
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
  const priorityGuidanceDecision = isPriorityGuidanceDecision(pd);

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
    <div className={`decision decision-options${
      priorityGuidanceDecision ? " decision-priority-guidance" : ""
    }`}>
      <DecisionPrompt
        prompt={pd.kind === "defend" ? "Pitch to pay this defense cost" : pd.prompt}
        message={pd.kind === "defend" ? undefined : pd.promptMessage}
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
        <NameChoiceAutocomplete
          key={`${pd.player}:${pd.prompt}`}
          onChoose={(name) => onSend({ kind: "choose", optionId: name })}
        />
      ) : null}
      <div className="decision-buttons">
        {(pd.kind === "optional-effect" || pd.kind === "choose-target" || pd.kind === "arsenal") &&
          !bloodAllocation &&
          (pd.options ?? []).map((option, index) => {
            if (pd.optionCards?.[index]) return null;
            if (pd.resourcePayment?.options.some((candidate) => candidate.optionId === option)) return null;
            const spaceDefault = option === defaultSpaceOption;
            const optionMessage = pd.optionMessages?.[index];
            if (optionMessage) {
              return (
                <LocalizedDecisionOptionButton
                  key={option}
                  message={optionMessage}
                  option={option}
                  spaceDefault={spaceDefault}
                  onChoose={() => onSend({ kind: "choose", optionId: option })}
                />
              );
            }
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
