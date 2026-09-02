const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export type AuthValidationError =
  | "invalidUsername"
  | "missingUsername"
  | "shortPassword"
  | "missingPassword";

export function validateAuthInput(
  username: string,
  password: string,
  mode: "login" | "register",
): AuthValidationError | null {
  if (mode === "register") {
    if (!USERNAME_RE.test(username)) {
      return "invalidUsername";
    }
  } else if (!username) {
    return "missingUsername";
  }
  if (mode === "register" && password.length < 8) return "shortPassword";
  if (!password) return "missingPassword";
  return null;
}
