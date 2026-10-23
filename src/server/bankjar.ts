import { z } from "zod";

/** BankJar is reached by link, plus one public GET for the top savings offer. That request carries no user data. */
export const BANKJAR_ORIGIN = "https://bankjar.fabriquefutur.com";
export const BANKJAR_SAVINGS_LINK = `${BANKJAR_ORIGIN}/leaderboard/savings`;
export const BANKJAR_OFFERS_URL = `${BANKJAR_ORIGIN}/api/v1/offers?goal=savings`;

export interface TopOffer {
  bank: string;
  product_name: string;
  rate_tae: number | null;
}

const ResponseSchema = z.object({
  offers: z
    .array(
      z.object({
        bank: z.string().min(1),
        product_name: z.string().min(1),
        rate_tae: z.number().nullable().optional(),
      }),
    )
    .min(1),
});

/** Parses the offers response and returns the first (best-ranked) offer. */
export function parseTopOffer(json: unknown): TopOffer | null {
  const parsed = ResponseSchema.safeParse(json);
  if (!parsed.success) return null;
  const first = parsed.data.offers[0]!;
  return { bank: first.bank, product_name: first.product_name, rate_tae: first.rate_tae ?? null };
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

let cached: { at: number; offer: TopOffer | null } | null = null;
const TTL_MS = 60 * 60 * 1000;

/**
 * The top savings offer from BankJar's public API, or null. A plain GET with no cookies,
 * no identifiers and no query beyond `goal=savings`. Any failure returns null, silently.
 */
export async function fetchTopSavingsOffer(fetchImpl: FetchLike = (u, i) => fetch(u, i), nowMs: number = Date.now()): Promise<TopOffer | null> {
  if (cached && nowMs - cached.at < TTL_MS) return cached.offer;
  let offer: TopOffer | null = null;
  try {
    const res = await fetchImpl(BANKJAR_OFFERS_URL, {
      method: "GET",
      headers: { accept: "application/json" },
      credentials: "omit",
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (res.ok) offer = parseTopOffer(await res.json());
  } catch {
    offer = null;
  }
  cached = { at: nowMs, offer };
  return offer;
}

export function resetBankjarCache(): void {
  cached = null;
}
