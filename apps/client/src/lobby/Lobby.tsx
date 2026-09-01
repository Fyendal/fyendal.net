import { lazy, Suspense, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { apiStats, type StatsOk } from "../auth/auth.js";
import { Auth } from "../auth/AuthCard.js";
import { CONSTRUCTED_FORMATS, type ConstructedFormat } from "../domain.js";
import { SiteFooter } from "../legal/SiteFooter.js";
import { DiscordLink } from "./DiscordLink.js";
import { FORMAT_LABELS } from "./FormatBadge.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { mobileDeckDestination, mobileLobbyDestinationSelected } from "./mobileNavigation.js";
import {
  GuestLandingDetails,
  GuestLandingHero,
  LobbyBrand,
} from "./GuestLanding.js";

const RoomList = lazy(() => import("./RoomList.js").then((module) => ({ default: module.RoomList })));
const Home = lazy(() => import("./Home.js").then((module) => ({ default: module.Home })));
const RoomInviteModal = lazy(() => import("./RoomInviteModal.js").then((module) => ({ default: module.RoomInviteModal })));
const DeckGrid = lazy(() => import("./DeckGrid.js").then((module) => ({ default: module.DeckGrid })));
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
  const {
    error,
    connected,
    authUser,
    logout,
    listRooms,
    decks,
    rooms,
    queueCounts,
    inviteRoom,
    savedReplays,
    rail,
    setRail,
    bugReportNotifications,
    refreshBugReportNotifications,
    dismissBugReportNotifications,
  } = useStore(useShallow((state) => ({
    error: state.error,
    connected: state.connected,
    authUser: state.authUser,
    logout: state.logout,
    listRooms: state.listRooms,
    decks: state.decks,
    rooms: state.rooms,
    queueCounts: state.queueCounts,
    inviteRoom: state.inviteRoom,
    savedReplays: state.savedReplays,
    rail: state.lobbyRail,
    setRail: state.setLobbyRail,
    bugReportNotifications: state.bugReportNotifications,
    refreshBugReportNotifications: state.refreshBugReportNotifications,
    dismissBugReportNotifications: state.dismissBugReportNotifications,
  })));
  /** selected saved deck per constructed format */
  const [deckFor, setDeckFor] = useState<Record<ConstructedFormat, string>>({
    cc: "",
    "silver-age": "",
  });
  const [stats, setStats] = useState<StatsOk | null>(null);
  const [lastDeckFormat, setLastDeckFormat] = useState<ConstructedFormat>("cc");
  const [showMobileMore, setShowMobileMore] = useState(false);
  const bugReportNotification = bugReportNotifications[0];
  const rejoinRoomCount = rooms.reduce(
    (count, room) => count + (room.yours === true ? 1 : 0),
    0,
  );

  // open the socket only for logged-in users (anonymous visitors get a plain
  // HTTP stats poll below — there is nothing for them to do over ws)
  useEffect(() => {
    if (authUser) listRooms();
  }, [authUser, listRooms]);

  useEffect(() => {
    if (!authUser) return;
    void refreshBugReportNotifications();
  }, [authUser, refreshBugReportNotifications]);

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

  // Close a deck menu if its deck disappears or no longer belongs to the
  // current format. Menus only open in response to an explicit deck click.
  useEffect(() => {
    setDeckFor((prev) => {
      const next = { ...prev };
      for (const f of CONSTRUCTED_FORMATS) {
        const stillAvailable = next[f].startsWith("precon-") ||
          decks.some((deck) => deck.id === next[f] && deck.format === f);
        if (next[f] && !stillAvailable) next[f] = "";
      }
      return next;
    });
  }, [decks]);

  useEffect(() => {
    if (rail === "cc" || rail === "silver-age") setLastDeckFormat(rail);
  }, [rail]);

  if (!authUser) {
    return (
      <div className="lobby-page">
        <header className="topbar lobby-topbar lobby-topbar-guest">
          <LobbyBrand />
          <div className="topbar-actions">
            <div className="topbar-tools">
              <DiscordLink />
            </div>
          </div>
        </header>

        <main id="main-content" className="guest-landing">
          <div className="intro-grid">
            <GuestLandingHero stats={stats} />
            <aside id="create-account" className="intro-auth" aria-label="Account access">
              <Auth />
            </aside>
          </div>
          <GuestLandingDetails />
        </main>
        {inviteRoom ? <Suspense fallback={null}><RoomInviteModal /></Suspense> : null}
        <SiteFooter />
      {error && <div className="toast">{error}</div>}
      </div>
    );
  }

  return (
    <div className="lobby-page lobby-page-authenticated">
      <header className="topbar lobby-topbar lobby-topbar-authenticated">
        <LobbyBrand />
        {bugReportNotification ? (
          <div className="bug-fixed-notification" role="status" aria-live="polite">
            <span className="bug-fixed-notification-icon" aria-hidden="true">✓</span>
            <span>
              <strong>Bug fixed</strong>
              A bug you reported has been fixed. Thanks for helping us improve Fyendal!
            </span>
            <button
              type="button"
              aria-label="Dismiss bug fixed notification"
              onClick={() => void dismissBugReportNotifications()}
            >
              ×
            </button>
          </div>
        ) : null}
        <div className="topbar-actions">
          <div className="topbar-tools">
            <DiscordLink />
          </div>
          <div className="topbar-account">
            <span className="user-chip">
              <span className="user-name">{authUser}</span>
              <button className="linklike" onClick={() => void logout()}>
                Log out
              </button>
            </span>
            <span className="mobile-user-name" title={authUser ?? undefined}>{authUser}</span>
            <span className={`conn-dot${connected ? " on" : ""}`} title={connected ? "connected" : "not connected"} />
          </div>
        </div>
      </header>

      <div className="lobby-grid">
        <div className="lobby-rail">
          <div className="panel format-rail">
            <div className="format-list">
              <button
                className={`format-card${rail === "home" ? " selected" : ""}`}
                onClick={() => setRail("home")}
              >
                <span className="format-card-name">Home</span>
                {rejoinRoomCount > 0 ? (
                  <span className="format-card-queue">{rejoinRoomCount} to rejoin</span>
                ) : null}
              </button>
              {CONSTRUCTED_FORMATS.map((f) => {
                return (
                  <button
                    key={f}
                    className={`format-card${f === rail ? " selected" : ""}`}
                    onClick={() => setRail(f)}
                  >
                    <span className="format-card-name">{FORMAT_LABELS[f]}</span>
                    {queueCounts[f] > 0 ? (
                      <span className="format-card-queue">{queueCounts[f]} waiting</span>
                    ) : null}
                  </button>
                );
              })}
              <button
                className={`format-card${rail === "all" ? " selected" : ""}`}
                onClick={() => setRail("all")}
              >
                <span className="format-card-name">All Rooms</span>
                {rooms.length > 0 ? (
                  <span className="format-card-queue">{rooms.length} live</span>
                ) : null}
              </button>
              <button
                className={`format-card${rail === "replays" ? " selected" : ""}`}
                onClick={() => setRail("replays")}
              >
                <span className="format-card-name">Replays</span>
                {savedReplays.length > 0 ? (
                  <span className="format-card-queue">{savedReplays.length} saved</span>
                ) : null}
              </button>
              <button
                className={`format-card${rail === "account" ? " selected" : ""}`}
                onClick={() => setRail("account")}
              >
                <span className="format-card-name">Account</span>
              </button>
            </div>
          </div>
        </div>

        <div className="lobby-main">
          <Suspense fallback={rail === "home"
            ? (
                <div className="panel home-panel">
                  <p className="muted" role="status">Loading your decks…</p>
                </div>
              )
            : <p className="muted" role="status">Loading…</p>}>
            {rail === "home" && <Home onGoToFormat={setRail} />}
            {rail === "all" && <RoomList onGoToFormat={setRail} />}
            {(rail === "cc" || rail === "silver-age") && (
              <DeckGrid
                key={rail}
                format={rail}
                deckId={deckFor[rail]}
                onSelect={(id) => setDeckFor((p) => ({ ...p, [rail]: id }))}
                onFormatChange={setRail}
              />
            )}
            {rail === "replays" && <ReplayLibrary />}
            {rail === "account" && <AccountPanel />}
          </Suspense>
        </div>
      </div>
      <nav className="mobile-lobby-nav" aria-label="Primary navigation">
        <button
          type="button"
          className={mobileLobbyDestinationSelected("home", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("home", rail) ? "page" : undefined}
          onClick={() => setRail("home")}
        >
          <MobileLobbyIcon kind="home" />
          <span className="mobile-lobby-nav-label">Home</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("decks", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("decks", rail) ? "page" : undefined}
          onClick={() => setRail(mobileDeckDestination(lastDeckFormat))}
        >
          <MobileLobbyIcon kind="decks" />
          <span className="mobile-lobby-nav-label">Decks</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("all", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("all", rail) ? "page" : undefined}
          onClick={() => setRail("all")}
        >
          <MobileLobbyIcon kind="rooms" />
          <span className="mobile-lobby-nav-label">Rooms</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("replays", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("replays", rail) ? "page" : undefined}
          onClick={() => setRail("replays")}
        >
          <MobileLobbyIcon kind="replays" />
          <span className="mobile-lobby-nav-label">Replays</span>
        </button>
        <button
          type="button"
          className={mobileLobbyDestinationSelected("more", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("more", rail) ? "page" : undefined}
          aria-expanded={showMobileMore}
          onClick={() => setShowMobileMore(true)}
        >
          <MobileLobbyIcon kind="more" />
          <span className="mobile-lobby-nav-label">More</span>
        </button>
      </nav>
      {showMobileMore ? (
        <ModalSurface
          title="More"
          className="mobile-lobby-more"
          onClose={() => setShowMobileMore(false)}
        >
          <div className="mobile-more-user">
            <span>{authUser}</span>
            <strong className={connected ? "connected" : "disconnected"}>
              {connected ? "Connected" : "Reconnecting…"}
            </strong>
          </div>
          <div className="mobile-more-actions">
            <button
              onClick={() => {
                setRail("account");
                setShowMobileMore(false);
              }}
            >
              Account
            </button>
            <a href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer">
              Discord Community
            </a>
            <a href="/terms">Terms of Service</a>
            <a href="/privacy">Privacy Policy</a>
            <button className="mobile-more-logout" onClick={() => void logout()}>Log Out</button>
          </div>
        </ModalSurface>
      ) : null}
      {inviteRoom ? <Suspense fallback={null}><RoomInviteModal /></Suspense> : null}
      <SiteFooter />
      {error && <div className="toast">{error}</div>}
    </div>
  );
}
