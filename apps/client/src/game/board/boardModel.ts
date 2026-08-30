import type { GameIntent, GameView, PlayableZone, PlayerView } from "@fyendal/shared";

export interface BoardLegalState {
  playableHand: ReadonlySet<number>;
  playableArsenal: ReadonlySet<number>;
  playableZones: ReadonlyMap<number, PlayableZone>;
  activatable: ReadonlySet<number>;
  stageableDefenders: ReadonlySet<number>;
  canPass: boolean;
  canCloseChain: boolean;
}

export function abilityLabelForSource(
  player: PlayerView,
  chain: GameView["chain"],
  sourceInstanceId: number,
  abilityIndex: number,
): string {
  if (sourceInstanceId === player.heroInstanceId) {
    return player.heroAbilityLabels?.[abilityIndex] ?? `Ability ${abilityIndex + 1}`;
  }
  const source = [
    ...player.weapons,
    ...Object.values(player.equipment),
    ...player.board,
    ...player.hand,
    ...chain.map((link) => link.attackingCard),
  ].find((card) => card?.instanceId === sourceInstanceId);
  return source?.activatedAbilityLabels?.[abilityIndex] ?? `Ability ${abilityIndex + 1}`;
}

/** Project authoritative intents into the lookup sets used by the board. */
export function deriveBoardLegalState(
  actionCandidates: readonly GameIntent[],
  legal: readonly GameIntent[],
): BoardLegalState {
  const playableHand = new Set<number>();
  const playableArsenal = new Set<number>();
  const playableZones = new Map<number, PlayableZone>();
  const activatable = new Set<number>();
  const stageableDefenders = new Set<number>();
  let canPass = false;
  let canCloseChain = false;

  for (const intent of actionCandidates) {
    if (intent.kind === "play-card") playableHand.add(intent.instanceId);
    if (intent.kind === "play-from-arsenal") playableArsenal.add(intent.instanceId);
    if (intent.kind === "play-from-zone") playableZones.set(intent.instanceId, intent.zone);
    if (intent.kind === "activate-ability") activatable.add(intent.sourceInstanceId);
  }
  for (const intent of legal) {
    if (intent.kind === "stage-defenders") {
      intent.instanceIds.forEach((instanceId) => stageableDefenders.add(instanceId));
    }
    if (intent.kind === "pass") canPass = true;
    if (intent.kind === "close-chain") canCloseChain = true;
  }

  return {
    playableHand,
    playableArsenal,
    playableZones,
    activatable,
    stageableDefenders,
    canPass,
    canCloseChain,
  };
}
