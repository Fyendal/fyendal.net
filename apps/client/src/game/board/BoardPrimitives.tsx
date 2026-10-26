import type { CardView } from "@fyendal/shared";

export interface BoardOverlay {
  title: string;
  cards: CardView[];
  inactiveZone?: boolean;
  /** Allow the owner to inspect known face-down cards in this zone. */
  showOwnedFaceDownIdentities?: boolean;
  /** Cards the viewer could play or activate from this zone when it was opened. */
  usableIds?: ReadonlySet<number>;
}

export function MatZone({
  area,
  label,
  className = "",
  count,
  onClick,
  children,
  motionZone,
}: {
  area: string;
  label: string;
  className?: string;
  count?: number;
  onClick?: () => void;
  children?: React.ReactNode;
  motionZone?: string;
}) {
  return (
    <div
      className={`mat-zone ${className} ${onClick ? "card-clickable" : ""}`}
      style={{ gridArea: area }}
      data-motion-zone={motionZone}
      onClick={onClick}
      role="group"
      aria-label={label}
    >
      {children ?? <span className="mat-zone-label">{label}</span>}
      {count !== undefined && count > 0 ? <span className="mat-count">{count}</span> : null}
    </div>
  );
}
