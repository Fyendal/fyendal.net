import type { ChainLinkView, GameIntent, GameView } from "@fyendal/shared";

export interface LethalPassRisk {
  damage: number;
  life: number;
  window: "defend" | "reaction";
}

function netDamage(link: ChainLinkView, damage: number): number {
  return Math.max(0, damage - (link.damageUnpreventable ? 0 : link.damageToPrevent ?? 0));
}

/** The attack's hero damage if `seat` commits now, or null when it isn't lethal
 *  or it targets an ally. */
function lethalDamage(
  view: GameView,
  seat: number,
  link: ChainLinkView,
  damage: number,
  window: LethalPassRisk["window"],
): LethalPassRisk | null {
  const life = view.players[seat]?.life;
  if (life === undefined || link.targetAllyName !== undefined) return null;
  const net = netDamage(link, damage);
  return net > 0 && net >= life ? { damage: net, life, window } : null;
}

/** The defender's last pass of the step: the attacker passed first and an empty
 *  stack means nothing resolves before damage. */
export function reactionPassRisk(
  view: GameView,
  seat: number,
  legal: readonly GameIntent[],
): LethalPassRisk | null {
  const decision = view.pendingDecision;
  const link = view.chain.at(-1);
  if (decision?.kind !== "defense-reaction" || decision.player !== seat) return null;
  if (!link || link.resolved || view.stack.length > 0) return null;
  if (!legal.some((intent) => intent.kind !== "pass")) return null;
  return lethalDamage(view, seat, link, link.damage, "reaction");
}

/** Staged blocks aren't on the link yet, so price them in. `link.damage` minus
 *  the plain subtraction leaves any flat damage bonus. */
function defendRisk(view: GameView, seat: number): LethalPassRisk | null {
  const decision = view.pendingDecision;
  const link = view.chain.at(-1);
  if (decision?.kind !== "defend" || decision.player !== seat || !link || link.resolved) return null;
  const staged = new Set((decision.stagedCards ?? []).map((card) => card.instanceId));
  const canBlockMore = (decision.defenderDefense ?? []).some(
    (defender) => defender.defense > 0 && !staged.has(defender.instanceId),
  );
  if (!canBlockMore) return null;
  const bonus = link.damage > 0 ? link.damage - Math.max(0, link.attackValue - link.defenseValue) : 0;
  const unblocked = (decision.stagedAttack ?? link.attackValue) - link.defenseValue - (decision.stagedDefense ?? 0);
  return lethalDamage(view, seat, link, unblocked > 0 ? unblocked + bonus : 0, "defend");
}

/** Committing now would let the open attack defeat `seat` while it still has
 *  another option. Combat damage only: on-hit and stack damage aren't counted. */
export function lethalPassRisk(
  view: GameView,
  seat: number,
  legal: readonly GameIntent[],
): LethalPassRisk | null {
  return defendRisk(view, seat) ?? reactionPassRisk(view, seat, legal);
}
