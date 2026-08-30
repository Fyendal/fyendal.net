import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url);
const limitations = JSON.parse(await readFile(new URL("docs/rules-limitations.json", root), "utf8"));
if (!Array.isArray(limitations)) throw new Error("rules limitations register must be an array");
const requiredKeys = ["expected", "id", "implemented", "source", "testFile", "testName"];
for (const [index, entry] of limitations.entries()) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`rules limitation at index ${index} must be an object`);
  }
  const keys = Object.keys(entry).sort();
  if (keys.join("\0") !== requiredKeys.join("\0")) {
    throw new Error(`${entry.id ?? `entry ${index}`}: expected exact keys ${requiredKeys.join(", ")}`);
  }
  if (!/^FYD-RULE-\d{3}$/.test(entry.id)) {
    throw new Error(`${entry.id ?? `entry ${index}`}: invalid rules limitation id`);
  }
  for (const key of ["source", "expected", "testFile", "testName"]) {
    if (typeof entry[key] !== "string" || !entry[key].trim()) {
      throw new Error(`${entry.id}: ${key} must be a non-empty string`);
    }
  }
  if (entry.implemented !== false) {
    throw new Error(`${entry.id}: tracked limitations must remain failing`);
  }
}
const registered = new Map(limitations.map((entry) => [entry.id, entry]));
if (registered.size !== limitations.length) throw new Error("duplicate rules limitation id");

async function sourceFiles(directory) {
  const entries = await readdir(new URL(directory, root), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(`${path}/`));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

const engineFiles = await sourceFiles("packages/engine/src/");
const sourcePaths = [
  ...engineFiles.filter((file) => !file.includes("/__tests__/")),
  ...await sourceFiles("packages/cards/src/scripts/"),
];
const testPaths = [
  ...engineFiles.filter((file) => file.includes("/__tests__/")),
  ...await sourceFiles("packages/cards/src/__tests__/"),
];
const sourcePathSet = new Set(sourcePaths);
const testPathSet = new Set(testPaths);
const seen = new Set();
const annotation = /\bFYD-RULE-\d{3}\b/g;
const untrackedLanguage = /TODO\s*\(\s*engine\s*\)|\bapproximations?\b|\bsimplifications?\b|\bnot supported\b|\bunsupported\b|\bincomplete\b|\bnot yet implemented\b/i;
const staleHeading = /\b(?:registered|tracked)\b[^\r\n"']*\blimitations?\b/i;

for (const file of [...sourcePaths, ...testPaths]) {
  const text = await readFile(new URL(file, root), "utf8");
  const isSource = sourcePathSet.has(file);
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const ids = line.match(annotation) ?? [];
    if (isSource && untrackedLanguage.test(line) && ids.length === 0) {
      throw new Error(`${file}:${index + 1}: rules limitation lacks a FYD-RULE issue id`);
    }
    if (!isSource && staleHeading.test(line)) {
      throw new Error(`${file}:${index + 1}: stale rules-limitation test heading`);
    }
    for (const id of ids) {
      const entry = registered.get(id);
      if (!entry) throw new Error(`${file}:${index + 1}: ${id} is not in the limitations register`);
      if (entry.testFile === file) continue;
      if (!isSource || entry.source !== file) {
        throw new Error(`${file}:${index + 1}: ${id} is registered to ${entry.source}`);
      }
      seen.add(id);
    }
  }
}

for (const [id, entry] of registered) {
  if (!sourcePathSet.has(entry.source)) {
    throw new Error(`${id}: registered source file does not exist or is not an engine/card-script source: ${entry.source}`);
  }
  if (!testPathSet.has(entry.testFile)) {
    throw new Error(`${id}: focused test file does not exist or is outside the engine/card test suites: ${entry.testFile}`);
  }
  if (!seen.has(id)) throw new Error(`${id}: register entry has no annotation in ${entry.source}`);
  let testText;
  try {
    testText = await readFile(new URL(entry.testFile, root), "utf8");
  } catch {
    throw new Error(`${id}: focused test file does not exist: ${entry.testFile}`);
  }
  if (!testText.includes(id)) {
    throw new Error(`${id}: focused test file does not mention the rule id`);
  }
  if (!testText.includes(`it.fails("${entry.testName}"`)) {
    throw new Error(`${id}: focused test is not an it.fails specification named ${JSON.stringify(entry.testName)}`);
  }
}

console.log(`rules limitations: ${registered.size} registered and annotated`);
