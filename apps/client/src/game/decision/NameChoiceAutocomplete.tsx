import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";

const MAX_SUGGESTIONS = 8;
const registeredCardNames = [...new Set(
  Object.values(cardData).map((card) => card.name.trim()).filter(Boolean),
)].sort((left, right) => left.localeCompare(right));

/** Find registered names without rendering the full card catalog. */
export function cardNameSuggestions(query: string, limit = MAX_SUGGESTIONS): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized || limit <= 0) return [];

  const prefixes: string[] = [];
  const containing: string[] = [];
  for (const name of registeredCardNames) {
    const candidate = name.toLowerCase();
    if (candidate.startsWith(normalized)) prefixes.push(name);
    else if (candidate.includes(normalized)) containing.push(name);
    if (prefixes.length >= limit) break;
  }
  return [...prefixes, ...containing].slice(0, limit);
}

/** The registered spelling of a fully typed name; partial text never matches. */
export function registeredCardName(query: string): string | undefined {
  const normalized = query.trim().toLowerCase();
  return registeredCardNames.find((name) => name.toLowerCase() === normalized);
}

export type CardNameEnterAction =
  | { kind: "accept-suggestion"; name: string }
  | { kind: "submit" };

export function cardNameEnterAction(
  showSuggestions: boolean,
  suggestions: readonly string[],
  activeIndex: number,
): CardNameEnterAction {
  const name = showSuggestions ? suggestions[activeIndex] : undefined;
  return name ? { kind: "accept-suggestion", name } : { kind: "submit" };
}

/** Split a suggestion around the typed text so look-alike names read by what differs. */
export function cardNameSuggestionParts(name: string, query: string): [before: string, match: string, after: string] {
  const normalized = query.trim().toLowerCase();
  const start = normalized ? name.toLowerCase().indexOf(normalized) : -1;
  if (start < 0) return ["", "", name];
  const end = start + normalized.length;
  return [name.slice(0, start), name.slice(start, end), name.slice(end)];
}

export function NameChoiceAutocomplete({ onChoose }: { onChoose: (name: string) => void }) {
  const intl = useIntl();
  const listboxId = useId();
  const [chosenName, setChosenName] = useState("");
  const [open, setOpen] = useState(false);
  // Nothing is highlighted until the player arrows to it, so Enter can't pick a look-alike.
  const [activeIndex, setActiveIndex] = useState(-1);
  const suggestions = useMemo(() => cardNameSuggestions(chosenName), [chosenName]);
  const registeredName = registeredCardName(chosenName);
  // A complete name closes the list, so it never covers an enabled Choose button.
  const showSuggestions = open && suggestions.length > 0 && !registeredName;
  const listboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSuggestions || activeIndex < 0) return;
    listboxRef.current?.children[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [showSuggestions, activeIndex]);

  const acceptSuggestion = (name: string) => {
    setChosenName(name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const choose = () => {
    if (!registeredName) return;
    onChoose(registeredName);
    setChosenName("");
    setOpen(false);
    setActiveIndex(-1);
  };

  return (
    <form
      className="decision-buttons decision-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        choose();
      }}
    >
      <div className="decision-name-combobox">
        <input
          aria-activedescendant={showSuggestions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showSuggestions}
          aria-label={intl.formatMessage({ id: "game.cardName" })}
          autoComplete="off"
          placeholder={intl.formatMessage({ id: "game.decision.name.placeholder" })}
          role="combobox"
          value={chosenName}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setChosenName(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (suggestions.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => (current <= 0 ? suggestions.length : current) - 1);
            } else if (event.key === "Enter") {
              const action = cardNameEnterAction(showSuggestions, suggestions, activeIndex);
              if (action.kind === "accept-suggestion") {
                event.preventDefault();
                acceptSuggestion(action.name);
              }
            }
          }}
        />
        <div
          className="decision-name-suggestions"
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          hidden={!showSuggestions}
        >
          {suggestions.map((name, index) => {
            const [before, match, after] = cardNameSuggestionParts(name, chosenName);
            return (
              <button
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "decision-name-suggestion-active" : undefined}
                id={`${listboxId}-${index}`}
                key={name}
                role="option"
                tabIndex={-1}
                type="button"
                onClick={() => acceptSuggestion(name)}
                onMouseDown={(event) => event.preventDefault()}
              >
                {before}<span className="decision-name-match">{match}</span>{after}
              </button>
            );
          })}
        </div>
      </div>
      <button className="btn-primary" disabled={!registeredName} type="submit">
        {intl.formatMessage({ id: "game.decision.name.choose" })}
      </button>
    </form>
  );
}
