const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export function validateAuthInput(
  username: string,
  password: string,
  mode: "login" | "register",
): string | null {
  if (mode === "register") {
    if (!USERNAME_RE.test(username)) {
      return "username must be 3–20 characters using letters, numbers, or _";
    }
  } else if (!username) {
    return "enter your username";
  }
  if (mode === "register" && password.length < 8) return "password must be at least 8 characters";
  if (!password) return "enter your password";
  return null;
}
