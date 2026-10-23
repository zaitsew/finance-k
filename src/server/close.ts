import type { DatabaseSync } from "node:sqlite";
import { dec, decToString } from "../core/decimal";
import { currencyDecimals, minorToInput, parseMinorInput, parseNumberInput, parseRateInput, valueEurMinor } from "../core/money";
import { isMonth, monthOf } from "../core/months";
import { AccountInputSchema, firstIssue } from "../core/schemas";
import { closedBy, existsIn, positionDueIn } from "../core/summary";
import { positionLabel, type Account, type Position, type RateSource, type Snapshot } from "../core/types";
import { transaction } from "./db";
import { createAccount, deleteSnapshot, listAccounts, listPositions, listSnapshots, saveSnapshot, type SnapshotInput } from "./repo";
import { cachedRateFor, rateDateFor } from "./rates/client";

export type RateHint = "identity" | "saved" | "cache" | "previous" | "missing";

export interface CloseRow {
  account: Account;
  position: Position;
  /** The latest close before this month. */
  last: Snapshot | null;
  /** The close already saved for this month. */
  saved: Snapshot | null;
  /** Text for the amount or quantity box. */
  amount: string;
  /** Text for the rate box, EUR per one unit. Empty when none is known. */
  rate: string;
  rate_source: RateSource;
  rate_date: string | null;
  rate_hint: RateHint;
  /** The cached rate, when it differs from the one in `rate` (a saved rate older than a refresh). */
  cached_rate: string | null;
}

export interface ClosePlan {
  month: string;
  rate_date: string;
  rows: CloseRow[];
  /** Cash accounts present, to decide which currencies still need a "cash on hand" row. */
  cash_currencies: string[];
}

/** Everything the "Close the month" screen shows: each open account's positions, last value prefilled. */
export function buildClosePlan(db: DatabaseSync, month: string, today: string): ClosePlan {
  const rateDate = rateDateFor(month, today);
  // An account closed in `month` contributes nothing to it (see closedBy), so it has no row to fill in.
  const accounts = listAccounts(db).filter((a) => existsIn(a, month) && !closedBy(a, month));
  const positions = listPositions(db);
  const snapshots = listSnapshots(db);
  const byPosition = new Map<number, Snapshot[]>();
  for (const s of snapshots) {
    const list = byPosition.get(s.position_id) ?? [];
    list.push(s);
    byPosition.set(s.position_id, list);
  }
  const rows: CloseRow[] = [];
  for (const account of accounts) {
    for (const position of positions.filter((p) => p.account_id === account.id)) {
      const list = byPosition.get(position.id) ?? [];
      const saved = list.find((s) => s.month === month) ?? null;
      const last = [...list].reverse().find((s) => s.month < month) ?? null;
      if (!saved && !positionDueIn(account, position, month)) continue;
      const base = saved ?? last;
      const amount = base ? (position.kind === "cash" ? minorToInput(base.amount_minor ?? 0, position.currency ?? "EUR") : (base.quantity ?? "")) : "";

      const cached = cachedRateFor(db, position, rateDate);
      let rate = "";
      let rate_source: RateSource = "manual";
      let rate_date: string | null = null;
      let rate_hint: RateHint = "missing";
      if (position.kind === "cash" && position.currency === "EUR") {
        rate = "1";
        rate_source = "identity";
        rate_hint = "identity";
      } else if (saved) {
        rate = saved.rate;
        rate_source = saved.rate_source;
        rate_date = saved.rate_date;
        rate_hint = "saved";
      } else if (cached) {
        rate = cached.rate;
        rate_source = cached.source;
        rate_date = cached.date;
        rate_hint = "cache";
      } else if (position.kind === "asset" && position.asset_kind === "security" && last) {
        rate = last.rate;
        rate_source = "manual";
        rate_hint = "previous";
      }
      rows.push({
        account,
        position,
        last,
        saved,
        amount,
        rate,
        rate_source,
        rate_date,
        rate_hint,
        cached_rate: cached && saved && cached.rate !== saved.rate ? cached.rate : null,
      });
    }
  }
  const cash_currencies = accounts.filter((a) => a.kind === "cash").flatMap((a) => positions.filter((p) => p.account_id === a.id && p.currency).map((p) => p.currency!));
  return { month, rate_date: rateDate, rows, cash_currencies };
}

export type SaveMonthResult = { ok: true; saved: number; cleared: number } | { ok: false; error: string };

export interface SaveMonthInput {
  month: string;
  today: string;
  /** Re-price rows with the cached rates instead of the rates typed in the form. */
  useCache: boolean;
  /** One form field by name; undefined when the form has no such field. */
  get: (name: string) => string | undefined;
}

/**
 * Saves the "Close the month" form in one transaction.
 * - A filled amount is saved (replacing any earlier close of that position and month).
 * - A field that is present but empty clears the saved close of that position and month, so it counts as
 *   "not closed yet" again. A position with no field in the form is left alone.
 * - Accounts closed in `month` or before have no rows and are never written.
 */
export function saveMonth(db: DatabaseSync, input: SaveMonthInput): SaveMonthResult {
  const { month, today, get } = input;
  if (!isMonth(month)) return { ok: false, error: "That is not a month" };
  if (month > monthOf(today)) return { ok: false, error: "A month can be closed only once it has started" };
  const rateDate = rateDateFor(month, today);
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));
  const saved = new Set(listSnapshots(db).filter((s) => s.month === month).map((s) => s.position_id));
  const toSave: SnapshotInput[] = [];
  const toClear: number[] = [];
  const errors: string[] = [];

  for (const position of listPositions(db)) {
    const account = accounts.get(position.account_id);
    if (!account || !existsIn(account, month) || closedBy(account, month)) continue;
    const raw = get(position.kind === "cash" ? `amount_${position.id}` : `qty_${position.id}`);
    if (raw === undefined) continue;
    if (raw.trim() === "") {
      if (saved.has(position.id)) toClear.push(position.id);
      continue;
    }
    const label = `${account.institution} ${account.name}, ${positionLabel(position)}`;

    let amount_minor: number | null = null;
    let quantity: string | null = null;
    if (position.kind === "cash") {
      amount_minor = parseMinorInput(raw, position.currency!);
      if (amount_minor === null) {
        errors.push(`${label}: enter an amount with at most ${currencyDecimals(position.currency!)} decimals that is not too large`);
        continue;
      }
    } else {
      quantity = parseNumberInput(raw);
      if (quantity === null || quantity.startsWith("-")) {
        errors.push(`${label}: enter a quantity of zero or more`);
        continue;
      }
    }

    let rate: string;
    let rate_source: RateSource;
    let rate_date: string | null;
    if (position.kind === "cash" && position.currency === "EUR") {
      rate = "1";
      rate_source = "identity";
      rate_date = null;
    } else {
      const cached = input.useCache ? cachedRateFor(db, position, rateDate) : null;
      if (cached) {
        rate = cached.rate;
        rate_source = cached.source;
        rate_date = cached.date;
      } else {
        const typed = parseRateInput(get(`rate_${position.id}`) ?? "");
        if (typed === null) {
          errors.push(`${label}: enter a rate above zero in EUR per 1 ${position.kind === "cash" ? position.currency : position.symbol}`);
          continue;
        }
        rate = typed;
        const original = parseNumberInput(get(`rate0_${position.id}`) ?? "");
        const source = (get(`src0_${position.id}`) ?? "") as RateSource;
        const untouched = original !== null && decToStringSafe(original) === rate;
        rate_source = untouched ? source : "manual";
        rate_date = untouched ? get(`date0_${position.id}`) || null : null;
      }
    }
    try {
      valueEurMinor(position, { amount_minor, quantity }, rate);
    } catch {
      errors.push(`${label}: that amount at that rate is too large`);
      continue;
    }
    toSave.push({ position, month, amount_minor, quantity, rate, rate_date, rate_source });
  }

  if (errors.length) return { ok: false, error: `${errors.slice(0, 4).join(". ")}${errors.length > 4 ? `. And ${errors.length - 4} more.` : "."}` };
  if (!toSave.length && !toClear.length) return { ok: false, error: "Nothing to save: fill in at least one amount" };

  transaction(db, () => {
    for (const s of toSave) saveSnapshot(db, s);
    for (const id of toClear) deleteSnapshot(db, id, month);
  });
  return { ok: true, saved: toSave.length, cleared: toClear.length };
}

function decToStringSafe(text: string): string {
  return decToString(dec(text));
}

/**
 * Adds a "Cash <currency>" account while closing `month`. It is dated to that month, so it shows in that
 * month's form even when the month is closed late.
 */
export function addCashOnHand(db: DatabaseSync, month: string, currencyRaw: string): { ok: true; id: number } | { ok: false; error: string } {
  const currency = currencyRaw.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Use a 3-letter currency code" };
  const parsed = AccountInputSchema.safeParse({
    institution: "Cash",
    name: `Cash ${currency}`,
    kind: "cash",
    currency,
    source: "manual",
    status: "open",
    opened_on: isMonth(month) ? `${month}-01` : "",
  });
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  return { ok: true, id: createAccount(db, parsed.data) };
}
