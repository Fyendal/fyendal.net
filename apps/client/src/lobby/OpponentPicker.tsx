import { useState } from "react";
import { useIntl } from "react-intl";
import type { HomeGameMode } from "../storage.js";
import { UiIcon } from "../components/UiIcon.js";

/** Player or bot, and for a player game whether strangers may be matched in. */
export function OpponentPicker({
  mode,
  disabled,
  labelledBy,
  onChange,
}: {
  mode: HomeGameMode;
  disabled: boolean;
  labelledBy?: string;
  onChange: (mode: HomeGameMode) => void;
}) {
  const intl = useIntl();
  // Kept across a detour to Bot so returning to Player restores the choice.
  const [privateRoom, setPrivateRoom] = useState(mode === "invite-friend");
  const bot = mode === "bot";

  return (
    <div className="opponent-picker">
      <div className="opponent-picker-row">
        <div
          className="opponent-picker-segments"
          role="group"
          aria-labelledby={labelledBy}
          aria-label={labelledBy ? undefined : intl.formatMessage({ id: "lobby.home.opponent" })}
        >
          <button
            type="button"
            aria-pressed={!bot}
            disabled={disabled}
            onClick={() => onChange(privateRoom ? "invite-friend" : "find-match")}
          >
            <UiIcon name="friends" />
            {intl.formatMessage({ id: "lobby.home.opponentPlayer" })}
          </button>
          <button type="button" aria-pressed={bot} disabled={disabled} onClick={() => onChange("bot")}>
            <UiIcon name="bot" />
            {intl.formatMessage({ id: "lobby.home.opponentBot" })}
          </button>
        </div>
        <label className="opponent-picker-private">
          <input
            type="checkbox"
            role="switch"
            checked={!bot && privateRoom}
            disabled={disabled || bot}
            onChange={(event) => {
              setPrivateRoom(event.target.checked);
              onChange(event.target.checked ? "invite-friend" : "find-match");
            }}
          />
          <span className="opponent-picker-switch" aria-hidden="true" />
          <UiIcon name="lock" />
          {intl.formatMessage({ id: "lobby.home.private" })}
        </label>
      </div>
      <p className="opponent-picker-hint">
        {intl.formatMessage({ id: bot
          ? "lobby.home.hint.bot"
          : mode === "invite-friend"
            ? "lobby.home.hint.private"
            : "lobby.home.hint.public" })}
      </p>
    </div>
  );
}

/** The start button's label names what it will do. */
export function startMessageId(mode: HomeGameMode): string {
  return mode === "bot"
    ? "lobby.action.playBot"
    : mode === "invite-friend"
      ? "lobby.home.createRoom"
      : "lobby.action.findMatch";
}
