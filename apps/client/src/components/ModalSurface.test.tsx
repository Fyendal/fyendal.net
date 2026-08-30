import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ModalSurface } from "./ModalSurface.js";

describe("ModalSurface", () => {
  it("labels the dialog and always provides an explicit close control", () => {
    const html = renderToStaticMarkup(createElement(
      ModalSurface,
      { title: "Deck Actions", onClose: vi.fn(), description: "Choose an action." },
      createElement("button", null, "Play"),
    ));

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Close Deck Actions"');
    expect(html).toContain("Choose an action.");
  });
});
