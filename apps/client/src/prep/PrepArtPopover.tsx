import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import type { DeckArt } from "@fyendal/shared";
import { CardArtVariants } from "../components/CardArtVariants.js";
import type { CardArtCatalog } from "../game/cardArtCatalog.js";

const GAP = 6;
const MARGIN = 8;

/** One ledger card's printings, anchored under its row thumbnail. */
export function PrepArtPopover(props: {
  catalog: CardArtCatalog;
  cardId: string;
  art: DeckArt;
  anchor: HTMLElement;
  onChange: (art: DeckArt) => void;
  onInspect: (cardId: string) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const { anchor, onClose } = props;

  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    const place = () => {
      const target = anchor.getBoundingClientRect();
      const { width, height } = panel.getBoundingClientRect();
      const below = target.bottom + GAP;
      const top = below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, target.top - GAP - height) : below;
      const left = Math.min(Math.max(MARGIN, target.left), window.innerWidth - width - MARGIN);
      setPosition({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchor]);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=radio][aria-checked=true]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
      anchor.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchor, onClose]);

  return (
    <div
      ref={ref}
      className="prep-art-popover"
      role="dialog"
      aria-label={intl.formatMessage({ id: "prep.art.dialog" })}
      style={position ? { left: position.left, top: position.top } : { visibility: "hidden" }}
    >
      <CardArtVariants catalog={props.catalog} cardId={props.cardId} art={props.art} compact onChange={props.onChange} />
      <button type="button" className="prep-art-view" onClick={() => props.onInspect(props.cardId)}>
        {intl.formatMessage({ id: "prep.art.viewCard" })}
      </button>
    </div>
  );
}
