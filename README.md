# Finance K

A local-first month-end net-worth tracker for one person with accounts in several currencies (EUR, USD, RUB, crypto). Data stays in a SQLite file on this Mac.

## Quick start

```
git clone https://github.com/zaitsew/finance-k && cd finance-k
npm install
npm run dev
open http://127.0.0.1:4817        # first run: "Add your first account"
./check.sh                        # typecheck, tests, production build
```

Needs Node 24 or newer (it uses the built-in `node:sqlite`). `npm start` serves the production build on the same address after `npm run build`.

## What it does

- Keeps a registry of accounts (bank, broker, exchange, wallet, cash, pension) and the positions in each: cash in a currency, or a crypto or security asset.
- Records month-end snapshots in one "Close the month" screen. The last value is prefilled, past months stay editable, and saving twice never duplicates a row.
- Fetches rates when you ask: ECB (EUR base), Bank of Russia for RUB, CoinGecko for crypto. Securities are priced by hand. Rates are cached by date.
- Shows a monthly summary: net worth, the change split into flows, market moves and FX, totals by kind, currency and institution, a 12-month line, dormant accounts, new and closed accounts, and accounts not closed yet (never counted as zero).
- Links to BankJar's savings leaderboard when idle EUR cash passes a threshold (default 2,000 EUR, a setting). It may show BankJar's top offer from its public API; a failure is silent.
- Exports and imports the whole store as versioned JSON (Settings). Import is validated and runs in one transaction.

## What it doesn't do

- It does not move money or connect to a bank.
- It does not store full IBANs (last 4 digits only) or any bank password.
- The MCP server sends nothing anywhere. The app itself sends nothing except the rate APIs (ECB, Bank of Russia, CoinGecko) and one public, user-data-free GET to BankJar's offers API.
- It binds to 127.0.0.1 only and rejects requests whose Host header is not loopback.

## Ask Claude or Codex about your balances

`finance-k mcp` is a local, read-only MCP server over the same SQLite file: accounts, balances at a month end, month-over-month changes, net worth by currency. No write tools, no network, no hosted version. See [plugins/finance-k/README.md](plugins/finance-k/README.md) and [docs/PRIVACY.md](docs/PRIVACY.md).

```
/plugin marketplace add zaitsew/finance-k          # in Claude Code
/plugin install finance-k@finance-k
codex mcp add finance-k -- node "$PWD/plugins/finance-k/server/finance-k.mjs" mcp   # Codex, from a clone
```

## Setup (env)

Both variables are optional; see `.env.example`.

| variable | default | meaning |
|---|---|---|
| `FINANCE_K_DATA_DIR` | `~/Library/Application Support/finance-k` | where `finance-k.sqlite` lives (never inside the repo) |
| `FINANCE_K_IDLE_CASH_EUR` | `2000` | idle-cash threshold in EUR; the Settings value overrides it |

## Usage probe

`./check.sh usage` prints `accounts_open`, `accounts_closed`, `months_closed` and `last_closed_month` from the local database, or `usage_probe=no_db`.

## Layout

- `src/core/` pure domain code: decimals, money, delta split, summary, dormant detection, schemas
- `src/server/` SQLite, numbered migrations, repository, rates client, server actions, export/import
- `app/`, `components/` the Next.js UI
- `mcp/` the MCP server; `plugins/finance-k/` the Claude plugin bundle (`npm run build:mcp` rebuilds `server/finance-k.mjs`); `.claude-plugin/marketplace.json`
- `tests/` vitest, with trimmed real rate payloads in `tests/fixtures/`

## Status

Sprint 1 (registry, month-end snapshots, rates, monthly summary, export/import). See `docs/ROADMAP.md`.

## Licence

See `LICENSE`.
