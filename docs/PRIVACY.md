# Privacy

Finance K is local-first. This page covers the AI integration (`finance-k mcp`, the Claude plugin and the Codex install). The web app keeps its own promises in the README.

## What the MCP server does

- Opens `finance-k.sqlite` read-only (`readOnly` connection plus `PRAGMA query_only`), reads it, and closes it on every tool call. It never migrates, creates or writes the file.
- Talks to one client over stdio: the app that started it (Claude Code, Claude Desktop, Codex). It opens no socket and listens on no port.
- Contains no network code. It imports only `node:fs`, `node:os`, `node:path`, `node:readline` and `node:sqlite`; `tests/mcp.test.ts` fails if the shipped bundle imports anything else or contains write SQL.
- Has four tools, all read-only. None moves money, connects to a bank, fetches rates or changes an account.
- Collects nothing: no telemetry, no analytics, no logs of what you asked. Errors go to the local stderr of the process.

## What leaves the machine, and who sends it

The server answers the client that started it. The client sends the answers to its model provider as part of the conversation: Anthropic for Claude, OpenAI for Codex. That is your client's data flow, under your own plan and settings, and Finance K does not control it. Fields the tools return: account institution, name, kind, currency, status, purpose, last four IBAN digits, balances, rates and totals. The tools never return notes, full IBANs (Finance K never stores them) or credentials.

## Why there is no hosted version

Finance K holds one person's balances. A remote MCP server would need a copy of that data on a server, and the accounts to read it with. We chose to keep the data on the machine. So there is no hosted endpoint, no OAuth, and no listing in the ChatGPT or Gemini directories, which accept remote servers only. The Claude plugin directory accepts a plugin bundle with a local server, which is what this is.

## Deleting your data

Delete the SQLite file (`~/Library/Application Support/finance-k/`, or the folder in `FINANCE_K_DATA_DIR`). Nothing else holds a copy. Remove the integration with `/plugin uninstall finance-k@finance-k` or `codex mcp remove finance-k`.

## Contact

Open an issue at https://github.com/zaitsew/finance-k/issues. Do not paste real balances there.
