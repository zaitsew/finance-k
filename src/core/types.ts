/** Domain types. Field names match the SQLite columns and the export file (snake_case). */

export const ACCOUNT_KINDS = ["bank", "broker", "crypto_exchange", "wallet", "cash", "pension", "other"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];

export const ACCOUNT_STATUSES = ["open", "closed"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ACCOUNT_SOURCES = ["manual", "csv", "enable_banking", "exchange_api", "address"] as const;
export type AccountSource = (typeof ACCOUNT_SOURCES)[number];

export const ASSET_KINDS = ["crypto", "security"] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

/** The bank ids BankJar knows (its `bank_slug` values). */
export const BANKJAR_BANK_IDS = [
  "abanca",
  "b100",
  "bankinter",
  "bbva",
  "caixabank",
  "cajamar",
  "deutsche-bank",
  "ibercaja",
  "imagin",
  "ing",
  "kutxabank",
  "mediolanum",
  "myinvestor",
  "n26",
  "openbank",
  "pibank",
  "raisin",
  "revolut",
  "sabadell",
  "santander",
  "self-bank",
  "trade-republic",
  "unicaja",
  "wizink",
] as const;

export const KIND_LABELS: Record<AccountKind, string> = {
  bank: "Bank",
  broker: "Broker",
  crypto_exchange: "Crypto exchange",
  wallet: "Wallet",
  cash: "Cash",
  pension: "Pension",
  other: "Other",
};

export const SOURCE_LABELS: Record<AccountSource, string> = {
  manual: "Manual",
  csv: "CSV import",
  enable_banking: "Enable Banking",
  exchange_api: "Exchange API",
  address: "Public address",
};

export interface Account {
  id: number;
  institution: string;
  name: string;
  kind: AccountKind;
  currency: string;
  iban_last4: string | null;
  opened_on: string | null;
  purpose: string | null;
  fees_note: string | null;
  status: AccountStatus;
  closed_on: string | null;
  source: AccountSource;
  bankjar_bank_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type PositionKind = "cash" | "asset";

export interface Position {
  id: number;
  account_id: number;
  kind: PositionKind;
  /** ISO 4217 code; set for cash positions only. */
  currency: string | null;
  asset_kind: AssetKind | null;
  /** Ticker such as BTC or VWCE; set for asset positions only. */
  symbol: string | null;
  created_at: string;
}

export type RateSource = "identity" | "ecb" | "cbr" | "coingecko" | "manual";

export interface Snapshot {
  position_id: number;
  month: string;
  /** Cash: integer minor units of the position currency. */
  amount_minor: number | null;
  /** Asset: decimal string. */
  quantity: string | null;
  /** EUR per one unit of the cash currency or of the asset, as a decimal string. */
  rate: string;
  rate_date: string | null;
  rate_source: RateSource;
  /** The EUR value at close, in cents, rounded once when saved. */
  value_eur_minor: number;
  captured_at: string;
}

export type RateKind = "fx" | "crypto";

/** A cached rate. fx: `value` is units of `key` per 1 EUR (ECB/CBR convention). crypto: `value` is EUR per 1 unit of `key`. */
export interface RateRow {
  kind: RateKind;
  key: string;
  date: string;
  value: string;
  source: string;
}

export function positionLabel(p: Pick<Position, "kind" | "currency" | "symbol">): string {
  return p.kind === "cash" ? `Cash ${p.currency}` : `${p.symbol}`;
}
