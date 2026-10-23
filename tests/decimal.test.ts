import { describe, expect, it } from "vitest";
import { add, cmp, dec, decToString, div, fromMinor, mul, normalize, numberToDecimalString, round, sub, toMinor } from "../src/core/decimal";

const s = decToString;

describe("decimal", () => {
  it("parses and prints without float noise", () => {
    expect(s(dec("0.1"))).toBe("0.1");
    expect(s(add(dec("0.1"), dec("0.2")))).toBe("0.3");
    expect(s(dec("-007.500"))).toBe("-7.5");
    expect(s(dec("0"))).toBe("0");
    expect(s(sub(dec("1"), dec("1.0")))).toBe("0");
    expect(() => dec("1e5")).toThrow();
    expect(() => dec("1,5")).toThrow();
    expect(() => dec("")).toThrow();
  });

  it("multiplies exactly", () => {
    expect(s(mul(dec("1234.56"), dec("0.86111111")))).toBe("1063.0933319616");
    expect(s(mul(dec("-2"), dec("0.5")))).toBe("-1");
  });

  it("rounds half away from zero by default, and half to even on request", () => {
    expect(s(round(dec("2.5"), 0))).toBe("3");
    expect(s(round(dec("-2.5"), 0))).toBe("-3");
    expect(s(round(dec("2.4999"), 0))).toBe("2");
    expect(s(round(dec("2.5"), 0, "half-even"))).toBe("2");
    expect(s(round(dec("3.5"), 0, "half-even"))).toBe("4");
    expect(s(round(dec("0.125"), 2))).toBe("0.13");
    expect(s(round(dec("0.125"), 2, "half-even"))).toBe("0.12");
    expect(s(round(dec("-0.005"), 2))).toBe("-0.01");
  });

  it("divides to a fixed scale", () => {
    expect(s(div(dec("1"), dec("3"), 6))).toBe("0.333333");
    expect(s(div(dec("2"), dec("3"), 6))).toBe("0.666667");
    expect(s(div(dec("1"), dec("1.1193"), 12))).toBe("0.893415527562");
    expect(s(div(dec("-1"), dec("4"), 2))).toBe("-0.25");
    expect(s(div(dec("1"), dec("-4"), 2))).toBe("-0.25");
    expect(() => div(dec("1"), dec("0"), 2)).toThrow();
  });

  it("converts to and from minor units with explicit rounding", () => {
    expect(toMinor(dec("12.345"), 2)).toBe(1235);
    expect(toMinor(dec("-12.345"), 2)).toBe(-1235);
    expect(toMinor(dec("12.345"), 2, "half-even")).toBe(1234);
    expect(toMinor(dec("12"), 2)).toBe(1200);
    expect(s(fromMinor(123450, 2))).toBe("1234.5");
    expect(s(fromMinor(-5, 2))).toBe("-0.05");
    expect(s(fromMinor(7, 0))).toBe("7");
    expect(() => toMinor(dec("99999999999999999999"), 2)).toThrow();
  });

  it("compares and normalises", () => {
    expect(cmp(dec("1.50"), dec("1.5"))).toBe(0);
    expect(cmp(dec("1.49"), dec("1.5"))).toBe(-1);
    expect(normalize("0.50")).toBe("0.5");
    expect(normalize("010")).toBe("10");
  });

  it("expands JSON numbers written with an exponent", () => {
    expect(numberToDecimalString(7.31e-6)).toBe("0.00000731");
    expect(numberToDecimalString(1.5e21)).toBe("1500000000000000000000");
    expect(numberToDecimalString(72633)).toBe("72633");
    expect(numberToDecimalString(2143.42)).toBe("2143.42");
    expect(s(dec(1e-7))).toBe("0.0000001");
  });
});
