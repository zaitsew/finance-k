import { describe, expect, it } from "vitest";
import { buildSummary } from "../src/core/summary";
import { account, assetPosition, cashPosition, snap } from "./helpers";

// A realistic October 2026, every case the split has to handle.
const accounts = [
  account(1, { institution: "Santander", name: "Current", kind: "bank" }),
  account(2, { institution: "Revolut", name: "USD pocket", kind: "bank", currency: "USD" }),
  account(3, { institution: "Kraken", name: "Exchange", kind: "crypto_exchange" }),
  account(4, { institution: "MyInvestor", name: "New saver", kind: "bank", opened_on: "2026-10-05", created_at: "2026-10-05T10:00:00.000Z" }),
  account(5, { institution: "Old Bank", name: "Closed", kind: "bank", status: "closed", closed_on: "2026-10-15" }),
  account(6, { institution: "Forgotten", name: "Not closed yet", kind: "bank" }),
  account(7, { institution: "Cash", name: "Cash USD", kind: "cash", currency: "USD" }),
];
const p1 = cashPosition(1, 1);
const p2 = cashPosition(2, 2, "USD");
const p3 = assetPosition(3, 3, "BTC");
const p4 = cashPosition(4, 4);
const p5 = cashPosition(5, 5);
const p6 = cashPosition(6, 6);
const p7 = cashPosition(7, 7, "USD");
const positions = [p1, p2, p3, p4, p5, p6, p7];

const snapshots = [
  // September
  snap(p1, "2026-09", 100000),
  snap(p2, "2026-09", 100000, "0.9"),
  snap(p3, "2026-09", "0.5", "60000", "coingecko"),
  snap(p5, "2026-09", 70000),
  snap(p6, "2026-09", 30000),
  snap(p7, "2026-09", 20000, "0.9"),
  // October
  snap(p1, "2026-10", 150000),
  snap(p2, "2026-10", 120000, "0.86"),
  snap(p3, "2026-10", "0.6", "66000", "coingecko"),
  snap(p4, "2026-10", 500000),
  snap(p7, "2026-10", 20000, "0.86"),
];

const s = buildSummary({ month: "2026-10", accounts, positions, snapshots, idleCashThresholdMinor: 200000 });
const row = (positionId: number) => s.rows.find((r) => r.position.id === positionId)!;

describe("monthly summary", () => {
  it("adds up net worth from the saved snapshots only", () => {
    // 1500 + 1032 + 3960 + 5000 + 172 (20000 cents of USD at 0.86 = 172.00)
    expect(s.net_worth_eur_minor).toBe(150000 + 103200 + 3960000 + 500000 + 17200);
    expect(s.snapshot_count).toBe(5);
    expect(s.previous_net_worth_eur_minor).toBe(100000 + 90000 + 3000000 + 70000 + 30000 + 18000);
  });

  it("splits a EUR cash account into flows", () => {
    expect(row(1)).toMatchObject({ total: 50000, flows: 50000, market: 0, fx: 0, status: "ok" });
  });

  it("splits a non-EUR cash account into fx and flows", () => {
    expect(row(2)).toMatchObject({ total: 13200, fx: -4000, flows: 17200, market: 0 });
    // The idle USD cash with no movement is pure FX: 200 USD x (0.86 - 0.90).
    expect(row(7)).toMatchObject({ total: -800, fx: -800, flows: 0 });
  });

  it("splits a crypto position into market and flows", () => {
    expect(row(3)).toMatchObject({ total: 960000, market: 300000, flows: 660000, fx: 0 });
  });

  it("treats an account opened this month as new, all flows", () => {
    expect(row(4)).toMatchObject({ status: "new", total: 500000, flows: 500000, previous_eur_minor: null });
    expect(s.new_accounts.map((a) => a.id)).toEqual([4]);
  });

  it("treats an account closed this month as an outflow of what it held", () => {
    expect(row(5)).toMatchObject({ status: "closed", total: -70000, flows: -70000, value_eur_minor: 0 });
    expect(s.closed_accounts.map((a) => a.id)).toEqual([5]);
    expect(s.not_closed.map((n) => n.account.id)).not.toContain(5);
  });

  it("lists an open account without a snapshot as not closed yet, and leaves it out of the change", () => {
    expect(s.not_closed.map((n) => n.account.id)).toEqual([6]);
    expect(s.not_closed[0]!.missing.map((p) => p.id)).toEqual([6]);
    expect(s.rows.find((r) => r.position.id === 6)).toBeUndefined();
  });

  it("makes flows + market + fx equal the total change", () => {
    const c = s.change!;
    expect(c.market + c.fx + c.flows).toBe(c.total);
    expect(c.market).toBe(300000);
    expect(c.fx).toBe(-4800);
    expect(c.flows).toBe(50000 + 17200 + 660000 + 500000 - 70000);
    // Comparable positions only: everything but account 6.
    expect(c.total).toBe(s.net_worth_eur_minor - (s.previous_net_worth_eur_minor! - 30000));
  });

  it("groups totals by kind, currency and institution", () => {
    const kind = Object.fromEntries(s.by_kind.map((g) => [g.key, g.value_eur_minor]));
    expect(kind.bank).toBe(150000 + 103200 + 500000);
    expect(kind.crypto_exchange).toBe(3960000);
    expect(kind.cash).toBe(17200);
    const cur = Object.fromEntries(s.by_currency.map((g) => [g.key, g.value_eur_minor]));
    expect(cur.EUR).toBe(150000 + 500000);
    expect(cur.USD).toBe(103200 + 17200);
    expect(cur.BTC).toBe(3960000);
    const inst = s.by_institution.map((g) => g.key);
    expect(inst).toContain("Kraken");
    expect(s.by_kind.reduce((n, g) => n + g.share, 0)).toBeCloseTo(1, 10);
  });

  it("builds a 12-month series with gaps for months nobody closed", () => {
    expect(s.series).toHaveLength(12);
    expect(s.series[11]).toEqual({ month: "2026-10", net_worth_eur_minor: s.net_worth_eur_minor });
    expect(s.series[10]!.net_worth_eur_minor).toBe(s.previous_net_worth_eur_minor);
    expect(s.series[0]).toEqual({ month: "2025-11", net_worth_eur_minor: null });
  });

  it("flags idle EUR cash in bank accounts above the threshold", () => {
    expect(s.idle_cash.map((i) => [i.account.id, i.eur_minor])).toEqual([[4, 500000]]);
    const high = buildSummary({ month: "2026-10", accounts, positions, snapshots, idleCashThresholdMinor: 600000 });
    expect(high.idle_cash).toEqual([]);
  });

  it("shows no change on the first close", () => {
    const first = buildSummary({ month: "2026-09", accounts, positions, snapshots: snapshots.filter((x) => x.month === "2026-09"), idleCashThresholdMinor: 0 });
    expect(first.change).toBeNull();
    expect(first.rows).toEqual([]);
    expect(first.previous_net_worth_eur_minor).toBeNull();
  });

  it("uses the latest earlier close when a month was skipped", () => {
    const skipped = snapshots.filter((x) => !(x.position_id === 1 && x.month === "2026-09")).concat(snap(p1, "2026-08", 90000));
    const r = buildSummary({ month: "2026-10", accounts, positions, snapshots: skipped, idleCashThresholdMinor: 0 }).rows.find((x) => x.position.id === 1)!;
    expect(r.previous_eur_minor).toBe(90000);
    expect(r.total).toBe(60000);
  });

  it("ignores a position added after the month when it has no close", () => {
    const late = cashPosition(8, 1, "USD", { created_at: "2026-11-02T00:00:00.000Z" });
    const r = buildSummary({ month: "2026-10", accounts, positions: [...positions, late], snapshots, idleCashThresholdMinor: 0 });
    expect(r.not_closed.map((n) => n.account.id)).toEqual([6]);
  });
});
