import { useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { CardPoolMode } from "@fyendal/shared";
import { LobbyTooltip } from "./LobbyTooltip.js";

const CARD_POOL_MODES = ["legal", "future", "open"] as const satisfies readonly CardPoolMode[];

export function CardPoolModeControl(props: {
  value: CardPoolMode;
  disabled?: boolean;
  className?: string;
  onChange: (mode: CardPoolMode) => void;
}) {
  const intl = useIntl();
  const controlId = useId();
  const buttonRefs = useRef<Partial<Record<CardPoolMode, HTMLButtonElement | null>>>({});
  const [hoveredMode, setHoveredMode] = useState<CardPoolMode | null>(null);
  const [focusedMode, setFocusedMode] = useState<CardPoolMode | null>(null);
  const activeMode = focusedMode ?? hoveredMode;

  return (
    <div className={`card-pool-control${props.className ? ` ${props.className}` : ""}`}>
      <div
        className="card-pool-segments"
        data-mode={props.value}
        role="group"
        aria-label={intl.formatMessage({ id: "lobby.cardPool.title" })}
      >
        {CARD_POOL_MODES.map((mode) => {
          const description = intl.formatMessage({ id: `lobby.cardPool.${mode}Description` });
          return (
            <button
              type="button"
              key={mode}
              ref={(element) => {
                buttonRefs.current[mode] = element;
              }}
              className={props.value === mode ? "selected" : ""}
              aria-describedby={`${controlId}-${mode}`}
              aria-pressed={props.value === mode}
              data-tooltip={description}
              disabled={props.disabled}
              onPointerEnter={() => setHoveredMode(mode)}
              onPointerLeave={() => setHoveredMode((current) => current === mode ? null : current)}
              onFocus={() => setFocusedMode(mode)}
              onBlur={() => setFocusedMode((current) => current === mode ? null : current)}
              onClick={() => props.onChange(mode)}
            >
              {intl.formatMessage({ id: `lobby.cardPool.${mode}` })}
            </button>
          );
        })}
        {CARD_POOL_MODES.map((mode) => (
          <span className="card-pool-segment-description" id={`${controlId}-${mode}`} key={mode}>
            {intl.formatMessage({ id: `lobby.cardPool.${mode}Description` })}
          </span>
        ))}
      </div>
      {activeMode
        ? <LobbyTooltip
            key={activeMode}
            anchor={buttonRefs.current[activeMode] ?? null}
            content={intl.formatMessage({ id: `lobby.cardPool.${activeMode}Description` })}
            gap={10}
          />
        : null}
    </div>
  );
}
