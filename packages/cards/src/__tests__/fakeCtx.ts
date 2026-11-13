import type { ScriptCtx } from "@fyendal/engine";

/** A card for `fakeCtx`: `types` are subtypes/classes, `cardTypes` card types, `names` effective names. */
export interface FakeCard {
  instanceId: number;
  cardId?: string;
  owner?: number;
  types?: string[];
  cardTypes?: string[];
  names?: string[];
  keywords?: string[];
  counters?: Record<string, number>;
  scriptState?: Record<string, number>;
  faceDown?: boolean;
  flipped?: boolean;
  crank?: boolean;
}

export interface FakePlayer {
  seat: number;
  hero: FakeCard;
  heroCardId: string;
  hand: FakeCard[];
  board: FakeCard[];
  weapons: FakeCard[];
  arsenal: FakeCard[];
  graveyard: FakeCard[];
  pitch: FakeCard[];
  deck: FakeCard[];
  banish: FakeCard[];
  equipment: Partial<Record<"head" | "chest" | "arms" | "legs", FakeCard>>;
}

export interface Call {
  method: string;
  args: unknown[];
}

export function fakePlayer(seat: number, spec: Partial<FakePlayer> = {}): FakePlayer {
  return {
    seat,
    hero: { instanceId: 100 + seat, cardId: `HERO${seat}` },
    heroCardId: `HERO${seat}`,
    hand: [],
    board: [],
    weapons: [],
    arsenal: [],
    graveyard: [],
    pitch: [],
    deck: [],
    banish: [],
    equipment: {},
    ...spec,
  };
}

/** Recording ScriptCtx: state, flags and counters are real; other methods record and return `returns[method]`. */
export function fakeCtx(
  opts: {
    seat?: number;
    players?: FakePlayer[];
    cardData?: Record<string, { name: string; pitch?: number; cost?: number; backId?: string; keywords?: string[] }>;
    link?: unknown;
    chain?: unknown[];
    modifiers?: unknown[];
    heroAbilitiesDisabled?: boolean;
    returns?: Record<string, unknown>;
    self?: FakeCard;
    props?: Record<string, unknown>;
  } = {},
): { ctx: ScriptCtx; calls: Call[]; called: (method: string) => unknown[][] } {
  const seat = opts.seat ?? 0;
  const players = opts.players ?? [fakePlayer(0), fakePlayer(1)];
  const calls: Call[] = [];
  const scriptState = new Map<string, unknown>();
  const flags = new Map<string, unknown>();
  const counters = new Map<string, number>();
  const self = opts.self ?? { instanceId: 1, cardId: "SELF" };
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    const value = opts.returns?.[method];
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown)(...args) : value;
  };
  const base: Record<string, unknown> = {
    seat,
    self,
    data: { name: "Test" },
    link: opts.link,
    state: {
      players,
      chain: opts.chain ?? [],
      modifiers: opts.modifiers ?? [],
      activePlayer: seat,
      phase: "action",
      turn: 1,
    },
    player: (s: number) => players[s],
    cardData: (id: string) => opts.cardData?.[id] ?? { name: id },
    cardTypes: (card: FakeCard) => (card.types ?? []).map((type) => type.toLowerCase()),
    hasCardType: (card: FakeCard, type: string) => (card.cardTypes ?? []).includes(type),
    cardNames: (card: FakeCard) => (card.names ?? []).map((name) => name.toLowerCase()),
    hasKeyword: (card: FakeCard, keyword: string) => (card.keywords ?? []).includes(keyword),
    hasCrank: (card: FakeCard) => card.crank === true,
    heroAbilitiesDisabled: () => opts.heroAbilitiesDisabled ?? false,
    getState: (key: string) => scriptState.get(key) ?? 0,
    setState: (key: string, value: unknown) => {
      scriptState.set(key, value);
      calls.push({ method: "setState", args: [key, value] });
    },
    getFlag: (scope: string, key: string) => flags.get(`${scope}:${key}`) ?? false,
    setFlag: (scope: string, key: string, value: unknown) => {
      flags.set(`${scope}:${key}`, value);
      calls.push({ method: "setFlag", args: [scope, key, value] });
    },
    getPlayerFlag: (s: number, key: string) => flags.get(`seat${s}:${key}`) ?? false,
    setPlayerFlag: (s: number, key: string, value: unknown) => flags.set(`seat${s}:${key}`, value),
    getCounter: (kind: string) => counters.get(kind) ?? self.counters?.[kind] ?? 0,
    setCounter: (kind: string, value: number) => {
      counters.set(kind, value);
      calls.push({ method: "setCounter", args: [kind, value] });
    },
    cardColor: (card: FakeCard) => opts.cardData?.[card.cardId ?? ""]?.pitch ?? 0,
    ...opts.props,
  };
  const ctx = new Proxy(base, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return record(prop);
    },
  }) as unknown as ScriptCtx;
  return {
    ctx,
    calls,
    called: (method) => calls.filter((call) => call.method === method).map((call) => call.args),
  };
}
