import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IBAN_LAST4_MESSAGE, AccountInputSchema, ExportSchema, PositionInputSchema } from "../src/core/schemas";
import { loadMigrations, openDb, openReadOnly, currentVersion, dbPath } from "../src/server/db";
import { addPosition, createAccount, deleteAccount, deletePosition, idleCashEur, listAccounts, listMonths, listPositions, listSnapshots, previousSnapshot, saveSnapshot, setSetting, snapshotsOfMonth, updateAccount } from "../src/server/repo";
import { putRates } from "../src/server/rates/store";
import { exportStore, importStore } from "../src/server/store-io";
import { usageLines } from "../src/server/usage";
import { tempDb, tempDir } from "./helpers";

const input = (over: Record<string, unknown> = {}) =>
  AccountInputSchema.parse({ institution: "Santander", name: "Current", kind: "bank", currency: "eur", ...over });

/** A small but complete store: every kind of row, two months. */
function seed(db: ReturnType<typeof tempDb>["db"]) {
  const bank = createAccount(db, input({ iban_last4: "4321", opened_on: "2024-03-01", bankjar_bank_id: "santander", purpose: "Salary", fees_note: "Free", notes: "Main" }));
  const usd = createAccount(db, input({ institution: "Revolut", name: "USD", currency: "USD", iban_last4: "" }));
  const kraken = createAccount(db, input({ institution: "Kraken", name: "Exchange", kind: "crypto_exchange", source: "exchange_api" }));
  const [bankCash] = listPositions(db, bank);
  const [usdCash] = listPositions(db, usd);
  const btcId = (addPosition(db, kraken, { kind: "asset", asset_kind: "crypto", symbol: "BTC" }) as { id: number }).id;
  const btc = listPositions(db, kraken).find((p) => p.id === btcId)!;
  saveSnapshot(db, { position: bankCash!, month: "2026-09", amount_minor: 100000, quantity: null, rate: "1", rate_date: null, rate_source: "identity" });
  saveSnapshot(db, { position: bankCash!, month: "2026-10", amount_minor: 150050, quantity: null, rate: "1", rate_date: null, rate_source: "identity" });
  saveSnapshot(db, { position: usdCash!, month: "2026-10", amount_minor: 100000, quantity: null, rate: "0.893415527562", rate_date: "2026-10-30", rate_source: "ecb" });
  saveSnapshot(db, { position: btc, month: "2026-10", amount_minor: null, quantity: "0.5", rate: "72633", rate_date: "2026-10-31", rate_source: "coingecko" });
  putRates(db, [
    { kind: "fx", key: "USD", date: "2026-10-30", value: "1.1193", source: "ecb" },
    { kind: "crypto", key: "BTC", date: "2026-10-31", value: "72633", source: "coingecko" },
  ]);
  setSetting(db, "idle_cash_eur", "2500");
  return { bank, usd, kraken, bankCash: bankCash!, usdCash: usdCash!, btc };
}

describe("IBAN last 4", () => {
  it("accepts exactly four digits, or nothing", () => {
    expect(input({ iban_last4: "0042" }).iban_last4).toBe("0042");
    expect(input({ iban_last4: " 1234 " }).iban_last4).toBe("1234");
    expect(input({ iban_last4: "" }).iban_last4).toBeNull();
    expect(input({}).iban_last4).toBeNull();
  });

  it.each(["123", "12345", "ES9121000418450200051332", "12a4", "ABCD", "12 34", "1234-"])("refuses %s", (value) => {
    const r = AccountInputSchema.safeParse({ institution: "A", name: "B", kind: "bank", currency: "EUR", iban_last4: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toBe(IBAN_LAST4_MESSAGE);
  });

  it("is enforced by the database as well", () => {
    const { db } = tempDb();
    const bad = () =>
      db
        .prepare("INSERT INTO accounts (institution, name, kind, currency, iban_last4, created_at, updated_at) VALUES ('a', 'b', 'bank', 'EUR', ?, 'x', 'x')")
        .run("ES91210004184502000513");
    expect(bad).toThrow();
  });

  it("is refused in an import too", () => {
    const { db } = tempDb();
    seed(db);
    const file = JSON.parse(JSON.stringify(exportStore(db)));
    file.accounts[0].iban_last4 = "ES9121000418450200051332";
    const result = importStore(db, file);
    expect(result.ok).toBe(false);
  });
});

describe("account and position input", () => {
  it("validates the account fields", () => {
    expect(AccountInputSchema.safeParse({ institution: "", name: "x", kind: "bank", currency: "EUR" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ institution: "x", name: "x", kind: "savings", currency: "EUR" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ institution: "x", name: "x", kind: "bank", currency: "EURO" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ institution: "x", name: "x", kind: "bank", currency: "EUR", bankjar_bank_id: "nope" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ institution: "x", name: "x", kind: "bank", currency: "EUR", bankjar_bank_id: "trade-republic" }).success).toBe(true);
    expect(AccountInputSchema.safeParse({ institution: "x", name: "x", kind: "bank", currency: "EUR", opened_on: "2026-02-30" }).success).toBe(false);
  });

  it("needs a closing date exactly when the account is closed", () => {
    const base = { institution: "x", name: "x", kind: "bank", currency: "EUR" };
    expect(AccountInputSchema.safeParse({ ...base, status: "closed" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ ...base, status: "closed", closed_on: "2026-10-15" }).success).toBe(true);
    expect(AccountInputSchema.safeParse({ ...base, status: "open", closed_on: "2026-10-15" }).success).toBe(false);
    expect(AccountInputSchema.safeParse({ ...base, opened_on: "2026-10-20", status: "closed", closed_on: "2026-10-15" }).success).toBe(false);
  });

  it("validates positions", () => {
    expect(PositionInputSchema.parse({ kind: "cash", currency: "usd" })).toEqual({ kind: "cash", currency: "USD" });
    expect(PositionInputSchema.parse({ kind: "asset", asset_kind: "security", symbol: "vwce" })).toMatchObject({ symbol: "VWCE" });
    expect(PositionInputSchema.safeParse({ kind: "asset", asset_kind: "crypto", symbol: "bad symbol!" }).success).toBe(false);
  });
});

describe("the database", () => {
  it("applies the numbered migrations on open and is idempotent", () => {
    const { dir, db } = tempDb();
    const latest = Math.max(...loadMigrations().map((m) => m.version));
    expect(currentVersion(db)).toBe(latest);
    const again = openDb(dir);
    expect(again).toBe(db);
    expect(readdirSync(join(process.cwd(), "src/server/migrations")).every((f) => /^\d{3}_.+\.sql$/.test(f))).toBe(true);
  });

  it("creates the file private to the user", () => {
    const { dir } = tempDb();
    expect(statSync(dbPath(dir)).mode & 0o077).toBe(0);
  });

  it("starts bank accounts with a cash position and wallets with none", () => {
    const { db } = tempDb();
    const bank = createAccount(db, input({ currency: "USD" }));
    const wallet = createAccount(db, input({ kind: "wallet", name: "Ledger" }));
    expect(listPositions(db, bank).map((p) => [p.kind, p.currency])).toEqual([["cash", "USD"]]);
    expect(listPositions(db, wallet)).toEqual([]);
  });

  it("refuses a duplicate position and a delete that would lose saved months", () => {
    const { db } = tempDb();
    const s = seed(db);
    expect(addPosition(db, s.bank, { kind: "cash", currency: "EUR" })).toEqual({ ok: false, error: "This account already has that position" });
    expect(addPosition(db, s.kraken, { kind: "asset", asset_kind: "crypto", symbol: "BTC" }).ok).toBe(false);
    expect(deletePosition(db, s.bankCash.id).ok).toBe(false);
    const empty = addPosition(db, s.kraken, { kind: "asset", asset_kind: "crypto", symbol: "ETH" }) as { id: number };
    expect(deletePosition(db, empty.id)).toEqual({ ok: true });
  });

  it("saves a month idempotently and lets a past month be edited", () => {
    const { db } = tempDb();
    const s = seed(db);
    const before = listSnapshots(db).length;
    const save = (amount: number) =>
      saveSnapshot(db, { position: s.bankCash, month: "2026-09", amount_minor: amount, quantity: null, rate: "1", rate_date: null, rate_source: "identity" });
    save(100000);
    save(100000);
    expect(listSnapshots(db)).toHaveLength(before);
    save(123456);
    expect(listSnapshots(db)).toHaveLength(before);
    expect(snapshotsOfMonth(db, "2026-09").find((x) => x.position_id === s.bankCash.id)).toMatchObject({ amount_minor: 123456, value_eur_minor: 123456 });
    expect(previousSnapshot(db, s.bankCash.id, "2026-10")?.month).toBe("2026-09");
    expect(previousSnapshot(db, s.bankCash.id, "2026-09")).toBeNull();
    expect(listMonths(db)).toEqual(["2026-09", "2026-10"]);
  });

  it("stores the EUR value rounded once at close", () => {
    const { db } = tempDb();
    const s = seed(db);
    const usd = snapshotsOfMonth(db, "2026-10").find((x) => x.position_id === s.usdCash.id)!;
    expect(usd.value_eur_minor).toBe(89342); // 1000.00 USD x 0.893415527562 = 893.4155... -> 893.42
    const btc = snapshotsOfMonth(db, "2026-10").find((x) => x.position_id === s.btc.id)!;
    expect(btc.value_eur_minor).toBe(3631650);
  });

  it("deletes an account with its positions and months", () => {
    const { db } = tempDb();
    const s = seed(db);
    deleteAccount(db, s.kraken);
    expect(listPositions(db, s.kraken)).toEqual([]);
    expect(listSnapshots(db).some((x) => x.position_id === s.btc.id)).toBe(false);
  });

  it("reads the idle-cash limit from the setting, then the environment, then 2000", () => {
    const { db } = tempDb();
    const previous = process.env.FINANCE_K_IDLE_CASH_EUR;
    try {
      delete process.env.FINANCE_K_IDLE_CASH_EUR;
      expect(idleCashEur(db)).toBe("2000");
      process.env.FINANCE_K_IDLE_CASH_EUR = "3500";
      expect(idleCashEur(db)).toBe("3500");
      setSetting(db, "idle_cash_eur", "1200");
      expect(idleCashEur(db)).toBe("1200");
    } finally {
      if (previous === undefined) delete process.env.FINANCE_K_IDLE_CASH_EUR;
      else process.env.FINANCE_K_IDLE_CASH_EUR = previous;
    }
  });
});

describe("export and import", () => {
  const strip = <T extends { exported_at: string }>(f: T) => ({ ...f, exported_at: "" });

  it("round-trips the whole store into an empty database", () => {
    const a = tempDb();
    seed(a.db);
    const exported = exportStore(a.db);
    expect(ExportSchema.safeParse(exported).success).toBe(true);
    expect(exported).toMatchObject({ app: "finance-k", format_version: 1 });
    expect(exported.accounts).toHaveLength(3);
    expect(exported.positions).toHaveLength(3);
    expect(exported.snapshots).toHaveLength(4);
    expect(exported.rates).toHaveLength(2);
    expect(exported.settings).toEqual({ idle_cash_eur: "2500" });

    const b = tempDb();
    const result = importStore(b.db, JSON.parse(JSON.stringify(exported)));
    expect(result).toEqual({ ok: true, counts: { accounts: 3, positions: 3, snapshots: 4, rates: 2 } });
    expect(strip(exportStore(b.db))).toEqual(strip(exported));
  });

  it("replaces what was there, and new rows continue after the imported ids", () => {
    const a = tempDb();
    seed(a.db);
    const exported = exportStore(a.db);
    const b = tempDb();
    createAccount(b.db, input({ institution: "Will be replaced" }));
    expect(importStore(b.db, exported).ok).toBe(true);
    expect(listAccounts(b.db).map((x) => x.institution).sort()).toEqual(["Kraken", "Revolut", "Santander"]);
    const next = createAccount(b.db, input({ institution: "After import" }));
    expect(next).toBe(Math.max(...exported.accounts.map((x) => x.id)) + 1);
  });

  it("is a complete JSON document that survives a text round trip", () => {
    const a = tempDb();
    seed(a.db);
    const text = JSON.stringify(exportStore(a.db));
    const b = tempDb();
    expect(importStore(b.db, JSON.parse(text)).ok).toBe(true);
  });

  it("refuses a file that does not match, and changes nothing", () => {
    const a = tempDb();
    seed(a.db);
    const good = JSON.parse(JSON.stringify(exportStore(a.db)));
    const target = tempDb();
    seed(target.db);
    const before = strip(exportStore(target.db));

    const broken: Record<string, (f: any) => void> = {
      "wrong app": (f) => (f.app = "something-else"),
      "future version": (f) => (f.format_version = 2),
      "unknown field": (f) => (f.extra = 1),
      "unknown account field": (f) => (f.accounts[0].password = "x"),
      "bad kind": (f) => (f.accounts[0].kind = "savings"),
      "position without account": (f) => (f.positions[0].account_id = 999),
      "snapshot without position": (f) => (f.snapshots[0].position_id = 999),
      "duplicate snapshot": (f) => f.snapshots.push({ ...f.snapshots[0] }),
      "duplicate account id": (f) => (f.accounts[1].id = f.accounts[0].id),
      "cash snapshot on an asset": (f) => {
        const s = f.snapshots.find((x: any) => x.quantity !== null);
        s.amount_minor = 5;
        s.quantity = null;
      },
      "value that does not match the amount": (f) => (f.snapshots[0].value_eur_minor += 1),
      "float money": (f) => (f.snapshots[0].amount_minor = 12.5),
      "negative rate": (f) => (f.snapshots[0].rate = "-1"),
      "bad month": (f) => (f.snapshots[0].month = "2026-13"),
      "bad setting": (f) => (f.settings.idle_cash_eur = "lots"),
      "unknown setting": (f) => (f.settings.theme = "dark"),
    };
    for (const [name, mutate] of Object.entries(broken)) {
      const file = JSON.parse(JSON.stringify(good));
      mutate(file);
      const result = importStore(target.db, file);
      expect(result.ok, name).toBe(false);
      expect(strip(exportStore(target.db)), `${name} left the store alone`).toEqual(before);
    }
    expect(importStore(target.db, "not an object").ok).toBe(false);
    expect(importStore(target.db, null).ok).toBe(false);
  });

  it("rolls back the whole import when the database refuses a row", () => {
    const target = tempDb();
    seed(target.db);
    const before = strip(exportStore(target.db));
    const a = tempDb();
    seed(a.db);
    const file = JSON.parse(JSON.stringify(exportStore(a.db)));
    // Passes the schema, fails the unique index on (account, cash currency) after the accounts went in.
    const dup = { ...file.positions.find((p: any) => p.kind === "cash"), id: 99 };
    file.positions.push(dup);
    const result = importStore(target.db, file);
    expect(result.ok).toBe(false);
    expect(strip(exportStore(target.db))).toEqual(before);
  });

  it("an updated account keeps its row after import", () => {
    const a = tempDb();
    const s = seed(a.db);
    updateAccount(a.db, s.bank, input({ name: "Renamed", iban_last4: "9999" }));
    const b = tempDb();
    importStore(b.db, exportStore(a.db));
    expect(listAccounts(b.db).find((x) => x.id === s.bank)).toMatchObject({ name: "Renamed", iban_last4: "9999", currency: "EUR" });
  });
});

describe("usage probe", () => {
  it("says no_db when nothing exists, without creating it", () => {
    const dir = tempDir();
    expect(usageLines(dir)).toEqual(["usage_probe=no_db"]);
    expect(openReadOnly(dir)).toBeNull();
    expect(() => statSync(dbPath(dir))).toThrow();
  });

  it("says no_db for a file that is not a database", () => {
    const dir = tempDir();
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(dbPath(dir), "not sqlite");
    expect(usageLines(dir)).toEqual(["usage_probe=no_db"]);
  });

  it("counts accounts and closed months", () => {
    const { dir, db } = tempDb();
    expect(usageLines(dir)).toEqual(["accounts_open=0", "accounts_closed=0", "months_closed=0", "last_closed_month=none"]);
    const s = seed(db);
    updateAccount(db, s.usd, input({ institution: "Revolut", name: "USD", currency: "USD", status: "closed", closed_on: "2026-10-20" }));
    expect(usageLines(dir)).toEqual(["accounts_open=2", "accounts_closed=1", "months_closed=2", "last_closed_month=2026-10"]);
  });
});

describe("migrations are plain numbered SQL", () => {
  it("reads 001_init.sql", () => {
    expect(readFileSync(join(process.cwd(), "src/server/migrations/001_init.sql"), "utf8")).toContain("CREATE TABLE accounts");
  });
});
