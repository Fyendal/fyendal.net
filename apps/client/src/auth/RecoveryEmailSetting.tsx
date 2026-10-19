import { useEffect, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { EMAIL_MAX_LENGTH, type AccountEmailResponse, type ApiError } from "@fyendal/protocol";
import { useStore } from "../store.js";
import { isValidEmail } from "./validation.js";

type Busy = "save" | "remove" | null;

const strong = (chunks: ReactNode[]) => <strong>{chunks}</strong>;

/** Account setting for the optional, verified password-recovery address. */
export function RecoveryEmailSetting() {
  const intl = useIntl();
  const getAccountEmail = useStore((state) => state.getAccountEmail);
  const setAccountEmail = useStore((state) => state.setAccountEmail);
  const removeAccountEmail = useStore((state) => state.removeAccountEmail);
  const [current, setCurrent] = useState<AccountEmailResponse | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getAccountEmail().then((result) => {
      if (!active) return;
      if (result.ok) setCurrent(result);
      else setError(result.error);
    });
    return () => { active = false; };
  }, [getAccountEmail]);

  /** Mutations answer with the new state, so no reload follows them. */
  const run = async (
    action: Exclude<Busy, null>,
    request: () => Promise<AccountEmailResponse | ApiError>,
    successNote: string,
  ) => {
    setBusy(action);
    setError(null);
    setNote(null);
    const result = await request();
    if (result.ok) {
      setCurrent(result);
      setNote(successNote);
      setEmail("");
      setPassword("");
    } else {
      setError(result.error);
    }
    setBusy(null);
  };

  const save = () => {
    if (!isValidEmail(email)) return setError(intl.formatMessage({ id: "auth.error.invalidEmail" }));
    const address = email.trim();
    void run(
      "save",
      () => setAccountEmail(password, address),
      intl.formatMessage({ id: "account.email.sent" }, { email: address }),
    );
  };

  const remove = () => {
    if (!password) return setError(intl.formatMessage({ id: "account.email.passwordRequired" }));
    void run("remove", () => removeAccountEmail(password), intl.formatMessage({ id: "account.email.removed" }));
  };

  const hasAddress = !!current && (current.email !== null || current.pendingEmail !== null);

  return (
    <section className="account-setting" aria-labelledby="account-email-title">
      <div className="account-setting-copy">
        <h3 id="account-email-title">{intl.formatMessage({ id: "account.email.title" })}</h3>
        <p>{intl.formatMessage({ id: "account.email.description" })}</p>
      </div>
      <div className="account-setting-control">
        {current === null ? (
          error ? null : <p className="muted" role="status">{intl.formatMessage({ id: "account.email.loading" })}</p>
        ) : !current.available ? (
          <p className="muted">{intl.formatMessage({ id: "account.email.unavailable" })}</p>
        ) : (
          <>
            <div className="account-email-status">
              <p>
                {current.email
                  ? intl.formatMessage({ id: "account.email.current" }, { email: current.email, strong })
                  : intl.formatMessage({ id: "account.email.none" })}
              </p>
              {current.pendingEmail ? (
                <p className="muted">
                  {intl.formatMessage({ id: "account.email.pending" }, { email: current.pendingEmail, strong })}
                </p>
              ) : null}
            </div>
            <form
              className="account-email-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (busy === null && email && password) save();
              }}
            >
              <input
                name="email"
                type="email"
                aria-label={intl.formatMessage({ id: "auth.email.label" })}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder={intl.formatMessage({
                  id: current.email ? "account.email.newPlaceholder" : "auth.email.placeholder",
                })}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={EMAIL_MAX_LENGTH}
              />
              <input
                name="email-password"
                type="password"
                aria-label={intl.formatMessage({ id: "account.currentPassword" })}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={intl.formatMessage({ id: "account.currentPasswordPlaceholder" })}
                autoComplete="current-password"
              />
              <div className="account-email-actions">
                <button type="submit" disabled={busy !== null || !email || !password}>
                  {intl.formatMessage({ id: busy === "save" ? "account.email.saving" : "account.email.save" })}
                </button>
                {hasAddress ? (
                  <button type="button" disabled={busy !== null} onClick={remove}>
                    {intl.formatMessage({ id: busy === "remove" ? "account.email.removing" : "account.email.remove" })}
                  </button>
                ) : null}
              </div>
            </form>
          </>
        )}
        {note ? <p className="account-feedback success" role="status">{note}</p> : null}
        {error ? <p className="account-feedback error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}
