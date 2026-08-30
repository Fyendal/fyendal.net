import { cardData } from "@fyendal/cards/client";
import type { BloodAllocationMode, BloodModeAllocation } from "../decisionPresentation.js";
import { CardFace } from "../Card.js";
import { CardRef, cardAffiliation } from "./DecisionShared.js";

const BLOOD_MODE_LABELS: Record<BloodAllocationMode, string> = {
  power: "Attacks get +1 power",
  "go-again": "Attacks get go again",
  "extra-attack": "May attack twice",
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
        aria-label={`${allocation.selected} of ${allocation.required} modes assigned`}
      >
        {allocation.selected}/{allocation.required}
      </strong>
      <span className="decision-context">
        Assign exactly {allocation.required}. Each mode may be selected up to twice across all weapons.
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
                  const label = BLOOD_MODE_LABELS[control.mode];
                  const cannotIncrease = allocation.selected >= allocation.required || modeTotals[control.mode] >= 2;
                  return (
                    <div className="blood-mode-control" key={control.mode}>
                      <span>{label}</span>
                      <div>
                        <button
                          aria-label={`Decrease ${label} for ${weaponName}`}
                          disabled={control.count <= 0}
                          onClick={() => onChoose(control.decrementOption)}
                          type="button"
                        >
                          −
                        </button>
                        <output aria-label={`${weaponName} ${label} selected ${control.count} times`}>
                          {control.count}
                        </output>
                        <button
                          aria-label={`Increase ${label} for ${weaponName}`}
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
          Confirm Modes
        </button>
      </div>
    </>
  );
}
