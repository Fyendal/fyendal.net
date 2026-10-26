import type { CardView } from "@fyendal/shared";

/** A localized message reference; the client resolves it with react-intl. */
export interface CardBadgeMessage {
  id: string;
  values?: Record<string, string | number>;
}

interface CardBadgeBase {
  /** Overlay class suffix (`c-<kind>`), which also selects the icon filter. */
  kind: string;
  /** Number drawn over the on-card icon, or shown in an icon-less tile. */
  value?: string;
  /** English on-card copy: the icon's tooltip or the chip's label. */
  text: string;
  title: CardBadgeMessage;
  /** Rules reminder, or public runtime text such as wager rewards. */
  detail?: CardBadgeMessage | { text: string };
}

/** One public status or counter on a card. The card face draws it as an icon,
 * a text chip for icon-less rules counters, or the Marked token; the hover
 * preview spells the same list out beside a matching tile. */
export type CardBadge =
  | (CardBadgeBase & { placement: "overlay"; icon: string })
  | (CardBadgeBase & { placement: "chip" | "token"; icon?: undefined });

export const MARKED_TOKEN_ID = "HNT244";

/** Effective attack statuses supplied by the rendering context rather than
 * the card view itself. */
export interface CardBadgeContext {
  goAgain?: boolean;
  dominate?: boolean;
  overpower?: boolean;
  veil?: boolean;
  showFaceUp?: boolean;
  wagered?: boolean;
  wagerRewards?: readonly string[];
}

/** Rules counters that use the generic text-chip presentation. Card scripts
 * also keep implementation state in CardView.counters, so unknown keys must
 * not become player-facing labels. */
const NAMED_COUNTER_KEYS = new Set([
  "balance",
  "doom",
  "frost",
  "haunt",
  "lessons",
  "rust",
  "sand",
]);

/** Rules counters drawn over their own icon. */
const ICON_COUNTERS = [
  { key: "suspense", kind: "suspensec", icon: "/icons/suspense.png" },
  { key: "verse", kind: "versec", icon: "/icons/verse.png" },
  { key: "flow", kind: "flowc", icon: "/icons/flow.png" },
  { key: "stain", kind: "stainc", icon: "/icons/stain.png" },
  { key: "storm", kind: "stormc", icon: "/icons/storm.png" },
  { key: "aim", kind: "aimc", icon: "/icons/aim.png" },
  { key: "bind", kind: "bindc", icon: "/icons/bind.png" },
] as const;

function signedCounter(value: number): string {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function isFuseCounter(key: string): boolean {
  return key === "fused" || key === "fusedEarth" || key === "fusedIce" || key.startsWith("fused:");
}

function counterTooltip(count: number, name: string): string {
  return `${count} ${name} counter${count === 1 ? "" : "s"}`;
}

function namedCounter(kind: string, name: string, count: number, icon?: string): CardBadge {
  const title = { id: "game.card.badge.counter", values: { count, name } };
  return icon
    ? { kind, placement: "overlay", icon, value: String(count), text: counterTooltip(count, name), title }
    : { kind, placement: "chip", value: String(count), text: `${count} ${name}`, title };
}

/** Every public status and counter on a visible card, in on-card order. */
export function cardBadges(card: CardView, context: CardBadgeContext = {}): CardBadge[] {
  const counters = card.counters ?? {};
  const badges: CardBadge[] = [];
  const flag = (kind: string, icon: string, text: string, titleId: string, detailId?: string) => {
    badges.push({
      kind,
      placement: "overlay",
      icon,
      text,
      title: { id: titleId },
      ...(detailId ? { detail: { id: detailId } } : {}),
    });
  };

  if ((counters.marked ?? 0) > 0) {
    badges.push({ kind: "marked", placement: "token", text: "Marked", title: { id: "game.card.badge.marked" } });
  }
  if (context.goAgain) flag("goagain", "/icons/go-again.png", "Go again", "game.card.badge.goagain");
  if (context.dominate) flag("dominate", "/icons/dominate.png", "Dominate", "game.card.badge.dominate");
  if (context.overpower) flag("overpower", "/icons/overpower.svg", "Overpower", "game.card.badge.overpower");
  if (context.veil) {
    flag(
      "veil",
      "/icons/veil.png",
      "Veil: can't be defended by more than 1 card of each color",
      "game.card.badge.veil",
      "game.card.badge.veil.detail",
    );
  }
  if (context.showFaceUp) flag("faceup", "/icons/face-up.png", "Face up", "game.card.badge.faceup");
  if (card.intimidated === true) {
    flag(
      "intimidated",
      "/icons/intimidated.png",
      "Intimidated — returns to hand at the beginning of the end phase",
      "game.card.badge.intimidated",
      "game.card.badge.intimidated.detail",
    );
  }
  if (card.frozen === true) {
    flag(
      "frozen",
      "/icons/frozen.svg",
      "Frozen — can't be played or activated",
      "game.card.badge.frozen",
      "game.card.badge.frozen.detail",
    );
  }
  if (context.wagered) {
    const rewards = context.wagerRewards?.length ? context.wagerRewards.join("; ") : undefined;
    badges.push({
      kind: "wagered",
      placement: "overlay",
      icon: "/icons/wager.png",
      text: rewards ? `Wagered: ${rewards}` : "Wagered",
      title: { id: "game.card.badge.wagered" },
      ...(rewards ? { detail: { text: rewards } } : {}),
    });
  }
  if (card.life !== undefined) {
    badges.push({
      kind: "lifec",
      placement: "overlay",
      icon: "/icons/life.png",
      value: String(card.life),
      text: `${card.life} life (resets during the end phase)`,
      title: { id: "game.card.badge.life", values: { count: card.life } },
      detail: { id: "game.card.badge.life.detail" },
    });
  }
  if ((counters.attacked ?? 0) > 0) {
    flag(
      "attacked",
      "/icons/sword.svg",
      "Has attacked since the start of its controller's last turn",
      "game.card.badge.attacked",
      "game.card.badge.attacked.detail",
    );
  }
  const power = counters.power ?? 0;
  if (power > 0) {
    badges.push({
      kind: "atkc",
      placement: "overlay",
      icon: "/icons/attack.png",
      value: `+${power}`,
      text: counterTooltip(power, "+1 attack"),
      title: { id: "game.card.badge.power", values: { count: power } },
    });
  }
  if (card.defCounters) {
    badges.push({
      kind: "defc",
      placement: "overlay",
      icon: "/icons/defence.png",
      value: `−${card.defCounters}`,
      text: counterTooltip(card.defCounters, "−1 defense"),
      title: { id: "game.card.badge.defense", values: { count: card.defCounters } },
    });
  }
  const steam = counters.steam ?? 0;
  if (steam > 0) {
    badges.push({
      kind: "steamc",
      placement: "overlay",
      icon: "/icons/gear.png",
      value: String(steam),
      text: counterTooltip(steam, "steam"),
      title: { id: "game.card.badge.steam", values: { count: steam } },
    });
  }
  const energy = counters.energy ?? 0;
  if (energy > 0) {
    badges.push({
      kind: "energyc",
      placement: "overlay",
      icon: "/icons/bolt.webp",
      value: String(energy),
      text: counterTooltip(energy, "energy"),
      title: { id: "game.card.badge.energy", values: { count: energy } },
    });
  }
  for (const { key, kind, icon } of ICON_COUNTERS) {
    const count = counters[key] ?? 0;
    if (count > 0) badges.push(namedCounter(kind, key, count, icon));
  }
  if ((counters.holo ?? 0) > 0) flag("holo", "/icons/holo.png", "Holo", "game.card.badge.holo");
  const arcane = counters.arcaneBonus ?? 0;
  if (arcane !== 0) {
    badges.push({
      kind: "arcanec",
      placement: "overlay",
      icon: "/icons/arcane.png",
      value: signedCounter(arcane),
      text: `${signedCounter(arcane)} arcane damage`,
      title: { id: "game.card.badge.arcane", values: { amount: signedCounter(arcane) } },
    });
  }
  if (Object.entries(counters).some(([key, value]) => isFuseCounter(key) && value > 0)) {
    flag("fusec", "/icons/fuse.png", "Fused", "game.card.badge.fused");
  }
  for (const [key, count] of Object.entries(counters)) {
    if (NAMED_COUNTER_KEYS.has(key) && count !== 0) badges.push(namedCounter(`named-${key}`, key, count));
  }
  return badges;
}

/** Badges registered by each rendered card face, so the hover preview can
 * repeat exactly what the hovered presentation shows. */
const renderedBadges = new WeakMap<Element, readonly CardBadge[]>();

export function registerCardBadges(element: Element, badges: readonly CardBadge[]): void {
  renderedBadges.set(element, badges);
}

/** The badges a card face last rendered, or undefined when it shows none. */
export function renderedCardBadges(element: Element): readonly CardBadge[] | undefined {
  const badges = renderedBadges.get(element);
  return badges?.length ? badges : undefined;
}
