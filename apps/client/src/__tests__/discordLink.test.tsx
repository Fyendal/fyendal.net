import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import { DiscordLink } from "../lobby/DiscordLink.js";

describe("Discord community link", () => {
  it("renders an accessible icon link that opens in a new tab", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <DiscordLink />
      </TestI18nProvider>,
    );

    expect(html).toContain('href="https://discord.gg/DpTjVbfPVv"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-label="Join the Fyendal Discord community (opens in a new tab)"');
    expect(html).toContain('aria-hidden="true"');
  });
});
