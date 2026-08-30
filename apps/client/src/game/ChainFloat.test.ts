import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChainLinkView } from "@fyendal/shared";
import { describe, expect, it, vi } from "vitest";
import { browseChainLink, ChainFloat, chainAttackIsActivatable } from "./ChainFloat.js";
import { chainTimelineRevision } from "./chainTimeline.js";

describe("combat-chain browsing", () => {
  it("releases pointer focus after browsing so Space can pass", () => {
    const blur = vi.fn();
    const browse = vi.fn();

    browseChainLink({ blur }, 1, browse);

    expect(browse).toHaveBeenCalledOnce();
    expect(blur).toHaveBeenCalledOnce();
  });

  it("retains focus when a chain link is activated from the keyboard", () => {
    const blur = vi.fn();
    const browse = vi.fn();

    browseChainLink({ blur }, 0, browse);

    expect(browse).toHaveBeenCalledOnce();
    expect(blur).not.toHaveBeenCalled();
  });

  it("advances the timeline revision when the newest link resolves", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 0,
      hit: false,
      resolved: false,
    };

    const attackingRevision = chainTimelineRevision([link]);
    const waitingRevision = chainTimelineRevision([{ ...link, resolved: true }]);

    expect(waitingRevision).not.toBe(attackingRevision);
  });

  it("marks the empty next link as current in the timeline", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      hit: true,
      resolved: true,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain('<button class="chain-dot chain-dot-waiting active"');
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Link 2: waiting for the next attack"');
  });

  it("composes compact context into the expanded chain header", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(
      ChainFloat,
      { links: [link], onRect: vi.fn() },
      createElement("span", null, "Reaction step · Your priority"),
    ));

    expect(html).toContain('class="chain-priority-slot"');
    expect(html).toContain("Reaction step · Your priority");
    expect(html).not.toContain('class="chain-float-title">Combat Chain');
    expect(html).toContain('aria-label="Combat chain links"');
    expect(html).toContain('class="chain-dots-title">Links');
    expect(html).not.toContain("chain-dot-index");
    expect(html).toContain('aria-label="Link 1: in progress"');
    expect(html).toContain('aria-label="Minimize combat chain"');
    expect(html).toContain("chain-hide-header");
    expect(html).toContain("chain-hide-corner");
    expect(html).not.toContain("chain-hide-timeline");
  });

  it("makes an attacking card interactive when its ability is legally activatable", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
      activatableAttackIds: new Set([42]),
      selectedAbilitySourceInstanceId: 42,
      onActivateAttack: vi.fn(),
    }));

    expect(html).toContain("card-highlight");
    expect(html).toContain("card-selected");
    expect(html).toContain("card-clickable");
  });

  it("only makes the newest unresolved appearance of an attack source interactive", () => {
    const pastLink: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      hit: true,
      resolved: true,
    };
    const currentLink = { ...pastLink, resolved: false };
    const activatable = new Set([42]);

    expect(chainAttackIsActivatable(pastLink, 0, 2, activatable)).toBe(false);
    expect(chainAttackIsActivatable(currentLink, 1, 2, activatable)).toBe(true);
    expect(chainAttackIsActivatable(pastLink, 0, 1, activatable)).toBe(false);
  });

  it("shows go again as a tooltip icon instead of a text label", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      goAgain: true,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("/icons/go-again.png");
    expect(html).toContain('role="tooltip">Go again');
    expect(html).not.toContain("c-zonelabel\">Go again");
  });

  it("renders a resolved equipment attack-reaction source beside the attack", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "OUT115", owner: 0 },
      defendingCards: [],
      reactions: [{ instanceId: 84, cardId: "OUT139", owner: 0 }],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain('data-cardid="OUT139"');
  });

  it("shows dominate as a tooltip icon instead of a text label", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      dominate: true,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("/icons/dominate.png");
    expect(html).toContain('role="tooltip">Dominate');
    expect(html).not.toContain("c-zonelabel\">Dominate");
  });

  it("shows overpower as a tooltip icon instead of a text label", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      overpower: true,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("/icons/overpower.svg");
    expect(html).toContain('role="tooltip">Overpower');
    expect(html).not.toContain("c-zonelabel\">Overpower");
  });

  it("shows a completed wager as a tooltip icon on the attacking card", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      wagered: true,
      wagerRewards: ["Winner creates Gold"],
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("/icons/wager.png");
    expect(html).toContain('role="tooltip">Wagered: Winner creates Gold');
  });

  it("shows source-attributed prevention beside total defense", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 5,
      defenseValue: 2,
      damageToPrevent: 3,
      preventionModifiers: [
        { sourceCardId: "SBL022", amount: 2 },
        { sourceCardId: "SBA016", amount: 1 },
      ],
      damage: 3,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("chain-defense-controls");
    expect(html).toContain("chain-prevent-plus");
    expect(html).toContain("chain-stat chain-prevent");
    expect(html).toContain('aria-label="Prevention: 3"');
    expect(html).toContain("Prevention modifiers");
    expect(html).toContain('data-cardid="SBL022"');
    expect(html).toContain("Toe the Line");
    expect(html).not.toContain("/icons/prevent.png");
  });

  it("does not rotate a tapped board card's combat-chain copy", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0, tapped: true },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).not.toContain("card-tapped");
  });

  it("shows the targeted ally as the defending card with its counters", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 9,
      defenseValue: 0,
      defenseModifiers: [],
      damage: 9,
      resolved: false,
      targetAllyName: "Anka, Drag Under",
      targetAlly: {
        instanceId: 84,
        cardId: "SEA262",
        owner: 1,
        life: 2,
        counters: { suspense: 2 },
      },
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("chain-atk");
    expect(html).toContain('data-cardid="SEA262"');
    expect(html).toContain("/icons/life.png");
    expect(html).toContain("2 life");
    expect(html).toContain("/icons/suspense.png");
    expect(html).toContain("2 suspense counters");
    expect(html).not.toContain(">vs<");
    expect(html).not.toContain("chain-def");
  });

  it("renders per-card modifiers as a hover and focus explanation", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 5,
      defenseValue: 0,
      attackModifiers: [{ sourceCardId: "SBA016", amount: 2 }],
      defenseModifiers: [],
      damage: 5,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("Attack modifiers");
    expect(html).toContain("chain-base-value");
    expect(html).toContain("<strong>3</strong>");
    expect(html).toContain("+2");
    expect(html).not.toContain("printed");
    expect(html).not.toContain("aria-expanded");
  });

  it("places one unblock-all bar beneath staged defenders", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 5,
      defenseValue: 0,
      damage: 5,
      resolved: false,
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
      staged: [{ instanceId: 84, cardId: "SEA262", owner: 1 }],
      stagedDefense: 3,
      onUnstage: vi.fn(),
      onUnstageAll: vi.fn(),
    }));

    expect(html).toContain("chain-defense-controls");
    expect(html).toContain("chain-unblock-all");
    expect(html).toContain("Unblock all");
    expect(html).not.toContain('class="chain-staged-remove"');
    expect(html).toContain('class="chain-staged-remove-cue" aria-hidden="true"');
  });

  it("frames attacks with source-attributed on-hit details for hover and mobile dialog", () => {
    const link: ChainLinkView = {
      attackingCard: { instanceId: 42, cardId: "SBA016", owner: 0 },
      defendingCards: [],
      reactions: [],
      attackValue: 3,
      defenseValue: 0,
      damage: 3,
      resolved: false,
      onHitEffects: [{
        sourceCardId: "SBA016",
        text: "When this hits a hero, deal 1 arcane damage to them.",
      }],
    };
    const html = renderToStaticMarkup(createElement(ChainFloat, {
      links: [link],
      onRect: vi.fn(),
    }));

    expect(html).toContain("chain-on-hit-label");
    expect(html).toContain("On hit");
    expect(html).toContain("On-hit effects");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("When this hits a hero, deal 1 arcane damage to them.");
    expect(html).toContain("data-cardid=\"SBA016\"");
  });
});
