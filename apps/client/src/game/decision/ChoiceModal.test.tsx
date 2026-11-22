import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardView } from "@fyendal/shared";
import { TestI18nProvider } from "../../i18n/TestI18nProvider.js";
import { ChoiceList } from "./ChoiceModal.js";

const card = (instanceId: number, cardId: string, name: string): CardView =>
  ({ instanceId, cardId, name, owner: 0 }) as CardView;

describe("ChoiceList", () => {
  it("draws the cards an option lets the player play in that option's row", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <ChoiceList
          options={[
            { key: "X = 2", label: "X = 2", enabledCards: [card(5, "ARC128", "Aether Spindle")], onChoose: () => undefined },
            { key: "pass", label: "Pass", onChoose: () => undefined },
          ]}
        />
      </TestI18nProvider>,
    );

    expect(html.match(/decision-choice-enables/g)).toHaveLength(1);
    expect(html.match(/data-card-instance-id="5"/g)).toHaveLength(1);
    expect(html).toContain("Aether Spindle");
  });
});
