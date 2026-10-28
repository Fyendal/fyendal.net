/** Arena surfaces: the default leather, or printed-cloth mats from Legend
 * Story Studios' public HD assets, served from `public/playmats/`. */
export const PLAYMAT_IDS = [
  "leather",
  "monarch",
  "welcome-to-rathe",
  "tales-of-aria",
  "volthaven",
  "isenloft",
  "candlehold",
  "crucible-of-war",
  "map-of-rathe",
  "demonastery",
  "pits",
  "volcor",
  "savage-lands",
  "misteria",
  "solana",
] as const;

export type PlaymatId = (typeof PLAYMAT_IDS)[number];

export const DEFAULT_PLAYMAT: PlaymatId = "leather";

/** Where a portrait phone crop should center each landscape painting. */
const PLAYMAT_FOCUS: Readonly<Record<Exclude<PlaymatId, "leather">, string>> = {
  "monarch": "52% 45%",
  "welcome-to-rathe": "50% 40%",
  "tales-of-aria": "56% 50%",
  "volthaven": "50% 50%",
  "isenloft": "56% 50%",
  "candlehold": "45% 50%",
  "crucible-of-war": "50% 55%",
  "map-of-rathe": "50% 50%",
  "demonastery": "62% 50%",
  "pits": "36% 50%",
  "volcor": "36% 45%",
  "savage-lands": "50% 50%",
  "misteria": "50% 50%",
  "solana": "50% 45%",
};

export function isPlaymatId(value: unknown): value is PlaymatId {
  return typeof value === "string" && (PLAYMAT_IDS as readonly string[]).includes(value);
}

/** A stored or wire id, or leather when it names no mat this build knows. */
export function resolvePlaymat(value: string | null | undefined): PlaymatId {
  return isPlaymatId(value) ? value : DEFAULT_PLAYMAT;
}

export function playmatNameMessageId(id: PlaymatId): string {
  return `settings.playmat.name.${id}`;
}

export function playmatArt(id: PlaymatId): { url: string; focus: string } | null {
  if (id === "leather") return null;
  return { url: `/playmats/${id}.jpg`, focus: PLAYMAT_FOCUS[id] };
}

export function playmatThumbnailUrl(id: PlaymatId): string | null {
  return id === "leather" ? null : `/playmats/thumbs/${id}.jpg`;
}
