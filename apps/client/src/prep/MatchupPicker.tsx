import { useIntl } from "react-intl";
import { ListboxDropdown, type ListboxSection } from "../components/ListboxDropdown.js";

interface MatchupChoice {
  /** Empty for the deck's default configuration. */
  id: string;
  name: string;
}

/**
 * Fabrary matchup plans can run to dozens of heroes, so plans aimed at the
 * current opponent are lifted into a highlighted group above the rest.
 */
export function MatchupPicker({
  id,
  matchups,
  selectedId,
  suggestedIds,
  opponentHero,
  disabled,
  onChoose,
}: {
  id: string;
  matchups: readonly MatchupChoice[];
  selectedId: string | undefined;
  suggestedIds: ReadonlySet<string>;
  opponentHero: string | undefined;
  disabled: boolean;
  onChoose: (matchupId: string) => void;
}) {
  const intl = useIntl();
  const defaultChoice: MatchupChoice = { id: "", name: intl.formatMessage({ id: "prep.defaultDeck" }) };
  const suggested = matchups.filter((matchup) => suggestedIds.has(matchup.id));
  const others = matchups.filter((matchup) => !suggestedIds.has(matchup.id));
  const selected = matchups.find((matchup) => matchup.id === selectedId) ?? defaultChoice;
  const sections: ListboxSection<MatchupChoice>[] = suggested.length > 0
    ? [
      {
        key: "suggested",
        tone: "suggested",
        label: opponentHero
          ? intl.formatMessage({ id: "prep.suggestedAgainst" }, { hero: opponentHero })
          : intl.formatMessage({ id: "prep.suggestedTag" }),
        items: suggested,
      },
      { key: "all", label: intl.formatMessage({ id: "prep.otherMatchups" }), items: [defaultChoice, ...others] },
    ]
    : [{ key: "all", items: [defaultChoice, ...others] }];

  const tag = suggestedIds.has(selected.id)
    ? <span className="matchup-tag">{intl.formatMessage({ id: "prep.suggestedTag" })}</span>
    : suggested.length > 0
      ? (
        <span className="matchup-tag matchup-tag-hint">
          {intl.formatMessage(
            { id: "prep.suggestionHint" },
            { count: suggested.length, name: suggested[0]!.name },
          )}
        </span>
      )
      : null;

  return (
    <ListboxDropdown
      id={id}
      ariaLabel={intl.formatMessage({ id: "prep.matchupPlan" })}
      sections={sections}
      disabled={disabled}
      trigger={(
        <span className="matchup-choice">
          <span className="matchup-choice-name" title={selected.name}>{selected.name}</span>
          {tag}
        </span>
      )}
      getKey={(matchup) => matchup.id || "default"}
      isSelected={(matchup) => matchup.id === selected.id}
      renderOption={(matchup) => <span className="matchup-choice-name">{matchup.name}</span>}
      onSelect={(matchup) => {
        if (matchup.id !== selected.id) onChoose(matchup.id);
      }}
    />
  );
}
