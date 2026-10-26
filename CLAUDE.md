# Fyendal guide

Fyendal is a TypeScript/pnpm monorepo for playing Flesh and Blood. Read
`packages/engine/DESIGN.md` before changing rules behavior and
`docs/client-bots.md` before changing practice bots.

## Folder structure

- `packages/shared` — types and stable protocol error codes only.
- `packages/protocol` — exhaustive runtime decoders for wire, HTTP, `GameView`,
  replay, and database JSON. Parse untrusted JSON as `unknown` and decode it
  here; never cast.
- `packages/engine` — deterministic, zero-I/O, card-agnostic rules engine.
- `packages/cards` — card JSON, scripts, vanilla registry, precons, and
  scenario tests (`src/__tests__/harness.ts`).
- `packages/bot` — practice-bot policies, hand valuation, and turn search.
- `apps/server` — HTTP/WebSocket gateway and Postgres stores. `db.ts` owns the
  schema (append-only migrations), `persistedState.ts` the persisted game
  envelope, `gateway/` routing and matchmaking.
- `apps/client` — React/Vite UI with one Zustand store. Copy uses `react-intl`;
  edit every source catalog in `src/i18n/catalogs/` and never hand-edit
  `src/i18n/compiled/`.
- `docs/` — design notes and `rules-limitations.json`, the registry of known
  rules gaps.
- `scripts/` — repo tooling (bot runtime fingerprint, rules-limitation check,
  release gate).
- `../Fyendal-dash` and `../Fyendal-deploy` — operator dashboard and
  deployment repos, each with its own `CLAUDE.md`.

## System invariants

- Production runs one active gateway but must stay safe across several
  instances. Live sockets stay local; matchmaking, leases, commands, and
  compact cross-instance events live in Postgres. Fan-out polls the event log;
  no `LISTEN`/`NOTIFY` or external queue.
- Migrations are append-only; never edit an applied one. An unexpected schema
  fails with `RESET_REQUIRED`.
- `rulesetVersion` is operator-managed. Bump it only for incompatible rules or
  persisted-state changes; catalog and presentation changes need no bump.
- Persisted game state uses the `PersistedStateV1` envelope. `cardsRef` and
  `scriptsRef` never enter room JSON; hydration validates, then reattaches them.
- Room mutations are transactional with optimistic room versions. Broadcast
  only after commit by reloading authoritative state; a broadcast failure
  closes sockets with `RESYNC_REQUIRED` instead of rolling back.
- Store only hashes of session and reconnect tokens. SQL is parameterized
  (`$1`, `$2`, …). New durable user data must be covered by account export and
  deletion.
- Match history counters (`hero_records`, `matchup_records`) are bumped in the
  game-over commit beside the new match row; never aggregate on read.
- Public logs never reveal hidden cards or choices. Use `logPublic`,
  `logPrivate`, or `logForSeats` deliberately; engine and server log entries
  carry a semantic `GameLogPayload` with catalog keys in every locale.

## Engine and cards

`packages/engine/DESIGN.md` is the full reference. In short:

- Games change only through `applyIntent`; `legalIntents` is the authority and
  every returned intent must apply. All randomness uses the seeded RNG, and
  state must survive a JSON round trip.
- The engine never references a printing id, card name, class, or hero. Add
  the narrowest generic hook or `ScriptCtx` command instead.
- Card scripts read deeply readonly state and mutate only through `ScriptCtx`.
  Scripts are keyed by `name lowercase|pitch`, so reprints reuse them.
- Played cards and abilities use the stack; go again grants its action point
  at resolution; resolved links stay until the chain closes.
- Mechanics live in focused modules (combat in `attacks.ts`, `defense.ts`,
  `reactions.ts`, `hits.ts`, `damage.ts`, `combatChain.ts`; zone moves in
  `zoneMoves.ts`; tokens, clash, priority in their own files). Cross-domain
  flows route through `flowDispatcher.ts`; `engineRuntime.ts` is the only
  composition root. The module graph is acyclic and test-enforced.
- `counters` holds only rules counters; script bookkeeping uses
  `ctx.getState`/`setState`.
- Confirm rules against <https://rules.fabtcg.com/en/cr/>. Card scenarios drive
  games only through legal intents.
- Rules gaps: never leave an unregistered `TODO(engine)`. Add a `FYD-RULE-NNN`
  entry to `docs/rules-limitations.json`, annotate the source, add the named
  `it.fails` test, and run `pnpm check:rules-limitations`. Remove the entry
  once fixed.

## Practice bots

`docs/client-bots.md` covers computation. Bots run in a browser Web Worker for
the human participant; the server only applies submitted intents and stays
authoritative, with a conservative fallback that never searches. Tasks are
sanitized (decks reordered, seed replaced, logs removed) and never reach
spectators, replays, or browser storage.

Hand valuation:

- Every value is a damage equivalent (`card-ev.ts`): `POINTS_PER_DAMAGE` (100)
  per damage, `HORIZON_DAMAGE_POINTS` (85) for unexplored damage at the search
  horizon. Never introduce another scale.
- Hand value comes from the memoized `HandSolver` (`hand-solver.ts`), built by
  `card-model.ts` and read only through `hand-value.ts`. It searches pitch,
  action points, go again, pending next-attack effects, weapons, equipment,
  and hero abilities.
- Each hero supplies only a `<hero>SolverRules` factory: card patches, start
  state, ability sources, and explicit values for effects that pay off beyond
  the turn. No per-hero damage estimators or hand-tuned scales.
- Arsenal: a go-again attack is worth its attack value, a terminal attack
  `ARSENAL_TERMINAL_FACTOR` of it, a pump its pump value, a defense reaction
  the damage it stops, each discounted by hypergeometric disruption from the
  opponent's decklist. Dead cards cost `DEAD_ARSENAL_COST`; blue cards pay
  `BLUE_ARSENAL_COST` unless they defend from arsenal or are `arsenalPlay`.
- A held card is worth only its margin over the draw it displaces. At a
  horizon the unplayed hand counts once (`horizonScore`).
- Future offense (held, arsenal, displaced draw, horizon) uses the same
  opponent-response weighting as this turn's damage (`futureOffenseRate`,
  `horizonDamage`), or holding would always win.
- `responseLossWeight` is a per-hero play-style bias on losing next turn's
  offense when blocking; 1 is neutral.

## Conventions

- Keep code comments terse: one line stating why, not what. Do not narrate
  design rationale, restate the code below, or explain layout choices the rule
  makes obvious. Multi-line comments are for genuinely non-obvious mechanisms.
- Do not copy card text into script comments; the card data already holds it.
- Card data goes in `packages/cards/src/data/cards/<SET>.json`, scripts below
  `scripts/`, registrations in both indexes, and true vanilla keys in
  `data/vanilla.json`. Card images are hotlinked from
  `https://content.fabrary.net/cards/<printingId>.webp`; never store them.
- Icons are SVG files in `apps/client/public/icons/ui/` (black on
  transparent), registered in `UiIconName` and rendered with `UiIcon`. Never
  inline `<svg>`/`<path>` markup; convert inline icons when you touch them.

## Internationalization

- Every locale (`en`, `zh-Hans`, `pt-BR`, `es`) has exactly the same keys;
  English is the fallback. Ids are stable, lowercase, dot-separated semantic
  names, never rendered copy or runtime data. Put dynamic content in ICU
  values and never concatenate translated fragments or branch on locale.
- Engine, server, and card scripts never render a locale; they send an English
  fallback plus `GameMessage` metadata. Card decisions use `decisionPrompt`,
  `decisionMessage`, and `commonOptionMessages`; logs use `localizedLog` or
  `localizedCardLog`. Every new `TriggerDef` supplies `labelMessage` (and
  `publicLogMessage` for a custom `publicLog`). Option values are never
  translated.
- zh-Hans keeps `go again`, `On hit`, `Links`/`Chain`, and `arsenal`, and
  renders `压制 (dominate)` and `灵气 (Aura)`.
- pt-BR and es keep FaB-defined terms in English (keywords, zones, card types,
  Action Point, Intellect, classes, talents, card and token names, phases,
  formats) and translate ordinary words. Use informal você/tú, never put a
  gendered participle directly on `{card}`, `{player}`, or `{hero}`, and give
  English nouns fixed genders (o/el arsenal, a/la combat chain, o/el chain
  link). pt-BR needs `=0` plural branches; es does not.
- `catalogs.test.ts` enforces parity, ids, coverage, and terminology; extend
  its assertions when standardizing a term.

## Validation

Run the smallest relevant validation for the affected code. Focused tests and
typechecks are the default; stop once checks proportional to the change pass.

```sh
pnpm --filter <workspace> test
pnpm --filter <workspace> typecheck
pnpm check:rules-limitations
pnpm release:check   # significant engine/server changes only
```

- Run `pnpm release:check` only after a significant change in
  `packages/engine` or `apps/server`, or when explicitly asked.
- For bot changes, run only the affected files
  (`pnpm --filter @fyendal/bot exec vitest run src/<hero>-policy.test.ts`).
  The full bot suite is CPU-heavy and times out when sessions run it
  concurrently; rerun a timed-out file alone before treating it as a failure.
- Documentation-only and comment-only changes need diff review, not tests.
- After catalog edits outside `pnpm dev`, run
  `pnpm --filter @fyendal/client i18n:compile` and include the compiled output.
  For i18n changes also run `catalogs.test.ts`.
- Add tests for non-trivial behavior. Keep known bugs as correctly phrased
  `it.fails` tests.
- Do not add browser automation bots, Playwright flows, or screenshot rigs;
  UI smoke testing is manual.
- `pnpm --filter @fyendal/server seed` is local-only. Never weaken its
  production-environment or remote-database guards.

## Skills

- `/import-cards` — import a set or precon into `packages/cards`.
- `/seed-manual-room` — seed a temporary local room for manual testing.
  Prefer one human seat against a bot; seat two humans only when the test
  needs a specific opposing decision. When an attack must hit, empty the
  defender's hand and arsenal and give them no equipment.
