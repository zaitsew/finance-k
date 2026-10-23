import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { valueEurMinor } from "../core/money";
import type { AccountInput, PositionInput } from "../core/schemas";
import type { Account, Position, RateSource, Snapshot } from "../core/types";
import { transaction } from "./db";

const now = (): string => new Date().toISOString();

const ACCOUNT_COLUMNS =
  "id, institution, name, kind, currency, iban_last4, opened_on, purpose, fees_note, status, closed_on, source, bankjar_bank_id, notes, created_at, updated_at";
const POSITION_COLUMNS = "id, account_id, kind, currency, asset_kind, symbol, created_at";
const SNAPSHOT_COLUMNS = "position_id, month, amount_minor, quantity, rate, rate_date, rate_source, value_eur_minor, captured_at";

/** node:sqlite hands back null-prototype rows; copy them into plain objects. */
const plain = <T>(rows: unknown[]): T[] => rows.map((r) => ({ ...(r as object) }) as T);

// --- Accounts -------------------------------------------------------------------------

export function listAccounts(db: DatabaseSync): Account[] {
  return plain<Account>(db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY status, institution COLLATE NOCASE, name COLLATE NOCASE`).all());
}

export function getAccount(db: DatabaseSync, id: number): Account | null {
  const row = db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id);
  return row ? ({ ...row } as unknown as Account) : null;
}

export function countAccounts(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM accounts").get() as { n: number }).n;
}

const accountValues = (a: AccountInput): SQLInputValue[] => [
  a.institution,
  a.name,
  a.kind,
  a.currency,
  a.iban_last4,
  a.opened_on,
  a.purpose,
  a.fees_note,
  a.status,
  a.closed_on,
  a.source,
  a.bankjar_bank_id,
  a.notes,
];

/** Kinds that start with a cash position in the account's currency. Wallets and exchanges start empty. */
export function startsWithCash(kind: Account["kind"]): boolean {
  return kind !== "wallet" && kind !== "crypto_exchange";
}

export function createAccount(db: DatabaseSync, input: AccountInput): number {
  return transaction(db, () => {
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO accounts (institution, name, kind, currency, iban_last4, opened_on, purpose, fees_note, status, closed_on, source, bankjar_bank_id, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(...accountValues(input), ts, ts);
    const id = Number(result.lastInsertRowid);
    if (startsWithCash(input.kind)) {
      db.prepare("INSERT INTO positions (account_id, kind, currency, created_at) VALUES (?, 'cash', ?, ?)").run(id, input.currency, ts);
    }
    return id;
  });
}

export function updateAccount(db: DatabaseSync, id: number, input: AccountInput): void {
  db.prepare(
    `UPDATE accounts SET institution = ?, name = ?, kind = ?, currency = ?, iban_last4 = ?, opened_on = ?, purpose = ?, fees_note = ?,
       status = ?, closed_on = ?, source = ?, bankjar_bank_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(...accountValues(input), now(), id);
}

export function deleteAccount(db: DatabaseSync, id: number): void {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

// --- Positions --------------------------------------------------------------------------

export function listPositions(db: DatabaseSync, accountId?: number): Position[] {
  if (accountId !== undefined) {
    return plain<Position>(db.prepare(`SELECT ${POSITION_COLUMNS} FROM positions WHERE account_id = ? ORDER BY kind, currency, symbol`).all(accountId));
  }
  return plain<Position>(db.prepare(`SELECT ${POSITION_COLUMNS} FROM positions ORDER BY account_id, kind, currency, symbol`).all());
}

export function getPosition(db: DatabaseSync, id: number): Position | null {
  const row = db.prepare(`SELECT ${POSITION_COLUMNS} FROM positions WHERE id = ?`).get(id);
  return row ? ({ ...row } as unknown as Position) : null;
}

export type AddPositionResult = { ok: true; id: number } | { ok: false; error: string };

export function addPosition(db: DatabaseSync, accountId: number, input: PositionInput): AddPositionResult {
  const existing = listPositions(db, accountId).find((p) =>
    input.kind === "cash"
      ? p.kind === "cash" && p.currency === input.currency
      : p.kind === "asset" && p.asset_kind === input.asset_kind && p.symbol === input.symbol,
  );
  if (existing) return { ok: false, error: "This account already has that position" };
  const result =
    input.kind === "cash"
      ? db.prepare("INSERT INTO positions (account_id, kind, currency, created_at) VALUES (?, 'cash', ?, ?)").run(accountId, input.currency, now())
      : db
          .prepare("INSERT INTO positions (account_id, kind, asset_kind, symbol, created_at) VALUES (?, 'asset', ?, ?, ?)")
          .run(accountId, input.asset_kind, input.symbol, now());
  return { ok: true, id: Number(result.lastInsertRowid) };
}

export function countSnapshotsOf(db: DatabaseSync, positionId: number): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM snapshots WHERE position_id = ?").get(positionId) as { n: number }).n;
}

export function deletePosition(db: DatabaseSync, id: number): { ok: true } | { ok: false; error: string } {
  const n = countSnapshotsOf(db, id);
  if (n > 0) return { ok: false, error: `This position has ${n} saved month${n === 1 ? "" : "s"}. Close the account instead of deleting it.` };
  db.prepare("DELETE FROM positions WHERE id = ?").run(id);
  return { ok: true };
}

// --- Snapshots --------------------------------------------------------------------------

export function listSnapshots(db: DatabaseSync): Snapshot[] {
  return plain<Snapshot>(db.prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots ORDER BY month, position_id`).all());
}

export function snapshotsOfMonth(db: DatabaseSync, month: string): Snapshot[] {
  return plain<Snapshot>(db.prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE month = ?`).all(month));
}

export function snapshotsOfAccount(db: DatabaseSync, accountId: number): Snapshot[] {
  return plain<Snapshot>(
    db
      .prepare(`SELECT ${SNAPSHOT_COLUMNS.split(", ").map((c) => `s.${c}`).join(", ")} FROM snapshots s JOIN positions p ON p.id = s.position_id WHERE p.account_id = ? ORDER BY s.month DESC, s.position_id`)
      .all(accountId),
  );
}

/** The latest snapshot of a position strictly before `month`. */
export function previousSnapshot(db: DatabaseSync, positionId: number, month: string): Snapshot | null {
  const row = db.prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM snapshots WHERE position_id = ? AND month < ? ORDER BY month DESC LIMIT 1`).get(positionId, month);
  return row ? ({ ...row } as unknown as Snapshot) : null;
}

export function listMonths(db: DatabaseSync): string[] {
  return (db.prepare("SELECT DISTINCT month FROM snapshots ORDER BY month").all() as { month: string }[]).map((r) => r.month);
}

export interface SnapshotInput {
  position: Position;
  month: string;
  amount_minor: number | null;
  quantity: string | null;
  /** EUR per one unit. */
  rate: string;
  rate_date: string | null;
  rate_source: RateSource;
}

/** Saves one position's close for a month. Idempotent: the same (position, month) is replaced, never duplicated. */
export function saveSnapshot(db: DatabaseSync, input: SnapshotInput): Snapshot {
  const value = valueEurMinor(input.position, { amount_minor: input.amount_minor, quantity: input.quantity }, input.rate);
  const ts = now();
  db.prepare(
    `INSERT INTO snapshots (position_id, month, amount_minor, quantity, rate, rate_date, rate_source, value_eur_minor, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (position_id, month) DO UPDATE SET
       amount_minor = excluded.amount_minor, quantity = excluded.quantity, rate = excluded.rate, rate_date = excluded.rate_date,
       rate_source = excluded.rate_source, value_eur_minor = excluded.value_eur_minor, captured_at = excluded.captured_at`,
  ).run(input.position.id, input.month, input.amount_minor, input.quantity, input.rate, input.rate_date, input.rate_source, value, ts);
  return {
    position_id: input.position.id,
    month: input.month,
    amount_minor: input.amount_minor,
    quantity: input.quantity,
    rate: input.rate,
    rate_date: input.rate_date,
    rate_source: input.rate_source,
    value_eur_minor: value,
    captured_at: ts,
  };
}

// --- Settings -----------------------------------------------------------------------------

export function getSetting(db: DatabaseSync, key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(key, value);
}

export const DEFAULT_IDLE_CASH_EUR = "2000";

/** The idle-cash threshold in EUR: the saved setting, else FINANCE_K_IDLE_CASH_EUR, else 2000. */
export function idleCashEur(db: DatabaseSync): string {
  const saved = getSetting(db, "idle_cash_eur");
  if (saved !== null) return saved;
  const env = process.env.FINANCE_K_IDLE_CASH_EUR?.trim();
  if (env && /^\d+(\.\d+)?$/.test(env)) return env;
  return DEFAULT_IDLE_CASH_EUR;
}
