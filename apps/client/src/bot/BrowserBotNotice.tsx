import { useIntl } from "react-intl";
import { useStore } from "../store.js";

export function BrowserBotNotice() {
  const intl = useIntl();
  const status = useStore((state) => state.browserBotStatus);
  const retry = useStore((state) => state.retryBrowserBot);
  if (!status) return null;
  return (
    <div className="browser-bot-notice" role="status">
      <span>{intl.formatMessage({
        id: status === "fallback" ? "game.bot.fallback" : "game.bot.refresh.required",
      })}</span>
      <button type="button" onClick={status === "fallback" ? retry : () => window.location.reload()}>
        {intl.formatMessage({ id: status === "fallback" ? "game.bot.retry" : "game.bot.refresh" })}
      </button>
    </div>
  );
}
