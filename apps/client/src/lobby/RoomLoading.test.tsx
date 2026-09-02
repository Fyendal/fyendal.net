import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomLoading } from "./RoomLoading.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

describe("RoomLoading", () => {
  it("describes saved-room recovery without implying an opponent is absent", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider><RoomLoading roomCode="ABC123" /></TestI18nProvider>,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Restoring Game…");
    expect(html).toContain("Loading the latest room state.");
    expect(html).toContain("ABC123");
    expect(html).not.toContain("Waiting for opponent");
  });
});
