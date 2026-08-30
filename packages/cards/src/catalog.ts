import type { CardData, Decklist, DeckPool, Format, HeroId, PresentedDeck } from "@fyendal/shared";
import { decodeCardDataList } from "./cardData.js";
import { functionalKey, functionalKeyOf } from "./functional.js";
import cards1HP from "./data/cards/1HP.json" with { type: "json" };
import cardsAAC from "./data/cards/AAC.json" with { type: "json" };
import cardsAHA from "./data/cards/AHA.json" with { type: "json" };
import cardsAOL from "./data/cards/AOL.json" with { type: "json" };
import cardsAZS from "./data/cards/AZS.json" with { type: "json" };
import cardsAAZ from "./data/cards/AAZ.json" with { type: "json" };
import cardsAIO from "./data/cards/AIO.json" with { type: "json" };
import cardsAGB from "./data/cards/AGB.json" with { type: "json" };
import cardsAJV from "./data/cards/AJV.json" with { type: "json" };
import cardsAKO from "./data/cards/AKO.json" with { type: "json" };
import cardsASB from "./data/cards/ASB.json" with { type: "json" };
import cardsASR from "./data/cards/ASR.json" with { type: "json" };
import cardsAST from "./data/cards/AST.json" with { type: "json" };
import cardsAMX from "./data/cards/AMX.json" with { type: "json" };
import cardsAMA from "./data/cards/AMA.json" with { type: "json" };
import cardsAMO from "./data/cards/AMO.json" with { type: "json" };
import cardsARR from "./data/cards/ARR.json" with { type: "json" };
import cardsAPS from "./data/cards/APS.json" with { type: "json" };
import cardsAPR from "./data/cards/APR.json" with { type: "json" };
import cardsARC from "./data/cards/ARC.json" with { type: "json" };
import cardsARK from "./data/cards/ARK.json" with { type: "json" };
import cardsAUR from "./data/cards/AUR.json" with { type: "json" };
import cardsAVS from "./data/cards/AVS.json" with { type: "json" };
import cardsBDD from "./data/cards/BDD.json" with { type: "json" };
import cardsBOL from "./data/cards/BOL.json" with { type: "json" };
import cardsCHN from "./data/cards/CHN.json" with { type: "json" };
import cardsCRU from "./data/cards/CRU.json" with { type: "json" };
import cardsDDD from "./data/cards/DDD.json" with { type: "json" };
import cardsDRO from "./data/cards/DRO.json" with { type: "json" };
import cardsDVR from "./data/cards/DVR.json" with { type: "json" };
import cardsDYN from "./data/cards/DYN.json" with { type: "json" };
import cardsDTD from "./data/cards/DTD.json" with { type: "json" };
import cardsEVO from "./data/cards/EVO.json" with { type: "json" };
import cardsELE from "./data/cards/ELE.json" with { type: "json" };
import cardsEVR from "./data/cards/EVR.json" with { type: "json" };
import cardsUPR from "./data/cards/UPR.json" with { type: "json" };
import cardsFAB from "./data/cards/FAB.json" with { type: "json" };
import cardsHVY from "./data/cards/HVY.json" with { type: "json" };
import cardsHNT from "./data/cards/HNT.json" with { type: "json" };
import cardsIAR from "./data/cards/IAR.json" with { type: "json" };
import cardsLEV from "./data/cards/LEV.json" with { type: "json" };
import cardsLGS from "./data/cards/LGS.json" with { type: "json" };
import cardsMON from "./data/cards/MON.json" with { type: "json" };
import cardsMST from "./data/cards/MST.json" with { type: "json" };
import cardsMPA from "./data/cards/MPA.json" with { type: "json" };
import cardsMPG from "./data/cards/MPG.json" with { type: "json" };
import cardsMPW from "./data/cards/MPW.json" with { type: "json" };
import cardsOMN from "./data/cards/OMN.json" with { type: "json" };
import cardsPEN from "./data/cards/PEN.json" with { type: "json" };
import cardsPSM from "./data/cards/PSM.json" with { type: "json" };
import cardsSUP from "./data/cards/SUP.json" with { type: "json" };
import cardsOUT from "./data/cards/OUT.json" with { type: "json" };
import cardsRNR from "./data/cards/RNR.json" with { type: "json" };
import cardsROS from "./data/cards/ROS.json" with { type: "json" };
import cardsRVD from "./data/cards/RVD.json" with { type: "json" };
import cardsSEA from "./data/cards/SEA.json" with { type: "json" };
import cardsSBA from "./data/cards/SBA.json" with { type: "json" };
import cardsSBR from "./data/cards/SBR.json" with { type: "json" };
import cardsSBL from "./data/cards/SBL.json" with { type: "json" };
import cardsSBZ from "./data/cards/SBZ.json" with { type: "json" };
import cardsSEN from "./data/cards/SEN.json" with { type: "json" };
import cardsSFA from "./data/cards/SFA.json" with { type: "json" };
import cardsSAZ from "./data/cards/SAZ.json" with { type: "json" };
import cardsSDO from "./data/cards/SDO.json" with { type: "json" };
import cardsSAR from "./data/cards/SAR.json" with { type: "json" };
import cardsSDA from "./data/cards/SDA.json" with { type: "json" };
import cardsSGB from "./data/cards/SGB.json" with { type: "json" };
import cardsSKA from "./data/cards/SKA.json" with { type: "json" };
import cardsSLY from "./data/cards/SLY.json" with { type: "json" };
import cardsSVI from "./data/cards/SVI.json" with { type: "json" };
import cardsSIY from "./data/cards/SIY.json" with { type: "json" };
import cardsTCC from "./data/cards/TCC.json" with { type: "json" };
import cardsTER from "./data/cards/TER.json" with { type: "json" };
import cardsWTR from "./data/cards/WTR.json" with { type: "json" };
// Reprint-only products and curated promo families. Kept in one block so the
// card-pool audit and synchronization manifest remain easy to compare.
import cardsANQ from "./data/cards/ANQ.json" with { type: "json" };
import cardsARA from "./data/cards/ARA.json" with { type: "json" };
import cardsAUA from "./data/cards/AUA.json" with { type: "json" };
import cardsAZL from "./data/cards/AZL.json" with { type: "json" };
import cardsBEN from "./data/cards/BEN.json" with { type: "json" };
import cardsBET from "./data/cards/BET.json" with { type: "json" };
import cardsBRI from "./data/cards/BRI.json" with { type: "json" };
import cardsBVO from "./data/cards/BVO.json" with { type: "json" };
import cardsCIN from "./data/cards/CIN.json" with { type: "json" };
import cardsCON from "./data/cards/CON.json" with { type: "json" };
import cardsENG from "./data/cards/ENG.json" with { type: "json" };
import cardsFAI from "./data/cards/FAI.json" with { type: "json" };
import cardsFLR from "./data/cards/FLR.json" with { type: "json" };
import cardsFNG from "./data/cards/FNG.json" with { type: "json" };
import cardsGEM from "./data/cards/GEM.json" with { type: "json" };
import cardsHER from "./data/cards/HER.json" with { type: "json" };
import cardsIRA from "./data/cards/IRA.json" with { type: "json" };
import cardsJDG from "./data/cards/JDG.json" with { type: "json" };
import cardsKAT from "./data/cards/KAT.json" with { type: "json" };
import cardsKSI from "./data/cards/KSI.json" with { type: "json" };
import cardsKSU from "./data/cards/KSU.json" with { type: "json" };
import cardsKYO from "./data/cards/KYO.json" with { type: "json" };
import cardsLSS from "./data/cards/LSS.json" with { type: "json" };
import cardsLXI from "./data/cards/LXI.json" with { type: "json" };
import cardsNUU from "./data/cards/NUU.json" with { type: "json" };
import cardsOLA from "./data/cards/OLA.json" with { type: "json" };
import cardsOLD from "./data/cards/OLD.json" with { type: "json" };
import cardsOSC from "./data/cards/OSC.json" with { type: "json" };
import cardsOXO from "./data/cards/OXO.json" with { type: "json" };
import cardsRHI from "./data/cards/RHI.json" with { type: "json" };
import cardsRIP from "./data/cards/RIP.json" with { type: "json" };
import cardsTEA from "./data/cards/TEA.json" with { type: "json" };
import cardsTNP from "./data/cards/TNP.json" with { type: "json" };
import cardsUZU from "./data/cards/UZU.json" with { type: "json" };
import cardsVER from "./data/cards/VER.json" with { type: "json" };
import cardsVIC from "./data/cards/VIC.json" with { type: "json" };
import cardsWIN from "./data/cards/WIN.json" with { type: "json" };
import cardsWOD from "./data/cards/WOD.json" with { type: "json" };
import cardsXXX from "./data/cards/XXX.json" with { type: "json" };
import cardsZEN from "./data/cards/ZEN.json" with { type: "json" };
import rawDecklists from "./data/decklists.json" with { type: "json" };
import rawPreconsJson from "./data/precons.json" with { type: "json" };
import { validatePresentationAgainstCards } from "./presentation.js";
export { equipmentFitsSlot } from "./equipment.js";
import { formatLegalityIssues } from "./formatLegality.js";
export {
  CLASSIC_CONSTRUCTED_LEGALITY_CHECKED_ON,
  FUTURE_SET_CODES,
  formatLegalityErrors,
  formatLegalityIssues,
  type FormatLegalityIssue,
} from "./formatLegality.js";
export { EXACT_DECK_SIZE, MIN_DECK_SIZE } from "./presentation.js";
export type { PresentationResult } from "./presentation.js";

/**
 * Static card pool across all imported sets (see the data/cards imports above).
 * Generated from the the-fab-cube dataset; keyword corrections applied below
 * where the dataset lists a keyword that is only granted conditionally by the
 * card's own text. Keyed by functional key so reprints inherit the override.
 */
const KEYWORD_OVERRIDES: Record<string, string[]> = {
  // Older OUT data predates the explicit Blade Break keyword field.
  "mask of many faces|0": ["Blade Break"],
  // Wild Ride only GAINS go again if a 6+ card is discarded
  "wild ride|1": [],
  "wild ride|2": [],
  // Stone Rain gains dominate only while it has an aim counter.
  "stone rain|1": [],
  // Buckwild only GAINS go again while a 6+ card is in the pitch zone
  "buckwild|1": [],
  "buckwild|2": [],
  "buckwild|3": [],
  // Bare Destruction only gains go again after Beat Chest while no chest is equipped.
  "bare destruction|1": ["Beat Chest"],
  // Flex Speed gains go again only while its current power is at least 6.
  "flex speed|1": [],
  "flex speed|2": [],
  "flex speed|3": [],
  // Pulping's dominate and go again are both conditional
  "pulping|1": [],
  // Wrecking Ball only intimidates if a 6+ card is discarded
  "wrecking ball|1": [],
  // Breakneck Battery only GAINS go again if the discarded random card has 6+ {p}
  "breakneck battery|1": [],
  "breakneck battery|2": [],
  "breakneck battery|3": [],
  // Entwine Lightning only GAINS go again if it was fused
  "entwine lightning|1": ["Lightning Fusion"],
  // Lightning Surge only GAINS go again if it was played from arsenal
  "lightning surge|1": [],
  // Path of Same Ends only GAINS go again if its arcane damage is dealt
  "path of same ends|1": [],
  "path of same ends|2": [],
  "path of same ends|3": [],
  // OMN labels and conditional keywords are implemented by their scripts.
  "aethersling|1": [],
  "arc ramp|1": ["Amp 3"],
  "arc ramp|2": ["Amp 2"],
  "arc ramp|3": ["Amp 1"],
  "ebbing arcstride|1": ["Fragment"],
  "ebbing arcstride|2": ["Fragment"],
  "ebbing arcstride|3": ["Fragment"],
  "stellar glide|1": [],
  "stellar glide|2": [],
  "stellar glide|3": [],
  // Second Strike only GAINS go again if you've dealt damage this turn
  "second strike|1": [],
  "second strike|2": [],
  "second strike|3": [],
  "flittering charge|1": [],
  "flittering charge|2": [],
  "flittering charge|3": [],
  "vantage point|1": [],
  "vantage point|2": [],
  "vantage point|3": [],
  "runerager swarm|2": [],
  "runerager swarm|3": [],
  // PEN grants these keywords only after their printed conditions hold.
  "aggressive pounce|1": [],
  "aggressive pounce|2": [],
  "aggressive pounce|3": [],
  "man overboard|1": [],
  "man overboard|2": [],
  "man overboard|3": [],
  "lighten the load|1": [],
  "lighten the load|2": [],
  "lighten the load|3": [],
  "knife through|1": ["Stealth"],
  "knife through|2": ["Stealth"],
  "knife through|3": ["Stealth"],
  "arc bending|1": ["Lightning Bond"],
  "stadium security|1": [],
  "stadium security|2": [],
  "stadium security|3": [],
  "chain of brutality|1": [],
  "concoct disorder|2": [],
  "concoct disorder|3": [],
  // Jack Be Quick only GAINS go again if a Nimblism was banished for it
  "jack be quick|1": ["Steal"],
  // Star Fall's attacks only GET +1{p} and go again if you've played a Lightning card
  "star fall|0": [],
  // Jittery Bones only GAINS go again if the discarded/milled card has watery grave
  "jittery bones|3": [],
  // ASR grants go again only when Edge of Autumn was the prior attack.
  "seek vengeance|1": ["Combo"],
  "seek vengeance|3": ["Combo"],
  "vengeance never rests|3": ["Combo"],
  // High Seas keywords below are granted only after their printed conditions hold.
  "cloud skiff|1": [],
  "cloud skiff|2": [],
  "cloud skiff|3": [],
  "board the ship|1": [],
  "paddle faster|1": [],
  "burly bones|1": [],
  "burly bones|2": [],
  "burly bones|3": [],
  "jittery bones|1": [],
  "jittery bones|2": [],
  "restless bones|1": [],
  "restless bones|2": [],
  "restless bones|3": [],
  "conqueror of the high seas|1": ["High Tide"],
  // Sonata Galaxia only gains go again when its declared X is 2 or more.
  "sonata galaxia|1": [],
  "hms barracuda|2": ["High Tide"],
  "hms kraken|2": ["High Tide"],
  "hms marlin|2": ["High Tide"],
  "gold hunter marauder|2": [],
  "blow for a blow|1": [],
  "jack be nimble|1": ["Steal"],
  // Aether Quickening only GAINS go again via Surge (deals more than 2 damage)
  "aether quickening|3": ["Surge"],
  // Zenith Blade only gains go again on its first attack after being sharpened.
  "zenith blade|0": [],
  // Light the Way only GAINS go again on hit if a yellow card was charged for it
  "light the way|1": ["Charge"],
  "light the way|2": ["Charge"],
  "light the way|3": ["Charge"],
  // DTD conditionally grants these keywords through its scripts.
  "blistering assault|1": [],
  "blistering assault|2": [],
  "blistering assault|3": [],
  "glaring impact|1": ["Charge"],
  "glaring impact|2": ["Charge"],
  "glaring impact|3": ["Charge"],
  "ram raider|1": ["Blood Debt"],
  "ram raider|2": ["Blood Debt"],
  "ram raider|3": ["Blood Debt"],
  "soul cleaver|1": ["Blood Debt"],
  "soul cleaver|2": ["Blood Debt"],
  "soul cleaver|3": ["Blood Debt"],
  "wall breaker|1": ["Blood Debt"],
  "wall breaker|2": ["Blood Debt"],
  "wall breaker|3": ["Blood Debt"],
  "luminaris, celestial fury|0": ["Instant"],
  // Bright Lights keywords granted only after their printed conditions hold.
  "hydraulic press|1": ["Scrap"],
  "hydraulic press|2": ["Scrap"],
  "hydraulic press|3": ["Scrap"],
  "soup up|1": ["Galvanize"],
  "soup up|2": ["Galvanize"],
  "soup up|3": ["Galvanize"],
  "torque tuned|1": ["Galvanize"],
  "torque tuned|2": ["Galvanize"],
  "torque tuned|3": ["Galvanize"],
  "bull bar|1": ["Boost"],
  "bull bar|2": ["Boost"],
  "bull bar|3": ["Boost"],
  // Photon Rush only GAINS go again after another Lightning card was played.
  "photon rush|1": ["Lightning Flow"],
  "photon rush|3": ["Lightning Flow"],
  // Log Fall only gains overpower when its Earth Bond condition is met.
  "log fall|1": ["Earth Bond"],
  "log fall|2": ["Earth Bond"],
  // These IAR attacks gain combat keywords only after their printed conditions hold.
  "ice aged oak|3": ["Ice Bond"],
  "tribute to greater power|1": ["Blood Debt"],
  // Drinking Buddy gains go again only if at least two heroes find an item.
  "drinking buddy|1": [],
  // Fluid Motion only GAINS go again if you've created a card this turn
  "fluid motion|3": [],
  // Second Tenet of Chi: Wind only GAINS go again if you've transcended this turn
  "second tenet of chi: wind|3": [],
  // MST Combo attacks gain go again only when the preceding attack matches.
  "aspect of tiger: body|1": ["Combo"],
  "aspect of tiger: soul|2": ["Combo"],
  "aspect of tiger: mind|3": ["Combo"],
  "breed anger|1": ["Combo"],
  "breed anger|2": ["Combo"],
  "breed anger|3": ["Combo"],
  // Spectral Rider only GAINS overpower if you control a Spectral Shield
  "spectral rider|3": ["Phantasm"],
  // Blaze Headlong only GAINS go again if you've played another red card this turn
  "blaze headlong|1": [],
  // Art of the Dragon: Blood only gains go again when the attack is Draconic.
  "art of the dragon: blood|1": [],
  // Display Loyalty only GAINS go again (and its Fealty trigger) if you control 2+ Draconic chain links
  "display loyalty|1": [],
  // Enflame the Firebrand only GAINS go again if you control 2+ Draconic chain links
  "enflame the firebrand|1": [],
  // Hot on Their Heels only GAINS go again (and its Mark trigger) if you control 2+ Draconic chain links
  "hot on their heels|1": ["Mark"],
  // Cinderskin Devotion only GAINS go again if you control 2+ Draconic chain links
  "cinderskin devotion|3": [],
  "cinderskin devotion|1": [],
  "cinderskin devotion|2": [],
  // UPR conditionally grants these keywords through their scripts.
  "lava vein loyalty|1": [],
  "lava vein loyalty|2": [],
  "lava vein loyalty|3": [],
  "burn away|1": [],
  "rise up|1": ["Dromai or Fai Specialization", "Rupture"],
  "stoke the flames|1": [],
  "trade in|1": [],
  "trade in|2": [],
  "trade in|3": [],
  // Dynasty keywords that are granted only when their printed condition is met.
  "aether quickening|1": ["Surge"],
  "aether quickening|2": ["Surge"],
  "blessing of focus|1": [],
  "blessing of focus|2": [],
  "blessing of focus|3": [],
  "drill shot|2": [],
  "drill shot|3": [],
  "madcap charger|1": [],
  "madcap charger|2": [],
  "madcap charger|3": [],
  "pouncing qi|1": ["Combo"],
  "pouncing qi|2": ["Combo"],
  "pouncing qi|3": ["Combo"],
  "quicksilver dagger|0": [],
  "spectral prowler|1": ["Phantasm"],
  "spectral prowler|2": ["Phantasm"],
  "spectral prowler|3": ["Phantasm"],
  "spectral rider|1": ["Phantasm"],
  "spectral rider|2": ["Phantasm"],
  // Bolt'n' Shot only GAINS go again (and its reload rider) while above its base {p}
  "bolt'n' shot|1": [],
  // Drill Shot only HAS piercing 1 while it has an aim counter
  "drill shot|1": [],
  // Swift Shot only GAINS go again when it is put face-up into the arsenal
  "swift shot|1": [],
  // Concoct Disorder only GAINS go again if 2+ cards are put into arsenals
  "concoct disorder|1": [],
  // Graphene Chelicera only GAINS go again when attacking a marked hero
  "graphene chelicera|0": ["Stealth"],
  "scuttle the canal|1": ["Stealth"],
  "scuttle the canal|2": ["Stealth"],
  "scuttle the canal|3": ["Stealth"],
  "demonstrate devotion|1": [],
  "burning blade dance|1": [],
  "mark with magma|1": ["Mark"],
  "grow wings|1": [],
  "grow wings|2": [],
  "grow wings|3": [],
  "march of loyalty|1": [],
  "cut through|1": [],
  "cut through|2": [],
  "cut through|3": [],
  // Runerager Swarm only GAINS go again after an aura was played or created
  "runerager swarm|1": [],
  // Zealous Belting only HAS go again while a higher-power card is in pitch
  "zealous belting|1": [],
  // ARC conditional go-again cards are tagged by the dataset but gain it only
  // when their printed condition is met.
  "life for a life|1": [],
  "life for a life|2": [],
  "life for a life|3": [],
  "fervent forerunner|1": ["Opt 2"],
  "fervent forerunner|2": ["Opt 2"],
  "fervent forerunner|3": ["Opt 2"],
  "vigor rush|1": [],
  "vigor rush|2": [],
  "vigor rush|3": [],
  "sun kiss|1": [],
  "sun kiss|2": [],
  "sun kiss|3": [],
  "sic 'em shot|1": [],
  "sic 'em shot|2": [],
  "sic 'em shot|3": [],
  // CRU conditional keywords are granted by scripts only after their printed
  // conditions are satisfied.
  "barraging big horn|1": [],
  "barraging big horn|2": [],
  "barraging big horn|3": [],
  "predatory assault|1": [],
  "predatory assault|2": [],
  "predatory assault|3": [],
  "rushing river|1": ["Combo"],
  "rushing river|2": ["Combo"],
  "rushing river|3": ["Combo"],
  "soulbead strike|1": [],
  "soulbead strike|2": [],
  "soulbead strike|3": [],
  "torrent of tempo|1": [],
  "torrent of tempo|2": [],
  "torrent of tempo|3": [],
  "meat and greet|1": [],
  "meat and greet|2": [],
  "meat and greet|3": [],
  "promise of plenty|1": [],
  "promise of plenty|2": [],
  "promise of plenty|3": [],
  // MON conditional keywords are granted by scripts only after their printed
  // conditions are satisfied.
  "battlefield blitz|1": [],
  "battlefield blitz|2": [],
  "battlefield blitz|3": [],
  "writhing beast hulk|1": ["Blood Debt"],
  "writhing beast hulk|2": ["Blood Debt"],
  "writhing beast hulk|3": ["Blood Debt"],
  "dread screamer|1": ["Blood Debt"],
  "dread screamer|2": ["Blood Debt"],
  "dread screamer|3": ["Blood Debt"],
  "rip through reality|1": ["Blood Debt"],
  "rip through reality|2": ["Blood Debt"],
  "rip through reality|3": ["Blood Debt"],
  "pulping|2": [],
  "pulping|3": [],
  "consuming aftermath|1": [],
  "consuming aftermath|2": [],
  "consuming aftermath|3": [],
  "out muscle|1": [],
  "out muscle|2": [],
  "out muscle|3": [],
  "seek horizon|1": [],
  "seek horizon|2": [],
  "seek horizon|3": [],
  "overload|1": ["Dominate"],
  "overload|2": ["Dominate"],
  "overload|3": ["Dominate"],
  "frontline scout|1": [],
  "frontline scout|2": [],
  "frontline scout|3": [],
  "pound for pound|1": [],
  "pound for pound|2": [],
  "pound for pound|3": [],
  "zealous belting|2": [],
  "zealous belting|3": [],
  // ELE conditional keywords are granted by scripts only after their printed
  // conditions are satisfied.
  "glacial footsteps|1": ["Ice Fusion"],
  "glacial footsteps|2": ["Ice Fusion"],
  "glacial footsteps|3": ["Ice Fusion"],
  "dazzling crescendo|1": ["Lightning Fusion"],
  "dazzling crescendo|2": ["Lightning Fusion"],
  "dazzling crescendo|3": ["Lightning Fusion"],
  "flake out|1": ["Ice Fusion"],
  "flake out|2": ["Ice Fusion"],
  "flake out|3": ["Ice Fusion"],
  "rites of lightning|1": ["Lightning Fusion"],
  "rites of lightning|2": ["Lightning Fusion"],
  "rites of lightning|3": ["Lightning Fusion"],
  "entwine ice|1": ["Ice Fusion"],
  "entwine ice|2": ["Ice Fusion"],
  "entwine ice|3": ["Ice Fusion"],
  "entwine lightning|2": ["Lightning Fusion"],
  "entwine lightning|3": ["Lightning Fusion"],
  "bolt'n' shot|2": [],
  "bolt'n' shot|3": [],
  "lightning surge|2": [],
  "lightning surge|3": [],
  "thump|1": [],
  "thump|2": [],
  "thump|3": [],
  // EVR conditional keywords are granted by scripts only when their printed
  // conditions are satisfied.
  "high roller|1": ["Go again"],
  "high roller|2": ["Go again"],
  "high roller|3": ["Go again"],
  "wild ride|3": [],
  "payload|1": [],
  "payload|2": [],
  "payload|3": [],
  "drowning dire|1": [],
  "drowning dire|2": [],
  "drowning dire|3": [],
  "life of the party|1": [],
  "life of the party|2": [],
  "life of the party|3": [],
  // HVY keywords that its scripts grant only after their printed conditions.
  "down but not out|1": [],
  "down but not out|2": [],
  "down but not out|3": [],
  "hot streak|0": [],
  "over the top|1": [],
  "over the top|2": [],
  "over the top|3": [],
  "performance bonus|1": [],
  "performance bonus|2": [],
  "performance bonus|3": [],
  "rising speed|1": [],
  "rising speed|2": [],
  "rising speed|3": [],
  "rawhide rumble|1": ["Beat Chest"],
  "rawhide rumble|2": ["Beat Chest"],
  "rawhide rumble|3": ["Beat Chest"],
};

/** Functional text errata keyed by card identity so every printing is current. */
const TEXT_OVERRIDES: Record<string, string> = {
  // Effective September 25, 2026 (Errata Bulletin, August 12, 2026).
  "levia|0": "If a card with 6 or more {p} has been put into your banished zone this turn, you don't lose {h} from blood debt during the end phase.",
  "levia, shadowborn abomination|0": "If a card with 6 or more {p} has been put into your banished zone this turn, you don't lose {h} from blood debt during the end phase.",
  "line crossers|0": "If you have the same {h} as another hero, it also counts as you having more {h} than them, and them having less {h} than you.\nBlade Break",
};

/**
 * Subtype corrections where the dataset omits a printed subtype. Keyed by
 * functional key so reprints inherit the override. The engine settles cards
 * with the aura subtype into the arena, so these matter for gameplay.
 */
const SUBTYPE_OVERRIDES: Record<string, string[]> = {
  "zen state|0": ["aura"],
  "quicken|0": ["aura"],
  "embodiment of earth|0": ["elemental", "aura"],
  "embodiment of lightning|0": ["elemental", "aura"],
  // Booze! is an Action - Aura; the dataset lists only the reviled subtype
  "booze!|3": ["reviled", "aura"],
  // Guardian Instant - Aura cards with Suspense; the dataset omits the aura subtype
  "act of glory|1": ["aura"],
  "edge of their seats|1": ["aura"],
  "edge of their seats|3": ["aura"],
  "tension in the air|1": ["aura"],
  "the suspense is killing me|3": ["aura"],
  // Might/Confidence are aura tokens
  "confidence|0": ["aura"],
  "might|0": ["aura"],
  // Ponder is an aura token
  "ponder|0": ["aura"],
  // Agility/Courage/Flurry are aura tokens
  "agility|0": ["aura"],
  "courage|0": ["aura"],
  "flurry|0": ["aura"],
  // Vigor is an aura token
  "vigor|0": ["aura"],
  // Seismic Surge is an aura token
  "seismic surge|0": ["aura"],
  // Spectral Shield is an aura token; the dataset omits the aura subtype
  "spectral shield|0": ["aura"],
  // Waning Vengeance / Waxing Specter are Instant - Aura cards
  "waning vengeance|1": ["aura"],
  "waxing specter|1": ["aura"],
  // Runeblade aura cards/tokens whose dataset records omit the aura subtype
  "malefic incantation|1": ["aura"],
  "malefic incantation|2": ["aura"],
  "runechant|0": ["aura"],
  "sigil of silphidae|3": ["aura"],
  // Original ARC action-aura records omit their aura subtype.
  "bloodspill invocation|1": ["aura"],
  "bloodspill invocation|2": ["aura"],
  "bloodspill invocation|3": ["aura"],
  "enchanting melody|1": ["aura"],
  "enchanting melody|2": ["aura"],
  "enchanting melody|3": ["aura"],
  // CRU Guardian Action - Aura cards; the source dataset omits the subtype.
  "towering titan|1": ["aura"],
  "towering titan|2": ["aura"],
  "towering titan|3": ["aura"],
  "emerging dominance|1": ["aura"],
  "emerging dominance|2": ["aura"],
  "emerging dominance|3": ["aura"],
  // Original WTR records omit the aura subtype present on later printings.
  "emerging power|1": ["aura"],
  "emerging power|2": ["aura"],
  "emerging power|3": ["aura"],
  "stonewall confidence|1": ["aura"],
  "stonewall confidence|2": ["aura"],
  "stonewall confidence|3": ["aura"],
  // Iyslander's prevention action and Frostbite token are auras
  "pyroglyphic protection|3": ["aura"],
  "frostbite|0": ["elemental", "aura"],
  // Original MON Light Illusionist action-aura records omit the aura subtype.
  "parable of humility|2": ["light", "aura"],
  "merciful retribution|2": ["light", "aura"],
  "ode to wrath|2": ["light", "aura"],
  // ELE action auras whose source records omit the aura subtype.
  "emerging avalanche|1": ["elemental", "aura"],
  "emerging avalanche|2": ["elemental", "aura"],
  "emerging avalanche|3": ["elemental", "aura"],
  "strength of sequoia|1": ["elemental", "aura"],
  "strength of sequoia|2": ["elemental", "aura"],
  "strength of sequoia|3": ["elemental", "aura"],
  "embolden|1": ["aura"],
  "embolden|2": ["aura"],
  "embolden|3": ["aura"],
  // EVR action auras omitted by the source dataset.
  "runeblood incantation|1": ["aura"],
  "runeblood incantation|2": ["aura"],
  "runeblood incantation|3": ["aura"],
  "pyroglyphic protection|1": ["aura"],
  "pyroglyphic protection|2": ["aura"],
  "haze bending|3": ["aura"],
  "passing mirage|3": ["aura"],
  "pierce reality|3": ["aura"],
  // Effective September 25, 2026: all printings of these tokens are Disease Auras.
  "bloodrot pox|0": ["disease", "aura"],
  "frailty|0": ["disease", "aura"],
  "inertia|0": ["disease", "aura"],
};

const rawCardList = decodeCardDataList([
  ...cardsAAC,
  ...cardsAHA,
  ...cardsAAZ,
  ...cardsAIO,
  ...cardsAJV,
  ...cardsAKO,
  ...cardsAOL,
  ...cardsASB,
  ...cardsAST,
  ...cardsAZS,
  ...cardsARC,
  ...cardsARR,
  ...cardsAPS,
  ...cardsCRU,
  ...cardsDVR,
  ...cardsELE,
  ...cardsMON,
  ...cardsOUT,
  ...cardsROS,
  ...cardsSEA,
  ...cardsSBA,
  ...cardsSBL,
  ...cardsSBZ,
  ...cardsSEN,
  ...cardsSFA,
  ...cardsSAZ,
  ...cardsSDO,
  ...cardsSAR,
  ...cardsSDA,
  ...cardsSGB,
  ...cardsSLY,
  ...cardsSVI,
  ...cardsSIY,
  ...cardsSBR,
  ...cardsSKA,
  ...cardsWTR,
  ...cardsEVR,
  ...cardsUPR,
  ...cardsDYN,
  ...cardsDTD,
  ...cardsEVO,
  ...cardsHVY,
  ...cardsHNT,
  ...cardsIAR,
  ...cardsMST,
  ...cardsAMO,
  ...cardsMPA,
  ...cardsMPG,
  ...cardsMPW,
  ...cardsOMN,
  ...cardsPEN,
  ...cardsSUP,
  ...cardsAMX,
  ...cardsAMA,
  ...cardsAGB,
  ...cardsASR,
  ...cardsAPR,
  ...cardsARK,
  ...cardsAUR,
  ...cardsAVS,
  ...cardsBDD,
  ...cardsBOL,
  ...cardsCHN,
  ...cardsDDD,
  ...cardsPSM,
  ...cardsTCC,
  ...cardsTER,
  // Reprint/promo synchronization stays after primary products so human-name
  // lookup continues to prefer the original set printing where one exists.
  ...cards1HP,
  ...cardsDRO,
  ...cardsLEV,
  ...cardsRNR,
  ...cardsRVD,
  ...cardsFAB,
  ...cardsLGS,
  ...cardsANQ,
  ...cardsARA,
  ...cardsAUA,
  ...cardsAZL,
  ...cardsBEN,
  ...cardsBET,
  ...cardsBRI,
  ...cardsBVO,
  ...cardsCIN,
  ...cardsCON,
  ...cardsENG,
  ...cardsFAI,
  ...cardsFLR,
  ...cardsFNG,
  ...cardsGEM,
  ...cardsHER,
  ...cardsIRA,
  ...cardsJDG,
  ...cardsKAT,
  ...cardsKSI,
  ...cardsKSU,
  ...cardsKYO,
  ...cardsLSS,
  ...cardsLXI,
  ...cardsNUU,
  ...cardsOLA,
  ...cardsOLD,
  ...cardsOSC,
  ...cardsOXO,
  ...cardsRHI,
  ...cardsRIP,
  ...cardsTEA,
  ...cardsTNP,
  ...cardsUZU,
  ...cardsVER,
  ...cardsVIC,
  ...cardsWIN,
  ...cardsWOD,
  ...cardsXXX,
  ...cardsZEN,
], "packages/cards/src/data/cards");

export const cardList = rawCardList.map((c) => {
  const key = functionalKeyOf(c);
  const keywords = KEYWORD_OVERRIDES[key];
  const subtypes = SUBTYPE_OVERRIDES[key];
  const text = TEXT_OVERRIDES[key];
  if (!keywords && !subtypes && !text) return c;
  return {
    ...c,
    ...(keywords ? { keywords } : {}),
    ...(subtypes ? { subtypes } : {}),
    ...(text ? { text } : {}),
  };
});

export const cardData: Record<string, CardData> = Object.fromEntries(
  cardList.map((c) => [c.id, c]),
);

/** Validate a game's presented deck against its registered pool. */
export function validatePresentation(
  pool: DeckPool,
  presented: PresentedDeck,
  format: Format,
  options: { allowFutureCards?: boolean } = {},
) {
  return validatePresentationAgainstCards(cardData, pool, presented, format, options);
}

/**
 * Dev-time consistency check: printings sharing a functional identity should
 * agree on functional fields. Kept out of module load (this package ships in
 * the browser client bundle) — invoked from __tests__/printings.test.ts.
 */
export function warnOnInconsistentPrintings(printings: CardData[]): void {
  const groups = new Map<string, CardData[]>();
  for (const c of printings) {
    const key = functionalKeyOf(c);
    const group = groups.get(key);
    if (group) group.push(c);
    else groups.set(key, [c]);
  }
  const FIELDS = ["pitch", "cost", "attack", "defense", "cardType", "classes", "subtypes", "keywords"] as const;
  for (const [key, group] of groups) {
    if (group.length < 2) continue;
    const first = group[0]!;
    for (const other of group.slice(1)) {
      for (const field of FIELDS) {
        if (JSON.stringify(first[field]) !== JSON.stringify(other[field])) {
          console.warn(
            `[cards] inconsistent "${field}" for functional key "${key}": ${first.id} vs ${other.id}`,
          );
        }
      }
    }
  }
}

// ── Human-name lookup (decklist import) ─────────────────────────────────────

/** Normalize a card name for human-provided input matching (decklist exports).
 *  Split cards are written "A // B" in our data; exports also use "A//B" or
 *  "A||B" — all normalize to the same key. Diacritics and Icelandic eth are
 *  folded to keyboard-friendly ASCII so exports such as "Jarl Vetreidi" still
 *  match the printed name "Jarl Vetreiði". */
export function normalizeCardName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ð/g, "d")
    .replace(/\s*(?:\/\/|\|\|)\s*/g, " // ")
    .replace(/\s+/g, " ");
}

const byFunctionalKey = new Map<string, CardData>();
const byName = new Map<string, CardData[]>();
for (const c of cardList) {
  const n = normalizeCardName(c.name);
  const key = functionalKey(n, c.pitch);
  if (!byFunctionalKey.has(key)) byFunctionalKey.set(key, c);
  const group = byName.get(n);
  if (group) group.push(c);
  else byName.set(n, [c]);
}

/**
 * Resolve a human-provided card name (e.g. from a Fabrary export) to a
 * printing in our data pool. Pitch (1/2/3) disambiguates color variants;
 * without pitch, returns the first printing in pool order. Scripts are
 * functional-keyed, so any printing of a card plays identically.
 */
export function findPrinting(name: string, pitch?: number): CardData | undefined {
  const n = normalizeCardName(name);
  if (pitch !== undefined) {
    const exact = byFunctionalKey.get(functionalKey(n, pitch));
    if (exact) return exact;
  }
  return byName.get(n)?.[0];
}

type Decklists = {
  dorinthea: Decklist;
  rhinar: Decklist;
};

export const decklists = rawDecklists as Decklists;

/**
 * The fixed Classic Battles box list for a hero in `DeckPool` shape, so the
 * prep room can present it exactly like a registered user deck.
 */
export function deckPoolForHero(hero: HeroId): DeckPool {
  const dl = decklists[hero];
  return {
    heroId: dl.heroId,
    weaponIds: [...dl.weaponIds],
    equipmentPool: Object.values(dl.equipment).filter((id): id is string => !!id),
    deck: [...dl.deck],
    sideboard: [],
  };
}

/**
 * Hardcoded official precon pools and internal bot lists (see
 * data/precons.json). Player precons are available in their declared format
 * anywhere a saved-deck id is accepted; bot-only lists resolve server-side
 * but are omitted from the player catalog.
 */
export interface Precon {
  id: string;
  name: string;
  format: "cc" | "silver-age";
  pool: DeckPool;
  /** Internal practice-opponent lists resolve like fixed decks but are not
   * offered as free player precons. */
  botOnly?: true;
}

const rawPrecons = rawPreconsJson as unknown as Record<string, {
  name: string;
  format?: "cc" | "silver-age";
  pool: DeckPool;
  botOnly?: true;
}>;

export const precons: Precon[] = Object.entries(rawPrecons)
  .filter(([id]) => !id.startsWith("_"))
  .map(([id, p]) => ({
    id,
    name: p.name,
    format: p.format ?? "silver-age",
    pool: p.pool,
    ...(p.botOnly === true ? { botOnly: true as const } : {}),
  }));

export type SilverAgePrecon = Precon;

export const silverAgePrecons: SilverAgePrecon[] = precons.filter(
  (precon) => precon.format === "silver-age" && precon.botOnly !== true,
);

export function preconsForFormat(
  format: "cc" | "silver-age",
  options: { allowFutureCards?: boolean } = {},
): Precon[] {
  return precons.filter(
    (precon) =>
      precon.format === format &&
      precon.botOnly !== true &&
      formatLegalityIssues(cardData, precon.pool, precon.format, options).length === 0,
  );
}

export function precon(id: string): Precon | null {
  return precons.find((candidate) => candidate.id === id) ?? null;
}

/** Look up a silver-age precon by its deck id ("precon-sba" …); null for user decks. */
export function silverAgePrecon(id: string): SilverAgePrecon | null {
  return silverAgePrecons.find((p) => p.id === id) ?? null;
}
