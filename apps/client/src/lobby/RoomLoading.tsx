interface RoomLoadingProps {
  roomCode: string | null;
}

/** Neutral holding screen while a saved room session loads its first
 * authoritative game or prep projection. */
export function RoomLoading({ roomCode }: RoomLoadingProps) {
  return (
    <div className="lobby-page room-loading-page">
      <main className="panel waiting-panel room-loading-panel">
        <div role="status" aria-live="polite" aria-labelledby="room-loading-title">
          <h1 className="panel-title" id="room-loading-title">Restoring Game…</h1>
          {roomCode ? <div className="room-code" translate="no">{roomCode}</div> : null}
          <p className="muted">Loading the latest room state.</p>
        </div>
      </main>
    </div>
  );
}
