import type { DatabaseSync } from "node:sqlite";
import { addMonths, monthOf } from "../core/months";
import { dec, mul, toMinor } from "../core/decimal";
import { buildSummary, type Summary } from "../core/summary";
import { idleCashEur, listAccounts, listPositions, listSnapshots } from "./repo";

/** The month "Close month" opens on: last month in the first days of a month, this month after that. */
export function defaultCloseMonth(today: string): string {
  const day = Number(today.slice(8, 10));
  return day <= 10 ? addMonths(monthOf(today), -1) : monthOf(today);
}

/** The idle-cash threshold in EUR cents. */
export function idleThresholdMinor(db: DatabaseSync): number {
  return toMinor(mul(dec(idleCashEur(db)), dec(100)), 0);
}

export function summaryFor(db: DatabaseSync, month: string): Summary {
  return buildSummary({
    month,
    accounts: listAccounts(db),
    positions: listPositions(db),
    snapshots: listSnapshots(db),
    idleCashThresholdMinor: idleThresholdMinor(db),
  });
}
