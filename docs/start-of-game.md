# Arena reveal before main-deck selection

Source: https://fabtcg.com/articles/rules-update-17-09-26/
Effective September 18, 2026; LSS will review the trial before Set 21.

## Flow

Pair/accept → choose first player → lock arena cards → reveal both selections
→ choose main decks → Ready → engine shuffle, setup effects, opening hands and turn 1.

`present-arena` sends weapons and equipment only. The server validates the
selection and stores private commitments in `rooms.prep.arenas`. The second
commit crosses the reveal barrier atomically. Each player can see their own
commitment before reveal; the opponent receives only the lock status. Cloaked
identities stay private; the public projection shows a face-down occupied slot.

`present-deck` is accepted only after both arena commitments. Its weapons and
equipment must match the commitment; the server composes the final deck using
the stored arena cards and revalidates the complete presentation. `prep-unready`
reopens main-deck editing only. Committed arena cards cannot be withdrawn.

Invite, matchmade, and bot rooms share this state machine. Matchmade rooms have
30 seconds for acceptance, then one five-minute start procedure budget including
the 30-second first-player choice window. The die winner is selected first on
choice timeout. Arena reveal does not reset the remaining budget. Missing arena
commitments or deck readiness evict the responsible seats at expiry; existing
survivor requeue rules apply. Leaving clears commitments and completed
presentations for the next pairing.

Bot arena selection receives only opponent hero and turn order. Bot main-deck
selection receives opponent hero and revealed arena cards, preserving its own
committed equipment. Hidden human main decks are never passed to preparation
policy. Hala uses the documented arcane equipment package against Oscilio based
on the public Wizard hero. Existing bot legality rules are preserved, including
Open mode for the benched Briar opponent.

## Persistence and deployment

This changes the prep JSON and protocol contract. Existing prep envelopes without
`arenas` are rejected. No SQL schema change is needed: commitments live in the
existing room JSON column. Applied migrations remain unchanged.

Deploy this change under a new operator-managed `RULESET_VERSION` (the example
configuration now uses `rules-3`). Run the explicit fenced ruleset activation,
then deploy server and client together. Activation removes rooms of the previous
ruleset; it does not migrate active games. Do not reuse the previous identifier,
change the active ruleset at startup, or deploy this server over old room data
without the explicit cutover. Local seeded rooms need to be recreated after the
local cutover. Implementation does not perform activation or deployment.
