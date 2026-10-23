import { addMonths } from "./months";
import { normalize } from "./decimal";
import type { Account, Position, Snapshot } from "./types";

/** An open account whose balance stayed the same at this many consecutive month-ends is dormant. */
export const DORMANT_MONTHS = 6;

export interface Dormant {
  account_id: number;
  /** The first month-end of the unchanged run. */
  unchanged_since: string;
  /** How many month-end changes in a row were zero, ending at the checked month. */
  unchanged_months: number;
}

/** Native balances of an account at one month-end, as a comparable string. Null when it has no snapshot. */
export function balanceSignature(positionIds: readonly number[], byKey: Map<string, Snapshot>, month: string): string | null {
  const parts: string[] = [];
  for (const id of [...positionIds].sort((a, b) => a - b)) {
    const s = byKey.get(`${id}|${month}`);
    if (!s) continue;
    parts.push(`${id}:${s.amount_minor !== null ? String(s.amount_minor) : normalize(s.quantity ?? "0")}`);
  }
  return parts.length ? parts.join(",") : null;
}

/**
 * Dormant accounts at `month`: open accounts with a snapshot at every one of the last
 * DORMANT_MONTHS + 1 month-ends and the same native balance at all of them. A balance is
 * the native amount or quantity of each position, never the EUR value, so a rate move does
 * not wake an account up. A missing month breaks the run: nothing is assumed about it.
 */
export function detectDormant(
  accounts: readonly Account[],
  positions: readonly Position[],
  snapshots: readonly Snapshot[],
  month: string,
  window: number = DORMANT_MONTHS,
): Dormant[] {
  const byKey = new Map<string, Snapshot>();
  for (const s of snapshots) byKey.set(`${s.position_id}|${s.month}`, s);
  const out: Dormant[] = [];
  for (const account of accounts) {
    if (account.status !== "open") continue;
    const ids = positions.filter((p) => p.account_id === account.id).map((p) => p.id);
    if (!ids.length) continue;
    const now = balanceSignature(ids, byKey, month);
    if (now === null) continue;
    let run = 0;
    let since = month;
    for (let back = 1; back <= 600; back++) {
      const m = addMonths(month, -back);
      if (balanceSignature(ids, byKey, m) !== now) break;
      run = back;
      since = m;
    }
    if (run >= window) out.push({ account_id: account.id, unchanged_since: since, unchanged_months: run });
  }
  return out;
}
