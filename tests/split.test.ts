import { describe, expect, it } from "vitest";
import { splitDelta } from "../src/core/split";
import { account, assetPosition, cashPosition, snap } from "./helpers";

const eurCash = cashPosition(1, 1, "EUR");
const usdCash = cashPosition(2, 1, "USD");
const btc = assetPosition(3, 1, "BTC");

describe("splitDelta", () => {
  it("EUR cash: the whole change is a flow", () => {
    const s = splitDelta(eurCash, snap(eurCash, "2026-09", 100000), snap(eurCash, "2026-10", 150000));
    expect(s).toEqual({ total: 50000, market: 0, fx: 0, flows: 50000 });
  });

  it("non-EUR cash: fx = previous native amount x rate change, flows = the rest", () => {
    // 1,000.00 USD at 0.90 -> EUR 900.00. Now 1,200.00 USD at 0.86 -> EUR 1,032.00.
    const prev = snap(usdCash, "2026-09", 100000, "0.9");
    const curr = snap(usdCash, "2026-10", 120000, "0.86");
    expect(prev.value_eur_minor).toBe(90000);
    expect(curr.value_eur_minor).toBe(103200);
    const s = splitDelta(usdCash, prev, curr);
    expect(s.total).toBe(13200);
    expect(s.fx).toBe(-4000); // 1000 x (0.86 - 0.90) = -40.00
    expect(s.market).toBe(0);
    expect(s.flows).toBe(17200); // the 200 USD deposited, at the new rate
    expect(s.market + s.fx + s.flows).toBe(s.total);
  });

  it("non-EUR cash with no deposit: the whole move is FX", () => {
    const s = splitDelta(usdCash, snap(usdCash, "2026-09", 100000, "0.9"), snap(usdCash, "2026-10", 100000, "0.86"));
    expect(s).toEqual({ total: -4000, market: 0, fx: -4000, flows: 0 });
  });

  it("crypto: market = previous quantity x price change, flows = new coins at the new price", () => {
    // 0.5 BTC at 60,000 -> 0.6 BTC at 66,000.
    const prev = snap(btc, "2026-09", "0.5", "60000", "coingecko");
    const curr = snap(btc, "2026-10", "0.6", "66000", "coingecko");
    const s = splitDelta(btc, prev, curr);
    expect(prev.value_eur_minor).toBe(3000000);
    expect(curr.value_eur_minor).toBe(3960000);
    expect(s.total).toBe(960000);
    expect(s.market).toBe(300000); // 0.5 x 6,000
    expect(s.fx).toBe(0);
    expect(s.flows).toBe(660000); // 0.1 BTC x 66,000
  });

  it("a position new this month is all flows", () => {
    const s = splitDelta(btc, null, snap(btc, "2026-10", "0.1", "66000"));
    expect(s).toEqual({ total: 660000, market: 0, fx: 0, flows: 660000 });
  });

  it("a position closed this month is all outflow", () => {
    const s = splitDelta(usdCash, snap(usdCash, "2026-09", 100000, "0.9"), null);
    expect(s).toEqual({ total: -90000, market: 0, fx: 0, flows: -90000 });
  });

  it("nothing on either side is zero", () => {
    expect(splitDelta(eurCash, null, null)).toEqual({ total: 0, market: 0, fx: 0, flows: 0 });
  });

  it("always adds up to the total, whatever the rounding does", () => {
    const prev = snap(usdCash, "2026-09", 33333, "0.893415527562");
    const curr = snap(usdCash, "2026-10", 77777, "0.891999999999");
    const s = splitDelta(usdCash, prev, curr);
    expect(s.market + s.fx + s.flows).toBe(s.total);
    expect(account(1).id).toBe(1);
  });
});
