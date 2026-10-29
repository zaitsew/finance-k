import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Account, Position, Snapshot } from "../src/core/types";
import { dataDir, dbPath } from "../src/server/db";

/** A problem the person can fix: shown to the model as a tool error, never as a crash. */
export class DataError extends Error {}

export interface Ledger {
  accounts: Account[];
  positions: Position[];
  snapshots: Snapshot[];
  /** Every month with at least one saved close, oldest first. */
  months: string[];
}

/** node:sqlite hands back null-prototype rows; copy them into plain objects. */
const plain = <T>(rows: unknown[]): T[] => rows.map((r) => ({ ...(r as object) }) as T);

const ACCOUNT_COLUMNS =
  "id, institution, name, kind, currency, iban_last4, opened_on, purpose, fees_note, status, closed_on, source, bankjar_bank_id, notes, created_at, updated_at";

/**
 * Reads the whole ledger from the local database. The connection is read-only, never migrates, never creates a file,
 * and is closed before this returns, so the app can write between two calls and the next call sees it.
 */
export function readLedger(dir: string = dataDir()): Ledger {
  const file = dbPath(dir);
  if (!existsSync(file)) {
    throw new DataError(`No Finance K database at ${file}. Open the Finance K app and add an account first, or set FINANCE_K_DATA_DIR.`);
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    throw new DataError(`Cannot open ${file} read-only: ${(error as Error).message}`);
  }
  try {
    db.exec("PRAGMA query_only = ON");
    const accounts = plain<Account>(db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY status, institution COLLATE NOCASE, name COLLATE NOCASE`).all());
    const positions = plain<Position>(
      db.prepare("SELECT id, account_id, kind, currency, asset_kind, symbol, created_at FROM positions ORDER BY account_id, kind, currency, symbol").all(),
    );
    const snapshots = plain<Snapshot>(
      db
        .prepare("SELECT position_id, month, amount_minor, quantity, rate, rate_date, rate_source, value_eur_minor, captured_at FROM snapshots ORDER BY month, position_id")
        .all(),
    );
    const months = [...new Set(snapshots.map((s) => s.month))];
    return { accounts, positions, snapshots, months };
  } catch (error) {
    throw new DataError(`${file} is not a Finance K database, or it is from a newer version: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}
