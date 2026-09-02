import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { DeckSummary } from "@fyendal/protocol";
import type { BotOpponent } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { deckChoicesFor, deckIsLegalForRoom } from "./DeckGrid.js";
import { FormatName } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";
import { BotOpponentModal } from "./BotOpponentModal.js";

const ROOM_FORMATS = ["cc", "silver-age"] as const satisfies readonly ConstructedFormat[];
const DROPDOWN_GAP = 5;
const DROPDOWN_VIEWPORT_MARGIN = 8;
const DROPDOWN_MAX_HEIGHT = 260;
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function CreateRoomModal({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  const {
    decks,
    createRoom,
    createBotRoom,
    allowFutureCards,
    setAllowFutureCards,
  } = useStore(useShallow((state) => ({
    decks: state.decks,
    createRoom: state.createRoom,
    createBotRoom: state.createBotRoom,
    allowFutureCards: state.allowFutureCards,
    setAllowFutureCards: state.setAllowFutureCards,
  })));
  const [format, setFormat] = useState<ConstructedFormat>("cc");
  const [choosingBot, setChoosingBot] = useState(false);
  const [deckFor, setDeckFor] = useState<Record<ConstructedFormat, string>>({
    cc: "",
    "silver-age": "",
  });

  const allowFuture = allowFutureCards[format];
  const choices = deckChoicesFor(format, decks, allowFuture);
  const deckId = deckFor[format];
  const selectedDeck = choices.find((deck) => deck.id === deckId);
  const selectionValid = selectedDeck !== undefined && deckIsLegalForRoom(selectedDeck, allowFuture);

  const createHostedRoom = (visibility: "public" | "private") => {
    if (!selectionValid) return;
    createRoom(format, { deckId }, visibility);
    onClose();
  };

  const playBot = (bot: BotOpponent) => {
    if (!selectionValid) return;
    createBotRoom(format, deckId, bot);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="deck-pick-modal create-room-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-room-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
      >
        <h2 className="panel-title" id="create-room-title">
          {intl.formatMessage({ id: "lobby.createRoom.title" })}
        </h2>

        <fieldset className="create-room-fieldset">
          <legend>{intl.formatMessage({ id: "common.format" })}</legend>
          <div className="create-room-formats">
            {ROOM_FORMATS.map((roomFormat) => (
              <button
                type="button"
                key={roomFormat}
                className={format === roomFormat ? "selected" : ""}
                aria-pressed={format === roomFormat}
                onClick={() => setFormat(roomFormat)}
              >
                <FormatName format={roomFormat} className="create-room-format-name" />
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="create-room-fieldset">
          <legend>{intl.formatMessage({ id: "common.deck" })}</legend>
          <label className="toggle-switch create-room-future-toggle">
            <span>{intl.formatMessage({ id: "lobby.cardPool.allowFuture" })}</span>
            <input
              type="checkbox"
              role="switch"
              checked={allowFuture}
              onChange={(event) => setAllowFutureCards(format, event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
          </label>
          <DeckDropdown
            key={format}
            decks={choices}
            selected={selectedDeck}
            allowFuture={allowFuture}
            onSelect={(id) => setDeckFor((current) => ({ ...current, [format]: id }))}
          />
        </fieldset>

        <div className="create-room-actions">
          <button className="btn-primary" disabled={!selectionValid} onClick={() => createHostedRoom("public")}>
            {intl.formatMessage({ id: "lobby.createRoom.open" })}
          </button>
          <button className="btn-private-room" disabled={!selectionValid} onClick={() => createHostedRoom("private")}>
            {intl.formatMessage({ id: "lobby.createRoom.private" })}
          </button>
          <button
            className="btn-bot"
            disabled={!selectionValid}
            onClick={() => {
              setChoosingBot(true);
            }}
          >
            {intl.formatMessage({ id: "lobby.action.playBot" })}
          </button>
          <button onClick={onClose}>{intl.formatMessage({ id: "common.cancel" })}</button>
        </div>
        {choosingBot ? (
          <BotOpponentModal
            format={format}
            onSelect={(bot) => playBot(bot)}
            onClose={() => setChoosingBot(false)}
          />
        ) : null}
      </section>
    </div>
  );
}

export function DeckDropdown({
  decks,
  selected,
  allowFuture,
  onSelect,
}: {
  decks: DeckSummary[];
  selected: DeckSummary | undefined;
  allowFuture: boolean;
  onSelect: (id: string) => void;
}) {
  const intl = useIntl();
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState({ placement: "below" as "above" | "below", maxHeight: DROPDOWN_MAX_HEIGHT });
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (event.target instanceof Node && !dropdownRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("click", closeOnOutsideClick, true);
    return () => document.removeEventListener("click", closeOnOutsideClick, true);
  }, [open]);

  useClientLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const options = optionsRef.current;
    if (!trigger || !options) return;

    let animationFrame: number | undefined;
    const updateLayout = () => {
      const triggerRect = trigger.getBoundingClientRect();
      const visualViewport = window.visualViewport;
      const viewportTop = visualViewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
      const navRect = document.querySelector<HTMLElement>(".mobile-lobby-nav")?.getBoundingClientRect();
      const bottomBoundary = navRect && navRect.height > 0
        ? Math.min(viewportBottom, navRect.top)
        : viewportBottom;
      const spaceAbove = Math.max(0, triggerRect.top - viewportTop - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN);
      const spaceBelow = Math.max(0, bottomBoundary - triggerRect.bottom - DROPDOWN_GAP - DROPDOWN_VIEWPORT_MARGIN);
      const desiredHeight = Math.min(DROPDOWN_MAX_HEIGHT, options.scrollHeight);
      const placement = spaceBelow < desiredHeight && spaceAbove > spaceBelow ? "above" : "below";
      const maxHeight = Math.min(desiredHeight, placement === "above" ? spaceAbove : spaceBelow);

      setLayout((current) => current.placement === placement && current.maxHeight === maxHeight
        ? current
        : { placement, maxHeight });
    };
    const scheduleUpdate = () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(updateLayout);
    };

    updateLayout();
    window.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    document.addEventListener("scroll", scheduleUpdate, { capture: true, passive: true });
    return () => {
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      document.removeEventListener("scroll", scheduleUpdate, true);
    };
  }, [decks.length, open]);

  return (
    <div
      ref={dropdownRef}
      className="create-room-deck-select"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof Node && !event.currentTarget.contains(nextFocus)) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="create-room-deck-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {selected
          ? <DeckOptionContent key={selected.id} deck={selected} />
          : <span className="muted">{intl.formatMessage({ id: "lobby.deck.choose" })}</span>}
        <span className="create-room-deck-chevron" aria-hidden="true" />
      </button>
      {open ? (
        <div
          ref={optionsRef}
          className="create-room-deck-options"
          role="listbox"
          aria-label={intl.formatMessage({ id: "common.deck" })}
          data-placement={layout.placement}
          style={{ maxHeight: layout.maxHeight }}
        >
          {decks.map((deck) => {
            const blocked = !deckIsLegalForRoom(deck, allowFuture);
            return (
              <button
                type="button"
                key={deck.id}
                role="option"
                aria-selected={deck.id === selected?.id}
                disabled={blocked}
                onClick={() => {
                  onSelect(deck.id);
                  setOpen(false);
                }}
              >
                <DeckOptionContent deck={deck} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function DeckOptionContent({ deck }: { deck: DeckSummary }) {
  const intl = useIntl();
  const [imageAvailable, setImageAvailable] = useState(true);

  return (
    <span className="create-room-deck-option-content">
      {imageAvailable ? (
        <img
          src={heroImageUrl(deck.heroName)}
          alt=""
          width={42}
          height={42}
          onError={() => setImageAvailable(false)}
        />
      ) : (
        <span className="create-room-deck-image-fallback">{deck.heroName.charAt(0)}</span>
      )}
      <span className="create-room-deck-option-copy">
        <span title={deck.name}>{deck.name}</span>
        <small>
          {intl.formatMessage(
            { id: "lobby.deck.heroAndCount" },
            { hero: deck.heroName, count: deck.deckSize },
          )}
        </small>
      </span>
    </span>
  );
}
