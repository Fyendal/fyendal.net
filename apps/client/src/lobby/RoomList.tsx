import { useState } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { RoomSummary } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { useStore } from "../store.js";
import { formatLabel } from "./FormatBadge.js";
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
  const intl = useIntl();
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
        <h2 className="panel-title">{intl.formatMessage({ id: "lobby.rooms.all" })}</h2>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          {intl.formatMessage({ id: "lobby.rooms.create" })}
        </button>
      </div>
      {rooms.length === 0 ? (
        <p className="muted">{intl.formatMessage({ id: "lobby.rooms.empty" })}</p>
      ) : null}
      {yourRooms.length > 0 ? (
        <section className="room-section">
          <h3 className="panel-title">{intl.formatMessage({ id: "lobby.rooms.yours" })}</h3>
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
          <h3 className="panel-title">{intl.formatMessage({ id: "lobby.rooms.open" })}</h3>
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
          <h3 className="panel-title">{intl.formatMessage({ id: "lobby.rooms.started" })}</h3>
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
            <h2 className="panel-title">
              {intl.formatMessage({ id: "lobby.rooms.pickDeck" }, { code: picker.code })}
            </h2>
            {pickerDecks.length === 0 ? (
              <p className="muted">
                {intl.formatMessage(
                  { id: "lobby.rooms.noFormatDecks" },
                  { format: formatLabel(intl, picker.format) },
                )}{" "}
                <button
                  className="linklike"
                  onClick={() => {
                    setPicker(null);
                    props.onGoToFormat(picker.format as ConstructedFormat);
                  }}
                >
                  {intl.formatMessage({ id: "lobby.rooms.importOne" })}
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
              <button onClick={() => setPicker(null)}>{intl.formatMessage({ id: "common.cancel" })}</button>
            </div>
          </div>
        </div>
      )}

      {heroPick && (
        <div className="modal-backdrop" onClick={() => setHeroPick(null)}>
          <div className="deck-pick-modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="panel-title">
              {intl.formatMessage({ id: "lobby.rooms.pickHero" }, { code: heroPick.code })}
            </h2>
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
              <button onClick={() => setHeroPick(null)}>{intl.formatMessage({ id: "common.cancel" })}</button>
            </div>
          </div>
        </div>
      )}

      {creating ? <CreateRoomModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
