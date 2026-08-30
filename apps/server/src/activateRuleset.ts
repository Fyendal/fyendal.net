import { createPool } from "./db.js";
import { activateRuleset } from "./rulesetFence.js";

const rulesetVersion = process.env.RULESET_VERSION;
if (!rulesetVersion) throw new Error("RULESET_VERSION is required");

const db = await createPool();
try {
  const deleted = await activateRuleset(db, rulesetVersion);
  console.log(`activated ruleset ${rulesetVersion}; invalidated ${deleted.length} incompatible room(s)`);
} finally {
  await db.end();
}
