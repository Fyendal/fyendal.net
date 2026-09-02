import { useState } from "react";
import { useIntl } from "react-intl";
import { useStore } from "../store.js";
import { validateAuthInput, type AuthValidationError } from "./validation.js";

type AuthError =
  | { kind: "local"; code: AuthValidationError | "termsRequired" }
  | { kind: "server"; message: string };

export function Auth(props: { initialMode?: "login" | "register" } = {}) {
  const intl = useIntl();
  const login = useStore((state) => state.login);
  const register = useStore((state) => state.register);
  const [mode, setMode] = useState<"login" | "register">(props.initialMode ?? "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (mode === "register" && !acceptedTerms) {
      return setError({ kind: "local", code: "termsRequired" });
    }
    const err = validateAuthInput(username.trim(), password, mode);
    if (err) return setError({ kind: "local", code: err });
    setBusy(true);
    setError(null);
    if (mode === "login") {
      const res = await login(username.trim(), password);
      if (!res.ok) setError({ kind: "server", message: res.error });
      // success: store updates authUser; Lobby swaps this card out
    } else {
      const res = await register(username.trim(), password);
      if (!res.ok) setError({ kind: "server", message: res.error });
      // Success authenticates immediately; the parent swaps this card out.
    }
    setBusy(false);
  }

  function changeMode(nextMode: "login" | "register") {
    setMode(nextMode);
    setError(null);
    setAcceptedTerms(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-tabs">
        <button
          type="button"
          className={mode === "login" ? "auth-tab active" : "auth-tab"}
          aria-pressed={mode === "login"}
          onClick={() => changeMode("login")}
        >
          {intl.formatMessage({ id: "auth.login" })}
        </button>
        <button
          type="button"
          className={mode === "register" ? "auth-tab active" : "auth-tab"}
          aria-pressed={mode === "register"}
          onClick={() => changeMode("register")}
        >
          {intl.formatMessage({ id: "auth.register" })}
        </button>
      </div>
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
          <label className="auth-field">
            <span>{intl.formatMessage({ id: "auth.username" })}</span>
            <input
              name="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Dracai"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              minLength={mode === "register" ? 3 : undefined}
              maxLength={20}
              pattern={mode === "register" ? "[a-zA-Z0-9_]{3,20}" : undefined}
              title={
                mode === "register"
                  ? intl.formatMessage({ id: "auth.usernameHint" })
                  : undefined
              }
            />
          </label>
          <label className="auth-field">
            <span>{intl.formatMessage({ id: "auth.password" })}</span>
            <input
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={intl.formatMessage({
                id:
                  mode === "register"
                    ? "auth.passwordRegisterPlaceholder"
                    : "auth.passwordLoginPlaceholder",
              })}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
            />
          </label>
          {mode === "register" ? (
            <label className="auth-consent">
              <input
                type="checkbox"
                name="termsAccepted"
                checked={acceptedTerms}
                onChange={(event) => setAcceptedTerms(event.target.checked)}
                required
              />
              <span>
                {intl.formatMessage(
                  { id: "auth.consent" },
                  {
                    terms: (chunks) => (
                      <a href="/terms/" target="_blank" rel="noreferrer">
                        {chunks}
                      </a>
                    ),
                    privacy: (chunks) => (
                      <a href="/privacy/" target="_blank" rel="noreferrer">
                        {chunks}
                      </a>
                    ),
                  },
                )}
              </span>
            </label>
          ) : null}
          {error ? (
            <div className="error" role="alert">
              {error.kind === "server"
                ? error.message
                : intl.formatMessage({ id: `auth.error.${error.code}` })}
            </div>
          ) : null}
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy
              ? intl.formatMessage({
                  id: mode === "login" ? "auth.loggingIn" : "auth.creatingAccount",
                })
              : intl.formatMessage({
                  id: mode === "login" ? "auth.login" : "auth.createAccount",
                })}
          </button>
      </form>
    </div>
  );
}
