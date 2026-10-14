import { useState } from "react";
import { useIntl } from "react-intl";
import type { PrepSeatView } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";
import { UiIcon } from "../components/UiIcon.js";

/** Both heroes of a pairing. With `showAcceptance`, each portrait carries its
 *  player's acceptance, so a player can see that the opponent already accepted. */
export function AcceptHeroMatchup({
  you,
  opponent,
  showAcceptance = false,
}: {
  you: PrepSeatView | null;
  opponent: PrepSeatView | null;
  showAcceptance?: boolean;
}) {
  const intl = useIntl();
  const yourHero = you?.heroName ?? intl.formatMessage({ id: "prep.yourHero" });
  const opponentHero = opponent?.heroName ?? intl.formatMessage({ id: "prep.opponent" });
  return (
    <div
      className="accept-hero-matchup"
      aria-label={intl.formatMessage(
        { id: "prep.matchupAria" },
        { yourHero, opponentHero },
      )}
    >
      <AcceptHero
        key={you?.heroName ?? "you"}
        seat={you}
        label={intl.formatMessage({ id: "prep.you" })}
        status={showAcceptance ? (you?.accepted ? "accepted" : "pending") : null}
      />
      <span className="accept-hero-vs" aria-hidden="true">VS</span>
      <AcceptHero
        key={opponent?.heroName ?? "opponent"}
        seat={opponent}
        label={intl.formatMessage({ id: "prep.opponent" })}
        status={showAcceptance ? (opponent?.accepted ? "accepted" : "deciding") : null}
      />
    </div>
  );
}

/** `pending` is the viewer's own unanswered seat: the Accept button speaks for
 *  it, so its status line stays empty but keeps both portraits aligned. */
type AcceptanceStatus = "accepted" | "deciding" | "pending";

const STATUS_MESSAGE_IDS: Record<AcceptanceStatus, string | null> = {
  accepted: "prep.accept.accepted",
  deciding: "prep.accept.deciding",
  pending: null,
};

function AcceptHero({
  seat,
  label,
  status,
}: {
  seat: PrepSeatView | null;
  label: string;
  status: AcceptanceStatus | null;
}) {
  const intl = useIntl();
  const [imageAvailable, setImageAvailable] = useState(true);
  const accepted = status === "accepted";
  const statusMessageId = status ? STATUS_MESSAGE_IDS[status] : null;

  return (
    <div className={`accept-hero-side${accepted ? " is-accepted" : ""}`}>
      <span className={`accept-hero-portrait${accepted ? " accept-ignite" : ""}`}>
        {seat && imageAvailable ? (
          <img
            src={heroImageUrl(seat.heroName)}
            alt={seat.heroName}
            onError={() => setImageAvailable(false)}
          />
        ) : (
          <span className="accept-hero-fallback">{seat?.heroName.charAt(0) ?? "?"}</span>
        )}
        {accepted ? <span className="accept-seal"><UiIcon name="check" /></span> : null}
      </span>
      <span className="accept-hero-label">{label}</span>
      <strong>{seat?.heroName ?? intl.formatMessage({ id: "prep.unknownHero" })}</strong>
      {status ? (
        <span className={`accept-hero-status is-${status}`}>
          {statusMessageId ? intl.formatMessage({ id: statusMessageId }) : null}
        </span>
      ) : null}
    </div>
  );
}
