import { describe, expect, it } from "vitest";
import { currencyDecimals, formatMoney, minorToInput, parseMinorInput, parseRateInput, valueEurMinor } from "../src/core/money";
import { AccountInputSchema, MAX_IDLE_CASH_EUR, isValidIdleCashEur } from "../src/core/schemas";
import { accountLastClose, buildSummary } from "../src/core/summary";
import { addCashOnHand, buildClosePlan, saveMonth } from "../src/server/close";
import { addPosition, createAccount, idleCashEur, listAccounts, listPositions, listSnapshots, saveSnapshot, setSetting, updateAccount } from "../src/server/repo";
import { exportStore, importStore } from "../src/server/store-io";
import { idleThresholdMinor, summaryFor } from "../src/server/view";
import { account, assetPosition, cashPosition, snap, tempDb } from "./helpers";

const TODAY = "2026-11-05";
const form = (fields: Record<string, string>) => (name: string) => fields[name];
const input = (over: Record<string, unknown> = {}) => AccountInputSchema.parse({ institution: "Bank", name: "Current", kind: "bank", currency: "EUR", ...over });
const eurSnap = (db: ReturnType<typeof tempDb>["db"], positionId: number, month: string, minor: number) => {
  const position = listPositions(db).find((p) => p.id === positionId)!;
  saveSnapshot(db, { position, month, amount_minor: minor, quantity: null, rate: "1", rate_date: null, rate_source: "identity" });
};

describe("an account closed in a month contributes nothing to that month", () => {
  // A held 1,000 in September. In October it was transferred to B and A was closed.
  const A = account(1, { institution: "A", name: "Old", closed_on: "2026-10-20", status: "closed" });
  const B = account(2, { institution: "B", name: "New" });
  const pa = cashPosition(1, 1);
  const pb = cashPosition(2, 2);
  const snapshots = [snap(pa, "2026-09", 100000), snap(pb, "2026-09", 0), snap(pa, "2026-10", 100000), snap(pb, "2026-10", 100000)];
  const s = buildSummary({ month: "2026-10", accounts: [A, B], positions: [pa, pb], snapshots, idleCashThresholdMinor: 200000 });

  it("does not count a balance saved for the month the account closed", () => {
    expect(s.net_worth_eur_minor).toBe(100000);
    expect(s.snapshot_count).toBe(1);
    expect(s.series.at(-1)!.net_worth_eur_minor).toBe(100000);
    expect(s.by_kind.reduce((n, g) => n + g.value_eur_minor, 0)).toBe(100000);
  });

  it("agrees between the total and the change: the transfer nets to zero", () => {
    expect(s.rows.find((r) => r.position.id === 1)).toMatchObject({ status: "closed", value_eur_minor: 0, flows: -100000 });
    expect(s.change).toMatchObject({ total: 0, flows: 0 });
    expect(s.net_worth_eur_minor - s.previous_net_worth_eur_minor!).toBe(s.change!.total);
  });

  it("ignores snapshots dated after the closing month too", () => {
    const later = buildSummary({ month: "2026-11", accounts: [A, B], positions: [pa, pb], snapshots: [...snapshots, snap(pa, "2026-11", 5000), snap(pb, "2026-11", 100000)], idleCashThresholdMinor: 0 });
    expect(later.net_worth_eur_minor).toBe(100000);
  });

  it("gives the close form no row for it, and refuses to write one", () => {
    const { db } = tempDb();
    const a = createAccount(db, input({ name: "Old", opened_on: "2025-01-01" }));
    const b = createAccount(db, input({ name: "New", opened_on: "2025-01-01" }));
    const [pA] = listPositions(db, a);
    const [pB] = listPositions(db, b);
    eurSnap(db, pA!.id, "2026-09", 100000);
    eurSnap(db, pA!.id, "2026-10", 100000);
    updateAccount(db, a, input({ name: "Old", opened_on: "2025-01-01", status: "closed", closed_on: "2026-10-20" }));
    const plan = buildClosePlan(db, "2026-10", TODAY);
    expect(plan.rows.map((r) => r.position.id)).toEqual([pB!.id]);
    const result = saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${pA!.id}`]: "9999", [`amount_${pB!.id}`]: "1000" }) });
    expect(result).toEqual({ ok: true, saved: 1, cleared: 0 });
    expect(summaryFor(db, "2026-10").net_worth_eur_minor).toBe(100000);
  });
});

describe("adding cash while closing an earlier month", () => {
  it("shows the new account in that month's form", () => {
    const { db } = tempDb();
    createAccount(db, input({ opened_on: "2025-01-01" }));
    const added = addCashOnHand(db, "2026-08", "usd");
    expect(added.ok).toBe(true);
    const plan = buildClosePlan(db, "2026-08", TODAY);
    expect(plan.rows.map((r) => r.position.currency)).toContain("USD");
    expect(listAccounts(db).find((a) => a.name === "Cash USD")!.opened_on).toBe("2026-08-01");
    // And it does not exist before that month.
    expect(buildClosePlan(db, "2026-07", TODAY).rows.map((r) => r.account.name)).not.toContain("Cash USD");
  });

  it("refuses a bad currency code", () => {
    expect(addCashOnHand(tempDb().db, "2026-08", "eu")).toMatchObject({ ok: false });
  });
});

describe("ISO 4217 minor units", () => {
  it.each([
    ["EUR", 2],
    ["JPY", 0],
    ["KRW", 0],
    ["CLP", 0],
    ["VND", 0],
    ["KWD", 3],
    ["BHD", 3],
    ["TND", 3],
    ["CLF", 4],
  ])("%s has %i decimals", (code, n) => {
    expect(currencyDecimals(code)).toBe(n);
  });

  it("parses, prints and values a three-decimal currency", () => {
    expect(parseMinorInput("12.345", "KWD")).toBe(12345);
    expect(parseMinorInput("12.3456", "KWD")).toBeNull();
    expect(minorToInput(12345, "KWD")).toBe("12.345");
    expect(formatMoney(12345, "KWD")).toMatch(/12,345/);
    // 12.345 KWD at 3.0 EUR = 37.035 -> 37.04 EUR (3704 cents)
    expect(valueEurMinor({ kind: "cash", currency: "KWD" }, { amount_minor: 12345, quantity: null }, "3")).toBe(3704);
  });

  it("values a zero-decimal currency without dividing by 100", () => {
    expect(parseMinorInput("5000", "CLP")).toBe(5000);
    expect(parseMinorInput("5000.5", "CLP")).toBeNull();
    // 5,000 CLP at 0.001 EUR = 5.00 EUR
    expect(valueEurMinor({ kind: "cash", currency: "CLP" }, { amount_minor: 5000, quantity: null }, "0.001")).toBe(500);
  });
});

describe("a manual rate", () => {
  it("is refused when it rounds to zero at the stored precision", () => {
    expect(parseRateInput("0.0000000000001")).toBeNull();
    expect(parseRateInput("0")).toBeNull();
    expect(parseRateInput("-1")).toBeNull();
    expect(parseRateInput("abc")).toBeNull();
    expect(parseRateInput("0,893415527562")).toBe("0.893415527562");
    expect(parseRateInput("0.000000000001")).toBe("0.000000000001");
  });

  it("is refused by the close form, and nothing is written", () => {
    const { db } = tempDb();
    const id = createAccount(db, input({ name: "USD", currency: "USD", opened_on: "2025-01-01" }));
    const [p] = listPositions(db, id);
    const res = saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${p!.id}`]: "100", [`rate_${p!.id}`]: "0.0000000000001" }) });
    expect(res.ok).toBe(false);
    expect(listSnapshots(db)).toHaveLength(0);
  });

  it("is refused when value overflows, instead of throwing", () => {
    const { db } = tempDb();
    const id = createAccount(db, input({ name: "USD", currency: "USD", opened_on: "2025-01-01" }));
    const [p] = listPositions(db, id);
    const res = saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${p!.id}`]: "90000000000000", [`rate_${p!.id}`]: "999999999" }) });
    expect(res).toMatchObject({ ok: false });
  });

  it("round-trips through export and import when valid", () => {
    const { db } = tempDb();
    const id = createAccount(db, input({ name: "USD", currency: "USD", opened_on: "2025-01-01" }));
    const [p] = listPositions(db, id);
    expect(saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${p!.id}`]: "100", [`rate_${p!.id}`]: "0,9" }) })).toMatchObject({ ok: true });
    expect(importStore(tempDb().db, JSON.parse(JSON.stringify(exportStore(db))))).toMatchObject({ ok: true });
  });
});

describe("the idle-cash threshold", () => {
  it("accepts 0 to the maximum, and nothing else", () => {
    for (const ok of ["0", "2000", "2000.5", String(MAX_IDLE_CASH_EUR)]) expect(isValidIdleCashEur(ok)).toBe(true);
    for (const bad of ["-1", "abc", "", String(MAX_IDLE_CASH_EUR + 1), "99999999999999999999"]) expect(isValidIdleCashEur(bad)).toBe(false);
  });

  it("falls back to the default when the stored value is out of range, and the summary still renders", () => {
    const { db } = tempDb();
    const id = createAccount(db, input({ opened_on: "2025-01-01" }));
    const [p] = listPositions(db, id);
    eurSnap(db, p!.id, "2026-10", 300000);
    setSetting(db, "idle_cash_eur", "99999999999999999999");
    expect(idleCashEur(db)).toBe("2000");
    expect(idleThresholdMinor(db)).toBe(200000);
    expect(() => summaryFor(db, "2026-10")).not.toThrow();
    expect(summaryFor(db, "2026-10").idle_cash).toHaveLength(1);
  });

  it("is refused by the importer", () => {
    const { db } = tempDb();
    createAccount(db, input({ opened_on: "2025-01-01" }));
    const file = JSON.parse(JSON.stringify(exportStore(db)));
    file.settings = { idle_cash_eur: "99999999999999999999" };
    expect(importStore(tempDb().db, file)).toMatchObject({ ok: false });
  });
});

describe("an account's latest close", () => {
  const acct = account(1, { currency: "EUR" });
  const eur = cashPosition(1, 1, "EUR");
  const usd = cashPosition(2, 1, "USD");

  it("uses one month only: an older balance is not shown under the newer month", () => {
    // August has EUR and USD, September only EUR.
    const snaps = [snap(eur, "2026-08", 100000), snap(usd, "2026-08", 100000, "0.9"), snap(eur, "2026-09", 50000)];
    expect(accountLastClose(acct, [eur, usd], snaps)).toEqual({ eur_minor: 50000, month: "2026-09", missing: 1 });
  });

  it("sums every position closed in the latest month", () => {
    const snaps = [snap(eur, "2026-09", 50000), snap(usd, "2026-09", 100000, "0.9")];
    expect(accountLastClose(acct, [eur, usd], snaps)).toEqual({ eur_minor: 140000, month: "2026-09", missing: 0 });
  });

  it("is null for an account never closed, and skips the balance of the closing month", () => {
    expect(accountLastClose(acct, [eur], [])).toBeNull();
    const closed = account(1, { status: "closed", closed_on: "2026-10-10" });
    const snaps = [snap(eur, "2026-09", 70000), snap(eur, "2026-10", 70000)];
    expect(accountLastClose(closed, [eur], snaps)).toEqual({ eur_minor: 70000, month: "2026-09", missing: 0 });
  });
});

describe("the percentage change base", () => {
  it("is the sum of the earlier closes of the positions in the change, not last month's total", () => {
    const A = account(1);
    const B = account(2);
    const pa = cashPosition(1, 1);
    const pb = cashPosition(2, 2);
    const snaps = [snap(pa, "2026-08", 10000), snap(pb, "2026-08", 10000), snap(pa, "2026-09", 10000), snap(pa, "2026-10", 11000), snap(pb, "2026-10", 11000)];
    const s = buildSummary({ month: "2026-10", accounts: [A, B], positions: [pa, pb], snapshots: snaps, idleCashThresholdMinor: 0 });
    expect(s.net_worth_eur_minor).toBe(22000);
    expect(s.previous_net_worth_eur_minor).toBe(10000); // only A was closed in September
    expect(s.change).toMatchObject({ total: 2000, base_eur_minor: 20000 });
    expect(s.change!.total / s.change!.base_eur_minor).toBeCloseTo(0.1);
  });

  it("counts a new position as zero in the base", () => {
    const A = account(1);
    const pa = cashPosition(1, 1);
    const pn = assetPosition(2, 1, "BTC");
    const snaps = [snap(pa, "2026-09", 10000), snap(pa, "2026-10", 10000), snap(pn, "2026-10", "0.1", "1000")];
    const s = buildSummary({ month: "2026-10", accounts: [A], positions: [pa, pn], snapshots: snaps, idleCashThresholdMinor: 0 });
    expect(s.change!.base_eur_minor).toBe(10000);
  });
});

describe("clearing a saved amount", () => {
  it("deletes that position's close for the month and leaves the rest", () => {
    const { db } = tempDb();
    const a = createAccount(db, input({ name: "One", opened_on: "2025-01-01" }));
    const b = createAccount(db, input({ name: "Two", opened_on: "2025-01-01" }));
    const [pA] = listPositions(db, a);
    const [pB] = listPositions(db, b);
    eurSnap(db, pA!.id, "2026-09", 100000);
    eurSnap(db, pA!.id, "2026-10", 120000);
    eurSnap(db, pB!.id, "2026-10", 30000);
    const res = saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${pA!.id}`]: "  ", [`amount_${pB!.id}`]: "300" }) });
    expect(res).toEqual({ ok: true, saved: 1, cleared: 1 });
    const left = listSnapshots(db).map((s) => `${s.position_id}:${s.month}`);
    expect(left).toEqual([`${pA!.id}:2026-09`, `${pB!.id}:2026-10`]);
    const s = summaryFor(db, "2026-10");
    expect(s.net_worth_eur_minor).toBe(30000);
    expect(s.not_closed.map((n) => n.account.id)).toEqual([a]);
  });

  it("works when clearing is the only change", () => {
    const { db } = tempDb();
    const a = createAccount(db, input({ opened_on: "2025-01-01" }));
    const [pA] = listPositions(db, a);
    eurSnap(db, pA!.id, "2026-10", 120000);
    expect(saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${pA!.id}`]: "" }) })).toEqual({ ok: true, saved: 0, cleared: 1 });
    expect(listSnapshots(db)).toHaveLength(0);
  });

  it("leaves a position alone when the form has no field for it", () => {
    const { db } = tempDb();
    const a = createAccount(db, input({ opened_on: "2025-01-01" }));
    const [pA] = listPositions(db, a);
    eurSnap(db, pA!.id, "2026-10", 120000);
    expect(saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({}) })).toMatchObject({ ok: false });
    expect(listSnapshots(db)).toHaveLength(1);
  });

  it("an empty form on an empty month still says there is nothing to save", () => {
    const { db } = tempDb();
    const a = createAccount(db, input({ opened_on: "2025-01-01" }));
    const [pA] = listPositions(db, a);
    expect(saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`amount_${pA!.id}`]: "" }) })).toMatchObject({ ok: false });
  });
});

// A position added to an account later keeps working with the new rules.
describe("positions added later", () => {
  it("are cleared like any other", () => {
    const { db } = tempDb();
    const k = createAccount(db, input({ institution: "Kraken", name: "X", kind: "crypto_exchange", opened_on: "2025-01-01" }));
    const added = addPosition(db, k, { kind: "asset", asset_kind: "crypto", symbol: "BTC" }) as { id: number };
    const btc = listPositions(db, k).find((p) => p.id === added.id)!;
    saveSnapshot(db, { position: btc, month: "2026-10", amount_minor: null, quantity: "0.5", rate: "70000", rate_date: null, rate_source: "manual" });
    const res = saveMonth(db, { month: "2026-10", today: TODAY, useCache: false, get: form({ [`qty_${btc.id}`]: "" }) });
    expect(res).toEqual({ ok: true, saved: 0, cleared: 1 });
  });
});
