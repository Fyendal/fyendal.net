import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type {
  CardView,
  ChainLinkView,
  CombatValueModifierView,
  OnHitEffectView,
} from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { CardFace } from "./Card.js";
import { chainTimelineRevision } from "./chainTimeline.js";
import type { FloatVisibilityController } from "./floatVisibility.js";
import { useFloatDrag } from "./useFloatDrag.js";

function ChainStat({
  kind,
  value,
  modifiers,
}: {
  kind: "attack" | "defense" | "prevention";
  value: number;
  modifiers: readonly CombatValueModifierView[];
}) {
  const baseValue = value - modifiers.reduce((sum, modifier) => sum + modifier.amount, 0);
  const label = kind === "attack" ? "Attack" : kind === "defense" ? "Defense" : "Prevention";
  return (
    <span
      className={`chain-stat chain-${kind === "attack" ? "atk" : kind === "defense" ? "def" : "prevent"}`}
      tabIndex={0}
      aria-label={kind === "prevention" ? `${label}: ${value}` : undefined}
    >
      {kind !== "prevention" ? (
        <img className="ico ico-lg" src={`/icons/${kind === "attack" ? "attack" : "defence"}.png`} alt={kind} />
      ) : null}
      {value}
      <span className="chain-breakdown" role="tooltip">
        <strong>{label} modifiers</strong>
        {kind === "attack" ? (
          <span className="chain-modifier chain-base-value">
            <span>Base</span>
            <strong>{baseValue}</strong>
          </span>
        ) : null}
        {modifiers.length === 0 ? <span>No modifiers</span> : modifiers.map((modifier, index) => (
          <span className="chain-modifier" key={`${modifier.sourceCardId}:${modifier.amount}:${index}`}>
            {modifier.sourceCardId ? (
              <span className="card-ref" data-cardid={modifier.sourceCardId}>
                {cardData[modifier.sourceCardId]?.name ?? "Card"}
              </span>
            ) : (
              <span>Hidden effect</span>
            )}
            <strong className={modifier.amount > 0 ? "modifier-positive" : "modifier-negative"}>
              {modifier.amount > 0 ? "+" : ""}{modifier.amount}
            </strong>
          </span>
        ))}
      </span>
    </span>
  );
}

function ChainMinimizeButton({
  placement,
  onMinimize,
}: {
  placement: "header" | "corner";
  onMinimize: () => void;
}) {
  return (
    <button
      className={`chain-hide chain-hide-${placement}`}
      aria-label="Minimize combat chain"
      title="Minimize combat chain"
      onClick={onMinimize}
    >
      <span className="chain-hide-icon" aria-hidden="true">—</span>
    </button>
  );
}

function OnHitBadge({
  attackInstanceId,
  effects,
}: {
  attackInstanceId: number;
  effects: readonly OnHitEffectView[];
}) {
  const tooltipId = `chain-on-hit-${attackInstanceId}`;
  const mobileDialogTitleId = `${tooltipId}-mobile-title`;
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);
  const effectList = effects.map((effect, index) => (
    <span
      className="chain-on-hit-effect"
      key={`${effect.sourceCardId}:${effect.text}:${index}`}
    >
      {effect.sourceCardId ? (
        <span className="card-ref" data-cardid={effect.sourceCardId}>
          {cardData[effect.sourceCardId]?.name ?? "Card"}
        </span>
      ) : (
        <span>Hidden effect</span>
      )}
      <span>{effect.text}</span>
    </span>
  ));
  return (
    <>
      <button
        type="button"
        className="chain-on-hit"
        aria-describedby={tooltipId}
        aria-haspopup="dialog"
        aria-expanded={mobileOpen}
        title=""
        onClick={() => {
          if (window.matchMedia("(max-width: 700px)").matches) setMobileOpen(true);
        }}
      >
        <span className="chain-on-hit-label">On hit</span>
        <span className="chain-on-hit-tip" id={tooltipId} role="tooltip">
          <strong>On-hit effects</strong>
          {effectList}
        </span>
      </button>
      {mobileOpen && typeof document !== "undefined"
        ? createPortal(
          <div className="chain-on-hit-mobile-backdrop" onClick={() => setMobileOpen(false)}>
            <section
              className="chain-on-hit-mobile-tip"
              role="dialog"
              aria-modal="true"
              aria-labelledby={mobileDialogTitleId}
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <strong id={mobileDialogTitleId}>On-hit effects</strong>
                <button
                  type="button"
                  aria-label="Close on-hit effects"
                  onClick={() => setMobileOpen(false)}
                >
                  ×
                </button>
              </header>
              {effectList}
            </section>
          </div>,
          document.body,
        )
        : null}
    </>
  );
}

export function chainAttackIsActivatable(
  link: ChainLinkView | undefined,
  index: number,
  linkCount: number,
  activatableAttackIds?: ReadonlySet<number>,
): boolean {
  return index === linkCount - 1 &&
    link?.resolved !== true &&
    (activatableAttackIds?.has(link?.attackingCard.instanceId ?? -1) ?? false);
}

/** Pointer browsing should return focus to the game board so Space remains the
 * pass shortcut. Keyboard activation has detail 0 and keeps native focus. */
export function browseChainLink(
  button: Pick<HTMLButtonElement, "blur">,
  clickDetail: number,
  browse: () => void,
): void {
  browse();
  if (clickDetail > 0) button.blur();
}

/** Floating combat chain panel: draggable + hidable, past links browsable.
 *  Reports its on-screen rect via `onRect` so the status window can dock
 *  to its right edge (null while hidden or no chain is open).
 *  During the defend step, `staged` defenders (clicked but not yet committed)
 *  render on the current link at reduced opacity and count into the live
 *  defense value; clicking one unstages it. */
export function ChainFloat({
  links,
  onRect,
  staged = [],
  stagedDefense = 0,
  onUnstage,
  onUnstageAll,
  onCloseChain,
  activatableAttackIds,
  selectedAbilitySourceInstanceId,
  onActivateAttack,
  miniHost,
  visibility,
  children,
}: {
  links: ChainLinkView[];
  onRect: React.Dispatch<React.SetStateAction<DOMRect | null>>;
  /** defenders staged on the current link this defend step */
  staged?: CardView[];
  /** combined defense value of the staged cards */
  stagedDefense?: number;
  onUnstage?: (instanceId: number) => void;
  /** clear every defender staged on the current link */
  onUnstageAll?: () => void;
  /** the chain is open and closable by the viewer — shows a close button */
  onCloseChain?: (() => void) | null;
  /** Attacking cards with an activated ability in the authoritative legal intents. */
  activatableAttackIds?: ReadonlySet<number>;
  selectedAbilitySourceInstanceId?: number | null;
  onActivateAttack?: (instanceId: number) => void;
  /** The playmat divider that anchors the minimized control. */
  miniHost?: HTMLElement | null;
  /** Optional controller shared with sibling floats on compact layouts. */
  visibility?: FloatVisibilityController;
  /** Compact context composed into the expanded chain header. */
  children?: ReactNode;
}) {
  const [localHidden, setLocalHidden] = useState(false);
  const chainHidden = visibility?.hidden ?? localHidden;
  const setChainHidden = visibility?.setHidden ?? setLocalHidden;
  /** A browse selection only applies to the timeline revision it came from. */
  const [chainBrowse, setChainBrowse] = useState<{
    index: number;
    revision: string;
  } | null>(null);
  const chainLen = links.length;
  const timelineRevision = chainTimelineRevision(links);
  // A new link, chain closure, undo replacement, or newly resolved link
  // invalidates a historical selection and follows the current position.
  const browsedIndex = chainBrowse?.revision === timelineRevision
    ? chainBrowse.index
    : null;
  const chainFloat = useFloatDrag({ axis: "y" }); // chain moves vertically only
  const chainRef = useRef<HTMLDivElement | null>(null);

  // a fresh chain link always re-opens the floating chain panel
  const chainKey = links[chainLen - 1]?.attackingCard.instanceId;
  useEffect(() => {
    if (chainKey !== undefined) setChainHidden(false);
  }, [chainKey, setChainHidden]);

  // staging a defender re-opens the panel so the staged card stays visible
  const staging = staged.length > 0;
  useEffect(() => {
    if (staging) setChainHidden(false);
  }, [setChainHidden, staging]);

  // the displayed chain link (browsable); chainCurrent is always the newest
  const chainIdx = Math.max(0, Math.min(browsedIndex ?? chainLen - 1, chainLen - 1));
  const chain = chainLen > 0 ? links[chainIdx] : undefined;
  const chainCurrent = chainLen > 0 ? links[chainLen - 1] : undefined;
  // A resolved newest link leaves an empty current position until the next
  // attack. Browsing history changes which position is displayed, not whether
  // that current position remains available in the timeline.
  const emptyCurrentExists = chainCurrent?.resolved === true;
  const showingEmptyCurrent = emptyCurrentExists && browsedIndex === null;
  // A weapon can appear on several links with the same instance id. Legal
  // intents refer to the live source, so only its newest unresolved chain-link
  // appearance is interactive; older links are last-known snapshots.
  const attackActivatable = chainAttackIsActivatable(
    chain,
    chainIdx,
    chainLen,
    activatableAttackIds,
  );
  // staged defenders only belong to the link currently being defended
  const showStaged = staging && !showingEmptyCurrent && chainIdx === chainLen - 1;
  const open = chain !== undefined && !chainHidden;
  const minimized = chainCurrent && chainHidden ? (
    <button
      className={`chain-mini${miniHost ? " chain-mini-anchored" : ""}`}
      onClick={() => setChainHidden(false)}
      title="Show combat chain"
    >
      <span className="chain-mini-title">
        <span className="mini-title-long">Combat Chain</span>
        <span className="mini-title-short">Chain</span>
      </span>
      <span className="chain-mini-score">
        <img className="ico" src="/icons/attack.png" alt="attack" />
        {chainCurrent.attackValue} vs
        <img className="ico" src="/icons/defence.png" alt="defense" />
        {chainCurrent.defenseValue + stagedDefense}
        {(chainCurrent.damageToPrevent ?? 0) > 0 ? (
          <span className="chain-mini-prevent">+{chainCurrent.damageToPrevent}</span>
        ) : null}
      </span>
    </button>
  ) : null;

  // track the chain window's on-screen rect so the status window can dock
  // to its right edge (re-measured after drags, resizes and content changes)
  useEffect(() => {
    const el = chainRef.current;
    if (!el) {
      onRect(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      onRect((prev) =>
        prev &&
        prev.left === r.left &&
        prev.top === r.top &&
        prev.width === r.width &&
        prev.height === r.height
          ? prev
          : r,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, chainFloat.pos, onRect]);

  return (
    <>
      {chain && !chainHidden && (
        <div
          ref={chainRef}
          className="float chain-float"
          role="region"
          aria-label="Combat chain"
          style={chainFloat.style}
          {...chainFloat.dragProps}
        >
          <div className="chain-float-bar">
            {children ? <div className="chain-priority-slot">{children}</div> : null}
            {onCloseChain && (
              <button
                className="chain-close"
                title="Close the combat chain"
                onClick={onCloseChain}
              >
                Close chain
              </button>
            )}
            <ChainMinimizeButton placement="header" onMinimize={() => setChainHidden(true)} />
          </div>
          <ChainMinimizeButton placement="corner" onMinimize={() => setChainHidden(true)} />
          <div className="chain-body">
            <nav className="chain-dots" aria-label="Combat chain links">
              <span className="chain-dots-title">Links</span>
              {links.map((l, i) => {
                const linkLabel = l.resolved
                  ? `Link ${i + 1}: ${l.hit ? `hit for ${l.damage}` : "fully defended"}`
                  : `Link ${i + 1}: in progress`;
                return (
                  <button
                    key={l.attackingCard.instanceId}
                    className={`chain-dot ${i === chainIdx && !showingEmptyCurrent ? "active" : ""}`}
                    aria-current={i === chainIdx && !showingEmptyCurrent ? "step" : undefined}
                    aria-label={linkLabel}
                    onClick={(event) => browseChainLink(
                      event.currentTarget,
                      event.detail,
                      () => setChainBrowse({ index: i, revision: timelineRevision }),
                    )}
                    title={linkLabel}
                  >
                    {l.resolved ? (
                      <img
                        className="ico"
                        src={l.hit ? "/icons/hit.png" : "/icons/defence.png"}
                        alt=""
                      />
                    ) : (
                      <span className="chain-dot-pending" aria-hidden="true" />
                    )}
                  </button>
                );
              })}
              {emptyCurrentExists ? (
                <button
                  className={`chain-dot chain-dot-waiting${showingEmptyCurrent ? " active" : ""}`}
                  aria-current={showingEmptyCurrent ? "step" : undefined}
                  aria-label={`Link ${chainLen + 1}: waiting for the next attack`}
                  title={`Link ${chainLen + 1}: waiting for the next attack`}
                  onClick={(event) => browseChainLink(
                    event.currentTarget,
                    event.detail,
                    () => setChainBrowse(null),
                  )}
                >
                  <span className="chain-dot-pending" aria-hidden="true" />
                </button>
              ) : null}
            </nav>
            <div className="chain">
              {showingEmptyCurrent ? (
                <div className="chain-empty">
                  <div className="chain-empty-slot" />
                  <span className="muted">link resolved — waiting for the next attack…</span>
                </div>
              ) : (
                <>
                  <div className="chain-group">
                    <div className="chain-atk-card">
                      <CardFace
                        card={chain.attackingCard}
                        goAgain={chain.goAgain}
                        dominate={chain.dominate}
                        overpower={chain.overpower}
                        wagered={chain.wagered}
                        wagerRewards={chain.wagerRewards}
                        showTapped={false}
                        highlighted={attackActivatable}
                        selected={
                          attackActivatable &&
                          selectedAbilitySourceInstanceId === chain.attackingCard.instanceId
                        }
                        onClick={
                          attackActivatable && onActivateAttack
                            ? () => onActivateAttack(chain.attackingCard.instanceId)
                            : undefined
                        }
                      />
                      {chain.onHitEffects && chain.onHitEffects.length > 0 ? (
                        <OnHitBadge
                          attackInstanceId={chain.attackingCard.instanceId}
                          effects={chain.onHitEffects}
                        />
                      ) : null}
                    </div>
                    {chain.reactions
                      // Projected reactions include played reaction cards and
                      // resolved activated-ability sources, but never instants.
                      .filter((r) => r.owner === chain.attackingCard.owner)
                      .map((r) => (
                        <CardFace key={r.instanceId} card={r} size="zone" showTapped={false} />
                      ))}
                  </div>
                  <div className="chain-vs">
                    <ChainStat
                      kind="attack"
                      value={chain.attackValue}
                      modifiers={chain.attackModifiers ?? []}
                    />
                    {!chain.targetAllyName ? (
                      <>
                        <span className="chain-sep">vs</span>
                        <span className="chain-defense-controls">
                          <ChainStat
                            kind="defense"
                            value={chain.defenseValue + (showStaged ? stagedDefense : 0)}
                            modifiers={chain.defenseModifiers ?? []}
                          />
                          {(chain.damageToPrevent ?? 0) > 0 ? (
                            <>
                              <span className="chain-prevent-plus" aria-hidden="true">+</span>
                              <ChainStat
                                kind="prevention"
                                value={chain.damageToPrevent ?? 0}
                                modifiers={chain.preventionModifiers ?? []}
                              />
                            </>
                          ) : null}
                        </span>
                      </>
                    ) : !chain.targetAlly ? (
                      <>
                        <span className="chain-sep">vs</span>
                        <span className="chain-target muted">{chain.targetAllyName}</span>
                      </>
                    ) : null}
                  </div>
                  <div className="chain-blockers">
                    <div className="chain-group">
                      {chain.targetAlly ? (
                        <CardFace card={chain.targetAlly} size="zone" showTapped={false} />
                      ) : null}
                      {chain.defendingCards.map((d) => (
                        <CardFace key={d.instanceId} card={d} size="zone" showTapped={false} />
                      ))}
                      {showStaged &&
                        staged.map((c) => {
                          const cardName = cardData[c.cardId]?.name ?? c.name ?? "defender";
                          return (
                            <span
                              key={c.instanceId}
                              className="chain-staged"
                              title={
                                onUnstage
                                  ? `Staged defender — return ${cardName}`
                                  : "Staged defender — not yet committed"
                              }
                            >
                              <CardFace
                                card={c}
                                size="zone"
                                showTapped={false}
                                ghost
                                onClick={onUnstage ? () => onUnstage(c.instanceId) : undefined}
                              />
                              {onUnstage ? (
                                <span className="chain-staged-remove-cue" aria-hidden="true" />
                              ) : null}
                            </span>
                          );
                        })}
                      {chain.reactions
                        .filter((r) => r.owner !== chain.attackingCard.owner)
                        .map((r) => (
                          <CardFace key={r.instanceId} card={r} size="zone" showTapped={false} />
                        ))}
                    </div>
                    {showStaged && onUnstageAll ? (
                      <button className="chain-unblock-all" onClick={onUnstageAll}>
                        Unblock all
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
      {minimized && miniHost ? createPortal(minimized, miniHost) : minimized}
    </>
  );
}
