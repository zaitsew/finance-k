import { dec, decToString, div, fromMinor, mul, sub, toMinor, type Dec } from "./decimal";
import type { Position, Snapshot } from "./types";

/** Currencies whose minor unit is not 1/100. Everything else has two decimals. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "ISK"]);

export function currencyDecimals(code: string): number {
  return ZERO_DECIMAL.has(code) ? 0 : 2;
}

export const CURRENCY_RE = /^[A-Z]{3}$/;

/** Currencies offered in forms. Any ISO code works; these are the quick picks. */
export const COMMON_CURRENCIES = ["EUR", "USD", "RUB", "GBP", "CHF", "JPY", "CNY", "TRY", "AED", "UAH", "KZT", "GEL"] as const;

/** Precision of a derived EUR-per-unit rate. */
export const RATE_SCALE = 12;

/** units-of-currency per EUR (the ECB/CBR convention) -> EUR per one unit. */
export function eurPerUnit(perEur: string): string {
  return decToString(div(dec(1), dec(perEur), RATE_SCALE));
}

/** The EUR value of a position at a rate, in cents. The one place where a native amount becomes EUR. */
export function valueEurMinor(
  position: Pick<Position, "kind" | "currency">,
  amount: { amount_minor: number | null; quantity: string | null },
  rate: string,
): number {
  const r = dec(rate);
  if (position.kind === "cash") {
    if (amount.amount_minor === null) throw new Error("A cash snapshot needs amount_minor");
    const major = fromMinor(amount.amount_minor, currencyDecimals(position.currency ?? "EUR"));
    return toMinor(mul(major, r), 2);
  }
  if (amount.quantity === null) throw new Error("An asset snapshot needs a quantity");
  return toMinor(mul(dec(amount.quantity), r), 2);
}

/** Native amount of a cash snapshot as a Dec in major units. */
export function nativeMajor(position: Pick<Position, "currency">, snap: Pick<Snapshot, "amount_minor">): Dec {
  return fromMinor(snap.amount_minor ?? 0, currencyDecimals(position.currency ?? "EUR"));
}

/** Rate change as an exact decimal. */
export const rateDelta = (now: string, prev: string): Dec => sub(dec(now), dec(prev));

/**
 * Reads what a person types into an amount or quantity box. A dot or a comma is the
 * decimal mark when it appears once; when both appear the last one is the decimal mark;
 * spaces and apostrophes group digits. Returns a plain decimal string, or null.
 */
export function parseNumberInput(raw: string): string | null {
  let text = raw.trim().replace(/[\s'\u00a0\u202f]/g, "");
  let sign = "";
  if (text.startsWith("-") || text.startsWith("+")) {
    sign = text.startsWith("-") ? "-" : "";
    text = text.slice(1);
  }
  if (!/^[\d.,]+$/.test(text) || !/\d/.test(text)) return null;
  const count = (mark: string): number => text.split(mark).length - 1;
  const dots = count(".");
  const commas = count(",");
  if (dots > 0 && commas > 0) {
    const decimalMark = text.lastIndexOf(".") > text.lastIndexOf(",") ? "." : ",";
    const groupMark = decimalMark === "." ? "," : ".";
    if (count(decimalMark) !== 1) return null;
    text = text.split(groupMark).join("").replace(decimalMark, ".");
  } else if (dots + commas > 0) {
    const mark = dots > 0 ? "." : ",";
    if (count(mark) === 1) {
      text = text.replace(mark, ".");
    } else {
      // "1.234.567": the mark can only be a grouping mark.
      const parts = text.split(mark);
      if (parts.slice(1).some((p) => p.length !== 3)) return null;
      text = parts.join("");
    }
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  if (text.startsWith(".")) text = `0${text}`;
  if (text.endsWith(".")) text = text.slice(0, -1);
  return decToString(dec(`${sign}${text}`));
}

/** A typed amount to integer minor units of the currency. Returns null when it is not a number or has too many decimals. */
export function parseMinorInput(raw: string, currency: string): number | null {
  const text = parseNumberInput(raw);
  if (text === null) return null;
  const d = dec(text);
  const decimals = currencyDecimals(currency);
  if (d.s > decimals) return null;
  return toMinor(d, decimals);
}

/** Integer minor units as text for an input box: 123450, EUR -> "1234.50". */
export function minorToInput(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const sign = minor < 0 ? "-" : "";
  const digits = String(Math.abs(minor)).padStart(decimals + 1, "0");
  return decimals === 0 ? `${sign}${digits}` : `${sign}${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
}

// --- Display (UI text is English, numbers follow es-ES) ---------------------------

const eurFmt = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });

export function formatEur(minor: number): string {
  return eurFmt.format(minor / 100);
}

export function formatEurSigned(minor: number): string {
  if (minor === 0) return formatEur(0);
  return `${minor > 0 ? "+" : "−"}${formatEur(Math.abs(minor))}`;
}

const nativeFmtCache = new Map<string, Intl.NumberFormat>();

export function formatMoney(minor: number, currency: string): string {
  let f = nativeFmtCache.get(currency);
  if (!f) {
    try {
      f = new Intl.NumberFormat("es-ES", { style: "currency", currency, useGrouping: "always" });
    } catch {
      f = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, useGrouping: "always" });
    }
    nativeFmtCache.set(currency, f);
  }
  return f.format(minor / 10 ** currencyDecimals(currency));
}

/** A decimal string in es-ES style: "1234.5" -> "1.234,5". No rounding; exact digits. */
export function formatDecimalEs(text: string): string {
  const d = dec(text);
  const plain = decToString(d);
  const neg = plain.startsWith("-");
  const [int = "0", frac] = plain.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "−" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

/** An EUR-per-unit rate for display: trims to 6 significant decimals at most. */
export function formatRate(text: string): string {
  const d = dec(text);
  const plain = decToString(d);
  const [int = "0", frac = ""] = plain.split(".");
  const digits = Math.abs(Number(int)) >= 1 ? 4 : 8;
  const trimmed = frac.slice(0, digits).replace(/0+$/, "");
  return trimmed ? `${int},${trimmed}` : int;
}
