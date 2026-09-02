import { cardData } from "@fyendal/cards/client";
import { useIntl } from "react-intl";
import type { BloodAllocationMode, BloodModeAllocation } from "../decisionPresentation.js";
import { CardFace } from "../Card.js";
import { CardRef, cardAffiliation } from "./DecisionShared.js";

const BLOOD_MODE_MESSAGE_IDS: Record<BloodAllocationMode, string> = {
  power: "game.decision.bloodMode.power",
  "go-again": "game.decision.bloodMode.goAgain",
  "extra-attack": "game.decision.bloodMode.extraAttack",
};

export function BloodModeDecision({
  allocation,
  viewerSeat,
  onChoose,
}: {
  allocation: BloodModeAllocation;
  viewerSeat: number;
  onChoose: (optionId: string) => void;
}) {
  const intl = useIntl();
  const modeTotals: Record<BloodAllocationMode, number> = {
    power: 0,
    "go-again": 0,
    "extra-attack": 0,
  };
  for (const weapon of allocation.weapons) {
    for (const control of weapon.controls) modeTotals[control.mode] += control.count;
  }

  return (
    <>
      <strong
        className="decision-resource-progress"
        aria-label={intl.formatMessage(
          { id: "game.decision.bloodMode.progress" },
          { selected: allocation.selected, required: allocation.required },
        )}
      >
        {allocation.selected}/{allocation.required}
      </strong>
      <span className="decision-context">
        {intl.formatMessage(
          { id: "game.decision.bloodMode.instructions" },
          { count: allocation.required },
        )}
      </span>
      <div className="blood-mode-weapons">
        {allocation.weapons.map((weapon) => {
          const weaponName = cardData[weapon.card.cardId]?.name ?? weapon.card.name ?? weapon.card.cardId;
          return (
            <section className="blood-mode-weapon" key={weapon.card.instanceId}>
              <CardFace
                card={weapon.card}
                size="hand"
                affiliation={cardAffiliation(weapon.card, viewerSeat)}
              />
              <strong><CardRef id={weapon.card.cardId} name={weapon.card.name} /></strong>
              <div className="blood-mode-controls">
                {weapon.controls.map((control) => {
                  const label = intl.formatMessage({ id: BLOOD_MODE_MESSAGE_IDS[control.mode] });
                  const cannotIncrease = allocation.selected >= allocation.required || modeTotals[control.mode] >= 2;
                  return (
                    <div className="blood-mode-control" key={control.mode}>
                      <span>{label}</span>
                      <div>
                        <button
                          aria-label={intl.formatMessage(
                            { id: "game.decision.bloodMode.decrease" },
                            { mode: label, weapon: weaponName },
                          )}
                          disabled={control.count <= 0}
                          onClick={() => onChoose(control.decrementOption)}
                          type="button"
                        >
                          −
                        </button>
                        <output aria-label={intl.formatMessage(
                          { id: "game.decision.bloodMode.selected" },
                          { weapon: weaponName, mode: label, count: control.count },
                        )}>
                          {control.count}
                        </output>
                        <button
                          aria-label={intl.formatMessage(
                            { id: "game.decision.bloodMode.increase" },
                            { mode: label, weapon: weaponName },
                          )}
                          disabled={cannotIncrease}
                          onClick={() => onChoose(control.incrementOption)}
                          type="button"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="decision-buttons">
        <button
          className="btn-primary"
          disabled={allocation.selected !== allocation.required}
          onClick={() => onChoose(allocation.confirmOption)}
          type="button"
        >
          {intl.formatMessage({ id: "game.decision.bloodMode.confirm" })}
        </button>
      </div>
    </>
  );
}
