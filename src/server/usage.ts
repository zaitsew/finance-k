import { dataDir, openReadOnly } from "./db";

/**
 * Counters for `./check.sh usage` and `teyla products`, read straight from the database.
 * Opens read-only and never creates anything. Lines are key=value.
 */
export function usageLines(dir: string = dataDir()): string[] {
  let db;
  try {
    db = openReadOnly(dir);
  } catch {
    return ["usage_probe=no_db"];
  }
  if (!db) return ["usage_probe=no_db"];
  try {
    const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
    const last = db.prepare("SELECT MAX(month) AS m FROM snapshots").get() as { m: string | null };
    return [
      `accounts_open=${n("SELECT COUNT(*) AS n FROM accounts WHERE status = 'open'")}`,
      `accounts_closed=${n("SELECT COUNT(*) AS n FROM accounts WHERE status = 'closed'")}`,
      `months_closed=${n("SELECT COUNT(DISTINCT month) AS n FROM snapshots")}`,
      `last_closed_month=${last.m ?? "none"}`,
    ];
  } catch {
    // A file that is not a Finance K database, or one that was never migrated.
    return ["usage_probe=no_db"];
  } finally {
    db.close();
  }
}
