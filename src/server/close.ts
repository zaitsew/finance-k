import type { DatabaseSync } from "node:sqlite";
import { minorToInput } from "../core/money";
import { monthOf } from "../core/months";
import { existsIn, positionDueIn } from "../core/summary";
import type { Account, Position, RateSource, Snapshot } from "../core/types";
import { listAccounts, listPositions, listSnapshots } from "./repo";
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
  const accounts = listAccounts(db).filter((a) => existsIn(a, month) && !(a.status === "closed" && a.closed_on && monthOf(a.closed_on) === month));
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
