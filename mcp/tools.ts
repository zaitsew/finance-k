import { add, dec, decToString, type Dec } from "../src/core/decimal";
import { minorToInput } from "../src/core/money";
import { isMonth } from "../src/core/months";
import { accountLastClose, buildSummary, closedBy, type Summary } from "../src/core/summary";
import { positionLabel, type Account, type Position, type Snapshot } from "../src/core/types";
import { DataError, type Ledger } from "./data";

/** Every tool here only reads. There is no tool that writes, fetches, or moves money. */
export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { title: string; readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false };
  run(input: Record<string, unknown>, ledger: Ledger): unknown;
}

const eur = (minor: number): string => minorToInput(minor, "EUR");
const pct = (part: number, whole: number): string => (whole === 0 ? "0.0" : ((part / whole) * 100).toFixed(1));

const monthProp = {
  type: "string",
  pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
  description: "Month as YYYY-MM. Defaults to the latest month with a saved close.",
};

function resolveMonth(input: Record<string, unknown>, ledger: Ledger): string {
  if (ledger.months.length === 0) throw new DataError("No month has been closed yet. Close a month in the Finance K app first.");
  const raw = input.month;
  if (raw === undefined || raw === null || raw === "") return ledger.months[ledger.months.length - 1]!;
  if (typeof raw !== "string" || !isMonth(raw)) throw new DataError(`month must look like 2026-09, got ${JSON.stringify(raw)}.`);
  if (!ledger.months.includes(raw)) throw new DataError(`No close saved for ${raw}. Months with a close: ${ledger.months.join(", ")}.`);
  return raw;
}

function reject(input: Record<string, unknown>, allowed: string[]): void {
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new DataError(`Unknown argument "${key}". This tool takes: ${allowed.join(", ") || "no arguments"}.`);
}

/** The close of each position in `month`, for accounts still counted then. A balance saved for or after an account's closing month is ignored, as in the app. */
function closesOf(ledger: Ledger, month: string): { account: Account; position: Position; snap: Snapshot }[] {
  const accountById = new Map(ledger.accounts.map((a) => [a.id, a]));
  const positionById = new Map(ledger.positions.map((p) => [p.id, p]));
  const out: { account: Account; position: Position; snap: Snapshot }[] = [];
  for (const snap of ledger.snapshots) {
    if (snap.month !== month) continue;
    const position = positionById.get(snap.position_id);
    const account = position && accountById.get(position.account_id);
    if (!position || !account || closedBy(account, month)) continue;
    out.push({ account, position, snap });
  }
  return out.sort((a, b) => b.snap.value_eur_minor - a.snap.value_eur_minor || a.account.id - b.account.id || a.position.id - b.position.id);
}

function summaryOf(ledger: Ledger, month: string): Summary {
  // The idle-cash threshold is not reported by any tool, so it is not read.
  return buildSummary({ month, accounts: ledger.accounts, positions: ledger.positions, snapshots: ledger.snapshots, idleCashThresholdMinor: 0 });
}

const accountRef = (a: Account) => ({ account_id: a.id, institution: a.institution, account: a.name });

const nativeOf = (position: Position, snap: Snapshot): { amount: string; unit: string } =>
  position.kind === "cash"
    ? { amount: minorToInput(snap.amount_minor ?? 0, position.currency ?? "EUR"), unit: position.currency ?? "EUR" }
    : { amount: decToString(dec(snap.quantity ?? "0")), unit: position.symbol ?? "" };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const TOOLS: Tool[] = [
  {
    name: "list_accounts",
    title: "List accounts",
    description:
      "List the accounts in the person's Finance K registry: institution, name, kind, currency, status, last four IBAN digits, the positions each holds, and each account's latest close in EUR. Also lists the months that have a saved close. Read-only.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["open", "closed", "all"], description: "Which accounts to list. Defaults to all." } },
      additionalProperties: false,
    },
    annotations: { title: "List accounts", ...READ_ONLY },
    run(input, ledger) {
      reject(input, ["status"]);
      const status = input.status ?? "all";
      if (status !== "open" && status !== "closed" && status !== "all") throw new DataError('status must be "open", "closed" or "all".');
      const accounts = ledger.accounts.filter((a) => status === "all" || a.status === status);
      return {
        count: accounts.length,
        months_with_a_close: ledger.months,
        accounts: accounts.map((a) => {
          const last = accountLastClose(a, ledger.positions, ledger.snapshots);
          return {
            account_id: a.id,
            institution: a.institution,
            name: a.name,
            kind: a.kind,
            currency: a.currency,
            iban_last4: a.iban_last4,
            status: a.status,
            opened_on: a.opened_on,
            closed_on: a.closed_on,
            purpose: a.purpose,
            positions: ledger.positions.filter((p) => p.account_id === a.id).map((p) => positionLabel(p)),
            latest_close: last ? { month: last.month, value_eur: eur(last.eur_minor), positions_without_a_close_that_month: last.missing } : null,
          };
        }),
      };
    },
  },
  {
    name: "get_balances",
    title: "Get balances at a month end",
    description:
      "Balances of every position at the end of one month, in the position's own currency or asset and in EUR, with the rate used and the net worth total. Accounts that exist but have no close for that month are listed separately and are never counted as zero. Read-only.",
    inputSchema: {
      type: "object",
      properties: { month: monthProp, account_id: { type: "integer", description: "Only the positions of this account. The net worth total still covers every account." } },
      additionalProperties: false,
    },
    annotations: { title: "Get balances at a month end", ...READ_ONLY },
    run(input, ledger) {
      reject(input, ["month", "account_id"]);
      const month = resolveMonth(input, ledger);
      let accountId: number | undefined;
      if (input.account_id !== undefined) {
        if (!Number.isInteger(input.account_id)) throw new DataError("account_id must be an integer. Use list_accounts to see the ids.");
        accountId = input.account_id as number;
        if (!ledger.accounts.some((a) => a.id === accountId)) throw new DataError(`No account with id ${accountId}. Use list_accounts to see the ids.`);
      }
      const summary = summaryOf(ledger, month);
      const closes = closesOf(ledger, month).filter((c) => accountId === undefined || c.account.id === accountId);
      return {
        month,
        net_worth_eur: eur(summary.net_worth_eur_minor),
        balances: closes.map(({ account, position, snap }) => {
          const native = nativeOf(position, snap);
          return {
            ...accountRef(account),
            position: positionLabel(position),
            amount: native.amount,
            unit: native.unit,
            rate_eur_per_unit: snap.rate,
            rate_source: snap.rate_source,
            rate_date: snap.rate_date,
            value_eur: eur(snap.value_eur_minor),
          };
        }),
        shown_total_eur: eur(closes.reduce((sum, c) => sum + c.snap.value_eur_minor, 0)),
        accounts_not_closed_yet: summary.not_closed
          .filter((n) => accountId === undefined || n.account.id === accountId)
          .map((n) => ({ ...accountRef(n.account), positions_missing: n.missing.map((p) => positionLabel(p)) })),
      };
    },
  },
  {
    name: "get_monthly_changes",
    title: "Get month-over-month changes",
    description:
      "How net worth moved into a month. Gives net worth for the month and for the calendar month before it, and splits the change since each position's last close into market moves (assets), FX (non-EUR cash) and flows (deposits, withdrawals, interest, new or closed accounts), in EUR, with the split per position. Read-only.",
    inputSchema: { type: "object", properties: { month: monthProp }, additionalProperties: false },
    annotations: { title: "Get month-over-month changes", ...READ_ONLY },
    run(input, ledger) {
      reject(input, ["month"]);
      const month = resolveMonth(input, ledger);
      const s = summaryOf(ledger, month);
      const delta = s.previous_net_worth_eur_minor === null ? null : s.net_worth_eur_minor - s.previous_net_worth_eur_minor;
      return {
        month,
        previous_month: s.previous_month,
        net_worth_eur: eur(s.net_worth_eur_minor),
        previous_net_worth_eur: s.previous_net_worth_eur_minor === null ? null : eur(s.previous_net_worth_eur_minor),
        net_worth_change_eur: delta === null ? null : eur(delta),
        change_since_last_close: s.change && {
          positions: s.change.positions,
          measured_against_eur: eur(s.change.base_eur_minor),
          total_eur: eur(s.change.total),
          market_eur: eur(s.change.market),
          fx_eur: eur(s.change.fx),
          flows_eur: eur(s.change.flows),
        },
        by_position: s.rows.map((r) => ({
          ...accountRef(r.account),
          position: positionLabel(r.position),
          status: r.status,
          previous_eur: r.previous_eur_minor === null ? null : eur(r.previous_eur_minor),
          value_eur: eur(r.value_eur_minor),
          total_eur: eur(r.total),
          market_eur: eur(r.market),
          fx_eur: eur(r.fx),
          flows_eur: eur(r.flows),
        })),
        new_accounts: s.new_accounts.map((a) => ({ account_id: a.id, institution: a.institution, account: a.name })),
        closed_accounts: s.closed_accounts.map((a) => ({ account_id: a.id, institution: a.institution, account: a.name })),
        accounts_not_closed_yet: s.not_closed.map((n) => ({ ...accountRef(n.account), positions_missing: n.missing.map((p) => positionLabel(p)) })),
        notes: [
          "net_worth_change_eur compares two month totals. It also moves when an account was closed in one month and not the other.",
          "change_since_last_close is measured per position against its own previous close, and total = market + fx + flows.",
        ],
      };
    },
  },
  {
    name: "get_net_worth_by_currency",
    title: "Get net worth by currency",
    description:
      "Net worth at a month end grouped by currency or asset: the native total in that unit, the EUR value, and the share of net worth. Fiat cash, crypto and securities are separate groups. Read-only.",
    inputSchema: { type: "object", properties: { month: monthProp }, additionalProperties: false },
    annotations: { title: "Get net worth by currency", ...READ_ONLY },
    run(input, ledger) {
      reject(input, ["month"]);
      const month = resolveMonth(input, ledger);
      const total = summaryOf(ledger, month).net_worth_eur_minor;
      const groups = new Map<string, { code: string; kind: string; minor: number; quantity: Dec; value: number; positions: number }>();
      for (const { position, snap } of closesOf(ledger, month)) {
        const kind = position.kind === "cash" ? "fiat" : position.asset_kind!;
        const code = position.kind === "cash" ? position.currency! : position.symbol!;
        const key = `${kind}:${code}`;
        const g = groups.get(key) ?? { code, kind, minor: 0, quantity: dec(0), value: 0, positions: 0 };
        if (position.kind === "cash") g.minor += snap.amount_minor ?? 0;
        else g.quantity = add(g.quantity, dec(snap.quantity ?? "0"));
        g.value += snap.value_eur_minor;
        g.positions += 1;
        groups.set(key, g);
      }
      return {
        month,
        net_worth_eur: eur(total),
        currencies: [...groups.values()]
          .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code))
          .map((g) => ({
            code: g.code,
            kind: g.kind,
            native_total: g.kind === "fiat" ? minorToInput(g.minor, g.code) : decToString(g.quantity),
            value_eur: eur(g.value),
            share_percent: pct(g.value, total),
            positions: g.positions,
          })),
      };
    },
  },
];
