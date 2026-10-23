import Link from "next/link";
import type { Metadata } from "next";
import { formatEur } from "../../src/core/money";
import { monthShort } from "../../src/core/months";
import { KIND_LABELS, SOURCE_LABELS, type Account } from "../../src/core/types";
import { openDb } from "../../src/server/db";
import { listAccounts, listPositions, listSnapshots } from "../../src/server/repo";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  const db = openDb();
  const accounts = listAccounts(db);
  const positions = listPositions(db);
  const snapshots = listSnapshots(db);

  // The latest close of each position, summed per account.
  const latestByPosition = new Map<number, { month: string; eur: number }>();
  for (const s of snapshots) latestByPosition.set(s.position_id, { month: s.month, eur: s.value_eur_minor });
  const valueOf = (a: Account): { eur: number; month: string } | null => {
    let eur = 0;
    let month = "";
    let any = false;
    for (const p of positions) {
      if (p.account_id !== a.id) continue;
      const l = latestByPosition.get(p.id);
      if (!l) continue;
      any = true;
      eur += l.eur;
      if (l.month > month) month = l.month;
    }
    return any ? { eur, month } : null;
  };

  const open = accounts.filter((a) => a.status === "open");
  const closed = accounts.filter((a) => a.status === "closed");

  const table = (list: Account[]) => (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>Account</th>
            <th>Kind</th>
            <th>Currency</th>
            <th className="hide-sm">IBAN</th>
            <th className="hide-sm">Source</th>
            <th className="num">Last close, EUR</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => {
            const v = valueOf(a);
            return (
              <tr key={a.id}>
                <td>
                  <Link href={`/accounts/${a.id}`}>
                    <strong>{a.institution}</strong> · {a.name}
                  </Link>
                  {a.purpose ? <div className="caption muted">{a.purpose}</div> : null}
                </td>
                <td>{KIND_LABELS[a.kind]}</td>
                <td>{a.currency}</td>
                <td className="hide-sm num">{a.iban_last4 ? `•••• ${a.iban_last4}` : "—"}</td>
                <td className="hide-sm">{SOURCE_LABELS[a.source]}</td>
                <td className="num">
                  {v ? formatEur(v.eur) : <span className="muted">not closed yet</span>}
                  {v ? <div className="caption muted">{monthShort(v.month)}</div> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="title">Accounts</h1>
          <p className="muted caption">
            {open.length} open, {closed.length} closed.
          </p>
        </div>
        <Link href="/accounts/new" className="btn btn-primary">
          Add account
        </Link>
      </div>
      {accounts.length === 0 ? (
        <section className="card empty">
          <p>No accounts yet.</p>
          <Link href="/accounts/new" className="btn btn-primary">
            Add your first account
          </Link>
        </section>
      ) : null}
      {open.length ? <section className="card">{table(open)}</section> : null}
      {closed.length ? (
        <section className="card">
          <h2 className="sect">Closed</h2>
          {table(closed)}
        </section>
      ) : null}
    </div>
  );
}
