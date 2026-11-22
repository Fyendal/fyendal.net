import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArenaGapsConfirm } from "./ArenaGapsConfirm.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("arena gaps confirmation", () => {
  it("names every empty zone and defaults focus to going back", () => {
    const html = renderToStaticMarkup(createElement(TestI18nProvider, null, createElement(ArenaGapsConfirm, {
      gaps: ["weapon", "legs"],
      onConfirm: () => {},
      onCancel: () => {},
    })));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Nothing selected for weapon and legs.");
    expect(html).toContain(">Go back</button>");
    expect(html).toContain('class="btn-primary">Lock anyway</button>');
  });
});
