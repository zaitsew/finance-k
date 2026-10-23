import Link from "next/link";
import { FirstRun } from "../components/FirstRun";
import { IdleCashCard } from "../components/Idle";
import { NetWorthChart } from "../components/NetWorthChart";
import { Banner, Delta } from "../components/ui";
import { formatEur } from "../src/core/money";
import { isMonth, monthLabel, monthShort, todayLocal } from "../src/core/months";
import type { Group } from "../src/core/summary";
import { KIND_LABELS, positionLabel, type AccountKind } from "../src/core/types";
import { openDb } from "../src/server/db";
import { countAccounts, listMonths } from "../src/server/repo";
import { defaultCloseMonth, idleThresholdMinor, summaryFor } from "../src/server/view";

export const dynamic = "force-dynamic";

const pct = new Intl.NumberFormat("es-ES", { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" });

function GroupCard({ title, groups, label }: { title: string; groups: Group[]; label?: (key: string) => string }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="sect">{title}</h2>
      <table className="tbl">
        <tbody>
          {groups.map((g) => (
            <tr key={g.key}>
              <td>{label ? label(g.key) : g.key}</td>
              <td>
                <span className="bar-track" style={{ display: "block" }} aria-hidden="true">
                  <span className="bar" style={{ width: `${Math.max(0, Math.min(100, g.share * 100))}%` }} />
                </span>
              </td>
              <td className="num muted">{pct.format(g.share).replace("+", "")}</td>
              <td className="num">{formatEur(g.value_eur_minor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default async function SummaryPage({ searchParams }: { searchParams: Promise<{ month?: string; saved?: string }> }) {
  const sp = await searchParams;
  const db = openDb();
  if (countAccounts(db) === 0) return <FirstRun />;

  const today = todayLocal();
  const months = listMonths(db);
  if (months.length === 0) {
    const m = defaultCloseMonth(today);
    return (
      <section className="empty">
        <h1>Close your first month</h1>
        <p>Your accounts are set up. Enter each balance as it stood at the end of the month and the summary appears here.</p>
        <div className="row" style={{ justifyContent: "center" }}>
          <Link href={`/close/${m}`} className="btn btn-primary">
            Close {monthLabel(m)}
          </Link>
          <Link href="/accounts" className="btn">
            Review accounts
          </Link>
        </div>
      </section>
    );
  }

  const month = sp.month && isMonth(sp.month) && months.includes(sp.month) ? sp.month : months[months.length - 1]!;
  const s = summaryFor(db, month);
  const recent = months.slice(-12);
  const change = s.change;
  const idle = s.idle_cash.map((i) => ({ id: i.account.id, label: `${i.account.institution} ${i.account.name}`, eur_minor: i.eur_minor }));
  // Measured against the earlier closes of the same positions the change was computed from.
  const pctChange = change && change.base_eur_minor !== 0 ? change.total / Math.abs(change.base_eur_minor) : null;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="title">Summary, {monthLabel(month)}</h1>
          <p className="muted caption">Net worth in EUR at the end of the month, from the balances you closed.</p>
        </div>
        <div className="row">
          <Link href={`/close/${month}`} className="btn">
            Edit this month
          </Link>
          <Link href={`/close/${defaultCloseMonth(today)}`} className="btn btn-primary">
            Close a month
          </Link>
        </div>
      </div>

      {sp.saved ? <Banner kind="good">Saved {sp.saved} position{sp.saved === "1" ? "" : "s"} for {monthLabel(month)}.</Banner> : null}

      <nav className="month-nav" aria-label="Month">
        {recent.map((m) => (
          <Link key={m} href={`/?month=${m}`} className="month-chip" aria-current={m === month ? "true" : undefined}>
            {monthShort(m)}
          </Link>
        ))}
      </nav>

      {s.not_closed.length > 0 ? (
        <Banner kind="warn">
          <strong>Not closed yet:</strong> {s.not_closed.length} account{s.not_closed.length === 1 ? "" : "s"} {s.not_closed.length === 1 ? "has" : "have"} no balance for {monthLabel(month)}. They are left out of the total, not counted as zero.{" "}
          <Link href={`/close/${month}`}>Close them</Link>
        </Banner>
      ) : null}

      <section className="card">
        <div className="stat-label">Net worth, {monthLabel(month)}</div>
        <div className="hero-number">{formatEur(s.net_worth_eur_minor)}</div>
        {change ? (
          <p style={{ marginTop: "0.5rem" }}>
            <Delta minor={change.total} /> {pctChange !== null ? <span className="muted">({pct.format(pctChange)})</span> : null}{" "}
            <span className="muted">since each position's last close ({formatEur(change.base_eur_minor)} then)</span>
          </p>
        ) : (
          <p className="muted" style={{ marginTop: "0.5rem" }}>First close: there is nothing to compare with yet.</p>
        )}
      </section>

      {change ? (
        <div className="grid-3">
          <div className="card">
            <div className="stat-label">Flows</div>
            <div className="stat-value">
              <Delta minor={change.flows} />
            </div>
            <p className="caption muted">Deposits, withdrawals, interest, new and closed accounts.</p>
          </div>
          <div className="card">
            <div className="stat-label">Market</div>
            <div className="stat-value">
              <Delta minor={change.market} />
            </div>
            <p className="caption muted">Last month’s quantity times the price change, crypto and securities.</p>
          </div>
          <div className="card">
            <div className="stat-label">FX</div>
            <div className="stat-value">
              <Delta minor={change.fx} />
            </div>
            <p className="caption muted">Last month’s balance times the rate change, non-EUR cash.</p>
          </div>
        </div>
      ) : null}

      <section className="card" aria-label="Net worth, last 12 months">
        <h2 className="sect">Last 12 months</h2>
        <NetWorthChart series={s.series} current={month} />
      </section>

      <div className="grid-2">
        <GroupCard title="By kind" groups={s.by_kind} label={(k) => KIND_LABELS[k as AccountKind] ?? k} />
        <GroupCard title="By currency or asset" groups={s.by_currency} />
        <GroupCard title="By institution" groups={s.by_institution} />
        <IdleCashCard items={idle} thresholdMinor={idleThresholdMinor(db)} />
      </div>

      {change && s.rows.length > 0 ? (
        <section className="card" aria-label="Change by position">
          <h2 className="sect">What moved, by position</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Position</th>
                  <th className="num">Before</th>
                  <th className="num">Now</th>
                  <th className="num">Flows</th>
                  <th className="num">Market</th>
                  <th className="num">FX</th>
                  <th className="num">Change</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.position.id}>
                    <td>
                      <Link href={`/accounts/${r.account.id}`}>
                        {r.account.institution} · {r.account.name}
                      </Link>{" "}
                      {r.status === "new" ? <span className="pill pill-good">new</span> : null}
                      {r.status === "closed" ? <span className="pill">closed</span> : null}
                    </td>
                    <td>{positionLabel(r.position)}</td>
                    <td className="num muted">{r.previous_eur_minor === null ? "—" : formatEur(r.previous_eur_minor)}</td>
                    <td className="num">{formatEur(r.value_eur_minor)}</td>
                    <td className="num">
                      <Delta minor={r.flows} />
                    </td>
                    <td className="num">
                      <Delta minor={r.market} />
                    </td>
                    <td className="num">
                      <Delta minor={r.fx} />
                    </td>
                    <td className="num">
                      <Delta minor={r.total} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="num">
                    <Delta minor={change.flows} />
                  </td>
                  <td className="num">
                    <Delta minor={change.market} />
                  </td>
                  <td className="num">
                    <Delta minor={change.fx} />
                  </td>
                  <td className="num">
                    <Delta minor={change.total} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : null}

      <div className="grid-2">
        <section className="card" aria-label="Dormant accounts">
          <h2 className="sect">Dormant accounts</h2>
          {s.dormant.length === 0 ? (
            <p className="muted">None. An open account is dormant when its balance is the same at six month-ends in a row.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none" }}>
              {s.dormant.map((d) => (
                <li key={d.account_id} className="row">
                  <Link href={`/accounts/${d.account_id}`}>
                    {d.account.institution} · {d.account.name}
                  </Link>
                  <span className="spacer" />
                  <span className="muted caption">unchanged since {monthLabel(d.unchanged_since)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-label="Accounts opened and closed">
          <h2 className="sect">Opened and closed this month</h2>
          {s.new_accounts.length === 0 && s.closed_accounts.length === 0 ? (
            <p className="muted">No account opened or closed in {monthLabel(month)}.</p>
          ) : (
            <ul className="stack" style={{ listStyle: "none" }}>
              {s.new_accounts.map((a) => (
                <li key={`n${a.id}`} className="row">
                  <span className="pill pill-good">new</span>
                  <Link href={`/accounts/${a.id}`}>
                    {a.institution} · {a.name}
                  </Link>
                </li>
              ))}
              {s.closed_accounts.map((a) => (
                <li key={`c${a.id}`} className="row">
                  <span className="pill">closed</span>
                  <Link href={`/accounts/${a.id}`}>
                    {a.institution} · {a.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {s.not_closed.length > 0 ? (
        <section className="card" aria-label="Not closed yet">
          <h2 className="sect">Not closed yet</h2>
          <ul className="stack" style={{ listStyle: "none" }}>
            {s.not_closed.map((n) => (
              <li key={n.account.id} className="row">
                <Link href={`/accounts/${n.account.id}`}>
                  {n.account.institution} · {n.account.name}
                </Link>
                <span className="muted caption">{n.missing.map(positionLabel).join(", ")}</span>
                <span className="spacer" />
                <Link href={`/close/${month}`} className="btn btn-sm">
                  Close it
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
