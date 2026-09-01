import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { roomCodeFromUrl, savedRoomCode, useStore } from "./store.js";
import { Lobby } from "./lobby/Lobby.js";
import { RoomLoading } from "./lobby/RoomLoading.js";
import { savedReplayIdFromPath } from "./replay/route.js";

const WaitingRoom = lazy(() => import("./lobby/WaitingRoom.js").then((module) => ({ default: module.WaitingRoom })));
const PrepRoom = lazy(() => import("./prep/PrepRoom.js").then((module) => ({ default: module.PrepRoom })));
const GameBoard = lazy(() => import("./game/GameBoard.js").then((module) => ({ default: module.GameBoard })));
const ReplayBar = lazy(() => import("./replay/ReplayBar.js").then((module) => ({ default: module.ReplayBar })));
const LegalPage = lazy(() => import("./legal/LegalPage.js").then((module) => ({ default: module.LegalPage })));

function setMetaContent(selector: string, content: string): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement("meta");
    const match = /meta\[(name|property)="([^"]+)"\]/.exec(selector);
    if (!match) return;
    const [, attribute, value] = match;
    if (!attribute || !value) return;
    element.setAttribute(attribute, value);
    document.head.append(element);
  }
  element.content = content;
}

function setCanonical(href: string): void {
  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = href;
}

function useRouteMetadata(path: string, privateRoute: boolean): void {
  useEffect(() => {
    if (privateRoute) {
      document.title = "Fyendal — Flesh and Blood Online";
      setMetaContent('meta[name="robots"]', "noindex, nofollow");
      return;
    }

    setMetaContent('meta[name="robots"]', "index, follow");
    if (path === "/terms" || path === "/terms/") {
      document.title = "Terms of Service | Fyendal";
      setCanonical("https://fyendal.net/terms/");
    } else if (path === "/privacy" || path === "/privacy/") {
      document.title = "Privacy Policy | Fyendal";
      setCanonical("https://fyendal.net/privacy/");
    } else {
      document.title = "Play Flesh and Blood Online Free | Fyendal";
      setCanonical("https://fyendal.net/");
    }
  }, [path, privateRoute]);
}

function ScreenFallback() {
  return <div className="screen-loading">Loading…</div>;
}

export function App() {
  const authUser = useStore((state) => state.authUser);
  const authToken = useStore((state) => state.authToken);
  const screen = useStore((state) => state.screen);
  const roomCode = useStore((state) => state.roomCode);
  const activeSavedReplayId = useStore((state) => state.activeSavedReplayId);
  const inspectRoom = useStore((state) => state.inspectRoom);
  const joinRoom = useStore((state) => state.joinRoom);
  const watchSavedReplay = useStore((state) => state.watchSavedReplay);
  const setError = useStore((state) => state.setError);
  const replayLoadRef = useRef<string | null>(null);
  const [, setReplayRouteFailure] = useState<string | null>(null);
  const path = location.pathname;
  const routeRoomCode = roomCodeFromUrl();
  const savedReplayId = savedReplayIdFromPath(path);
  useRouteMetadata(path, routeRoomCode !== null || savedReplayId !== null);
  const restoringSavedRoom = screen === "lobby"
    && authUser !== null
    && routeRoomCode !== null
    && savedRoomCode() === routeRoomCode;

  // Resolve /ROOM-ID as an invite, or reconnect an already-known session.
  useEffect(() => {
    if (!routeRoomCode) return;
    // Known sessions reconnect immediately. New authenticated invitees first
    // inspect the room so they can choose the matching deck or box hero.
    if (authUser && savedRoomCode() === routeRoomCode) joinRoom(routeRoomCode);
    else inspectRoom(routeRoomCode);
  }, [authUser, inspectRoom, joinRoom, routeRoomCode]);

  // Account-saved replays have durable IDs, so their route can be restored
  // after a refresh. Imported replay files intentionally remain local-only.
  useEffect(() => {
    if (
      !savedReplayId ||
      !authToken ||
      (screen === "replay" && activeSavedReplayId === savedReplayId) ||
      replayLoadRef.current === savedReplayId
    ) return;
    replayLoadRef.current = savedReplayId;
    void watchSavedReplay(savedReplayId).then((message) => {
      if (replayLoadRef.current !== savedReplayId) return;
      replayLoadRef.current = null;
      if (!message) return;
      history.replaceState(null, "", "/");
      setError(message);
      setReplayRouteFailure(savedReplayId);
    });
  }, [activeSavedReplayId, authToken, savedReplayId, screen, setError, watchSavedReplay]);

  // legal pages are full-page loads (plain <a href> in the footer); neither
  // path collides with the 6-char room-code pattern
  if (path === "/terms" || path === "/terms/" || path === "/privacy" || path === "/privacy/") {
    return (
      <Suspense fallback={<ScreenFallback />}>
        <LegalPage kind={path.startsWith("/terms") ? "terms" : "privacy"} />
      </Suspense>
    );
  }

  if (savedReplayId && authToken && screen !== "replay") return <ScreenFallback />;

  let content: React.ReactNode;
  if (screen === "game") content = <GameBoard />;
  else if (screen === "replay") content = <><GameBoard /><ReplayBar /></>;
  else if (screen === "room-loading" || restoringSavedRoom) {
    content = <RoomLoading roomCode={roomCode ?? routeRoomCode} />;
  }
  else if (screen === "waiting") content = <WaitingRoom />;
  else if (screen === "prep") content = <PrepRoom />;
  else content = <Lobby />;
  return <Suspense fallback={<ScreenFallback />}>{content}</Suspense>;
}
