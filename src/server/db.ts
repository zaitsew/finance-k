import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Where the data lives. Never inside the repo: `FINANCE_K_DATA_DIR`, else the Mac's Application Support folder. */
export function dataDir(): string {
  const fromEnv = process.env.FINANCE_K_DATA_DIR?.trim();
  if (fromEnv) return fromEnv;
  return join(homedir(), "Library", "Application Support", "finance-k");
}

export const DB_FILE = "finance-k.sqlite";

export function dbPath(dir: string = dataDir()): string {
  return join(dir, DB_FILE);
}

export function migrationsDir(): string {
  return join(/* turbopackIgnore: true */ process.cwd(), "src", "server", "migrations");
}

interface Migration {
  version: number;
  sql: string;
  file: string;
}

export function loadMigrations(dir: string = migrationsDir()): Migration[] {
  return readdirSync(/* turbopackIgnore: true */ dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((file) => ({ version: Number(file.split("_")[0]), sql: readFileSync(/* turbopackIgnore: true */ join(dir, file), "utf8"), file }));
}

/** Runs `fn` in a transaction: commit on return, roll back on a throw. */
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // The failing statement may already have ended the transaction.
    }
    throw error;
  }
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/** Applies every migration above the database's `user_version`, each in its own transaction. */
export function migrate(db: DatabaseSync): number {
  const migrations = loadMigrations();
  let version = currentVersion(db);
  for (const m of migrations) {
    if (m.version <= version) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
    version = m.version;
  }
  return version;
}

type Cache = Map<string, DatabaseSync>;
const globals = globalThis as unknown as { __financeKDbs?: Cache };

/** Opens (creating if needed) the database in `dir`, migrated. One connection per path per process. */
export function openDb(dir: string = dataDir()): DatabaseSync {
  const cache: Cache = (globals.__financeKDbs ??= new Map());
  const existing = cache.get(dir);
  if (existing) return existing;
  if (!existsSync(/* turbopackIgnore: true */ dir)) mkdirSync(/* turbopackIgnore: true */ dir, { recursive: true, mode: 0o700 });
  const file = dbPath(dir);
  const fresh = !existsSync(/* turbopackIgnore: true */ file);
  const db = new DatabaseSync(file);
  if (fresh) chmodSync(/* turbopackIgnore: true */ file, 0o600);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  cache.set(dir, db);
  return db;
}

export function closeDb(dir: string = dataDir()): void {
  const cache = globals.__financeKDbs;
  const db = cache?.get(dir);
  if (db) {
    db.close();
    cache!.delete(dir);
  }
}

/** Opens an existing database read-only without migrating it. Null when there is none. */
export function openReadOnly(dir: string = dataDir()): DatabaseSync | null {
  const file = dbPath(dir);
  if (!existsSync(/* turbopackIgnore: true */ file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}
