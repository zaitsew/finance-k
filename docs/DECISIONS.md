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
