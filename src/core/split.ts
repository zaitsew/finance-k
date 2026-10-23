import { dec, fromMinor, mul, sub, toMinor } from "./decimal";
import { currencyDecimals } from "./money";
import type { Position, Snapshot } from "./types";

/** What the split needs from a snapshot. */
export type SnapshotValue = Pick<Snapshot, "amount_minor" | "quantity" | "rate" | "value_eur_minor">;

export interface Split {
  /** Current EUR value minus previous EUR value, in cents. Always market + fx + flows. */
  total: number;
  /** Assets only: previous quantity x (price now - price before). */
  market: number;
  /** Non-EUR cash only: previous native balance x (rate now - rate before). */
  fx: number;
  /** The remainder: deposits, withdrawals, interest, new and closed accounts. */
  flows: number;
}

/**
 * Splits the EUR change of one position between two close dates.
 *
 *  - no previous snapshot: the whole value is a flow (the account is new, or new to this tool)
 *  - no current snapshot: the position was closed, the whole previous value left as a flow
 *  - assets: market = previous quantity x (price now - price before), priced in EUR
 *  - non-EUR cash: fx = previous native amount x (rate now - rate before)
 *  - flows = total - market - fx, so the three parts always add up to the total to the cent
 *
 * Each part is rounded once, half away from zero, from the exact decimal product.
 */
export function splitDelta(
  position: Pick<Position, "kind" | "currency">,
  prev: SnapshotValue | null,
  curr: SnapshotValue | null,
): Split {
  if (prev === null && curr === null) return { total: 0, market: 0, fx: 0, flows: 0 };
  if (prev === null) return { total: curr!.value_eur_minor, market: 0, fx: 0, flows: curr!.value_eur_minor };
  if (curr === null) return { total: -prev.value_eur_minor, market: 0, fx: 0, flows: -prev.value_eur_minor };

  const total = curr.value_eur_minor - prev.value_eur_minor;
  const rateChange = sub(dec(curr.rate), dec(prev.rate));
  let market = 0;
  let fx = 0;
  if (position.kind === "asset") {
    market = toMinor(mul(dec(prev.quantity ?? "0"), rateChange), 2);
  } else if (position.currency !== "EUR") {
    const prevNative = fromMinor(prev.amount_minor ?? 0, currencyDecimals(position.currency ?? "EUR"));
    fx = toMinor(mul(prevNative, rateChange), 2);
  }
  return { total, market, fx, flows: total - market - fx };
}
