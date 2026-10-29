import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildFixture } from "../scripts/fixture-db";
import { createHandler } from "../mcp/server";
import { readLedger } from "../mcp/data";
import { TOOLS } from "../mcp/tools";
import { VERSION } from "../mcp/version";
import { buildSummary } from "../src/core/summary";
import { tempDir } from "./helpers";

const BUNDLE = join(__dirname, "..", "plugins", "finance-k", "server", "finance-k.mjs");

function fixtureDir(): string {
  const dir = tempDir();
  buildFixture(dir);
  return dir;
}

type Reply = { result?: Record<string, any>; error?: { code: number; message: string } };

function call(dir: string, name: string, args: Record<string, unknown> = {}): Reply {
  const handle = createHandler(() => readLedger(dir));
  return handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) as Reply;
}

const data = (dir: string, name: string, args: Record<string, unknown> = {}) => {
  const r = call(dir, name, args);
  expect(r.result?.isError, JSON.stringify(r)).toBe(false);
  return r.result!.structuredContent;
};

describe("protocol", () => {
  it("answers initialize with the client's protocol version and tools capability", () => {
    const handle = createHandler(() => readLedger(fixtureDir()));
    const r = handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }) as Reply;
    expect(r.result?.protocolVersion).toBe("2025-06-18");
    expect(r.result?.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.result?.serverInfo).toMatchObject({ name: "finance-k", version: VERSION });
  });

  it("falls back to its newest protocol for an unknown version, ignores notifications, rejects unknown methods", () => {
    const handle = createHandler(() => readLedger(fixtureDir()));
    expect((handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } }) as Reply).result?.protocolVersion).toBe("2025-11-25");
    expect(handle({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect(handle({ jsonrpc: "2.0", method: "ping" })).toBeNull();
    expect(handle({ jsonrpc: "2.0", method: "tools/list" })).toBeNull();
    expect((handle({ jsonrpc: "2.0", id: 2, method: "resources/list" }) as Reply).error?.code).toBe(-32601);
    expect((handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_account" } }) as Reply).error?.code).toBe(-32602);
  });
});

describe("tool catalogue", () => {
  it("has four read-only tools with a title, a verb name and explicit hints", () => {
    expect(TOOLS.map((t) => t.name)).toEqual(["list_accounts", "get_balances", "get_monthly_changes", "get_net_worth_by_currency"]);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^(list|get)_/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.annotations).toEqual({ title: t.title, readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    }
  });
});

describe("tools on the fixture ledger", () => {
  it("lists accounts with positions and latest close", () => {
    const out = data(fixtureDir(), "list_accounts");
    expect(out.count).toBe(6);
    expect(out.months_with_a_close).toEqual(["2026-07", "2026-08", "2026-09"]);
    const checking = out.accounts.find((a: any) => a.name === "Checking");
    expect(checking).toMatchObject({ iban_last4: "1234", currency: "EUR", positions: ["Cash EUR"], latest_close: { month: "2026-09", value_eur: "2800.00" } });
    expect(out.accounts.every((a: any) => !("notes" in a))).toBe(true);
    expect(data(fixtureDir(), "list_accounts", { status: "closed" }).accounts.map((a: any) => a.name)).toEqual(["Old account"]);
  });

  it("gives balances at a month end, native and in EUR", () => {
    const out = data(fixtureDir(), "get_balances", { month: "2026-09" });
    expect(out.net_worth_eur).toBe("44775.90");
    expect(out.shown_total_eur).toBe(out.net_worth_eur);
    expect(out.balances).toContainEqual(
      expect.objectContaining({ account: "Dollar cash", position: "Cash USD", amount: "4500.00", unit: "USD", value_eur: "3913.04" }),
    );
    expect(out.balances).toContainEqual(expect.objectContaining({ position: "BTC", amount: "0.6", unit: "BTC", value_eur: "23400.00" }));
    expect(out.accounts_not_closed_yet).toEqual([]);
  });

  it("defaults to the latest month and filters by account", () => {
    const dir = fixtureDir();
    expect(data(dir, "get_balances").month).toBe("2026-09");
    const one = data(dir, "get_balances", { account_id: 1 });
    expect(one.balances).toHaveLength(1);
    expect(one.shown_total_eur).toBe("2800.00");
    expect(one.net_worth_eur).toBe("44775.90");
  });

  it("ignores a balance saved for the month an account closed", () => {
    const aug = data(fixtureDir(), "get_balances", { month: "2026-08" });
    expect(aug.net_worth_eur).toBe("42038.64");
    expect(aug.balances.some((b: any) => b.account === "Old account")).toBe(false);
    expect(data(fixtureDir(), "get_balances", { month: "2026-07" }).net_worth_eur).toBe("41345.45");
  });

  it("splits the month-over-month change into market, fx and flows that add up", () => {
    const out = data(fixtureDir(), "get_monthly_changes", { month: "2026-09" });
    expect(out).toMatchObject({ previous_month: "2026-08", net_worth_eur: "44775.90", previous_net_worth_eur: "42038.64", net_worth_change_eur: "2737.26" });
    const c = out.change_since_last_close;
    expect(c).toMatchObject({ total_eur: "2737.26", market_eur: "-1440.00", fx_eur: "-24.78", flows_eur: "4202.04" });
    expect(Number(c.market_eur) + Number(c.fx_eur) + Number(c.flows_eur)).toBeCloseTo(Number(c.total_eur), 2);
    const btc = out.by_position.find((r: any) => r.position === "BTC");
    expect(btc).toMatchObject({ previous_eur: "21000.00", value_eur: "23400.00", market_eur: "-1500.00", flows_eur: "3900.00" });
  });

  it("shows an account closing as a flow out", () => {
    const out = data(fixtureDir(), "get_monthly_changes", { month: "2026-08" });
    expect(out.closed_accounts).toEqual([expect.objectContaining({ account: "Old account" })]);
    expect(out.by_position.find((r: any) => r.account === "Old account")).toMatchObject({ status: "closed", value_eur: "0.00", flows_eur: "-400.00" });
  });

  it("has no change figures for the first month", () => {
    const out = data(fixtureDir(), "get_monthly_changes", { month: "2026-07" });
    expect(out.change_since_last_close).toBeNull();
    expect(out.previous_net_worth_eur).toBeNull();
    expect(out.net_worth_change_eur).toBeNull();
  });

  it("groups net worth by currency and agrees with the app's summary", () => {
    const dir = fixtureDir();
    const out = data(dir, "get_net_worth_by_currency", { month: "2026-09" });
    expect(out.currencies.map((c: any) => [c.code, c.kind, c.native_total, c.value_eur])).toEqual([
      ["BTC", "crypto", "0.6", "23400.00"],
      ["EUR", "fiat", "13300.00", "13300.00"],
      ["USD", "fiat", "4500.00", "3913.04"],
      ["RUB", "fiat", "210000.00", "2142.86"],
      ["EXMPL", "security", "20", "2020.00"],
    ]);
    const l = readLedger(dir);
    const s = buildSummary({ month: "2026-09", accounts: l.accounts, positions: l.positions, snapshots: l.snapshots, idleCashThresholdMinor: 0 });
    for (const g of s.by_currency) {
      expect(out.currencies.find((c: any) => c.code === g.key).value_eur).toBe((g.value_eur_minor / 100).toFixed(2));
    }
    expect(out.currencies.reduce((n: number, c: any) => n + Number(c.share_percent), 0)).toBeGreaterThan(99.8);
  });

  it("lists a position without a close as not closed yet, never as zero", () => {
    const l = readLedger(fixtureDir());
    const checking = l.positions.find((p) => p.account_id === 1)!;
    const handle = createHandler(() => ({ ...l, snapshots: l.snapshots.filter((x) => !(x.position_id === checking.id && x.month === "2026-09")) }));
    const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_balances", arguments: { month: "2026-09" } } }) as Reply;
    const out = r.result!.structuredContent;
    expect(out.net_worth_eur).toBe("41975.90");
    expect(out.accounts_not_closed_yet).toEqual([expect.objectContaining({ account: "Checking", positions_missing: ["Cash EUR"] })]);
    expect(out.balances.some((b: any) => b.account === "Checking")).toBe(false);
  });
});

describe("errors are tool results the model can act on", () => {
  it("rejects a bad or unknown month, an unknown account and unknown arguments", () => {
    const dir = fixtureDir();
    expect(call(dir, "get_balances", { month: "2026-9" }).result).toMatchObject({ isError: true });
    const none = call(dir, "get_balances", { month: "2025-01" }).result!;
    expect(none.isError).toBe(true);
    expect(none.content[0].text).toContain("2026-07, 2026-08, 2026-09");
    expect(call(dir, "get_balances", { account_id: 99 }).result!.isError).toBe(true);
    expect(call(dir, "get_balances", { account_id: "1" }).result!.isError).toBe(true);
    expect(call(dir, "list_accounts", { status: "all", write: true }).result!.content[0].text).toContain('Unknown argument "write"');
  });

  it("says what to do when there is no database, and does not create one", () => {
    const dir = tempDir();
    const r = call(dir, "list_accounts").result!;
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("No Finance K database");
    expect(existsSync(join(dir, "finance-k.sqlite"))).toBe(false);
  });

  it("says so when no month was closed yet", () => {
    const dir = tempDir();
    buildFixture(dir); // then empty the snapshots through a fresh, separate ledger
    const handle = createHandler(() => ({ ...readLedger(dir), snapshots: [], months: [] }));
    const r = handle({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_balances", arguments: {} } }) as Reply;
    expect(r.result!.content[0].text).toContain("No month has been closed yet");
  });
});

const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

describe("the shipped bundle over stdio", () => {
  it("runs `finance-k mcp`, answers a full session and leaves the database byte-identical", async () => {
    const dir = fixtureDir();
    const file = join(dir, "finance-k.sqlite");
    const before = sha(file);
    const child = spawn("node", [BUNDLE, "mcp"], { env: { ...process.env, FINANCE_K_DATA_DIR: dir }, stdio: ["pipe", "pipe", "pipe"] });
    const requests = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_balances", arguments: { month: "2026-09" } } },
      { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_monthly_changes", arguments: {} } },
    ];
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    const closed = new Promise<number | null>((resolve) => child.on("close", resolve));
    child.stdin.end(requests.map((r) => JSON.stringify(r)).join("\n") + "\n");
    expect(await closed).toBe(0);
    const replies = out.trim().split("\n").map((l) => JSON.parse(l));
    expect(replies.map((r) => r.id)).toEqual([1, 2, 3, 4]);
    expect(replies[1].result.tools).toHaveLength(4);
    expect(replies[2].result.structuredContent.net_worth_eur).toBe("44775.90");
    expect(JSON.parse(replies[3].result.content[0].text).month).toBe("2026-09");
    expect(sha(file)).toBe(before);
  });
});

describe("what ships", () => {
  const bundle = readFileSync(BUNDLE, "utf8");
  const root = join(__dirname, "..");

  it("imports only local-file modules, never a network or process module", () => {
    const imports = new Set([...bundle.matchAll(/from\s*"(node:[a-z_/]+)"/g)].map((m) => m[1]));
    expect([...imports].sort()).toEqual(["node:fs", "node:os", "node:path", "node:readline", "node:sqlite"]);
    expect(bundle).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|require\(/);
    expect(bundle).not.toMatch(/https?:\/\/(?!(?:github\.com|anthropic\.com))/);
  });

  it("contains no write SQL and opens the database read-only", () => {
    expect(bundle).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE TABLE|REPLACE INTO)\b/);
    const statements = [...bundle.matchAll(/\.prepare\(\s*["`](\w+)/g)].map((m) => m[1]);
    expect(statements.length).toBeGreaterThan(0);
    expect(new Set(statements)).toEqual(new Set(["SELECT"]));
    expect([...bundle.matchAll(/\bdb\.exec\(([^)]*)\)/g)].map((m) => m[1])).toEqual(['"PRAGMA query_only = ON"', '"BEGIN"', '"COMMIT"']);
    expect(bundle).toContain("readOnly: true");
  });

  it("keeps the version equal in package.json, the plugin and the marketplace", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const plugin = JSON.parse(readFileSync(join(root, "plugins/finance-k/.claude-plugin/plugin.json"), "utf8"));
    const market = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));
    expect([pkg.version, plugin.version, market.plugins[0].version]).toEqual([VERSION, VERSION, VERSION]);
    expect(pkg.bin["finance-k"]).toBe("plugins/finance-k/server/finance-k.mjs");
    expect(market.plugins[0].source).toBe("./plugins/finance-k");
    expect(market.plugins[0].name).toBe(plugin.name);
  });

  it("wires the plugin to the bundled server and nothing remote", () => {
    const mcp = JSON.parse(readFileSync(join(root, "plugins/finance-k/.mcp.json"), "utf8"));
    expect(mcp.mcpServers["finance-k"]).toEqual({ command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server/finance-k.mjs", "mcp"] });
  });

  it("has a licence and a README of at least 40 words in the plugin", () => {
    expect(readFileSync(join(root, "plugins/finance-k/LICENSE"), "utf8")).toContain("Apache License");
    const words = readFileSync(join(root, "plugins/finance-k/README.md"), "utf8").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(40);
    expect(readFileSync(join(root, "plugins/finance-k/README.md"), "utf8")).toContain("codex mcp add finance-k --");
    expect(readFileSync(join(root, "docs/PRIVACY.md"), "utf8")).toMatch(/no hosted|remote MCP server would need/i);
  });
});
