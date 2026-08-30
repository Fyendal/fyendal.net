import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { EquipmentSlot, PresentedDeck } from "@fyendal/shared";
import {
  cardData,
  EXACT_DECK_SIZE,
  MIN_DECK_SIZE,
  validatePresentation,
} from "@fyendal/cards/client";
import { useStore } from "../store.js";
import {
  CARD_PREVIEW_HEIGHT,
  CARD_PREVIEW_WIDTH,
  CardFace,
  cardImageUrl,
} from "../game/Card.js";
import { MobileCardInspect } from "../game/MobileCardInspect.js";
import { useMobileCardLongPress } from "../game/mobileCardLongPress.js";
import { FORMAT_LABELS } from "../lobby/FormatBadge.js";
import {
  adjustMainCount,
  defaultSelection,
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
  return (
    <div className={className} role="group" aria-label="Choose who goes first">
      <button type="button" className="btn-primary" onClick={() => onChoose(true)}>
        Go first
      </button>
      <button type="button" onClick={() => onChoose(false)}>Go second</button>
    </div>
  );
}

/**
 * Pre-game preparation room: sideboard your registered pool (or the fixed
 * Classic Battles box list) down to the presented deck while waiting for an
 * opponent, see their hero once paired, then the die-roll winner picks who
 * goes first. In bot games, the human always makes that choice.
 */
export function PrepRoom() {
  const {
    prepDeck, prep, roomCode, queueCounts, matchmakingActive, matchAcceptanceRole,
    acceptMatch, declineMatch, playBotFromPrep, presentDeck, prepUnready,
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
    presentDeck: state.presentDeck,
    prepUnready: state.prepUnready,
    chooseFirst: state.chooseFirst,
    leave: state.leave,
    selectPrepMatchup: state.selectPrepMatchup,
  })));
  const [sel, setSel] = useState<PrepSelection | null>(null);
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
          <h2 className="panel-title">Loading your deck…</h2>
          <button onClick={leave}>Cancel</button>
        </div>
      </div>
    );
  }
  // adjust state during render when the pool (re)loads — React-sanctioned pattern
  const selectionKey = `${prepDeck.id}:${prepDeck.updatedAt}:${prepDeck.selectedMatchupId ?? "default"}`;
  if (sel?.forDeck !== selectionKey) setSel(defaultSelection(prepDeck.decklist, selectionKey));
  const selection = sel?.forDeck === selectionKey
    ? sel
    : defaultSelection(prepDeck.decklist, selectionKey);

  const pool = prepDeck.decklist;
  const min = MIN_DECK_SIZE[prepDeck.format];
  const exact = EXACT_DECK_SIZE[prepDeck.format];
  const format = prepFormat ?? prepDeck.format;
  const yourSeat = prep?.yourSeat ?? 0;
  const me = prep?.seats[yourSeat] ?? null;
  const opp = prep?.seats[1 - yourSeat] ?? null;
  const ready = me?.ready ?? false;
  const accepting = prep?.deadlinePhase === "accept";
  const locked = ready || accepting; // editing requires acceptance and an unlocked presentation
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
  const mainCountRequirement = exact === undefined ? `${min} min` : `${exact}`;

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

  const toggleWeapon = (id: string) => {
    if (locked) return;
    const has = selection.weapons.includes(id);
    setErrors([]);
    setSel({
      ...selection,
      weapons: has
        ? selection.weapons.filter((w) => w !== id)
        : [...selection.weapons, id],
    });
  };

  const toggleEquipment = (slot: EquipmentSlot, id: string) => {
    if (locked) return;
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

  const onReady = () => {
    const deck: string[] = [];
    for (const [id, n] of selection.main) for (let i = 0; i < n; i++) deck.push(id);
    const presented: PresentedDeck = {
      weaponIds: selection.weapons,
      equipment: selection.equipment,
      deck,
    };
    const validation = validatePresentation(pool, presented, prepDeck.format, {
      allowFutureCards: prep?.allowFutureCards === true,
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
  const readiness = derivePrepReadiness({
    accepting,
    mainCountValid,
    opponentPresent: opp !== null,
    opponentReady: opp?.ready ?? false,
    opponentConnected: opp?.connected ?? false,
    ready,
    startPlayer: prep?.startPlayer ?? null,
  });
  const canReady = readiness.canReady;
  const inviteUrl = roomCode ? `${location.origin}/${roomCode}` : "";

  const copyInviteUrl = async () => {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    window.setTimeout(() => setInviteCopied(false), 2_000);
  };

  const chooseMatchup = async (matchupId: string) => {
    if (locked || matchupBusy) return;
    setMatchupBusy(true);
    setErrors([]);
    const error = await selectPrepMatchup(matchupId || null);
    setMatchupBusy(false);
    if (error) setErrors([error]);
  };

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
            {FORMAT_LABELS[format]} — Prepare
            {roomCode && <span className="room-code prep-code">{roomCode}</span>}
          </h2>
          {roomCode && !opp ? (
            <button
              className="prep-copy-link"
              title="Copy room invite URL"
              onClick={() => void copyInviteUrl()}
            >
              {inviteCopied ? "Copied!" : "Copy URL"}
            </button>
          ) : null}
        </div>
        <button onClick={leave}>Leave</button>
      </div>

      <div className="prep-columns">
        {!mobilePrepLayout ? <section className="panel prep-opponent">
          <h3 className="panel-title">Matchup</h3>
          {opp ? (
            <>
              <div className="prep-versus">
                <div className="prep-vs-side">
                  <img className="prep-hero" src={cardImageUrl(pool.heroId)} alt="your hero" width={126} height={174} data-cardid={pool.heroId} />
                  <div className="prep-opp-name">{cardData[pool.heroId]?.name ?? "Your hero"}</div>
                  <div className="muted">You</div>
                </div>
                <div className="prep-vs">VS</div>
                <div className="prep-vs-side">
                  <img className="prep-hero" src={cardImageUrl(opp.heroId)} alt={opp.heroName} width={126} height={174} data-cardid={opp.heroId} />
                  <div className="prep-opp-name">{opp.heroName}</div>
                  <div className="muted">
                    {opp.username} — {opp.ready ? "ready" : "sideboarding…"}
                    {!opp.connected && " (disconnected)"}
                  </div>
                </div>
              </div>
              {die && !prep?.botGame && (
                <div className="prep-die">
                  <div>
                    Die roll: {me?.username ?? "you"} {die.rolls[yourSeat]} —{" "}
                    {die.rolls[1 - yourSeat]} {opp.username}
                  </div>
                  <div>{iWonDie
                    ? "You won the roll and decide who goes first."
                    : `${opp.username} won the roll and decides who goes first.`}</div>
                </div>
              )}
              {prep?.botGame && pickPending ? <p className="prep-die">Practice match: You decide who goes first.</p> : null}
              {pickPending && iChooseFirst ? (
                <FirstPlayerChoice className="prep-pick prep-desktop-pick" onChoose={chooseFirst} />
              ) : (
                <strong
                  className={`prep-decision-status prep-desktop-decision${prep?.startPlayer == null ? " pending" : ""}`}
                  aria-live="polite"
                >
                  {decisionStatus}
                </strong>
              )}
            </>
          ) : (
            <p className="muted">
              Waiting for an opponent…
              {otherPlayersInQueue > 0
                && ` (${otherPlayersInQueue} ${otherPlayersInQueue === 1 ? "other" : "others"} in queue)`}
            </p>
          )}
          {matchups.length > 0 ? (
            <div className="prep-matchup-plan">
              <label htmlFor="fabrary-matchup">Fabrary matchup plan</label>
              <select
                id="fabrary-matchup"
                value={prepDeck.selectedMatchupId ?? ""}
                disabled={locked || matchupBusy}
                onChange={(event) => void chooseMatchup(event.target.value)}
              >
                <option value="">Default deck</option>
                {matchups.map((matchup) => (
                  <option key={matchup.id} value={matchup.id}>
                    {matchup.name}{suggestedMatchups.has(matchup.id) ? " — suggested" : ""}
                  </option>
                ))}
              </select>
              {matchupBusy ? <span className="muted">Loading plan…</span> : null}
              {selectedMatchup ? (
                <div className="prep-matchup-detail">
                  {selectedMatchup.preferredTurnOrder ? (
                    <strong>Prefers going {selectedMatchup.preferredTurnOrder}</strong>
                  ) : null}
                  {selectedMatchup.notes ? <p>{plainMatchupNotes(selectedMatchup.notes)}</p> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section> : null}

        <PrepPresentation
          pool={pool}
          selection={selection}
          selectionKey={selectionKey}
          locked={locked}
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
      </div>

      {botNudgeKey
        && botNudgeVisibleFor === botNudgeKey
        && botNudgeDismissedFor !== botNudgeKey
        && practiceFormat ? (
          <BotPracticeNudge
            format={practiceFormat}
            busy={botNudgeBusyFor === botNudgeKey}
            onPlay={(bot) => {
              setBotNudgeBusyFor(botNudgeKey);
              playBotFromPrep(practiceFormat, prepDeck.id, bot);
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
            <span className="match-accept-eyebrow">Match found</span>
            <h2 className="panel-title" id="prep-match-accept-title">
              {me?.accepted ? "Waiting for your opponent" : "Ready to play?"}
            </h2>
            <AcceptHeroMatchup you={me} opponent={opp} />
            <p className="muted">
              {me?.accepted
                ? "You accepted. The match will open when your opponent accepts."
                : "Accept the match to continue preparing your deck."}
            </p>
            {me?.accepted ? (
              <div className="match-accepted-state">
                Accepted ✓ · <DeadlineCountdown deadlineAt={prep.deadlineAt} />
              </div>
            ) : (
              <button className="btn-primary match-accept-primary" onClick={acceptMatch}>
                Accept · <DeadlineCountdown deadlineAt={prep.deadlineAt} />
              </button>
            )}
            <button onClick={declineMatch}>Decline</button>
          </section>
        </div>
      ) : null}

      <div className="prep-ready-float">
        <div
          className={`prep-main-count${mainCountValid ? " valid" : " invalid"}`}
          aria-live="polite"
          aria-label={`Main deck: ${mainCount} cards; ${mainCountRequirement}`}
        >
          <span>Main Deck</span>
          <strong>{mainCount} / {mainCountRequirement}</strong>
        </div>
        <div className="prep-ready-controls">
          {ready ? (
            <>
              <span className="prep-ready-badge">Ready ✓</span>
              <button onClick={prepUnready}>Edit deck</button>
            </>
          ) : (
            <button
              className="btn-primary"
              onClick={onReady}
              disabled={!canReady}
            >
              {accepting ? "Waiting for opponent" : (
                <>
                  Ready
                  {prep?.deadlinePhase === "prepare" && prep.deadlineAt
                    ? <> · <DeadlineCountdown deadlineAt={prep.deadlineAt} /></>
                    : null}
                </>
              )}
            </button>
          )}
        </div>
        {!accepting && mobilePrepLayout ? (
          <div className={`prep-match-status prep-mobile-match-status${opp ? "" : " no-opponent"}`}>
            {opp ? (
              <div className="prep-ready-opponent">
                <img
                  src={cardImageUrl(opp.heroId)}
                  alt={`Opponent hero: ${opp.heroName}`}
                  width={38}
                  height={52}
                  data-cardid={opp.heroId}
                />
                <div>
                  <span>Opponent</span>
                  <strong title={opp.heroName}>{opp.heroName} · {readiness.opponentStatus}</strong>
                </div>
              </div>
            ) : null}
            {pickPending && iChooseFirst ? (
              <FirstPlayerChoice className="prep-float-pick" onChoose={chooseFirst} />
            ) : (
              <strong
                className={`prep-decision-status${prep?.startPlayer == null ? " pending" : ""}`}
                aria-live="polite"
              >
                {decisionStatus}
              </strong>
            )}
          </div>
        ) : null}
        {errors.length > 0 ? (
          <ul className="prep-errors">
            {errors.map((error) => <li key={error}>{error}</li>)}
          </ul>
        ) : null}
      </div>

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
