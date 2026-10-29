# Decisions

An ADR log. One entry per decision that would otherwise be re-litigated.

## 2026-10-23 — a separate product, local-first, on the Mac

**Context.** BankJar is a public comparator that stores no one's data. This tool
holds one person's balances.

**Decision.** A separate repo. A Next.js app bound to 127.0.0.1. SQLite through
the built-in `node:sqlite`, in `~/Library/Application Support/finance-k`.
BankJar is reached only by link.

**Why.** A different trust model: the code is public, the data never leaves the
Mac. `node:sqlite` needs no native build.

**Status.** Accepted.

## 2026-10-23 — month-end snapshots are the core, transactions are optional

**Context.** Many sources (cash, Russian banks, some brokers) have no transaction
feed.

**Decision.** Every account has a balance per month end. The month-to-month change
is split as: market = quantity × price change; FX = previous native balance × rate
change; flows = the remainder. Transactions, where a source has them, refine flows.

**Why.** Every source can give a month-end balance. The split works for all of them.

**Status.** Accepted.

## 2026-10-29 — a local read-only MCP server, no hosted one

**Context.** Claude, ChatGPT and Gemini list user-data connectors only as remote HTTPS MCP servers behind OAuth. Finance K's data is one person's balances in a local SQLite file.

**Decision.** `finance-k mcp` runs on stdio, reads the file read-only, has four read tools and no network code. It ships as a Claude plugin bundle in this public repo (`.claude-plugin/marketplace.json`, `plugins/finance-k/`) with a committed single-file bundle, and as a manual `codex mcp add`. No remote server, no OAuth, no ChatGPT or Gemini listing. The protocol layer is hand-written (about 100 lines) so the bundle has no dependencies and no network-capable code to audit.

**Why.** A remote server needs a copy of the data on a server. A tool that moves money would be rejected by Claude's directory, and Finance K has none.

**Status.** Accepted.
