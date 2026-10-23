import { dec, decToString, div, isDecimalString } from "../../core/decimal";

/** Parsers for the three rate sources. Pure: text in, rows out. Fixtures in tests/fixtures are real payloads. */

export interface FxQuote {
  date: string;
  currency: string;
  /** Units of `currency` per 1 EUR. */
  per_eur: string;
}

/** ECB eurofxref XML (daily, 90-day or full history): `<Cube time="…"><Cube currency="USD" rate="1.16"/>…`. */
export function parseEcbXml(xml: string): FxQuote[] {
  const out: FxQuote[] = [];
  for (const day of xml.matchAll(/<Cube\s+time="(\d{4}-\d{2}-\d{2})"\s*>([\s\S]*?)<\/Cube>/g)) {
    const date = day[1]!;
    for (const q of day[2]!.matchAll(/<Cube\s+currency="([A-Z]{3})"\s+rate="([^"]+)"\s*\/>/g)) {
      if (isDecimalString(q[2]!) && Number(q[2]) > 0) out.push({ date, currency: q[1]!, per_eur: decToString(dec(q[2]!)) });
    }
  }
  return out;
}

export interface CbrDay {
  /** The date the rates are valid for, YYYY-MM-DD. */
  date: string;
  /** Roubles per one unit of each foreign currency. */
  rub_per_unit: Record<string, string>;
}

/** Decodes a Bank of Russia response. It is windows-1251, which `Response.text()` would mangle. */
export function decodeCbr(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const head = new TextDecoder("latin1").decode(view.subarray(0, 100));
  const label = /encoding="([^"]+)"/i.exec(head)?.[1] ?? "windows-1251";
  return new TextDecoder(label).decode(view);
}

/** Bank of Russia XML_daily: `<Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>91,9337</Value>`. Decimal commas, nominal may be 100. */
export function parseCbrXml(xml: string): CbrDay {
  const dateMatch = /<ValCurs\s+Date="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!dateMatch) throw new Error("Bank of Russia response has no date");
  const rub_per_unit: Record<string, string> = {};
  for (const block of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/g)) {
    const body = block[1]!;
    const code = /<CharCode>([A-Z]{3})<\/CharCode>/.exec(body)?.[1];
    const nominal = /<Nominal>(\d+)<\/Nominal>/.exec(body)?.[1];
    const value = /<Value>([\d\s]+(?:,\d+)?)<\/Value>/.exec(body)?.[1];
    if (!code || !nominal || !value) continue;
    const perUnit = div(dec(value.replace(/\s/g, "").replace(",", ".")), dec(nominal), 10);
    rub_per_unit[code] = decToString(perUnit);
  }
  return { date: `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`, rub_per_unit };
}

/** RUB per 1 EUR from a Bank of Russia day, or null when the EUR row is missing. */
export function rubPerEur(day: CbrDay): string | null {
  return day.rub_per_unit.EUR ?? null;
}

/** Symbol -> CoinGecko id. Anything else is a manual price. */
export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  USDT: "tether",
  USDC: "usd-coin",
  BNB: "binancecoin",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  DOT: "polkadot",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  LINK: "chainlink",
  TON: "the-open-network",
  TRX: "tron",
  XMR: "monero",
};

export function coingeckoId(symbol: string): string | null {
  return COINGECKO_IDS[symbol.toUpperCase()] ?? null;
}

function eurFrom(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return decToString(dec(value));
}

/** `/simple/price?ids=…&vs_currencies=eur` -> EUR price per symbol. */
export function parseCoingeckoSimple(json: unknown, symbols: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof json !== "object" || json === null) return out;
  for (const symbol of symbols) {
    const id = coingeckoId(symbol);
    if (!id) continue;
    const entry = (json as Record<string, unknown>)[id];
    const price = typeof entry === "object" && entry !== null ? eurFrom((entry as Record<string, unknown>).eur) : null;
    if (price) out[symbol] = price;
  }
  return out;
}

/** `/coins/{id}/history?date=DD-MM-YYYY` -> EUR price on that date, or null. */
export function parseCoingeckoHistory(json: unknown): string | null {
  if (typeof json !== "object" || json === null) return null;
  const market = (json as Record<string, unknown>).market_data;
  if (typeof market !== "object" || market === null) return null;
  const current = (market as Record<string, unknown>).current_price;
  if (typeof current !== "object" || current === null) return null;
  return eurFrom((current as Record<string, unknown>).eur);
}
