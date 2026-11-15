import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SandboxConvertConfirm } from "./SandboxConvertConfirm.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

function render(props: Partial<Parameters<typeof SandboxConvertConfirm>[0]> = {}): string {
  return renderToStaticMarkup(
    <TestI18nProvider locale="en">
      <SandboxConvertConfirm sending={false} refusal={null} onConfirm={vi.fn()} onCancel={vi.fn()} {...props} />
    </TestI18nProvider>,
  );
}

describe("SandboxConvertConfirm", () => {
  it("warns that the game stops counting and cannot be undone", () => {
    const html = render();
    expect(html).toContain("Turn this game into a sandbox?");
    expect(html).toContain("stop counting toward match history, stats, and achievements");
    expect(html).toContain("can&#x27;t be undone");
    expect(html).toMatch(/<button[^>]*>Cancel<\/button>/);
    expect(html).toMatch(/<button[^>]*class="btn-primary"[^>]*>Turn on sandbox<\/button>/);
    expect(html).not.toContain('role="alert"');
  });

  it("waits on the converting edit, then offers a retry after a refusal", () => {
    expect(render({ sending: true })).toMatch(/<button[^>]*disabled=""[^>]*>Turning on…<\/button>/);
    const refused = render({ sending: true, refusal: "SANDBOX_EDIT_UNAVAILABLE" });
    expect(refused).toContain('role="alert"');
    expect(refused).toMatch(/<button[^>]*class="btn-primary"(?![^>]*disabled)[^>]*>Turn on sandbox<\/button>/);
  });
});
