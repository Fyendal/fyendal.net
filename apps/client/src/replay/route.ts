import { REPLAY_SHARE_TOKEN_RE } from "@fyendal/protocol";

const SAVED_REPLAY_ID = /^[a-f0-9]{24}$/;

export function savedReplayPath(id: string): string {
  return `/replays/${id}`;
}

/** Share links are short so they paste cleanly into chat. */
export function sharedReplayPath(token: string): string {
  return `/r/${token}`;
}

export function sharedReplayUrl(token: string): string {
  return `${location.origin}${sharedReplayPath(token)}`;
}

export function sharedReplayTokenFromPath(pathname: string): string | null {
  const token = /^\/r\/([^/]+)\/?$/.exec(pathname)?.[1];
  return token && REPLAY_SHARE_TOKEN_RE.test(token) ? token : null;
}

export function savedReplayIdFromPath(pathname: string): string | null {
  const match = /^\/replays\/([^/]+)\/?$/.exec(pathname);
  const id = match?.[1];
  return id && SAVED_REPLAY_ID.test(id) ? id : null;
}
