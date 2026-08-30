const SAVED_REPLAY_ID = /^[a-f0-9]{24}$/;

export function savedReplayPath(id: string): string {
  return `/replays/${id}`;
}

export function savedReplayIdFromPath(pathname: string): string | null {
  const match = /^\/replays\/([^/]+)\/?$/.exec(pathname);
  const id = match?.[1];
  return id && SAVED_REPLAY_ID.test(id) ? id : null;
}
