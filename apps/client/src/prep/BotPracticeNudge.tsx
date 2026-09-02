import { useState } from "react";
import { useIntl } from "react-intl";
import type { BotOpponent, Format } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { BotOpponentModal } from "../lobby/BotOpponentModal.js";

export const BOT_PRACTICE_NUDGE_DELAY_MS = 30_000;

export function botPracticeFormat(format: Format | undefined): ConstructedFormat | null {
  return format === "cc" || format === "silver-age" ? format : null;
}

export function shouldOfferBotPractice(input: {
  format: Format | undefined;
  matchmakingActive: boolean;
  opponentPresent: boolean;
  queueCount: number;
}): boolean {
  return botPracticeFormat(input.format) !== null
    && input.matchmakingActive
    && !input.opponentPresent
    // Matchmaking depth includes this player after their entry commits.
    && input.queueCount <= 1;
}

export function BotPracticeNudge(props: {
  format: ConstructedFormat;
  busy: boolean;
  onPlay: (bot: BotOpponent) => void;
  onDismiss: () => void;
}) {
  const intl = useIntl();
  const [choosingBot, setChoosingBot] = useState(false);

  return (
    <div
      className="prep-bot-nudge-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !props.busy) props.onDismiss();
      }}
    >
      <section
        className="panel prep-bot-nudge"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prep-bot-nudge-title"
        aria-describedby="prep-bot-nudge-description"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !props.busy) props.onDismiss();
        }}
      >
        <span className="match-accept-eyebrow">
          {intl.formatMessage({ id: "prep.botNudge.searching" })}
        </span>
        <h2 className="panel-title" id="prep-bot-nudge-title">
          {intl.formatMessage({ id: "prep.botNudge.title" })}
        </h2>
        <p id="prep-bot-nudge-description">
          {intl.formatMessage({ id: "prep.botNudge.description" })}
        </p>
        <div className="prep-bot-nudge-actions">
          <button
            autoFocus
            className="btn-bot"
            disabled={props.busy}
            onClick={() => {
              setChoosingBot(true);
            }}
          >
            {intl.formatMessage({
              id: props.busy ? "prep.botNudge.starting" : "lobby.action.playBot",
            })}
          </button>
          <button disabled={props.busy} onClick={props.onDismiss}>
            {intl.formatMessage({ id: "prep.botNudge.keepWaiting" })}
          </button>
        </div>
        {choosingBot ? (
          <BotOpponentModal
            format={props.format}
            onSelect={(bot) => {
              setChoosingBot(false);
              props.onPlay(bot);
            }}
            onClose={() => setChoosingBot(false)}
          />
        ) : null}
      </section>
    </div>
  );
}
