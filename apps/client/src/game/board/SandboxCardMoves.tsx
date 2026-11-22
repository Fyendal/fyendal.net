import { useIntl } from "react-intl";
import type { CardView, ManualMoveDestination } from "@fyendal/shared";
import type { SandboxEditRefusal } from "../../store/types.js";
import { cardDisplayName } from "../decision/DecisionShared.js";
import { SANDBOX_REFUSAL_MESSAGE } from "../SandboxPanel.js";

export type SandboxMoveZone = "hand" | "deck" | "graveyard" | "banish";

const MOVE_TARGETS: Record<SandboxMoveZone, readonly ManualMoveDestination[]> = {
  hand: ["deck-top", "deck-bottom", "graveyard", "banish"],
  // Deck top and bottom stay draft moves in the draw-order editor.
  deck: ["hand", "graveyard", "banish"],
  graveyard: ["hand", "deck-top", "deck-bottom", "banish"],
  banish: ["hand", "deck-top", "deck-bottom", "graveyard"],
};

const MOVE_MESSAGE: Record<ManualMoveDestination, { label: string; named: string }> = {
  hand: { label: "game.sandbox.move.hand", named: "game.sandbox.move.handNamed" },
  "deck-top": { label: "game.sandbox.move.deckTop", named: "game.sandbox.move.deckTopNamed" },
  "deck-bottom": { label: "game.sandbox.move.deckBottom", named: "game.sandbox.move.deckBottomNamed" },
  graveyard: { label: "game.sandbox.move.graveyard", named: "game.sandbox.move.graveyardNamed" },
  banish: { label: "game.sandbox.move.banish", named: "game.sandbox.move.banishNamed" },
};

/** Destinations offered for a card; face-down banished cards stay put. */
export function sandboxMoveTargets(
  zone: SandboxMoveZone,
  card: Pick<CardView, "faceDown">,
): readonly ManualMoveDestination[] {
  return zone === "banish" && card.faceDown ? [] : MOVE_TARGETS[zone];
}

/** Single-key shortcuts on a focused deck card. */
export function sandboxMoveShortcut(key: string): ManualMoveDestination | null {
  switch (key.toLowerCase()) {
    case "h": return "hand";
    case "g": return "graveyard";
    case "b": return "banish";
    default: return null;
  }
}

/** The overlay's live pile when the viewer may move its cards, else null. */
export function editableOverlaySource<T extends { seat: number }>(
  source: T | undefined,
  canSandbox: boolean,
  editableSeats: readonly number[],
): T | null {
  return source && canSandbox && editableSeats.includes(source.seat) ? source : null;
}

export function sandboxMoveRefusalMessage(refusal: SandboxEditRefusal): string {
  return refusal === "SANDBOX_EDIT_UNAVAILABLE" ? "game.sandbox.refusal.move" : SANDBOX_REFUSAL_MESSAGE[refusal];
}

export function SandboxCardMoves({
  zone,
  card,
  pending,
  focusable = true,
  onMove,
}: {
  zone: SandboxMoveZone;
  card: CardView;
  pending: boolean;
  /** False where the card itself takes keyboard shortcuts instead. */
  focusable?: boolean;
  onMove: (to: ManualMoveDestination) => void;
}) {
  const intl = useIntl();
  const targets = sandboxMoveTargets(zone, card);
  if (targets.length === 0) return null;
  const name = cardDisplayName(card);
  return (
    <span className="sandbox-card-moves">
      {targets.map((to) => (
        <button
          key={to}
          type="button"
          data-sandbox-move={to}
          tabIndex={focusable ? undefined : -1}
          disabled={pending}
          aria-label={intl.formatMessage({ id: MOVE_MESSAGE[to].named }, { card: name })}
          onClick={(event) => {
            event.stopPropagation();
            onMove(to);
          }}
        >
          {intl.formatMessage({ id: MOVE_MESSAGE[to].label })}
        </button>
      ))}
    </span>
  );
}
