import { describe, expect, it } from "vitest";
import { detectDormant } from "../src/core/dormant";
import { addMonths } from "../src/core/months";
import { account, assetPosition, cashPosition, snap } from "./helpers";

const NOW = "2026-10";
const run = (n: number, amount: (back: number) => number, p = cashPosition(1, 1)) =>
  Array.from({ length: n }, (_, back) => snap(p, addMonths(NOW, -back), amount(back)));

describe("dormant accounts", () => {
  const acc = [account(1)];
  const pos = [cashPosition(1, 1)];

  it("flags an open account whose balance did not change at six month-ends in a row", () => {
    const d = detectDormant(acc, pos, run(7, () => 50000), NOW);
    expect(d).toEqual([{ account_id: 1, unchanged_since: "2026-04", unchanged_months: 6 }]);
  });

  it("reports how far back the run goes", () => {
    const d = detectDormant(acc, pos, run(10, () => 50000), NOW);
    expect(d[0]).toMatchObject({ unchanged_since: "2026-01", unchanged_months: 9 });
  });

  it("does not flag five unchanged month-ends", () => {
    expect(detectDormant(acc, pos, run(6, () => 50000), NOW)).toEqual([]);
  });

  it("is woken up by a change inside the window", () => {
    expect(detectDormant(acc, pos, run(8, (back) => (back === 3 ? 50100 : 50000)), NOW)).toEqual([]);
  });

  it("a missing month breaks the run", () => {
    const snaps = run(8, () => 50000).filter((s) => s.month !== "2026-07");
    expect(detectDormant(acc, pos, snaps, NOW)).toEqual([]);
  });

  it("ignores a rate move: only the native balance counts", () => {
    const usd = cashPosition(1, 1, "USD");
    const snaps = Array.from({ length: 8 }, (_, back) => snap(usd, addMonths(NOW, -back), 50000, back % 2 ? "0.9" : "0.86"));
    expect(detectDormant(acc, [usd], snaps, NOW)).toHaveLength(1);
  });

  it("compares quantities as numbers, not text", () => {
    const btc = assetPosition(1, 1, "BTC");
    const snaps = Array.from({ length: 8 }, (_, back) => snap(btc, addMonths(NOW, -back), back % 2 ? "0.50" : "0.5", "60000"));
    expect(detectDormant(acc, [btc], snaps, NOW)).toHaveLength(1);
  });

  it("skips closed accounts and accounts without a close this month", () => {
    expect(detectDormant([account(1, { status: "closed", closed_on: "2026-10-01" })], pos, run(8, () => 1), NOW)).toEqual([]);
    expect(detectDormant(acc, pos, run(8, () => 1).slice(1), NOW)).toEqual([]);
  });

  it("an empty open account counts as dormant too", () => {
    expect(detectDormant(acc, pos, run(7, () => 0), NOW)).toHaveLength(1);
  });
});
