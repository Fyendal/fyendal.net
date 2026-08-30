# Engine design

`@fyendal/engine` is a pure, deterministic, zero-I/O rules engine. It knows
generic Flesh and Blood mechanics, never card IDs, hero names, accounts,
networking, or persistence.

## Public contract

The package exposes six primary operations from `src/index.ts`:

```ts
createGame(config: GameConfig): GameState
legalIntents(state: GameState, seat: number): GameIntent[]
actionCandidates(state: GameState, seat: number): GameIntent[]
applyIntent(state: GameState, seat: number, intent: GameIntent): ApplyResult
projectStateFor(state: GameState, seat: number | null, publicGameId?: string): GameView
projectStateForReplay(state: GameState, publicGameId?: string): GameView
```

`legalIntents` is the authority for player actions. Every returned intent must
succeed when passed unchanged to `applyIntent`. `applyIntent` validates the
intent, clones the state, changes only the clone, runs state-based checks, and
returns either the new state or an error.

`actionCandidates` is a UI-discovery projection for structurally available
card plays and activated abilities. It may include actions the player cannot
currently afford, so it must never be treated as an authorization list or fed
to bots. The client may fill in an exact pitch sequence and submit the normal
intent; `applyIntent` remains authoritative.

Callers supply the two decklists, a seed, the card registry, the script
registry, and optionally the starting seat. The engine performs no I/O and
does not consult ambient configuration.

## Hard invariants

- Keep engine code card-agnostic. Add generic hooks and commands, not special
  cases for a printing, card name, class, or hero.
- Route every player action through `legalIntents` and `applyIntent`.
- Route every random result through the seeded RNG. A state plus an intent
  sequence must reproduce the same game.
- Keep state JSON-round-trip serializable. Do not store functions, classes,
  closures, dates, or process-local objects.
- Treat `ScriptCtx.state`, players, cards, and links as deeply readonly. Card
  scripts mutate only through `ScriptCtx` commands.
- Classify logs by audience. Public text must not reveal a hand, face-down
  arsenal, private deck position, or unrevealed choice.
- Register incomplete rules behavior in `docs/rules-limitations.json` with a
  focused executable `it.fails` scenario.

## State model

`src/state.ts` defines the complete serializable state:

- `CardInstance` holds stable identity, ownership, counters, temporary grants,
  face state, tap state, and other serializable per-card data.
- `PlayerState` holds the hero, life, resources, action points, flags, and all
  zones: hand, deck, arsenal, pitch, graveyard, banish, soul, equipment,
  weapons, and board. Face-down banished cards are inert — no properties, not
  playable, and invisible to property scans — except to effects that
  explicitly say "face-down". Cards banished face down *until an end phase*
  (Intimidate, scheduled returns) also live in `banish`, marked `intimidated`
  (return at the upcoming end phase) or `returnToHandAtTurn` (scheduled); the
  beginning-of-end-phase sweep returns them to hand and clears the markers.
- `ChainLinkState` records one attack, its target, defenders, reactions,
  resolved values, and link-local flags.
- `StackLayer` represents played cards, activated abilities, triggers, and
  generic delayed engine effects waiting for priority to pass.
- `PendingDecisionState` pauses a flow for a player choice and records the
  continuation needed after the answer.
- `Modifier` describes generic continuous and one-shot effects with explicit
  scope and filters.
- `GameLogEntry` stores `publicText` plus optional seat-specific overrides.

`src/runtimeState.ts` defines `GameConfig`, creation/cloning, and
`GameStateInternal`, which attaches `cardsRef` and `scriptsRef` while the engine
runs. Persistence excludes those registries and the server reattaches its
trusted process-wide copies after decoding.

Per-turn data belongs in player flags and is cleared during cleanup. Data that
must survive turns belongs on a card instance or an explicit top-level state
field. Per-link data belongs on the chain link.

## Game flow

Game creation shuffles both decks with the seeded RNG, runs hero setup effects
in seat order, draws opening hands, and starts the selected player's turn.
Setup may pause on an ordinary scripted decision.

A turn follows this sequence:

1. Start-of-turn triggers use the stack but resolve automatically without
   priority during the start phase.
2. The action phase begins, beginning-of-action-phase triggers are created,
   and the active player has 1 action point before receiving priority over
   those layers.
3. Actions, instants, abilities, attacks, and priority windows advance only
   through legal intents.
4. The end phase resolves delayed destruction and control returns, offers the
   arsenal decision, lets each player privately order their pitched cards onto
   the bottom of their deck, performs APUD cleanup,
   expires turn-scoped state, and starts the other player's turn.

Played cards and triggered or activated abilities ride the stack. Effects run
only when their layer resolves after both players pass. Go again grants its
action point at resolution. An attack card is a stack layer first; its
continuation declares the attack after the layer resolves.

Boost remains an optional play announcement represented by `boost?: true`.
When paid, its seeded top-deck banish and any Boost-dependent effects occur
through engine commands.

Combat proceeds through declaration, defense, reactions, damage, resolution,
and a possible next link. Resolved links remain on the combat chain until it
closes. Weapon and ally attackers remain in the arena; attack actions,
defenders, and reactions settle when the chain closes. Current calculations
and legality live in focused combat modules (`src/attacks.ts`,
`src/combatValues.ts`, `src/defense.ts`, `src/reactions.ts`, `src/hits.ts`,
`src/wagers.ts`, `src/damage.ts`, and `src/combatChain.ts`) plus
`src/legal.ts`.

Allies use the board zone, can be attack targets, and may attack through their
generic activation hooks. Effect and combat damage use the engine's shared
damage machinery; any known exceptions belong in the rules-limitations
register rather than this document.

## Projection and secrecy

`projectStateFor` is the live-client path from internal state to `GameView`.
During a game it reveals public zones, hides private card identities, projects
pending choices only to the entitled seat, and supplies only that viewer's
legal intents. Spectators use `seat = null`.

After `winner` is set, `projectStateFor` reveals both players' hands, ordered
decks, and arsenals. `projectStateForReplay` always produces a full-information
view of every zone while omitting live action capabilities and the RNG seed.
The server may persist replay projections while a game is active, but callers
must not expose them until the game is over.

Log projection follows the same audience boundary:

- A seated viewer receives their non-null seat override when present;
  otherwise they receive `publicText`.
- A spectator receives only `publicText`.
- Null text is omitted.

When moving a private card, write the public event without its name or instance
ID and put the identifying text only in the entitled seat override.

## Card scripts

`src/scripts.ts` defines `ScriptCtx`, activated abilities, triggers, and card
hooks. Its commands cover:

- resources, chi, action points, flags, counters, and modifiers;
- deterministic random choice, discard, draw, and shuffle;
- movement among zones, arsenal operations, settling, destruction, tokens,
  equipment, transformation, and control changes;
- damage, life, prevention, attack/link queries, and keyword grants;
- private look effects, scripted choices, payments, and audience-aware logs.

Use `ctx.player(seat)` and readonly state for queries. If a card cannot be
expressed safely, add the narrowest generic command to `ScriptCtx`, implement
it in the engine, and test it before using it from card scripts. Never expose a
mutable player object or engine-internal state adapter.

## Module dependency direction

Production modules form an acyclic graph, including type-only dependencies:

1. Neutral event and serializable state types.
2. Pure state, source, card, zone, and rule queries.
3. Focused mutations such as resources, lifecycle, tokens, and zone movement.
4. Script context and event execution through the type-only runtime ports.
5. Attack, defense, reaction, damage, stack, and turn domain flows.
6. `flowDispatcher.ts` and the immutable `engineRuntime.ts` composition root.
7. The public `index.ts` API.

Runtime services are explicit arguments and are never serialized or attached
to state. Cross-domain flow calls go through the dispatcher, while persisted
pauses remain represented by the existing JSON-safe `StackResume` and pending
decision unions. Do not add compatibility barrels or mutable service
registration to bypass the import direction.

## Finding mechanics

The source is the current catalog:

- `src/scripts.ts` — script hooks, markers, and commands.
- `src/scriptContext.ts` — the concrete `ScriptCtx` command implementation.
- `src/sourceQueries.ts` — active source and observer enumeration.
- `src/eventSources.ts` — event-trigger collection and hook dispatch.
- `src/runtimePorts.ts`, `src/engineRuntime.ts`, and `src/flowDispatcher.ts` —
  explicit script services and one-way flow composition.
- `src/tokens.ts`, `src/clash.ts`, `src/zoneMoves.ts`, and `src/priority.ts` —
  cohesive stateful mechanics previously grouped in the utility module.
- `src/ruleQueries.ts`, `src/resources.ts`, `src/cardLifecycle.ts`,
  `src/playRules.ts`, `src/abilityRules.ts`, `src/dieRoll.ts`, and
  `src/stateBased.ts` — focused owners of the former utility responsibilities.
- `src/actions.ts`, `src/attacks.ts`, `src/defense.ts`, `src/reactions.ts`,
  `src/hits.ts`, `src/wagers.ts`, `src/damage.ts`, `src/combatChain.ts`,
  `src/triggers.ts`, and `src/turn.ts` — game flow and generic keyword behavior.
- `src/legal.ts` — intent enumeration.
- `src/project.ts` — viewer projection.
- `src/__tests__/` and card scenarios — executable behavior.

Search those files before adding a hook. Do not copy a changing mechanic
inventory into documentation.

## Verification

Drive card scenarios only through legal intents. Keep deterministic matches
fixed-seed and assert secrecy on serialized views, not only on selected
fields.

```sh
pnpm --filter @fyendal/engine test
pnpm --filter @fyendal/engine typecheck
pnpm --filter @fyendal/cards test
pnpm check:rules-limitations
```
