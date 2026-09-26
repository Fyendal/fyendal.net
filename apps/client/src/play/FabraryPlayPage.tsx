import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { Auth } from "../auth/AuthCard.js";
import { LobbyHeader } from "../lobby/LobbyHeader.js";
import { heroImageUrl } from "../lobby/heroImage.js";
import { SiteFooter } from "../legal/SiteFooter.js";
import { BotOpponentModal } from "../lobby/BotOpponentModal.js";
import { CardPoolModeControl } from "../lobby/CardPoolModeControl.js";
import { FormatName } from "../lobby/FormatBadge.js";
import { deckErrorMessages } from "../lobby/deckErrors.js";

export function FabraryPlayPage() {
  const intl = useIntl();
  const [showBots, setShowBots] = useState(false);
  const {
    pending, authUser, error, modes, resolve, preview, dismiss, start, setMode,
  } = useStore(useShallow((state) => ({
    pending: state.pendingFabraryPlay,
    authUser: state.authUser,
    error: state.error,
    modes: state.cardPoolModes,
    resolve: state.resolveFabraryPlay,
    preview: state.previewFabraryPlay,
    dismiss: state.dismissFabraryPlay,
    start: state.startFabraryPlay,
    setMode: state.setCardPoolMode,
  })));

  useEffect(() => {
    if (authUser && pending?.status === "idle" && pending.route.ok) void resolve();
  }, [authUser, pending?.status, pending?.route, resolve]);

  useEffect(() => {
    if (!authUser && pending?.route.ok && !pending.preview) void preview();
  }, [authUser, pending?.route, pending?.preview, preview]);

  if (!pending) return null;
  const request = pending.route.ok ? pending.route.request : null;
  const deck = authUser && pending.result?.ok ? pending.result.deck : null;
  const identity = deck ?? (!authUser && pending.preview?.result?.ok ? pending.preview.result.deck : null);
  const starting = pending.status === "starting";
  const mode = request ? modes[request.format] : "legal";
  const banned = deck?.bannedCards ?? [];
  const future = deck?.futureCards ?? [];
  const blocked = (mode !== "open" && banned.length > 0) || (mode === "legal" && future.length > 0);
  const failures = pending.result && !pending.result.ok
    ? deckErrorMessages(pending.result, intl.formatMessage({ id: "play.error.import" }), {
      unknownCards: (cards) => intl.formatMessage({ id: "lobby.deck.error.unknownCards" }, { cards }),
      unimplementedCards: (cards) => intl.formatMessage({ id: "lobby.deck.error.unimplementedCards" }, { cards }),
    }) : [];

  return (
    <div className="lobby-page fabrary-play-page">
      <LobbyHeader />
      <main id="main-content" className="fabrary-play-main">
        <section className="panel fabrary-play-panel" aria-labelledby="fabrary-play-title">
          <p className="fabrary-play-eyebrow">{intl.formatMessage({ id: "play.source" })}</p>
          <div className="fabrary-play-identity">
            {identity?.heroName ? <HeroPortrait key={identity.heroName} heroName={identity.heroName} /> : null}
            <div className="fabrary-play-names">
              <h1 id="fabrary-play-title">{identity?.name ?? intl.formatMessage({ id: "play.title" })}</h1>
              {identity?.heroName ? <p className="fabrary-play-hero">{identity.heroName}</p> : null}
            </div>
          </div>
          {request ? (
            <div className="fabrary-play-source">
              <FormatName format={request.format} />
              <a href={request.url} target="_blank" rel="noreferrer">
                {intl.formatMessage({ id: "play.view.deck" })}
              </a>
            </div>
          ) : null}

          {!pending.route.ok ? <p className="error" role="alert">{intl.formatMessage({ id: pending.route.error })}</p>
            : !authUser ? (
              <>
                {!pending.preview || pending.preview.status === "loading" ? (
                  <p className="muted" role="status">{intl.formatMessage({ id: "play.preview.loading" })}</p>
                ) : pending.preview.result && !pending.preview.result.ok ? (
                  <div className="error" role="alert">
                    <p>{pending.preview.result.error}</p>
                    <button onClick={() => void preview()}>{intl.formatMessage({ id: "play.retry" })}</button>
                  </div>
                ) : null}
                <p className="muted">{intl.formatMessage({ id: "play.sign.in" })}</p>
                <Auth initialMode="register" />
              </>
            ) : pending.status === "idle" || pending.status === "loading" ? (
              <p role="status">{intl.formatMessage({ id: "play.importing" })}</p>
            ) : pending.status === "error" ? (
              <>
                <div className="error" role="alert">
                  {failures.map((message, index) => <p key={index}>{message}</p>)}
                </div>
                <button className="btn-primary" onClick={() => void resolve()}>
                  {intl.formatMessage({ id: "play.retry" })}
                </button>
              </>
            ) : deck && request ? (
              <>
                <div className="fabrary-play-settings">
                  <span className="fabrary-play-label">{intl.formatMessage({ id: "lobby.cardPool.title" })}</span>
                  <CardPoolModeControl value={mode} disabled={starting}
                    onChange={(value) => { setShowBots(false); setMode(request.format, value); }} />
                  {blocked ? (
                    <p className="fabrary-play-mode-hint" role="status">
                      {intl.formatMessage({ id: banned.length > 0 ? "play.banned" : "play.future" })}
                    </p>
                  ) : null}
                </div>
                <div className="fabrary-play-actions">
                  <button className="btn-primary" disabled={blocked || starting}
                    onClick={() => start({ kind: "player" })}>
                    {intl.formatMessage({ id: "play.find.player" })}
                  </button>
                  <button className="fabrary-play-bot" disabled={blocked || starting} onClick={() => setShowBots(true)}>
                    {intl.formatMessage({ id: "play.bot" })}
                  </button>
                </div>
                {banned.length > 0 || future.length > 0 ? (
                  <div className="fabrary-play-card-notes">
                    {banned.length > 0 ? <CardNotes kind="banned" cards={banned} /> : null}
                    {future.length > 0 ? <CardNotes kind="future" cards={future} /> : null}
                  </div>
                ) : null}
                {starting ? <p role="status">{intl.formatMessage({ id: "play.starting" })}</p> : null}
                {error ? (
                  <div className="error" role="alert">
                    <p>{error}</p>
                    <button disabled={starting} onClick={() => void resolve(true)}>
                      {intl.formatMessage({ id: "play.refresh" })}
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          <button className="linklike fabrary-play-cancel" disabled={starting} onClick={dismiss}>
            {intl.formatMessage({ id: "play.back" })}
          </button>
        </section>
      </main>
      <SiteFooter />
      {showBots && request && deck && !blocked ? (
        <BotOpponentModal format={request.format} cardPoolMode={mode} initialSearchForPlayer={false}
          onClose={() => setShowBots(false)}
          onSelect={(bot, searchForPlayer) => { setShowBots(false); start({ kind: "bot", bot, searchForPlayer }); }} />
      ) : null}
    </div>
  );
}

function CardNotes({ kind, cards }: { kind: "banned" | "future"; cards: string[] }) {
  const intl = useIntl();
  return (
    <details className="fabrary-play-card-note">
      <summary>{intl.formatMessage({ id: `play.cards.${kind}` }, { count: cards.length })}</summary>
      <ul>{cards.map((card) => <li key={card}>{card}</li>)}</ul>
    </details>
  );
}

function HeroPortrait({ heroName }: { heroName: string }) {
  const [available, setAvailable] = useState(true);
  return available ? (
    <img className="fabrary-play-portrait" src={heroImageUrl(heroName)} alt=""
      width={80} height={80} onError={() => setAvailable(false)} />
  ) : null;
}
