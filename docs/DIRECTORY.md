# Directories: Claude plugin and ChatGPT

| Directory | Status |
|---|---|
| Claude plugin directory | **Ready.** Submitting is the owner's step (below). |
| ChatGPT app directory | **Not eligible.** OpenAI accepts only a public HTTPS remote MCP server. Finance K is local-first and its privacy promise is that data stays on the machine, so there is no remote server and none will be built. |

## Claude plugin directory

Checked on 2026-11-07, against Anthropic's pre-submission checklist: `claude plugin validate` passes for the plugin folder and the marketplace; the plugin has a `plugin.json` with name, description, author and version, a README of 245 words outside code blocks, an Apache-2.0 `LICENSE`, no symlinks, no `.DS_Store`, no binary other than the PNG icon, and a 31 KB readable (unminified) server bundle. Server instructions, tool descriptions and tool output state facts and contain no commands to the assistant (`tests/mcp.test.ts` scans them). A test install from a local copy of the marketplace put the bundle and icon in place and the server answered the demo question below.

Submitting is the owner's step (one new directory submission a day). Everything below is ready to paste.

### Portal steps (owner)

1. Open https://claude.ai/directory/manage, choose **Submit new**, then **Plugin bundle**.
2. **Source:** repository `zaitsew/finance-k`, plugin path `plugins/finance-k`, branch empty. Select **Validate**; the report should show no **Blocks** finding.
3. **Listing details:** check the name, description and README. Upload [icon.png](../plugins/finance-k/assets/icon.png) if the form asks for an icon.
4. **Data handling:** the plugin reads the person's own local SQLite file, stores nothing, sends nothing to any service, keeps no data, and is not intended for people under 18.
5. **Compliance:** check the contact email, select all four acknowledgements (accepting the Directory Terms and Policy is the owner's click).
6. **Review and submit:** keep **GitHub push webhook**, select **Submit for review**.

### Submission details

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
- **Icon:** [icon.png](../plugins/finance-k/assets/icon.png) (512 px, transparent corners), source [icon.svg](../plugins/finance-k/assets/icon.svg). Both ship inside the plugin folder.
