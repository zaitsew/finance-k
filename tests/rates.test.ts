import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addDays, daysBetween, lastDayOf } from "../src/core/months";
import { COINGECKO_IDS, coingeckoId, decodeCbr, parseCbrXml, parseCoingeckoHistory, parseCoingeckoSimple, parseEcbXml, rubPerEur } from "../src/server/rates/parse";
import { cachedRateFor, ensureRates, rateDateFor, ratesNeeded, refreshCbr, refreshCrypto, refreshEcb } from "../src/server/rates/client";
import { getRateOnOrBefore, pickOnOrBefore, putRates } from "../src/server/rates/store";
import { assetPosition, cashPosition, fakeFetch, tempDb } from "./helpers";

const fixture = (name: string): Buffer => readFileSync(join(__dirname, "fixtures", name));
const text = (name: string): string => fixture(name).toString("utf8");
const ok = (body: string | Buffer, type = "application/xml") => () =>
  new Response(typeof body === "string" ? body : new Uint8Array(body), { status: 200, headers: { "content-type": type } });

describe("ECB parsing", () => {
  it("reads every day and currency of the XML", () => {
    const rows = parseEcbXml(text("ecb-hist-90d.xml"));
    expect(rows.filter((r) => r.date === "2026-10-23")).toHaveLength(29);
    expect(rows.find((r) => r.date === "2026-10-23" && r.currency === "USD")).toEqual({ date: "2026-10-23", currency: "USD", per_eur: "1.1193" });
    expect(rows.find((r) => r.date === "2026-10-16" && r.currency === "JPY")?.per_eur).toBe("177.82");
    expect([...new Set(rows.map((r) => r.date))]).toEqual(["2026-10-23", "2026-10-22", "2026-10-16", "2026-10-15"]);
  });

  it("has no rouble: the ECB stopped publishing it", () => {
    expect(parseEcbXml(text("ecb-hist-90d.xml")).some((r) => r.currency === "RUB")).toBe(false);
  });

  it("ignores junk", () => {
    expect(parseEcbXml("<html>not xml</html>")).toEqual([]);
    expect(parseEcbXml('<Cube time="2026-10-01"><Cube currency="USD" rate="abc"/><Cube currency="CHF" rate="0.93"/></Cube>')).toEqual([
      { date: "2026-10-01", currency: "CHF", per_eur: "0.93" },
    ]);
  });
});

describe("Bank of Russia parsing", () => {
  it("decodes windows-1251 and reads decimal commas and nominals", () => {
    const raw = fixture("cbr-xml-daily.xml");
    expect(raw.toString("utf8")).toContain("�"); // the Cyrillic names are not UTF-8
    const day = parseCbrXml(decodeCbr(new Uint8Array(raw)));
    expect(day.date).toBe("2026-10-22");
    expect(day.rub_per_unit.EUR).toBe("91.9337");
    expect(day.rub_per_unit.USD).toBe("81.9739");
    expect(day.rub_per_unit.JPY).toBe("0.517577"); // 51,7577 RUB per 100 JPY
    expect(rubPerEur(day)).toBe("91.9337");
  });

  it("refuses a response without a date", () => {
    expect(() => parseCbrXml("<ValCurs></ValCurs>")).toThrow();
  });
});

describe("CoinGecko parsing", () => {
  it("reads the simple price payload, including tiny and integer prices", () => {
    const json = JSON.parse(text("coingecko-simple-price.json"));
    expect(parseCoingeckoSimple(json, ["BTC", "ETH", "SOL", "USDT", "DOGE"])).toEqual({
      BTC: "72633",
      ETH: "2143.42",
      SOL: "0.00000731",
      USDT: "0.8934",
    });
  });

  it("reads the history payload", () => {
    expect(parseCoingeckoHistory(JSON.parse(text("coingecko-history-btc.json")))).toBe("71843.2519876543");
    expect(parseCoingeckoHistory({ id: "bitcoin" })).toBeNull();
    expect(parseCoingeckoHistory({ market_data: { current_price: { usd: 1 } } })).toBeNull();
  });

  it("maps the required symbols and leaves unknown ones for manual entry", () => {
    for (const s of ["BTC", "ETH", "SOL", "USDT", "USDC"]) expect(COINGECKO_IDS[s]).toBeTruthy();
    expect(coingeckoId("btc")).toBe("bitcoin");
    expect(coingeckoId("SHIB2")).toBeNull();
  });
});

describe("month-end rate selection", () => {
  const rows = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"].map((date, i) => ({ date, value: String(1.1 + i / 100) }));

  it("takes the last rate on or before the date", () => {
    expect(pickOnOrBefore(rows, "2026-10-29")?.date).toBe("2026-10-29");
    expect(pickOnOrBefore(rows, "2026-10-31")?.date).toBe("2026-10-30");
    expect(pickOnOrBefore(rows, "2026-10-25")).toBeNull();
  });

  it("falls back to Friday when the month ends on a weekend", () => {
    // 2026-10-31 is a Saturday, 2026-05-31 a Sunday.
    expect(new Date("2026-10-31T00:00:00Z").getUTCDay()).toBe(6);
    expect(new Date("2026-05-31T00:00:00Z").getUTCDay()).toBe(0);
    const { db } = tempDb();
    putRates(db, [
      { kind: "fx", key: "USD", date: "2026-10-30", value: "1.16", source: "ecb" },
      { kind: "fx", key: "USD", date: "2026-10-29", value: "1.15", source: "ecb" },
      { kind: "fx", key: "USD", date: "2026-11-02", value: "1.17", source: "ecb" },
      { kind: "fx", key: "USD", date: "2026-05-29", value: "1.12", source: "ecb" },
      { kind: "fx", key: "USD", date: "2026-06-01", value: "1.13", source: "ecb" },
    ]);
    expect(getRateOnOrBefore(db, "fx", "USD", lastDayOf("2026-10"))?.value).toBe("1.16");
    expect(getRateOnOrBefore(db, "fx", "USD", lastDayOf("2026-05"))?.value).toBe("1.12");
    expect(getRateOnOrBefore(db, "fx", "USD", "2026-05-28")).toBeNull();
    expect(getRateOnOrBefore(db, "fx", "GBP", "2026-10-31")).toBeNull();
  });

  it("converts the cached per-EUR rate into EUR per unit, and EUR to 1", () => {
    const { db } = tempDb();
    putRates(db, [
      { kind: "fx", key: "USD", date: "2026-10-30", value: "1.25", source: "ecb" },
      { kind: "fx", key: "RUB", date: "2026-10-30", value: "100", source: "cbr" },
      { kind: "crypto", key: "BTC", date: "2026-10-31", value: "70000", source: "coingecko" },
    ]);
    expect(cachedRateFor(db, cashPosition(1, 1, "USD"), "2026-10-31")).toEqual({ rate: "0.8", date: "2026-10-30", source: "ecb" });
    expect(cachedRateFor(db, cashPosition(1, 1, "RUB"), "2026-10-31")).toEqual({ rate: "0.01", date: "2026-10-30", source: "cbr" });
    expect(cachedRateFor(db, cashPosition(1, 1, "EUR"), "2026-10-31")).toEqual({ rate: "1", date: "2026-10-31", source: "identity" });
    expect(cachedRateFor(db, assetPosition(1, 1, "BTC"), "2026-10-31")).toEqual({ rate: "70000", date: "2026-10-31", source: "coingecko" });
    expect(cachedRateFor(db, assetPosition(1, 1, "VWCE", "security"), "2026-10-31")).toBeNull();
    expect(cachedRateFor(db, cashPosition(1, 1, "GBP"), "2026-10-31")).toBeNull();
  });

  it("reads rates at the month's last day, or today while the month runs", () => {
    expect(rateDateFor("2026-09", "2026-10-23")).toBe("2026-09-30");
    expect(rateDateFor("2026-10", "2026-10-23")).toBe("2026-10-23");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(daysBetween("2026-10-23", "2026-10-31")).toBe(8);
  });
});

describe("rate fetching, with an injected fetch", () => {
  it("stores ECB rows from the 90-day file and skips what is out of reach", async () => {
    const { db } = tempDb();
    const net = fakeFetch({ "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml": ok(fixture("ecb-hist-90d.xml")) });
    const report = await refreshEcb(db, "2026-10-23", "2026-10-23", net.fn);
    expect(report.failed).toEqual([]);
    expect(getRateOnOrBefore(db, "fx", "USD", "2026-10-31")).toMatchObject({ date: "2026-10-23", value: "1.1193", source: "ecb" });
    expect(net.calls).toEqual(["https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml"]);
  });

  it("uses the full history file for an old date and keeps only a window around it", async () => {
    const { db } = tempDb();
    const net = fakeFetch({ "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml": ok(fixture("ecb-hist-90d.xml")) });
    await refreshEcb(db, "2026-10-16", "2027-03-01", net.fn);
    expect(net.calls[0]).toContain("eurofxref-hist.xml");
    expect(getRateOnOrBefore(db, "fx", "USD", "2026-10-23")?.date).toBe("2026-10-16"); // 10-22 and 10-23 are outside the window
  });

  it("stores RUB per EUR from the Bank of Russia, asking for the date in its format", async () => {
    const { db } = tempDb();
    const net = fakeFetch({ "https://www.cbr.ru/scripts/XML_daily.asp": ok(fixture("cbr-xml-daily.xml"), "application/xml; charset=windows-1251") });
    const report = await refreshCbr(db, "2026-10-22", net.fn);
    expect(report.failed).toEqual([]);
    expect(net.calls[0]).toBe("https://www.cbr.ru/scripts/XML_daily.asp?date_req=22/10/2026");
    expect(getRateOnOrBefore(db, "fx", "RUB", "2026-10-31")).toMatchObject({ date: "2026-10-22", value: "91.9337", source: "cbr" });
  });

  it("fetches today's crypto prices in one call and past months one coin at a time", async () => {
    const { db } = tempDb();
    const live = fakeFetch({ "https://api.coingecko.com/api/v3/simple/price": ok(fixture("coingecko-simple-price.json"), "application/json") });
    const r1 = await refreshCrypto(db, ["BTC", "ETH", "SHIB2"], "2026-10-23", "2026-10-23", live.fn);
    expect(live.calls).toEqual(["https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=eur"]);
    expect(r1.fetched).toEqual(["BTC price", "ETH price"]);
    expect(r1.failed).toEqual([{ what: "SHIB2", reason: "no CoinGecko mapping, enter the price by hand" }]);
    expect(getRateOnOrBefore(db, "crypto", "ETH", "2026-10-23")?.value).toBe("2143.42");

    const past = fakeFetch({ "https://api.coingecko.com/api/v3/coins/bitcoin/history": ok(fixture("coingecko-history-btc.json"), "application/json") });
    await refreshCrypto(db, ["BTC"], "2026-09-30", "2026-10-23", past.fn);
    expect(past.calls).toEqual(["https://api.coingecko.com/api/v3/coins/bitcoin/history?date=30-09-2026&localization=false"]);
    expect(getRateOnOrBefore(db, "crypto", "BTC", "2026-09-30")).toMatchObject({ date: "2026-09-30", value: "71843.2519876543" });
  });

  it("reports a failing source instead of throwing, and keeps going", async () => {
    const { db } = tempDb();
    const net = fakeFetch({
      "https://www.ecb.europa.eu": () => new Response("down", { status: 503 }),
      "https://api.coingecko.com": () => {
        throw new Error("offline");
      },
    });
    const needs = ratesNeeded([cashPosition(1, 1, "USD"), assetPosition(2, 1, "BTC")]);
    const report = await ensureRates(db, needs, "2026-10-23", "2026-10-23", { fetch: net.fn });
    expect(report.fetched).toEqual([]);
    expect(report.failed.map((f) => f.what).sort()).toEqual(["BTC", "ECB reference rates"]);
  });

  it("does not hit the network when the cache is fresh, and does when forced", async () => {
    const { db } = tempDb();
    putRates(db, [
      { kind: "fx", key: "USD", date: "2026-10-30", value: "1.16", source: "ecb" },
      { kind: "crypto", key: "BTC", date: "2026-10-31", value: "70000", source: "coingecko" },
    ]);
    const needs = ratesNeeded([cashPosition(1, 1, "USD"), cashPosition(2, 1, "EUR"), assetPosition(3, 1, "BTC"), assetPosition(4, 1, "VWCE", "security")]);
    expect(needs).toEqual({ currencies: ["USD"], crypto: ["BTC"] });
    const net = fakeFetch({});
    const quiet = await ensureRates(db, needs, "2026-10-31", "2026-11-03", { fetch: net.fn });
    expect(net.calls).toEqual([]);
    expect(quiet).toEqual({ fetched: [], failed: [] });
    await ensureRates(db, needs, "2026-10-31", "2026-11-03", { fetch: net.fn, force: true });
    expect(net.calls.length).toBe(2);
  });

  it("fetches when the cache is older than a week before the date", async () => {
    const { db } = tempDb();
    putRates(db, [{ kind: "fx", key: "USD", date: "2026-10-01", value: "1.16", source: "ecb" }]);
    const net = fakeFetch({ "https://www.ecb.europa.eu": ok(fixture("ecb-hist-90d.xml")) });
    await ensureRates(db, { currencies: ["USD"], crypto: [] }, "2026-10-23", "2026-10-23", { fetch: net.fn });
    expect(net.calls).toHaveLength(1);
  });
});
