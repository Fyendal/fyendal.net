import { useEffect, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { useStore } from "../store.js";
import { apiVerifyEmail } from "./auth.js";
import { isShortPassword } from "./validation.js";
import type { RecoveryRoute } from "./recoveryRoute.js";

/** Email links carry their token in the fragment so it never reaches server
 * logs or a Referer header. Read it once, then drop it from the address bar. */
function useFragmentToken(): string {
  const [token] = useState(() => decodeURIComponent(location.hash.slice(1)));
  useEffect(() => {
    if (location.hash) history.replaceState(null, "", location.pathname);
  }, []);
  return token;
}

export function RecoveryPage(props: { route: RecoveryRoute; onDone: () => void }) {
  return (
    <main className="recovery-page">
      {props.route === "reset-password"
        ? <ResetPasswordCard onDone={props.onDone} />
        : <VerifyEmailCard onDone={props.onDone} />}
    </main>
  );
}

function ResetPasswordCard(props: { onDone: () => void }) {
  const intl = useIntl();
  const token = useFragmentToken();
  const resetPassword = useStore((state) => state.resetPassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (isShortPassword(password)) return setError(intl.formatMessage({ id: "auth.error.shortPassword" }));
    if (password !== confirm) return setError(intl.formatMessage({ id: "auth.reset.mismatch" }));
    setBusy(true);
    setError(null);
    const result = await resetPassword(token, password);
    setBusy(false);
    if (result.ok) props.onDone();
    else setError(result.error === "invalid or expired link"
      ? intl.formatMessage({ id: "auth.reset.invalidLink" })
      : result.error);
  };

  return (
    <div className="auth-card">
      <h1 className="recovery-title">{intl.formatMessage({ id: "auth.reset.title" })}</h1>
      {token ? (
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void submit();
          }}
        >
          <label className="auth-field">
            <span>{intl.formatMessage({ id: "auth.reset.newPassword" })}</span>
            <input
              name="new-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={intl.formatMessage({ id: "auth.passwordRegisterPlaceholder" })}
              autoComplete="new-password"
            />
          </label>
          <label className="auth-field">
            <span>{intl.formatMessage({ id: "auth.reset.confirmPassword" })}</span>
            <input
              name="confirm-password"
              type="password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              autoComplete="new-password"
            />
          </label>
          <p className="auth-note">{intl.formatMessage({ id: "auth.reset.signsOut" })}</p>
          {error ? <div className="error" role="alert">{error}</div> : null}
          <button type="submit" className="btn-primary" disabled={busy}>
            {intl.formatMessage({ id: busy ? "auth.reset.saving" : "auth.reset.save" })}
          </button>
        </form>
      ) : (
        <div className="auth-form">
          <p className="error" role="alert">{intl.formatMessage({ id: "auth.reset.invalidLink" })}</p>
          <button type="button" className="btn-primary" onClick={props.onDone}>
            {intl.formatMessage({ id: "auth.recovery.continue" })}
          </button>
        </div>
      )}
    </div>
  );
}

function VerifyEmailCard(props: { onDone: () => void }) {
  const intl = useIntl();
  const token = useFragmentToken();
  const [status, setStatus] = useState<"verifying" | "verified" | "failed">(token ? "verifying" : "failed");
  const [error, setError] = useState<string | null>(null);
  // A verification link is single-use; never submit it twice, even when
  // development StrictMode replays effects.
  const submitted = useRef(false);

  useEffect(() => {
    if (!token || submitted.current) return;
    submitted.current = true;
    void apiVerifyEmail(token).then((result) => {
      if (result.ok) return setStatus("verified");
      setStatus("failed");
      if (result.error !== "invalid or expired link") setError(result.error);
    });
  }, [token]);

  return (
    <div className="auth-card">
      <h1 className="recovery-title">{intl.formatMessage({ id: "auth.verifyEmail.title" })}</h1>
      <div className="auth-form">
        {status === "verifying" ? (
          <p className="auth-note" role="status">{intl.formatMessage({ id: "auth.verifyEmail.verifying" })}</p>
        ) : status === "verified" ? (
          <p className="auth-note" role="status">{intl.formatMessage({ id: "auth.verifyEmail.verified" })}</p>
        ) : (
          <p className="error" role="alert">
            {error ?? intl.formatMessage({ id: "auth.verifyEmail.invalidLink" })}
          </p>
        )}
        <button type="button" className="btn-primary" disabled={status === "verifying"} onClick={props.onDone}>
          {intl.formatMessage({ id: "auth.recovery.continue" })}
        </button>
      </div>
    </div>
  );
}
