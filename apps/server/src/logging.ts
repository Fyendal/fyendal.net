/** Shared error logger contract for best-effort background work. */
export type ErrorLogger = (message: string, error?: unknown) => void;

/** Default process logger, injectable at subsystem boundaries for tests. */
export const consoleError: ErrorLogger = (message, error) => {
  if (error === undefined) console.error(message);
  else console.error(message, error);
};
