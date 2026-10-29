import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { eurPerUnit } from "../src/core/money";
import { closeDb, openDb } from "../src/server/db";
import { addPosition, createAccount, listPositions, saveSnapshot } from "../src/server/repo";
import type { AccountInput } from "../src/core/schemas";
import type { Position } from "../src/core/types";

/**
 * A made-up ledger for tests, demos and verifying the MCP server: three closed months for six invented accounts.
 * No real balances. `npm run fixture -- <dir>` writes it to <dir>; point FINANCE_K_DATA_DIR at that directory.
 */
const base = {
  iban_last4: null,
  purpose: null,
  fees_note: null,
  closed_on: null,
  source: "manual",
  bankjar_bank_id: null,
  notes: null,
  status: "open",
  opened_on: "2025-01-01",
} as const;

export function buildFixture(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const db = openDb(dir);
  const add = (a: Partial<AccountInput> & Pick<AccountInput, "institution" | "name" | "kind" | "currency">): number => createAccount(db, { ...base, ...a });
  const cash = (accountId: number, currency: string): Position => listPositions(db, accountId).find((p) => p.kind === "cash" && p.currency === currency)!;
  const asset = (accountId: number, symbol: string, assetKind: "crypto" | "security"): Position => {
    addPosition(db, accountId, { kind: "asset", asset_kind: assetKind, symbol });
    return listPositions(db, accountId).find((p) => p.symbol === symbol)!;
  };

  const checking = add({ institution: "Example Bank", name: "Checking", kind: "bank", currency: "EUR", iban_last4: "1234", purpose: "Daily spending" });
  const savings = add({ institution: "Example Bank", name: "Savings", kind: "bank", currency: "EUR" });
  const dollars = add({ institution: "Example Broker", name: "Dollar cash", kind: "broker", currency: "USD" });
  const exchange = add({ institution: "Example Exchange", name: "Spot", kind: "crypto_exchange", currency: "EUR" });
  const rubles = add({ institution: "Example Regional Bank", name: "Current", kind: "bank", currency: "RUB" });
  const old = add({ institution: "Example Credit Union", name: "Old account", kind: "bank", currency: "EUR", status: "closed", closed_on: "2026-08-15" });

  const btc = asset(exchange, "BTC", "crypto");
  const etf = asset(dollars, "EXMPL", "security");

  // [position, native amount in minor units (cash) or quantity (asset), per-month EUR rate]
  type Row = [Position, number | string, [string, string, string]];
  const months = ["2026-07", "2026-08", "2026-09"] as const;
  const usd = [eurPerUnit("1.10"), eurPerUnit("1.12"), eurPerUnit("1.15")] as [string, string, string];
  const rub = [eurPerUnit("100"), eurPerUnit("102"), eurPerUnit("98")] as [string, string, string];
  const one: [string, string, string] = ["1", "1", "1"];
  const rows: Row[][] = [
    [
      [cash(checking, "EUR"), 250_000, one],
      [cash(savings, "EUR"), 1_000_000, one],
      [cash(dollars, "USD"), 500_000, usd],
      [btc, "0.5", ["40000", "42000", "39000"]],
      [etf, "20", ["95", "98", "101"]],
      [cash(rubles, "RUB"), 20_000_000, rub],
      [cash(old, "EUR"), 40_000, one],
    ],
    [
      [cash(checking, "EUR"), 310_000, one],
      [cash(savings, "EUR"), 1_000_000, one],
      [cash(dollars, "USD"), 450_000, usd],
      [btc, "0.5", ["40000", "42000", "39000"]],
      [etf, "20", ["95", "98", "101"]],
      [cash(rubles, "RUB"), 20_000_000, rub],
      [cash(old, "EUR"), 40_000, one],
    ],
    [
      [cash(checking, "EUR"), 280_000, one],
      [cash(savings, "EUR"), 1_050_000, one],
      [cash(dollars, "USD"), 450_000, usd],
      [btc, "0.6", ["40000", "42000", "39000"]],
      [etf, "20", ["95", "98", "101"]],
      [cash(rubles, "RUB"), 21_000_000, rub],
    ],
  ];
  months.forEach((month, m) => {
    for (const [position, amount, rates] of rows[m]!) {
      const isCash = position.kind === "cash";
      saveSnapshot(db, {
        position,
        month,
        amount_minor: isCash ? (amount as number) : null,
        quantity: isCash ? null : (amount as string),
        rate: rates[m]!,
        rate_date: `${month}-28`,
        rate_source: isCash && position.currency === "EUR" ? "identity" : "manual",
      });
    }
  });
  closeDb(dir);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: npm run fixture -- <dir>");
    process.exit(2);
  }
  buildFixture(dir);
  console.log(`Fixture ledger written to ${dir}\nTry: FINANCE_K_DATA_DIR=${dir} node plugins/finance-k/server/finance-k.mjs mcp`);
}
