import { beforeEach, describe, expect, it } from "vitest";
import { BANKJAR_OFFERS_URL, BANKJAR_SAVINGS_LINK, fetchTopSavingsOffer, parseTopOffer, resetBankjarCache } from "../src/server/bankjar";

const offerBody = { offers: [{ id: "x", bank: "MyInvestor", product_name: "Cuenta Remunerada", rate_tae: 2.5, extra: 1 }, { bank: "Other", product_name: "B", rate_tae: 1 }], disclaimer: "…" };
const json = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("BankJar link", () => {
  beforeEach(() => resetBankjarCache());

  it("points at the public savings ranking and the public offers GET", () => {
    expect(BANKJAR_SAVINGS_LINK).toBe("https://bankjar.fabriquefutur.com/leaderboard/savings");
    expect(BANKJAR_OFFERS_URL).toBe("https://bankjar.fabriquefutur.com/api/v1/offers?goal=savings");
  });

  it("reads the first ranked offer", () => {
    expect(parseTopOffer(offerBody)).toEqual({ bank: "MyInvestor", product_name: "Cuenta Remunerada", rate_tae: 2.5 });
    expect(parseTopOffer({ offers: [] })).toBeNull();
    expect(parseTopOffer({ nope: 1 })).toBeNull();
    expect(parseTopOffer({ offers: [{ bank: "A", product_name: "B", rate_tae: null }] })).toEqual({ bank: "A", product_name: "B", rate_tae: null });
  });

  it("sends a bare GET: no body, no cookies, nothing about the user", async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const offer = await fetchTopSavingsOffer(async (url, init) => {
      seen = { url, init };
      return json(offerBody)();
    });
    expect(offer?.bank).toBe("MyInvestor");
    expect(seen!.url).toBe(BANKJAR_OFFERS_URL);
    expect(seen!.init?.method).toBe("GET");
    expect(seen!.init?.body).toBeUndefined();
    expect(seen!.init?.credentials).toBe("omit");
    expect(Object.keys((seen!.init?.headers ?? {}) as Record<string, string>)).toEqual(["accept"]);
  });

  it("fails silently", async () => {
    expect(await fetchTopSavingsOffer(async () => Promise.reject(new Error("offline")))).toBeNull();
    resetBankjarCache();
    expect(await fetchTopSavingsOffer(json({}, 500))).toBeNull();
    resetBankjarCache();
    expect(await fetchTopSavingsOffer(async () => new Response("<html>", { status: 200 }))).toBeNull();
  });

  it("asks once an hour", async () => {
    let calls = 0;
    const f = async () => {
      calls++;
      return json(offerBody)();
    };
    await fetchTopSavingsOffer(f, 1_000);
    await fetchTopSavingsOffer(f, 2_000);
    expect(calls).toBe(1);
    await fetchTopSavingsOffer(f, 1_000 + 61 * 60 * 1000);
    expect(calls).toBe(2);
  });
});
