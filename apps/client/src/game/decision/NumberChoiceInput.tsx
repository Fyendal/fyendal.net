import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useIntl } from "react-intl";
import { UiIcon } from "../../components/UiIcon.js";
import type { NumberChoice } from "../decisionPresentation.js";

const HOLD_DELAY_MS = 380;
const HOLD_REPEAT_MS = 70;
const HOLD_FAST_REPEAT_MS = 35;
const HOLD_FAST_AFTER_TICKS = 10;
const PAGE_STEP = 10;

/** Step `count` allowed values from `current`, clamped to the ends; values may have gaps. */
export function steppedNumberChoice(values: readonly number[], current: number, count: number): number {
  return values[Math.max(0, Math.min(values.length - 1, values.indexOf(current) + count))]!;
}

export function NumberChoiceInput({
  choice,
  onChoose,
}: {
  choice: NumberChoice;
  onChoose: (optionId: string) => void;
}) {
  const intl = useIntl();
  const { minimum, maximum, optionByValue, defaultValue } = choice;
  const values = [...optionByValue.keys()].sort((left, right) => left - right);
  const [value, setValue] = useState(defaultValue ?? values[0]!);
  const [draft, setDraft] = useState<string | null>(null);
  const repeat = useRef<number | undefined>(undefined);

  const typed = draft === null ? value : draft === "" ? NaN : Number(draft);
  const optionId = optionByValue.get(typed);
  const step = (count: number) => {
    setDraft(null);
    setValue((current) => steppedNumberChoice(values, current, count));
  };
  const stopRepeat = () => window.clearTimeout(repeat.current);
  useEffect(() => stopRepeat, []);

  const stepper = (count: 1 | -1) => ({
    "aria-label": intl.formatMessage({ id: count > 0 ? "game.decision.number.increase" : "game.decision.number.decrease" }),
    className: "number-dial-step",
    disabled: count > 0 ? value >= values[values.length - 1]! : value <= values[0]!,
    type: "button" as const,
    // Pointer presses step at once and repeat while held; keyboard clicks arrive with detail 0.
    onClick: (event: { detail: number }) => { if (event.detail === 0) step(count); },
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      step(count);
      const tick = (delay: number, ticks: number) => {
        repeat.current = window.setTimeout(() => {
          step(count);
          tick(ticks < HOLD_FAST_AFTER_TICKS ? HOLD_REPEAT_MS : HOLD_FAST_REPEAT_MS, ticks + 1);
        }, delay);
      };
      stopRepeat();
      tick(HOLD_DELAY_MS, 0);
    },
    onPointerUp: stopRepeat,
    onPointerLeave: stopRepeat,
    onPointerCancel: stopRepeat,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const counts: Record<string, number> = {
      ArrowUp: 1,
      ArrowDown: -1,
      PageUp: PAGE_STEP,
      PageDown: -PAGE_STEP,
      Home: -values.length,
      End: values.length,
    };
    const count = counts[event.key];
    if (count === undefined) return;
    event.preventDefault();
    setDraft(null);
    setValue(steppedNumberChoice(values, optionId === undefined ? value : typed, count));
  };

  return (
    <form
      className="decision-number-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (optionId !== undefined) onChoose(optionId);
      }}
    >
      <div className={`number-dial${optionId === undefined ? " number-dial-invalid" : ""}`}>
        <button {...stepper(1)}>
          <UiIcon name="chevron-up" />
        </button>
        <label className="number-dial-value">
          <input
            aria-label={intl.formatMessage({ id: "game.decision.number.label" }, { minimum, maximum })}
            autoComplete="off"
            enterKeyHint="done"
            inputMode="numeric"
            value={draft ?? String(value)}
            onBlur={() => setDraft(null)}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, String(maximum).length);
              setDraft(digits);
              const parsed = Number(digits);
              if (digits !== "" && optionByValue.has(parsed)) setValue(parsed);
            }}
            onFocus={(event) => event.currentTarget.select()}
            onKeyDown={onKeyDown}
          />
          <span className="number-dial-range" aria-hidden="true">
            {intl.formatMessage({ id: "game.decision.number.range" }, { minimum, maximum })}
          </span>
        </label>
        <button {...stepper(-1)}>
          <UiIcon name="chevron-down" />
        </button>
      </div>
      <button className="btn-primary number-dial-confirm" disabled={optionId === undefined} type="submit">
        {intl.formatMessage({ id: "game.decision.number.choose" }, { value: Number.isNaN(typed) ? "–" : typed })}
      </button>
    </form>
  );
}
