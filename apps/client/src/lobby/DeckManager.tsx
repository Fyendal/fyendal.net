import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { FormatBadge, FORMAT_LABELS } from "./FormatBadge.js";
import { deckErrorMessages } from "./deckErrors.js";

/**
 * Saved decks: import directly from a Fabrary URL or from export text,
 * inspect, delete. Strict server-side validation reports unknown or
 * not-yet-implemented cards here.
 */
export function DeckManager() {
  const { decks, importDeck, deleteDeck, authUser, setError } = useStore(
    useShallow((state) => ({
      decks: state.decks,
      importDeck: state.importDeck,
      deleteDeck: state.deleteDeck,
      authUser: state.authUser,
      setError: state.setError,
    })),
  );
  const [name, setName] = useState("");
  const [format, setFormat] = useState<"cc" | "silver-age">("cc");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);

  if (!authUser) {
    return (
      <div className="panel">
        <h2 className="panel-title">My Decks</h2>
        <p className="muted">log in to import and manage decks</p>
      </div>
    );
  }

  const submit = async () => {
    setBusy(true);
    setResult(null);
    const r = await importDeck({ name, format, url: url || undefined, text: text || undefined });
    setBusy(false);
    if (r.ok) {
      setResult({ ok: true, lines: [`imported "${r.deck.name}" — ${r.deck.deckSize} cards, ${r.deck.heroName}`] });
      setName("");
      setUrl("");
      setText("");
      return;
    }
    setResult({ ok: false, lines: deckErrorMessages(r, "import failed") });
  };

  return (
    <div className="panel">
      <h2 className="panel-title">My Decks</h2>
      {decks.length === 0 ? (
        <p className="muted">no decks yet — import one below</p>
      ) : (
        <table className="room-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Format</th>
              <th>Hero</th>
              <th>Cards</th>
              <th>Legality</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {decks.map((d) => (
              <tr key={d.id}>
                <td>
                  {d.fabraryUrl ? (
                    <a href={d.fabraryUrl} target="_blank" rel="noreferrer" className="deck-link">
                      {d.name}
                    </a>
                  ) : (
                    d.name
                  )}
                </td>
                <td>
                  <FormatBadge format={d.format} />
                </td>
                <td>{d.heroName}</td>
                <td>{d.deckSize}</td>
                <td className="deck-legality-cell">
                  {d.bannedCards?.length && d.futureCards?.length
                    ? "Banned + future cards"
                    : d.bannedCards?.length
                      ? "Banned cards"
                      : d.futureCards?.length
                        ? "Future cards"
                        : "Current"}
                </td>
                <td className="room-actions">
                  <button
                    onClick={() => {
                      void deleteDeck(d.id).then((deleted) => {
                        if (!deleted.ok) setError(deleted.error);
                      });
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="deck-import">
        <summary>Import a deck from Fabrary</summary>
        <p className="muted">
          Paste a public Fabrary deck URL. You can also paste <em>Copy decklist</em> text below.
          The deck is saved to your account and validated against the implemented card pool.
        </p>
        <div className="deck-import-form">
          <div className="lobby-row">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Deck name"
              className="grow"
            />
            <select value={format} onChange={(e) => setFormat(e.target.value as "cc" | "silver-age")}>
              <option value="cc">{FORMAT_LABELS.cc}</option>
              <option value="silver-age">{FORMAT_LABELS["silver-age"]}</option>
            </select>
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://fabrary.net/decks/…"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Hero: …\n3x Card Name (red)\n…"}
            rows={7}
            spellCheck={false}
          />
          <div className="lobby-row">
            <button className="btn-primary" disabled={busy || (!url.trim() && !text.trim())} onClick={() => void submit()}>
              {busy ? "Importing…" : "Import deck"}
            </button>
          </div>
          {result && (
            <div className={result.ok ? "import-ok" : "import-errors"}>
              {result.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
