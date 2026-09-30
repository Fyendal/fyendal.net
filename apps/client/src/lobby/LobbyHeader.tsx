import { useEffect } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { LanguagePicker } from "../i18n/LanguagePicker.js";
import { LobbyBrand } from "./GuestLanding.js";
import { DiscordLink } from "./DiscordLink.js";
import { BugFixedNotification } from "./BugFixedNotification.js";
import { FullscreenButton } from "../components/FullscreenButton.js";

export function LobbyHeader() {
  const intl = useIntl();
  const { authUser, connected, logout, notifications, refresh, dismiss, setLobbyRail, dismissFabraryPlay } = useStore(useShallow((state) => ({
    authUser: state.authUser,
    connected: state.connected,
    logout: state.logout,
    notifications: state.bugReportNotifications,
    refresh: state.refreshBugReportNotifications,
    dismiss: state.dismissBugReportNotifications,
    setLobbyRail: state.setLobbyRail,
    dismissFabraryPlay: state.dismissFabraryPlay,
  })));

  useEffect(() => {
    if (authUser) void refresh();
  }, [authUser, refresh]);

  return (
    <header className={`topbar lobby-topbar lobby-topbar-${authUser ? "authenticated" : "guest"}`}>
      <a
        className="brand-home"
        href="/"
        aria-label={intl.formatMessage({ id: "lobby.nav.home" })}
        onClick={(event) => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          setLobbyRail("home");
          dismissFabraryPlay();
        }}
      >
        <LobbyBrand />
      </a>
      {authUser && notifications.length > 0 ? (
        <BugFixedNotification notifications={notifications} onDismiss={() => void dismiss()} />
      ) : null}
      <div className="topbar-actions">
        <div className="topbar-tools">
          <FullscreenButton placement="header" />
          <LanguagePicker />
          <DiscordLink />
        </div>
        {authUser ? (
          <div className="topbar-account">
            <span className="user-chip">
              <span className="user-name">{authUser}</span>
              <button className="linklike" onClick={() => void logout()}>
                {intl.formatMessage({ id: "common.logOut" })}
              </button>
            </span>
            <span className="mobile-user-name" title={authUser}>{authUser}</span>
            <span className={`conn-dot${connected ? " on" : ""}`}
              title={intl.formatMessage({
                id: connected ? "common.connection.connected" : "common.connection.disconnected",
              })} />
          </div>
        ) : null}
      </div>
    </header>
  );
}
