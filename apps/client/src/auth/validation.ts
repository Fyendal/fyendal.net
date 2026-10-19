import { normalizeEmailAddress, PASSWORD_MIN_LENGTH } from "@fyendal/protocol";

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

export type AuthValidationError =
  | "invalidUsername"
  | "missingUsername"
  | "shortPassword"
  | "missingPassword"
  | "invalidEmail";

export function isShortPassword(password: string): boolean {
  return password.length < PASSWORD_MIN_LENGTH;
}

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
  if (mode === "register" && isShortPassword(password)) return "shortPassword";
  if (!password) return "missingPassword";
  return null;
}

export function isValidEmail(email: string): boolean {
  return normalizeEmailAddress(email) !== null;
}
