import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PlaymatHintToast } from "./PlaymatHintToast.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { PLAYMAT_IDS } from "../playmats.js";

describe("playmat hint toast", () => {
  it("makes the plaque the offer, with a labelled dismiss beside it", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <PlaymatHintToast onChoose={vi.fn()} onDismiss={vi.fn()} />
      </TestI18nProvider>,
    );

    expect(html).toContain('class="playmat-hint" role="status"');
    expect(html.match(/<img src="\/playmats\/thumbs\/[a-z-]+\.jpg" alt=""/g)).toHaveLength(3);
    expect(html).toContain('<span class="playmat-hint-title">Try a playmat</span>');
    expect(html).toContain(`${PLAYMAT_IDS.length - 1} playmats are ready to battle on.`);
    expect(html).toContain('class="playmat-hint-close" aria-label="Not now"');
  });

  it("renders in every locale", () => {
    for (const locale of ["zh-Hans", "pt-BR", "es"] as const) {
      const html = renderToStaticMarkup(
        <TestI18nProvider locale={locale}>
          <PlaymatHintToast onChoose={vi.fn()} onDismiss={vi.fn()} />
        </TestI18nProvider>,
      );
      expect(html).not.toContain("game.playmatHint");
    }
  });
});
