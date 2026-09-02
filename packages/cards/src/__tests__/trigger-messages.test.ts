import type { CardScript } from "@fyendal/engine";
import { describe, expect, it } from "vitest";
import { registry } from "../scripts/index.js";
import { withCommonTriggerMessages } from "../trigger-messages.js";

const specializedTriggerLabels = new Set([
  // Rendered by BloodDebtTriggerTile with its own semantic life-loss message.
  "Blood Debt — lose 1 life",
]);

describe("card trigger presentation", () => {
  it("enriches shared labels without mutating card behavior or explicit metadata", () => {
    const effect = () => undefined;
    const script: CardScript = {
      triggers: [
        { event: "start-of-turn", label: "Gain go again", effect },
        {
          event: "end-of-turn",
          label: "Draw a card",
          labelMessage: { id: "card.test.explicit" },
          effect,
        },
      ],
    };

    const enriched = withCommonTriggerMessages(script);

    expect(enriched).not.toBe(script);
    expect(script.triggers?.[0]?.labelMessage).toBeUndefined();
    expect(enriched.triggers?.[0]).toMatchObject({
      label: "Gain go again",
      labelMessage: { id: "card.trigger.common.goagain.gain" },
      effect,
    });
    expect(enriched.triggers?.[1]?.labelMessage).toEqual({ id: "card.test.explicit" });
  });

  it("does not allow the untranslated trigger backlog to grow", () => {
    const untranslated = Object.values(registry)
      .flatMap((script) => script.triggers ?? [])
      .filter((trigger) =>
        !trigger.labelMessage && !specializedTriggerLabels.has(trigger.label)
      );

    expect(untranslated).toHaveLength(118);
    expect(new Set(untranslated.map((trigger) => trigger.label))).toHaveLength(118);
  });
});
