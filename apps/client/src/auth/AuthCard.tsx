import { useState } from "react";
import { useStore } from "../store.js";
import { validateAuthInput } from "./validation.js";

export function Auth(props: { initialMode?: "login" | "register" } = {}) {
  const login = useStore((state) => state.login);
  const register = useStore((state) => state.register);
  const [mode, setMode] = useState<"login" | "register">(props.initialMode ?? "login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    const err = validateAuthInput(username.trim(), password, mode);
    if (err) return setError(err);
    setBusy(true);
    setError(null);
    if (mode === "login") {
      const res = await login(username.trim(), password);
      if (!res.ok) setError(res.error);
      // success: store updates authUser; Lobby swaps this card out
    } else {
      const res = await register(username.trim(), password);
      if (!res.ok) setError(res.error);
      // Success authenticates immediately; the parent swaps this card out.
    }
    setBusy(false);
  }

  return (
    <div className="auth-card">
      <div className="auth-tabs">
        <button className={mode === "login" ? "auth-tab active" : "auth-tab"} onClick={() => { setMode("login"); setError(null); }}>
          Log in
        </button>
        <button className={mode === "register" ? "auth-tab active" : "auth-tab"} onClick={() => { setMode("register"); setError(null); }}>
          Register
        </button>
      </div>
      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void submit();
        }}
      >
        <input
          name="username"
          aria-label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="username"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          minLength={mode === "register" ? 3 : undefined}
          maxLength={20}
          pattern={mode === "register" ? "[a-zA-Z0-9_]{3,20}" : undefined}
          title={mode === "register" ? "3–20 letters, numbers, or underscores" : undefined}
        />
        <input
          name="password"
          aria-label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "register" ? "password (8+ characters)" : "password"}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
        />
        {error && <div className="error" role="alert">{error}</div>}
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "Log in" : "Create account"}
        </button>
      </form>
    </div>
  );
}
