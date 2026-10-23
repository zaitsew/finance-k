import { detectDormant, type Dormant } from "./dormant";
import { addMonths, monthOf, monthRange } from "./months";
import { splitDelta, type Split } from "./split";
import type { Account, AccountKind, Position, Snapshot } from "./types";

export interface SummaryInput {
  month: string;
  accounts: readonly Account[];
  positions: readonly Position[];
  /** Every snapshot of every month. */
  snapshots: readonly Snapshot[];
  /** Idle-cash threshold in EUR cents. A bank account with more EUR cash than this is flagged. */
  idleCashThresholdMinor: number;
}

export type RowStatus = "ok" | "new" | "closed";

export interface PositionRow extends Split {
  position: Position;
  account: Account;
  value_eur_minor: number;
  previous_eur_minor: number | null;
  status: RowStatus;
}

export interface Group {
  key: string;
  value_eur_minor: number;
  share: number;
}

export interface NotClosed {
  account: Account;
  missing: Position[];
}

export interface IdleCash {
  account: Account;
  eur_minor: number;
}

export interface Summary {
  month: string;
  /** The previous calendar month. */
  previous_month: string;
  /** Sum of the snapshots saved for `month`. Positions not closed yet are not in it. */
  net_worth_eur_minor: number;
  /** Sum of the snapshots of the previous calendar month, or null when none exist. */
  previous_net_worth_eur_minor: number | null;
  /**
   * The split of the change since each position's last close. Null when nothing was closed before `month`.
   * `base_eur_minor` is the sum of those last closes: the value the change is measured against.
   */
  change: (Split & { positions: number; base_eur_minor: number }) | null;
  rows: PositionRow[];
  by_kind: Group[];
  by_currency: Group[];
  by_institution: Group[];
  series: { month: string; net_worth_eur_minor: number | null }[];
  not_closed: NotClosed[];
  new_accounts: Account[];
  closed_accounts: Account[];
  dormant: (Dormant & { account: Account })[];
  idle_cash: IdleCash[];
  snapshot_count: number;
}

/** The month an account starts to exist for the summary: its opening month, or the month it was entered. */
function startMonth(a: Account): string {
  return a.opened_on ? monthOf(a.opened_on) : monthOf(a.created_at);
}

/** Whether an account counts in `month`: opened by then, and not closed in an earlier month. */
export function existsIn(a: Account, month: string): boolean {
  if (startMonth(a) > month) return false;
  if (a.status === "closed" && a.closed_on && monthOf(a.closed_on) < month) return false;
  return true;
}

/**
 * Whether an account is closed by `month`: it was shut in that month or an earlier one. An account closed in
 * month M contributes nothing at M or later. Whatever it held at its last earlier close left as a flow in M, so
 * a balance saved for M itself is ignored everywhere (net worth, totals, series), never counted twice.
 */
export function closedBy(a: Account, month: string): boolean {
  return a.status === "closed" && a.closed_on !== null && monthOf(a.closed_on) <= month;
}

/**
 * Whether a position is expected to have a close in `month`. A position that came with the account
 * is due in every month the account exists; one added later is due from the month it was added.
 */
export function positionDueIn(account: Account, position: Position, month: string): boolean {
  if (monthOf(position.created_at) === monthOf(account.created_at)) return true;
  return monthOf(position.created_at) <= month;
}

function groupBy(rows: { key: string; value: number }[], total: number): Group[] {
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.key, (sums.get(r.key) ?? 0) + r.value);
  return [...sums.entries()]
    .map(([key, value_eur_minor]) => ({ key, value_eur_minor, share: total !== 0 ? value_eur_minor / total : 0 }))
    .sort((a, b) => b.value_eur_minor - a.value_eur_minor || a.key.localeCompare(b.key));
}

export function buildSummary(input: SummaryInput): Summary {
  const { month, accounts, positions, snapshots } = input;
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const snapsByPosition = new Map<number, Snapshot[]>();
  for (const s of snapshots) {
    const list = snapsByPosition.get(s.position_id) ?? [];
    list.push(s);
    snapsByPosition.set(s.position_id, list);
  }
  for (const list of snapsByPosition.values()) list.sort((a, b) => (a.month < b.month ? -1 : 1));

  const positionById = new Map(positions.map((p) => [p.id, p]));
  const totals = new Map<string, number>();
  for (const s of snapshots) {
    const owner = accountById.get(positionById.get(s.position_id)?.account_id ?? -1);
    if (owner && closedBy(owner, s.month)) continue;
    totals.set(s.month, (totals.get(s.month) ?? 0) + s.value_eur_minor);
  }

  const rows: PositionRow[] = [];
  const notClosed = new Map<number, Position[]>();
  const valueRows: { account: Account; position: Position; value: number }[] = [];
  const hasEarlier = snapshots.some((s) => s.month < month);

  for (const position of positions) {
    const account = accountById.get(position.account_id);
    if (!account) continue;
    const list = snapsByPosition.get(position.id) ?? [];
    const curr = list.find((s) => s.month === month) ?? null;
    const prev = [...list].reverse().find((s) => s.month < month) ?? null;

    if (closedBy(account, month)) {
      // Closed in `month` or before: nothing counts here, even a balance saved for the month itself.
      // In the month it closed, whatever it held at its last close left as a flow.
      const closedThisMonth = monthOf(account.closed_on!) === month;
      if (closedThisMonth && prev && hasEarlier) {
        rows.push({
          position,
          account,
          value_eur_minor: 0,
          previous_eur_minor: prev.value_eur_minor,
          status: "closed",
          ...splitDelta(position, prev, null),
        });
      }
      continue;
    }

    if (curr) {
      valueRows.push({ account, position, value: curr.value_eur_minor });
      if (hasEarlier) {
        rows.push({
          position,
          account,
          value_eur_minor: curr.value_eur_minor,
          previous_eur_minor: prev?.value_eur_minor ?? null,
          status: prev ? "ok" : "new",
          ...splitDelta(position, prev, curr),
        });
      }
      continue;
    }

    if (!existsIn(account, month)) continue;
    // Open and not closed yet. A position added after the account is due from its own month.
    if (positionDueIn(account, position, month)) {
      const list2 = notClosed.get(account.id) ?? [];
      list2.push(position);
      notClosed.set(account.id, list2);
    }
  }

  const netWorth = valueRows.reduce((sum, r) => sum + r.value, 0);
  const prevMonth = addMonths(month, -1);
  const previousTotal = totals.has(prevMonth) ? totals.get(prevMonth)! : null;

  let change: Summary["change"] = null;
  if (hasEarlier) {
    change = { total: 0, market: 0, fx: 0, flows: 0, positions: rows.length, base_eur_minor: 0 };
    for (const r of rows) {
      change.base_eur_minor += r.previous_eur_minor ?? 0;
      change.total += r.total;
      change.market += r.market;
      change.fx += r.fx;
      change.flows += r.flows;
    }
  }

  const accountKindOf = (a: Account): AccountKind => a.kind;
  const by_kind = groupBy(valueRows.map((r) => ({ key: accountKindOf(r.account), value: r.value })), netWorth);
  const by_currency = groupBy(
    valueRows.map((r) => ({ key: r.position.kind === "cash" ? r.position.currency! : r.position.symbol!, value: r.value })),
    netWorth,
  );
  const by_institution = groupBy(valueRows.map((r) => ({ key: r.account.institution, value: r.value })), netWorth);

  const series = monthRange(month, 12).map((m) => ({ month: m, net_worth_eur_minor: totals.has(m) ? totals.get(m)! : null }));

  const dormantAccounts = accounts.filter((a) => existsIn(a, month));
  const dormant = detectDormant(dormantAccounts, positions, snapshots, month).map((d) => ({ ...d, account: accountById.get(d.account_id)! }));

  const idle: IdleCash[] = [];
  const idleByAccount = new Map<number, number>();
  for (const r of valueRows) {
    if (r.account.kind === "bank" && r.account.status === "open" && r.position.kind === "cash" && r.position.currency === "EUR") {
      idleByAccount.set(r.account.id, (idleByAccount.get(r.account.id) ?? 0) + r.value);
    }
  }
  for (const [id, eur] of idleByAccount) {
    if (eur > input.idleCashThresholdMinor) idle.push({ account: accountById.get(id)!, eur_minor: eur });
  }
  idle.sort((a, b) => b.eur_minor - a.eur_minor);

  return {
    month,
    previous_month: prevMonth,
    net_worth_eur_minor: netWorth,
    previous_net_worth_eur_minor: previousTotal,
    change,
    rows: rows.sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.account.name.localeCompare(b.account.name)),
    by_kind,
    by_currency,
    by_institution,
    series,
    not_closed: [...notClosed.entries()].map(([id, missing]) => ({ account: accountById.get(id)!, missing })),
    new_accounts: accounts.filter((a) => a.opened_on !== null && monthOf(a.opened_on) === month),
    closed_accounts: accounts.filter((a) => a.status === "closed" && a.closed_on !== null && monthOf(a.closed_on) === month),
    dormant,
    idle_cash: idle,
    snapshot_count: valueRows.length,
  };
}

export interface AccountLastClose {
  eur_minor: number;
  /** The month the figure is as of: the latest month any position of the account was closed. */
  month: string;
  /** Positions with no close in that month. They are not in the figure. */
  missing: number;
}

/**
 * The account's latest close, for one month only: the positions closed in the account's latest month are summed,
 * and the others are counted in `missing` instead of being carried over from an older month.
 * A balance saved for the month an account closed (or later) does not count.
 */
export function accountLastClose(account: Account, positions: readonly Position[], snapshots: readonly Snapshot[]): AccountLastClose | null {
  const own = positions.filter((p) => p.account_id === account.id);
  const latest = new Map<number, Snapshot>();
  for (const s of snapshots) {
    if (!own.some((p) => p.id === s.position_id) || closedBy(account, s.month)) continue;
    const cur = latest.get(s.position_id);
    if (!cur || s.month > cur.month) latest.set(s.position_id, s);
  }
  if (!latest.size) return null;
  let month = "";
  for (const s of latest.values()) if (s.month > month) month = s.month;
  let eur = 0;
  for (const s of latest.values()) if (s.month === month) eur += s.value_eur_minor;
  const missing = own.filter((p) => latest.get(p.id)?.month !== month && (latest.has(p.id) || positionDueIn(account, p, month))).length;
  return { eur_minor: eur, month, missing };
}
