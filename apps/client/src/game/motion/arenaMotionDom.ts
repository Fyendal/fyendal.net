import {
  ARENA_MERGE_MS,
  ARENA_PEEL_MS,
  ARENA_SHIFT_MS,
  planArenaMotion,
  type ArenaMergeMotion,
  type ArenaStackMotion,
  type ArenaStackState,
} from "./arenaMotion.js";
import type { MotionRect } from "./motionGeometry.js";

const STACK_SELECTOR = ".board-card-stack[data-motion-card]";
const MASK_ATTRIBUTE = "data-game-motion-destination-hidden";
const SETTLE_EASING = "cubic-bezier(.2, .8, .2, 1)";
const LIFT_SHADOW = "drop-shadow(0 12px 14px rgb(0 0 0 / .55))";
const REST_SHADOW = "drop-shadow(0 0 0 rgb(0 0 0 / 0))";

interface Measured {
  element: HTMLElement;
  state: ArenaStackState;
}

function rectOf(element: Element): MotionRect | null {
  const rect = element.getBoundingClientRect();
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}

function topCard(stack: HTMLElement): HTMLElement | null {
  const instanceId = stack.dataset.motionCard?.split(":").at(-1);
  return instanceId === undefined
    ? null
    : stack.querySelector<HTMLElement>(`.card[data-card-instance-id="${CSS.escape(instanceId)}"]`);
}

function overlayKind(overlay: Element): string | undefined {
  return [...overlay.classList].find((name) => name.startsWith("c-") && name !== "c-ovl");
}

function overlaysOf(card: HTMLElement | null): Record<string, string> {
  const overlays: Record<string, string> = {};
  for (const overlay of card?.querySelectorAll(".c-ovl") ?? []) {
    const kind = overlayKind(overlay);
    if (kind) overlays[kind] = overlay.querySelector(".c-ovl-num")?.textContent ?? "";
  }
  return overlays;
}

function turn(tapped: boolean, overshoot = 0): Keyframe {
  return tapped
    ? { transform: `rotate(${90 + overshoot}deg)`, filter: "brightness(.75)" }
    : { transform: `rotate(${-overshoot}deg)`, filter: "brightness(1)" };
}

/** Quarter turn with a little give at the end, like a card set down sideways. */
function turnKeyframes(from: boolean, to: boolean): Keyframe[] {
  return [turn(from), { ...turn(to, 4), offset: .78 }, turn(to)];
}

function popKeyframes(): Keyframe[] {
  return [
    { transform: "scale(1.55)", filter: "brightness(1.7)", opacity: 0 },
    { transform: "scale(.9)", filter: "brightness(1.2)", opacity: 1, offset: .55 },
    { transform: "scale(1)", filter: "brightness(1)", opacity: 1 },
  ];
}

/** Choreographs arena stacks between authoritative snapshots: neighbours slide
 * instead of jumping, a card whose state changes peels off its stack and
 * turns, and cards that become identical glide back onto one stack. Cards
 * entering or leaving the arena stay with the motion queue's overlays. */
export class ArenaMotion {
  private previous = new Map<string, Measured>();
  private readonly ids = new WeakMap<HTMLElement, string>();
  private nextId = 0;
  private readonly running = new Map<HTMLElement, Animation[]>();
  private readonly ghosts = new Set<HTMLElement>();
  /** Stacks keep their old slots until the cards leaving the arena have gone. */
  private holdMs = 0;
  /** The settled slot of each stack that is mid-slide. */
  private readonly resting = new Map<HTMLElement, MotionRect>();

  private idOf(element: HTMLElement): string {
    let id = this.ids.get(element);
    if (id === undefined) {
      id = String(this.nextId++);
      this.ids.set(element, id);
    }
    return id;
  }

  private measure(root: ParentNode): Map<string, Measured> {
    const measured = new Map<string, Measured>();
    for (const element of root.querySelectorAll<HTMLElement>(STACK_SELECTOR)) {
      const rect = this.resting.get(element) ?? rectOf(element);
      if (!rect) continue;
      const members = [
        element.dataset.motionCard!,
        ...(element.dataset.motionCardAliases?.split(/\s+/).filter(Boolean) ?? []),
      ];
      measured.set(this.idOf(element), {
        element,
        state: {
          members,
          rect,
          tapped: element.classList.contains("board-card-stack-tapped"),
          overlays: overlaysOf(topCard(element)),
        },
      });
    }
    return measured;
  }

  /** Re-baseline without animating, e.g. after a re-render or a settle. */
  sync(root: ParentNode): void {
    this.previous = this.measure(root);
  }

  /** Forget the arena, e.g. when the game view goes away. */
  reset(): void {
    this.cancel();
    this.previous = new Map();
  }

  /** Stop every stack motion at its end state. */
  cancel(): void {
    for (const animations of this.running.values()) {
      for (const animation of animations) animation.cancel();
    }
    this.running.clear();
    this.resting.clear();
    for (const ghost of this.ghosts) ghost.remove();
    this.ghosts.clear();
  }

  /** Start a new authoritative step. An interrupted slide continues from
   * where it was drawn rather than snapping to its previous slot. */
  begin(): void {
    const drawnOffsets = new Map<HTMLElement, { left: number; top: number }>();
    for (const [element, animations] of this.running) {
      const drawn = rectOf(element);
      for (const animation of animations) animation.cancel();
      const settled = rectOf(element);
      if (drawn && settled) {
        drawnOffsets.set(element, { left: drawn.left - settled.left, top: drawn.top - settled.top });
      }
    }
    this.cancel();
    for (const entry of this.previous.values()) {
      const offset = drawnOffsets.get(entry.element);
      if (!offset) continue;
      const { rect } = entry.state;
      entry.state = { ...entry.state, rect: { ...rect, left: rect.left + offset.left, top: rect.top + offset.top } };
    }
  }

  /** Animate from the last measured arena to the committed one, holding
   * every stack in place for `holdMs` while departing cards play out. Stacks
   * the motion queue masks are left to its overlays. */
  play(root: ParentNode, holdMs = 0): void {
    const current = this.measure(root);
    const previous = this.previous;
    this.previous = current;
    if (typeof HTMLElement === "undefined" || typeof HTMLElement.prototype.animate !== "function") return;
    this.holdMs = holdMs;
    const visible = (measured: Map<string, Measured>) => new Map([...measured]
      .filter(([, { element }]) => !element.hasAttribute(MASK_ATTRIBUTE))
      .map(([id, { state }]) => [id, state]));
    const plan = planArenaMotion(visible(previous), visible(current));
    const landings = new Map<string, number>();
    for (const merge of plan.merges) {
      const from = previous.get(merge.fromId)!;
      const into = current.get(merge.intoId)!;
      if (this.mergeGhost(merge, from.element, from.state.rect, into.element)) {
        landings.set(merge.intoId, ARENA_MERGE_MS * .8);
      }
    }
    for (const motion of plan.stacks) {
      const { element, state } = current.get(motion.id)!;
      this.animateStack(element, state.rect, motion, landings.get(motion.id));
    }
    for (const [intoId, landingMs] of landings) {
      if (plan.stacks.some((motion) => motion.id === intoId && motion.countChanged)) continue;
      const into = current.get(intoId)!.element;
      this.popCount(into, landingMs);
    }
  }

  private track(element: HTMLElement, animation: Animation, rest?: MotionRect): void {
    const animations = this.running.get(element) ?? [];
    animations.push(animation);
    this.running.set(element, animations);
    if (rest) this.resting.set(element, rest);
    animation.addEventListener("finish", () => {
      const remaining = (this.running.get(element) ?? []).filter((candidate) => candidate !== animation);
      if (remaining.length > 0) {
        this.running.set(element, remaining);
      } else {
        this.running.delete(element);
        this.resting.delete(element);
      }
    });
  }

  private animateStack(
    element: HTMLElement,
    rest: MotionRect,
    motion: ArenaStackMotion,
    landingMs: number | undefined,
  ): void {
    const duration = motion.peel ? ARENA_PEEL_MS : ARENA_SHIFT_MS;
    const moves = Math.abs(motion.dx) >= .5 || Math.abs(motion.dy) >= .5;
    if (moves || motion.peel) {
      const from = `translate(${motion.dx}px, ${motion.dy}px)`;
      const keyframes: Keyframe[] = motion.peel
        ? [
            { transform: `${from} scale(1)`, filter: REST_SHADOW, zIndex: 3 },
            {
              transform: `translate(${motion.dx * .85}px, ${motion.dy - 14}px) scale(1.06)`,
              filter: LIFT_SHADOW,
              zIndex: 3,
              offset: .32,
            },
            { transform: "translate(0, 0) scale(1)", filter: REST_SHADOW, zIndex: 3 },
          ]
        : [{ transform: from }, { transform: "translate(0, 0)" }];
      this.track(element, element.animate(keyframes, {
        duration,
        delay: this.holdMs,
        easing: SETTLE_EASING,
        fill: "backwards",
      }), rest);
    }
    const card = topCard(element);
    if (card && motion.tappedFrom !== undefined) {
      const tappedTo = !motion.tappedFrom;
      this.track(element, card.animate(turnKeyframes(motion.tappedFrom, tappedTo), {
        duration,
        delay: this.holdMs,
        easing: "cubic-bezier(.3, .7, .2, 1)",
        fill: "backwards",
      }), rest);
    }
    if (motion.countChanged) this.popCount(element, landingMs ?? 0);
    for (const kind of motion.changedOverlays) {
      const overlay = card?.querySelector<HTMLElement>(`.c-ovl.${CSS.escape(kind)}`);
      if (!overlay) continue;
      this.track(element, overlay.animate(popKeyframes(), {
        duration: 300,
        delay: this.holdMs + duration * .55,
        easing: "ease-out",
        fill: "backwards",
      }));
    }
  }

  private popCount(element: HTMLElement, delay: number): void {
    const count = element.querySelector<HTMLElement>(".board-card-count");
    if (!count || count.hasAttribute(MASK_ATTRIBUTE)) return;
    this.track(element, count.animate(popKeyframes(), {
      duration: 300,
      delay: this.holdMs + delay,
      easing: "ease-out",
      fill: "backwards",
    }));
  }

  /** Draw the vanished stack as an inert copy in its old slot and glide it
   * onto the stack its cards joined. */
  private mergeGhost(
    merge: ArenaMergeMotion,
    source: HTMLElement,
    from: MotionRect,
    into: HTMLElement,
  ): boolean {
    const strip = into.parentElement;
    if (!strip) return false;
    const stripRect = strip.getBoundingClientRect();
    const ghost = source.cloneNode(true) as HTMLElement;
    const card = topCard(ghost);
    for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>("*")]) {
      for (const name of node.getAttributeNames()) {
        if (name.startsWith("data-motion") || name === MASK_ATTRIBUTE || name === "id"
          || name === "tabindex" || name === "data-card-instance-id") node.removeAttribute(name);
      }
    }
    ghost.setAttribute("aria-hidden", "true");
    ghost.inert = true;
    ghost.classList.add("board-card-stack-ghost");
    Object.assign(ghost.style, {
      left: `${from.left - stripRect.left - strip.clientLeft + strip.scrollLeft}px`,
      top: `${from.top - stripRect.top - strip.clientTop + strip.scrollTop}px`,
      width: `${from.width}px`,
      height: `${from.height}px`,
    });
    strip.append(ghost);
    this.ghosts.add(ghost);
    const to = `translate(${merge.dx}px, ${merge.dy}px)`;
    // A stack that stays put holds its slot beneath the card landing on it.
    const stationary = Math.hypot(merge.dx, merge.dy) < 4;
    if (stationary) ghost.style.zIndex = "2";
    const glide = ghost.animate(stationary ? [
      { opacity: 1 },
      { opacity: 1, offset: .8 },
      { opacity: 0 },
    ] : [
      { transform: "translate(0, 0) scale(1)", filter: REST_SHADOW, opacity: 1 },
      {
        transform: `translate(${merge.dx * .15}px, ${merge.dy * .15 - 14}px) scale(1.06)`,
        filter: LIFT_SHADOW,
        opacity: 1,
        offset: .3,
      },
      { transform: `${to} scale(1.03)`, filter: LIFT_SHADOW, opacity: 1, offset: .8 },
      { transform: `${to} scale(1)`, filter: REST_SHADOW, opacity: 0 },
    ], { duration: ARENA_MERGE_MS, delay: this.holdMs, easing: SETTLE_EASING, fill: "both" });
    const tappedFrom = source.classList.contains("board-card-stack-tapped");
    if (card && tappedFrom !== merge.tappedTo) {
      // Finish turning before the copy settles onto the stack.
      card.animate([
        turn(tappedFrom),
        { ...turn(merge.tappedTo, 4), offset: .62 },
        { ...turn(merge.tappedTo), offset: .8 },
        turn(merge.tappedTo),
      ], {
        duration: ARENA_MERGE_MS,
        delay: this.holdMs,
        easing: "cubic-bezier(.3, .7, .2, 1)",
        fill: "both",
      });
    }
    const remove = () => {
      ghost.remove();
      this.ghosts.delete(ghost);
    };
    glide.addEventListener("finish", remove);
    glide.addEventListener("cancel", remove);
    return true;
  }
}
