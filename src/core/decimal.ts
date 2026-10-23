/**
 * Exact decimal arithmetic on BigInt. Stored money is never a JS float: amounts
 * are integer minor units, quantities and rates are decimal strings, and every
 * conversion between them goes through this module with an explicit rounding mode.
 *
 * A Dec is n / 10^s. Values are normalised (no trailing zeros in the fraction).
 */

export type Dec = { readonly n: bigint; readonly s: number };

/** "half-up" rounds halves away from zero (2.5 -> 3, -2.5 -> -3). "half-even" rounds to the even neighbour. */
export type Rounding = "half-up" | "half-even";

const DECIMAL_RE = /^([+-])?(\d+)(?:\.(\d+))?$/;

const pow10 = (k: number): bigint => 10n ** BigInt(k);

function norm(n: bigint, s: number): Dec {
  while (s > 0 && n % 10n === 0n) {
    n /= 10n;
    s -= 1;
  }
  return { n, s };
}

export function isDecimalString(text: string): boolean {
  return DECIMAL_RE.test(text);
}

/** Parses "-12.340", "7", "0.5". Throws on anything else (no exponents, no separators). */
export function dec(text: string | number | bigint): Dec {
  if (typeof text === "bigint") return { n: text, s: 0 };
  if (typeof text === "number") {
    if (!Number.isFinite(text)) throw new Error(`Not a finite number: ${text}`);
    text = numberToDecimalString(text);
  }
  const m = DECIMAL_RE.exec(text.trim());
  if (!m) throw new Error(`Not a decimal: "${text}"`);
  const frac = m[3] ?? "";
  const n = BigInt(m[2]! + frac) * (m[1] === "-" ? -1n : 1n);
  return norm(n, frac.length);
}

/** A JS number as a plain decimal string, expanding exponents. Used only for API payloads that arrive as JSON numbers. */
export function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Not a finite number: ${value}`);
  const text = String(value);
  if (!/e/i.test(text)) return text;
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (!m) throw new Error(`Cannot expand ${text}`);
  const sign = m[1] ?? "";
  const digits = (m[2] ?? "") + (m[3] ?? "");
  const pointAt = (m[2] ?? "").length + Number(m[4]);
  if (pointAt <= 0) return `${sign}0.${"0".repeat(-pointAt)}${digits}`;
  if (pointAt >= digits.length) return `${sign}${digits}${"0".repeat(pointAt - digits.length)}`;
  return `${sign}${digits.slice(0, pointAt)}.${digits.slice(pointAt)}`;
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  const s = Math.max(a.s, b.s);
  return [a.n * pow10(s - a.s), b.n * pow10(s - b.s), s];
}

export const add = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return norm(x + y, s);
};
export const sub = (a: Dec, b: Dec): Dec => {
  const [x, y, s] = align(a, b);
  return norm(x - y, s);
};
export const mul = (a: Dec, b: Dec): Dec => norm(a.n * b.n, a.s + b.s);
export const neg = (a: Dec): Dec => ({ n: -a.n, s: a.s });
export const isZero = (a: Dec): boolean => a.n === 0n;
export const cmp = (a: Dec, b: Dec): -1 | 0 | 1 => {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
};
export const eq = (a: Dec, b: Dec): boolean => cmp(a, b) === 0;

/** Integer division of n by d (d > 0), rounded as asked. */
function divRound(n: bigint, d: bigint, mode: Rounding): bigint {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  let q = abs / d;
  const r = abs % d;
  const twice = r * 2n;
  if (twice > d || (twice === d && (mode === "half-up" || q % 2n === 1n))) q += 1n;
  return neg ? -q : q;
}

/** Rounds to `scale` decimals and returns the scaled integer (value * 10^scale). */
export function toScaled(a: Dec, scale: number, mode: Rounding = "half-up"): bigint {
  if (a.s <= scale) return a.n * pow10(scale - a.s);
  return divRound(a.n, pow10(a.s - scale), mode);
}

export function round(a: Dec, scale: number, mode: Rounding = "half-up"): Dec {
  return norm(toScaled(a, scale, mode), scale);
}

/** a / b rounded to `scale` decimals. */
export function div(a: Dec, b: Dec, scale: number, mode: Rounding = "half-up"): Dec {
  if (b.n === 0n) throw new Error("Division by zero");
  // a/b = (a.n / 10^a.s) / (b.n / 10^b.s) = a.n * 10^b.s / (b.n * 10^a.s)
  // scaled by 10^scale: a.n * 10^(b.s + scale) / (b.n * 10^a.s)
  let num = a.n * pow10(b.s + scale);
  let den = b.n * pow10(a.s);
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  return norm(divRound(num, den, mode), scale);
}

export function decToString(a: Dec): string {
  const neg = a.n < 0n;
  const abs = (neg ? -a.n : a.n).toString().padStart(a.s + 1, "0");
  const int = a.s === 0 ? abs : abs.slice(0, abs.length - a.s);
  const frac = a.s === 0 ? "" : abs.slice(abs.length - a.s);
  return `${neg && a.n !== 0n ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Canonical text of a decimal string: "1.50" -> "1.5", "007" -> "7". Used to compare quantities. */
export function normalize(text: string): string {
  return decToString(dec(text));
}

/** Integer minor units -> Dec in major units (12345, 2 -> 123.45). */
export function fromMinor(minor: number | bigint, decimals: number): Dec {
  return norm(BigInt(minor), decimals);
}

/** Dec in major units -> integer minor units, rounded as asked. Throws outside the safe integer range. */
export function toMinor(a: Dec, decimals: number, mode: Rounding = "half-up"): number {
  const scaled = toScaled(a, decimals, mode);
  if (scaled > BigInt(Number.MAX_SAFE_INTEGER) || scaled < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount is too large");
  }
  return Number(scaled);
}
