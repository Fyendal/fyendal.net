---
name: import-cards
description: Import cards from a Flesh and Blood set (or precon deck set) into packages/cards — data, scripts, vanilla curation, and tests. Use when asked to "import set X", "add support for set X", or "import cards from a precon deck".
---

# Import cards

Read the card and engine rules in `AGENTS.md` before editing. Consult
`packages/engine/DESIGN.md` and `packages/engine/src/scripts.ts` only when a
card needs an engine hook.

## 1. Research the set

Use the Comprehensive Rules at <https://rules.fabtcg.com/en/cr/> for rules
behavior. Fetch the community card dataset when the importer needs a fresh
copy:

```sh
curl -sL https://raw.githubusercontent.com/the-fab-cube/flesh-and-blood-cards/develop/json/english/card.json \
  -o /tmp/fab-cards.json
```

Read each new card's complete text. Identify reprints, functional variants,
keywords, hero setup effects, and mechanics that need engine support.

## 2. Import data

Import a complete set:

```sh
node scripts/import-set.mjs <SET>
```

Limit an import by rarity and hero age when requested:

```sh
node scripts/import-set.mjs WTR --rarity C,R --young-heroes
```

The command writes `packages/cards/src/data/cards/<SET>.json` and reports
reprints, `SCRIPT NEEDED`, and `vanilla?` candidates. Save long output with
`tee`; do not pipe it through `head`, which can terminate the importer early.

Treat the report as a starting point:

- Reprints reuse the existing functional script automatically.
- Only `SCRIPT NEEDED` keys should receive new scripts.
- Verify every `vanilla?` candidate manually. Keyword-plus-effect text such as
  Crush, Combo, or Reprise is not vanilla.
- Heroes with ability text need scripts, including setup effects.

Do not register the data file until every functional key has either a script
or a verified vanilla entry. Registration activates the completeness gate.

## 3. Implement scripts

Key scripts by functional identity: lowercase card name plus pitch. Never key
behavior by printing ID. Before adding a key, search all existing scripts:

```sh
rg '"<name>\|<pitch>"' packages/cards/src/scripts
```

Follow these constraints:

- Keep the engine card-agnostic. Add generic mechanics, never card IDs or hero
  names, to `packages/engine`.
- Observe state through the deeply readonly `ScriptCtx` view. Mutate only with
  its narrow commands; do not create mutable helpers or internal adapters.
- Route every random result through seeded `ScriptCtx` commands.
- Use `logPublic`, `logPrivate`, or `logForSeats`. Never expose identities from
  hands, face-down arsenal, private deck positions, or unrevealed choices in
  public text.
- Reuse an existing script pattern when semantics match. Extract a shared
  helper after the third repetition.
- Keep pitch variants small and factor their shared behavior locally.

Add the set module under `packages/cards/src/scripts/` and register it in
`packages/cards/src/scripts/index.ts`. Duplicate functional keys are errors;
remove the new duplicate instead of bypassing the check.

## 4. Register unavoidable rules gaps

A missing generic engine feature must not leave an otherwise complete card
batch unregistered. Implement the closest safe behavior, then make the gap
executable:

1. Allocate the next `FYD-RULE-NNN` entry in
   `docs/rules-limitations.json`.
2. Record the owning source, exact correct behavior, focused test file, and
   test name with `implemented: false`.
3. Add `[FYD-RULE-NNN]` to every related source annotation. Never leave a bare
   `TODO(engine)`, `approximation`, or `approximations` comment.
4. Add a genuine `it.fails` scenario that asserts the correct behavior.
5. Keep the engine change generic and schedule it separately from the card
   implementation when that reduces risk.

Use `docs/rules-limitations.json` as the only inventory of open gaps; do not
copy that inventory into this skill.

## 5. Curate and register

- Add only genuinely scriptless functional keys to
  `packages/cards/src/data/vanilla.json` and keep the JSON valid.
- Import and spread the card data in `packages/cards/src/index.ts`.
- Register the script module in `packages/cards/src/scripts/index.ts`.
- Update negative lookup tests if they used a newly imported card as their
  unknown-card example.

For precon products, use the same import flow. Fixed Classic Battles decklists
are generated separately by `scripts/generate-cards.mjs` into
`packages/cards/src/data/decklists.json`.

## 6. Test behavior

Add one focused scenario per distinct design under
`packages/cards/src/__tests__/scenarios/`. Drive scenarios only through legal
intents using the harness. Add or update a fixed-seed full match when the set
introduces a new hero pairing.

Run after each script family so regressions stay localized, then run the full
gate:

```sh
pnpm check:rules-limitations
pnpm -r test
pnpm -r typecheck
pnpm lint
```

Report imported scope, scripts and vanilla entries added, registered rules
gaps, and verification results.
