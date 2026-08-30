#!/usr/bin/env node
import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCardImageUrl } from "../apps/client/src/game/cardImageUrl.ts";

const DEFAULT_DELAY_MS = 500;
const MINIMUM_DELAY_MS = 250;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 3;
const CHECKPOINT_SCHEMA_VERSION = 1;
const NON_TTY_PROGRESS_INTERVAL = 25;
const root = fileURLToPath(new URL("../", import.meta.url));
const dataDirectory = join(root, "packages/cards/src/data/cards");
const checkpointDirectory = join(root, ".cache/card-image-checks");

function usage() {
  console.log(`Usage: pnpm check:card-images [options]

Checks every client card-image URL with sequential HEAD requests.

Options:
  --set CODE       Check one set only (may be repeated)
  --delay-ms N     Delay between requests (default ${DEFAULT_DELAY_MS}, minimum ${MINIMUM_DELAY_MS})
  --timeout-ms N   Per-request timeout (default ${DEFAULT_TIMEOUT_MS})
  --limit N        Check only the first N resolved URLs (useful for a smoke test)
  --checkpoint P   Override the automatic checkpoint path
  --status         Show checkpoint progress without making network requests
  --fresh          Discard the matching checkpoint and start again
  --help           Show this help`);
}

function positiveInteger(value, option) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${option} requires a positive integer`);
  }
  return parsed;
}

function parseArguments(args) {
  const options = {
    delayMs: DEFAULT_DELAY_MS,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    limit: undefined,
    checkpoint: undefined,
    fresh: false,
    status: false,
    sets: new Set(),
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--help") {
      usage();
      process.exit(0);
    }
    if (argument === "--fresh") {
      options.fresh = true;
      continue;
    }
    if (argument === "--status") {
      options.status = true;
      continue;
    }
    if (!["--set", "--delay-ms", "--timeout-ms", "--limit", "--checkpoint"].includes(argument)) {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = args[++index];
    if (value === undefined) throw new Error(`${argument} requires a value`);
    if (argument === "--set") options.sets.add(value.toUpperCase());
    else if (argument === "--delay-ms") options.delayMs = positiveInteger(value, argument);
    else if (argument === "--timeout-ms") options.timeoutMs = positiveInteger(value, argument);
    else if (argument === "--limit") options.limit = positiveInteger(value, argument);
    else if (argument === "--checkpoint") options.checkpoint = resolve(value);
  }
  if (options.delayMs < MINIMUM_DELAY_MS) {
    throw new Error(`--delay-ms must be at least ${MINIMUM_DELAY_MS} to protect Fabrary's CDN`);
  }
  if (options.fresh && options.status) throw new Error("--fresh and --status cannot be used together");
  return options;
}

function decodeCards(value, file) {
  if (!Array.isArray(value)) throw new Error(`${file}: expected a card array`);
  return value.map((card, index) => {
    if (card === null || typeof card !== "object" || Array.isArray(card)) {
      throw new Error(`${file}[${index}]: expected a card object`);
    }
    if (typeof card.id !== "string" || !card.id) {
      throw new Error(`${file}[${index}]: id must be a non-empty string`);
    }
    if (typeof card.name !== "string" || !card.name) {
      throw new Error(`${file}[${index}]: name must be a non-empty string`);
    }
    if (typeof card.cardType !== "string" || !card.cardType) {
      throw new Error(`${file}[${index}]: cardType must be a non-empty string`);
    }
    if (card.pitch !== undefined && (!Number.isSafeInteger(card.pitch) || card.pitch < 0)) {
      throw new Error(`${file}[${index}]: pitch must be a non-negative safe integer`);
    }
    return card;
  });
}

async function loadCards(selectedSets) {
  const files = (await readdir(dataDirectory))
    .filter((file) => file.endsWith(".json"))
    .filter((file) => selectedSets.size === 0 || selectedSets.has(file.slice(0, -5).toUpperCase()))
    .sort();
  if (selectedSets.size > 0) {
    const found = new Set(files.map((file) => file.slice(0, -5).toUpperCase()));
    const missing = [...selectedSets].filter((set) => !found.has(set));
    if (missing.length > 0) throw new Error(`unknown set code(s): ${missing.join(", ")}`);
  }
  const cards = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dataDirectory, file), "utf8"));
    cards.push(...decodeCards(raw, file));
  }
  return cards;
}

function retryAfterMilliseconds(response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function defaultCheckpointPath(options) {
  const scope = options.sets.size > 0 ? [...options.sets].sort().join("-") : "all";
  const limit = options.limit === undefined ? "" : `-limit-${options.limit}`;
  return join(checkpointDirectory, `${scope}${limit}.checkpoint`);
}

function checkpointFingerprint(urls) {
  return createHash("sha256").update(urls.join("\n")).digest("hex");
}

function decodeCheckpointHeader(value, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path}: invalid checkpoint header`);
  }
  if (value.schemaVersion !== CHECKPOINT_SCHEMA_VERSION || typeof value.fingerprint !== "string") {
    throw new Error(`${path}: unsupported checkpoint format; rerun with --fresh`);
  }
  return value;
}

function isMissingFileError(error) {
  return error && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function readCheckpoint(path, urls) {
  const fingerprint = checkpointFingerprint(urls);
  const currentUrls = new Set(urls);
  try {
    const lines = (await readFile(path, "utf8")).split(/\r?\n/);
    const header = decodeCheckpointHeader(JSON.parse(lines[0]), path);
    const completedUrls = new Set(lines.slice(1).filter((url) => currentUrls.has(url)));
    if (header.fingerprint !== fingerprint) return { state: "stale", completedUrls };
    return {
      state: "current",
      completedUrls,
    };
  } catch (error) {
    if (isMissingFileError(error)) return { state: "missing", completedUrls: new Set() };
    throw error;
  }
}

async function initializeCheckpoint(path, urls, fresh) {
  if (!fresh) {
    const checkpoint = await readCheckpoint(path, urls);
    if (checkpoint.state === "current") return checkpoint.completedUrls;
    if (checkpoint.state === "stale") {
      console.log(
        `Updating stale checkpoint ${relative(root, path)} because the URL list changed; ` +
        `retaining ${checkpoint.completedUrls.size} compatible successful check(s).`,
      );
      await mkdir(dirname(path), { recursive: true });
      const header = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, fingerprint: checkpointFingerprint(urls) };
      const completed = [...checkpoint.completedUrls];
      await writeFile(path, `${JSON.stringify(header)}\n${completed.join("\n")}${completed.length ? "\n" : ""}`, "utf8");
      return checkpoint.completedUrls;
    }
  }
  await mkdir(dirname(path), { recursive: true });
  const header = { schemaVersion: CHECKPOINT_SCHEMA_VERSION, fingerprint: checkpointFingerprint(urls) };
  await writeFile(path, `${JSON.stringify(header)}\n`, "utf8");
  return new Set();
}

function percentage(completed, total) {
  return total === 0 ? "100.0" : (completed / total * 100).toFixed(1);
}

function compactDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1_000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${totalMinutes}m ${seconds}s`;
  return `${seconds}s`;
}

function createProgressReporter(total, initiallyCompleted) {
  const startedAt = Date.now();
  let latestState;
  let previousLineLength = 0;

  function progressLine(state) {
    const elapsed = Date.now() - startedAt;
    const completedThisRun = state.processed - initiallyCompleted;
    const eta = completedThisRun > 0
      ? compactDuration(elapsed / completedThisRun * (total - state.processed))
      : "calculating";
    return (
      `${percentage(state.processed, total)}% | ${state.processed}/${total} processed | ` +
      (state.current ? `${state.current} | ` : "") +
      `${state.successful} ok | ${state.failures} failed | ${total - state.processed} remaining | ` +
      `elapsed ${compactDuration(elapsed)} | ETA ${eta}`
    );
  }

  function renderLiveLine() {
    if (!latestState) return;
    const line = progressLine(latestState);
    const maximumLength = Math.max(20, (process.stdout.columns ?? 160) - 1);
    const visible = line.length > maximumLength ? `${line.slice(0, maximumLength - 1)}…` : line;
    process.stdout.write(`\r${visible.padEnd(Math.max(previousLineLength, visible.length), " ")}`);
    previousLineLength = visible.length;
  }

  const timer = process.stdout.isTTY
    ? setInterval(renderLiveLine, 1_000).unref()
    : undefined;

  return {
    update(state, requestFinished = false) {
      latestState = state;
      if (process.stdout.isTTY) renderLiveLine();
      else if (
        requestFinished &&
        (state.processed % NON_TTY_PROGRESS_INTERVAL === 0 || state.processed === total)
      ) {
        console.log(`Status: ${progressLine(state)}`);
      }
    },
    finish() {
      if (timer) clearInterval(timer);
      if (process.stdout.isTTY && latestState) process.stdout.write("\n");
    },
  };
}

async function probe(url, timeoutMs) {
  let lastFailure = "request did not run";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "user-agent": "Fyendal card-image audit (sequential HEAD requests)" },
      });
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.toLowerCase().startsWith("image/")) return undefined;
      lastFailure = `HTTP ${response.status}${contentType ? ` (${contentType})` : ""}`;
      const transient = response.status === 429 || response.status >= 500;
      if (!transient || attempt === MAX_RETRIES) return lastFailure;
      const serverDelay = retryAfterMilliseconds(response) ?? 0;
      const backoff = response.status === 429 ? 30_000 * 2 ** attempt : 2_000 * 2 ** attempt;
      await wait(Math.max(serverDelay, backoff));
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt === MAX_RETRIES) return lastFailure;
      await wait(2_000 * 2 ** attempt);
    }
  }
  return lastFailure;
}

const options = parseArguments(process.argv.slice(2));
const cards = await loadCards(options.sets);
const cardsByUrl = new Map();
const seenIds = new Set();
for (const card of cards) {
  if (seenIds.has(card.id)) throw new Error(`duplicate printing id: ${card.id}`);
  seenIds.add(card.id);
  const url = resolveCardImageUrl(card.id, card);
  const entries = cardsByUrl.get(url) ?? [];
  entries.push({ id: card.id, name: card.name });
  cardsByUrl.set(url, entries);
}

let urls = [...cardsByUrl.keys()].sort();
if (options.limit !== undefined) urls = urls.slice(0, options.limit);
const checkpointPath = options.checkpoint ?? defaultCheckpointPath(options);
if (options.status) {
  const checkpoint = await readCheckpoint(checkpointPath, urls);
  const completed = checkpoint.completedUrls.size;
  console.log(`Checkpoint: ${relative(root, checkpointPath)}`);
  if (checkpoint.state === "stale") {
    console.log(
      `Status: stale checkpoint (the resolved URL list changed); ` +
      `${completed}/${urls.length} compatible successes will be retained on the next run.`,
    );
  } else {
    console.log(
      `Status: ${completed}/${urls.length} successful (${percentage(completed, urls.length)}%); ` +
      `${urls.length - completed} remaining.`,
    );
  }
  process.exit(0);
}
const completedUrls = await initializeCheckpoint(checkpointPath, urls, options.fresh);
const remainingUrlCount = urls.length - completedUrls.size;
const pacingMilliseconds = Math.max(0, remainingUrlCount - 1) * options.delayMs;
const pacingDuration = pacingMilliseconds < 60_000
  ? `${Math.ceil(pacingMilliseconds / 1_000)} second(s)`
  : `${Math.ceil(pacingMilliseconds / 60_000)} minute(s)`;
console.log(
  `Checking ${remainingUrlCount}/${urls.length} remaining image URL(s) for ${cards.length} printing(s), sequentially at ` +
  `one request every ${options.delayMs}ms (at least ${pacingDuration}, plus network time).`,
);
if (completedUrls.size > 0) {
  console.log(`Resumed ${completedUrls.size} successful check(s) from ${relative(root, checkpointPath)}.`);
}

const failures = [];
let requestsMade = 0;
const progress = createProgressReporter(urls.length, completedUrls.size);
for (const url of urls) {
  if (completedUrls.has(url)) continue;
  if (requestsMade > 0) await wait(options.delayMs);
  const currentCard = cardsByUrl.get(url)?.[0];
  const currentLabel = currentCard ? `checking ${currentCard.id} ${currentCard.name}` : `checking ${url}`;
  progress.update({
    processed: completedUrls.size + failures.length,
    successful: completedUrls.size,
    failures: failures.length,
    current: currentLabel,
  });
  const failure = await probe(url, options.timeoutMs);
  requestsMade++;
  if (failure) failures.push({ url, failure, cards: cardsByUrl.get(url) });
  else {
    await appendFile(checkpointPath, `${url}\n`, "utf8");
    completedUrls.add(url);
  }
  const processed = completedUrls.size + failures.length;
  progress.update({
    processed,
    successful: completedUrls.size,
    failures: failures.length,
    current: `${failure ? "failed" : "checked"} ${currentCard?.id ?? url}`,
  }, true);
}
progress.finish();

if (failures.length > 0) {
  console.error(`\nCard image check failed for ${failures.length} URL(s):`);
  for (const failure of failures) {
    const labels = failure.cards.map((card) => `${card.id} ${card.name}`).join(", ");
    console.error(`  ${labels}: ${failure.failure}\n    ${failure.url}`);
  }
  process.exit(1);
}

await unlink(checkpointPath);
console.log(`All ${urls.length} card image URL(s) loaded successfully.`);
