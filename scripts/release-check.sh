#!/usr/bin/env bash
# The exact local/CI deployment gate. Dependency installation is deliberately
# outside this script so CI can enforce --frozen-lockfile first.
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  : "${VITE_API_ORIGIN:?VITE_API_ORIGIN is required for a production build}"
fi

pnpm check:rules-limitations
# VITE_API_ORIGIN is production build configuration. Keep tests deterministic
# against their local-development fallback without removing it from the shell
# that runs the production build below.
env -u VITE_API_ORIGIN pnpm -r test
pnpm -r typecheck
pnpm lint
pnpm audit --audit-level=high
pnpm -r build
