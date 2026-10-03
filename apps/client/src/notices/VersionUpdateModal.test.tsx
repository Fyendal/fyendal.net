import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";
import {
  VersionUpdateBody, VersionUpdateDialog, VersionUpdateModal, seenUpdate, versionUpdateSeenKey,
} from "./VersionUpdateModal.js";

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
  it("renders Markdown while ignoring HTML, images, and unsafe links", () => {
    const html = renderToStaticMarkup(<VersionUpdateBody markdown={'## Features\n\n- **Improved** play\n\n<script>alert(1)</script>\n\n![image](https://example.com/track.png)\n\n[unsafe](javascript:alert(1)) [Join us on Discord](https://discord.gg/DpTjVbfPVv)'} />);
    expect(html).toContain("<h2>Features</h2>");
    expect(html).toContain("<strong>Improved</strong>");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<a class="version-update-discord-link" href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer"><svg class="version-update-discord-icon"');
    expect(html).toContain('Join us on Discord</a>');
  });
  it("adds the Discord mark only to Discord links", () => {
    const html = renderToStaticMarkup(<VersionUpdateBody markdown={'[Discord](https://discord.com/invite/example) [Website](https://example.com) [Impostor](https://discord.gg.evil.example)'} />);
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
