import { useIntl } from "react-intl";

interface RoomLoadingProps {
  roomCode: string | null;
}

/** Neutral holding screen while a saved room session loads its first
 * authoritative game or prep projection. */
export function RoomLoading({ roomCode }: RoomLoadingProps) {
  const intl = useIntl();
  return (
    <div className="lobby-page room-loading-page">
      <main className="panel waiting-panel room-loading-panel">
        <div role="status" aria-live="polite" aria-labelledby="room-loading-title">
          <h1 className="panel-title" id="room-loading-title">
            {intl.formatMessage({ id: "lobby.room.restoring" })}
          </h1>
          {roomCode ? <div className="room-code" translate="no">{roomCode}</div> : null}
          <p className="muted">{intl.formatMessage({ id: "lobby.room.loadingState" })}</p>
        </div>
      </main>
    </div>
  );
}
