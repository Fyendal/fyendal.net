import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import {
  VersionUpdateBody, VersionUpdateDialog, VersionUpdateModal, seenUpdate, versionUpdateSeenKey,
} from "./VersionUpdateModal.js";

const renderBody = (markdown: string) =>
  renderToStaticMarkup(<TestI18nProvider><VersionUpdateBody markdown={markdown} /></TestI18nProvider>);

describe("VersionUpdateModal", () => {
  it("scopes dismissal to account and publication", () => {
    expect(versionUpdateSeenKey("Alice", "first")).toBe(versionUpdateSeenKey("ALICE", "first"));
    expect(versionUpdateSeenKey("Alice", "second")).not.toBe(versionUpdateSeenKey("Alice", "first"));
    expect(versionUpdateSeenKey("Bob", "first")).not.toBe(versionUpdateSeenKey("Alice", "first"));
    const seen = new Map([[versionUpdateSeenKey("Alice", "first"), "1"]]);
    vi.stubGlobal("localStorage", { getItem: (key: string) => seen.get(key) ?? null });
    expect(seenUpdate("ALICE", "first")).toBe(true);
    expect(seenUpdate("Alice", "second")).toBe(false);
    expect(seenUpdate("Bob", "first")).toBe(false);
    vi.unstubAllGlobals();
  });
  it("does not show a modal before the home-tab update is fetched", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    const html = renderToStaticMarkup(<TestI18nProvider><VersionUpdateModal username="Alice" /></TestI18nProvider>);
    expect(html).toBe("");
    vi.unstubAllGlobals();
  });
  it("renders Markdown while ignoring HTML, untrusted images, and unsafe links", () => {
    const html = renderBody('## Features\n\n- **Improved** play\n\n<script>alert(1)</script>\n\n![image](https://example.com/track.png)\n\n[unsafe](javascript:alert(1)) [Join us on Discord](https://discord.gg/DpTjVbfPVv)');
    expect(html).toContain("<h2>Features</h2>");
    expect(html).toContain("<strong>Improved</strong>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a class="version-update-discord-link" href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer"><svg class="version-update-discord-icon"');
    expect(html).toContain('Join us on Discord</a>');
  });
  it("renders allowlisted screenshots with reserved size, caption, and a full-size link", () => {
    const html = renderBody('![The new deck grid](/updates/2026-10-18/deck-grid.1280x720.webp "Decks now show as a grid")');
    expect(html).toContain('<span class="version-update-figure version-update-figure-screenshot">');
    expect(html).toContain('<a class="version-update-image-link" href="/updates/2026-10-18/deck-grid.1280x720.webp" target="_blank" rel="noopener noreferrer">');
    expect(html).toContain('alt="The new deck grid" width="1280" height="720" loading="lazy" decoding="async"');
    expect(html).toContain("Open full-size image");
    expect(html).toContain('<span class="version-update-figure-caption">Decks now show as a grid</span>');
    expect(html).not.toContain("title=");
  });
  it("renders Fabrary card art without a full-size link", () => {
    const html = renderBody('![Snatch](https://content.fabrary.net/cards/WTR167.webp)');
    expect(html).toContain('<span class="version-update-figure version-update-figure-card"><img class="version-update-image" src="https://content.fabrary.net/cards/WTR167.webp" alt="Snatch" width="450" height="628"');
    expect(html).not.toContain("<a ");
  });
  it("drops images without alt text or outside the allowlist", () => {
    const html = renderBody('![](/updates/release/shot.1280x720.webp)\n\n![Tracker](https://example.com/t.png)\n\n![Inline](data:image/png;base64,AAAA)\n\n![Unsized](/updates/release/shot.webp)');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("version-update-figure");
  });
  it("adds the Discord mark only to Discord links", () => {
    const html = renderBody('[Discord](https://discord.com/invite/example) [Website](https://example.com) [Impostor](https://discord.gg.evil.example)');
    expect(html.match(/version-update-discord-icon/g)).toHaveLength(1);
    expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">Website</a>');
    expect(html).toContain('<a href="https://discord.gg.evil.example" target="_blank" rel="noopener noreferrer">Impostor</a>');
  });
  it("shows the update time and one visible dismissal control", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <VersionUpdateDialog
          notice={{ id: "test", version: "2.0", markdown: "## New features", publishedAt: 1_700_000_000_000 }}
          onDismiss={vi.fn()}
        />
      </TestI18nProvider>,
    );
    expect(html).toContain("Fyendal 2.0");
    expect(html).toContain("Version update");
    expect(html).toContain("Updated ");
    expect(html).toContain('dateTime="2023-11-14T22:13:20.000Z"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).not.toContain("modal-surface-close");
  });
});
