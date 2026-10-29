#!/usr/bin/env bash
# The first-run check: prints what's missing, verifies the toolchain, runs
# tests if any exist. Exits non-zero with a clear list if something is wrong.
#
#   ./check.sh
set -uo pipefail
cd "$(dirname "$0")"

# --- usage mode: real-usage counters, read by `teyla products` --------------
# Print key=value lines from the product's own store: rows logged, messages
# sent, sessions this week, active users. Zero is a finding, not an error.
# What to count per tier: templates/analytics/STANDARD.md in Teyla's repo. A
# Supabase product reads its counters with: teyla probe-sql <ref> "select …"
case "${1:-}" in
  usage)
    if [ -d node_modules ]; then
      npm run -s usage 2>/dev/null || echo "usage_probe=no_db"
    else
      echo "usage_probe=not_installed"
    fi
    exit 0 ;;
esac

missing=()
warnings=()

# --- env vars listed in .env.example -----------------------------------
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
if [ -f .env.example ]; then
  while IFS= read -r line; do
    case "$line" in
      \#*|"") continue ;;
    esac
    var="${line%%=*}"
    [ -z "$var" ] && continue
    if [ -z "${!var:-}" ]; then
      missing+=("env: $var (see .env.example)")
    fi
  done < .env.example
fi

# --- toolchain -----------------------------------------------------------
if [ -f package.json ]; then
  command -v node >/dev/null 2>&1 || missing+=("toolchain: node (package.json present)")
  command -v npm  >/dev/null 2>&1 || missing+=("toolchain: npm (package.json present)")
fi
if [ -f pyproject.toml ] || [ -f requirements.txt ]; then
  command -v python3 >/dev/null 2>&1 || missing+=("toolchain: python3")
fi
if [ -f Package.swift ] || ls -- *.xcodeproj >/dev/null 2>&1; then
  command -v swift >/dev/null 2>&1 || missing+=("toolchain: swift")
fi
if [ -f Cargo.toml ]; then
  command -v cargo >/dev/null 2>&1 || missing+=("toolchain: cargo")
fi

if [ "${#missing[@]}" -gt 0 ]; then
  echo "MISSING:"
  for m in "${missing[@]}"; do echo "  - $m"; done
  exit 1
fi

# --- tests, if any exist ---------------------------------------------------
ran_tests=0
if [ -f package.json ] && command -v npm >/dev/null 2>&1; then
  [ -d node_modules ] || { echo "MISSING:"; echo "  - run npm install first"; exit 1; }
  npm run -s typecheck || { echo "typecheck FAILED"; exit 1; }
  npm test && ran_tests=1 || { echo "npm test FAILED"; exit 1; }
  # The plugin ships a committed bundle of mcp/; it must match the source.
  npm run -s build:mcp || { echo "build:mcp FAILED"; exit 1; }
  git diff --quiet -- plugins/finance-k/server || { echo "plugins/finance-k/server/finance-k.mjs is stale: commit the output of npm run build:mcp"; exit 1; }
  npm run -s build >/dev/null 2>&1 || { echo "next build FAILED (run npm run build)"; exit 1; }
fi
if [ -f pyproject.toml ] && command -v python3 >/dev/null 2>&1; then
  if python3 -m pytest --version >/dev/null 2>&1; then
    python3 -m pytest -q && ran_tests=1 || { echo "pytest FAILED"; exit 1; }
  fi
fi
if [ -f Package.swift ] && command -v swift >/dev/null 2>&1; then
  swift build && swift test && ran_tests=1 || { echo "swift test FAILED"; exit 1; }
fi

if [ "$ran_tests" -eq 0 ]; then
  warnings+=("no test runner found — nothing was actually run")
fi

echo "OK"
for w in ${warnings[@]+"${warnings[@]}"}; do echo "  note: $w"; done
exit 0
