import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CardBack,
  CardFace,
  InactiveZoneCard,
  cardImageUrl,
  cardPreviewSize,
} from "./Card.js";
import { resolveCardImageUrls } from "./cardImageUrl.js";

describe("cardImageUrl", () => {
  it.each(["ARC112", "CRU157", "DYN191", "SBA036", "ROS162"])(
    "uses one stable Runechant art for %s",
    (printingId) => {
      expect(cardImageUrl(printingId)).toBe("https://content.fabrary.net/cards/ARC112.webp");
    },
  );

  it.each(["APS032", "FAB395", "SUP241"])(
    "uses the dedicated upright Toughness art for %s",
    (printingId) => {
      expect(cardImageUrl(printingId)).toBe("https://content.fabrary.net/cards/APS032.webp");
    },
  );

  it.each([
    ["AOL004", "AOL004-RF"],
    ["AOL005", "AOL005-RF"],
    ["AOL006", "AOL006-RF"],
    ["AMA001", "AMA001-RF"],
    ["AMA002", "AMA002-RF"],
    ["AMA003", "AMA003-RF"],
    ["AMA005", "AMA005-RF"],
    ["AMA006", "AMA006-RF"],
    ["AMO001", "AMO001-RF"],
    ["AZS001", "AZS001-RF"],
    ["AZS002", "AZS002-RF"],
    ["FAB337", "SEA080"],
    ["FAB464", "FAB464-MV"],
    ["FAB469", "FAB469-CF"],
    ["FAB477", "FAB477-RF"],
    ["IAR083", "AMA026"],
    ["IAR091", "IAR091-RF"],
    ["IAR222", "IAR222-MV"],
    ["JDG062", "JDG062-CF"],
    ["OMN000", "OMN000-RF"],
    ["OMN141", "OMN141-RF"],
    ["ROS257", "AJV028"],
  ])("uses Fabrary's available image object for %s", (printingId, imageId) => {
    expect(cardImageUrl(printingId)).toBe(`https://content.fabrary.net/cards/${imageId}.webp`);
  });

  it.each([
    ["ELE202B", "ELE202"],
    ["WTR075B", "WTR075"],
    ["DTD005B", "DTD005_BACK"],
    ["MST000B", "MST000_BACK"],
    ["AMX022B", "AMX022_BACK"],
  ])("maps backside printing %s to Fabrary's image object", (printingId, imageId) => {
    expect(cardImageUrl(printingId)).toBe(`https://content.fabrary.net/cards/${imageId}.webp`);
  });

  it("uses the printing ID directly when no override is needed", () => {
    expect(cardImageUrl("WTR160")).toBe("https://content.fabrary.net/cards/WTR160.webp");
  });

  it("tries temporary Fabrary variants for an IAR printing", () => {
    expect(resolveCardImageUrls("IAR084", undefined)).toEqual([
      "https://content.fabrary.net/cards/IAR084.webp",
      "https://content.fabrary.net/cards/IAR084-RF.webp",
      "https://content.fabrary.net/cards/IAR084-CF.webp",
      "https://content.fabrary.net/cards/IAR084-MV.webp",
    ]);
  });

  it("keeps a verified IAR override first without duplicate candidates", () => {
    expect(resolveCardImageUrls("IAR222", undefined)).toEqual([
      "https://content.fabrary.net/cards/IAR222-MV.webp",
      "https://content.fabrary.net/cards/IAR222.webp",
      "https://content.fabrary.net/cards/IAR222-RF.webp",
      "https://content.fabrary.net/cards/IAR222-CF.webp",
    ]);
  });
});

describe("cardPreviewSize", () => {
  it("grows with the viewport while preserving the source aspect ratio", () => {
    expect(cardPreviewSize(800)).toEqual({ width: 296, height: 413 });
    expect(cardPreviewSize(1440)).toEqual({ width: 516, height: 720 });
    expect(cardPreviewSize(2160)).toEqual({ width: 774, height: 1080 });
  });
});

describe("CardBack", () => {
  it("uses the real Flesh and Blood card-back image", () => {
    const html = renderToStaticMarkup(createElement(CardBack, { label: "Deck", count: 40 }));

    expect(html).toContain("https://content.fabrary.net/cards/cardback.webp");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(">Deck<");
    expect(html).toContain(">40<");
  });

  it("uses the same card back when a card identity is hidden", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: -1, cardId: "", owner: 1, hidden: true },
    }));

    expect(html).toContain("https://content.fabrary.net/cards/cardback.webp");
    expect(html).toContain("Face down");
  });

  it("keeps motion geometry keys on both visible and hidden presentations", () => {
    const visible = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 7, cardId: "SBA016", owner: 0 },
      motionKey: "0:hand:7",
    }));
    const hidden = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 8, cardId: "", owner: 1, hidden: true },
      motionKey: "1:arsenal:8",
    }));

    expect(visible).toContain('data-motion-card="0:hand:7"');
    expect(hidden).toContain('data-motion-card="1:arsenal:8"');
  });

  it("uses native button semantics when it is interactive", () => {
    const interactive = renderToStaticMarkup(createElement(CardBack, {
      label: "Deck",
      onClick: () => undefined,
    }));
    const staticCard = renderToStaticMarkup(createElement(CardBack, { label: "Deck" }));

    expect(interactive).toContain('<button type="button" class="card-action" aria-label="Deck"');
    expect(staticCard).toContain('<div class="card card-zone card-back ');
  });
});

describe("CardFace payment state", () => {
  it("uses native button semantics when it is interactive", () => {
    const interactive = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 1, cardId: "TEST-CARD", owner: 0 },
      onClick: () => undefined,
    }));
    const staticCard = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 2, cardId: "TEST-CARD", owner: 0 },
    }));

    expect(interactive).toContain('<button type="button" class="card-action" aria-label="TEST-CARD"');
    expect(staticCard).toContain('<div class="card card-hand');
  });

  it("uses the projected name when the client catalog does not know a printing", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 99, cardId: "IAR999", name: "Future IAR Card", owner: 0 },
    }));

    expect(html).toContain('alt="Future IAR Card"');
    expect(html).not.toContain('alt="IAR999"');
  });

  it("marks a pitched card separately from the played-card selection", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 1, cardId: "TEST-CARD", owner: 0 },
      pitched: true,
    }));

    expect(html).toContain("card-pitched");
    expect(html).not.toContain("card-selected");
  });

  it("can present a tapped card without rotating a non-board copy", () => {
    const card = { instanceId: 2, cardId: "TEST-CARD", owner: 0, tapped: true } as const;
    const boardHtml = renderToStaticMarkup(createElement(CardFace, { card }));
    const copyHtml = renderToStaticMarkup(createElement(CardFace, { card, showTapped: false }));

    expect(boardHtml).toContain("card-tapped");
    expect(copyHtml).not.toContain("card-tapped");
  });
});

describe("CardFace explanations", () => {
  it("anchors an unavailable-card explanation to hover and keyboard focus", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0 },
      dimmed: true,
      explanation: "This card can't be played during defense reactions.",
    }));

    expect(html).toContain("card-explained");
    expect(html).toContain("card-explanation-42");
    expect(html).toContain("tabindex=\"0\"");
    expect(html).toContain("role=\"tooltip\"");
    expect(html).not.toContain("card-clickable");
  });
});

describe("CardFace counter icons", () => {
  it("renders effective go again as an icon with an accessible tooltip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0 },
      goAgain: true,
    }));

    expect(html).toContain("/icons/go-again.png");
    expect(html).toContain('role="tooltip">Go again');
    expect(html).toContain("card-counter-42-goagain");
    expect(html).toContain('tabindex="0"');
  });

  it("renders effective dominate as an icon with an accessible tooltip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0 },
      dominate: true,
    }));

    expect(html).toContain("/icons/dominate.png");
    expect(html).toContain('role="tooltip">Dominate');
    expect(html).toContain("card-counter-42-dominate");
    expect(html).toContain('tabindex="0"');
  });

  it("renders effective overpower as an icon with an accessible tooltip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0 },
      overpower: true,
    }));

    expect(html).toContain("/icons/overpower.svg");
    expect(html).toContain('role="tooltip">Overpower');
    expect(html).toContain("card-counter-42-overpower");
    expect(html).toContain('tabindex="0"');
  });

  it("uses the standard card overlay placement for visible and hidden intimidated cards", () => {
    const visibleHtml = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0, intimidated: true },
    }));
    const hiddenHtml = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 43, cardId: "", owner: 1, hidden: true, intimidated: true },
    }));

    for (const html of [visibleHtml, hiddenHtml]) {
      expect(html).toContain('class="c-ovls"');
      expect(html).toContain('class="c-ovl c-intimidated"');
      expect(html).toContain("/icons/intimidated.png");
      expect(html).toContain('role="tooltip">Intimidated — returns to hand at the beginning of the end phase');
      expect(html).toContain('tabindex="0"');
    }
  });

  it("can suppress status and counter icons for pile-zone presentations", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 42,
        cardId: "SBA016",
        owner: 0,
        intimidated: true,
        counters: { energy: 2 },
      },
      showOverlays: false,
    }));

    expect(html).not.toContain("card-countered");
    expect(html).not.toContain('class="c-ovls"');
    expect(html).not.toContain("/icons/intimidated.png");
    expect(html).not.toContain("/icons/bolt.webp");
  });

  it("renders an explicit face-up hint only when requested by the zone", () => {
    const card = { instanceId: 42, cardId: "SBA016", owner: 0 } as const;
    const faceUpHtml = renderToStaticMarkup(createElement(CardFace, {
      card,
      showFaceUp: true,
    }));
    const defaultHtml = renderToStaticMarkup(createElement(CardFace, { card }));

    expect(faceUpHtml).toContain("/icons/face-up.png");
    expect(faceUpHtml).toContain('role="tooltip">Face up');
    expect(faceUpHtml).toContain("card-counter-42-faceup");
    expect(defaultHtml).not.toContain("/icons/face-up.png");
  });

  it("renders a completed wager as an icon with an accessible tooltip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: { instanceId: 42, cardId: "SBA016", owner: 0 },
      wagered: true,
      wagerRewards: ["Winner creates Gold"],
    }));

    expect(html).toContain("/icons/wager.png");
    expect(html).toContain('role="tooltip">Wagered: Winner creates Gold');
    expect(html).toContain("card-counter-42-wagered");
    expect(html).toContain('tabindex="0"');
  });

  it("renders an attacked marker with the sword icon", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 42,
        cardId: "AZS017",
        owner: 0,
        counters: { attacked: 1 },
      },
    }));

    expect(html).toContain("/icons/sword.svg");
    expect(html).toContain("role=\"tooltip\">Has attacked since the start of its controller&#x27;s last turn");
    expect(html).toContain("card-counter-42-attacked");
  });

  it("renders steam and energy counters over their icons instead of text chips", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 43,
        cardId: "WTR160",
        owner: 0,
        counters: { steam: 2, energy: 3 },
      },
    }));

    expect(html).toContain("/icons/gear.png");
    expect(html).toContain("2 steam counters");
    expect(html).toContain("/icons/bolt.webp");
    expect(html).toContain("3 energy counters");
    expect(html).toContain("card-countered");
    expect(html).toContain("card-counter-43-steamc");
    expect(html).toContain("card-counter-43-energyc");
    expect(html.match(/role="tooltip"/g)).toHaveLength(2);
    expect(html.match(/tabindex="0"/g)).toHaveLength(2);
    expect(html).not.toContain("title=");
    expect(html).not.toContain("2 steam</div>");
    expect(html).not.toContain("3 energy</div>");
  });

  it("renders suspense counters over the suspense icon instead of a text chip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 49,
        cardId: "APS011",
        owner: 0,
        counters: { suspense: 2 },
      },
    }));

    expect(html).toContain("/icons/suspense.png");
    expect(html).toContain("2 suspense counters");
    expect(html).toContain("card-counter-49-suspensec");
    expect(html).not.toContain("2 suspense</div>");
  });

  it("renders verse counters over the verse icon instead of a text chip", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 50,
        cardId: "SEA012",
        owner: 0,
        counters: { verse: 3 },
      },
    }));

    expect(html).toContain("/icons/verse.png");
    expect(html).toContain("3 verse counters");
    expect(html).toContain("card-counter-50-versec");
    expect(html).not.toContain("3 verse</div>");
  });

  it("renders Holo as a binary icon without a number", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 51,
        cardId: "SEA012",
        owner: 0,
        counters: { holo: 3 },
      },
    }));

    expect(html).toContain("/icons/holo.png");
    expect(html).toContain('role="tooltip">Holo');
    expect(html).toContain("card-counter-51-holo");
    expect(html).not.toContain("3 holo");
    expect(html).not.toContain('class="c-ovl-num"');
  });

  it("does not render Holo when the counter is absent", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 52,
        cardId: "SEA012",
        owner: 0,
        counters: { holo: 0 },
      },
    }));

    expect(html).not.toContain("/icons/holo.png");
    expect(html).not.toContain("card-counter-52-holo");
  });

  it.each([
    [2, "+2"],
    [-1, "−1"],
  ] as const)("renders an arcane modifier of %s with its sign", (modifier, label) => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 44,
        cardId: "ARC119",
        owner: 0,
        counters: { arcaneBonus: modifier },
      },
    }));

    expect(html).toContain("/icons/arcane.png");
    expect(html).toContain(`${label} arcane damage`);
    expect(html).not.toContain("arcaneBonus");
  });

  it.each([
    "fused",
    "fusedEarth",
    "fused:ice",
  ] as const)("renders any truthy %s state as one icon without a number", (counter) => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 45,
        cardId: "ELE007",
        owner: 0,
        counters: { [counter]: 1 },
      },
    }));

    expect(html.match(/\/icons\/fuse\.png/g)).toHaveLength(1);
    expect(html).toContain('role="tooltip">Fused');
    expect(html).not.toMatch(/>1 fused/);
  });

  it("does not render the fuse icon for a false fusion state", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 46,
        cardId: "ELE007",
        owner: 0,
        counters: { fused: 0 },
      },
    }));

    expect(html).not.toContain("/icons/fuse.png");
  });

  it("renders rules counters but hides card-script bookkeeping", () => {
    const html = renderToStaticMarkup(createElement(CardFace, {
      card: {
        instanceId: 48,
        cardId: "DYN090",
        owner: 0,
        counters: {
          aim: 1,
          harpoonX: 2,
          "harpoonReveal:0": 147,
          "harpoonReveal:1": 226,
        },
      },
    }));

    expect(html).toContain("1 aim");
    expect(html).not.toContain("harpoonX");
    expect(html).not.toContain("harpoonReveal");
    expect(html).not.toContain("147");
    expect(html).not.toContain("226");
  });
});

describe("InactiveZoneCard", () => {
  it("presents an owner-visible face-down card as a card back", () => {
    const html = renderToStaticMarkup(createElement(InactiveZoneCard, {
      card: { instanceId: 47, cardId: "WTR160", owner: 0, faceDown: true },
    }));

    expect(html).toContain("card-back");
    expect(html).toContain("Face down");
    expect(html).not.toContain("WTR160.webp");
  });

  it("reveals the owner's intimidated card with its icon in an expanded zone list", () => {
    const html = renderToStaticMarkup(createElement(InactiveZoneCard, {
      card: {
        instanceId: 48,
        cardId: "WTR160",
        owner: 0,
        faceDown: true,
        intimidated: true,
      },
      revealOwnerIntimidated: true,
    }));

    expect(html).toContain("WTR160.webp");
    expect(html).toContain('class="c-ovl c-intimidated"');
    expect(html).toContain("/icons/intimidated.png");
    expect(html).not.toContain("card-back");
  });

  it("keeps an opponent's intimidated card face down while showing its public icon", () => {
    const html = renderToStaticMarkup(createElement(InactiveZoneCard, {
      card: {
        instanceId: -1,
        cardId: "",
        owner: 1,
        faceDown: true,
        hidden: true,
        intimidated: true,
      },
      revealOwnerIntimidated: true,
    }));

    expect(html).toContain("card-back");
    expect(html).toContain('class="c-ovl c-intimidated"');
    expect(html).toContain("/icons/intimidated.png");
    expect(html).not.toContain("WTR160.webp");
  });

  it("keeps the pile-top card face down and icon-free", () => {
    const html = renderToStaticMarkup(createElement(InactiveZoneCard, {
      card: {
        instanceId: 49,
        cardId: "WTR160",
        owner: 0,
        faceDown: true,
        intimidated: true,
      },
      showOverlays: false,
    }));

    expect(html).toContain("card-back");
    expect(html).not.toContain("WTR160.webp");
    expect(html).not.toContain("/icons/intimidated.png");
  });
});
