# Finance K for Claude

A local, read-only MCP server for [Finance K](https://github.com/zaitsew/finance-k), the month-end net-worth tracker that keeps your data in a SQLite file on your Mac. Claude can answer questions about your own accounts and balances. The server has no write tools, makes no network calls and never moves money. Your data never leaves the machine.

## Install in Claude Code

```
/plugin marketplace add zaitsew/finance-k
/plugin install finance-k@finance-k
```

Needs Node 24 or newer (`node:sqlite`) and a Finance K database. By default the server reads `~/Library/Application Support/finance-k/finance-k.sqlite`. To read another folder, set `FINANCE_K_DATA_DIR`.

## Install in Codex

```
git clone https://github.com/zaitsew/finance-k
codex mcp add finance-k -- node "$PWD/finance-k/plugins/finance-k/server/finance-k.mjs" mcp
```

Add `--env FINANCE_K_DATA_DIR=/path/to/folder` before the `--` to use a different folder.

## Tools

All four are read-only (`readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`).

| tool | answers |
|---|---|
| `list_accounts` | which accounts exist, their positions, status and latest close; which months have a close |
| `get_balances` | each position's balance at a month end, native and EUR, and the net worth total |
| `get_monthly_changes` | net worth against the month before; the change split into market, FX and flows |
| `get_net_worth_by_currency` | net worth by currency or asset, native total, EUR value and share |

## Try it with made-up data

```
git clone https://github.com/zaitsew/finance-k && cd finance-k && npm install
npm run fixture -- /tmp/finance-k-demo
claude mcp add finance-k --env FINANCE_K_DATA_DIR=/tmp/finance-k-demo -- node "$PWD/plugins/finance-k/server/finance-k.mjs" mcp
```

## Privacy

See [docs/PRIVACY.md](../../docs/PRIVACY.md). In short: the server opens the SQLite file read-only, answers over stdio to the app that started it, and contains no network code. What Claude does with the answers is governed by your Claude plan, not by this plugin.

Licence: Apache-2.0.
