import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TestI18nProvider } from "../i18n/TestI18nProvider.js";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

let BackgroundMatchOfferView: typeof import("./BackgroundMatchOffer.js").BackgroundMatchOfferView;
let BackgroundMatchSearch: typeof import("./BackgroundMatchSearch.js").BackgroundMatchSearch;

beforeAll(async () => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  ({ BackgroundMatchOfferView } = await import("./BackgroundMatchOffer.js"));
  ({ BackgroundMatchSearch } = await import("./BackgroundMatchSearch.js"));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

function renderSearch(placement: "rail" | "menu"): string {
  return renderToStaticMarkup(
    <TestI18nProvider>
      <BackgroundMatchSearch placement={placement} onStop={vi.fn()} />
    </TestI18nProvider>,
  );
}

describe("background matchmaking UI", () => {
  it("renders background searching as a compact rail control", () => {
    const html = renderSearch("rail");

    expect(html).toContain("background-match-search background-match-rail");
    expect(html).toContain("Searching for a real player while you practice…");
    expect(html).toContain(">Stop searching</button>");
  });

  it("renders searching inside the mobile More menu", () => {
    expect(renderSearch("menu")).toContain("background-match-search background-match-menu");
  });

  it("renders an actionable offer as a separate popup", () => {
    const html = renderToStaticMarkup(
      <TestI18nProvider>
        <BackgroundMatchOfferView
          offer={{
            state: "offer",
            format: "cc",
            roomCode: "PVP123",
            deadlineAt: Date.now() + 30_000,
            opponent: { username: "BravoFan", heroId: "HERO01", heroName: "Bravo" },
            acceptedByYou: false,
            opponentAccepted: false,
          }}
          onAccept={vi.fn()}
          onDecline={vi.fn()}
        />
      </TestI18nProvider>,
    );

    expect(html).toContain("background-match-offer");
    expect(html).toContain("Player found");
    expect(html).toContain("BravoFan — Bravo");
    expect(html).toContain("Accept");
    expect(html).toContain("Keep playing bot");
  });
});
