import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CardView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { resolveCardImageUrl, resolveCardImageUrls } from "./cardImageUrl.js";

const PITCH_CLASS: Record<number, string> = { 1: "pitch-red", 2: "pitch-yellow", 3: "pitch-blue" };
const MARKED_TOKEN_ID = "HNT244";
const INTIMIDATED_TOOLTIP = "Intimidated — returns to hand at the beginning of the end phase";
/** Rules counters that use the generic text-chip presentation. Card scripts
 * also keep implementation state in CardView.counters, so unknown keys must
 * not become player-facing labels. */
const NAMED_COUNTER_KEYS = new Set([
  "aim",
  "balance",
  "bind",
  "doom",
  "flow",
  "frost",
  "haunt",
  "lessons",
  "rust",
  "sand",
  "stain",
  "storm",
]);
export const CARD_PREVIEW_WIDTH = 300;
export const CARD_PREVIEW_HEIGHT = 413;

function signedCounter(value: number): string {
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
}

function isFuseCounter(key: string): boolean {
  return key === "fused" || key === "fusedEarth" || key === "fusedIce" || key.startsWith("fused:");
}

function counterTooltip(count: number, name: string): string {
  return `${count} ${name} counter${count === 1 ? "" : "s"}`;
}

function CounterOverlay({
  cardInstanceId,
  kind,
  icon,
  tooltip,
  value,
}: {
  cardInstanceId: number;
  kind: string;
  icon: string;
  tooltip: string;
  value?: string;
}) {
  // A public card instance may be rendered in both its arena zone and the
  // combat chain, so useId keeps the tooltip relationship unique in the DOM.
  const tooltipId = `card-counter-${cardInstanceId}-${kind}-${useId()}`;
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const tooltipActive = hovered || focused;

  useEffect(() => {
    if (!tooltipActive) {
      setTooltipPosition(null);
      return;
    }
    const updatePosition = () => {
      const overlay = overlayRef.current;
      if (!overlay) return;
      const anchor = overlay.getBoundingClientRect();
      setTooltipPosition({
        left: anchor.left + anchor.width / 2,
        bottom: window.innerHeight - anchor.top + 9,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [tooltipActive]);

  return (
    <>
      <span
        ref={overlayRef}
        className={`c-ovl c-${kind}`}
        tabIndex={0}
        aria-describedby={tooltipId}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <img className="c-ovl-icon" src={icon} alt="" aria-hidden="true" />
        {value !== undefined ? <span className="c-ovl-num">{value}</span> : null}
        <span className="c-counter-tip-accessible" id={tooltipId} role="tooltip">
          {tooltip}
        </span>
      </span>
      {tooltipActive && tooltipPosition && typeof document !== "undefined"
        ? createPortal(
            <span
              className="c-counter-tip c-counter-tip-floating"
              aria-hidden="true"
              style={tooltipPosition}
            >
              {tooltip}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

// Fabrary's CDN serves ~546px-wide images (vs 376px on the LSS bucket).
export const CARD_BACK_IMAGE_URL = "https://content.fabrary.net/cards/cardback.webp";

export function cardImageUrl(cardId: string): string {
  return resolveCardImageUrl(cardId, cardData[cardId]);
}

export function CardFace({
  card,
  size = "hand",
  goAgain,
  dominate,
  overpower,
  showFaceUp,
  wagered,
  wagerRewards,
  showOverlays = true,
  showTapped = true,
  selected,
  pitched,
  highlighted,
  affiliation,
  dimmed,
  ghost,
  onClick,
  label,
  explanation,
  motionKey,
}: {
  card: CardView;
  size?: "hand" | "zone" | "preview";
  /** Effective go again on this card while it is an attack. */
  goAgain?: boolean;
  /** Effective dominate on this card while it is an attack. */
  dominate?: boolean;
  /** Effective overpower on this card while it is an attack. */
  overpower?: boolean;
  /** Show an explicit face-up status hint for a zone where face-down is the default. */
  showFaceUp?: boolean;
  /** Whether this attack has wagered on its current chain link. */
  wagered?: boolean;
  /** Public reward description for each wager completed by this attack. */
  wagerRewards?: readonly string[];
  /** Whether status and counter icons should be rendered in this presentation. */
  showOverlays?: boolean;
  /** Whether arena tap state should rotate this presentation of the card. */
  showTapped?: boolean;
  selected?: boolean;
  /** Selected as payment rather than as the card being played/activated. */
  pitched?: boolean;
  highlighted?: boolean;
  /** Optional viewer-relative ownership accent for contextual card lists. */
  affiliation?: "friendly" | "opponent";
  dimmed?: boolean;
  /** playable from another zone (banish/graveyard): shown as a faded hand ghost */
  ghost?: boolean;
  onClick?: () => void;
  label?: string;
  /** Availability context shown on hover or keyboard focus. */
  explanation?: string;
  /** Stable viewer-safe presentation key used only for board motion geometry. */
  motionKey?: string;
}) {
  // Try temporary Fabrary variants before falling back to the text layout.
  const [imageFailure, setImageFailure] = useState<{ cardId: string; attempts: number } | null>(null);
  // identity is secret to this viewer — render as a card back; the intimidated
  // marker is public, so its standard card overlay shows on the back too
  if (card.hidden) {
    return (
      <span className="card-hidden-wrap" data-motion-card={motionKey}>
        <CardBack label={label ?? "Face down"} />
        {showOverlays && card.intimidated ? (
          <div className="c-ovls">
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="intimidated"
              icon="/icons/intimidated.png"
              tooltip={INTIMIDATED_TOOLTIP}
            />
          </div>
        ) : null}
      </span>
    );
  }
  const data = cardData[card.cardId];
  const name = data?.name ?? card.name ?? card.cardId;
  const imageUrls = resolveCardImageUrls(card.cardId, data);
  const failedAttempts = imageFailure?.cardId === card.cardId ? imageFailure.attempts : 0;
  const showImg = card.cardId !== "" && failedAttempts < imageUrls.length;
  const attack = card.attack ?? data?.attack;
  const defense = card.defense ?? data?.defense;
  const marked = (card.counters?.marked ?? 0) > 0;
  const namedCounters = Object.entries(card.counters ?? {}).filter(
    ([counter, count]) =>
      NAMED_COUNTER_KEYS.has(counter) &&
      count !== 0,
  );
  const steamCounters = card.counters?.steam ?? 0;
  const energyCounters = card.counters?.energy ?? 0;
  const suspenseCounters = card.counters?.suspense ?? 0;
  const verseCounters = card.counters?.verse ?? 0;
  const holo = (card.counters?.holo ?? 0) > 0;
  const arcaneModifier = card.counters?.arcaneBonus ?? 0;
  const attacked = (card.counters?.attacked ?? 0) > 0;
  const fused = Object.entries(card.counters ?? {}).some(
    ([counter, value]) => isFuseCounter(counter) && value > 0,
  );
  const hasOverlays = showOverlays && (
    card.life !== undefined ||
      goAgain === true ||
      dominate === true ||
      overpower === true ||
      showFaceUp === true ||
      wagered === true ||
      card.intimidated === true ||
      (card.counters?.power ?? 0) > 0 ||
      !!card.defCounters ||
      steamCounters > 0 ||
      energyCounters > 0 ||
      suspenseCounters > 0 ||
      verseCounters > 0 ||
      holo ||
      arcaneModifier !== 0 ||
      attacked ||
      fused
  );
  const cls = [
    "card",
    size === "zone" ? "card-zone" : size === "preview" ? "card-preview-frame" : "card-hand",
    showImg ? "card-hasimg" : "",
    selected ? "card-selected" : "",
    pitched ? "card-pitched" : "",
    highlighted ? "card-highlight" : "",
    affiliation ? `card-${affiliation}` : "",
    dimmed ? "card-dim" : "",
    showTapped && card.tapped ? "card-tapped" : "",
    ghost ? "card-ghost" : "",
    onClick ? "card-clickable" : "",
    explanation ? "card-explained" : "",
    hasOverlays ? "card-countered" : "",
    // the pitch strip is redundant when the real card image is shown
    !showImg && data ? PITCH_CLASS[data.pitch ?? 0] ?? "" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const text = data?.text ?? "";
  const explanationId = explanation ? `card-explanation-${card.instanceId}` : undefined;
  return (
    <div
      className={cls}
      data-cardid={card.cardId}
      data-motion-card={motionKey}
      onClick={onClick}
      tabIndex={explanation ? 0 : undefined}
      aria-describedby={explanationId}
    >
      {showImg ? (
        <img
          className="c-img"
          src={imageUrls[failedAttempts]}
          alt={name}
          draggable={false}
          loading="lazy"
          onError={() => setImageFailure((current) => ({
            cardId: card.cardId,
            attempts: current?.cardId === card.cardId ? current.attempts + 1 : 1,
          }))}
        />
      ) : (
        <>
          {data?.cost !== undefined && <div className="c-cost">{data.cost}</div>}
          <div className="c-name">{name}</div>
          {size === "preview" && data && (
            <div className="c-type">
              {data.cardType}
              {data.pitch ? ` · pitch ${data.pitch}` : ""}
            </div>
          )}
          {size !== "zone" && text && <div className="c-text">{text}</div>}
          <div className="c-stats">
            {attack !== undefined && <span className="c-atk">{attack}</span>}
            {defense !== undefined && <span className="c-def">{defense}</span>}
          </div>
        </>
      )}
      {label && <div className="c-zonelabel">{label}</div>}
      {marked ? (
        <div className="c-marked-token" title="Marked">
          <img
            src={cardImageUrl(MARKED_TOKEN_ID)}
            alt="Marked"
            draggable={false}
            loading="lazy"
          />
        </div>
      ) : null}
      {namedCounters.length > 0 && (
        <div className="c-chips">
          {namedCounters.map(([name, n]) => (
            <div key={name} className="c-chip">
              {n} {name}
            </div>
          ))}
        </div>
      )}
      {hasOverlays && (
        <div className="c-ovls">
          {goAgain ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="goagain"
              icon="/icons/go-again.png"
              tooltip="Go again"
            />
          ) : null}
          {dominate ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="dominate"
              icon="/icons/dominate.png"
              tooltip="Dominate"
            />
          ) : null}
          {overpower ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="overpower"
              icon="/icons/overpower.svg"
              tooltip="Overpower"
            />
          ) : null}
          {showFaceUp ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="faceup"
              icon="/icons/face-up.png"
              tooltip="Face up"
            />
          ) : null}
          {card.intimidated === true ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="intimidated"
              icon="/icons/intimidated.png"
              tooltip={INTIMIDATED_TOOLTIP}
            />
          ) : null}
          {wagered ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="wagered"
              icon="/icons/wager.png"
              tooltip={wagerRewards?.length
                ? `Wagered: ${wagerRewards.join("; ")}`
                : "Wagered"}
            />
          ) : null}
          {card.life !== undefined ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="lifec"
              icon="/icons/life.png"
              tooltip={`${card.life} life (resets during the end phase)`}
              value={String(card.life)}
            />
          ) : null}
          {attacked ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="attacked"
              icon="/icons/sword.svg"
              tooltip="Has attacked since the start of its controller's last turn"
            />
          ) : null}
          {(card.counters?.power ?? 0) > 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="atkc"
              icon="/icons/attack.png"
              tooltip={counterTooltip(card.counters?.power ?? 0, "+1 attack")}
              value={`+${card.counters?.power ?? 0}`}
            />
          ) : null}
          {card.defCounters ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="defc"
              icon="/icons/defence.png"
              tooltip={counterTooltip(card.defCounters, "−1 defense")}
              value={`−${card.defCounters}`}
            />
          ) : null}
          {steamCounters > 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="steamc"
              icon="/icons/gear.png"
              tooltip={counterTooltip(steamCounters, "steam")}
              value={String(steamCounters)}
            />
          ) : null}
          {energyCounters > 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="energyc"
              icon="/icons/bolt.webp"
              tooltip={counterTooltip(energyCounters, "energy")}
              value={String(energyCounters)}
            />
          ) : null}
          {suspenseCounters > 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="suspensec"
              icon="/icons/suspense.png"
              tooltip={counterTooltip(suspenseCounters, "suspense")}
              value={String(suspenseCounters)}
            />
          ) : null}
          {verseCounters > 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="versec"
              icon="/icons/verse.png"
              tooltip={counterTooltip(verseCounters, "verse")}
              value={String(verseCounters)}
            />
          ) : null}
          {holo ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="holo"
              icon="/icons/holo.png"
              tooltip="Holo"
            />
          ) : null}
          {arcaneModifier !== 0 ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="arcanec"
              icon="/icons/arcane.png"
              tooltip={`${signedCounter(arcaneModifier)} arcane damage`}
              value={signedCounter(arcaneModifier)}
            />
          ) : null}
          {fused ? (
            <CounterOverlay
              cardInstanceId={card.instanceId}
              kind="fusec"
              icon="/icons/fuse.png"
              tooltip="Fused"
            />
          ) : null}
        </div>
      )}
      {explanation ? (
        <span className="card-explanation" id={explanationId} role="tooltip">
          {explanation}
        </span>
      ) : null}
    </div>
  );
}

export function CardBack({
  count,
  label,
  motionKey,
  motionZoneAnchor,
  onClick,
}: {
  count?: number;
  label: string;
  motionKey?: string;
  /** Optional card-sized endpoint for an otherwise broad motion zone. */
  motionZoneAnchor?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`card card-zone card-back ${onClick ? "card-clickable" : ""}`}
      data-motion-card={motionKey}
      data-motion-zone-anchor={motionZoneAnchor}
      onClick={onClick}
    >
      <img
        className="c-backimg"
        src={CARD_BACK_IMAGE_URL}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="lazy"
      />
      {label ? <div className="c-backlabel">{label}</div> : null}
      {count !== undefined && <div className="c-count">{count}</div>}
    </div>
  );
}

/** Present a graveyard or banished card without leaking hidden identities.
 * The expanded zone list may reveal an owner's intimidated card because its
 * identity is already projected to that owner; opponents still receive a
 * hidden CardView and therefore keep seeing a card back. */
export function InactiveZoneCard({
  card,
  showOverlays = true,
  revealOwnerIntimidated = false,
  motionKey,
}: {
  card: CardView;
  showOverlays?: boolean;
  revealOwnerIntimidated?: boolean;
  motionKey?: string;
}) {
  const revealIntimidated = revealOwnerIntimidated &&
    card.faceDown === true &&
    card.intimidated === true &&
    card.hidden !== true;
  if (card.faceDown !== true || revealIntimidated) {
    return (
      <CardFace
        card={card}
        size="zone"
        showOverlays={showOverlays}
        motionKey={motionKey}
      />
    );
  }

  const faceDownCard = card.hidden
    ? card
    : { ...card, cardId: "", hidden: true as const };
  return (
    <CardFace
      card={faceDownCard}
      size="zone"
      showOverlays={showOverlays}
      motionKey={motionKey}
    />
  );
}
