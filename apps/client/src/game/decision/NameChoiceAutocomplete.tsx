import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";

const MAX_SUGGESTIONS = 8;
const SUGGESTIONS_MAX_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
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

/** Open toward the roomier side of the viewport and fit within it. */
export function cardNameSuggestionPlacement(
  anchor: { top: number; bottom: number },
  viewportHeight: number,
): { above: boolean; maxHeight: number } {
  const spaceBelow = viewportHeight - anchor.bottom - VIEWPORT_MARGIN;
  const spaceAbove = anchor.top - VIEWPORT_MARGIN;
  const above = spaceBelow < SUGGESTIONS_MAX_HEIGHT && spaceAbove > spaceBelow;
  return { above, maxHeight: Math.max(0, Math.min(SUGGESTIONS_MAX_HEIGHT, above ? spaceAbove : spaceBelow)) };
}

export function NameChoiceAutocomplete({ onChoose }: { onChoose: (name: string) => void }) {
  const intl = useIntl();
  const listboxId = useId();
  const [chosenName, setChosenName] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const suggestions = useMemo(() => cardNameSuggestions(chosenName), [chosenName]);
  const showSuggestions = open && suggestions.length > 0;
  const comboboxRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ReturnType<typeof cardNameSuggestionPlacement>>();

  useLayoutEffect(() => {
    const combobox = comboboxRef.current;
    if (!showSuggestions || !combobox) return;
    const update = () => setPlacement(cardNameSuggestionPlacement(combobox.getBoundingClientRect(), window.innerHeight));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [showSuggestions]);

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
      <div className="decision-name-combobox" ref={comboboxRef}>
        <input
          aria-activedescendant={showSuggestions ? `${listboxId}-${activeIndex}` : undefined}
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
          className={`decision-name-suggestions${placement?.above ? " decision-name-suggestions-above" : ""}`}
          id={listboxId}
          role="listbox"
          hidden={!showSuggestions}
          style={placement ? { maxHeight: placement.maxHeight } : undefined}
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
        {intl.formatMessage({ id: "game.decision.name.choose" })}
      </button>
    </form>
  );
}
