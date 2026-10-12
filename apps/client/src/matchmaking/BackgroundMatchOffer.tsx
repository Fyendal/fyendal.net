import { useEffect } from "react";
import { useIntl } from "react-intl";
import { useShallow } from "zustand/react/shallow";
import type { BackgroundMatchmakingStatus } from "@fyendal/shared";
import { DeadlineCountdown } from "../prep/DeadlineCountdown.js";
import { useStore } from "../store.js";
import { heroImageUrl } from "../lobby/heroImage.js";

type MatchOffer = Extract<BackgroundMatchmakingStatus, { state: "offer" }>;

export function BackgroundMatchOfferView({
  offer,
  onAccept,
  onDecline,
}: {
  offer: MatchOffer;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const intl = useIntl();
  return (
    <aside className="background-match-offer" role="alert" aria-live="assertive">
      <div className="background-match-identity">
        <img
          className="background-match-hero-image"
          src={heroImageUrl(offer.opponent.heroName)}
          alt=""
          width={52}
          height={52}
          aria-hidden="true"
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
        <div className="background-match-copy">
          <strong>{intl.formatMessage({ id: "matchmaking.background.found" })}</strong>
          <span>{offer.opponent.heroName}</span>
        </div>
      </div>
      <div className="background-match-actions">
        {offer.acceptedByYou ? (
          <strong>
            {intl.formatMessage({ id: "matchmaking.background.waiting" })} ·{" "}
            <DeadlineCountdown deadlineAt={offer.deadlineAt} />
          </strong>
        ) : (
          <button type="button" className="btn-primary" onClick={onAccept}>
            {intl.formatMessage({ id: "lobby.action.accept" })} ·{" "}
            <DeadlineCountdown deadlineAt={offer.deadlineAt} />
          </button>
        )}
        <button type="button" onClick={onDecline}>
          {intl.formatMessage({ id: "matchmaking.background.keepBot" })}
        </button>
      </div>
    </aside>
  );
}

/** How long a declined offer keeps its skip-hero choice on screen. */
const DECLINED_HERO_CHOICE_MS = 6_000;

export function BackgroundMatchDeclinedView({
  heroName,
  onSkipHero,
}: {
  heroName: string;
  onSkipHero: () => void;
}) {
  const intl = useIntl();
  return (
    <aside className="background-match-offer background-match-declined" role="status">
      <span className="background-match-declined-copy">
        {intl.formatMessage({ id: "matchmaking.background.declined" }, { hero: heroName })}
      </span>
      <button type="button" className="background-match-skip-hero" onClick={onSkipHero}>
        {intl.formatMessage({ id: "matchmaking.background.skipHero" })}
      </button>
    </aside>
  );
}

export function BackgroundMatchOffer() {
  const {
    status,
    declinedHero,
    acceptBackgroundMatch,
    declineBackgroundMatch,
    avoidDeclinedBackgroundHero,
    dismissDeclinedBackgroundHero,
  } = useStore(useShallow((state) => ({
    status: state.backgroundMatchmaking,
    declinedHero: state.declinedBackgroundHero,
    acceptBackgroundMatch: state.acceptBackgroundMatch,
    declineBackgroundMatch: state.declineBackgroundMatch,
    avoidDeclinedBackgroundHero: state.avoidDeclinedBackgroundHero,
    dismissDeclinedBackgroundHero: state.dismissDeclinedBackgroundHero,
  })));
  useEffect(() => {
    if (!declinedHero) return;
    const timer = setTimeout(dismissDeclinedBackgroundHero, DECLINED_HERO_CHOICE_MS);
    return () => clearTimeout(timer);
  }, [declinedHero, dismissDeclinedBackgroundHero]);
  if (status.state === "offer") {
    return (
      <BackgroundMatchOfferView
        offer={status}
        onAccept={acceptBackgroundMatch}
        onDecline={declineBackgroundMatch}
      />
    );
  }
  return declinedHero && status.state === "searching" ? (
    <BackgroundMatchDeclinedView heroName={declinedHero.heroName} onSkipHero={avoidDeclinedBackgroundHero} />
  ) : null;
}
