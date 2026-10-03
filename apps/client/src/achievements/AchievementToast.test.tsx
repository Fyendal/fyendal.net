import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { AchievementToast } from "./AchievementToast.js";

it("shows the percentage of players with the unlocked achievement", () => {
  const render = (percent: number | null) => renderToStaticMarkup(
    <TestI18nProvider>
      <AchievementToast achievements={["first-victory", "first-bot-win"]} percent={percent}
        exiting={false} onViewAchievements={vi.fn()} />
    </TestI18nProvider>,
  );
  expect(render(4.2)).toContain("4.2% of players");
  expect(render(.05)).toContain("&lt;0.1% of players");
  expect(render(null)).not.toContain("% of players");
  expect(render(4.2)).toContain('aria-label="View all achievements"');
  expect(render(4.2)).toContain('>View all</button>');
  expect(render(4.2)).not.toContain('achievement-toast-dismiss');
});
