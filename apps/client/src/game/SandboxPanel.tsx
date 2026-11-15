import { useEffect, useId, useState } from "react";
import { useIntl } from "react-intl";
import {
  MANUAL_LIFE_MAX,
  MANUAL_LIFE_MIN,
  MANUAL_RESOURCES_MAX,
  MANUAL_RESOURCES_MIN,
  type ManualEdit,
} from "@fyendal/shared";
import { ModalSurface } from "../components/ModalSurface.js";
import { UiIcon } from "../components/UiIcon.js";
import type { SandboxEditRefusal } from "../store/types.js";

export interface SandboxSeat {
  seat: 0 | 1;
  heroName: string;
  life: number;
  resources: number;
  /** Movable cards per zone; deck is null while its order is unrevealed. */
  zones?: { hand: number; deck: number | null; graveyard: number; banish: number };
}

export type SandboxZone = "hand" | "deck" | "graveyard" | "banish";
const SANDBOX_ZONES: readonly SandboxZone[] = ["hand", "deck", "graveyard", "banish"];

interface CounterDraft {
  life: number;
  resources: number;
}

export const SANDBOX_REFUSAL_MESSAGE: Record<SandboxEditRefusal, string> = {
  SANDBOX_REQUIRED: "game.sandbox.refusal.required",
  SANDBOX_SEAT_FORBIDDEN: "game.sandbox.refusal.seat",
  SANDBOX_EDIT_UNAVAILABLE: "game.sandbox.refusal.unavailable",
};

/** Bot games offer the tools too; the first edit converts them after a confirm. */
export function canOpenSandbox({ sandbox, botGame, spectating, replaying, yourSeat, gameOver }: {
  sandbox: boolean;
  botGame: boolean;
  spectating: boolean;
  replaying: boolean;
  yourSeat: number | null;
  gameOver: boolean;
}): boolean {
  return (sandbox || botGame) && !spectating && !replaying && yourSeat !== null && !gameOver;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/** Edits that differ from the seat's current values, in the order they are sent. */
export function sandboxCounterEdits(seat: SandboxSeat, draft: CounterDraft): ManualEdit[] {
  const edits: ManualEdit[] = [];
  if (draft.life !== seat.life) edits.push({ kind: "set-life", life: draft.life });
  if (draft.resources !== seat.resources) edits.push({ kind: "set-resources", resources: draft.resources });
  return edits;
}

function SandboxStepper({
  label,
  value,
  minimum,
  maximum,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  const intl = useIntl();
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <div className="sandbox-stepper">
      <label htmlFor={inputId}>{label}</label>
      <div className="sandbox-stepper-controls">
        <button
          type="button"
          aria-label={intl.formatMessage({ id: "game.sandbox.decrease" }, { field: label })}
          disabled={value <= minimum}
          onClick={() => onChange(clamp(value - 1, minimum, maximum))}
        >
          <UiIcon name="minus" />
        </button>
        <input
          id={inputId}
          autoComplete="off"
          inputMode="numeric"
          enterKeyHint="done"
          aria-describedby={`${inputId}-range`}
          value={draft ?? String(value)}
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, String(maximum).length);
            setDraft(digits);
            if (digits !== "") onChange(clamp(Number(digits), minimum, maximum));
          }}
          onBlur={() => setDraft(null)}
        />
        <button
          type="button"
          aria-label={intl.formatMessage({ id: "game.sandbox.increase" }, { field: label })}
          disabled={value >= maximum}
          onClick={() => onChange(clamp(value + 1, minimum, maximum))}
        >
          <UiIcon name="plus" />
        </button>
      </div>
      <span id={`${inputId}-range`} className="sandbox-stepper-range">
        {intl.formatMessage({ id: "game.sandbox.range" }, { minimum, maximum })}
      </span>
    </div>
  );
}

function ZoneSection({
  seat,
  onOpenZone,
}: {
  seat: SandboxSeat;
  onOpenZone: (zone: SandboxZone) => void;
}) {
  const intl = useIntl();
  const zones = seat.zones;
  if (!zones) return null;
  return (
    <div className="sandbox-section sandbox-zones">
      <h3 className="sandbox-section-title">{intl.formatMessage({ id: "game.sandbox.cards" })}</h3>
      <div className="sandbox-zone-buttons">
        {SANDBOX_ZONES.map((zone) => {
          const count = zones[zone];
          return (
            <button
              key={zone}
              type="button"
              data-sandbox-zone={zone}
              disabled={!count}
              onClick={() => onOpenZone(zone)}
            >
              {intl.formatMessage({ id: "game.sandbox.zoneButton" }, { zone, count: count ?? 0 })}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CounterSection({
  seat,
  pending,
  onApply,
}: {
  seat: SandboxSeat;
  pending: boolean;
  onApply: (edits: ManualEdit[]) => void;
}) {
  const intl = useIntl();
  const [draft, setDraft] = useState<CounterDraft>({ life: seat.life, resources: seat.resources });
  // A server-side change (edit, undo, or play) replaces that field's draft.
  useEffect(() => setDraft((current) => ({ ...current, life: seat.life })), [seat.life]);
  useEffect(() => setDraft((current) => ({ ...current, resources: seat.resources })), [seat.resources]);
  const edits = sandboxCounterEdits(seat, draft);
  return (
    <form
      className="sandbox-section"
      onSubmit={(event) => {
        event.preventDefault();
        if (edits.length > 0 && !pending) onApply(edits);
      }}
    >
      <div className="sandbox-steppers">
        <SandboxStepper
          label={intl.formatMessage({ id: "game.sandbox.life" })}
          value={draft.life}
          minimum={MANUAL_LIFE_MIN}
          maximum={MANUAL_LIFE_MAX}
          onChange={(life) => setDraft((current) => ({ ...current, life }))}
        />
        <SandboxStepper
          label={intl.formatMessage({ id: "game.sandbox.resources" })}
          value={draft.resources}
          minimum={MANUAL_RESOURCES_MIN}
          maximum={MANUAL_RESOURCES_MAX}
          onChange={(resources) => setDraft((current) => ({ ...current, resources }))}
        />
      </div>
      <div className="sandbox-actions">
        <button
          type="button"
          className="sandbox-reset"
          disabled={edits.length === 0 || pending}
          onClick={() => setDraft({ life: seat.life, resources: seat.resources })}
        >
          {intl.formatMessage({ id: "game.sandbox.reset" })}
        </button>
        <button type="submit" className="btn-primary sandbox-apply" disabled={edits.length === 0 || pending}>
          {intl.formatMessage({ id: pending ? "game.sandbox.applying" : "game.sandbox.apply" })}
        </button>
      </div>
    </form>
  );
}

export function SandboxPanel({
  seats,
  initialSeat,
  pending,
  refusal,
  onEdit,
  onClearRefusal,
  onOpenZone,
  confirmFirst,
  onClose,
}: {
  /** Seats the viewer may edit: both in solo, only their own in a private or bot room. */
  seats: readonly SandboxSeat[];
  initialSeat?: 0 | 1;
  pending: boolean;
  refusal: SandboxEditRefusal | null;
  /** Sends one edit; false when another room command is still in flight. */
  onEdit: (seat: 0 | 1, edit: ManualEdit) => boolean;
  onClearRefusal: () => void;
  /** Opens a zone's card list with move actions, replacing this panel. */
  onOpenZone?: (seat: 0 | 1, zone: SandboxZone) => void;
  /** Runs `apply` once the viewer confirms converting the room; absent when already sandbox. */
  confirmFirst?: (apply: () => void) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const tabsId = useId();
  const [selected, setSelected] = useState<0 | 1>(
    seats.some((seat) => seat.seat === initialSeat) ? initialSeat! : seats[0]!.seat,
  );
  const [queue, setQueue] = useState<{ seat: 0 | 1; edits: ManualEdit[] } | null>(null);
  const active = seats.find((seat) => seat.seat === selected) ?? seats[0]!;

  // Send queued edits one versioned command at a time; a refusal drops the rest.
  useEffect(() => {
    if (refusal) {
      setQueue(null);
      return;
    }
    if (!queue || pending) return;
    const [next, ...rest] = queue.edits;
    if (!next) {
      setQueue(null);
      return;
    }
    if (onEdit(queue.seat, next)) setQueue(rest.length > 0 ? { seat: queue.seat, edits: rest } : null);
  }, [queue, pending, refusal, onEdit]);

  const tabs = seats.length > 1;
  return (
    <ModalSurface
      title={intl.formatMessage({ id: "game.sandbox.title" })}
      description={intl.formatMessage({ id: "game.sandbox.description" })}
      className="sandbox-sheet"
      onClose={onClose}
    >
      {tabs ? (
        <div
          className="settings-segmented sandbox-seat-tabs"
          role="tablist"
          aria-label={intl.formatMessage({ id: "game.sandbox.seats" })}
        >
          {seats.map((seat) => (
            <button
              key={seat.seat}
              type="button"
              role="tab"
              id={`${tabsId}-${seat.seat}`}
              aria-selected={seat.seat === active.seat}
              aria-controls={`${tabsId}-panel`}
              className={seat.seat === active.seat ? "settings-selected" : undefined}
              disabled={queue !== null}
              onClick={() => {
                onClearRefusal();
                setSelected(seat.seat);
              }}
            >
              {seat.heroName}
            </button>
          ))}
        </div>
      ) : (
        <p className="sandbox-seat-name">{active.heroName}</p>
      )}
      <div
        id={`${tabsId}-panel`}
        role={tabs ? "tabpanel" : undefined}
        aria-labelledby={tabs ? `${tabsId}-${active.seat}` : undefined}
      >
        <CounterSection
          key={active.seat}
          seat={active}
          pending={pending || queue !== null}
          onApply={(edits) => {
            onClearRefusal();
            const apply = () => setQueue({ seat: active.seat, edits });
            if (confirmFirst) confirmFirst(apply);
            else apply();
          }}
        />
        {onOpenZone ? (
          <ZoneSection
            seat={active}
            onOpenZone={(zone) => onOpenZone(active.seat, zone)}
          />
        ) : null}
      </div>
      {refusal ? (
        <p className="sandbox-refusal" role="alert">
          {intl.formatMessage({ id: SANDBOX_REFUSAL_MESSAGE[refusal] })}
        </p>
      ) : null}
    </ModalSurface>
  );
}
