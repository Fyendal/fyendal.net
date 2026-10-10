import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MatchupPicker } from "./MatchupPicker.js";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

const matchups = [
  { id: "jarl", name: "Jarl" },
  { id: "hala", name: "Hala" },
  { id: "kassai", name: "Kassai" },
];

function render(selectedId: string | undefined, suggested: string[]): string {
  return renderToStaticMarkup(
    <TestI18nProvider>
      <MatchupPicker
        id="fabrary-matchup"
        matchups={matchups}
        selectedId={selectedId}
        suggestedIds={new Set(suggested)}
        opponentHero="Hala, Bladesaint of the Vow"
        disabled={false}
        onChoose={() => undefined}
      />
    </TestI18nProvider>,
  );
}

describe("MatchupPicker", () => {
  it("points at an unchosen suggestion from the closed control", () => {
    const html = render(undefined, ["hala"]);
    expect(html).toContain("Default deck");
    expect(html).toContain('class="matchup-tag matchup-tag-hint">Suggested: Hala<');
  });

  it("counts several unchosen suggestions", () => {
    expect(render(undefined, ["hala", "kassai"])).toContain(">2 suggested<");
  });

  it("marks a chosen suggestion", () => {
    const html = render("hala", ["hala"]);
    expect(html).toContain('title="Hala">Hala<');
    expect(html).toContain('class="matchup-tag">Suggested<');
  });

  it("shows no tag without suggestions", () => {
    expect(render("jarl", [])).not.toContain("matchup-tag");
  });
});
