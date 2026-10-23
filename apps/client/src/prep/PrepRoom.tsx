import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { DeckPool, EquipmentSlot, RevealedArena } from "@fyendal/shared";
import {
  arenaWeaponIssue,
  cardData,
  EXACT_DECK_SIZE,
  MIN_DECK_SIZE,
  validatePresentation,
  validateArena,
} from "@fyendal/cards/client";
import { deckCardPool, pairableSearchers } from "../matchmaking/pairableSearchers.js";
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
import { MatchAcceptContent } from "./AcceptHeroMatchup.js";
import { MatchupPicker } from "./MatchupPicker.js";
import {
  BOT_PRACTICE_NUDGE_DELAY_MS,
  BotPracticeNudge,
  shouldOfferBotPractice,
} from "./BotPracticeNudge.js";
import { PrepPresentation } from "./PrepPresentation.js";
import { PrepArenaCards } from "./PrepArenaCards.js";
import { opponentPrepState, PrepMatchSheet } from "./PrepMatchSheet.js";
import { nextPrepStep, useStepNudge } from "./nextStepNudge.js";
import { FullscreenButton } from "../components/FullscreenButton.js";
import {
  canPreloadCardImages,
  preloadCardImage,
  useCardImagePreload,
} from "../game/cardImagePreload.js";
import { PrepImageLoading } from "./PrepImageLoading.js";

const WEAPON_TOAST_MS = 3_500;
/** Card art gates entry to the room, but a slow CDN must not eat the deadlines. */
const DECK_IMAGE_TIMEOUT_MS = 12_000;
/** A revealed opponent arena waits briefly so it appears with its art. */
const OPPONENT_ARENA_IMAGE_TIMEOUT_MS = 4_000;

function deckPoolCardIds(pool: DeckPool): string[] {
  return [
    pool.heroId,
    ...pool.weaponIds,
    ...pool.equipmentPool,
    ...(pool.inventoryPool ?? []),
    ...pool.deck,
    ...(pool.sideboard ?? []),
  ];
}

function revealedArenaCardIds(arena: RevealedArena): string[] {
  return [...arena.weaponIds, ...Object.values(arena.equipment)]
    .filter((id): id is string => typeof id === "string");
}

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
  nudge,
  onChoose,
}: {
  className: string;
  nudge: boolean;
  onChoose: (first: boolean) => void;
}) {
  const intl = useIntl();
  return (
    <div
      className={`${className}${nudge ? " prep-nudge" : ""}`}
      role="group"
      aria-label={intl.formatMessage({ id: "prep.firstPlayer.choose" })}
    >
      <button type="button" className="btn-primary" onClick={() => onChoose(true)}>
        {intl.formatMessage({ id: "prep.firstPlayer.goFirst" })}
      </button>
      <button type="button" className="btn-primary" onClick={() => onChoose(false)}>
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
  const [weaponToast, setWeaponToast] = useState<{ message: string; shownAt: number } | null>(null);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [matchupBusy, setMatchupBusy] = useState(false);
  const [mobilePrepLayout, setMobilePrepLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches,
  );
  const [botNudgeVisibleFor, setBotNudgeVisibleFor] = useState<string | null>(null);
  const [botNudgeDismissedFor, setBotNudgeDismissedFor] = useState<string | null>(null);
  const [botNudgeBusyFor, setBotNudgeBusyFor] = useState<string | null>(null);
  const [imageWaitSkippedFor, setImageWaitSkippedFor] = useState<string | null>(null);
  const prepFormat = prep?.format ?? prepDeck?.format;
  const opponentPresent = prep
    ? prep.seats[1 - prep.yourSeat] !== null
    : false;
  const botNudgeEligible = shouldOfferBotPractice({
    format: prepFormat,
    matchmakingActive,
    opponentPresent,
  });
  const botNudgeKey = botNudgeEligible && prepDeck
    ? `${roomCode ?? "queue"}:${prepDeck.id}`
    : null;
  const nextStep = nextPrepStep(prep);
  const nudgeActive = useStepNudge(nextStep ? `${roomCode ?? "queue"}:${nextStep}` : null);
  const nudge = nudgeActive ? nextStep : null;
  // One gate per room and deck: matchup changes later reuse the cache rather
  // than sending the player back to the loading screen.
  const deckImageKey = prepDeck ? `${roomCode ?? "queue"}:${prepDeck.id}` : null;
  const deckImages = useCardImagePreload(
    deckImageKey,
    prepDeck ? deckPoolCardIds(prepDeck.decklist) : [],
    DECK_IMAGE_TIMEOUT_MS,
  );
  const opponentSeat = prep ? prep.seats[1 - prep.yourSeat] : null;
  const opponentArenaIds = opponentSeat?.arena ? revealedArenaCardIds(opponentSeat.arena) : [];
  const opponentArenaImages = useCardImagePreload(
    opponentSeat?.arena ? `${roomCode ?? "queue"}:${opponentArenaIds.join(",")}` : null,
    opponentArenaIds,
    OPPONENT_ARENA_IMAGE_TIMEOUT_MS,
  );
  const opponentHeroId = opponentSeat?.heroId ?? null;
  const otherPlayersInQueue = prepFormat
    ? pairableSearchers(queueCounts[prepFormat], prep?.cardPoolMode ?? "legal", deckCardPool(prepDeck), matchmakingActive)
    : 0;

  // The opponent's hero is visible from pairing onward; warm it without a gate.
  useEffect(() => {
    if (opponentHeroId && canPreloadCardImages()) void preloadCardImage(opponentHeroId);
  }, [opponentHeroId]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 700px)");
    const syncLayout = (event: MediaQueryListEvent) => setMobilePrepLayout(event.matches);
    query.addEventListener("change", syncLayout);
    return () => query.removeEventListener("change", syncLayout);
  }, []);

  useEffect(() => {
    if (!weaponToast) return;
    const timer = window.setTimeout(() => setWeaponToast(null), WEAPON_TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [weaponToast]);

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
  // The match-accept dialog lives in this room, so never hide it behind loading.
  if (
    !deckImages.done
    && imageWaitSkippedFor !== deckImageKey
    && prep?.phase !== "accept"
  ) {
    return (
      <PrepImageLoading
        heroId={prepDeck.decklist.heroId}
        progress={deckImages}
        onSkip={() => setImageWaitSkippedFor(deckImageKey)}
        onCancel={leave}
      />
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
  const shownOpponentArena = opponentArenaImages.done ? opp?.arena : undefined;
  const ready = me?.ready ?? false;
  const accepting = prep?.phase === "accept";
  const deckStage = prep?.phase === "select-deck";
  const arenaStage = prep?.phase === "select-arena";
  // While you pick turn order, arena picks wait so that decision is not buried
  // under the card grid. Waiting on an opponent's pick still allows drafting.
  const choosingTurnOrder = nextStep === "first-player";
  const arenaLocked = accepting || choosingTurnOrder || deckStage || me?.arenaLocked === true;
  const locked = ready || !deckStage;
  const matchupLocked = ready || accepting || (me?.arenaLocked === true && !deckStage);
  const floatingFooter = mobilePrepLayout && (deckStage || (!accepting && opp !== null));
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
    // A ledger row previews beside its own ledger rather than over its rows.
    const span = el.closest(".prep-deck-zone")?.getBoundingClientRect() ?? r;
    const gap = 12;
    let x = span.right + gap;
    if (x + CARD_PREVIEW_WIDTH > window.innerWidth - 8) {
      x = Math.max(8, span.left - CARD_PREVIEW_WIDTH - gap);
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
    if (!has) {
      const candidate = [...selection.weaponIndexes, index].map((i) => pool.weaponIds[i]!);
      const issue = arenaWeaponIssue(cardData, pool.heroId, candidate);
      if (issue) {
        setWeaponToast({
          message: intl.formatMessage(
            { id: `prep.weaponIssue.${issue.code}` },
            { card: issue.cardId ? cardData[issue.cardId]?.name ?? issue.cardId : "" },
          ),
          shownAt: Date.now(),
        });
        return;
      }
    }
    setWeaponToast(null);
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

  const restoreMain = () => {
    if (locked) return;
    setSel({ ...selection, main: defaultSelection(pool, selectionKey).main });
  };
  const moveMainCopy = (id: string, delta: -1 | 1) => {
    if (locked) return;
    setErrors([]);
    setSel({ ...selection, main: adjustMainCount(selection.main, poolMain, id, delta) });
  };

  const onLockArena = () => {
    if (!arenaStage || arenaLocked) return;
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
      showHero={mobilePrepLayout}
      mainCount={mainCount}
      minimumMainCount={min}
      exactMainCount={exact}
      inventoryCount={inventoryCount}
      poolMainEntries={poolMainEntries}
      fixedInventoryCounts={fixedInventoryCounts}
      onToggleWeapon={toggleWeapon}
      onToggleEquipment={toggleEquipment}
      onMoveMainCopy={moveMainCopy}
      onRestoreMain={restoreMain}
      onInspectCard={setInspectedCardId}
    />
  );
  const arenaLockButton = (
    <button type="button" className="btn-primary" onClick={onLockArena} disabled={!arenaStage || arenaLocked}>
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

  // The desktop sheet already states lock progress; the grid only explains
  // why it is disabled. While you pick turn order it also stops presenting
  // itself as the current task.
  const arenaHeading = deckStage
    ? "prep.arena.revealed"
    : choosingTurnOrder ? "prep.arena.pending" : "prep.arena.select";
  const arenaNote = deckStage
    ? null
    : choosingTurnOrder
      ? "prep.arena.afterTurnOrder"
      : mobilePrepLayout && me?.arenaLocked ? "prep.arena.waiting" : null;
  const draftArena = {
    weaponIds: selection.weaponIndexes.map((index) => pool.weaponIds[index]!),
    equipment: selection.equipment,
  };
  // The plan decides which cards the right column offers, so it heads that
  // column instead of crowding the match sheet.
  const matchupPlan = matchups.length > 0 ? (
    <section className="panel prep-matchup-plan">
      <div className="prep-matchup-pick">
        <label htmlFor="fabrary-matchup">
          {intl.formatMessage({ id: "prep.matchupPlan" })}
        </label>
        <MatchupPicker
          id="fabrary-matchup"
          matchups={matchups}
          selectedId={prepDeck.selectedMatchupId}
          suggestedIds={suggestedMatchups}
          opponentHero={opp?.heroName}
          disabled={matchupLocked || matchupBusy}
          onChoose={(matchupId) => void chooseMatchup(matchupId)}
        />
        {matchupBusy ? (
          <span className="muted">{intl.formatMessage({ id: "prep.loadingPlan" })}</span>
        ) : null}
      </div>
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
    </section>
  ) : null;
  const dieNotice = die && opp && !prep?.botGame ? (
    <p className="prep-die">
      {intl.formatMessage(
        { id: "prep.dieRoll" },
        {
          you: me?.username ?? intl.formatMessage({ id: "prep.youLower" }),
          yourRoll: die.rolls[yourSeat],
          opponentRoll: die.rolls[1 - yourSeat],
          opponent: opp.username,
        },
      )}
    </p>
  ) : null;
  const mainCountMeter = (
    <div
      className={`prep-main-count${mainCountValid ? " valid" : " invalid"}`}
      aria-live="polite"
      aria-label={intl.formatMessage(
        { id: "prep.mainDeckAria" },
        { count: mainCount, requirement: mainCountRequirement },
      )}
    >
      <span>{intl.formatMessage({ id: "prep.zone.main" })}</span>
      <strong>{mainCount} / {mainCountRequirement}</strong>
    </div>
  );
  const readyControls = ready ? (
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
  );
  const turnOrderLine = prep?.startPlayer != null ? (
    <p className="prep-sheet-turn">
      {intl.formatMessage(
        { id: prep.startPlayer === yourSeat ? "prep.turnOrder.youFirst" : "prep.turnOrder.youSecond" },
        { order: (chunks) => <strong>{chunks}</strong> },
      )}
    </p>
  ) : null;
  const choosePrompt = intl.formatMessage({
    id: prep?.botGame ? "prep.practiceChooseFirst" : "prep.rollWonYou",
  });
  const opponentState = opp && prep ? opponentPrepState(prep.phase, opp) : null;
  const sheetAction = (
    <>
      {turnOrderLine}
      {pickPending && iChooseFirst ? (
        <>
          <p className="prep-sheet-prompt">{choosePrompt}</p>
          <FirstPlayerChoice
            className="prep-pick"
            nudge={nudge === "first-player"}
            onChoose={chooseFirst}
          />
        </>
      ) : pickPending ? (
        <strong className="prep-decision-status pending" aria-live="polite">{decisionStatusLabel}</strong>
      ) : arenaStage && !me?.arenaLocked ? (
        <div className={`prep-sheet-lock${nudge === "arena" ? " prep-nudge" : ""}`}>{arenaLockButton}</div>
      ) : arenaStage ? (
        <p className="prep-sheet-prompt">{intl.formatMessage({ id: "prep.arena.waiting" })}</p>
      ) : deckStage ? (
        <div className="prep-sheet-ready">
          {mainCountMeter}
          <div className={`prep-ready-controls${nudge === "ready" && canReady ? " prep-nudge" : ""}`}>
            {readyControls}
          </div>
        </div>
      ) : null}
      {prepErrors}
    </>
  );

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
        <div className="prep-topbar-actions">
          <FullscreenButton placement="header" />
          <button className="lobby-create-action" onClick={leave}>
            {intl.formatMessage({ id: "common.leave" })}
          </button>
        </div>
      </div>

      <div className="prep-columns">
        {!mobilePrepLayout && opp && prep ? (
          <PrepMatchSheet
            phase={prep.phase}
            yourHeroId={pool.heroId}
            yourHeroName={cardData[pool.heroId]?.name ?? intl.formatMessage({ id: "prep.yourHero" })}
            opponent={opp}
            yourArena={prep.yourArena ?? draftArena}
            opponentArena={shownOpponentArena}
            notice={pickPending ? dieNotice : null}
            action={sheetAction}
          />
        ) : !mobilePrepLayout ? (
          <section className="panel prep-opponent">
            <h3 className="panel-title">{intl.formatMessage({ id: "prep.matchup" })}</h3>
            <p className="muted">
              {intl.formatMessage({ id: "prep.waitingOpponent" })}
              {otherPlayersInQueue > 0
                ? ` (${intl.formatMessage(
                    { id: "prep.othersInQueue" },
                    { count: otherPlayersInQueue },
                  )})`
                : null}
            </p>
          </section>
        ) : null}

        <div className="prep-selection-column">
          {matchupPlan}
          {!deckStage || mobilePrepLayout ? <section
            className={`panel prep-arena-stage${choosingTurnOrder ? " prep-arena-pending" : ""}`}
            aria-live="polite"
          >
            <h3 className="panel-title">{intl.formatMessage({ id: arenaHeading })}</h3>
            {arenaNote ? <p className="muted">{intl.formatMessage({ id: arenaNote })}</p> : null}
            {mobilePrepLayout && prep?.yourArena ? <PrepArenaCards arena={prep.yourArena} owner="you" /> : null}
            {mobilePrepLayout && shownOpponentArena
              ? <PrepArenaCards arena={shownOpponentArena} owner="opponent" />
              : null}
            {!deckStage && (!me?.arenaLocked || !mobilePrepLayout) ? presentation : null}
            {!floatingFooter && !opp ? prepErrors : null}
          </section> : null}

          {deckStage ? presentation : null}
        </div>
      </div>

      {botNudgeKey
        && botNudgeVisibleFor === botNudgeKey
        && botNudgeDismissedFor !== botNudgeKey
        && prepFormat ? (
          <BotPracticeNudge
            format={prepFormat}
            busy={botNudgeBusyFor === botNudgeKey}
            onPlay={(bot, searchForPlayer) => {
              setBotNudgeBusyFor(botNudgeKey);
              playBotFromPrep(prepFormat, prepDeck.id, bot, searchForPlayer);
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
            <MatchAcceptContent
              titleId="prep-match-accept-title"
              you={me}
              opponent={opp}
              deadlineAt={prep.deadlineAt}
              onAccept={acceptMatch}
              onDecline={declineMatch}
            />
          </section>
        </div>
      ) : null}

      {floatingFooter ? (
        <div className="prep-ready-float">
          <div className="prep-bar-row">
            {opp ? (
              <CardArtwork
                className="prep-ready-opponent-art"
                cardId={opp.heroId}
                alt={intl.formatMessage({ id: "prep.opponentHeroAria" }, { hero: opp.heroName })}
                width={42}
                height={58}
              />
            ) : null}
            <div className="prep-bar-copy">
              {turnOrderLine ?? (pickPending && iChooseFirst
                ? <p className="prep-sheet-prompt">{choosePrompt}</p>
                : turnStatus)}
              {deckStage ? (
                <span
                  className={`prep-bar-count${mainCountValid ? " valid" : " invalid"}`}
                  aria-live="polite"
                >
                  {intl.formatMessage(
                    { id: "prep.presentation.mainCount" },
                    { count: mainCount, requirement: mainCountRequirement },
                  )}
                </span>
              ) : null}
              {opponentState ? (
                <div className={`prep-sheet-state ${opponentState}`}>
                  {intl.formatMessage({ id: `prep.opponentState.${opponentState}` })}
                </div>
              ) : null}
            </div>
            {deckStage || arenaStage ? (
              <div
                className={`prep-ready-controls${
                  nudge === "arena" || (nudge === "ready" && canReady) ? " prep-nudge" : ""
                }`}
              >
                {deckStage ? readyControls : arenaLockButton}
              </div>
            ) : null}
          </div>
          {pickPending && iChooseFirst ? (
            <FirstPlayerChoice
              className="prep-float-pick"
              nudge={nudge === "first-player"}
              onChoose={chooseFirst}
            />
          ) : null}
          {prepErrors}
        </div>
      ) : null}

      {weaponToast ? (
        <div key={weaponToast.shownAt} className="prep-toast" role="status" aria-live="polite">
          {weaponToast.message}
        </div>
      ) : null}

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
