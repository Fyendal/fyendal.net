import { useEffect, useState } from "react";
import { useIntl } from "react-intl";
import type { PlayerBadge } from "@fyendal/shared";
import type { AccountBadgesResponse } from "@fyendal/protocol";
import { useStore } from "../store.js";
import { BadgePicker } from "./BadgePicker.js";

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
  const [busy, setBusy] = useState<"badges" | "export" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAccountBadges().then((result) => {
      if (!active) return;
      if (result.ok) setBadges(result);
      else setError(result.error);
    });
    return () => { active = false; };
  }, [getAccountBadges]);

  const chooseBadge = async (badge: PlayerBadge | null) => {
    if (badges?.selectedBadge === badge) return;
    setBusy("badges");
    setError(null);
    setNote(null);
    const result = await selectAccountBadge(badge);
    if (result.ok) {
      setBadges(result);
      setNote(intl.formatMessage({ id: "account.badge.updated" }));
    } else {
      setError(result.error);
    }
    setBusy(null);
  };

  const downloadExport = async () => {
    if (!authToken) return;
    setBusy("export");
    setError(null);
    const result = await exportAccount();
    if (!result.ok) {
      setError(result.error);
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
    const result = await deleteAccount(password);
    if (!result.ok) {
      setError(result.error);
      setBusy(null);
      return;
    }
  };

  return (
    <div className="panel account-panel">
      <h2 className="panel-title">{intl.formatMessage({ id: "account.title" })}</h2>
      <p>
        {intl.formatMessage(
          { id: "account.signedInAs" },
          { username: authUser, strong: (chunks) => <strong>{chunks}</strong> },
        )}
      </p>
      <section>
        <h3>{intl.formatMessage({ id: "account.badge.title" })}</h3>
        <p>{intl.formatMessage({ id: "account.badge.description" })}</p>
        {badges ? (
          <BadgePicker
            availableBadges={badges.availableBadges}
            selectedBadge={badges.selectedBadge}
            disabled={busy !== null}
            onSelect={(badge) => void chooseBadge(badge)}
          />
        ) : (
          <p className="muted">{intl.formatMessage({ id: "account.badge.loading" })}</p>
        )}
      </section>
      <section>
        <h3>{intl.formatMessage({ id: "account.export.title" })}</h3>
        <p>{intl.formatMessage({ id: "account.export.description" })}</p>
        <button disabled={busy !== null} onClick={() => void downloadExport()}>
          {intl.formatMessage({
            id: busy === "export" ? "account.export.preparing" : "account.export.download",
          })}
        </button>
      </section>
      <section className="account-danger">
        <h3>{intl.formatMessage({ id: "account.delete.title" })}</h3>
        <p>{intl.formatMessage({ id: "account.delete.description" })}</p>
        <form
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
      </section>
      {note && <p className="success" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
