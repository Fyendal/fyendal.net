import type { AttackQueueEntryView, ChainLinkView, GameView, StackLayerView } from "@fyendal/shared";

export interface CombatPresentation {
  chain: ChainLinkView[];
  stack: StackLayerView[];
  /** Attacks waiting to move onto the combat chain, first attack first. */
  queue: AttackQueueEntryView[];
  context?: string;
}

/** The engine keeps a provisional link for attack calculations during the
 * Layer Step. Present that unresolved attack on the stack until it becomes
 * attacking in the Attack Step. */
export function attackLayerPresentation(view: GameView): CombatPresentation {
  const pending = view.chain.at(-1);
  const queue = view.attackQueue ?? [];
  if (!pending?.onStack) {
    return { chain: view.chain, stack: view.stack, queue, context: view.stackContext };
  }
  return {
    chain: view.chain.slice(0, -1),
    queue,
    // Optimistic attacks appear before the server's stackContext arrives.
    // Derive the caption from the same pending layer that creates the card.
    context: "LAYER STEP · ATTACK",
    stack: [
      ...view.stack,
      {
        card: pending.attackingCard,
        seat: view.activePlayer,
        label: "Attack layer",
        labelMessage: { id: "game.stack.attackLayer" },
        optional: false,
      },
    ],
  };
}
