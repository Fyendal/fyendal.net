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

export function BackgroundMatchOffer() {
  const { status, acceptBackgroundMatch, declineBackgroundMatch } = useStore(useShallow((state) => ({
    status: state.backgroundMatchmaking,
    acceptBackgroundMatch: state.acceptBackgroundMatch,
    declineBackgroundMatch: state.declineBackgroundMatch,
  })));
  return status.state === "offer" ? (
    <BackgroundMatchOfferView
      offer={status}
      onAccept={acceptBackgroundMatch}
      onDecline={declineBackgroundMatch}
    />
  ) : null;
}
