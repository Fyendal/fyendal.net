import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { RoomSummary } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { FORMAT_LABELS } from "./FormatBadge.js";
import {
  DeckTile,
  deckChoicesFor,
  deckIsLegalForRoom,
} from "./DeckGrid.js";
import { CreateRoomModal } from "./CreateRoomModal.js";
import { RoomCard } from "./RoomCard.js";

/**
 * Every live room, grouped into pre-game rooms above started games. Open
 * rooms can be joined (constructed rooms require
 * picking one of your decks of that format first, Classic Battles rooms a
 * box hero — mirror matches allowed — both via a modal); full rooms
 * (in prep or mid-game) are spectate-only.
 * Rooms your account still seats offer a Rejoin button (the server reclaims
 * the seat by token or account).
 */
export function RoomList(props: { onGoToFormat: (format: ConstructedFormat) => void }) {
  const { rooms, joinRoom, decks } = useStore(useShallow((state) => ({
    rooms: state.rooms,
    joinRoom: state.joinRoom,
    decks: state.decks,
  })));
  /** constructed room awaiting the joiner's deck choice */
  const [picker, setPicker] = useState<RoomSummary | null>(null);
  /** classic-battles room awaiting the joiner's hero choice */
  const [heroPick, setHeroPick] = useState<RoomSummary | null>(null);
  const [creating, setCreating] = useState(false);

  const yourRooms = rooms.filter((room) => room.yours === true);
  const otherRooms = rooms.filter((room) => room.yours !== true);
  const openRooms = otherRooms.filter((room) => room.started !== true);
  const startedGames = otherRooms.filter((room) => room.started === true);

  const join = (room: RoomSummary) => {
    if (room.format === "classic-battles") {
      setHeroPick(room);
      return;
    }
    setPicker(room);
  };
  const rejoin = (code: string) => joinRoom(code);
  const spectate = (code: string) => joinRoom(code, undefined, true);

  const pickerDecks = picker
    ? deckChoicesFor(picker.format as ConstructedFormat, decks, picker.allowFutureCards === true)
    : [];

  return (
    <div className="panel all-rooms-panel">
      <div className="rooms-header">
        <h2 className="panel-title">All Rooms</h2>
        <button className="btn-primary" onClick={() => setCreating(true)}>Create Room</button>
      </div>
      {rooms.length === 0 ? (
        <p className="muted">no public games to spectate right now</p>
      ) : null}
      {yourRooms.length > 0 ? (
        <section className="room-section">
          <h3 className="panel-title">Your Rooms</h3>
          <div className="room-grid">
            {yourRooms.map((room) => (
              <RoomCard
                key={room.code}
                room={room}
                onJoin={join}
                onRejoin={rejoin}
                onSpectate={spectate}
              />
            ))}
          </div>
        </section>
      ) : null}
      {openRooms.length > 0 ? (
        <section className="room-section">
          <h3 className="panel-title">Open Rooms</h3>
          <div className="room-grid">
            {openRooms.map((room) => (
              <RoomCard
                key={room.code}
                room={room}
                onJoin={join}
                onRejoin={rejoin}
                onSpectate={spectate}
              />
            ))}
          </div>
        </section>
      ) : null}
      {startedGames.length > 0 ? (
        <section className="room-section">
          <h3 className="panel-title">Started Games</h3>
          <div className="room-grid">
            {startedGames.map((room) => (
              <RoomCard
                key={room.code}
                room={room}
                onJoin={join}
                onRejoin={rejoin}
                onSpectate={spectate}
              />
            ))}
          </div>
        </section>
      ) : null}

      {picker && (
        <div className="modal-backdrop" onClick={() => setPicker(null)}>
          <div className="deck-pick-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="panel-title">Join {picker.code} — pick a deck</h2>
            {pickerDecks.length === 0 ? (
              <p className="muted">
                no {FORMAT_LABELS[picker.format]} decks yet —{" "}
                <button
                  className="linklike"
                  onClick={() => {
                    setPicker(null);
                    props.onGoToFormat(picker.format as ConstructedFormat);
                  }}
                >
                  import one
                </button>
              </p>
            ) : (
              <div className="deck-grid">
                {pickerDecks.map((d) => (
                  <DeckTile
                    key={d.id}
                    deck={d}
                    blocked={!deckIsLegalForRoom(d, picker.allowFutureCards === true)}
                    onSelect={() => {
                      joinRoom(picker.code, d.id);
                      setPicker(null);
                    }}
                  />
                ))}
              </div>
            )}
            <div className="deck-actions">
              <button onClick={() => setPicker(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {heroPick && (
        <div className="modal-backdrop" onClick={() => setHeroPick(null)}>
          <div className="deck-pick-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="panel-title">Join {heroPick.code} — pick a hero</h2>
            <div className="lobby-row">
              <button
                onClick={() => {
                  joinRoom(heroPick.code, undefined, undefined, "rhinar");
                  setHeroPick(null);
                }}
              >
                Rhinar
              </button>
              <button
                onClick={() => {
                  joinRoom(heroPick.code, undefined, undefined, "dorinthea");
                  setHeroPick(null);
                }}
              >
                Dorinthea
              </button>
            </div>
            <div className="deck-actions">
              <button onClick={() => setHeroPick(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {creating ? <CreateRoomModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
