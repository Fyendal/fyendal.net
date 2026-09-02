import { useState } from "react";
import type { RoomSummary } from "@fyendal/shared";
import { useIntl } from "react-intl";
import { FormatBadge } from "./FormatBadge.js";
import { heroImageUrl } from "./heroImage.js";

export function RoomCard({
  room,
  onJoin,
  onRejoin,
  onSpectate,
}: {
  room: RoomSummary;
  onJoin?: (room: RoomSummary) => void;
  onRejoin: (code: string) => void;
  onSpectate?: (code: string) => void;
}) {
  const intl = useIntl();
  const owned = room.yours === true;
  const full = room.spectateOnly === true;
  const status = intl.formatMessage({
    id: owned
      ? "lobby.room.status.yours"
      : room.started
        ? "lobby.room.status.started"
        : full
          ? "lobby.room.status.full"
          : "lobby.room.status.open",
  });

  return (
    <article className={`room-card${owned ? " owned" : ""}`}>
      <div className="room-card-header">
        <FormatBadge format={room.format} />
        <RoomStatus label={status} />
      </div>
      <div className="room-card-matchup">
        <HeroVs heroes={room.heroes} />
      </div>
      <div className="room-card-actions">
        {owned ? (
          <button className="btn-primary" onClick={() => onRejoin(room.code)}>
            {intl.formatMessage({ id: "lobby.action.rejoin" })}
          </button>
        ) : (
          <>
            <button
              className="btn-primary"
              disabled={full}
              title={full ? intl.formatMessage({ id: "lobby.room.fullHint" }) : undefined}
              onClick={() => onJoin?.(room)}
            >
              {intl.formatMessage({ id: "lobby.action.join" })}
            </button>
            <button onClick={() => onSpectate?.(room.code)}>
              {intl.formatMessage({ id: "lobby.action.spectate" })}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function RoomStatus({ label }: { label: string }) {
  return (
    <span className="room-card-status">
      <span className="live-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

/** The two seats as vs headshots; an open seat is a "?" placeholder. */
function HeroVs({ heroes }: { heroes: [string | null, string | null] }) {
  const intl = useIntl();
  return (
    <span className="hero-vs">
      <HeroFace name={heroes[0]} />
      <span className="hero-vs-sep">{intl.formatMessage({ id: "common.versusShort" })}</span>
      <HeroFace name={heroes[1]} />
    </span>
  );
}

function HeroFace({ name }: { name: string | null }) {
  const [imgOk, setImgOk] = useState(true);
  if (!name) return <span className="hero-face hero-face-empty">?</span>;
  if (!imgOk) {
    // a headshot slug that misses on Fabrary falls back to the hero initial
    return (
      <span className="hero-face hero-face-empty" title={name}>
        {name.charAt(0)}
      </span>
    );
  }
  return (
    <img
      className="hero-face"
      src={heroImageUrl(name)}
      alt={name}
      title={name}
      width={52}
      height={52}
      loading="lazy"
      onError={() => setImgOk(false)}
    />
  );
}
