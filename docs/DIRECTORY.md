# Claude plugin directory: submission pack

Submitting is the owner's step (one new directory submission a day). Everything below is ready to paste.

- **Kind:** plugin bundle from a public GitHub repo, with a local stdio MCP server. Not a remote connector.
- **Repo:** https://github.com/zaitsew/finance-k (public), marketplace at `.claude-plugin/marketplace.json`, plugin at `plugins/finance-k/`.
- **Name:** Finance K
- **One line:** Ask Claude about your own accounts, month-end balances, month-over-month changes and net worth by currency, from a SQLite file on your Mac.
- **Install:** `/plugin marketplace add zaitsew/finance-k`, then `/plugin install finance-k@finance-k`. Needs Node 24+.
- **Tools** (all `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`): `list_accounts`, `get_balances`, `get_monthly_changes`, `get_net_worth_by_currency`.
- **Money movement:** none. No write tools, no bank connection, no network calls.
- **Privacy:** [docs/PRIVACY.md](PRIVACY.md). Local only; no hosted version, so no data-deletion page beyond deleting the local file.
- **Support:** https://github.com/zaitsew/finance-k/issues
- **Test account:** none needed. Reviewers use made-up data:

  ```
  git clone https://github.com/zaitsew/finance-k && cd finance-k && npm install
  npm run fixture -- /tmp/finance-k-demo
  FINANCE_K_DATA_DIR=/tmp/finance-k-demo claude   # with the plugin installed, ask: "How did my net worth change in September 2026?"
  ```

  Expected: net worth 44,775.90 EUR for 2026-09, up 2,737.26 EUR from 2026-08 (market -1,440.00, FX -24.78, flows +4,202.04).
- **Icon:** not yet made. Needed before submitting.
