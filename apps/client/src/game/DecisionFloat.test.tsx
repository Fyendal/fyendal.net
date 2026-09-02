import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decisionFloatDragKey } from "./DecisionFloat.js";
import { BloodModeDecision } from "./decision/BloodModeDecision.js";
import { ActionTargetCards, RevealedChoiceCards } from "./decision/CardChoices.js";
import type { PendingDecisionModel } from "./decision/DecisionModels.js";
import {
  GuidanceSettingsPopover,
  PendingDecisionPanel,
} from "./decision/PendingDecisionPanel.js";
import {
  ActionConfirmation,
  ArsenalSkipConfirmation,
  boostOptionLabel,
  ChainCloseConfirmation,
  OptDecisionInstructions,
} from "./decision/ActionConfirmations.js";
import {
  chooseWithoutFocus,
  DecisionPrompt,
  handCardPlayLabel,
} from "./decision/DecisionShared.js";
import {
  cardNameEnterAction,
  cardNameSuggestions,
  NameChoiceAutocomplete,
} from "./decision/NameChoiceAutocomplete.js";
import {
  confirmTriggerOrderOnSpace,
  moveTriggerOrder,
  TriggerOrderDecision,
} from "./decision/TriggerOrderDecision.js";
import { bloodModeAllocation, handCardChoiceOptions, optDecisionCards } from "./decisionPresentation.js";

function bloodDecision(selected = 1, required = 2) {
  const weapons = [
    { instanceId: 41, cardId: "FIRST", owner: 0 },
    { instanceId: 42, cardId: "SECOND", owner: 0 },
  ];
  const modes = ["power", "go-again", "extra-attack"] as const;
  const options: string[] = [];
  const optionCards: Array<(typeof weapons)[number] | null> = [];
  for (const weapon of weapons) {
    for (const mode of modes) {
      const count = weapon.instanceId === 41 && mode === "power" ? selected : 0;
      for (const operation of ["decrement", "increment"] as const) {
        options.push(`blood-mode:${operation}:${mode}:${weapon.instanceId}:${count}:${selected}:${required}`);
        optionCards.push(weapon);
      }
    }
  }
  options.push(`blood-mode:confirm:${selected}:${required}`);
  optionCards.push(null);
  return {
    player: 0,
    kind: "choose-target" as const,
    prompt: `Assign ${required} Blood on Her Hands modes`,
    options,
    optionCards,
  };
}

describe("announcement choice focus", () => {
  it("releases focus after applying a choice so Space can confirm", () => {
    const calls: string[] = [];
    chooseWithoutFocus(
      { blur: () => calls.push("blur") },
      () => calls.push("choose"),
    );

    expect(calls).toEqual(["choose", "blur"]);
  });
});

describe("hand card use labels", () => {
  it("identifies Shelter from the Storm's normal play as a defense reaction", () => {
    expect(handCardPlayLabel("HNT222")).toBe("Play as defense reaction");
  });
});

describe("card-name autocomplete", () => {
  it("deduplicates printings and ranks prefix matches before substring matches", () => {
    const exact = cardNameSuggestions("Become the Bottle");
    expect(exact.filter((name) => name === "Become the Bottle")).toEqual(["Become the Bottle"]);

    const tiger = cardNameSuggestions("tiger", 20);
    const prefixEnd = tiger.findIndex((name) => !name.toLowerCase().startsWith("tiger"));
    expect(prefixEnd).toBeGreaterThan(0);
    expect(tiger.slice(0, prefixEnd).every((name) => name.toLowerCase().startsWith("tiger")))
      .toBe(true);
    expect(tiger.slice(prefixEnd).some((name) => name === "Crouching Tiger")).toBe(true);
    expect(cardNameSuggestions("a")).toHaveLength(8);
  });

  it("renders an accessible list-autocomplete combobox", () => {
    const html = renderToStaticMarkup(createElement(NameChoiceAutocomplete, { onChoose() {} }));

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Start typing a card name");
  });

  it("accepts the highlighted suggestion on Enter without submitting it", () => {
    expect(cardNameEnterAction(true, ["Head Jab", "Hundred Winds"], 1)).toEqual({
      kind: "accept-suggestion",
      name: "Hundred Winds",
    });
    expect(cardNameEnterAction(false, ["Hundred Winds"], 0)).toEqual({ kind: "submit" });
  });
});

describe("decision float drag identity", () => {
  it("starts a newly selected action at the initial location", () => {
    const first = decisionFloatDragKey(null, { kind: "play-hand", instanceId: 41 }, false);
    const hidden = decisionFloatDragKey(null, { kind: "none" }, false);
    const second = decisionFloatDragKey(null, { kind: "play-hand", instanceId: 41 }, false);

    expect(first).not.toBe(hidden);
    expect(second).toBe(first);
  });

  it("keeps one action's identity through its internal ability selection", () => {
    expect(decisionFloatDragKey(null, {
      kind: "activate",
      sourceInstanceId: 12,
    }, false)).toBe(decisionFloatDragKey(null, {
      kind: "activate",
      sourceInstanceId: 12,
      abilityIndex: 1,
    }, false));
  });

  it("changes identity for a new authoritative prompt", () => {
    const first = decisionFloatDragKey({
      player: 0,
      kind: "choose-target",
      prompt: "Choose soul card 1 of 2",
      options: ["41", "42"],
    }, { kind: "none" }, false);
    const second = decisionFloatDragKey({
      player: 0,
      kind: "choose-target",
      prompt: "Choose soul card 2 of 2",
      options: ["42"],
    }, { kind: "none" }, false);

    expect(second).not.toBe(first);
  });

  it("keeps the Blood on Her Hands allocator in place while counts change", () => {
    expect(decisionFloatDragKey(
      bloodDecision(0, 2),
      { kind: "none" },
      false,
    )).toBe(decisionFloatDragKey(
      bloodDecision(1, 2),
      { kind: "none" },
      false,
    ));
  });
});

describe("priority guidance help", () => {
  function pendingModel(kind: "defense-reaction" | "optional-effect"): PendingDecisionModel {
    return {
      decision: { player: 0, kind, prompt: "Defense reaction window — play a reaction or pass" },
      isMine: true,
      decidingName: "Hero",
      canPass: true,
      defendPitchIds: new Set(),
      hand: [],
      defendSel: [],
      selectedPitchIds: [],
      onTogglePitch: () => undefined,
      resourcePaymentSelected: 0,
      resourcePaymentRequired: 0,
      confirmSkipArsenal: false,
      onRequestPass: () => undefined,
      onDisableGuidance: () => undefined,
      onConfirmSkipArsenal: () => undefined,
      onCancelSkipArsenal: () => undefined,
      onSend: () => undefined,
    };
  }

  it("explains how to disable future guidance from a reaction prompt", () => {
    const html = renderToStaticMarkup(createElement(PendingDecisionPanel, {
      model: pendingModel("defense-reaction"),
      viewerSeat: 0,
    }));

    expect(html).toContain('class="decision-guidance-info"');
    expect(html).toContain('class="decision decision-options decision-priority-guidance"');
    expect(html).toMatch(
      /class="decision-prompt">Defense reaction window<br\/>Play a reaction or pass<button[^>]*class="decision-guidance-info"/,
    );
    expect(html).toContain("Uncheck Show guidance in Settings, or select Disable now.");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');

    const popover = renderToStaticMarkup(createElement(GuidanceSettingsPopover, {
      onDisableGuidance: () => undefined,
    }));
    expect(popover).toContain('class="decision-guidance-disable"');
    expect(popover).toContain("disable now");
  });

  it("does not add the guidance opt-out to required decisions", () => {
    const html = renderToStaticMarkup(createElement(PendingDecisionPanel, {
      model: pendingModel("optional-effect"),
      viewerSeat: 0,
    }));

    expect(html).not.toContain("decision-guidance-info");
  });
});

describe("scripted card-choice presentation", () => {
  it("replaces a guidance dash with a line break", () => {
    const html = renderToStaticMarkup(createElement(DecisionPrompt, {
      prompt: "Command and Conquer triggers: On hit — play an instant or pass",
      breakOnDash: true,
    }));

    expect(html).toContain("Command and Conquer triggers: On hit<br/>Play an instant or pass");
    expect(html).not.toContain(" — ");
  });

  it("makes a leading card name in the prompt hover-inspectable", () => {
    const html = renderToStaticMarkup(createElement(DecisionPrompt, {
      prompt: "Reverent Rerebrace: pay 1 and destroy this?",
    }));

    expect(html).toContain('class="card-ref"');
    expect(html).toContain('data-cardid="AHA005"');
    expect(html).toContain("Reverent Rerebrace");
    expect(html).toContain(": pay 1 and destroy this?");
  });

  it("leaves prompts without a recognized card-name prefix as plain text", () => {
    const html = renderToStaticMarkup(createElement(DecisionPrompt, {
      prompt: "Choose a sword to sharpen",
    }));

    expect(html).not.toContain("data-cardid");
    expect(html).toContain("Choose a sword to sharpen");
  });

  it("renders an unpreventable-damage warning in the warning style", () => {
    const html = renderToStaticMarkup(createElement(DecisionPrompt, {
      prompt: "Warning: this damage cannot be prevented.",
    }));

    expect(html).toContain('class="decision-prompt decision-prompt-warning"');
    expect(html).toContain("Warning: this damage cannot be prevented.");
  });

  it("keeps a card choice with a decline option in the popup", () => {
    const card = { instanceId: 42, cardId: "TEST-CARD", owner: 0 };
    expect(handCardChoiceOptions({
      player: 0,
      kind: "choose-target",
      prompt: "Reveal an Earth card?",
      options: ["no", "42"],
      optionCards: [null, card],
    }, [card])).toBeNull();
  });

  it("briefly explains ordering when Opt shows multiple cards", () => {
    const html = renderToStaticMarkup(createElement(OptDecisionInstructions, { cardCount: 3 }));

    expect(html).toContain("Last Top is topmost; last Bottom is bottommost.");
    expect(html).not.toContain("Choose cards in order");
  });

  it("omits ordering instructions when Opt shows one card", () => {
    const html = renderToStaticMarkup(createElement(OptDecisionInstructions, { cardCount: 1 }));

    expect(html).toBe("");
  });

  it("keeps Opt cards in the decision when a pass option is offered", () => {
    const first = { instanceId: 51, cardId: "TEST-A", owner: 0 };
    const second = { instanceId: 52, cardId: "TEST-B", owner: 0 };
    expect(optDecisionCards({
      player: 0,
      kind: "choose-target",
      prompt: "Whisper of the Oracle: Opt 2",
      options: ["top:51", "bottom:51", "top:52", "bottom:52", "pass"],
      optionCards: [first, first, second, second, null],
    })).toEqual([
      { id: "51", card: first },
      { id: "52", card: second },
    ]);
  });
});

describe("Blood on Her Hands mode allocation", () => {
  it("groups authoritative adjustment options into three controls per weapon", () => {
    const allocation = bloodModeAllocation(bloodDecision());

    expect(allocation).not.toBeNull();
    expect(allocation?.weapons).toHaveLength(2);
    expect(allocation?.weapons[0]?.controls.map((control) => [control.mode, control.count])).toEqual([
      ["power", 1],
      ["go-again", 0],
      ["extra-attack", 0],
    ]);
    expect(allocation?.confirmOption).toBe("blood-mode:confirm:1:2");
  });

  it("renders both weapon cards with minus, count, plus controls and confirmation", () => {
    const allocation = bloodModeAllocation(bloodDecision())!;
    const html = renderToStaticMarkup(createElement(BloodModeDecision, {
      allocation,
      viewerSeat: 0,
      onChoose: () => undefined,
    }));

    expect(html.match(/card-hand/g)).toHaveLength(2);
    expect(html).toContain("Attacks get +1 power");
    expect(html).toContain("Attacks get go again");
    expect(html).toContain("May attack twice");
    expect(html).toContain("1/2");
    expect(html).toContain("Each mode may be selected up to twice across all weapons");
    expect(html).toContain("Decrease Attacks get +1 power for FIRST");
    expect(html).toContain("Increase Attacks get +1 power for FIRST");
    expect(html).toContain("Confirm Modes");
    expect(html).toMatch(/Confirm Modes<\/button>/);
  });
});

describe("boost announcement labels", () => {
  it("uses a simple Boost label when the attack can only boost once", () => {
    expect([0, 1].map((count) => boostOptionLabel(count, false))).toEqual([
      "Don't Boost",
      "Boost",
    ]);
  });

  it("keeps numbered labels when the attack can boost more than once", () => {
    expect([0, 1, 2].map((count) => boostOptionLabel(count, true))).toEqual([
      "Don't Boost",
      "Boost once",
      "Boost 2 times",
    ]);
  });
});

describe("combat-chain close confirmation", () => {
  it("explains the implicit close and offers play or cancel", () => {
    const html = renderToStaticMarkup(createElement(ChainCloseConfirmation, {
      cardId: "TEST-CARD",
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toContain("Close the combat chain?");
    expect(html).toContain("Close Chain and Play");
    expect(html).toContain("Close Chain and Play (Space)");
    expect(html).toContain('aria-keyshortcuts="Space"');
    expect(html).toContain("Cancel");
  });
});

describe("action confirmation", () => {
  it("offers an explicit commit or cancel after staging a play", () => {
    const html = renderToStaticMarkup(createElement(ActionConfirmation, {
      cardId: "TEST-CARD",
      activation: false,
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toContain("Play");
    expect(html).toContain("Play (Space)");
    expect(html).toContain('aria-keyshortcuts="Space"');
    expect(html).toContain("Cancel");
  });
});

describe("arsenal skip confirmation", () => {
  it("warns before ending the turn without an arsenal card", () => {
    const html = renderToStaticMarkup(createElement(ArsenalSkipConfirmation, {
      onConfirm: () => undefined,
      onCancel: () => undefined,
    }));

    expect(html).toContain("Skip arsenal?");
    expect(html).toContain("Skip Arsenal");
    expect(html).toContain("Cancel");
  });
});

describe("attack target choices", () => {
  it("renders targets as board-state cards with status and selection", () => {
    const html = renderToStaticMarkup(createElement(ActionTargetCards, {
      choices: [{
        id: 42,
        label: "Test Ally",
        life: 3,
        card: {
          instanceId: 42,
          cardId: "TEST-CARD",
          owner: 1,
          tapped: true,
          life: 3,
          counters: { steam: 2 },
        },
      }],
      viewerSeat: 0,
      selectedId: 42,
      selectionMade: true,
      onSelect: () => undefined,
    }));

    expect(html).toContain("aria-label=\"Target Test Ally\"");
    expect(html).toContain("aria-pressed=\"true\"");
    expect(html).toContain("card-tapped");
    expect(html).toContain("3 life");
    expect(html).toContain("2 steam counters");
  });
});

describe("revealed card choices", () => {
  it("shows the full reveal group with viewer-relative ownership borders", () => {
    const html = renderToStaticMarkup(createElement(RevealedChoiceCards, {
      cards: [
        { instanceId: 41, cardId: "FIRST", owner: 0 },
        { instanceId: 42, cardId: "SECOND", owner: 1 },
      ],
      selectableIds: new Set([42]),
      viewerSeat: 0,
      onChoose: () => undefined,
    }));

    expect(html.match(/card-hand/g)).toHaveLength(2);
    expect(html.match(/card-highlight/g)).toHaveLength(1);
    expect(html.match(/card-clickable/g)).toHaveLength(1);
    expect(html.match(/card-friendly/g)).toHaveLength(1);
    expect(html.match(/card-opponent/g)).toHaveLength(1);
  });
});

describe("simultaneous trigger ordering", () => {
  it("moves a trigger without mutating the received order", () => {
    const original = ["first", "second", "third"];
    expect(moveTriggerOrder(original, 2, 0)).toEqual(["third", "first", "second"]);
    expect(original).toEqual(["first", "second", "third"]);
  });

  it("renders draggable cards with keyboard reorder controls and one confirmation", () => {
    const html = renderToStaticMarkup(createElement(TriggerOrderDecision, {
      options: ["41:0", "42:0"],
      labels: ["Create a Might token", "Draw a card"],
      counts: [],
      cards: [
        { instanceId: 41, cardId: "IAR999", name: "Uncatalogued IAR Trigger", owner: 0 },
        { instanceId: 42, cardId: "SECOND", owner: 0 },
      ],
      viewerSeat: 0,
      onConfirm: () => undefined,
    }));

    expect(html.match(/draggable="true"/g)).toHaveLength(2);
    expect(html).toContain("The first trigger resolves first");
    expect(html).toContain("Move Uncatalogued IAR Trigger: Create a Might token later");
    expect(html).toContain(">Uncatalogued IAR Trigger<");
    expect(html).toContain("Move SECOND: Draw a card earlier");
    expect(html).toContain("Confirm Order");
    expect(html).toContain("Confirm Order (Space)");
    expect(html).toContain('aria-keyshortcuts="Space"');
  });

  it("renders consolidated Blood Debt instead of its representative source card", () => {
    const html = renderToStaticMarkup(createElement(TriggerOrderDecision, {
      options: ["41:0", "42:0"],
      labels: ["Blood Debt — lose 1 life", "Pay Loan Shark"],
      counts: [3, null],
      cards: [
        { instanceId: 41, cardId: "PEN127", owner: 0 },
        { instanceId: 42, cardId: "OUT183", owner: 0 },
      ],
      viewerSeat: 0,
      onConfirm: () => undefined,
    }));

    expect(html).toContain('aria-label="Blood Debt: lose 3 life"');
    expect(html).toContain("blood-debt-stack-amount\">3");
    expect(html).toContain("Move Blood Debt: Lose 3 life later");
    expect(html).not.toContain("Blood Debt — lose 1 life");
    expect(html).not.toContain("content.fabrary.net/cards/PEN127.webp");
  });

  it("confirms the current order with an unmodified Space press", () => {
    const confirmations: string[][] = [];
    let prevented = false;
    const event = {
      code: "Space",
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      target: null,
      preventDefault: () => { prevented = true; },
    } as KeyboardEvent;

    expect(confirmTriggerOrderOnSpace(
      event,
      ["42:0", "41:0"],
      (optionIds) => confirmations.push(optionIds),
    )).toBe(true);
    expect(prevented).toBe(true);
    expect(confirmations).toEqual([["42:0", "41:0"]]);
  });
});
