// Anonymous usage counts through Umami Cloud (cookieless). Only the production
// host loads the tracker, so local development and previews never report.
// Never pass usernames, room codes, deck contents, or other per-player data.
// The production CSP lives in the deploy repository's deploy-client-pages.sh;
// it must allow cloud.umami.is in script-src and gateway.umami.is in connect-src.

import type { LobbyRail } from "./store/types.js";

const UMAMI_SCRIPT = "https://cloud.umami.is/script.js";
const UMAMI_WEBSITE_ID = "9764b4fa-5abd-46db-b787-8833d831b12a";
const PRODUCTION_HOSTS: readonly string[] = ["fyendal.net", "www.fyendal.net"];

interface UmamiPayload {
  url?: string;
  [key: string]: unknown;
}

interface Umami {
  track(payload: (props: UmamiPayload) => UmamiPayload): void;
}

declare global {
  interface Window {
    umami?: Umami;
  }
}

let enabled = false;
const pending: UmamiPayload[] = [];

// Room codes live in the path, so every report is attributed to the site root.
function send(payload: UmamiPayload): void {
  if (!enabled) return;
  if (window.umami) {
    window.umami.track((props) => ({ ...props, ...payload, url: "/" }));
  } else if (pending.length < 50) {
    pending.push(payload);
  }
}

/** Loads the tracker on the production host and records one page view. */
export function initAnalytics(): void {
  if (enabled || !PRODUCTION_HOSTS.includes(location.hostname)) return;
  enabled = true;
  const script = document.createElement("script");
  script.defer = true;
  script.src = UMAMI_SCRIPT;
  script.dataset.websiteId = UMAMI_WEBSITE_ID;
  script.dataset.autoTrack = "false";
  script.dataset.domains = PRODUCTION_HOSTS.join(",");
  script.addEventListener("load", () => {
    for (const payload of pending.splice(0)) send(payload);
  });
  document.head.appendChild(script);
  send({});
}

/** Records a switch to another main lobby tab. */
export function trackLobbyTab(tab: LobbyRail): void {
  send({ name: "lobby-tab", data: { tab } });
}
