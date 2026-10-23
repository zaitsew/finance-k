"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dec, decToString, isDecimalString, round } from "../core/decimal";
import { currencyDecimals, parseMinorInput, parseNumberInput } from "../core/money";
import { isMonth, monthOf, todayLocal } from "../core/months";
import { AccountInputSchema, PositionInputSchema, firstIssue } from "../core/schemas";
import { existsIn, positionDueIn } from "../core/summary";
import { positionLabel, type RateSource } from "../core/types";
import type { ActionState } from "./action-state";
import { openDb, transaction } from "./db";
import {
  addPosition,
  createAccount,
  deleteAccount,
  deletePosition,
  getAccount,
  listAccounts,
  listPositions,
  saveSnapshot,
  setSetting,
  updateAccount,
  type SnapshotInput,
} from "./repo";
import { cachedRateFor, ensureRates, rateDateFor, ratesNeeded } from "./rates/client";
import { importStore } from "./store-io";

const text = (fd: FormData, name: string): string => {
  const v = fd.get(name);
  return typeof v === "string" ? v : "";
};

const accountObject = (fd: FormData): Record<string, string> => {
  const o: Record<string, string> = {};
  for (const key of ["institution", "name", "kind", "currency", "iban_last4", "opened_on", "purpose", "fees_note", "status", "closed_on", "source", "bankjar_bank_id", "notes"]) {
    o[key] = text(fd, key);
  }
  return o;
};

// --- Accounts ---------------------------------------------------------------------------

export async function createAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const parsed = AccountInputSchema.safeParse(accountObject(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const id = createAccount(openDb(), parsed.data);
  revalidatePath("/", "layout");
  redirect(`/accounts/${id}?created=1`);
}

export async function updateAccountAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const id = Number(text(fd, "id"));
  const db = openDb();
  if (!Number.isInteger(id) || !getAccount(db, id)) return { error: "That account no longer exists" };
  const parsed = AccountInputSchema.safeParse(accountObject(fd));
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  updateAccount(db, id, parsed.data);
  revalidatePath("/", "layout");
  return { notice: "Saved" };
}

export async function deleteAccountAction(fd: FormData): Promise<void> {
  const id = Number(text(fd, "id"));
  if (text(fd, "confirm") !== "yes") redirect(`/accounts/${id}?error=${encodeURIComponent("Tick the box to confirm the deletion")}`);
  deleteAccount(openDb(), id);
  revalidatePath("/", "layout");
  redirect("/accounts");
}

// --- Positions --------------------------------------------------------------------------

export async function addPositionAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const accountId = Number(text(fd, "account_id"));
  const db = openDb();
  if (!getAccount(db, accountId)) return { error: "That account no longer exists" };
  const raw =
    text(fd, "kind") === "cash"
      ? { kind: "cash", currency: text(fd, "currency") }
      : { kind: "asset", asset_kind: text(fd, "asset_kind"), symbol: text(fd, "symbol") };
  const parsed = PositionInputSchema.safeParse(raw);
  if (!parsed.success) return { error: firstIssue(parsed.error) };
  const result = addPosition(db, accountId, parsed.data);
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  return { notice: "Position added" };
}

export async function deletePositionAction(fd: FormData): Promise<void> {
  const id = Number(text(fd, "id"));
  const accountId = Number(text(fd, "account_id"));
  const result = deletePosition(openDb(), id);
  revalidatePath("/", "layout");
  if (!result.ok) redirect(`/accounts/${accountId}?error=${encodeURIComponent(result.error)}`);
  redirect(`/accounts/${accountId}`);
}

// --- Closing the month ----------------------------------------------------------------------

export async function saveMonthAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const month = text(fd, "month");
  if (!isMonth(month)) return { error: "That is not a month" };
  const today = todayLocal();
  if (month > monthOf(today)) return { error: "A month can be closed only once it has started" };
  const useCache = text(fd, "use_cache") === "yes";
  const rateDate = rateDateFor(month, today);

  const db = openDb();
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));
  const toSave: SnapshotInput[] = [];
  const errors: string[] = [];

  for (const position of listPositions(db)) {
    const account = accounts.get(position.account_id);
    if (!account) continue;
    const raw = text(fd, position.kind === "cash" ? `amount_${position.id}` : `qty_${position.id}`);
    if (raw.trim() === "") continue;
    const label = `${account.institution} ${account.name}, ${positionLabel(position)}`;

    let amount_minor: number | null = null;
    let quantity: string | null = null;
    if (position.kind === "cash") {
      amount_minor = parseMinorInput(raw, position.currency!);
      if (amount_minor === null) {
        errors.push(`${label}: enter an amount with at most ${currencyDecimals(position.currency!)} decimals`);
        continue;
      }
    } else {
      quantity = parseNumberInput(raw);
      if (quantity === null || quantity.startsWith("-")) {
        errors.push(`${label}: enter a quantity of zero or more`);
        continue;
      }
    }

    let rate: string;
    let rate_source: RateSource;
    let rate_date: string | null;
    if (position.kind === "cash" && position.currency === "EUR") {
      rate = "1";
      rate_source = "identity";
      rate_date = null;
    } else {
      const cached = useCache ? cachedRateFor(db, position, rateDate) : null;
      if (cached) {
        rate = cached.rate;
        rate_source = cached.source;
        rate_date = cached.date;
      } else {
        const typed = parseNumberInput(text(fd, `rate_${position.id}`));
        if (typed === null || !(Number(typed) > 0)) {
          errors.push(`${label}: enter the rate in EUR per 1 ${position.kind === "cash" ? position.currency : position.symbol}`);
          continue;
        }
        rate = decToString(round(dec(typed), 12));
        const original = parseNumberInput(text(fd, `rate0_${position.id}`));
        const source = text(fd, `src0_${position.id}`) as RateSource;
        const untouched = original !== null && decToString(dec(original)) === rate;
        rate_source = untouched ? source : "manual";
        rate_date = untouched ? text(fd, `date0_${position.id}`) || null : null;
      }
    }
    toSave.push({ position, month, amount_minor, quantity, rate, rate_date, rate_source });
  }

  if (errors.length) return { error: `${errors.slice(0, 4).join(". ")}${errors.length > 4 ? `. And ${errors.length - 4} more.` : "."}` };
  if (!toSave.length) return { error: "Nothing to save: fill in at least one amount" };

  transaction(db, () => {
    for (const s of toSave) saveSnapshot(db, s);
  });
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=${toSave.length}`);
}

export async function refreshRatesAction(fd: FormData): Promise<void> {
  const month = text(fd, "month");
  if (!isMonth(month)) redirect("/close");
  const today = todayLocal();
  const db = openDb();
  const accounts = new Map(listAccounts(db).map((a) => [a.id, a]));
  const wanted = listPositions(db).filter((p) => {
    const a = accounts.get(p.account_id);
    return a !== undefined && existsIn(a, month) && positionDueIn(a, p, month);
  });
  const needs = ratesNeeded(wanted);
  if (!needs.currencies.length && !needs.crypto.length) {
    redirect(`/close/${month}?notice=${encodeURIComponent("No foreign currency or crypto positions need a rate")}`);
  }
  const report = await ensureRates(db, needs, rateDateFor(month, today), today, { force: true });
  const parts: string[] = [];
  if (report.fetched.length) parts.push(`Fetched ${report.fetched.join(", ")}.`);
  if (report.failed.length) parts.push(`Could not fetch ${report.failed.map((f) => `${f.what} (${f.reason})`).join(", ")}. Enter those rates by hand.`);
  revalidatePath("/", "layout");
  redirect(`/close/${month}?notice=${encodeURIComponent(parts.join(" "))}&kind=${report.failed.length ? "warn" : "good"}`);
}

export async function addCashAccountAction(fd: FormData): Promise<void> {
  const month = text(fd, "month");
  const currency = text(fd, "currency").trim().toUpperCase();
  const back = isMonth(month) ? `/close/${month}` : "/close";
  if (!/^[A-Z]{3}$/.test(currency)) redirect(`${back}?notice=${encodeURIComponent("Use a 3-letter currency code")}&kind=warn`);
  const parsed = AccountInputSchema.safeParse({
    institution: "Cash",
    name: `Cash ${currency}`,
    kind: "cash",
    currency,
    source: "manual",
    status: "open",
  });
  if (!parsed.success) redirect(`${back}?notice=${encodeURIComponent(firstIssue(parsed.error))}&kind=warn`);
  createAccount(openDb(), parsed.data);
  revalidatePath("/", "layout");
  redirect(back);
}

// --- Settings, import -------------------------------------------------------------------------

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = parseNumberInput(text(fd, "idle_cash_eur"));
  if (raw === null || raw.startsWith("-") || !isDecimalString(raw)) return { error: "Enter the threshold as a number of euros, zero or more" };
  setSetting(openDb(), "idle_cash_eur", raw);
  revalidatePath("/", "layout");
  return { notice: "Saved" };
}

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export async function importAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  if (text(fd, "confirm") !== "yes") return { error: "Tick the box to confirm that the import replaces everything" };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an export file" };
  if (file.size > MAX_IMPORT_BYTES) return { error: "That file is too large for an export" };
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
  } catch {
    return { error: "That file is not valid JSON" };
  }
  const result = importStore(openDb(), json);
  if (!result.ok) return { error: `Refused, nothing was changed. ${result.errors.join(" · ")}` };
  revalidatePath("/", "layout");
  const c = result.counts;
  return { notice: `Imported ${c.accounts} accounts, ${c.positions} positions, ${c.snapshots} saved months and ${c.rates} cached rates.` };
}

