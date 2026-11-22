/** `/release-notes` reopens the current version update, even after dismissal. */
export function isReleaseNotesPath(pathname: string): boolean {
  return /^\/release-notes\/?$/.test(pathname);
}
