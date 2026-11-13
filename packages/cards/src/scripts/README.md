# Card script layout

Every scripted set has one canonical entry point at `scripts/<set>.ts`, using
the lowercase set code. The entry point exports the complete functional-keyed
script map for that set and is registered alphabetically in `scripts/index.ts`.

Keep a set in its entry-point file while that remains readable. When a set
needs to be split, put implementation partitions under `scripts/<set>/` and
compose them from the entry point with `mergeSetScripts`. The merger rejects
duplicate functional keys before one partition can silently override another.
Use names that describe the partition:

- `high-rarity.ts` for adult heroes and higher-rarity cards imported after the
  common/rare set module.
- Class or talent names such as `guardian.ts` or `arcane-generic.ts` when a
  large set is easier to navigate by card family.

Do not add root-level fragments such as `<set>-additional.ts`.

## Shared helpers

Mechanics used by more than one set live in themed modules under `shared/`.
Card scripts import them only through the `shared-helpers.ts` barrel, so a
helper can move between modules without touching any set. Shared modules
import each other directly (`./cards.js`) and must stay acyclic.

Before writing a helper for a new card, check the matching module below and
search the other sets for the same mechanic. Extend or move an existing helper
instead of adding another copy.

| Module | Holds |
| --- | --- |
| `messages.ts` | `decisionMessage`, `decisionPrompt`, `yesNoPrompt`, `commonOptionMessages`, `localizedLog`, `localizedCardLog`, labels |
| `composition.ts` | `mergeSetScripts`, `pitches`, `splitScript`, `resourceAbility` |
| `cards.ts` | card predicates: types and subtypes (`hasCardSubtype`, `isAttackAction`, `isAura`, `isItem`, …), names (`cardNamed`, `effectiveCardName`, `cardNameContains`, `sharesName`, `isCard`) |
| `state.ts` | seat, zone, turn and chain queries: `opponentSeat`, `equippedCards`, `controlledPermanents`, `faceUpGraveyard`, turn flags, previous attack, damage events, `flipHero` |
| `triggers.ts` | trigger builders (`entersArenaTrigger`, `destroyedTrigger`, `attackIntimidateTrigger`, …), delayed effects, granted hit riders, `buffNextAttack` |
| `targeting.ts` | target declarations (`heroTarget`, `anyDamageTarget`, `upToOneTargetAttack`) and text choices (`requestHeroChoice`, `requestAnyTargetChoice`) |
| `arcane.ts` | `dealArcane`, Amp and next-arcane bonuses, Wizard instants, arcane spells, Runechants |
| `opt.ts` | `optN`, `optOnChoose` |
| `costs.ts` | charge, Beat Chest, Heave, defense payments, discard choices |
| `arsenal.ts` | Reload, Mentor, lesson counters, Spire Sniping |
| `elemental.ts` | Fusion, Channel Lightning, Decompose |
| `mechanologist.ts` | Boost, Crank, maintenance, Hyper Driver, Evo equipment, Galvanize |
| `assassin.ts` | Mark, Contracts, Silver equipment, dagger hits |
| `combat.ts` | Crush, weapon attacks and reactions, Wager, Unity, 6+ power payoffs |
| `allies.ts` | Decay and ally attack buffs |
| `suspense.ts` | Suspense auras and crowd triggers |
| `diseases.ts` | disease tokens |
| `token-effects.ts` | Gold, Frostbite and clash token creation |
| `blood-debt.ts` | Blood Debt and Levia |

A helper used by one set stays in that set. `scripts-layout.test.ts` fails on a
shared export nothing imports or only one set imports, unless another shared
module uses it or it is on that test's allowlist with a reason.

## Tokens

Token and other created-card printing ids live only in `tokens.ts`, one
full-size printing per card. The catalog puts those printings first, so the
engine creates every same-name token as that printing. Identify tokens in play
by name or type, never by id, because saved games hold other printings.

## Registration

Script maps remain keyed by functional identity (`name lowercase|pitch`). The
central registry rejects duplicate keys between sets, and the layout test keeps
entry points, partitions, and registration ordering consistent.
