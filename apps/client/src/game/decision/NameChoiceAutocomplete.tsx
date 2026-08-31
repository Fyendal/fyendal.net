import { useId, useMemo, useState } from "react";
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

export function NameChoiceAutocomplete({ onChoose }: { onChoose: (name: string) => void }) {
  const listboxId = useId();
  const [chosenName, setChosenName] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => cardNameSuggestions(chosenName), [chosenName]);
  const showSuggestions = open && suggestions.length > 0;

  const acceptSuggestion = (name: string) => {
    setChosenName(name);
    setOpen(false);
    setActiveIndex(0);
  };

  const choose = (name: string) => {
    const normalized = name.trim();
    if (!normalized) return;
    onChoose(normalized);
    setChosenName("");
    setOpen(false);
    setActiveIndex(0);
  };

  return (
    <form
      className="decision-buttons decision-name-form"
      onSubmit={(event) => {
        event.preventDefault();
        choose(chosenName);
      }}
    >
      <div className="decision-name-combobox">
        <input
          aria-activedescendant={showSuggestions ? `${listboxId}-${activeIndex}` : undefined}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showSuggestions}
          aria-label="Card name"
          autoComplete="off"
          placeholder="Start typing a card name"
          role="combobox"
          value={chosenName}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setChosenName(event.target.value);
            setOpen(true);
            setActiveIndex(0);
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
              setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
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
          role="listbox"
          hidden={!showSuggestions}
        >
          {suggestions.map((name, index) => (
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
              onMouseEnter={() => setActiveIndex(index)}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <button className="btn-primary" disabled={!chosenName.trim()} type="submit">
        Choose name
      </button>
    </form>
  );
}
