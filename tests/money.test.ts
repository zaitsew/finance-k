import { describe, expect, it } from "vitest";
import { eurPerUnit, formatDecimalEs, formatEur, formatEurSigned, minorToInput, parseMinorInput, parseNumberInput, valueEurMinor } from "../src/core/money";
import { addMonths, isDate, isMonth, lastDayOf, monthRange } from "../src/core/months";

describe("parseNumberInput", () => {
  it.each([
    ["1234.56", "1234.56"],
    ["1234,56", "1234.56"],
    ["1.234,56", "1234.56"],
    ["1,234.56", "1234.56"],
    ["1 234,5", "1234.5"],
    ["1.234.567", "1234567"],
    ["0,5", "0.5"],
    [".5", "0.5"],
    ["-12,50", "-12.5"],
    ["  42  ", "42"],
    ["0.00000731", "0.00000731"],
  ])("reads %s as %s", (input, expected) => {
    expect(parseNumberInput(input)).toBe(expected);
  });

  it.each(["", "abc", "1.2.3", "1,2,3", "12e3", "1.234,56,7", "--1", "€5"])("refuses %s", (input) => {
    expect(parseNumberInput(input)).toBeNull();
  });

  it("reads minor units and refuses too many decimals", () => {
    expect(parseMinorInput("1.234,56", "EUR")).toBe(123456);
    expect(parseMinorInput("-5", "EUR")).toBe(-500);
    expect(parseMinorInput("10,005", "EUR")).toBeNull();
    expect(parseMinorInput("1000", "JPY")).toBe(1000);
    expect(parseMinorInput("1000,5", "JPY")).toBeNull();
  });

  it("writes minor units back for an input box", () => {
    expect(minorToInput(123450, "EUR")).toBe("1234.50");
    expect(minorToInput(-5, "EUR")).toBe("-0.05");
    expect(minorToInput(7, "EUR")).toBe("0.07");
    expect(minorToInput(1000, "JPY")).toBe("1000");
  });
});

describe("valuation", () => {
  it("converts cash and assets to cents with one rounding", () => {
    expect(valueEurMinor({ kind: "cash", currency: "EUR" }, { amount_minor: 123456, quantity: null }, "1")).toBe(123456);
    // 1000.00 USD at 0.893415527562 EUR each = 893.415884035 -> 893.42
    expect(valueEurMinor({ kind: "cash", currency: "USD" }, { amount_minor: 100000, quantity: null }, "0.893415527562")).toBe(89342);
    // 0.5 BTC at 72,633 = 36,316.50
    expect(valueEurMinor({ kind: "asset", currency: null }, { amount_minor: null, quantity: "0.5" }, "72633")).toBe(3631650);
    expect(valueEurMinor({ kind: "cash", currency: "USD" }, { amount_minor: -2550, quantity: null }, "0.9")).toBe(-2295);
    expect(valueEurMinor({ kind: "cash", currency: "JPY" }, { amount_minor: 10000, quantity: null }, "0.0057")).toBe(5700);
  });

  it("derives EUR per unit from a per-EUR rate", () => {
    expect(eurPerUnit("1.1193")).toBe("0.893415527562");
    expect(eurPerUnit("91.9337")).toBe("0.010877404042");
    expect(eurPerUnit("2")).toBe("0.5");
  });
});

describe("formatting", () => {
  it("formats EUR in es-ES style", () => {
    expect(formatEur(123456).replace(/ /g, " ")).toBe("1.234,56 €");
    expect(formatEurSigned(-500).replace(/ /g, " ")).toBe("−5,00 €");
    expect(formatEurSigned(0).replace(/ /g, " ")).toBe("0,00 €");
    expect(formatDecimalEs("1234567.125")).toBe("1.234.567,125");
  });
});

describe("months", () => {
  it("does calendar maths", () => {
    expect(lastDayOf("2026-02")).toBe("2026-02-28");
    expect(lastDayOf("2028-02")).toBe("2028-02-29");
    expect(lastDayOf("2026-10")).toBe("2026-10-31");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 3)).toBe("2027-02");
    expect(monthRange("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
    expect(isMonth("2026-13")).toBe(false);
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2028-02-29")).toBe(true);
  });
});
