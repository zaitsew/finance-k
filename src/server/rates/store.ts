import type { DatabaseSync } from "node:sqlite";
import type { RateKind, RateRow } from "../../core/types";
import { transaction } from "../db";

/** The newest row dated on or before `date`. Dates are YYYY-MM-DD, so string order is date order. */
export function pickOnOrBefore<T extends { date: string }>(rows: readonly T[], date: string): T | null {
  let best: T | null = null;
  for (const r of rows) if (r.date <= date && (best === null || r.date > best.date)) best = r;
  return best;
}

export function putRates(db: DatabaseSync, rows: readonly RateRow[]): void {
  if (!rows.length) return;
  const stmt = db.prepare(
    "INSERT INTO rates (kind, key, date, value, source) VALUES (?, ?, ?, ?, ?) ON CONFLICT (kind, key, date) DO UPDATE SET value = excluded.value, source = excluded.source",
  );
  transaction(db, () => {
    for (const r of rows) stmt.run(r.kind, r.key, r.date, r.value, r.source);
  });
}

/** The last cached rate on or before `date`. For a month-end pass the month's last day. */
export function getRateOnOrBefore(db: DatabaseSync, kind: RateKind, key: string, date: string): RateRow | null {
  const row = db.prepare("SELECT kind, key, date, value, source FROM rates WHERE kind = ? AND key = ? AND date <= ? ORDER BY date DESC LIMIT 1").get(kind, key, date);
  return row ? ({ ...row } as unknown as RateRow) : null;
}

export function listRates(db: DatabaseSync): RateRow[] {
  return db.prepare("SELECT kind, key, date, value, source FROM rates ORDER BY kind, key, date").all().map((r) => ({ ...r }) as unknown as RateRow);
}

export function rateStats(db: DatabaseSync): { rows: number; latest: string | null } {
  const row = db.prepare("SELECT COUNT(*) AS n, MAX(date) AS latest FROM rates").get() as { n: number; latest: string | null };
  return { rows: row.n, latest: row.latest };
}
