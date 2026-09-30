import { useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { FUTURE_SET_CODES, cardData, formatLegalityIssues, precon } from "@fyendal/cards/client";
import type { BotOpponent } from "@fyendal/shared";
import type { ConstructedFormat } from "../domain.js";
import { heroImageUrl } from "./heroImage.js";
import { LobbyTooltip } from "./LobbyTooltip.js";

interface BotOption {
  id: BotOpponent;
  name: string;
  title: string;
  heroName: string;
  deckId: string;
  deckType: DeckType;
  descriptionId: string;
}

type DeckType = "beginner" | "midrange" | "aggro" | "elemental" | "guardian" | "boss";

const BOTS: Readonly<Record<ConstructedFormat, readonly BotOption[]>> = {
  cc: [
    {
      id: "ira",
      name: "Ira",
      title: "Scarlet Revenger",
      heroName: "Ira, Scarlet Revenger",
      deckId: "precon-asr",
      deckType: "beginner",
      descriptionId: "lobby.bot.ira.description",
    },
    {
      id: "hala",
      name: "Hala",
      title: "Bladesaint of the Vow",
      heroName: "Hala, Bladesaint of the Vow",
      deckId: "precon-hala-masterclass",
      deckType: "midrange",
      descriptionId: "lobby.bot.hala.description",
    },
    {
      id: "cindra",
      name: "Cindra",
      title: "Dracai of Retribution",
      heroName: "Cindra, Dracai of Retribution",
      deckId: "bot-cindra-head-jabs",
      deckType: "aggro",
      descriptionId: "lobby.bot.cindra.description",
    },
    {
      id: "jarl",
      name: "Jarl",
      title: "Vetreiði",
      heroName: "Jarl Vetreiði",
      deckId: "bot-jarl",
      deckType: "guardian",
      descriptionId: "lobby.bot.jarl.description",
    },
    {
      id: "starvo",
      name: "Starvo",
      title: "Star of the Show",
      heroName: "Bravo, Star of the Show",
      deckId: "bot-starvo-boss",
      deckType: "boss",
      descriptionId: "lobby.bot.starvo.description",
    },
  ],
  "silver-age": [
    {
      id: "kayo",
      name: "Kayo",
      title: "SAGE Kayo",
      heroName: "Kayo",
      deckId: "bot-kayo-sage",
      deckType: "aggro",
      descriptionId: "lobby.bot.kayo.description",
    },
    {
      id: "briar",
      name: "Briar",
      title: "Elemental Runeblade",
      heroName: "Briar",
      deckId: "bot-briar-broccoli",
      deckType: "elemental",
      descriptionId: "lobby.bot.briar.description",
    },
    {
      id: "bravo",
      name: "Bravo",
      title: "Flattering Showman",
      heroName: "Bravo, Flattering Showman",
      deckId: "bot-bravo-flarvo",
      deckType: "guardian",
      descriptionId: "lobby.bot.bravo.description",
    },
  ],
};

function botCardWarnings(bot: BotOption): { banned: string[]; future: string[] } {
  const deck = precon(bot.deckId);
  if (!deck) return { banned: [], future: [] };
  const issues = formatLegalityIssues(cardData, deck.pool, deck.format);
  const pool = deck.pool;
  const cardIds = [
    pool.heroId,
    ...pool.weaponIds,
    ...pool.equipmentPool,
    ...(pool.inventoryPool ?? []),
    ...pool.deck,
    ...(pool.sideboard ?? []),
  ];
  return {
    banned: [...new Set(issues.filter((issue) => issue.kind !== "future-card").map((issue) => issue.cardName))],
    future: [...new Set(cardIds.flatMap((id) => {
      const card = cardData[id];
      return card?.set && FUTURE_SET_CODES.has(card.set) ? [card.name] : [];
    }))],
  };
}

const BOT_CARD_WARNINGS = new Map(
  Object.values(BOTS).flat().map((bot) => [bot.id, botCardWarnings(bot)]),
);

export function BotOpponentModal(props: {
  format: ConstructedFormat;
  initialSearchForPlayer?: boolean;
  onSelect: (bot: BotOpponent, searchForPlayer: boolean) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const [searchForPlayer, setSearchForPlayer] = useState(props.initialSearchForPlayer ?? true);
  const tooltipId = useId();
  const warningRefs = useRef<Partial<Record<BotOpponent, HTMLSpanElement | null>>>({});
  const [hoveredBot, setHoveredBot] = useState<BotOpponent | null>(null);
  const [focusedBot, setFocusedBot] = useState<BotOpponent | null>(null);
  const activeBot = hoveredBot ?? focusedBot;

  const warningText = (warnings: { banned: string[]; future: string[] }) => [
    ...(warnings.banned.length > 0
      ? [intl.formatMessage({ id: "lobby.deck.bannedList" }, { cards: warnings.banned.join(", ") })]
      : []),
    ...(warnings.future.length > 0
      ? [intl.formatMessage({ id: "lobby.deck.futureList" }, { cards: warnings.future.join(", ") })]
      : []),
  ].join("\n\n");

  const activeWarnings = activeBot ? BOT_CARD_WARNINGS.get(activeBot) : undefined;
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
        <label className="bot-matchmaking-option">
          <input
            type="checkbox"
            checked={searchForPlayer}
            onChange={(event) => {
              setSearchForPlayer(event.target.checked);
            }}
          />
          <span>
            <strong>{intl.formatMessage({ id: "lobby.bot.searchForPlayer" })}</strong>
            <small>{intl.formatMessage({ id: "lobby.bot.searchForPlayer.description" })}</small>
          </span>
        </label>
        <div className="bot-opponent-options">
          {BOTS[props.format].map((bot, index) => {
            const warnings = BOT_CARD_WARNINGS.get(bot.id)!;
            return (
              <button
                type="button"
                key={bot.id}
                autoFocus={index === 0}
                aria-describedby={warnings.banned.length > 0 || warnings.future.length > 0
                  ? `${tooltipId}-${bot.id}`
                  : undefined}
                onFocus={() => {
                  if (warnings.banned.length > 0 || warnings.future.length > 0) {
                    setFocusedBot(bot.id);
                  }
                }}
                onBlur={() => setFocusedBot((current) => current === bot.id ? null : current)}
                onClick={() => props.onSelect(bot.id, searchForPlayer)}
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
                  {warnings.banned.length > 0 || warnings.future.length > 0 ? (
                    <span
                      className="bot-card-warnings"
                      ref={(element) => { warningRefs.current[bot.id] = element; }}
                      onPointerEnter={() => setHoveredBot(bot.id)}
                      onPointerLeave={() => setHoveredBot((current) => current === bot.id ? null : current)}
                    >
                      {warnings.banned.length > 0 ? (
                        <span className="deck-legality-hint banned">
                          {intl.formatMessage({ id: "lobby.deck.includesBanned" }, {
                            count: warnings.banned.length,
                          })}
                        </span>
                      ) : null}
                      {warnings.future.length > 0 ? (
                        <span className="deck-legality-hint future">
                          {intl.formatMessage({ id: "lobby.deck.includesFuture" }, {
                            count: warnings.future.length,
                          })}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>
        {BOTS[props.format].map((bot) => {
          const warnings = BOT_CARD_WARNINGS.get(bot.id)!;
          return warnings.banned.length > 0 || warnings.future.length > 0 ? (
            <span
              key={bot.id}
              className="bot-card-warning-description"
              id={`${tooltipId}-${bot.id}`}
              role="tooltip"
            >
              {warningText(warnings)}
            </span>
          ) : null;
        })}
        <button className="bot-opponent-cancel" onClick={props.onClose}>
          {intl.formatMessage({ id: "common.cancel" })}
        </button>
      </section>
      {activeBot && activeWarnings
        ? <LobbyTooltip
            key={activeBot}
            anchor={warningRefs.current[activeBot] ?? null}
            content={warningText(activeWarnings)}
            className="bot-card-warning-tooltip"
          />
        : null}
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
  if (props.type === "boss") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="m12 2 2.8 5.8 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 8.7l6.2-.9L12 2Z" />
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
