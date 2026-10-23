import { z } from "zod";
import { CURRENCY_RE } from "./money";
import { isDate, isMonth } from "./months";
import { isDecimalString } from "./decimal";
import { ACCOUNT_KINDS, ACCOUNT_SOURCES, ACCOUNT_STATUSES, ASSET_KINDS, BANKJAR_BANK_IDS } from "./types";

/** Blank form fields arrive as "". They mean "not set". */
const blankToNull = (v: unknown): unknown => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : typeof v === "string" ? v.trim() : v);

const optionalText = (max: number) => z.preprocess(blankToNull, z.string().max(max).nullable());
const dateField = z.preprocess(blankToNull, z.string().refine(isDate, "Use a valid date, YYYY-MM-DD").nullable());

export const IBAN_LAST4_MESSAGE = "Enter only the last 4 digits of the IBAN. Finance K never stores a full IBAN.";

/** Exactly four digits, or nothing. Anything longer is refused rather than trimmed, so a full IBAN never lands in the store by accident. */
export const ibanLast4Field = z.preprocess(blankToNull, z.string().regex(/^\d{4}$/, IBAN_LAST4_MESSAGE).nullable());

const currencyField = z.preprocess(
  (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
  z.string().regex(CURRENCY_RE, "Use a 3-letter currency code such as EUR"),
);

const accountFields = {
  institution: z.preprocess(blankToNull, z.string({ error: "Institution is required" }).min(1, "Institution is required").max(80)),
  name: z.preprocess(blankToNull, z.string({ error: "Name is required" }).min(1, "Name is required").max(80)),
  kind: z.enum(ACCOUNT_KINDS, { error: "Pick an account kind" }),
  currency: currencyField,
  iban_last4: ibanLast4Field,
  opened_on: dateField,
  purpose: optionalText(300),
  fees_note: optionalText(300),
  status: z.enum(ACCOUNT_STATUSES).default("open"),
  closed_on: dateField,
  source: z.enum(ACCOUNT_SOURCES).default("manual"),
  bankjar_bank_id: z.preprocess(blankToNull, z.enum(BANKJAR_BANK_IDS).nullable()),
  notes: optionalText(2000),
};

function accountRules(a: { status: string; closed_on: string | null; opened_on: string | null }, ctx: z.RefinementCtx): void {
  if (a.status === "closed" && !a.closed_on) {
    ctx.addIssue({ code: "custom", path: ["closed_on"], message: "A closed account needs a closing date" });
  }
  if (a.status === "open" && a.closed_on) {
    ctx.addIssue({ code: "custom", path: ["closed_on"], message: "An open account has no closing date" });
  }
  if (a.opened_on && a.closed_on && a.closed_on < a.opened_on) {
    ctx.addIssue({ code: "custom", path: ["closed_on"], message: "The account cannot close before it opened" });
  }
}

/** What the account form submits. */
export const AccountInputSchema = z.object(accountFields).superRefine(accountRules);
export type AccountInput = z.infer<typeof AccountInputSchema>;

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}

export function firstIssue(error: z.ZodError): string {
  const i = error.issues[0];
  return i ? i.message : "Invalid input";
}

// --- Positions ----------------------------------------------------------------------

export const CashPositionInputSchema = z.object({ kind: z.literal("cash"), currency: currencyField });
export const AssetPositionInputSchema = z.object({
  kind: z.literal("asset"),
  asset_kind: z.enum(ASSET_KINDS, { error: "Pick crypto or security" }),
  symbol: z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
    z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/, "Use a ticker such as BTC or VWCE"),
  ),
});
export const PositionInputSchema = z.discriminatedUnion("kind", [CashPositionInputSchema, AssetPositionInputSchema]);
export type PositionInput = z.infer<typeof PositionInputSchema>;

// --- Export file ----------------------------------------------------------------------

export const EXPORT_APP = "finance-k";
export const EXPORT_FORMAT_VERSION = 1;

const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/, "Use an ISO timestamp in UTC");
const decimalText = z.string().refine(isDecimalString, "Not a decimal number");
const positiveDecimal = decimalText.refine((v) => Number(v) > 0, "Must be above zero");
const strictDate = z.string().refine(isDate, "Use a valid date, YYYY-MM-DD");

export const AccountRowSchema = z
  .object({
    id: z.number().int().positive(),
    institution: z.string().min(1).max(80),
    name: z.string().min(1).max(80),
    kind: z.enum(ACCOUNT_KINDS),
    currency: z.string().regex(CURRENCY_RE),
    iban_last4: z.string().regex(/^\d{4}$/, IBAN_LAST4_MESSAGE).nullable(),
    opened_on: strictDate.nullable(),
    purpose: z.string().max(300).nullable(),
    fees_note: z.string().max(300).nullable(),
    status: z.enum(ACCOUNT_STATUSES),
    closed_on: strictDate.nullable(),
    source: z.enum(ACCOUNT_SOURCES),
    bankjar_bank_id: z.enum(BANKJAR_BANK_IDS).nullable(),
    notes: z.string().max(2000).nullable(),
    created_at: isoTimestamp,
    updated_at: isoTimestamp,
  })
  .strict()
  .superRefine(accountRules);

export const PositionRowSchema = z
  .object({
    id: z.number().int().positive(),
    account_id: z.number().int().positive(),
    kind: z.enum(["cash", "asset"]),
    currency: z.string().regex(CURRENCY_RE).nullable(),
    asset_kind: z.enum(ASSET_KINDS).nullable(),
    symbol: z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,19}$/).nullable(),
    created_at: isoTimestamp,
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.kind === "cash" && (p.currency === null || p.asset_kind !== null || p.symbol !== null)) {
      ctx.addIssue({ code: "custom", message: "A cash position has a currency and no asset fields" });
    }
    if (p.kind === "asset" && (p.currency !== null || p.asset_kind === null || p.symbol === null)) {
      ctx.addIssue({ code: "custom", message: "An asset position has an asset kind and a symbol, and no currency" });
    }
  });

export const SnapshotRowSchema = z
  .object({
    position_id: z.number().int().positive(),
    month: z.string().refine(isMonth, "Use YYYY-MM"),
    amount_minor: z.number().int().safe().nullable(),
    quantity: decimalText.nullable(),
    rate: positiveDecimal,
    rate_date: strictDate.nullable(),
    rate_source: z.enum(["identity", "ecb", "cbr", "coingecko", "manual"]),
    value_eur_minor: z.number().int().safe(),
    captured_at: isoTimestamp,
  })
  .strict()
  .superRefine((s, ctx) => {
    if ((s.amount_minor === null) === (s.quantity === null)) {
      ctx.addIssue({ code: "custom", message: "A snapshot has either amount_minor (cash) or quantity (asset)" });
    }
  });

export const RateRowSchema = z
  .object({
    kind: z.enum(["fx", "crypto"]),
    key: z.string().min(1).max(20),
    date: strictDate,
    value: positiveDecimal,
    source: z.string().min(1).max(20),
  })
  .strict();

/** The largest idle-cash threshold accepted, in whole euros. Far above any balance, far below the safe-integer limit in cents. */
export const MAX_IDLE_CASH_EUR = 1_000_000_000;

/** Whether text is a usable idle-cash threshold: a non-negative decimal of at most MAX_IDLE_CASH_EUR euros. */
export function isValidIdleCashEur(text: string): boolean {
  return isDecimalString(text) && !text.startsWith("-") && Number(text) <= MAX_IDLE_CASH_EUR;
}

export const SETTING_KEYS = ["idle_cash_eur"] as const;

export const ExportSchema = z
  .object({
    app: z.literal(EXPORT_APP),
    format_version: z.literal(EXPORT_FORMAT_VERSION),
    exported_at: isoTimestamp,
    accounts: z.array(AccountRowSchema),
    positions: z.array(PositionRowSchema),
    snapshots: z.array(SnapshotRowSchema),
    rates: z.array(RateRowSchema),
    settings: z.partialRecord(z.enum(SETTING_KEYS), z.string()),
  })
  .strict()
  .superRefine((file, ctx) => {
    const accountIds = new Set<number>();
    for (const a of file.accounts) {
      if (accountIds.has(a.id)) ctx.addIssue({ code: "custom", path: ["accounts"], message: `Duplicate account id ${a.id}` });
      accountIds.add(a.id);
    }
    const positionKinds = new Map<number, string>();
    for (const p of file.positions) {
      if (positionKinds.has(p.id)) ctx.addIssue({ code: "custom", path: ["positions"], message: `Duplicate position id ${p.id}` });
      positionKinds.set(p.id, p.kind);
      if (!accountIds.has(p.account_id)) {
        ctx.addIssue({ code: "custom", path: ["positions"], message: `Position ${p.id} points at missing account ${p.account_id}` });
      }
    }
    const seen = new Set<string>();
    for (const s of file.snapshots) {
      const key = `${s.position_id}|${s.month}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", path: ["snapshots"], message: `Duplicate snapshot ${key}` });
      seen.add(key);
      const kind = positionKinds.get(s.position_id);
      if (!kind) {
        ctx.addIssue({ code: "custom", path: ["snapshots"], message: `Snapshot ${key} points at a missing position` });
      } else if ((kind === "cash") !== (s.amount_minor !== null)) {
        ctx.addIssue({ code: "custom", path: ["snapshots"], message: `Snapshot ${key} does not match its position kind` });
      }
    }
    const rateKeys = new Set<string>();
    for (const r of file.rates) {
      const key = `${r.kind}|${r.key}|${r.date}`;
      if (rateKeys.has(key)) ctx.addIssue({ code: "custom", path: ["rates"], message: `Duplicate rate ${key}` });
      rateKeys.add(key);
    }
    const idle = file.settings.idle_cash_eur;
    if (idle !== undefined && !isValidIdleCashEur(idle)) {
      ctx.addIssue({ code: "custom", path: ["settings", "idle_cash_eur"], message: `Must be a number from 0 to ${MAX_IDLE_CASH_EUR}` });
    }
  });

export type ExportFile = z.infer<typeof ExportSchema>;
