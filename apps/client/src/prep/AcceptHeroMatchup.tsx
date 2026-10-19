import { useState } from "react";
import { useIntl } from "react-intl";
import type { PrepSeatView } from "@fyendal/shared";
import { heroImageUrl } from "../lobby/heroImage.js";
import { UiIcon } from "../components/UiIcon.js";
import { DeadlineCountdown } from "./DeadlineCountdown.js";

/** Body shared by both match-accept dialogs: the title, the two heroes with
 *  their acceptance, and one action row. Acceptance reads from the portraits,
 *  so the dialog carries no explanatory copy. */
export function MatchAcceptContent({
  titleId,
  you,
  opponent,
  deadlineAt,
  onAccept,
  onDecline,
}: {
  titleId: string;
  you: PrepSeatView | null;
  opponent: PrepSeatView | null;
  deadlineAt: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const intl = useIntl();
  return (
    <>
      <h2 className="panel-title" id={titleId}>
        {intl.formatMessage({ id: "prep.accept.matchFound" })}
      </h2>
      <AcceptHeroMatchup you={you} opponent={opponent} showAcceptance />
      <div className="match-accept-actions">
        <button className="match-accept-decline" onClick={onDecline}>
          {intl.formatMessage({ id: "lobby.action.decline" })}
        </button>
        {you?.accepted ? (
          <div className="match-accepted-state">
            <span className="match-accept-label">{intl.formatMessage({ id: "prep.accept.waiting" })}</span>
            <span className="match-accept-countdown"><DeadlineCountdown deadlineAt={deadlineAt} /></span>
          </div>
        ) : (
          <button className="btn-primary match-accept-primary" onClick={onAccept}>
            <span className="match-accept-label">{intl.formatMessage({ id: "lobby.action.accept" })}</span>
            <span className="match-accept-countdown"><DeadlineCountdown deadlineAt={deadlineAt} /></span>
          </button>
        )}
      </div>
    </>
  );
}

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
 *  it, so it announces no status. Seat labels and statuses are announced only;
 *  the portraits show them visually (ring, seal, desaturation). */
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
    <div className={`accept-hero-side${status ? ` is-${status}` : ""}`}>
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
      <HeroName name={seat?.heroName ?? intl.formatMessage({ id: "prep.unknownHero" })} />
      <span className="accept-hero-announce">{label}</span>
      {statusMessageId ? (
        <span className="accept-hero-announce">{intl.formatMessage({ id: statusMessageId })}</span>
      ) : null}
    </div>
  );
}

/** Hero names read "Name, Epithet": the name leads and the epithet sits
 *  beneath it, so the full printed name fits a narrow column without
 *  truncation. Names without an epithet render as one line. */
function HeroName({ name }: { name: string }) {
  const comma = name.indexOf(", ");
  if (comma < 0) return <strong className="accept-hero-name">{name}</strong>;
  return (
    <strong className="accept-hero-name">
      {name.slice(0, comma)}
      <span className="accept-hero-epithet">{name.slice(comma + 2)}</span>
    </strong>
  );
}
