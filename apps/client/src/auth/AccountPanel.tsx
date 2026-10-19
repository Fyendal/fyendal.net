import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { PlayerBadge } from "@fyendal/shared";
import type { AccountBadgesResponse } from "@fyendal/protocol";
import { ModalSurface } from "../components/ModalSurface.js";
import { PlayerBadgeMark } from "../game/PlayerBadge.js";
import { useStore } from "../store.js";
import { BadgeArt, badgeMessageIds, BadgePicker } from "./BadgePicker.js";
import { RecoveryEmailSetting } from "./RecoveryEmailSetting.js";
import "../styles/account.css";

type AccountAction = "badges" | "export" | "delete";

export function AccountPanel() {
  const intl = useIntl();
  const authToken = useStore((state) => state.authToken);
  const authUser = useStore((state) => state.authUser);
  const getAccountBadges = useStore((state) => state.getAccountBadges);
  const selectAccountBadge = useStore((state) => state.selectAccountBadge);
  const exportAccount = useStore((state) => state.exportAccount);
  const deleteAccount = useStore((state) => state.deleteAccount);
  const [password, setPassword] = useState("");
  const [badges, setBadges] = useState<AccountBadgesResponse | null>(null);
  const [busy, setBusy] = useState<AccountAction | null>(null);
  // Each failure renders beside the control that caused it.
  const [error, setError] = useState<{ action: AccountAction; message: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // The badge being previewed in the open picker; undefined while it is closed.
  const [draftBadge, setDraftBadge] = useState<PlayerBadge | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void getAccountBadges().then((result) => {
      if (!active) return;
      if (result.ok) setBadges(result);
      else setError({ action: "badges", message: result.error });
    });
    return () => { active = false; };
  }, [getAccountBadges]);

  const openBadgePicker = () => {
    setError(null);
    setNote(null);
    setDraftBadge(badges?.selectedBadge ?? null);
  };

  const closeBadgePicker = () => {
    if (busy === "badges") return;
    setError(null);
    setDraftBadge(undefined);
  };

  const saveBadge = async (badge: PlayerBadge | null) => {
    setBusy("badges");
    setError(null);
    setNote(null);
    const result = await selectAccountBadge(badge);
    if (result.ok) {
      setBadges(result);
      setDraftBadge(undefined);
      setNote(intl.formatMessage({ id: "account.badge.updated" }));
    } else {
      setError({ action: "badges", message: result.error });
    }
    setBusy(null);
  };

  const downloadExport = async () => {
    if (!authToken) return;
    setBusy("export");
    setError(null);
    setNote(null);
    const result = await exportAccount();
    if (!result.ok) {
      setError({ action: "export", message: result.error });
    } else {
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.export, null, 2)], {
        type: "application/json",
      }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `fyendal-account-${Date.now()}.json`;
      link.click();
      URL.revokeObjectURL(url);
    }
    setBusy(null);
  };

  const removeAccount = async () => {
    if (!authToken || !password) return;
    if (!window.confirm(intl.formatMessage({ id: "account.delete.confirm" }))) return;
    setBusy("delete");
    setError(null);
    setNote(null);
    const result = await deleteAccount(password);
    if (!result.ok) {
      setError({ action: "delete", message: result.error });
      setBusy(null);
      return;
    }
  };

  const errorFor = (action: AccountAction) => error?.action === action
    ? <p className="account-feedback error" role="alert">{error.message}</p>
    : null;
  const selectedBadge = badges?.selectedBadge ?? null;
  const currentBadgeIds = badgeMessageIds(selectedBadge);

  return (
    <div className="panel account-panel">
      <header className="account-header">
        <h2 className="panel-title">{intl.formatMessage({ id: "account.title" })}</h2>
        <p className="account-identity">
          {intl.formatMessage(
            { id: "account.signedInAs" },
            { username: authUser, strong: (chunks) => <strong>{chunks}</strong> },
          )}
        </p>
      </header>
      <section className="account-setting" aria-labelledby="account-badge-title">
        <div className="account-setting-copy">
          <h3 id="account-badge-title">{intl.formatMessage({ id: "account.badge.title" })}</h3>
          <p>{intl.formatMessage({ id: "account.badge.description" })}</p>
        </div>
        <div className="account-setting-control">
          {badges ? (
            <div className="account-badge-current">
              <BadgeArt badge={selectedBadge} size={40} />
              <span className="account-badge-copy">
                <strong>{intl.formatMessage({ id: currentBadgeIds.name })}</strong>
                <span>{intl.formatMessage({ id: currentBadgeIds.description })}</span>
              </span>
              <button type="button" disabled={busy !== null} onClick={openBadgePicker}>
                {intl.formatMessage({ id: "account.badge.change" })}
              </button>
            </div>
          ) : error?.action !== "badges" ? (
            <p className="muted" role="status">{intl.formatMessage({ id: "account.badge.loading" })}</p>
          ) : null}
          {note && <p className="account-feedback success" role="status">{note}</p>}
          {draftBadge === undefined ? errorFor("badges") : null}
        </div>
      </section>
      <RecoveryEmailSetting />
      <section className="account-setting" aria-labelledby="account-export-title">
        <div className="account-setting-copy">
          <h3 id="account-export-title">{intl.formatMessage({ id: "account.export.title" })}</h3>
          <p>{intl.formatMessage({ id: "account.export.description" })}</p>
        </div>
        <div className="account-setting-control">
          <button type="button" disabled={busy !== null} onClick={() => void downloadExport()}>
            {intl.formatMessage({
              id: busy === "export" ? "account.export.preparing" : "account.export.download",
            })}
          </button>
          {errorFor("export")}
        </div>
      </section>
      <section className="account-setting account-danger" aria-labelledby="account-delete-title">
        <div className="account-setting-copy">
          <h3 id="account-delete-title">{intl.formatMessage({ id: "account.delete.title" })}</h3>
          <p>{intl.formatMessage({ id: "account.delete.description" })}</p>
        </div>
        <div className="account-setting-control">
          <form
            className="account-delete-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy === null && password) void removeAccount();
            }}
          >
            <input
              name="password"
              aria-label={intl.formatMessage({ id: "account.currentPassword" })}
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={intl.formatMessage({ id: "account.currentPasswordPlaceholder" })}
              autoComplete="current-password"
            />
            <button type="submit" className="btn-danger" disabled={busy !== null || !password}>
              {intl.formatMessage({
                id: busy === "delete" ? "account.delete.deleting" : "account.delete.action",
              })}
            </button>
          </form>
          {errorFor("delete")}
        </div>
      </section>
      {badges && draftBadge !== undefined ? (
        <ModalSurface
          className="account-badge-modal"
          title={intl.formatMessage({ id: "account.badge.title" })}
          description={intl.formatMessage({ id: "account.badge.description" })}
          onClose={closeBadgePicker}
        >
          <div className="account-badge-preview">
            {draftBadge ? <PlayerBadgeMark badge={draftBadge} /> : null}
            <span>{authUser}</span>
          </div>
          <BadgePicker
            availableBadges={badges.availableBadges}
            selectedBadge={draftBadge}
            disabled={busy !== null}
            onSelect={setDraftBadge}
          />
          {errorFor("badges")}
          <div className="account-badge-actions">
            <button type="button" disabled={busy !== null} onClick={closeBadgePicker}>
              {intl.formatMessage({ id: "common.cancel" })}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={busy !== null || draftBadge === selectedBadge}
              onClick={() => void saveBadge(draftBadge)}
            >
              {intl.formatMessage({ id: busy === "badges" ? "account.badge.saving" : "account.badge.save" })}
            </button>
          </div>
        </ModalSurface>
      ) : null}
    </div>
  );
}
