import type { CardView, PlayerView } from "@fyendal/shared";

export interface BoardOverlay {
  title: string;
  cards: CardView[];
  inactiveZone?: boolean;
}

export function heroCard(player: PlayerView): CardView {
  return {
    instanceId: player.heroInstanceId,
    cardId: player.heroCardId,
    owner: player.seat,
    ...(player.heroTapped ? { tapped: true } : {}),
    ...(player.heroCounters ? { counters: player.heroCounters } : {}),
    ...(player.heroDefCounters ? { defCounters: player.heroDefCounters } : {}),
    ...(player.heroSubcards ? { subcards: player.heroSubcards } : {}),
    ...(player.heroAbilityLabels ? { activatedAbilityLabels: player.heroAbilityLabels } : {}),
  };
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
      title={label}
    >
      {children ?? <span className="mat-zone-label">{label}</span>}
      {count !== undefined && count > 0 ? <span className="mat-count">{count}</span> : null}
    </div>
  );
}
