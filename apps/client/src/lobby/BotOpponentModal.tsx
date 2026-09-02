import { useState } from "react";
import { useIntl } from "react-intl";
import type { BotOpponent } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { heroImageUrl } from "./heroImage.js";

interface BotOption {
  id: BotOpponent;
  name: string;
  title: string;
  heroName: string;
  deckType: DeckType;
  descriptionId: string;
}

type DeckType = "beginner" | "midrange" | "aggro" | "elemental" | "guardian";

const BOTS: Readonly<Record<ConstructedFormat, readonly BotOption[]>> = {
  cc: [
    {
      id: "ira",
      name: "Ira",
      title: "Scarlet Revenger",
      heroName: "Ira, Scarlet Revenger",
      deckType: "beginner",
      descriptionId: "lobby.bot.ira.description",
    },
    {
      id: "hala",
      name: "Hala",
      title: "Bladesaint of the Vow",
      heroName: "Hala, Bladesaint of the Vow",
      deckType: "midrange",
      descriptionId: "lobby.bot.hala.description",
    },
    {
      id: "cindra",
      name: "Cindra",
      title: "Dracai of Retribution",
      heroName: "Cindra, Dracai of Retribution",
      deckType: "aggro",
      descriptionId: "lobby.bot.cindra.description",
    },
    {
      id: "jarl",
      name: "Jarl",
      title: "Vetreiði",
      heroName: "Jarl Vetreiði",
      deckType: "guardian",
      descriptionId: "lobby.bot.jarl.description",
    },
  ],
  "silver-age": [
    {
      id: "briar",
      name: "Briar",
      title: "Elemental Runeblade",
      heroName: "Briar",
      deckType: "elemental",
      descriptionId: "lobby.bot.briar.description",
    },
    {
      id: "bravo",
      name: "Bravo",
      title: "Flattering Showman",
      heroName: "Bravo, Flattering Showman",
      deckType: "guardian",
      descriptionId: "lobby.bot.bravo.description",
    },
  ],
};

export function BotOpponentModal(props: {
  format: ConstructedFormat;
  onSelect: (bot: BotOpponent) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const bots = BOTS[props.format];
  return (
    <div
      className="modal-backdrop bot-opponent-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="deck-pick-modal bot-opponent-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-opponent-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onClose();
        }}
      >
        <h2 className="panel-title" id="bot-opponent-title">
          {intl.formatMessage({ id: "lobby.bot.chooseOpponent" })}
        </h2>
        <p className="muted">{intl.formatMessage({ id: "lobby.bot.prompt" })}</p>
        <div className="bot-opponent-options">
          {bots.map((bot, index) => (
            <button
              type="button"
              key={bot.id}
              autoFocus={index === 0}
              onClick={() => props.onSelect(bot.id)}
            >
              <BotPortrait name={bot.name} heroName={bot.heroName} />
              <span className="bot-opponent-details">
                <span className="bot-opponent-heading">
                  <strong>{bot.name}</strong>
                  <span className={`bot-deck-type bot-deck-type-${bot.deckType}`}>
                    <DeckTypeIcon type={bot.deckType} />
                    {intl.formatMessage({ id: `lobby.bot.type.${bot.deckType}` })}
                  </span>
                </span>
                <small className="bot-opponent-title">{bot.title}</small>
                <span className="bot-opponent-description">
                  {intl.formatMessage({ id: bot.descriptionId })}
                </span>
              </span>
            </button>
          ))}
        </div>
        <button className="bot-opponent-cancel" onClick={props.onClose}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
      </section>
    </div>
  );
}

function DeckTypeIcon(props: { type: DeckType }) {
  if (props.type === "beginner") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 21V4m1 1h10l-2.5 3L16 11H6" />
      </svg>
    );
  }
  if (props.type === "midrange") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v18M5 6h14M7 6l-4 7h8L7 6Zm10 0-4 7h8l-4-7ZM8 21h8" />
      </svg>
    );
  }
  if (props.type === "aggro") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 22c4 0 7-2.7 7-6.5 0-3-1.6-5.4-4.8-8.5.1 2-1 3.5-2.2 4.2.2-3.6-1.8-6.6-5-9.2.3 4.4-2 6.5-2 10.8C5 18.2 8 22 12 22Z" />
      </svg>
    );
  }
  if (props.type === "elemental") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3 5 6v5c0 4.7 2.7 8.2 7 10 4.3-1.8 7-5.3 7-10V6l-7-3Z" />
    </svg>
  );
}

function BotPortrait(props: { name: string; heroName: string }) {
  const [available, setAvailable] = useState(true);
  return available ? (
    <img
      src={heroImageUrl(props.heroName)}
      alt=""
      loading="lazy"
      onError={() => setAvailable(false)}
    />
  ) : (
    <span className="bot-opponent-fallback" aria-hidden="true">{props.name.charAt(0)}</span>
  );
}
