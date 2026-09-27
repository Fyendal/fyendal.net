import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { ActionAnnouncementPanel } from "./ActionAnnouncementPanel.js";
import type { ActionAnnouncementModel } from "./DecisionModels.js";

const noop = () => undefined;

function renderLocalized(node: ReactNode) {
  return renderToStaticMarkup(<TestI18nProvider>{node}</TestI18nProvider>);
}

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
    paymentProgress: { kind: "resource", selected: 0, required: 2 },
    onCancel: noop,
  };
}

describe("alternative-cost payment choices", () => {
  it("separates compact alternative-cost cards from resource pitching", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          alternativeCostChoices: [{
            key: "2:3",
            instanceIds: [2, 3],
            cards: [
              { instanceId: 2, cardId: "IAR084", owner: 0 },
              { instanceId: 3, cardId: "IAR084", owner: 0 },
            ],
          }],
          alternativeCostCardInstanceIds: [2, 3],
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain('aria-label="Choose an alternative cost"');
    expect(html).toContain('aria-label="Use Restless Cleric, Restless Cleric" aria-pressed="true"');
    expect(html).toContain('class="decision-alternative-cost-faces"');
    expect(html).toContain("<span>Restless Cleric, Restless Cleric</span>");
    expect(html).not.toContain("<span>Use Restless Cleric");
    expect(html).toMatch(/<\/section><div class="decision-pitch-payment"><span class="decision-context">Choose cards from your hand to pitch\./);
    expect(html).toContain("0/2");
  });

  it("hides normal resource payment while the player still needs to pitch", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel model={paymentModel(false)} viewerSeat={0} />,
    );

    expect(html).not.toContain("Pay resources");
  });

  it("offers normal resource payment when floating resources cover the cost", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel model={paymentModel(true)} viewerSeat={0} />,
    );

    expect(html).toContain("Pay resources");
  });

  it("shows destroy and discard targets directly without a mode-selection prompt", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(true),
          stagedAdditionalCost: {
            cardLabel: "zombies",
            minimum: 0,
            maximum: 6,
            selectedInstanceIds: [],
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
    expect(html).toContain("Choose up to 6 zombies to pay this cost");
    expect(html).toContain("Destroy from arena");
    expect(html).toContain("Discard from hand");
    expect(html).toContain("Confirm zombies");
    expect(html).toContain('aria-label="Choose Restless Cleric"');
    expect(html).not.toContain("<span>Choose Restless Cleric</span>");
    expect(html).not.toContain("0/2");
  });

  it("enables confirmation after choosing fewer than the maximum additional-cost cards", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(true),
          alternativeCostCardInstanceIds: [2],
          stagedAdditionalCost: {
            cardLabel: "zombies",
            minimum: 0,
            maximum: 3,
            selectedInstanceIds: [2],
            modes: [{
              mode: "destroy",
              maximum: 3,
              cards: [
                { instanceId: 2, cardId: "IAR084", owner: 0 },
                { instanceId: 3, cardId: "IAR065", owner: 0 },
                { instanceId: 4, cardId: "IAR087", owner: 0 },
              ],
            }],
          },
          canConfirmAdditionalCost: true,
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("1/3");
    expect(html).toMatch(/<button class="btn-primary">Confirm zombies<\/button>/);
  });
});

describe("activated ability mode choices", () => {
  it("presents an exact defense-ability cost in the same card chooser", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          sel: { kind: "activate", sourceInstanceId: 1 },
          alternativeCostChoices: [],
          stagedAdditionalCost: {
            cardLabel: "allies",
            minimum: 1,
            maximum: 1,
            selectedInstanceIds: [],
            modes: [
              {
                mode: "destroy",
                maximum: 1,
                cards: [{ instanceId: 2, cardId: "IAR084", owner: 0 }],
              },
              {
                mode: "discard",
                maximum: 1,
                cards: [{ instanceId: 3, cardId: "IAR084", owner: 0 }],
              },
            ],
          },
          paymentProgress: { kind: "discard", selected: 0, required: 1 },
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("Choose allies to pay this cost");
    expect(html).toContain("Destroy from arena");
    expect(html).toContain("Discard from hand");
    expect(html).not.toContain("Choose none");
    expect(html.match(/0\/1/g)).toHaveLength(2);
    expect(html).not.toContain("pitch resources selected");
  });

  it("labels a banish-from-hand defense cost accurately", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          sel: { kind: "activate", sourceInstanceId: 1 },
          alternativeCostChoices: [],
          stagedAdditionalCost: {
            cardLabel: "cards",
            minimum: 1,
            maximum: 1,
            selectedInstanceIds: [],
            modes: [{
              mode: "banish",
              maximum: 1,
              cards: [{ instanceId: 2, cardId: "WTR167", owner: 0 }],
            }],
          },
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("Banish from hand");
    expect(html).not.toContain("Discard from hand");
  });

  it("shows the mode prompt before pitch progress", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(false),
          sel: { kind: "activate", sourceInstanceId: 1 },
          selCardId: "AGB014",
          step: "ability",
          abilityChoices: [
            { index: 0, label: "+1{p}" },
            { index: 1, label: "Go again" },
          ],
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("Choose how to use");
    expect(html).toContain('aria-label="+1 Attack"');
    expect(html).toContain('src="/icons/attack.png"');
    expect(html).not.toContain("{p}");
    expect(html).toContain("Go again");
    expect(html).not.toContain("pitch resources selected");
  });
});

describe("action or instant play method", () => {
  it("puts the AP-free instant method first and states each method's action-point cost", () => {
    const html = renderLocalized(
      <ActionAnnouncementPanel
        model={{
          ...paymentModel(true),
          step: "method",
          playMethodChoiceRequired: true,
        }}
        viewerSeat={0}
      />,
    );

    expect(html).toContain("Play card as…");
    expect(html.indexOf("Play as instant (0 AP)")).toBeLessThan(
      html.indexOf("Play as action (spends 1 AP)"),
    );
  });
});

describe("Boost choices", () => {
  it("presents Boost first and marks it as the default", () => {
    const html = renderLocalized(
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
