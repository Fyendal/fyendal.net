import { lazy, Suspense, useEffect, useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import type { LobbyRail } from "../store/types.js";
import { apiStats, type StatsOk } from "../auth/auth.js";
import { Auth } from "../auth/AuthCard.js";
import type { Format } from "@fyendal/shared";
import { SiteFooter } from "../legal/SiteFooter.js";
import { LobbyHeader } from "./LobbyHeader.js";
import { ModalSurface } from "../components/ModalSurface.js";
import { LanguagePicker } from "../i18n/LanguagePicker.js";
import { SocialMenuButton, UnreadMessageBadge } from "../social/MobileSocialControls.js";
import { mobileLobbyDestinationSelected, type MobileLobbyDestination } from "./mobileNavigation.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";
import { FullscreenButton } from "../components/FullscreenButton.js";
import { GlobalNoticeBanner } from "../notices/GlobalNoticeBanner.js";
import { leagueActionCount } from "../league/pendingActions.js";
import {
  GuestLandingDetails,
  GuestLandingHero,
} from "./GuestLanding.js";

interface RailPlace {
  rail: LobbyRail;
  label: string;
  count?: string;
}

interface MobilePlace {
  rail: Exclude<MobileLobbyDestination, "more">;
  icon: UiIconName;
  label: string;
}

const RoomList = lazy(() => import("./RoomList.js").then((module) => ({ default: module.RoomList })));
const Home = lazy(() => import("./Home.js").then((module) => ({ default: module.Home })));
const RoomInviteModal = lazy(() => import("./RoomInviteModal.js").then((module) => ({ default: module.RoomInviteModal })));
const DeckLibrary = lazy(() => import("./DeckLibrary.js").then((module) => ({ default: module.DeckLibrary })));
const AccountPanel = lazy(() => import("../auth/AccountPanel.js").then((module) => ({ default: module.AccountPanel })));
const AchievementsPanel = lazy(() => import("../achievements/AchievementsPanel.js").then((module) => ({ default: module.AchievementsPanel })));
const LeaguePanel = lazy(() => import("../league/LeaguePanel.js").then((module) => ({ default: module.LeaguePanel })));
const MatchHistory = lazy(() => import("../history/MatchHistory.js").then((module) => ({ default: module.MatchHistory })));
const VersionUpdateModal = lazy(() => import("../notices/VersionUpdateModal.js")
  .then((module) => ({ default: module.VersionUpdateModal })));

export function Lobby() {
  const intl = useIntl();
  const {
    error,
    spectatorKicked,
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
    hasLeague,
    leagueActions,
    refreshLeagues,
  } = useStore(useShallow((state) => ({
    error: state.error,
    spectatorKicked: state.spectatorKicked,
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
    hasLeague: (state.leagues?.length ?? 0) > 0,
    leagueActions: leagueActionCount(state.leagues, Date.now()),
    refreshLeagues: state.refreshLeagues,
  })));
  const [deckFormatFilter, setDeckFormatFilter] = useState<"all" | Format>("all");
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

  useEffect(() => {
    if (authUser) void refreshLeagues();
  }, [authUser, refreshLeagues]);

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

  const goToDecks = (format?: Format) => {
    if (format) setDeckFormatFilter(format);
    setRail("decks");
  };

  if (!authUser) {
    return (
      <div className="lobby-page">
        <GlobalNoticeBanner />
        <LobbyHeader />

        <main id="main-content" className="guest-landing">
          <div className="intro-grid stage-panel">
            <GuestLandingHero stats={stats} />
            <aside
              id="create-account"
              className="intro-auth stage-side"
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

  const railPlaces: RailPlace[] = [
    {
      rail: "home",
      label: intl.formatMessage({ id: "lobby.nav.home" }),
      count: rejoinRoomCount > 0
        ? intl.formatMessage({ id: "lobby.count.rejoin" }, { count: rejoinRoomCount })
        : undefined,
    },
    { rail: "decks", label: intl.formatMessage({ id: "lobby.nav.decks" }) },
    {
      rail: "all",
      label: intl.formatMessage({ id: "lobby.nav.allRooms" }),
      count: rooms.length > 0
        ? intl.formatMessage({ id: "lobby.count.live" }, { count: rooms.length })
        : undefined,
    },
    { rail: "history", label: intl.formatMessage({ id: "lobby.nav.history" }) },
    ...(hasLeague || rail === "league"
      ? [{
          rail: "league" as const,
          label: intl.formatMessage({ id: "lobby.nav.league" }),
          count: leagueActions > 0 ? intl.formatMessage({ id: "lobby.count.leagueActions" }, { count: leagueActions }) : undefined,
        }]
      : []),
    { rail: "achievements", label: intl.formatMessage({ id: "achievements.title" }) },
  ];
  const mobilePlaces: MobilePlace[] = [
    { rail: "home", icon: "nav-home", label: intl.formatMessage({ id: "lobby.nav.home" }) },
    { rail: "decks", icon: "nav-decks", label: intl.formatMessage({ id: "lobby.nav.decks" }) },
    { rail: "all", icon: "nav-rooms", label: intl.formatMessage({ id: "lobby.nav.rooms" }) },
    { rail: "history", icon: "nav-history", label: intl.formatMessage({ id: "lobby.nav.historyShort" }) },
  ];
  const railButton = (place: RailPlace) => (
    <button
      key={place.rail}
      className={`rail-nav-item${rail === place.rail ? " selected" : ""}`}
      aria-current={rail === place.rail ? "page" : undefined}
      onClick={() => setRail(place.rail)}
    >
      <span className="rail-nav-label">{place.label}</span>
      {place.count ? <span className="rail-nav-count">{place.count}</span> : null}
    </button>
  );

  return (
    <div className="lobby-page lobby-page-authenticated">
      {rail === "home" ? <GlobalNoticeBanner /> : null}
      <LobbyHeader />
      {rail === "home" && !inviteRoom
        ? <Suspense fallback={null}><VersionUpdateModal key={authUser} username={authUser} /></Suspense>
        : null}

      <div className="lobby-grid">
        <div className="lobby-rail">
          <nav className="rail-nav" aria-label={intl.formatMessage({ id: "lobby.nav.primary" })}>
            {railPlaces.map(railButton)}
            <hr className="rail-nav-divider" />
            {railButton({ rail: "account", label: intl.formatMessage({ id: "lobby.nav.account" }) })}
          </nav>
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
            {rail === "history" && <MatchHistory />}
            {rail === "league" && <LeaguePanel />}
            {rail === "achievements" && <AchievementsPanel />}
            {rail === "account" && <AccountPanel />}
          </Suspense>
        </div>
      </div>
      <nav className="mobile-lobby-nav" aria-label={intl.formatMessage({ id: "lobby.nav.primary" })}>
        {mobilePlaces.map((place) => {
          const current = mobileLobbyDestinationSelected(place.rail, rail);
          return (
            <button
              key={place.rail}
              type="button"
              // While the More sheet is open it is the only marked place.
              className={current && !showMobileMore ? "selected" : ""}
              aria-current={current ? "page" : undefined}
              onClick={() => setRail(place.rail)}
            >
              <UiIcon name={place.icon} className="mobile-lobby-nav-icon" />
              <span className="mobile-lobby-nav-label">{place.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={mobileLobbyDestinationSelected("more", rail) ? "selected" : ""}
          aria-current={mobileLobbyDestinationSelected("more", rail) ? "page" : undefined}
          aria-expanded={showMobileMore}
          onClick={() => setShowMobileMore(true)}
        >
          <UiIcon name="more" className="mobile-lobby-nav-icon" />
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
          <div className="mobile-more">
            <div className="mobile-more-group">
              <LanguagePicker placement="menu" />
            </div>
            <div className="mobile-more-group">
              <SocialMenuButton onOpen={() => {
                setShowMobileMore(false);
                setSocialOpen(true);
              }} />
              {hasLeague ? (
                <button onClick={() => { setRail("league"); setShowMobileMore(false); }}>
                  {intl.formatMessage({ id: "lobby.nav.league" })}
                  {leagueActions > 0 ? (
                    <span className="mobile-more-count">
                      {intl.formatMessage({ id: "lobby.count.leagueActions" }, { count: leagueActions })}
                    </span>
                  ) : null}
                </button>
              ) : null}
              <button onClick={() => { setRail("achievements"); setShowMobileMore(false); }}>
                {intl.formatMessage({ id: "achievements.title" })}
              </button>
              <button
                onClick={() => {
                  setRail("account");
                  setShowMobileMore(false);
                }}
              >
                {intl.formatMessage({ id: "lobby.nav.account" })}
              </button>
            </div>
            <div className="mobile-more-group">
              <a href="https://discord.gg/DpTjVbfPVv" target="_blank" rel="noopener noreferrer">
                {intl.formatMessage({ id: "lobby.discordCommunity" })}
              </a>
              <FullscreenButton placement="menu" onToggle={() => setShowMobileMore(false)} />
            </div>
            <div className="mobile-more-group">
              <button className="mobile-more-logout" onClick={() => void logout()}>
                {intl.formatMessage({ id: "common.logOut" })}
              </button>
            </div>
            <div className="mobile-more-legal">
              <a href="/terms">{intl.formatMessage({ id: "footer.terms" })}</a>
              <a href="/privacy">{intl.formatMessage({ id: "footer.privacy" })}</a>
            </div>
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
