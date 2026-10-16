import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { EffectChoiceDecision } from "./EffectChoiceDecision.js";

const card = (instanceId: number, cardId: string, name: string): CardView =>
  ({ instanceId, cardId, name, owner: 0 }) as CardView;

describe("EffectChoiceDecision", () => {
  it("renders one row per source card with its localized effect", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <EffectChoiceDecision
          options={["optional-friendly:41", "optional-friendly:42", "none"]}
          labels={["Banish?", "Destroy?", "Create Frostbite normally"]}
          messages={[
            { id: "card.pen.smolderingsteel.replacement" },
            null,
            { id: "engine.decision.token.option.none", values: { card: { kind: "card", cardId: "X" } } },
          ]}
          cards={[card(41, "PEN251", "Smoldering Steel"), card(42, "PEN253", "Smoldering Scales"), null]}
          viewerSeat={0}
          onChoose={() => undefined}
        />
      </TestI18nProvider>,
    );

    expect(html.match(/class="trigger-order-item effect-choice-item"/g)).toHaveLength(2);
    expect(html).toContain("Banish this from your graveyard instead of creating Frostbite");
    expect(html).toContain("Destroy?");
    expect(html).toContain('aria-label="Apply Smoldering Steel: Banish this from your graveyard');
    // The card-less decline option sits in the button row beneath the list.
    expect(html).toMatch(/<div class="decision-buttons"><button[^>]*>Create X normally<\/button><\/div>/);
  });
});
