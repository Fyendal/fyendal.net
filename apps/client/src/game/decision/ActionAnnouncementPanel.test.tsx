import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionAnnouncementPanel } from "./ActionAnnouncementPanel.js";
import type { ActionAnnouncementModel } from "./DecisionModels.js";

const noop = () => undefined;

function paymentModel(
  normalCostPayableWithoutPitch: boolean,
): ActionAnnouncementModel {
  return {
    sel: { kind: "play-hand", instanceId: 1 },
    selCardId: undefined,
    step: "payment",
    autoCommitPending: false,
    abilityChoices: [],
    onSelectAbility: noop,
    onChooseHandPlay: noop,
    onChooseHandAbility: noop,
    meldChoices: [],
    meldSide: null,
    onSelectMeldSide: noop,
    playMethod: null,
    playMethodChoiceRequired: false,
    onSelectPlayMethod: noop,
    targetChoices: [],
    targetAllyId: undefined,
    onSelectTarget: noop,
    cardTargetChoices: [],
    targetCardInstanceId: null,
    onSelectCardTarget: noop,
    boostCount: 0,
    boostOptions: [],
    onSelectBoost: noop,
    onConfirmChainClose: noop,
    onConfirmAction: noop,
    normalCostPayableWithoutPitch,
    alternativeCostChoices: [{
      key: "2",
      instanceIds: [2],
      cards: [undefined],
    }],
    alternativeCostCardInstanceIds: undefined,
    onSelectAlternativeCost: noop,
    stagedAdditionalCost: undefined,
    additionalCostConfirmed: false,
    canConfirmAdditionalCost: false,
    onToggleAdditionalCostCard: noop,
    onConfirmAdditionalCost: noop,
    pitchSel: [],
    pitchResourcesSelected: 0,
    pitchResourcesRequired: 2,
    onCancel: noop,
  };
}

describe("alternative-cost payment choices", () => {
  it("hides normal resource payment while the player still needs to pitch", () => {
    const html = renderToStaticMarkup(
      <ActionAnnouncementPanel model={paymentModel(false)} viewerSeat={0} />,
    );

    expect(html).not.toContain("Pay resources");
  });

  it("offers normal resource payment when floating resources cover the cost", () => {
    const html = renderToStaticMarkup(
      <ActionAnnouncementPanel model={paymentModel(true)} viewerSeat={0} />,
    );

    expect(html).toContain("Pay resources");
  });

  it("shows destroy and discard targets directly without a mode-selection prompt", () => {
    const html = renderToStaticMarkup(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(true),
          stagedAdditionalCost: {
            cardLabel: "zombies",
            modes: [
              {
                mode: "destroy",
                maximum: 3,
                cards: [{ instanceId: 2, cardId: "IAR084", owner: 0 }],
              },
              {
                mode: "discard",
                maximum: 3,
                cards: [{ instanceId: 3, cardId: "IAR084", owner: 0 }],
              },
            ],
          },
        }}
        viewerSeat={0}
      />,
    );

    expect(html).not.toContain("Choose destroy and/or discard costs");
    expect(html).toContain("decision-additional-cost");
    expect(html).toContain("decision-additional-cost-groups");
    expect(html).toContain("decision-additional-cost-group");
    expect(html).toContain("Choose up to 3 zombies from each zone");
    expect(html).toContain("Destroy from arena");
    expect(html).toContain("Discard from hand");
    expect(html).toContain("Confirm zombies");
    expect(html).toContain('aria-label="Choose Restless Cleric"');
    expect(html).not.toContain("<span>Choose Restless Cleric</span>");
    expect(html).not.toContain("0/2");
  });
});

describe("activated ability mode choices", () => {
  it("shows the mode prompt before pitch progress", () => {
    const html = renderToStaticMarkup(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          sel: { kind: "activate", sourceInstanceId: 1 },
          selCardId: "AGB014",
          step: "ability",
          abilityChoices: [
            { index: 0, label: "Attack" },
            { index: 1, label: "Instant — discard watery grave: punish next draw" },
          ],
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("Choose how to use");
    expect(html).toContain("Attack");
    expect(html).toContain("Instant — discard watery grave: punish next draw");
    expect(html).not.toContain("pitch resources selected");
  });
});

describe("Boost choices", () => {
  it("presents Boost first and marks it as the default", () => {
    const html = renderToStaticMarkup(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          step: "boost",
          boostCount: null,
          boostOptions: [0, 1],
        }}
        viewerSeat={0}
      />,
    );

    expect(html.indexOf(">Boost</button>")).toBeLessThan(
      html.indexOf(">Don&#x27;t Boost</button>"),
    );
    expect(html).toContain('class="btn-primary shortcut-button"');
    expect(html).toContain('title="Boost (Space)"');
    expect(html).toContain('aria-keyshortcuts="Space"');
  });
});
