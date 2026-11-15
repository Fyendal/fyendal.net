import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SandboxPanel, canOpenSandbox, sandboxCounterEdits, type SandboxSeat } from "./SandboxPanel.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const SEATS: SandboxSeat[] = [
  { seat: 0, heroName: "Dorinthea", life: 20, resources: 0 },
  { seat: 1, heroName: "Rhinar", life: 18, resources: 2 },
];

function render(overrides: Partial<ComponentProps<typeof SandboxPanel>> = {}): string {
  return renderToStaticMarkup(
    <TestI18nProvider locale="en">
      <SandboxPanel
        seats={SEATS}
        pending={false}
        refusal={null}
        onEdit={vi.fn(() => true)}
        onClearRefusal={vi.fn()}
        onClose={vi.fn()}
        {...overrides}
      />
    </TestI18nProvider>,
  );
}

describe("SandboxPanel", () => {
  it("shows a tab per seat in solo games, labelled by hero", () => {
    const html = render({ initialSeat: 1 });
    expect(html).toContain('role="tablist"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toMatch(/aria-selected="false"[^>]*>Dorinthea<\/button>/);
    expect(html).toMatch(/aria-selected="true"[^>]*>Rhinar<\/button>/);
    expect(html).toContain('value="18"');
    expect(html).toContain('value="2"');
  });

  it("shows only the viewer's seat in a private room", () => {
    const html = render({ seats: [SEATS[0]!] });
    expect(html).not.toContain('role="tab"');
    expect(html).toContain('class="sandbox-seat-name">Dorinthea</p>');
    expect(html).not.toContain("Rhinar");
    expect(html).toContain('value="20"');
    expect(html).toContain('aria-label="Increase Life"');
    expect(html).toContain('aria-label="Decrease Floating resources"');
  });

  it("disables Apply until something changes and shows a refusal reason", () => {
    const html = render({ refusal: "SANDBOX_EDIT_UNAVAILABLE" });
    expect(html).toMatch(/<button type="submit" class="btn-primary sandbox-apply" disabled="">Apply<\/button>/);
    expect(html).toContain('role="alert"');
    expect(html).toContain("That change isn&#x27;t allowed right now");
    expect(render({ refusal: "SANDBOX_SEAT_FORBIDDEN" })).toContain("You can only edit your own hero.");
  });

  it("sends only the changed counters, life first", () => {
    expect(sandboxCounterEdits(SEATS[1]!, { life: 18, resources: 2 })).toEqual([]);
    expect(sandboxCounterEdits(SEATS[1]!, { life: 9, resources: 5 })).toEqual([
      { kind: "set-life", life: 9 },
      { kind: "set-resources", resources: 5 },
    ]);
  });
});

describe("canOpenSandbox", () => {
  const live = { sandbox: true, spectating: false, replaying: false, yourSeat: 0, gameOver: false };
  it("is available only to seated players in a live sandbox game", () => {
    expect(canOpenSandbox(live)).toBe(true);
    expect(canOpenSandbox({ ...live, sandbox: false })).toBe(false);
    expect(canOpenSandbox({ ...live, spectating: true })).toBe(false);
    expect(canOpenSandbox({ ...live, replaying: true })).toBe(false);
    expect(canOpenSandbox({ ...live, yourSeat: null })).toBe(false);
    expect(canOpenSandbox({ ...live, gameOver: true })).toBe(false);
  });
});
