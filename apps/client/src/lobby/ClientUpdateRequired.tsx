import { useIntl } from "react-intl";

/** Visible on every app screen until a reload obtains a compatible client. */
export function ClientUpdateRequired() {
  const intl = useIntl();
  return (
    <div className="lobby-page room-loading-page">
      <main className="panel waiting-panel room-loading-panel" aria-labelledby="client-update-title">
        <h1 className="panel-title" id="client-update-title">
          {intl.formatMessage({ id: "connection.update.title" })}
        </h1>
        <p role="alert">{intl.formatMessage({ id: "connection.update.description" })}</p>
        <button type="button" onClick={() => window.location.reload()}>
          {intl.formatMessage({ id: "connection.update.refresh" })}
        </button>
      </main>
    </div>
  );
}
