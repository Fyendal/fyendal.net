# Fyendal agent guide

Fyendal is a TypeScript/pnpm monorepo for playing Flesh and Blood. Preserve
the boundaries below; they are release invariants, not suggestions.

## Architecture invariants

- Production may run multiple Cloud Run instances. Live sockets and their
  delivery bindings remain local; durable matchmaking, leases, commands, and
  compact cross-instance events live in Postgres. Fan-out polls the event log;
  do not add `LISTEN`/`NOTIFY` or assume an external distributed queue.
- Schema epoch 1 is the initial empty-database baseline. Unexpected application
  tables or another epoch fail with `RESET_REQUIRED`. Future changes append
  immutable migrations; never edit an applied migration.
- `rulesetVersion` is an operator-managed compatibility identifier, not the
  image SHA. Compatible deployments retain it; incompatible persisted-state
  or rules changes require an explicit bump. The explicit cutover deletes
  rooms from another ruleset rather than migrating active games. Cutover is
  fenced; startup never changes the active ruleset implicitly.
- `packages/shared` contains types only. All wire, HTTP-response, `GameView`,
  and replay decoding belongs in `@fyendal/protocol`.
- Parse JSON and database JSON as `unknown`, then decode it exhaustively. Never
  cast untrusted values to runtime types.
- Card scripts observe deeply readonly state and mutate only through
  `ScriptCtx`. Do not create mutable player helpers, engine-runtime imports,
  compatibility adapters, or internal escape hatches.
- Public logs must not reveal identities from hands, face-down arsenal, private
  deck positions, blind choices, or other hidden zones. Use `logPublic`,
  `logPrivate`, or `logForSeats` deliberately.
- Every registered rules limitation has a source annotation and a focused,
  executable `it.fails` scenario.

## Packages and applications

- `packages/shared` — data contracts and stable protocol error codes.
- `packages/protocol` — hand-written exact-key runtime validators with bounds,
  safe-integer checks, nested validation, and depth limits.
- `packages/engine` — deterministic, zero-I/O, card-agnostic rules engine.
  Never reference a printing id, card name, class, or hero here. Read
  `packages/engine/DESIGN.md` before changing rules behavior. Import mechanics
  from their owning modules; do not turn `util.ts` back into a compatibility
  barrel. Production engine modules must remain free of runtime and type-only
  dependency cycles; the architecture test enforces this without an allowlist.
- `packages/cards` — card JSON, functional scripts, vanilla registry, precons,
  and scenario tests. Use `.agents/skills/import-cards/SKILL.md` for imports.
- `apps/server` — HTTP/WebSocket gateway and Postgres stores. `db.ts` owns the
  schema, `persistedState.ts` owns the explicit persisted DTO,
  `roomBroadcaster.ts` owns local fan-out, and `gateway/` owns connection,
  matchmaking, routing, and composition.
- `apps/client` — React/Vite UI and one public Zustand store covering
  connection/session, account/decks, lobby/room, and replay state.

## Internationalization

- React copy uses `react-intl`. Source catalogs live in
  `apps/client/src/i18n/catalogs/{en,zh-Hans}.json`; compiled ICU AST catalogs
  live in `apps/client/src/i18n/compiled/`. Edit both source catalogs and never
  hand-edit compiled output. English is the canonical fallback, and every
  supported locale must have exactly the same keys.
- Message ids are stable, lowercase, dot-separated semantic identifiers. Do
  not encode rendered copy, a printing id, or runtime data in an id. Put
  dynamic content in ICU values; use typed `GameMessage` card, player, and term
  references when the client must resolve visible names safely.
- Client-only copy uses `useIntl`, `FormattedMessage`, `GameMessageText`, or
  `formatGameMessage`. Do not branch on the current locale or construct
  translated sentences by concatenating fragments.
- The engine, server, and card scripts never import locale catalogs or render a
  locale. Wire-visible game copy retains a deterministic English fallback and
  carries locale-neutral `GameMessage` metadata. This keeps old clients,
  persisted decisions, replay diagnostics, and newer catalogs compatible.
- Card-script decisions use the helpers in
  `packages/cards/src/scripts/shared-helpers.ts`: `decisionPrompt` for every
  player-facing prompt, `decisionMessage` for semantic option labels, and
  `commonOptionMessages` for shared fixed choices. Option values delivered to
  `onChoose` are stable engine values and must never be translated. Card choices
  may remain ids because the client renders their visible card names.
- Player-facing card logs use `localizedLog` or `localizedCardLog`. Choose
  `logPublic`, `logPrivate`, or `logForSeats` independently of localization;
  neither fallback text nor semantic values may reveal hidden information.
- Every new `TriggerDef` supplies `labelMessage` beside its English `label`.
  `packages/cards/src/trigger-messages.ts` enriches migrated legacy labels at
  registry composition and consolidates repeated effects through parameterized
  messages. Do not add a new raw trigger fallback without semantic metadata;
  `trigger-messages.test.ts` enforces a zero untranslated backlog.
- To add a language, extend `SUPPORTED_LOCALES`, its autonym and browser-locale
  matching in `apps/client/src/i18n/locale.ts`; add its source catalog and lazy
  import in `I18nProvider.tsx`; then update locale, picker, and catalog tests.
  Language-picker labels are autonyms, not translations in the active locale.
- Preserve established Simplified Chinese terminology. Keep `go again`,
  `On hit`, `Links`/`Chain`, and `arsenal` as established UI terms; render
  dominate as `压制 (dominate)` and Aura as `灵气 (Aura)` with a space before
  the parenthesis. Extend the terminology assertions in `catalogs.test.ts` when
  standardizing another term.
- `pnpm dev` compiles all catalogs before Vite starts, then the Vite plugin
  recompiles a changed source catalog and reloads the page. Builds also compile
  first. Outside a running dev server, run
  `pnpm --filter @fyendal/client i18n:compile` after catalog edits and include
  the generated compiled catalogs in the change.
- `apps/client/src/i18n/catalogs.test.ts` enforces locale key parity, safe ids,
  referenced card/engine message coverage, and terminology. For i18n changes,
  run the compiler, that focused client test, the relevant UI/card tests, and
  affected workspace typechecks. Pure catalog or presentation-metadata changes
  do not require a `rulesetVersion` bump; rules behavior or incompatible
  persisted/wire changes still do.

## Server and persistence

- Persisted game state uses the explicit `PersistedStateV1` envelope.
  `cardsRef` and `scriptsRef` are process registries and must never enter room
  JSON. Hydration validates first, then reattaches both registries.
- `rooms` holds room-wide state, `room_seats` holds relational membership,
  `room_history` holds the newest 20 undo snapshots, and `room_presence` holds
  per-socket leases. User-owned rows use cascading foreign keys.
- Store only hashes of account sessions and reconnect credentials. Return raw
  tokens once and hash incoming credentials before comparison.
- Room mutations and history writes are transactional and use optimistic room
  versions. Broadcast only after commit by reloading authoritative state.
  Broadcast failure must not roll back a committed mutation; close affected
  sockets with `RESYNC_REQUIRED` so reconnect reloads state.
- Durable data belongs in Postgres. Local queues and live sockets may disappear
  on instance recycle. Clients must reconnect safely.
- Registration uses only username/password. Passwords use Node scrypt; sessions
  are opaque 32-byte tokens stored as SHA-256 hashes with 30-day sliding expiry.
- Account export and password-confirmed deletion are self-service. New durable
  user data must be included in both. Deletion removes account-bound rooms and
  lets sessions/decks cascade.
- SQL is async and parameterized with `$1`, `$2`, …; never interpolate values.
  Tests use `pg-mem` through `freshDb()`.

## Formats and decks

- `Format` is `classic-battles | cc | silver-age`.
- Classic Battles uses fixed Rhinar or Dorinthea pools; mirror matches are
  allowed. Silver Age also exposes the precons in
  `packages/cards/src/data/precons.json`.
- A saved `DeckPool` is not a game presentation. `PresentedDeck` selects legal
  weapons, equipment, and main deck for one match; `validatePresentation` is
  authoritative.
- Filling seat 1 enters prep. Both seats present decks, then the die winner
  chooses the first player. Leaving before start frees the seat; queued players
  may be requeued into the retained room.
- Deck import accepts Fabrary export text. Every card must resolve and be
  implemented by a functional script or verified vanilla entry.

## Engine and card rules

- All randomness uses the persisted seeded RNG.
- Games change only through `applyIntent`; `legalIntents` is the source of
  truth, and every returned intent must apply successfully.
- Played cards and abilities use the priority stack. Go again grants its action
  point at resolution. Resolved combat links remain until the chain closes.
- Combat behavior is divided among `attacks.ts`, `combatValues.ts`,
  `defense.ts`, `reactions.ts`, `hits.ts`, `wagers.ts`, `damage.ts`, and
  `combatChain.ts`; do not recreate a `combat.ts` facade.
- Stateful mechanics belong in their focused modules: token creation and
  replacement in `tokens.ts`, clash in `clash.ts`, zone movement and permanent
  destruction in `zoneMoves.ts`, and shared priority transitions in
  `priority.ts`.
- `sourceQueries.ts` owns active-source enumeration; `eventSources.ts` owns
  event-trigger collection and hook dispatch. `scriptContext.ts` implements
  `ScriptCtx`, while `engineRuntime.ts` is the sole immutable composition root.
  Pass runtime services explicitly through internal flows; never attach them
  to game state or introduce a mutable module registry.
- Cross-domain combat and turn continuations route through
  `flowDispatcher.ts`. Domain flow modules may depend on lower-level mechanics
  and runtime port types, but must not import peer flow implementations.
- State must survive JSON cloning: no functions, classes, maps, or process
  references. Persistent card data belongs on `CardInstance`; turn data belongs
  in player/link flags and is cleaned at the correct boundary.
- Scripts are keyed by functional identity, `name lowercase|pitch`, never by
  printing id. Reprints automatically reuse scripts.
- Under `packages/cards/src`, add card data to `data/cards/<SET>.json`,
  functional scripts below `scripts/`, registrations in both indexes, and true
  vanilla keys to `data/vanilla.json`. Duplicate functional keys are errors.
- Card images are hotlinked from
  `https://content.fabrary.net/cards/<printingId>.webp`; do not store them.
- Confirm rules against <https://rules.fabtcg.com/en/cr/> before implementing
  a mechanic.

## Rules limitations

Never add an unregistered `TODO(engine)` or approximation comment under the
engine or card scripts. For a real gap:

1. Allocate the next `FYD-RULE-NNN` in `docs/rules-limitations.json`.
2. Record `source`, concrete `expected` behavior, `testFile`, `testName`, and
   `implemented: false`.
3. Annotate every related source comment with the id.
4. Add the named `it.fails` test asserting correct behavior.
5. Run `pnpm check:rules-limitations`.

When fixed, convert the focused test to normal `it`, remove all annotations,
and remove the registry entry. Never leave an implemented limitation tracked.

## Validation

Run the smallest relevant validation for the affected code. Focused tests and
typechecks are the default; stop once checks proportional to the change pass.

```sh
pnpm --filter <workspace> test      # focused package tests
pnpm --filter <workspace> typecheck # focused package typecheck
pnpm release:check                  # significant engine/server changes only
```

- Do not run `pnpm release:check` for routine or localized changes. Run it only
  after a significant change in `packages/engine` or `apps/server`, or when the
  user explicitly requests the full release gate.
- Documentation-only and comment-only changes require diff review, not tests.

- Card scenarios use `packages/cards/src/__tests__/harness.ts` and drive games
  only through legal intents.
- Add tests for non-trivial behavior. Keep known bugs as correctly phrased
  `it.fails` tests.
- Do not build browser bots, Playwright flows, or screenshot rigs; UI smoke
  testing is manual.
- `pnpm --filter @fyendal/server seed` is local-only. Never weaken its
  production, Cloud Run, or Cloud SQL guards.
