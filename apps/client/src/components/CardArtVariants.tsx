import { useRef, type KeyboardEvent } from "react";
import { useIntl } from "react-intl";
import { cardData } from "@fyendal/cards/client";
import type { CardArtVariant } from "@fyendal/cards/art";
import { STANDARD_CARD_ART, type DeckArt } from "@fyendal/shared";
import { CardArtwork, cardImageUrl } from "../game/Card.js";
import type { CardArtCatalog } from "../game/cardArtCatalog.js";

interface ArtOption {
  /** Undefined is the card's standard art. */
  image: string | undefined;
  variant?: CardArtVariant;
}

function imageIdOf(url: string): string {
  return /\/cards\/([^/]+)\.webp$/.exec(url)?.[1] ?? url;
}

/** The deck's image for a card, with its standard image reported as undefined. */
export function shownCardArt(catalog: CardArtCatalog, cardId: string, art: DeckArt): string | undefined {
  const image = catalog.deckCardArt(cardId, art);
  return image === imageIdOf(cardImageUrl(cardId)) ? undefined : image;
}

/** Standard art first, then the rarest alternatives. */
export function cardArtOptions(catalog: CardArtCatalog, cardId: string): ArtOption[] {
  const standard = imageIdOf(cardImageUrl(cardId));
  const variants = [...catalog.cardArtVariants(cardId)]
    .filter((variant) => variant.image !== standard)
    .sort((a, b) => catalog.compareCardArt(b, a));
  return [{ image: undefined }, ...variants.map((variant) => ({ image: variant.image, variant }))];
}

export function hasCardArtChoices(catalog: CardArtCatalog, cardId: string): boolean {
  return cardArtOptions(catalog, cardId).length > 1;
}

/** Returns the deck art after choosing `image` for one card. */
export function chooseCardArt(catalog: CardArtCatalog, art: DeckArt, cardId: string, image: string | undefined): DeckArt {
  const auto = shownCardArt(catalog, cardId, { highestRarity: art.highestRarity, picks: {} });
  const { [cardId]: _previous, ...picks } = art.picks;
  return image === auto ? { ...art, picks } : { ...art, picks: { ...picks, [cardId]: image ?? STANDARD_CARD_ART } };
}

export function CardArtVariants({
  catalog,
  cardId,
  art,
  compact = false,
  onChange,
}: {
  catalog: CardArtCatalog;
  cardId: string;
  art: DeckArt;
  compact?: boolean;
  onChange: (art: DeckArt) => void;
}) {
  const intl = useIntl();
  const groupRef = useRef<HTMLDivElement>(null);
  const name = cardData[cardId]?.name ?? cardId;
  const options = cardArtOptions(catalog, cardId);
  const current = shownCardArt(catalog, cardId, art);
  const auto = shownCardArt(catalog, cardId, { highestRarity: art.highestRarity, picks: {} });
  const picked = art.picks[cardId] !== undefined;

  const label = (option: ArtOption) => {
    const variant = option.variant;
    if (!variant) return intl.formatMessage({ id: "lobby.deck.art.standard" });
    const finish = variant.foil
      ? intl.formatMessage({ id: `lobby.deck.art.foil.${variant.foil.toLowerCase()}` })
      : variant.variation
        ? intl.formatMessage({ id: `lobby.deck.art.variation.${variant.variation.toLowerCase()}` })
        : null;
    const rarity = intl.formatMessage({ id: `lobby.deck.art.rarity.${variant.rarity.toLowerCase()}` });
    return finish ? intl.formatMessage({ id: "lobby.deck.art.rarityAndFinish" }, { rarity, finish }) : rarity;
  };
  const setCode = (option: ArtOption) => {
    const set = option.variant?.set ?? cardId.slice(0, 3);
    const language = option.variant?.language;
    return language
      ? intl.formatMessage(
        { id: "lobby.deck.art.setAndLanguage" },
        { set, language: intl.formatDisplayName(language, { type: "language" }) ?? language },
      )
      : set;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const radios = [...(groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]") ?? [])];
    const index = radios.indexOf(event.currentTarget);
    radios[(index + step + radios.length) % radios.length]?.focus();
  };

  return (
    <div className={`card-art-strip${compact ? " compact" : ""}`}>
      <div className="card-art-strip-head">
        <h4>{name}</h4>
        <span className="card-art-strip-count">
          {intl.formatMessage({ id: "lobby.deck.art.printings" }, { count: options.length })}
        </span>
        {picked ? (
          <button type="button" className="card-art-reset" onClick={() => onChange(chooseCardArt(catalog, art, cardId, auto))}>
            {intl.formatMessage({ id: "lobby.deck.art.useAuto" })}
          </button>
        ) : null}
      </div>
      <div
        ref={groupRef}
        className="card-art-variants"
        role="radiogroup"
        aria-label={intl.formatMessage({ id: "lobby.deck.art.optionsFor" }, { card: name })}
      >
        {options.map((option) => {
          const checked = option.image === current;
          return (
            <button
              key={option.image ?? "standard"}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              className="card-art-variant"
              onKeyDown={onKeyDown}
              onClick={() => { if (!checked) onChange(chooseCardArt(catalog, art, cardId, option.image)); }}
            >
              <span className="card-art-variant-frame">
                <CardArtwork cardId={cardId} artImage={option.image} alt="" />
                {checked ? <span className="card-art-variant-check" aria-hidden="true">✓</span> : null}
              </span>
              <span className="card-art-variant-label">
                {label(option)}
                {option.image === auto ? (
                  <span className="card-art-tag">{intl.formatMessage({ id: "lobby.deck.art.auto" })}</span>
                ) : null}
              </span>
              <span className="card-art-variant-set">{setCode(option)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
