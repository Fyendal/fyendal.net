import { useState } from "react";
import type { RoomSummary } from "@fyendal/shared";
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
  const owned = room.yours === true;
  const full = room.spectateOnly === true;
  const status = owned ? "Your room" : room.started ? "Started" : full ? "Full" : "Open";

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
            Rejoin
          </button>
        ) : (
          <>
            <button
              className="btn-primary"
              disabled={full}
              title={full ? "room is full — spectate to watch" : undefined}
              onClick={() => onJoin?.(room)}
            >
              Join
            </button>
            <button onClick={() => onSpectate?.(room.code)}>Spectate</button>
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
  return (
    <span className="hero-vs">
      <HeroFace name={heroes[0]} />
      <span className="hero-vs-sep">vs</span>
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
