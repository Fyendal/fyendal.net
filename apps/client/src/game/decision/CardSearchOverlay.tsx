import type { CardView, GameMessage, PendingDecision } from "@fyendal/shared";
import { cardData } from "@fyendal/cards/client";
import { useMemo, useState } from "react";
import { useIntl } from "react-intl";
import { CardFace } from "../Card.js";
import { formatGameMessage } from "../../i18n/GameMessage.js";

export interface CardSearchZoneCounts {
  hand: number;
  deck: number;
  arsenal: number;
}

interface CardSearchSection {
  zone: "hand" | "deck" | "arsenal" | "cards";
  count: number;
  cards: CardView[];
}

type CardSearchDecision = PendingDecision & {
  kind: "choose-target";
  optionCards: Array<CardView | null>;
  lookedCards: CardView[];
  minimumSelections: number;
  maximumSelections: number;
};

export interface CardSearchOverlayModel {
  prompt: string;
  promptMessage?: GameMessage;
  sections: CardSearchSection[];
  optionByCardId: ReadonlyMap<number, string>;
  minimumSelections: number;
  maximumSelections: number;
}

function cardName(card: CardView): string {
  return cardData[card.cardId]?.name ?? card.name ?? card.cardId;
}

function sortedCards(cards: readonly CardView[]): CardView[] {
  return [...cards].sort((left, right) => cardName(left).localeCompare(cardName(right)));
}

/** A private search includes contextual looked-at cards plus a smaller set of
 * selectable card options. It needs a full zone-style dialog rather than the
 * compact decision float. */
export function isCardSearchOverlayDecision(
  decision: PendingDecision | null,
): decision is CardSearchDecision {
  return decision?.kind === "choose-target"
    && decision.minimumSelections !== undefined
    && decision.maximumSelections !== undefined
    && (decision.lookedCards?.length ?? 0) > 0
    && (decision.optionCards?.some(Boolean) ?? false);
}

export function cardSearchOverlayModel(
  decision: PendingDecision | null,
  zoneCounts: CardSearchZoneCounts,
): CardSearchOverlayModel | null {
  if (!isCardSearchOverlayDecision(decision)) return null;

  const optionByCardId = new Map<number, string>();
  decision.options?.forEach((option, index) => {
    const card = decision.optionCards?.[index];
    if (card) optionByCardId.set(card.instanceId, option);
  });

  const cards = decision.lookedCards;
  const expectedCount = zoneCounts.hand + zoneCounts.deck + zoneCounts.arsenal;
  const sections = expectedCount === cards.length
    ? [
        { zone: "hand" as const, count: zoneCounts.hand, cards: sortedCards(cards.slice(0, zoneCounts.hand)) },
        {
          zone: "deck" as const,
          count: zoneCounts.deck,
          cards: sortedCards(cards.slice(zoneCounts.hand, zoneCounts.hand + zoneCounts.deck)),
        },
        {
          zone: "arsenal" as const,
          count: zoneCounts.arsenal,
          cards: sortedCards(cards.slice(zoneCounts.hand + zoneCounts.deck)),
        },
      ].filter((section) => section.cards.length > 0)
    : [{ zone: "cards" as const, count: cards.length, cards: sortedCards(cards) }];

  return {
    prompt: decision.prompt,
    ...(decision.promptMessage ? { promptMessage: decision.promptMessage } : {}),
    sections,
    optionByCardId,
    minimumSelections: decision.minimumSelections,
    maximumSelections: decision.maximumSelections,
  };
}

export function toggleCardSearchSelection(
  selected: readonly string[],
  optionId: string,
  maximumSelections: number,
): readonly string[] {
  if (selected.includes(optionId)) {
    return selected.filter((candidate) => candidate !== optionId);
  }
  if (selected.length >= maximumSelections) return selected;
  return [...selected, optionId];
}

export function CardSearchOverlay({
  decision,
  zoneCounts,
  onSubmit,
}: {
  decision: PendingDecision | null;
  zoneCounts: CardSearchZoneCounts;
  onSubmit: (optionIds: readonly string[]) => void;
}) {
  const intl = useIntl();
  const [minimized, setMinimized] = useState(false);
  const [selectedOptionIds, setSelectedOptionIds] = useState<readonly string[]>([]);
  const model = useMemo(
    () => cardSearchOverlayModel(decision, zoneCounts),
    [decision, zoneCounts.hand, zoneCounts.deck, zoneCounts.arsenal],
  );
  if (!model) return null;
  const canSubmit = selectedOptionIds.length >= model.minimumSelections
    && selectedOptionIds.length <= model.maximumSelections;
  const localizedPrompt = model.promptMessage
    ? formatGameMessage(intl, model.promptMessage, {
        card: (cardId) => cardData[cardId]?.name ?? cardId,
      })
    : model.prompt;
  if (minimized) {
    return (
      <MinimizedCardSearch
        prompt={intl.formatMessage(
          { id: "game.search.minimizedPrompt" },
          {
            prompt: localizedPrompt,
            selected: selectedOptionIds.length,
            maximum: model.maximumSelections,
          },
        )}
        onRestore={() => setMinimized(false)}
      />
    );
  }

  return (
    <div className="overlay zone-overlay card-search-overlay">
      <div
        className="overlay-panel zone-overlay-panel card-search-overlay-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="card-search-overlay-title"
        aria-describedby="card-search-overlay-prompt"
      >
        <div className="zone-overlay-header card-search-overlay-header">
          <div>
            <div className="overlay-title" id="card-search-overlay-title">
              {intl.formatMessage({ id: "game.search.title" })}
            </div>
            <div className="decision-context" id="card-search-overlay-prompt">
              {intl.formatMessage({ id: "game.search.instructions" }, { prompt: localizedPrompt })}
            </div>
          </div>
          <div className="decision-buttons">
            <button
              className="card-search-minimize"
              type="button"
              aria-label={intl.formatMessage({ id: "game.search.minimize" })}
              title={intl.formatMessage({ id: "game.search.minimizeShort" })}
              onClick={() => setMinimized(true)}
            >
              −
            </button>
            <button
              className="btn-primary"
              type="button"
              disabled={!canSubmit}
              onClick={() => onSubmit(selectedOptionIds)}
            >
              {selectedOptionIds.length === 0
                ? intl.formatMessage({ id: "common.done" })
                : intl.formatMessage(
                    { id: "game.search.submit" },
                    { count: selectedOptionIds.length },
                  )}
            </button>
          </div>
        </div>
        <div className="card-search-sections">
          {model.sections.map((section) => (
            <section className="card-search-section" key={section.zone}>
              <h3>{intl.formatMessage(
                { id: `game.search.zone.${section.zone}` },
                { count: section.count },
              )}</h3>
              <div className="overlay-cards">
                {section.cards.map((card) => {
                  const option = model.optionByCardId.get(card.instanceId);
                  const selected = option !== undefined && selectedOptionIds.includes(option);
                  const canSelect = selected || selectedOptionIds.length < model.maximumSelections;
                  return (
                    <CardFace
                      key={card.instanceId}
                      card={card}
                      size="zone"
                      highlighted={option !== undefined}
                      selected={selected}
                      onClick={option === undefined || !canSelect
                        ? undefined
                        : () => setSelectedOptionIds((current) =>
                            toggleCardSearchSelection(current, option, model.maximumSelections)
                          )}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MinimizedCardSearch({
  prompt,
  onRestore,
}: {
  prompt: string;
  onRestore: () => void;
}) {
  const intl = useIntl();
  return (
    <div className="card-search-minimized" role="status">
      <span>
        <strong>{intl.formatMessage({ id: "game.search.short" })}</strong>
        <span className="decision-context">{prompt}</span>
      </span>
      <button className="btn-primary" type="button" onClick={onRestore}>
        {intl.formatMessage({ id: "game.search.restore" })}
      </button>
    </div>
  );
}
