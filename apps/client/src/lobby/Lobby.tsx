import { lazy, Suspense, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { apiStats, type StatsOk } from "../auth/auth.js";
import { Auth } from "../auth/AuthCard.js";
import type { ConstructedFormat } from "../domain.js";
import { SiteFooter } from "../legal/SiteFooter.js";
import { LobbyHeader } from "./LobbyHeader.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { LanguagePicker } from "../i18n/LanguagePicker.js";
import { SocialMenuButton, UnreadMessageBadge } from "../social/MobileSocialControls.js";
import { mobileLobbyDestinationSelected } from "./mobileNavigation.js";
import {
  GuestLandingDetails,
  GuestLandingHero,
} from "./GuestLanding.js";

const RoomList = lazy(() => import("./RoomList.js").then((module) => ({ default: module.RoomList })));
const Home = lazy(() => import("./Home.js").then((module) => ({ default: module.Home })));
const RoomInviteModal = lazy(() => import("./RoomInviteModal.js").then((module) => ({ default: module.RoomInviteModal })));
const DeckLibrary = lazy(() => import("./DeckLibrary.js").then((module) => ({ default: module.DeckLibrary })));
const AccountPanel = lazy(() => import("../auth/AccountPanel.js").then((module) => ({ default: module.AccountPanel })));
const ReplayLibrary = lazy(() => import("../replay/ReplayLibrary.js").then((module) => ({ default: module.ReplayLibrary })));

function MobileLobbyIcon({ kind }: { kind: "home" | "decks" | "rooms" | "replays" | "more" }) {
  const content = kind === "home" ? (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7" />
    </>
  ) : kind === "decks" ? (
    <>
      <rect x="6" y="3.5" width="12" height="17" rx="2" />
      <path d="M9 8h6M9 12h6M3.5 7v11a2 2 0 0 0 2 2" />
    </>
  ) : kind === "rooms" ? (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20v-2a5.5 5.5 0 0 1 11 0v2M14 15a4.5 4.5 0 0 1 6.5 4v1" />
    </>
  ) : kind === "replays" ? (
    <>
      <path d="M4.5 8V3.5M4.5 3.5H9" />
      <path d="M5 7a8.5 8.5 0 1 1-1 8" />
      <path d="m10 9 6 3-6 3Z" />
    </>
  ) : (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  );
  return (
    <svg
      className="mobile-lobby-nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {content}
    </svg>
  );
}

export function Lobby() {
  const intl = useIntl();
  const {
    error,
    spectatorKicked,
    connected,
    authUser,
    logout,
    listRooms,
    rooms,
    inviteRoom,
    savedReplays,
    rail,
    setRail,
    unreadMessageCount,
    setSocialOpen,
  } = useStore(useShallow((state) => ({
    error: state.error,
    spectatorKicked: state.spectatorKicked,
    connected: state.connected,
    authUser: state.authUser,
    logout: state.logout,
    listRooms: state.listRooms,
    rooms: state.rooms,
    inviteRoom: state.inviteRoom,
    savedReplays: state.savedReplays,
    rail: state.lobbyRail,
    setRail: state.setLobbyRail,
    unreadMessageCount: state.friends.reduce((total, friend) => total + friend.unreadCount, 0),
    setSocialOpen: state.setSocialOpen,
  })));
  const [deckFormatFilter, setDeckFormatFilter] = useState<"all" | ConstructedFormat>("all");
  const [stats, setStats] = useState<StatsOk | null>(null);
  const [showMobileMore, setShowMobileMore] = useState(false);
  const rejoinRoomCount = rooms.reduce(
    (count, room) => count + (room.yours === true ? 1 : 0),
    0,
  );

  // open the socket only for logged-in users (anonymous visitors get a plain
  // HTTP stats poll below — there is nothing for them to do over ws)
  useEffect(() => {
    if (authUser) listRooms();
  }, [authUser, listRooms]);

  // logged-out landing: live stats over HTTP, refreshed periodically
  useEffect(() => {
    if (authUser) return;
    let stop = false;
    const load = () =>
      apiStats().then((r) => {
        if (!stop && r.ok) setStats(r);
      });
    void load();
    const timer = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [authUser]);

  const goToDecks = (format?: ConstructedFormat) => {
    if (format) setDeckFormatFilter(format);
    setRail("decks");
  };

  if (!authUser) {
    return (
      <div className="lobby-page">
        <LobbyHeader />

        <main id="main-content" className="guest-landing">
          <div className="intro-grid">
            <GuestLandingHero stats={stats} />
            <aside
              id="create-account"
              className="intro-auth"
              aria-label={intl.formatMessage({ id: "landing.accountAccess" })}
            >
              <Auth />
            </aside>
          </div>
          <GuestLandingDetails />
        </main>
        {inviteRoom ? <Suspense fallback={null}><RoomInviteModal /></Suspense> : null}
        <SiteFooter />
      {spectatorKicked ? (
        <div className="toast">{intl.formatMessage({ id: "game.spectating.kicked" })}</div>
      ) : error ? <div className="toast">{error}</div> : null}
      </div>
    );
  }

  return (
    <div className="lobby-page lobby-page-authenticated">
      <LobbyHeader />

      <div className="lobby-grid">
        <div className="lobby-rail">
          <div className="panel format-rail">
            <div className="format-list">
              <button
                className={`format-card${rail === "home" ? " selected" : ""}`}
                onClick={() => setRail("home")}
              >
                <span className="format-card-name">{intl.formatMessage({ id: "lobby.nav.home" })}</span>
                {rejoinRoomCount > 0 ? (
                  <span className="format-card-queue">
                    {intl.formatMessage({ id: "lobby.count.rejoin" }, { count: rejoinRoomCount })}
                  </span>
                ) : null}
              </button>
              <button
                className={`format-card${rail === "decks" ? " selected" : ""}`}
                onClick={() => goToDecks()}
              >
                <span className="format-card-name">{intl.formatMessage({ id: "lobby.nav.decks" })}</span>
              </button>
              <button
                className={`format-card${rail === "all" ? " selected" : ""}`}
                onClick={() => setRail("all")}
              >
                <span className="format-card-name">{intl.formatMessage({ id: "lobby.nav.allRooms" })}</span>
                {rooms.length > 0 ? (
                  <span className="format-card-queue">
                    {intl.formatMessage({ id: "lobby.count.live" }, { count: rooms.length })}
                  </span>
                ) : null}
              </button>
              <button
                className={`format-card${rail === "replays" ? " selected" : ""}`}
                onClick={() => setRail("replays")}
              >
                <span className="format-card-name">{intl.formatMessage({ id: "lobby.nav.replays" })}</span>
                {savedReplays.length > 0 ? (
                  <span className="format-card-queue">
                    {intl.formatMessage({ id: "lobby.count.saved" }, { count: savedReplays.length })}
                  </span>
                ) : null}
              </button>
              <button
                className={`format-card${rail === "account" ? " selected" : ""}`}
                onClick={() => setRail("account")}
              >
                <span className="format-card-name">{intl.formatMessage({ id: "lobby.nav.account" })}</span>
              </button>
            </div>
          </div>
        </div>

        <div className="lobby-main">
          <Suspense fallback={rail === "home"
            ? (
                <div className="panel home-panel">
                  <p className="muted" role="status">{intl.formatMessage({ id: "lobby.loadingDecks" })}</p>
                </div>
              )
            : <p className="muted" role="status">{intl.formatMessage({ id: "common.loading" })}</p>}>
            {rail === "home" && <Home />}
            {rail === "all" && <RoomList onGoToDecks={goToDecks} />}
            {rail === "decks" && (
              <DeckLibrary formatFilter={deckFormatFilter} onFormatFilterChange={setDeckFormatFilter} />
            )}
            {rail === "replays" && <ReplayLibrary />}
            {rail === "account" && <AccountPanel />}
          </Suspense>
        </div>
      </div>
      <nav className="mobile-lobby-nav" aria-label={intl.formatMessage({ id: "lobby.nav.primary" })}>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("home", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("home", rail) ? "page" : undefined}
          onClick={() => setRail("home")}
        >
          <MobileLobbyIcon kind="home" />
          <span className="mobile-lobby-nav-label">{intl.formatMessage({ id: "lobby.nav.home" })}</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("decks", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("decks", rail) ? "page" : undefined}
          onClick={() => goToDecks()}
        >
          <MobileLobbyIcon kind="decks" />
          <span className="mobile-lobby-nav-label">{intl.formatMessage({ id: "lobby.nav.decks" })}</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("all", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("all", rail) ? "page" : undefined}
          onClick={() => setRail("all")}
        >
          <MobileLobbyIcon kind="rooms" />
          <span className="mobile-lobby-nav-label">{intl.formatMessage({ id: "lobby.nav.rooms" })}</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("replays", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("replays", rail) ? "page" : undefined}
          onClick={() => setRail("replays")}
        >
          <MobileLobbyIcon kind="replays" />
          <span className="mobile-lobby-nav-label">{intl.formatMessage({ id: "lobby.nav.replays" })}</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("more", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("more", rail) ? "page" : undefined}
          aria-expanded={showMobileMore}
          onClick={() => setShowMobileMore(true)}
        >
          <MobileLobbyIcon kind="more" />
          <UnreadMessageBadge count={unreadMessageCount} />
          <span className="mobile-lobby-nav-label">{intl.formatMessage({ id: "lobby.nav.more" })}</span>
        </button>
      </nav>
      {showMobileMore ? (
        <ModalSurface
          title={intl.formatMessage({ id: "lobby.nav.more" })}
          className="mobile-lobby-more"
          onClose={() => setShowMobileMore(false)}
        >
          <div className="mobile-more-user">
            <span>{authUser}</span>
            <strong className={connected ? "connected" : "disconnected"}>
              {intl.formatMessage({
                id: connected ? "common.connection.connected" : "common.connection.reconnecting",
              })}
            </strong>
          </div>
          <div className="mobile-more-actions">
            <SocialMenuButton onOpen={() => {
              setShowMobileMore(false);
              setSocialOpen(true);
            }} />
            <LanguagePicker />
            <button
              onClick={() => {
                setRail("account");
                setShowMobileMore(false);
              }}
            >
              {intl.formatMessage({ id: "lobby.nav.account" })}
            </button>
            <a href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer">
              {intl.formatMessage({ id: "lobby.discordCommunity" })}
            </a>
            <a href="/terms">{intl.formatMessage({ id: "footer.terms" })}</a>
            <a href="/privacy">{intl.formatMessage({ id: "footer.privacy" })}</a>
            <button className="mobile-more-logout" onClick={() => void logout()}>
              {intl.formatMessage({ id: "common.logOut" })}
            </button>
          </div>
        </ModalSurface>
      ) : null}
      {inviteRoom ? <Suspense fallback={null}><RoomInviteModal /></Suspense> : null}
      <SiteFooter />
      {spectatorKicked ? (
        <div className="toast">{intl.formatMessage({ id: "game.spectating.kicked" })}</div>
      ) : error ? <div className="toast">{error}</div> : null}
    </div>
  );
}
