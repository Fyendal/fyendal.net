import { execFileSync } from "node:child_process";

// tsx reexecutes this entry on every restart, before loading the runtime ID.
execFileSync("pnpm", ["--workspace-root", "generate:bot-runtime"], { stdio: "inherit" });
await import("./index.js");
