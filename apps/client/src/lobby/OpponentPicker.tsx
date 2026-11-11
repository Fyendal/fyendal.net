import { useIntl } from "react-intl";
import type { HomeGameMode } from "../storage.js";
import { TooltipButton } from "../components/TooltipButton.js";
import { UiIcon, type UiIconName } from "../components/UiIcon.js";

const OPTIONS: readonly { mode: HomeGameMode; icon: UiIconName; label: string; hint: string }[] = [
  { mode: "find-match", icon: "friends", label: "lobby.home.opponentAnyone", hint: "lobby.home.opponentAnyoneHint" },
  { mode: "invite-friend", icon: "lock", label: "lobby.home.opponentPrivate", hint: "lobby.home.opponentPrivateHint" },
  { mode: "bot", icon: "bot", label: "lobby.home.opponentBot", hint: "lobby.home.opponentBotHint" },
];

/** Who the game is against; each choice explains itself in a tooltip, and
 * matchmaking carries the live count of players it could pair with. */
export function OpponentPicker({
  mode,
  disabled,
  labelledBy,
  searching = 0,
  onChange,
}: {
  mode: HomeGameMode;
  disabled: boolean;
  labelledBy?: string;
  searching?: number;
  onChange: (mode: HomeGameMode) => void;
}) {
  const intl = useIntl();

  return (
    <div
      className="opponent-picker"
      role="group"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : intl.formatMessage({ id: "lobby.home.opponent" })}
    >
      {OPTIONS.map((option) => {
        const live = option.mode === "find-match" && searching > 0;
        const hint = live
          ? intl.formatMessage({ id: "lobby.home.opponentAnyoneLiveHint" }, { count: searching })
          : intl.formatMessage({ id: option.hint });
        return (
          <TooltipButton
            key={option.mode}
            // The visible label names the button; the hint only describes it.
            aria-label={undefined}
            aria-description={hint}
            aria-pressed={option.mode === mode}
            disabled={disabled}
            tooltip={hint}
            tooltipSide="above"
            onClick={() => onChange(option.mode)}
          >
            <UiIcon name={option.icon} />
            {intl.formatMessage({ id: option.label })}
            {live ? (
              <span className="opponent-picker-live" aria-hidden="true">
                <span className="home-play-live-dot" />
                {intl.formatNumber(searching)}
              </span>
            ) : null}
          </TooltipButton>
        );
      })}
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
