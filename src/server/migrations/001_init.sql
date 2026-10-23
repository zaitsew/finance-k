-- Finance K schema, version 1. Money is integer minor units, quantities and rates are decimal text.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institution TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bank', 'broker', 'crypto_exchange', 'wallet', 'cash', 'pension', 'other')),
  currency TEXT NOT NULL CHECK (length(currency) = 3),
  -- The last four digits only. A full IBAN is never stored.
  iban_last4 TEXT CHECK (iban_last4 IS NULL OR (length(iban_last4) = 4 AND iban_last4 NOT GLOB '*[^0-9]*')),
  opened_on TEXT,
  purpose TEXT,
  fees_note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_on TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'csv', 'enable_banking', 'exchange_api', 'address')),
  bankjar_bank_id TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('cash', 'asset')),
  currency TEXT,
  asset_kind TEXT CHECK (asset_kind IS NULL OR asset_kind IN ('crypto', 'security')),
  symbol TEXT,
  created_at TEXT NOT NULL,
  CHECK (
    (kind = 'cash' AND currency IS NOT NULL AND asset_kind IS NULL AND symbol IS NULL) OR
    (kind = 'asset' AND currency IS NULL AND asset_kind IS NOT NULL AND symbol IS NOT NULL)
  )
);
CREATE UNIQUE INDEX positions_cash_unique ON positions (account_id, currency) WHERE kind = 'cash';
CREATE UNIQUE INDEX positions_asset_unique ON positions (account_id, asset_kind, symbol) WHERE kind = 'asset';

CREATE TABLE snapshots (
  position_id INTEGER NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[01][0-9]'),
  amount_minor INTEGER,
  quantity TEXT,
  -- EUR per one unit of the cash currency or of the asset, captured at close.
  rate TEXT NOT NULL,
  rate_date TEXT,
  rate_source TEXT NOT NULL CHECK (rate_source IN ('identity', 'ecb', 'cbr', 'coingecko', 'manual')),
  value_eur_minor INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  PRIMARY KEY (position_id, month),
  CHECK ((amount_minor IS NULL) <> (quantity IS NULL))
) WITHOUT ROWID;

-- Cached rates. fx: units of `key` per 1 EUR. crypto: EUR per 1 unit of `key`.
CREATE TABLE rates (
  kind TEXT NOT NULL CHECK (kind IN ('fx', 'crypto')),
  key TEXT NOT NULL,
  date TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL,
  PRIMARY KEY (kind, key, date)
) WITHOUT ROWID;

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) WITHOUT ROWID;
