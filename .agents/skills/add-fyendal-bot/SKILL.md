---
name: add-fyendal-bot
description: Add or update a matchup-aware practice bot in the Fyendal repository. Use when integrating a new hero bot, importing a deck exclusively for bot play, translating matchup guides into presentation and turn-order choices, changing bot policy, or wiring a bot opponent through cards, bot, shared, protocol, server, and client packages.
---

# Add a Fyendal Bot

Build the bot as a complete vertical feature: an internal legal deck, matchup-aware presentation, deterministic policy, server lifecycle, protocol contract, and client entry point.

## Start with repository rules

- Read the repository `AGENTS.md` before editing.
- Read `packages/engine/DESIGN.md` before changing engine rules behavior.
- Confirm unfamiliar card rules against the comprehensive rules before implementing mechanics.
- Follow the registered rules-limitation process for genuine engine gaps. Do not add untracked approximations.
- Keep an imported practice list `botOnly: true` unless the user explicitly wants it offered as a player precon.

## 1. Trace an existing bot

Use `rg` to identify every layer touched by a comparable bot. Hala and Bravo are useful references.

Inspect at least:

- `packages/cards/src/data/precons.json`
- `packages/cards/src/catalog.ts`
- `packages/bot/src/*-policy.ts`
- `packages/bot/src/sideboard.ts`
- `packages/bot/src/index.ts`
- `packages/shared/src/index.ts`
- `packages/protocol/src/index.ts`
- `apps/server/src/botRunner.ts`
- `apps/server/src/store.ts`
- `apps/server/src/index.ts`
- `apps/client/src/components/BotOpponentModal.tsx`
- Client surfaces that open bot practice

Do not assume adding a policy file alone makes the bot selectable or playable.

## 2. Acquire and verify the source deck

- Prefer the exact deck URL and matchup guides supplied by the user.
- When Fabrary API access is configured, follow the existing Fabrary integration and use `FABRARY_API_SECRET` without printing or persisting it.
- If the API omits linked matchup-guide prose, inspect the supplied guide page through an approved browser or web path and record its URL near the sideboard logic.
- If a required guide is inaccessible or internally contradictory, stop and ask for clarification rather than inventing matchup strategy.
- Treat API and JSON data as untrusted at production boundaries; decode exhaustively.
- Preserve exact printing IDs where the card data supports them.
- Record the source deck URL near the internal deck entry.
- Verify the pool contains all required weapons, off-hands, equipment, main-deck cards, and matchup sideboard cards.
- Confirm every card resolves and is backed by a functional script or verified vanilla entry.

If cards are missing, use the repository's `import-cards` skill rather than hand-building an incomplete card-data import.

## 3. Register a bot-only deck

Add the deck to `packages/cards/src/data/precons.json` with:

- A stable ID suitable for persisted references
- The correct `cc` or `silver-age` format
- `botOnly: true`
- A legal pool of weapon, equipment, and deck card IDs
- A source link in the description or a nearby comment when the schema permits it

Keep bot-only entries available through direct `precon(id)` lookup so server bot setup can use them. Ensure player-facing catalog helpers filter them out, and ensure saved-deck creation or fresh-deck resolution cannot select them.

Add tests that prove:

- The internal entry exists and is marked bot-only.
- It is absent from the player precon catalog for its format.
- Player deck resolution rejects its ID.
- Every referenced printing exists and is implemented.

## 4. Translate matchup guides into presentation

Add or extend the presentation logic in `packages/bot/src/sideboard.ts`.

For each documented matchup, encode:

- Main-deck selection at the exact format size
- Weapon and off-hand selection
- Equipment selection
- Preferred first- or second-player choice, when the guide specifies one

Normalize opponent hero names consistently. Provide a conservative default for unknown heroes. Validate every known matchup branch with `validatePresentation`, not only the default branch.

Test representative matchups, aliases, unknown opponents, exact deck size, equipment, weapons, and turn-order preferences.

## 5. Implement the policy

Create a focused policy module such as `packages/bot/src/<hero>-policy.ts` and export it from the package index.

- Drive the game only with intents returned by `legalIntents`.
- Base decisions on the bot-visible projection. Never inspect hidden opponent zones.
- Keep decisions deterministic except where the engine's persisted seeded RNG is deliberately used.
- Reuse the bot package's scoring and bounded planning helpers.
- Make the requested game plan explicit in scores and tests: defense thresholds, attack cadence, resource use, arsenal behavior, and reactions.
- Prefer blocking when a threatening on-hit is represented in the combat projection; do not infer danger from hidden cards.
- Handle non-action windows: opening choices, defense, attack reactions, instants, modal choices, pitch, equipment, hero abilities, and weapon attacks.
- Ensure every selected intent applies successfully.

Add focused policy tests for the defining strategic behavior, awkward hands, defense against on-hits, low-life decisions, and fallback legality. If the policy emits plans or traces, assert meaningful decisions rather than snapshotting incidental text.

## 6. Wire the vertical feature

Update all applicable layers:

1. Add the opponent identifier to the shared `BotOpponent` type.
2. Add it to the protocol's exact runtime allowlist.
3. Export the policy and presentation helpers from `@fyendal/bot`.
4. Select the correct policy in the server bot runner.
5. Map the opponent to the internal deck, presentation, hero, and turn-order behavior during bot-room creation.
6. Permit the bot for the correct format in server request handling.
7. Add the option and description to the client bot modal.
8. Check every client entry surface that creates a bot game, including empty states and practice nudges.

Preserve existing defaults and legacy behavior unless the request explicitly changes them.

## 7. Verify the integration

Run focused tests first, then the full release gate:

```sh
pnpm --filter @fyendal/bot test
pnpm --filter @fyendal/cards test
pnpm --filter @fyendal/server test
pnpm release:check
```

Use narrower Vitest targets while iterating. Include protocol decoding, bot-room creation, policy selection, presentation validity, bot-only catalog behavior, and the client selector in coverage.

Do not add browser automation or deploy. Deployment remains manual and requires an explicit user request.
