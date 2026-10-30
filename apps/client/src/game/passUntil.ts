import type { GameView, PassUntilMode } from "@fyendal/shared";

const ANSWERED_KINDS = new Set(["priority-window", "attack-reaction", "defense-reaction", "defend"]);

/** A chain link is open: the chain-link shortcut covers it, not the next one. */
export function chainLinkOpen(view: GameView): boolean {
  const link = view.chain.at(-1);
  return link !== undefined && !link.resolved;
}

/** The open attack's power, net of established prevention, could defeat `seat`. */
export function attackThreatensLethal(view: GameView, seat: number): boolean {
  const link = view.chain.at(-1);
  const life = view.players[seat]?.life;
  if (!link || link.resolved || life === undefined) return false;
  return link.attackValue - (link.damageToPrevent ?? 0) >= life;
}

/** The armed shortcut waits on `seat`: the server answers only pass windows
 *  and non-lethal blocks (never blocks for the opponent shortcut), so any
 *  other choice of the seat's is a pause. A chain-link shortcut waiting for
 *  its link is armed, not paused. */
export function passUntilPaused(view: GameView, seat: number, mode: PassUntilMode | null): boolean {
  const decision = view.pendingDecision;
  if (!mode || !decision || decision.player !== seat) return false;
  if (mode === "chain-link" && !chainLinkOpen(view)) return false;
  if (!ANSWERED_KINDS.has(decision.kind)) return true;
  return decision.kind === "defend" && (mode === "opponent" || attackThreatensLethal(view, seat));
}
