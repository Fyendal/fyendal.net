import { useEffect, useState } from "react";
import type { PlayerBadge } from "@fyendal/shared";
import type { AccountBadgesResponse } from "@fyendal/protocol";
import { useStore } from "../store.js";
import { BadgePicker } from "./BadgePicker.js";

export function AccountPanel() {
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
      setNote("Displayed badge updated.");
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
    if (!window.confirm("Delete your Fyendal account, saved decks, retained replays, bug reports, sessions, and active rooms from the active service? This cannot be undone.")) return;
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
      <h2 className="panel-title">Account</h2>
      <p>Signed in as <strong>{authUser}</strong>.</p>
      <section>
        <h3>Player badge</h3>
        <p>Choose one earned badge to display before your username, or hide badges.</p>
        {badges ? (
          <BadgePicker
            availableBadges={badges.availableBadges}
            selectedBadge={badges.selectedBadge}
            disabled={busy !== null}
            onSelect={(badge) => void chooseBadge(badge)}
          />
        ) : (
          <p className="muted">Loading badges…</p>
        )}
      </section>
      <section>
        <h3>Export your data</h3>
        <p>Download your account details, saved decklists, room membership records, retained replays, and bug-report references as JSON.</p>
        <button disabled={busy !== null} onClick={() => void downloadExport()}>
          {busy === "export" ? "Preparing…" : "Download account data"}
        </button>
      </section>
      <section className="account-danger">
        <h3>Delete account</h3>
        <p>This permanently removes your account, sessions, saved decks, retained replays, bug reports, and active rooms. Backup copies expire according to the retention policy.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy === null && password) void removeAccount();
          }}
        >
          <input
            name="password"
            aria-label="Current password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="current password"
            autoComplete="current-password"
          />
          <button type="submit" className="btn-danger" disabled={busy !== null || !password}>
            {busy === "delete" ? "Deleting…" : "Delete account"}
          </button>
        </form>
      </section>
      {note && <p className="success" role="status">{note}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
