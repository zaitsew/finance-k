import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AccountFields } from "../../../components/AccountForm";
import { ActionForm } from "../../../components/ActionForm";
import { IdleCashLink } from "../../../components/Idle";
import { SubmitButton } from "../../../components/SubmitButton";
import { Banner, Field } from "../../../components/ui";
import { COMMON_CURRENCIES, formatDecimalEs, formatEur, formatMoney, formatRate } from "../../../src/core/money";
import { monthLabel } from "../../../src/core/months";
import { positionLabel, type Snapshot } from "../../../src/core/types";
import { addPositionAction, deleteAccountAction, deletePositionAction, updateAccountAction } from "../../../src/server/actions";
import { openDb } from "../../../src/server/db";
import { getAccount, listPositions, snapshotsOfAccount } from "../../../src/server/repo";
import { idleThresholdMinor } from "../../../src/server/view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const accountId = Number(id);
  if (!Number.isInteger(accountId)) notFound();
  const db = openDb();
  const account = getAccount(db, accountId);
  if (!account) notFound();
  const positions = listPositions(db, accountId);
  const snaps = snapshotsOfAccount(db, accountId);
  const byMonth = new Map<string, Map<number, Snapshot>>();
  for (const s of snaps) {
    const m = byMonth.get(s.month) ?? new Map<number, Snapshot>();
    m.set(s.position_id, s);
    byMonth.set(s.month, m);
  }
  const months = [...byMonth.keys()].sort().reverse();

  // Idle cash: EUR cash at the latest close of an open bank account.
  let idleEur = 0;
  if (account.kind === "bank" && account.status === "open") {
    for (const p of positions) {
      if (p.kind !== "cash" || p.currency !== "EUR") continue;
      const latest = snaps.filter((s) => s.position_id === p.id)[0];
      if (latest) idleEur += latest.value_eur_minor;
    }
  }
  const idle = idleEur > idleThresholdMinor(db);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1 className="title">
            {account.institution} · {account.name}
          </h1>
          <p className="muted caption">
            <span className={account.status === "open" ? "pill pill-good" : "pill"}>{account.status}</span> {account.iban_last4 ? `IBAN •••• ${account.iban_last4}` : ""}
          </p>
        </div>
        <Link href="/accounts" className="btn btn-quiet">
          Back to accounts
        </Link>
      </div>

      {sp.created ? <Banner kind="good">Account added. Next, check its positions below, then close a month.</Banner> : null}
      {sp.error ? <Banner kind="bad">{sp.error}</Banner> : null}
      {idle ? (
        <Banner kind="info">
          {formatEur(idleEur)} in EUR cash at the last close. <IdleCashLink />
        </Banner>
      ) : null}

      <section className="card" aria-labelledby="pos-h">
        <h2 className="sect" id="pos-h">
          Positions
        </h2>
        {positions.length === 0 ? (
          <p className="muted">No positions yet. Add the cash currency or the assets this account holds.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Position</th>
                <th>Type</th>
                <th className="num" />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <tr key={p.id}>
                  <td>{positionLabel(p)}</td>
                  <td>{p.kind === "cash" ? "Cash" : p.asset_kind === "crypto" ? "Crypto" : "Security"}</td>
                  <td className="num">
                    <form action={deletePositionAction}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="account_id" value={account.id} />
                      <button type="submit" className="btn btn-sm btn-quiet">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="grid-2" style={{ marginTop: "1rem" }}>
          <ActionForm action={addPositionAction}>
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="kind" value="cash" />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Add cash in currency" htmlFor="pos-cur">
                <input id="pos-cur" name="currency" className="input input-cell-sm" list="cur-list" maxLength={3} required placeholder="USD" style={{ textTransform: "uppercase" }} />
              </Field>
              <datalist id="cur-list">
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <button type="submit" className="btn">
                Add cash
              </button>
            </div>
          </ActionForm>
          <ActionForm action={addPositionAction}>
            <input type="hidden" name="account_id" value={account.id} />
            <input type="hidden" name="kind" value="asset" />
            <div className="row" style={{ alignItems: "flex-end" }}>
              <Field label="Add an asset" htmlFor="pos-sym">
                <input id="pos-sym" name="symbol" className="input input-cell-sm" required placeholder="BTC or VWCE" style={{ textTransform: "uppercase" }} />
              </Field>
              <Field label="Type" htmlFor="pos-ak">
                <select id="pos-ak" name="asset_kind" className="select" defaultValue="crypto">
                  <option value="crypto">Crypto</option>
                  <option value="security">Security</option>
                </select>
              </Field>
              <button type="submit" className="btn">
                Add asset
              </button>
            </div>
          </ActionForm>
        </div>
      </section>

      <section className="card" aria-labelledby="hist-h">
        <h2 className="sect" id="hist-h">
          Month-end history
        </h2>
        {months.length === 0 ? (
          <p className="muted">Nothing closed yet. This account appears in “Close month”.</p>
        ) : (
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Month</th>
                  {positions.map((p) => (
                    <th key={p.id} className="num">
                      {positionLabel(p)}
                    </th>
                  ))}
                  <th className="num">Rate used</th>
                  <th className="num">EUR</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m) => {
                  const row = byMonth.get(m)!;
                  const total = [...row.values()].reduce((sum, s) => sum + s.value_eur_minor, 0);
                  return (
                    <tr key={m}>
                      <td>
                        <Link href={`/close/${m}`}>{monthLabel(m)}</Link>
                      </td>
                      {positions.map((p) => {
                        const s = row.get(p.id);
                        return (
                          <td key={p.id} className="num">
                            {s ? (p.kind === "cash" ? formatMoney(s.amount_minor ?? 0, p.currency ?? "EUR") : formatDecimalEs(s.quantity ?? "0")) : <span className="muted">—</span>}
                          </td>
                        );
                      })}
                      <td className="num muted">
                        {positions
                          .map((p) => row.get(p.id))
                          .filter((s): s is Snapshot => s !== undefined && s.rate_source !== "identity")
                          .map((s) => `${formatRate(s.rate)} (${s.rate_source})`)
                          .join(", ") || "—"}
                      </td>
                      <td className="num">{formatEur(total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="edit-h">
        <h2 className="sect" id="edit-h">
          Details
        </h2>
        <ActionForm action={updateAccountAction}>
          <input type="hidden" name="id" value={account.id} />
          <AccountFields account={account} editing />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
          </div>
        </ActionForm>
      </section>

      <section className="card" aria-labelledby="del-h">
        <h2 className="sect" id="del-h">
          Delete
        </h2>
        <p className="muted">To stop tracking an account, set its status to Closed above. That keeps its history. Deleting removes the account and every month saved for it.</p>
        <form action={deleteAccountAction} className="row" style={{ marginTop: "0.75rem" }}>
          <input type="hidden" name="id" value={account.id} />
          <label className="row">
            <input type="checkbox" name="confirm" value="yes" /> I want to delete this account and its history
          </label>
          <SubmitButton className="btn btn-danger">Delete account</SubmitButton>
        </form>
      </section>
    </div>
  );
}
