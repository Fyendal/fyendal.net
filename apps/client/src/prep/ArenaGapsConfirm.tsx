import { useIntl } from "react-intl";
import type { ArenaGap } from "./selection.js";

export function ArenaGapsConfirm(props: {
  gaps: readonly ArenaGap[];
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const zones = intl.formatList(props.gaps.map((gap) => intl.formatMessage({ id: `prep.slot.${gap}` })));

  return (
    <div
      className="prep-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onCancel();
      }}
    >
      <section
        className="panel prep-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="prep-arena-gaps-title"
        aria-describedby="prep-arena-gaps-description"
        onKeyDown={(event) => {
          if (event.key === "Escape") props.onCancel();
        }}
      >
        <h2 className="panel-title" id="prep-arena-gaps-title">
          {intl.formatMessage({ id: "prep.arena.gaps.title" })}
        </h2>
        <p id="prep-arena-gaps-description">
          {intl.formatMessage({ id: "prep.arena.gaps.description" }, { zones })}
        </p>
        <div className="prep-dialog-actions">
          <button autoFocus onClick={props.onCancel}>
            {intl.formatMessage({ id: "prep.arena.gaps.back" })}
          </button>
          <button className="btn-primary" onClick={props.onConfirm}>
            {intl.formatMessage({ id: "prep.arena.gaps.confirm" })}
          </button>
        </div>
      </section>
    </div>
  );
}
