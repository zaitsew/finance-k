import Link from "next/link";

export function FirstRun() {
  return (
    <section className="empty">
      <h1>Add your first account</h1>
      <p>
        Finance K keeps a monthly picture of what you own: bank accounts, brokers, crypto and cash. At the end of each month you type in the balances, and it
        shows your net worth and what moved it.
      </p>
      <p>Everything is stored in a database on this Mac. Nothing is uploaded. The only requests it makes are public exchange-rate lookups.</p>
      <div className="row" style={{ justifyContent: "center" }}>
        <Link href="/accounts/new" className="btn btn-primary">
          Add your first account
        </Link>
        <Link href="/settings" className="btn">
          Import a backup
        </Link>
      </div>
    </section>
  );
}
