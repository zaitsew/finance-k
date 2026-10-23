import { Suspense } from "react";
import { formatEur } from "../src/core/money";
import { BANKJAR_SAVINGS_LINK, fetchTopSavingsOffer } from "../src/server/bankjar";

async function TopOffer() {
  const offer = await fetchTopSavingsOffer();
  if (!offer) return null;
  return (
    <p className="caption muted" style={{ marginTop: "0.5rem" }}>
      Top offer on BankJar right now: {offer.bank}, {offer.product_name}
      {offer.rate_tae !== null ? `, ${offer.rate_tae}% TAE` : ""}.
    </p>
  );
}

export function IdleCashLink() {
  return (
    <a href={BANKJAR_SAVINGS_LINK} target="_blank" rel="noopener noreferrer">
      Idle cash: see savings offers
    </a>
  );
}

/** Lists bank accounts holding more EUR cash than the threshold, with a link to BankJar's savings ranking. */
export function IdleCashCard({ items, thresholdMinor }: { items: { id: number; label: string; eur_minor: number }[]; thresholdMinor: number }) {
  if (!items.length) return null;
  return (
    <section className="card" aria-labelledby="idle-h">
      <h2 className="sect" id="idle-h">
        Idle cash
      </h2>
      <ul className="stack" style={{ listStyle: "none" }}>
        {items.map((i) => (
          <li key={i.id} className="row">
            <a href={`/accounts/${i.id}`}>{i.label}</a>
            <span className="num">{formatEur(i.eur_minor)}</span>
            <span className="spacer" />
            <IdleCashLink />
          </li>
        ))}
      </ul>
      <p className="caption muted" style={{ marginTop: "0.5rem" }}>
        Bank accounts with more than {formatEur(thresholdMinor)} in EUR cash. Change the limit in Settings. BankJar is a separate site; opening it sends nothing about you.
      </p>
      <Suspense fallback={null}>
        <TopOffer />
      </Suspense>
    </section>
  );
}
