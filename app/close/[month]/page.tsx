import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ActionForm } from "../../../components/ActionForm";
import { Banner } from "../../../components/ui";
import { formatEur, formatMoney, formatRate } from "../../../src/core/money";
import { addMonths, isMonth, monthLabel, monthOf, todayLocal } from "../../../src/core/months";
import { KIND_LABELS, positionLabel } from "../../../src/core/types";
import { addCashAccountAction, refreshRatesAction, saveMonthAction } from "../../../src/server/actions";
import { buildClosePlan, type CloseRow } from "../../../src/server/close";
import { openDb } from "../../../src/server/db";
import { ratesNeeded } from "../../../src/server/rates/client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Close month" };

const CASH_QUICK = ["EUR", "USD", "RUB"];

function unitOf(row: CloseRow): string {
  return row.position.kind === "cash" ? row.position.currency! : row.position.symbol!;
}

function hintText(row: CloseRow): string {
  switch (row.rate_hint) {
    case "saved":
      return `saved${row.rate_source === "manual" ? ", typed by hand" : `, ${row.rate_source.toUpperCase()}${row.rate_date ? ` ${row.rate_date}` : ""}`}`;
    case "cache":
      return `${row.rate_source.toUpperCase()}, ${row.rate_date}`;
    case "previous":
      return "last close’s price, check it";
    case "missing":
      return row.position.kind === "asset" && row.position.asset_kind === "security" ? "type the price" : "refresh rates or type it";
    default:
      return "";
  }
}

export default async function ClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ month: string }>;
  searchParams: Promise<{ notice?: string; kind?: string }>;
}) {
  const { month } = await params;
  const sp = await searchParams;
  if (!isMonth(month)) notFound();
  const today = todayLocal();
  const db = openDb();
  const plan = buildClosePlan(db, month, today);
  const future = month > monthOf(today);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);

  const cashRows = plan.rows.filter((r) => r.account.kind === "cash");
  const otherRows = plan.rows.filter((r) => r.account.kind !== "cash");
  const groups = new Map<number, CloseRow[]>();
  for (const r of otherRows) groups.set(r.account.id, [...(groups.get(r.account.id) ?? []), r]);
  const cashGroups = new Map<number, CloseRow[]>();
  for (const r of cashRows) cashGroups.set(r.account.id, [...(cashGroups.get(r.account.id) ?? []), r]);

  const needs = ratesNeeded(plan.rows.map((r) => r.position));
  const needsRates = needs.currencies.length + needs.crypto.length > 0;
  const missing = plan.rows.filter((r) => r.rate_hint === "missing").length;
  const missingCash = CASH_QUICK.filter((c) => !plan.cash_currencies.includes(c));
  const saved = plan.rows.filter((r) => r.saved).length;

  const renderRow = (r: CloseRow) => {
    const id = r.position.id;
    const isCash = r.position.kind === "cash";
    const eurCash = isCash && r.position.currency === "EUR";
    const lastText = r.last
      ? isCash
        ? formatMoney(r.last.amount_minor ?? 0, r.position.currency!)
        : `${r.last.quantity} ${r.position.symbol}`
      : "—";
    return (
      <tr key={id}>
        <td>
          {positionLabel(r.position)}
          {r.saved ? <span className="pill pill-good" style={{ marginLeft: "0.5rem" }}>saved</span> : null}
        </td>
        <td className="num muted">{lastText}</td>
        <td className="num">
          <input
            className="input num input-cell"
            name={isCash ? `amount_${id}` : `qty_${id}`}
            defaultValue={r.amount}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${r.account.institution} ${r.account.name}, ${positionLabel(r.position)}: ${isCash ? "balance" : "quantity"} at the end of ${monthLabel(month)}`}
            placeholder={isCash ? "0,00" : "0"}
          />
        </td>
        <td className="num">
          {eurCash ? (
            <span className="muted">—</span>
          ) : (
            <>
              <input
                className="input num input-cell-sm"
                name={`rate_${id}`}
                defaultValue={r.rate}
                inputMode="decimal"
                autoComplete="off"
                aria-label={`EUR per 1 ${unitOf(r)} for ${r.account.institution} ${r.account.name}`}
                placeholder="EUR each"
                style={r.rate === "" ? { borderColor: "var(--warn)" } : undefined}
              />
              <input type="hidden" name={`rate0_${id}`} value={r.rate} />
              <input type="hidden" name={`src0_${id}`} value={r.rate_source} />
              <input type="hidden" name={`date0_${id}`} value={r.rate_date ?? ""} />
              <div className="caption muted" style={{ textAlign: "right" }}>
                EUR per 1 {unitOf(r)}
                {r.rate ? `: ${formatRate(r.rate)}` : ""}
                <br />
                {hintText(r)}
                {r.cached_rate ? ` (cached ${formatRate(r.cached_rate)})` : ""}
              </div>
            </>
          )}
        </td>
        <td className="num hide-sm">{r.saved ? formatEur(r.saved.value_eur_minor) : <span className="muted">—</span>}</td>
      </tr>
    );
  };

  const renderGroup = (rows: CloseRow[]) => {
    const a = rows[0]!.account;
    return (
      <tbody key={a.id}>
        <tr className="group">
          <td colSpan={5}>
            <Link href={`/accounts/${a.id}`}>
              {a.institution} · {a.name}
            </Link>{" "}
            <span className="muted">{KIND_LABELS[a.kind]}</span>
          </td>
        </tr>
        {rows.map(renderRow)}
      </tbody>
    );
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="title">Close {monthLabel(month)}</h1>
          <p className="muted caption">
            Enter each balance as it stood at the end of the month. Last month’s value is filled in; change what moved. Saving again replaces the month, it never duplicates it.
          </p>
        </div>
        <div className="row">
          <Link href={`/close/${prev}`} className="btn btn-sm" aria-label={`Previous month, ${monthLabel(prev)}`}>
            ← {monthLabel(prev)}
          </Link>
          {next <= monthOf(today) ? (
            <Link href={`/close/${next}`} className="btn btn-sm" aria-label={`Next month, ${monthLabel(next)}`}>
              {monthLabel(next)} →
            </Link>
          ) : null}
          <form action="/close" method="get" className="row">
            <label className="sr-only" htmlFor="jump-month">
              Jump to month
            </label>
            <input id="jump-month" type="month" name="month" className="input" style={{ width: "10rem" }} defaultValue={month} max={monthOf(today)} />
            <button type="submit" className="btn btn-sm">
              Go
            </button>
          </form>
        </div>
      </div>

      {future ? <Banner kind="warn">{monthLabel(month)} has not started yet, so it cannot be closed.</Banner> : null}
      {sp.notice ? <Banner kind={sp.kind === "warn" ? "warn" : "good"}>{sp.notice}</Banner> : null}

      {plan.rows.length === 0 ? (
        <section className="card empty">
          <p>No open accounts to close for {monthLabel(month)}.</p>
          <Link href="/accounts/new" className="btn btn-primary">
            Add an account
          </Link>
        </section>
      ) : null}

      <section className="card" aria-label="Rates and cash on hand">
        <div className="grid-2">
          <div>
            <h2 className="sect">Rates</h2>
            <p className="caption muted" style={{ marginBottom: "0.5rem" }}>
              Month-end rates are read at {plan.rate_date}: the last published rate on or before that day. FX from the ECB (RUB from the Bank of Russia), crypto from CoinGecko. Securities are typed by hand.
            </p>
            {needsRates ? (
              <form action={refreshRatesAction} className="row">
                <input type="hidden" name="month" value={month} />
                <button type="submit" className="btn">
                  Fetch rates
                </button>
                {missing > 0 ? <span className="pill pill-warn">{missing} missing</span> : <span className="pill pill-good">all found</span>}
              </form>
            ) : (
              <p className="muted">Every position is in EUR, so no rates are needed.</p>
            )}
          </div>
          <div>
            <h2 className="sect">Cash on hand</h2>
            <p className="caption muted" style={{ marginBottom: "0.5rem" }}>
              Cash is tracked as accounts, one per currency. {plan.cash_currencies.length ? `Tracked: ${plan.cash_currencies.join(", ")}.` : "None yet."}
            </p>
            <div className="row">
              {missingCash.map((c) => (
                <form key={c} action={addCashAccountAction}>
                  <input type="hidden" name="month" value={month} />
                  <input type="hidden" name="currency" value={c} />
                  <button type="submit" className="btn btn-sm">
                    Add cash in {c}
                  </button>
                </form>
              ))}
              <form action={addCashAccountAction} className="row">
                <input type="hidden" name="month" value={month} />
                <input name="currency" className="input" style={{ width: "5rem", textTransform: "uppercase" }} maxLength={3} placeholder="GBP" aria-label="Other cash currency" />
                <button type="submit" className="btn btn-sm">
                  Add
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      {plan.rows.length > 0 ? (
        <ActionForm action={saveMonthAction}>
          <input type="hidden" name="month" value={month} />
          <section className="card">
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Position</th>
                    <th className="num">Last close</th>
                    <th className="num">End of {monthLabel(month)}</th>
                    <th className="num">Rate</th>
                    <th className="num hide-sm">Saved, EUR</th>
                  </tr>
                </thead>
                {[...groups.values()].map(renderGroup)}
                {cashGroups.size ? (
                  <>
                    <tbody>
                      <tr className="group">
                        <td colSpan={5}>Cash on hand</td>
                      </tr>
                    </tbody>
                    {[...cashGroups.values()].map(renderGroup)}
                  </>
                ) : null}
              </table>
            </div>
            <p className="caption muted" style={{ marginTop: "0.75rem" }}>
              Leave an amount empty to skip a position: it shows as “not closed yet” and is not counted as zero. Clearing an amount that was saved removes it for this month. Amounts accept 1234.56 or 1.234,56.
            </p>
          </section>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={future}>
              Save {monthLabel(month)}
            </button>
            {saved ? (
              <label className="row caption">
                <input type="checkbox" name="use_cache" value="yes" /> Re-price saved rows with the cached rates
              </label>
            ) : null}
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
