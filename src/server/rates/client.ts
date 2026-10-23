import type { DatabaseSync } from "node:sqlite";
import { dec, decToString } from "../../core/decimal";
import { eurPerUnit } from "../../core/money";
import { addDays, daysBetween, lastDayOf } from "../../core/months";
import type { Position, RateKind, RateRow, RateSource } from "../../core/types";
import { coingeckoId, decodeCbr, parseCbrXml, parseCoingeckoHistory, parseCoingeckoSimple, parseEcbXml, rubPerEur } from "./parse";
import { getRateOnOrBefore, putRates } from "./store";

/**
 * Every network call Finance K makes for rates goes through this module and its injectable
 * fetch, so tests never touch the network. Three public sources, no keys, no user data sent.
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const ECB_90D_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export const ECB_HIST_URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
export const CBR_URL = "https://www.cbr.ru/scripts/XML_daily.asp";
export const COINGECKO_URL = "https://api.coingecko.com/api/v3";

/** Past this many days before today the 90-day ECB file no longer reaches the date. */
const ECB_90D_REACH_DAYS = 85;
/** A cached rate older than this, relative to the target date, triggers a fetch. ECB and CBR skip at most a few days. */
const MAX_AGE_DAYS: Record<RateKind, number> = { fx: 7, crypto: 3 };

const defaultFetch: FetchLike = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000), cache: "no-store" });

export interface FetchReport {
  fetched: string[];
  failed: { what: string; reason: string }[];
}

const emptyReport = (): FetchReport => ({ fetched: [], failed: [] });

async function getOk(fetchImpl: FetchLike, url: string): Promise<Response> {
  const res = await fetchImpl(url, { headers: { accept: "application/json, application/xml, text/xml;q=0.9" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The date a month's rates are read at: its last day, or today while the month is still running. */
export function rateDateFor(month: string, today: string): string {
  const last = lastDayOf(month);
  return last < today ? last : today;
}

/** ECB daily reference rates, EUR base. Stores the window [date - 10 days, date] from the full history, everything from the 90-day file. */
export async function refreshEcb(db: DatabaseSync, date: string, today: string, fetchImpl: FetchLike = defaultFetch): Promise<FetchReport> {
  const report = emptyReport();
  const recent = daysBetween(date, today) <= ECB_90D_REACH_DAYS;
  const url = recent ? ECB_90D_URL : ECB_HIST_URL;
  try {
    const xml = await (await getOk(fetchImpl, url)).text();
    const from = addDays(date, -10);
    const rows: RateRow[] = parseEcbXml(xml)
      .filter((q) => recent || (q.date >= from && q.date <= date))
      .map((q) => ({ kind: "fx", key: q.currency, date: q.date, value: q.per_eur, source: "ecb" }));
    if (!rows.length) throw new Error("no rates in the response");
    putRates(db, rows);
    report.fetched.push("ECB reference rates");
  } catch (e) {
    report.failed.push({ what: "ECB reference rates", reason: message(e) });
  }
  return report;
}

const ddmmyyyy = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Bank of Russia daily rates. Stores RUB per 1 EUR as fx/RUB, the same convention as the ECB rows. */
export async function refreshCbr(db: DatabaseSync, date: string, fetchImpl: FetchLike = defaultFetch): Promise<FetchReport> {
  const report = emptyReport();
  try {
    const res = await getOk(fetchImpl, `${CBR_URL}?date_req=${ddmmyyyy(date)}`);
    const day = parseCbrXml(decodeCbr(await res.arrayBuffer()));
    const value = rubPerEur(day);
    if (!value) throw new Error("no EUR row in the response");
    putRates(db, [{ kind: "fx", key: "RUB", date: day.date, value, source: "cbr" }]);
    report.fetched.push("Bank of Russia RUB rate");
  } catch (e) {
    report.failed.push({ what: "Bank of Russia RUB rate", reason: message(e) });
  }
  return report;
}

/** CoinGecko public prices in EUR. Today (or later) uses the live price, a past date uses that day's history. */
export async function refreshCrypto(
  db: DatabaseSync,
  symbols: readonly string[],
  date: string,
  today: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<FetchReport> {
  const report = emptyReport();
  const known = symbols.filter((s) => coingeckoId(s));
  for (const s of symbols) if (!coingeckoId(s)) report.failed.push({ what: s, reason: "no CoinGecko mapping, enter the price by hand" });
  if (!known.length) return report;

  if (date >= today) {
    try {
      const ids = [...new Set(known.map((s) => coingeckoId(s)!))].join(",");
      const json: unknown = await (await getOk(fetchImpl, `${COINGECKO_URL}/simple/price?ids=${ids}&vs_currencies=eur`)).json();
      const prices = parseCoingeckoSimple(json, known);
      putRates(db, Object.entries(prices).map(([key, value]) => ({ kind: "crypto" as const, key, date: today, value, source: "coingecko" })));
      for (const s of known) {
        if (prices[s]) report.fetched.push(`${s} price`);
        else report.failed.push({ what: s, reason: "not in the response" });
      }
    } catch (e) {
      for (const s of known) report.failed.push({ what: s, reason: message(e) });
    }
    return report;
  }

  const dd = `${date.slice(8, 10)}-${date.slice(5, 7)}-${date.slice(0, 4)}`;
  for (const s of known) {
    try {
      const json: unknown = await (await getOk(fetchImpl, `${COINGECKO_URL}/coins/${coingeckoId(s)}/history?date=${dd}&localization=false`)).json();
      const price = parseCoingeckoHistory(json);
      if (!price) throw new Error("no EUR price for that date");
      putRates(db, [{ kind: "crypto", key: s, date, value: price, source: "coingecko" }]);
      report.fetched.push(`${s} price`);
    } catch (e) {
      report.failed.push({ what: s, reason: message(e) });
    }
  }
  return report;
}

export interface RateNeeds {
  /** Non-EUR cash currencies. */
  currencies: string[];
  /** Crypto tickers. */
  crypto: string[];
}

export function ratesNeeded(positions: readonly Position[]): RateNeeds {
  const currencies = new Set<string>();
  const crypto = new Set<string>();
  for (const p of positions) {
    if (p.kind === "cash" && p.currency && p.currency !== "EUR") currencies.add(p.currency);
    if (p.kind === "asset" && p.asset_kind === "crypto" && p.symbol) crypto.add(p.symbol);
  }
  return { currencies: [...currencies].sort(), crypto: [...crypto].sort() };
}

function isStale(db: DatabaseSync, kind: RateKind, key: string, date: string): boolean {
  const row = getRateOnOrBefore(db, kind, key, date);
  return row === null || daysBetween(row.date, date) > MAX_AGE_DAYS[kind];
}

/**
 * Fetches whatever the cache lacks for these needs at `date`. `force` refetches even when the
 * cache looks fresh (the "Refresh rates" button). Failures are reported, never thrown.
 */
export async function ensureRates(
  db: DatabaseSync,
  needs: RateNeeds,
  date: string,
  today: string,
  opts: { force?: boolean; fetch?: FetchLike } = {},
): Promise<FetchReport> {
  const fetchImpl = opts.fetch ?? defaultFetch;
  const force = opts.force ?? false;
  const report = emptyReport();
  const merge = (r: FetchReport): void => {
    report.fetched.push(...r.fetched);
    report.failed.push(...r.failed);
  };
  const ecbCurrencies = needs.currencies.filter((c) => c !== "RUB");
  if (ecbCurrencies.length && (force || ecbCurrencies.some((c) => isStale(db, "fx", c, date)))) {
    merge(await refreshEcb(db, date, today, fetchImpl));
  }
  if (needs.currencies.includes("RUB") && (force || isStale(db, "fx", "RUB", date))) {
    merge(await refreshCbr(db, date, fetchImpl));
  }
  const cryptoStale = needs.crypto.filter((s) => force || isStale(db, "crypto", s, date));
  if (cryptoStale.length) merge(await refreshCrypto(db, cryptoStale, date, today, fetchImpl));
  return report;
}

export interface FoundRate {
  /** EUR per one unit. */
  rate: string;
  date: string;
  source: RateSource;
}

/** The cached EUR rate for a position at a month-end date: the last one on or before it. Null when the cache has none. */
export function cachedRateFor(db: DatabaseSync, position: Pick<Position, "kind" | "currency" | "asset_kind" | "symbol">, date: string): FoundRate | null {
  if (position.kind === "cash") {
    if (position.currency === "EUR") return { rate: "1", date, source: "identity" };
    const row = getRateOnOrBefore(db, "fx", position.currency!, date);
    if (!row) return null;
    return { rate: eurPerUnit(row.value), date: row.date, source: row.source === "cbr" ? "cbr" : "ecb" };
  }
  if (position.asset_kind === "crypto") {
    const row = getRateOnOrBefore(db, "crypto", position.symbol!, date);
    if (!row) return null;
    return { rate: decToString(dec(row.value)), date: row.date, source: "coingecko" };
  }
  return null;
}
