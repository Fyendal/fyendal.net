import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { EquipmentSlot } from "@fyendal/shared";
import {
  cardData,
  EXACT_DECK_SIZE,
  MIN_DECK_SIZE,
  validatePresentation,
  validateArena,
} from "@fyendal/cards/client";
import { useStore } from "../store.js";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  CardArtwork,
  CardFace,
} from "../game/Card.js";
import { MobileCardInspect } from "../game/MobileCardInspect.js";
import { useMobileCardLongPress } from "../game/mobileCardLongPress.js";
import { formatLabel } from "../lobby/FormatBadge.js";
import {
  adjustMainCount,
  defaultSelection,
  presentedDeckFromSelection,
  restoreMainDeck,
  poolCounts,
  type PrepSelection,
} from "./selection.js";
import { canChooseFirst, firstPlayerStatus } from "./firstPlayerStatus.js";
import { derivePrepReadiness } from "./readiness.js";
import { DeadlineCountdown } from "./DeadlineCountdown.js";
import { AcceptHeroMatchup } from "./AcceptHeroMatchup.js";
import {
  BOT_PRACTICE_NUDGE_DELAY_MS,
  BotPracticeNudge,
  botPracticeFormat,
  shouldOfferBotPractice,
} from "./BotPracticeNudge.js";
import { PrepPresentation } from "./PrepPresentation.js";
import { PrepArenaCards } from "./PrepArenaCards.js";

function heroKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function matchupTargetsHero(
  matchup: { id: string; name: string; heroIdentifiers?: string[] },
  heroId: string,
  heroName: string,
): boolean {
  const targets = [heroKey(heroId), heroKey(heroName)];
  if (matchup.heroIdentifiers?.length) {
    return matchup.heroIdentifiers.some((identifier) => targets.includes(heroKey(identifier)));
  }
  const candidates = [heroKey(matchup.id), heroKey(matchup.name)];
  return candidates.some((candidate) => targets.some(
    (target) => target === candidate || target.startsWith(`${candidate}_`),
  ));
}

function plainMatchupNotes(notes: string): string {
  return notes.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function FirstPlayerChoice({
  className,
  onChoose,
}: {
  className: string;
  onChoose: (first: boolean) => void;
}) {
  const intl = useIntl();
  return (
    <div
      className={className}
      role="group"
      aria-label={intl.formatMessage({ id: "prep.firstPlayer.choose" })}
    >
      <button type="button" className="btn-primary" onClick={() => onChoose(true)}>
        {intl.formatMessage({ id: "prep.firstPlayer.goFirst" })}
      </button>
      <button type="button" onClick={() => onChoose(false)}>
        {intl.formatMessage({ id: "prep.firstPlayer.goSecond" })}
      </button>
    </div>
  );
}

/**
 * Pre-game preparation: choose the first player, commit arena cards, then
 * select the main deck after both arena selections are revealed.
 */
export function PrepRoom() {
  const intl = useIntl();
  const {
    prepDeck, prep, roomCode, queueCounts, matchmakingActive, matchAcceptanceRole,
    acceptMatch, declineMatch, playBotFromPrep, presentArena, presentDeck, prepUnready,
    chooseFirst, leave, selectPrepMatchup,
  } = useStore(useShallow((state) => ({
    prepDeck: state.prepDeck,
    prep: state.prep,
    roomCode: state.roomCode,
    queueCounts: state.queueCounts,
    matchmakingActive: state.matchmakingActive,
    matchAcceptanceRole: state.matchAcceptanceRole,
    acceptMatch: state.acceptMatch,
    declineMatch: state.declineMatch,
    playBotFromPrep: state.playBotFromPrep,
    presentArena: state.presentArena,
    presentDeck: state.presentDeck,
    prepUnready: state.prepUnready,
    chooseFirst: state.chooseFirst,
    leave: state.leave,
    selectPrepMatchup: state.selectPrepMatchup,
  })));
  const [sel, setSel] = useState<PrepSelection | null>(null);
  const [restoredPresentationRoom, setRestoredPresentationRoom] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [inspectedCardId, setInspectedCardId] = useState<string | null>(null);
  const cardLongPressHandlers = useMobileCardLongPress((cardId) => setInspectedCardId(cardId));
  const [errors, setErrors] = useState<string[]>([]);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [matchupBusy, setMatchupBusy] = useState(false);
  const [mobilePrepLayout, setMobilePrepLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches,
  );
  const [botNudgeVisibleFor, setBotNudgeVisibleFor] = useState<string | null>(null);
  const [botNudgeDismissedFor, setBotNudgeDismissedFor] = useState<string | null>(null);
  const [botNudgeBusyFor, setBotNudgeBusyFor] = useState<string | null>(null);
  const prepFormat = prep?.format ?? prepDeck?.format;
  const opponentPresent = prep
    ? prep.seats[1 - prep.yourSeat] !== null
    : false;
  const practiceFormat = botPracticeFormat(prepFormat);
  const botNudgeEligible = shouldOfferBotPractice({
    format: prepFormat,
    matchmakingActive,
    opponentPresent,
    queueCount: prepFormat ? queueCounts[prepFormat] : 0,
  });
  const botNudgeKey = botNudgeEligible && prepDeck
    ? `${roomCode ?? "queue"}:${prepDeck.id}`
    : null;
  const otherPlayersInQueue = matchmakingActive
    ? Math.max(0, (prepFormat ? queueCounts[prepFormat] : 0) - 1)
    : (prepFormat ? queueCounts[prepFormat] : 0);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const syncLayout = (event: MediaQueryListEvent) => setMobilePrepLayout(event.matches);
    query.addEventListener("change", syncLayout);
    return () => query.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!botNudgeKey) {
      setBotNudgeVisibleFor(null);
      setBotNudgeBusyFor(null);
      return;
    }
    const timer = window.setTimeout(
      () => setBotNudgeVisibleFor(botNudgeKey),
      BOT_PRACTICE_NUDGE_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [botNudgeKey]);

  if (!prepDeck) {
    return (
      <div className="lobby-page">
        <div className="panel waiting-panel">
          <h2 className="panel-title">{intl.formatMessage({ id: "prep.loadingDeck" })}</h2>
          <button onClick={leave}>{intl.formatMessage({ id: "common.cancel" })}</button>
        </div>
      </div>
    );
  }
  // adjust state during render when the pool (re)loads — React-sanctioned pattern
  const roomSelectionKey = `${roomCode ?? "queue"}:${prepDeck.id}`;
  const selectionKey = `${roomSelectionKey}:${prepDeck.updatedAt}:${prepDeck.selectedMatchupId ?? "default"}`;
  let selection = sel?.forDeck === selectionKey
    ? sel
    : defaultSelection(prepDeck.decklist, selectionKey);
  // The server presentation can arrive after the local pool on reconnect.
  // Restore it once per room so subsequent preset changes keep their main deck.
  if (prep?.yourPresentedDeck && restoredPresentationRoom !== roomSelectionKey) {
    selection = restoreMainDeck(selection, prep.yourPresentedDeck);
    setRestoredPresentationRoom(roomSelectionKey);
  }
  if (selection !== sel) setSel(selection);

  const pool = prepDeck.decklist;
  const min = MIN_DECK_SIZE[prepDeck.format];
  const exact = EXACT_DECK_SIZE[prepDeck.format];
  const format = prepFormat ?? prepDeck.format;
  const yourSeat = prep?.yourSeat ?? 0;
  const me = prep?.seats[yourSeat] ?? null;
  const opp = prep?.seats[1 - yourSeat] ?? null;
  const ready = me?.ready ?? false;
  const accepting = prep?.phase === "accept";
  const deckStage = prep?.phase === "select-deck";
  const arenaStage = prep?.phase === "select-arena";
  const arenaLocked = prep?.phase !== "select-arena" || me?.arenaLocked === true;
  const locked = ready || !deckStage;
  const matchupLocked = ready || accepting || (me?.arenaLocked === true && !deckStage);
  const desktopArenaAction = !mobilePrepLayout && arenaStage;
  const floatingFooter = deckStage || (mobilePrepLayout && !accepting && opp !== null);
  const matchups = prepDeck.matchups ?? [];
  const selectedMatchup = matchups.find((matchup) => matchup.id === prepDeck.selectedMatchupId);
  const suggestedMatchups = opp
    ? new Set(matchups.filter((matchup) => matchupTargetsHero(
      matchup,
      opp.heroId,
      opp.heroName,
    )).map((matchup) => matchup.id))
    : new Set<string>();

  const mainCount = [...selection.main.values()].reduce((a, b) => a + b, 0);
  const poolMain = poolCounts(pool);
  const poolMainEntries = [...poolMain];
  const poolMainCount = poolMainEntries.reduce((total, [, count]) => total + count, 0);
  const fixedInventoryCounts = new Map<string, number>();
  for (const id of pool.inventoryPool ?? []) {
    fixedInventoryCounts.set(id, (fixedInventoryCounts.get(id) ?? 0) + 1);
  }
  const inventoryCount = poolMainCount - mainCount + (pool.inventoryPool?.length ?? 0);
  const mainCountValid = exact === undefined ? mainCount >= min : mainCount === exact;
  const mainCountRequirement = exact === undefined
    ? intl.formatMessage({ id: "prep.presentation.minimum" }, { count: min })
    : intl.formatMessage({ id: "prep.presentation.exact" }, { count: exact });

  // hover preview next to the hovered card (event delegation via data-cardid)
  const onHoverCard = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest("[data-cardid]");
    if (!el) {
      setPreview(null);
      return;
    }
    const r = el.getBoundingClientRect();
    const gap = 12;
    let x = r.right + gap;
    if (x + CARD_PREVIEW_WIDTH > window.innerWidth - 8) {
      x = r.left - CARD_PREVIEW_WIDTH - gap;
    }
    const y = Math.min(
      Math.max(r.top + r.height / 2 - CARD_PREVIEW_HEIGHT / 2, 8),
      window.innerHeight - CARD_PREVIEW_HEIGHT - 8,
    );
    setPreview({ id: el.getAttribute("data-cardid")!, x, y });
  };

  const toggleWeapon = (index: number) => {
    if (arenaLocked) return;
    const has = selection.weaponIndexes.includes(index);
    setErrors([]);
    setSel({
      ...selection,
      weaponIndexes: has
        ? selection.weaponIndexes.filter((candidate) => candidate !== index)
        : [...selection.weaponIndexes, index],
    });
  };

  const toggleEquipment = (slot: EquipmentSlot, id: string) => {
    if (arenaLocked) return;
    const equipment = { ...selection.equipment };
    if (equipment[slot] === id) delete equipment[slot];
    else equipment[slot] = id;
    setErrors([]);
    setSel({ ...selection, equipment });
  };

  const moveMainCopy = (id: string, delta: -1 | 1) => {
    if (locked) return;
    setErrors([]);
    setSel({ ...selection, main: adjustMainCount(selection.main, poolMain, id, delta) });
  };

  const onLockArena = () => {
    if (arenaLocked) return;
    const arena = {
      weaponIds: selection.weaponIndexes.map((index) => pool.weaponIds[index]!),
      equipment: selection.equipment,
    };
    const validation = validateArena(pool, arena, prepDeck.format, { cardPoolMode: prep?.cardPoolMode ?? "legal" });
    if (!validation.ok) {
      setErrors([validation.error]);
      return;
    }
    presentArena(arena);
  };

  const onReady = () => {
    if (locked || !prep?.yourArena) return;
    const presented = presentedDeckFromSelection(selection, prep.yourArena);
    const validation = validatePresentation(pool, presented, prepDeck.format, {
      cardPoolMode: prep?.cardPoolMode ?? "legal",
    });
    if (!validation.ok) {
      setErrors([validation.error]);
      return;
    }
    presentDeck(presented);
  };

  const die = prep?.die ?? null;
  const iWonDie = die !== null && die.winner === yourSeat;
  const iChooseFirst = canChooseFirst({
    botGame: prep?.botGame === true,
    dieWinner: die?.winner ?? null,
    yourSeat,
  });
  const pickPending = die !== null && prep?.startPlayer == null;
  const decisionStatus = firstPlayerStatus({
    opponentPresent: opp !== null,
    botGame: prep?.botGame,
    dieWinner: die?.winner ?? null,
    startPlayer: prep?.startPlayer ?? null,
    yourSeat,
  });
  const decisionStatusLabel = decisionStatus
    ? intl.formatMessage({ id: `prep.firstPlayer.status.${decisionStatus}` })
    : null;
  const readiness = derivePrepReadiness({
    accepting,
    mainCountValid,
    opponentPresent: opp !== null,
    opponentReady: opp?.ready ?? false,
    opponentConnected: opp?.connected ?? false,
    ready,
    startPlayer: prep?.startPlayer ?? null,
  });
  const canReady = deckStage && readiness.canReady;
  const inviteUrl = roomCode ? `${location.origin}/${roomCode}` : "";

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2_000);
  };

  const chooseMatchup = async (matchupId: string) => {
    if (matchupLocked || matchupBusy) return;
    setMatchupBusy(true);
    setErrors([]);
    const error = await selectPrepMatchup(matchupId || null);
    setMatchupBusy(false);
    if (error) setErrors([error]);
  };

  const presentation = (
    <PrepPresentation
      pool={pool}
      selection={selection}
      selectionKey={selectionKey}
      locked={deckStage ? locked : arenaLocked}
      sections={deckStage ? "deck" : "arena"}
      mainCount={mainCount}
      minimumMainCount={min}
      exactMainCount={exact}
      inventoryCount={inventoryCount}
      poolMainEntries={poolMainEntries}
      fixedInventoryCounts={fixedInventoryCounts}
      onToggleWeapon={toggleWeapon}
      onToggleEquipment={toggleEquipment}
      onMoveMainCopy={moveMainCopy}
    />
  );
  const arenaLockButton = (
    <button type="button" className="btn-primary" onClick={onLockArena} disabled={arenaLocked}>
      {intl.formatMessage({ id: me?.arenaLocked ? "prep.arena.locked" : "prep.arena.lock" })}
      {prep?.deadlineAt && arenaStage ? <> · <DeadlineCountdown deadlineAt={prep.deadlineAt} /></> : null}
    </button>
  );
  const turnStatus = pickPending && iChooseFirst ? null : (
    <strong
      className={`prep-decision-status${prep?.startPlayer == null ? " pending" : ""}`}
      aria-live="polite"
    >
      {decisionStatusLabel}
    </strong>
  );
  const prepErrors = errors.length > 0 ? (
    <ul className="prep-errors">
      {errors.map((error) => <li key={error}>{error}</li>)}
    </ul>
  ) : null;

  return (
    <div
      className="lobby-page prep-page"
      onMouseOver={onHoverCard}
      onMouseLeave={() => setPreview(null)}
      {...cardLongPressHandlers}
    >
      <div className="prep-topbar">
        <div className="prep-heading">
          <h2 className="panel-title">
            {intl.formatMessage(
              { id: "prep.title" },
              { format: formatLabel(intl, format) },
            )}
            {roomCode && <span className="room-code prep-code">{roomCode}</span>}
          </h2>
          {roomCode && !opp ? (
            <button
              className="prep-copy-link"
              title={intl.formatMessage({ id: "prep.copyInviteTitle" })}
              onClick={() => void copyInviteUrl()}
            >
              {intl.formatMessage({ id: inviteCopied ? "prep.copied" : "prep.copyUrl" })}
            </button>
          ) : null}
        </div>
        <button onClick={leave}>{intl.formatMessage({ id: "common.leave" })}</button>
      </div>

      <div className="prep-columns">
        {!mobilePrepLayout ? <section className="panel prep-opponent">
          <h3 className="panel-title">{intl.formatMessage({ id: "prep.matchup" })}</h3>
          {opp ? (
            <>
              <div className="prep-versus">
                <div className="prep-vs-side">
                  <CardArtwork
                    className="prep-hero" cardId={pool.heroId}
                    alt={intl.formatMessage({ id: "prep.yourHero" })} width={126} height={174}
                  />
                  <div className="prep-opp-name">
                    {cardData[pool.heroId]?.name ?? intl.formatMessage({ id: "prep.yourHero" })}
                  </div>
                  <div className="muted">{intl.formatMessage({ id: "prep.you" })}</div>
                </div>
                <div className="prep-vs">VS</div>
                <div className="prep-vs-side">
                  <CardArtwork className="prep-hero" cardId={opp.heroId} alt={opp.heroName} width={126} height={174} />
                  <div className="prep-opp-name">{opp.heroName}</div>
                  <div className="muted">
                    {opp.username} — {intl.formatMessage({
                      id: opp.ready ? "prep.status.readyLower" : "prep.status.sideboarding",
                    })}
                    {!opp.connected
                      ? ` (${intl.formatMessage({ id: "common.connection.disconnected" })})`
                      : null}
                  </div>
                </div>
              </div>
              {die && !prep?.botGame && (
                <div className="prep-die">
                  <div>
                    {intl.formatMessage(
                      { id: "prep.dieRoll" },
                      {
                        you: me?.username ?? intl.formatMessage({ id: "prep.youLower" }),
                        yourRoll: die.rolls[yourSeat],
                        opponentRoll: die.rolls[1 - yourSeat],
                        opponent: opp.username,
                      },
                    )}
                  </div>
                  <div>{iWonDie
                    ? intl.formatMessage({ id: "prep.rollWonYou" })
                    : intl.formatMessage({ id: "prep.rollWonOpponent" }, { username: opp.username })}</div>
                </div>
              )}
              {prep?.botGame && pickPending ? (
                <p className="prep-die">{intl.formatMessage({ id: "prep.practiceChooseFirst" })}</p>
              ) : null}
              {pickPending && iChooseFirst ? (
                <FirstPlayerChoice className="prep-pick prep-desktop-pick" onChoose={chooseFirst} />
              ) : (
                <strong
                  className={`prep-decision-status prep-desktop-decision${prep?.startPlayer == null ? " pending" : ""}`}
                  aria-live="polite"
                >
                  {decisionStatusLabel}
                </strong>
              )}
            </>
          ) : (
            <p className="muted">
              {intl.formatMessage({ id: "prep.waitingOpponent" })}
              {otherPlayersInQueue > 0
                ? ` (${intl.formatMessage(
                    { id: "prep.othersInQueue" },
                    { count: otherPlayersInQueue },
                  )})`
                : null}
            </p>
          )}
          {matchups.length > 0 ? (
            <div className="prep-matchup-plan">
              <label htmlFor="fabrary-matchup">
                {intl.formatMessage({ id: "prep.matchupPlan" })}
              </label>
              <select
                id="fabrary-matchup"
                value={prepDeck.selectedMatchupId ?? ""}
                disabled={matchupLocked || matchupBusy}
                onChange={(event) => void chooseMatchup(event.target.value)}
              >
                <option value="">{intl.formatMessage({ id: "prep.defaultDeck" })}</option>
                {matchups.map((matchup) => (
                  <option key={matchup.id} value={matchup.id}>
                    {matchup.name}{suggestedMatchups.has(matchup.id)
                      ? ` — ${intl.formatMessage({ id: "prep.suggested" })}`
                      : ""}
                  </option>
                ))}
              </select>
              {matchupBusy ? (
                <span className="muted">{intl.formatMessage({ id: "prep.loadingPlan" })}</span>
              ) : null}
              {selectedMatchup ? (
                <div className="prep-matchup-detail">
                  {selectedMatchup.preferredTurnOrder ? (
                    <strong>{intl.formatMessage(
                      { id: "prep.prefersTurnOrder" },
                      {
                        order: intl.formatMessage({
                          id: `prep.turnOrder.${selectedMatchup.preferredTurnOrder}`,
                        }),
                      },
                    )}</strong>
                  ) : null}
                  {selectedMatchup.notes ? <p>{plainMatchupNotes(selectedMatchup.notes)}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section> : null}

        <div className="prep-selection-column">
          <section className="panel prep-arena-stage" aria-live="polite">
            <h3 className="panel-title">
              {intl.formatMessage({ id: deckStage ? "prep.arena.revealed" : "prep.arena.select" })}
            </h3>
            {!deckStage ? <p className="muted">{intl.formatMessage({
              id: me?.arenaLocked ? "prep.arena.waiting" : "prep.arena.lockHint",
            })}</p> : null}
            {prep?.yourArena ? <PrepArenaCards arena={prep.yourArena} owner="you" /> : null}
            {opp?.arena ? <PrepArenaCards arena={opp.arena} owner="opponent" /> : null}
            {!deckStage && !me?.arenaLocked ? presentation : null}
            {desktopArenaAction ? (
              <div className="prep-desktop-arena-action">
                {arenaLockButton}
                {prepErrors}
              </div>
            ) : null}
            {!floatingFooter && !desktopArenaAction ? prepErrors : null}
          </section>

          {deckStage ? presentation : null}
        </div>
      </div>

      {botNudgeKey
        && botNudgeVisibleFor === botNudgeKey
        && botNudgeDismissedFor !== botNudgeKey
        && practiceFormat ? (
          <BotPracticeNudge
            format={practiceFormat}
            cardPoolMode={prep?.cardPoolMode ?? "legal"}
            busy={botNudgeBusyFor === botNudgeKey}
            onPlay={(bot, searchForPlayer) => {
              setBotNudgeBusyFor(botNudgeKey);
              playBotFromPrep(practiceFormat, prepDeck.id, bot, searchForPlayer);
            }}
            onDismiss={() => setBotNudgeDismissedFor(botNudgeKey)}
          />
        ) : null}

      {accepting && matchAcceptanceRole === "existing" && prep?.deadlineAt ? (
        <div className="prep-match-accept-backdrop">
          <section
            className="panel prep-match-accept-prompt"
            role="dialog"
            aria-modal="true"
            aria-labelledby="prep-match-accept-title"
            aria-live="polite"
          >
            <span className="match-accept-eyebrow">
              {intl.formatMessage({ id: "prep.accept.matchFound" })}
            </span>
            <h2 className="panel-title" id="prep-match-accept-title">
              {intl.formatMessage({
                id: me?.accepted ? "prep.accept.waiting" : "prep.accept.ready",
              })}
            </h2>
            <AcceptHeroMatchup you={me} opponent={opp} />
            <p className="muted">
              {me?.accepted
                ? intl.formatMessage({ id: "prep.accept.acceptedDescription" })
                : intl.formatMessage({ id: "prep.accept.description" })}
            </p>
            {me?.accepted ? (
              <div className="match-accepted-state">
                {intl.formatMessage({ id: "prep.accept.accepted" })} ✓ ·{" "}
                <DeadlineCountdown deadlineAt={prep.deadlineAt} />
              </div>
            ) : (
              <button className="btn-primary match-accept-primary" onClick={acceptMatch}>
                {intl.formatMessage({ id: "lobby.action.accept" })} ·{" "}
                <DeadlineCountdown deadlineAt={prep.deadlineAt} />
              </button>
            )}
            <button onClick={declineMatch}>{intl.formatMessage({ id: "lobby.action.decline" })}</button>
          </section>
        </div>
      ) : null}

      {floatingFooter ? <div className={`prep-ready-float${deckStage ? "" : " prep-arena-mobile"}`}>
        {deckStage ? <div
          className={`prep-main-count${mainCountValid ? " valid" : " invalid"}`}
          aria-live="polite"
          aria-label={intl.formatMessage(
            { id: "prep.mainDeckAria" },
            { count: mainCount, requirement: mainCountRequirement },
          )}
        >
          <span>{intl.formatMessage({ id: "prep.zone.main" })}</span>
          <strong>{mainCount} / {mainCountRequirement}</strong>
        </div> : null}
        {deckStage || arenaStage ? <div className="prep-ready-controls">
          {!deckStage ? (
            arenaLockButton
          ) : ready ? (
            <>
              <span className="prep-ready-badge">
                {intl.formatMessage({ id: "prep.status.ready" })} ✓
              </span>
              <button onClick={prepUnready}>{intl.formatMessage({ id: "lobby.deck.edit" })}</button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={onReady}
              disabled={!canReady}
            >
              {intl.formatMessage({ id: "prep.status.ready" })}
              {prep?.deadlineAt ? <> · <DeadlineCountdown deadlineAt={prep.deadlineAt} /></> : null}
            </button>
          )}
        </div> : null}
        {mobilePrepLayout ? (
          <div className={`prep-match-status prep-mobile-match-status${opp ? "" : " no-opponent"}`}>
            {opp ? (
              <div className="prep-ready-opponent">
                <CardArtwork
                  className="prep-ready-opponent-art"
                  cardId={opp.heroId}
                  alt={intl.formatMessage({ id: "prep.opponentHeroAria" }, { hero: opp.heroName })}
                  width={38}
                  height={52}
                />
                <div className="prep-mobile-opponent-copy">
                  <span>{intl.formatMessage({ id: "prep.opponent" })}</span>
                  <strong title={opp.heroName}>
                    {opp.heroName} · {intl.formatMessage({
                      id: `prep.opponentStatus.${readiness.opponentStatus}`,
                    })}
                  </strong>
                  {turnStatus}
                </div>
              </div>
            ) : null}
            {pickPending && iChooseFirst ? (
              <FirstPlayerChoice className="prep-float-pick" onChoose={chooseFirst} />
            ) : !opp ? turnStatus : null}
          </div>
        ) : null}
        {prepErrors}
      </div> : null}

      {preview && cardData[preview.id] && (
        <div
          className="card-preview"
          style={{
            left: preview.x,
            top: preview.y,
            width: CARD_PREVIEW_WIDTH,
            height: CARD_PREVIEW_HEIGHT,
          }}
        >
          <CardFace card={{ instanceId: -999, cardId: preview.id, owner: yourSeat }} size="preview" />
        </div>
      )}

      <MobileCardInspect
        cardId={inspectedCardId}
        owner={yourSeat}
        onClose={() => setInspectedCardId(null)}
      />
    </div>
  );
}
