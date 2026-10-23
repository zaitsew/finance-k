import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { valueEurMinor } from "../src/core/money";
import type { Account, Position, RateSource, Snapshot } from "../src/core/types";
import { closeDb, openDb } from "../src/server/db";

/** A fresh data dir per test, removed afterwards. Returns the opened database. */
const dirs: string[] = [];
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "finance-k-test-"));
  dirs.push(dir);
  return dir;
}
export function tempDb() {
  const dir = tempDir();
  return { dir, db: openDb(dir) };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    closeDb(dir);
    rmSync(dir, { recursive: true, force: true });
  }
});

const OLD = "2026-01-01T00:00:00.000Z";

export function account(id: number, over: Partial<Account> = {}): Account {
  return {
    id,
    institution: `Bank ${id}`,
    name: `Account ${id}`,
    kind: "bank",
    currency: "EUR",
    iban_last4: null,
    opened_on: "2025-01-01",
    purpose: null,
    fees_note: null,
    status: "open",
    closed_on: null,
    source: "manual",
    bankjar_bank_id: null,
    notes: null,
    created_at: OLD,
    updated_at: OLD,
    ...over,
  };
}

export function cashPosition(id: number, accountId: number, currency = "EUR", over: Partial<Position> = {}): Position {
  return { id, account_id: accountId, kind: "cash", currency, asset_kind: null, symbol: null, created_at: OLD, ...over };
}

export function assetPosition(id: number, accountId: number, symbol = "BTC", assetKind: "crypto" | "security" = "crypto", over: Partial<Position> = {}): Position {
  return { id, account_id: accountId, kind: "asset", currency: null, asset_kind: assetKind, symbol, created_at: OLD, ...over };
}

/** A consistent snapshot: the EUR value is computed from the amount and rate, like the app does. */
export function snap(position: Position, month: string, amount: number | string, rate = "1", source: RateSource = "manual"): Snapshot {
  const amount_minor = position.kind === "cash" ? (amount as number) : null;
  const quantity = position.kind === "asset" ? (amount as string) : null;
  return {
    position_id: position.id,
    month,
    amount_minor,
    quantity,
    rate,
    rate_date: null,
    rate_source: position.kind === "cash" && position.currency === "EUR" ? "identity" : source,
    value_eur_minor: valueEurMinor(position, { amount_minor, quantity }, rate),
    captured_at: OLD,
  };
}

/** A fetch that serves canned responses by URL prefix and records the calls. */
export function fakeFetch(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fn = async (url: string): Promise<Response> => {
    calls.push(url);
    for (const [prefix, make] of Object.entries(routes)) if (url.startsWith(prefix)) return make();
    return new Response("not found", { status: 404 });
  };
  return { fn, calls };
}
