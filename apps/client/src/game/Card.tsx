import { createContext, useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { CardView } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { ViewportTooltip } from "../components/ViewportTooltip.js";
import {
  hasLegacySquareCardFrame,
  hasTallEquipmentCardFrame,
  isMarvelCardImageUrl,
  resolveCardImageUrl,
  resolveCardImageUrls,
} from "./cardImageUrl.js";
import { cardFrontFaceId } from "./cardPreviewFaces.js";
import { MARKED_TOKEN_ID, cardBadges, registerCardBadges } from "./cardBadges.js";

const PITCH_CLASS: Record<number, string> = {
  1: "pitch-red",
  2: "pitch-yellow",
  3: "pitch-blue",
  4: "pitch-purple",
};
const SquareCardPresentationContext = createContext(false);
/** Per-seat printing id -> image id chosen by each card's owner. */
const CardArtContext = createContext<readonly [Record<string, string>, Record<string, string>] | null>(null);

export function CardArtProvider({
  art,
  children,
}: {
  art: readonly [Record<string, string>, Record<string, string>] | null;
  children?: ReactNode;
}) {
  return <CardArtContext.Provider value={art}>{children}</CardArtContext.Provider>;
}

/** Image the owner chose for a card, for surfaces that render it outside CardFace. */
export function useCardArt(): (owner: number | undefined, cardId: string) => string | undefined {
  const art = useContext(CardArtContext);
  return (owner, cardId) => owner === undefined ? undefined : art?.[owner]?.[cardId];
}

export function SquareCardPresentation({ enabled, children }: { enabled: boolean; children?: ReactNode }) {
  return (
    <SquareCardPresentationContext.Provider value={enabled}>
      {children}
    </SquareCardPresentationContext.Provider>
  );
}
export const CARD_IMAGE_ASPECT_RATIO = 546 / 762;
export const CARD_PREVIEW_HEIGHT = 413;
export const CARD_PREVIEW_WIDTH = Math.round(CARD_PREVIEW_HEIGHT * CARD_IMAGE_ASPECT_RATIO);

/** Match Talishar's viewport-relative full-card preview. Small desktop windows
 * retain the established preview size. */
export function cardPreviewSize(viewportHeight: number): { width: number; height: number } {
  const height = Math.max(CARD_PREVIEW_HEIGHT, Math.round(viewportHeight * 0.5));
  return { width: Math.round(height * CARD_IMAGE_ASPECT_RATIO), height };
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
  // A tap on a touch screen both enters and focuses the overlay, and that tap
  // usually opens the card preview, so touch never opens this tooltip.
  const touchFocusRef = useRef(false);
  const tooltipActive = hovered || focused;

  return (
    <>
      <span
        ref={overlayRef}
        className={`c-ovl c-${kind}`}
        tabIndex={0}
        aria-describedby={tooltipId}
        onPointerDown={(event) => { touchFocusRef.current = event.pointerType === "touch"; }}
        onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => {
          if (!touchFocusRef.current) setFocused(true);
          touchFocusRef.current = false;
        }}
        onBlur={() => setFocused(false)}
      >
        <img className="c-ovl-icon" src={icon} alt="" aria-hidden="true" />
        {value !== undefined ? <span className="c-ovl-num">{value}</span> : null}
        <span className="c-counter-tip-accessible" id={tooltipId} role="tooltip">
          {tooltip}
        </span>
      </span>
      {tooltipActive ? (
        <ViewportTooltip
          anchor={overlayRef.current}
          content={tooltip}
          className="c-counter-tip"
          gap={9}
          preferredSide="above"
        />
      ) : null}
    </>
  );
}

// Fabrary's CDN serves ~546px-wide images (vs 376px on the LSS bucket).
export const CARD_BACK_IMAGE_URL = "https://content.fabrary.net/cards/cardback.webp";

export function cardImageUrl(cardId: string, artImage?: string): string {
  return resolveCardImageUrl(cardId, cardData[cardId], false, artImage);
}

/** A resilient card-art surface for screens that do not need the interactive
 * game-card frame. The text presentation stays behind the artwork so a failed
 * CDN image never leaves the browser's broken-image icon visible. */
export function CardArtwork({
  cardId,
  artImage,
  className,
  alt,
  width,
  height,
  style,
}: {
  cardId: string;
  /** Alternate Fabrary image chosen for this card. */
  artImage?: string;
  className?: string;
  alt: string;
  width?: number;
  height?: number;
  style?: CSSProperties;
}) {
  const [imageFailure, setImageFailure] = useState<{ cardId: string; attempts: number } | null>(null);
  const data = cardData[cardId];
  const name = data?.name ?? cardId;
  const imageUrls = resolveCardImageUrls(cardId, data, false, artImage);
  const failedAttempts = imageFailure?.cardId === cardId ? imageFailure.attempts : 0;
  const showImg = cardId !== "" && failedAttempts < imageUrls.length;

  return (
    <span
      className={["card-artwork", showImg ? "" : PITCH_CLASS[data?.pitch ?? 0] ?? "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      data-cardid={cardId}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={{ width, height, ...style }}
    >
      <span className="card-artwork-placeholder">
        {data?.cost !== undefined ? <span className="c-cost">{data.cost}</span> : null}
        <span className="c-name">{name}</span>
        {data?.text ? <span className="c-text">{data.text}</span> : null}
        <span className="c-stats">
          {data?.attack !== undefined ? <span className="c-atk">{data.attack}</span> : null}
          {data?.defense !== undefined ? <span className="c-def">{data.defense}</span> : null}
        </span>
      </span>
      {showImg ? (
        <img
          className="card-artwork-image"
          src={imageUrls[failedAttempts]}
          alt=""
          draggable={false}
          loading="eager"
          onError={() => setImageFailure((current) => ({
            cardId,
            attempts: current?.cardId === cardId ? current.attempts + 1 : 1,
          }))}
        />
      ) : null}
    </span>
  );
}

export function CardFace({
  card,
  size = "hand",
  goAgain,
  dominate,
  overpower,
  veil,
  showFaceUp,
  wagered,
  wagerRewards,
  showOverlays = true,
  showStats = true,
  showTapped = true,
  selected,
  pitched,
  highlighted,
  affiliation,
  dimmed,
  ghost,
  onClick,
  label,
  accessibleLabel,
  chainSourceLabel,
  explanation,
  motionKey,
  motionZoneAnchor,
  handReorderHint,
  focusSourceHidden,
  squareArt,
}: {
  card: CardView;
  size?: "hand" | "zone" | "preview";
  /** Effective go again on this card while it is an attack. */
  goAgain?: boolean;
  /** Effective dominate on this card while it is an attack. */
  dominate?: boolean;
  /** Effective overpower on this card while it is an attack. */
  overpower?: boolean;
  /** Effective veil on this card while it is an attack. */
  veil?: boolean;
  /** Show an explicit face-up status hint for a zone where face-down is the default. */
  showFaceUp?: boolean;
  /** Whether this attack has wagered on its current chain link. */
  wagered?: boolean;
  /** Public reward description for each wager completed by this attack. */
  wagerRewards?: readonly string[];
  /** Whether status and counter icons should be rendered in this presentation. */
  showOverlays?: boolean;
  /** Whether card stats should be rendered outside the artwork. */
  showStats?: boolean;
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
  /** Names a clickable card for assistive technology when its description is
   * shown beside the card rather than over the artwork. */
  accessibleLabel?: string;
  /** Marks the arena card that supplied the current combat-chain attack. */
  chainSourceLabel?: string;
  /** Availability context shown on hover or keyboard focus. */
  explanation?: string;
  /** Stable viewer-safe presentation key used only for board motion geometry. */
  motionKey?: string;
  /** Card-sized endpoint for a surrounding motion zone. */
  motionZoneAnchor?: string;
  /** Local hand sorting affordance, supplied only by the player's hand. */
  handReorderHint?: string;
  /** Hide the hand copy while this card is displayed in the pitch focus. */
  focusSourceHidden?: boolean;
  /** Square presentation for cards in the desktop arena. */
  squareArt?: boolean;
}) {
  const squarePresentationEnabled = useContext(SquareCardPresentationContext);
  const cardArt = useContext(CardArtContext);
  const squareCard = size === "zone" && (squareArt ?? squarePresentationEnabled);
  // Try temporary Fabrary variants before falling back to the text layout.
  const [imageFailure, setImageFailure] = useState<{ cardId: string; attempts: number } | null>(null);
  const badges = cardBadges(card, { goAgain, dominate, overpower, veil, showFaceUp, wagered, wagerRewards });
  const marked = badges.some((badge) => badge.placement === "token");
  const overlays = badges.flatMap((badge) => badge.placement === "overlay" ? [badge] : []);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (rootRef.current) registerCardBadges(rootRef.current, badges);
  });
  // identity is secret to this viewer — render as a card back; the intimidated
  // marker is public, so its standard card overlay shows on the back too
  if (card.hidden) {
    return (
      <span
        className="card-hidden-wrap"
        data-motion-card={motionKey}
        data-motion-zone-anchor={motionZoneAnchor}
      >
        <CardBack label={label ?? "Face down"} size={size === "hand" ? "hand" : "zone"} square={squareCard} />
        {showOverlays && card.intimidated ? (
          <div className="c-ovls">
            {overlays.filter((badge) => badge.kind === "intimidated").map((badge) => (
              <CounterOverlay
                key={badge.kind}
                cardInstanceId={card.instanceId}
                kind={badge.kind}
                icon={badge.icon}
                tooltip={badge.text}
              />
            ))}
          </div>
        ) : null}
      </span>
    );
  }
  const data = cardData[card.cardId];
  const name = data?.name ?? card.name ?? card.cardId;
  const imageUrls = resolveCardImageUrls(card.cardId, data, false, cardArt?.[card.owner]?.[card.cardId]);
  const failedAttempts = imageFailure?.cardId === card.cardId ? imageFailure.attempts : 0;
  const imageUrl = card.cardId !== "" ? imageUrls[failedAttempts] : undefined;
  const showImg = imageUrl !== undefined;
  const marvelArt = imageUrl !== undefined && isMarvelCardImageUrl(imageUrl);
  const legacySquareFrame = imageUrl !== undefined && !marvelArt && hasLegacySquareCardFrame(imageUrl);
  const tallEquipmentFrame = imageUrl !== undefined && !marvelArt && hasTallEquipmentCardFrame(imageUrl);
  const attack = card.attack ?? data?.attack;
  const defense = card.defense ?? data?.defense;
  const squareHero = data?.cardType === "hero";
  const printedArenaFrame = squareHero || data?.cardType === "weapon" ||
    data?.cardType === "equipment" || data?.cardType === "token";
  // A transformed back face (Nitro Mechanoid) has no pitch; show its front's.
  const frontFaceId = cardFrontFaceId(card.cardId);
  const stripPitch = data?.pitch ?? (frontFaceId ? cardData[frontFaceId]?.pitch : undefined);
  const squarePitch = stripPitch && PITCH_CLASS[stripPitch] ? stripPitch : undefined;
  const printedLife = data?.life;
  const hasOverlays = showOverlays && overlays.length > 0;
  const cls = [
    "card",
    size === "zone" ? "card-zone" : size === "preview" ? "card-preview-frame" : "card-hand",
    squareCard ? "card-board-square" : "",
    squareCard && marvelArt ? "card-board-square-marvel" : "",
    focusSourceHidden ? "pitch-focus-source-hidden" : "",
    showImg ? "card-hasimg" : "",
    selected ? "card-selected" : "",
    pitched ? "card-pitched" : "",
    highlighted ? "card-highlight" : "",
    affiliation ? `card-${affiliation}` : "",
    dimmed ? "card-dim" : "",
    showTapped && card.tapped ? "card-tapped" : "",
    ghost ? "card-ghost" : "",
    onClick ? "card-clickable" : "",
    chainSourceLabel ? "card-chain-source" : "",
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
      ref={rootRef}
      className={cls}
      data-cardid={card.cardId}
      data-card-instance-id={card.instanceId}
      data-motion-card={motionKey}
      data-motion-zone-anchor={motionZoneAnchor}
      data-hand-instance-id={handReorderHint ? card.instanceId : undefined}
      tabIndex={!onClick && (explanation || handReorderHint) ? 0 : undefined}
      aria-describedby={!onClick ? explanationId : undefined}
      aria-description={!onClick ? handReorderHint : undefined}
      aria-keyshortcuts={handReorderHint ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
      onClick={onClick}
    >
      {onClick ? (
        <button
          type="button"
          className="card-action"
          aria-label={label || accessibleLabel ? `${name} — ${label || accessibleLabel}` : name}
          aria-describedby={explanationId}
          aria-description={handReorderHint}
          aria-keyshortcuts={handReorderHint ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
        />
      ) : null}
      {squareCard ? (
        <>
          <span
            className={`board-square-media${legacySquareFrame ? " board-square-media-legacy" : ""}`}
            data-card-type={!marvelArt ? data?.cardType : undefined}
            aria-hidden="true"
          >
            {showImg ? (
              <img
                className="c-img board-square-art"
                src={imageUrl}
                alt=""
                draggable={false}
                loading="eager"
                onError={() => setImageFailure((current) => ({
                  cardId: card.cardId,
                  attempts: current?.cardId === card.cardId ? current.attempts + 1 : 1,
                }))}
              />
            ) : null}
            {showImg && !marvelArt && printedArenaFrame ? (
              <svg
                className="board-square-printed-frame"
                viewBox={tallEquipmentFrame ? "48 170 904 922"
                  : legacySquareFrame ? "48 170 904 695"
                    : squareHero ? "48 170 904 680" : "48 170 904 660"}
                preserveAspectRatio="none"
                focusable="false"
              >
                <image href={imageUrl} width="1000" height="1395.6" />
              </svg>
            ) : showImg && !marvelArt ? (
              <>
                <span className="board-square-frame-edge board-square-frame-left">
                  <img src={imageUrl} alt="" draggable={false} />
                </span>
                <span className="board-square-frame-edge board-square-frame-right">
                  <img src={imageUrl} alt="" draggable={false} />
                </span>
              </>
            ) : null}
          </span>
          {marvelArt ? (
            <span className="board-square-accessible-name">{name}</span>
          ) : (
            <div
              className={`board-square-name${data?.cardType === "hero" ? " board-square-name-hero" : ""}`}
              data-card-type={data?.cardType}
              data-pitch={squarePitch}
              title={name}
            >
              {squarePitch !== undefined ? (
                <div className="board-square-pitch-backing" aria-hidden="true" />
              ) : null}
              <span className="board-square-name-frame">
                <span className="board-square-name-text">{name}</span>
              </span>
            </div>
          )}
          {showStats && (
            attack !== undefined || defense !== undefined ||
            (squareHero && data.intellect !== undefined) || printedLife !== undefined
          ) ? (
            <span className="board-square-stats">
              {attack !== undefined ? (
                <span className="board-square-stat">
                  <img src="/icons/attack.png" alt="" aria-hidden="true" />
                  {attack}
                </span>
              ) : null}
              {defense !== undefined ? (
                <span className="board-square-stat">
                  <img src="/icons/defence.png" alt="" aria-hidden="true" />
                  {defense}
                </span>
              ) : null}
              {squareHero && data.intellect !== undefined ? (
                <span className="board-square-stat board-square-stat-intellect">
                  <img src="/icons/intellect.png" alt="" aria-hidden="true" />
                  {data.intellect}
                </span>
              ) : null}
              {printedLife !== undefined ? (
                <span className="board-square-stat">
                  <img src="/icons/life.png" alt="" aria-hidden="true" />
                  {printedLife}
                </span>
              ) : null}
            </span>
          ) : null}
        </>
      ) : showImg ? (
        <img
          className="c-img"
          src={imageUrl}
          alt={name}
          draggable={false}
          loading="eager"
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
          {showStats ? (
            <div className="c-stats">
              {attack !== undefined && <span className="c-atk">{attack}</span>}
              {defense !== undefined && <span className="c-def">{defense}</span>}
            </div>
          ) : null}
        </>
      )}
      {label && <div className="c-zonelabel">{label}</div>}
      {chainSourceLabel ? (
        <div className="card-chain-source-badge" title={chainSourceLabel}>
          {chainSourceLabel}
        </div>
      ) : null}
      {marked ? (
        <div className="c-marked-token">
          <span className="c-marked-brand">
            <img
              src={cardImageUrl(MARKED_TOKEN_ID)}
              alt="Marked"
              draggable={false}
              loading="eager"
            />
          </span>
        </div>
      ) : null}
      {hasOverlays && (
        <div className="c-ovls">
          {overlays.map((badge) => (
            <CounterOverlay
              key={badge.kind}
              cardInstanceId={card.instanceId}
              kind={badge.kind}
              icon={badge.icon}
              tooltip={badge.text}
              value={badge.value}
            />
          ))}
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
  size = "zone",
  square,
  motionKey,
  motionZoneAnchor,
  onClick,
  ariaLabel,
  className,
}: {
  count?: number;
  /** Visible label over the back; an empty label shows the plain back. */
  label: string;
  size?: "zone" | "hand";
  square?: boolean;
  motionKey?: string;
  /** Optional card-sized endpoint for an otherwise broad motion zone. */
  motionZoneAnchor?: string;
  onClick?: () => void;
  /** Accessible name for a clickable back; defaults to the visible label. */
  ariaLabel?: string;
  /** Contextual state classes such as decision highlight and affiliation. */
  className?: string;
}) {
  const squarePresentationEnabled = useContext(SquareCardPresentationContext);
  const squareCard = size === "zone" && (square ?? squarePresentationEnabled);
  return (
    <div
      className={[
        "card",
        size === "hand" ? "card-hand" : "card-zone",
        "card-back",
        squareCard ? "card-back-square" : "",
        onClick ? "card-clickable" : "",
        className,
      ].filter(Boolean).join(" ")}
      data-motion-card={motionKey}
      data-motion-zone-anchor={motionZoneAnchor}
    >
      {onClick ? (
        <button
          type="button"
          className="card-action"
          aria-label={ariaLabel || label || "Card back"}
          onClick={onClick}
        />
      ) : null}
      <img
        className="c-backimg"
        src={CARD_BACK_IMAGE_URL}
        alt=""
        aria-hidden="true"
        draggable={false}
        loading="eager"
      />
      {label ? <div className="c-backlabel">{label}</div> : null}
      {count !== undefined && <div className="c-count">{count}</div>}
    </div>
  );
}

/** Present a graveyard or banished card without leaking hidden identities.
 * An expanded private view may show an identity already projected to its owner;
 * opponents still receive a hidden CardView and therefore keep seeing a card back. */
export function InactiveZoneCard({
  card,
  showOverlays = true,
  squareArt,
  showFaceDownIdentity = false,
  revealOwnerIntimidated = false,
  highlighted = false,
  motionKey,
}: {
  card: CardView;
  showOverlays?: boolean;
  squareArt?: boolean;
  /** Privately show a known face-down card while preserving its face-down state visually. */
  showFaceDownIdentity?: boolean;
  revealOwnerIntimidated?: boolean;
  highlighted?: boolean;
  motionKey?: string;
}) {
  const showKnownFaceDown = showFaceDownIdentity &&
    card.faceDown === true &&
    card.hidden !== true;
  const revealIntimidated = revealOwnerIntimidated &&
    card.faceDown === true &&
    card.intimidated === true &&
    card.hidden !== true;
  if (card.faceDown !== true || showKnownFaceDown || revealIntimidated) {
    return (
      <CardFace
        card={card}
        size="zone"
        squareArt={squareArt}
        showOverlays={showOverlays}
        showTapped={false}
        dimmed={showKnownFaceDown}
        highlighted={highlighted}
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
      squareArt={squareArt}
      showOverlays={showOverlays}
      showTapped={false}
      highlighted={highlighted}
      motionKey={motionKey}
    />
  );
}
