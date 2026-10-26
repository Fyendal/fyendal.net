import { useIntl } from "react-intl";
import type { LeagueBracketPlayer, LeagueBracketView, LeaguePlayoffStage } from "@fyendal/shared";

const STAGES: readonly LeaguePlayoffStage[] = ["quarterfinal", "semifinal", "final"];

function Player({ player, advanced }: { player: LeagueBracketPlayer; advanced: boolean }) {
  const intl = useIntl();
  return (
    <li className={`${advanced ? "advanced" : ""}${player.you ? " you" : ""}`}>
      <span className="league-seed">{player.seed}</span>
      <span>{player.username ?? intl.formatMessage({ id: "league.roster.deleted" })}</span>
    </li>
  );
}

/** One column per round; a round appears once its first match is paired. */
export function LeagueBracket({ matches }: { matches: readonly LeagueBracketView[] }) {
  const intl = useIntl();
  const final = matches.find((match) => match.stage === "final");
  const champion = final?.advancer ? final[final.advancer] : null;
  return (
    <>
      {champion ? (
        <p className="league-champion">
          {intl.formatMessage({ id: "league.bracket.champion" }, {
            name: champion.username ?? intl.formatMessage({ id: "league.roster.deleted" }),
          })}
        </p>
      ) : null}
      <div className="league-bracket">
        {STAGES.filter((stage) => matches.some((match) => match.stage === stage)).map((stage) => (
          <section key={stage} className="league-bracket-round" aria-label={intl.formatMessage({ id: `league.match.stage.${stage}` })}>
            <h5>{intl.formatMessage({ id: `league.match.stage.${stage}` })}</h5>
            {matches.filter((match) => match.stage === stage).sort((x, y) => x.slot - y.slot).map((match) => (
              <ul key={match.slot} className="league-bracket-match">
                <Player player={match.a} advanced={match.advancer === "a"} />
                <Player player={match.b} advanced={match.advancer === "b"} />
              </ul>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
