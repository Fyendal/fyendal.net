import { useState } from "react";
import { useIntl } from "react-intl";
import { EMAIL_MAX_LENGTH } from "@fyendal/protocol";
import { useStore } from "../store.js";
import { apiForgotPassword } from "./auth.js";
import { isValidEmail, validateAuthInput, type AuthValidationError } from "./validation.js";

type AuthError =
  | { kind: "local"; code: AuthValidationError | "termsRequired" | "missingIdentifier" }
  | { kind: "server"; message: string };

type AuthMode = "login" | "register" | "forgot";

export function Auth(props: { initialMode?: "login" | "register" } = {}) {
  const intl = useIntl();
  const login = useStore((state) => state.login);
  const register = useStore((state) => state.register);
  const [mode, setMode] = useState<AuthMode>(props.initialMode ?? "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<AuthError | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetRequested, setResetRequested] = useState(false);

  async function submitForgot() {
    const identifier = username.trim();
    if (!identifier) return setError({ kind: "local", code: "missingIdentifier" });
    setBusy(true);
    setError(null);
    const res = await apiForgotPassword(identifier);
    if (res.ok) setResetRequested(true);
    else setError({ kind: "server", message: res.error });
    setBusy(false);
  }

  async function submit() {
    if (mode === "forgot") return submitForgot();
    if (mode === "register" && !acceptedTerms) {
      return setError({ kind: "local", code: "termsRequired" });
    }
    const err = validateAuthInput(username.trim(), password, mode);
    if (err) return setError({ kind: "local", code: err });
    if (mode === "register" && email.trim() && !isValidEmail(email)) {
      return setError({ kind: "local", code: "invalidEmail" });
    }
    setBusy(true);
    setError(null);
    if (mode === "login") {
      const res = await login(username.trim(), password);
      if (!res.ok) setError({ kind: "server", message: res.error });
      // success: store updates authUser; Lobby swaps this card out
    } else {
      const res = await register(username.trim(), password, email.trim() || undefined);
      if (!res.ok) setError({ kind: "server", message: res.error });
      // Success authenticates immediately; the parent swaps this card out.
    }
    setBusy(false);
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setAcceptedTerms(false);
    setResetRequested(false);
  }

  const submitLabel = {
    login: busy ? "auth.loggingIn" : "auth.login",
    register: busy ? "auth.creatingAccount" : "auth.createAccount",
    forgot: busy ? "auth.forgot.sending" : "auth.forgot.send",
  }[mode];
  const backToLogin = (
    <button type="button" className="auth-link" onClick={() => changeMode("login")}>
      {intl.formatMessage({ id: "auth.forgot.back" })}
    </button>
  );

  return (
    <div className="auth-card">
      <div className="auth-tabs">
        <button
          type="button"
          className={mode !== "register" ? "auth-tab active" : "auth-tab"}
          aria-pressed={mode !== "register"}
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
      {mode === "forgot" && resetRequested ? (
        <div className="auth-form">
          <p className="auth-note" role="status">{intl.formatMessage({ id: "auth.forgot.sent" })}</p>
          {backToLogin}
        </div>
      ) : (
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
          {mode === "forgot" ? (
            <p className="auth-note">{intl.formatMessage({ id: "auth.forgot.description" })}</p>
          ) : null}
          <label className="auth-field">
            <span>
              {intl.formatMessage({ id: mode === "forgot" ? "auth.forgot.identifier" : "auth.username" })}
            </span>
            <input
              name={mode === "forgot" ? "identifier" : "username"}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Dracai"
              autoComplete={mode === "forgot" ? "username email" : "username"}
              autoCapitalize="none"
              spellCheck={false}
              minLength={mode === "register" ? 3 : undefined}
              maxLength={mode === "forgot" ? EMAIL_MAX_LENGTH : 20}
              pattern={mode === "register" ? "[a-zA-Z0-9_]{3,20}" : undefined}
            />
            {mode === "register" ? (
              <small className="auth-field-hint">{intl.formatMessage({ id: "auth.usernameHint" })}</small>
            ) : null}
          </label>
          {mode !== "forgot" ? (
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
          ) : null}
          {mode === "register" ? (
            <label className="auth-field">
              <span>{intl.formatMessage({ id: "auth.email.label" })}</span>
              <input
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={intl.formatMessage({ id: "auth.email.placeholder" })}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={EMAIL_MAX_LENGTH}
              />
              <small className="auth-field-hint">{intl.formatMessage({ id: "auth.email.hint" })}</small>
            </label>
          ) : null}
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
          <button type="submit" className="stage-cta" disabled={busy}>
            {intl.formatMessage({ id: submitLabel })}
          </button>
          {mode === "login" ? (
            <button type="button" className="auth-link" onClick={() => changeMode("forgot")}>
              {intl.formatMessage({ id: "auth.forgot.link" })}
            </button>
          ) : null}
          {mode === "forgot" ? backToLogin : null}
      </form>
      )}
    </div>
  );
}
