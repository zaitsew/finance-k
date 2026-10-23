import type { DatabaseSync } from "node:sqlite";
import { valueEurMinor } from "../core/money";
import { EXPORT_APP, EXPORT_FORMAT_VERSION, ExportSchema, formatIssues, type ExportFile } from "../core/schemas";
import type { Account, Position, RateRow, Snapshot } from "../core/types";
import { transaction } from "./db";
import { listAccounts, listPositions, listSnapshots } from "./repo";
import { listRates } from "./rates/store";

/** The whole store as one versioned JSON document. No secrets live in the store, so none can leak here. */
export function exportStore(db: DatabaseSync, exportedAt: Date = new Date()): ExportFile {
  const settings: ExportFile["settings"] = {};
  for (const row of db.prepare("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[]) {
    if (row.key === "idle_cash_eur") settings.idle_cash_eur = row.value;
  }
  return {
    app: EXPORT_APP,
    format_version: EXPORT_FORMAT_VERSION,
    exported_at: exportedAt.toISOString(),
    accounts: listAccounts(db).sort((a, b) => a.id - b.id) as ExportFile["accounts"],
    positions: listPositions(db),
    snapshots: listSnapshots(db),
    rates: listRates(db),
    settings,
  };
}

export type ImportResult =
  | { ok: true; counts: { accounts: number; positions: number; snapshots: number; rates: number } }
  | { ok: false; errors: string[] };

/**
 * Replaces the whole store with the contents of an export file. The file is validated first
 * (shape, references, duplicates, each snapshot's EUR value against its amount and rate);
 * the swap then runs in one transaction, so a failure leaves the old data untouched.
 */
export function importStore(db: DatabaseSync, raw: unknown): ImportResult {
  const parsed = ExportSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error).slice(0, 12) };
  const file = parsed.data;

  const positionById = new Map(file.positions.map((p) => [p.id, p]));
  const mismatches: string[] = [];
  for (const s of file.snapshots) {
    const position = positionById.get(s.position_id)!;
    const expected = valueEurMinor(position, s, s.rate);
    if (expected !== s.value_eur_minor) {
      mismatches.push(`snapshots: position ${s.position_id} in ${s.month} has value_eur_minor ${s.value_eur_minor}, but its amount and rate give ${expected}`);
    }
  }
  if (mismatches.length) return { ok: false, errors: mismatches.slice(0, 12) };

  try {
    transaction(db, () => {
      db.exec("DELETE FROM snapshots; DELETE FROM positions; DELETE FROM accounts; DELETE FROM rates; DELETE FROM settings;");
      db.exec("DELETE FROM sqlite_sequence WHERE name IN ('accounts', 'positions')");
      insertAll(db, file);
    });
  } catch (e) {
    return { ok: false, errors: [`The database refused the file, nothing was changed: ${e instanceof Error ? e.message : String(e)}`] };
  }
  return { ok: true, counts: { accounts: file.accounts.length, positions: file.positions.length, snapshots: file.snapshots.length, rates: file.rates.length } };
}

function insertAll(db: DatabaseSync, file: ExportFile): void {
  const account = db.prepare(
    `INSERT INTO accounts (id, institution, name, kind, currency, iban_last4, opened_on, purpose, fees_note, status, closed_on, source, bankjar_bank_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const a of file.accounts as Account[]) {
    account.run(a.id, a.institution, a.name, a.kind, a.currency, a.iban_last4, a.opened_on, a.purpose, a.fees_note, a.status, a.closed_on, a.source, a.bankjar_bank_id, a.notes, a.created_at, a.updated_at);
  }
  const position = db.prepare("INSERT INTO positions (id, account_id, kind, currency, asset_kind, symbol, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  for (const p of file.positions as Position[]) position.run(p.id, p.account_id, p.kind, p.currency, p.asset_kind, p.symbol, p.created_at);
  const snapshot = db.prepare(
    "INSERT INTO snapshots (position_id, month, amount_minor, quantity, rate, rate_date, rate_source, value_eur_minor, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  for (const s of file.snapshots as Snapshot[]) {
    snapshot.run(s.position_id, s.month, s.amount_minor, s.quantity, s.rate, s.rate_date, s.rate_source, s.value_eur_minor, s.captured_at);
  }
  const rate = db.prepare("INSERT INTO rates (kind, key, date, value, source) VALUES (?, ?, ?, ?, ?)");
  for (const r of file.rates as RateRow[]) rate.run(r.kind, r.key, r.date, r.value, r.source);
  const setting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(file.settings)) setting.run(key, value);
}
