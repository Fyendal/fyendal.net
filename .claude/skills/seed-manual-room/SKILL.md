---
name: seed-manual-room
description: Seed a temporary local Fyendal room for manual card, combat, or UI testing. Use when someone asks for a playable room at a particular game state; do not add a permanent scenario seed script.
---

# Seed a manual test room

Use `apps/server/src/seedRoom.ts` to persist a temporary fixture. Keep scenario setup in `apps/server/.manual-room/<descriptive-name>.ts`, which Git ignores. The checked-in seeder owns database writes, ruleset matching, and room replacement safety.

1. Read `CLAUDE.md` and the relevant card scenario test or engine code. Confirm the requested cards and game window with `legalIntents` and `applyIntent`. Read `packages/engine/DESIGN.md` if the task also changes rules behavior.
2. Confirm `DATABASE_URL` points to a local Postgres instance. Run `pnpm --filter @fyendal/server seed` to create the local accounts if needed. Start the local server or activate its intended ruleset before seeding the room.
3. Create a temporary TypeScript module under `apps/server/.manual-room/`. Its default export must satisfy `ManualRoomFixture` from `../src/seedRoom.js`: `{ code, title, format, state, seats }`. Use a six-character uppercase code; `format` is `cc` or `silver-age`; `seats` is a two-element tuple of `{ controller: "human", username: "alice" }` and/or `{ controller: "bot", opponent: "hala" }` with a registered bot id. At least one seat must be human. Prefer one human seat (`alice`) against a bot opponent so the room can be tested solo; seat two humans only when the test needs a specific opposing decision a bot will not reliably make, such as a particular block, reaction, or opponent-side choice. When the report names the opponent hero and a bot exists for it, use that bot.
4. Build `state` with `createGame({ decklists, cards: cardData, scripts, seed, startPlayer })`. For a bot seat, use `botDefinition(id)` and its `presentationFor` with the matching `precon` pool. To set up a hand, arsenal, graveyard, or other zone, move existing `CardInstance`s from that player's created deck and hand; do not manufacture duplicate instance IDs. Apply legal intents to reach later windows and decisions. Assert that the requested starting action is legal and that any preview arrives at the intended window.
5. Run `pnpm --filter @fyendal/server seed:room -- .manual-room/<descriptive-name>.ts`. Then inspect the persisted room or open `/<CODE>` as the human account and confirm the expected cards and choices. Report the room code, login, and first manual steps.

The seeder accepts only local database hosts, requires an active ruleset, and refuses to overwrite ordinary rooms. It can replace a room previously created by this seeder when no presence lease exists. Keep one-off fixture modules out of commits; remove them when the manual test no longer needs reseeding. The base `seed` command creates accounts only.
