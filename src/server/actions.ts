"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseNumberInput } from "../core/money";
import { isMonth, todayLocal } from "../core/months";
import { AccountInputSchema, MAX_IDLE_CASH_EUR, PositionInputSchema, firstIssue, isValidIdleCashEur } from "../core/schemas";
import { existsIn, positionDueIn } from "../core/summary";
import type { ActionState } from "./action-state";
import { openDb } from "./db";
import { addCashOnHand, saveMonth } from "./close";
import { addPosition, createAccount, deleteAccount, deletePosition, getAccount, listAccounts, listPositions, setSetting, updateAccount } from "./repo";
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
  const result = saveMonth(openDb(), {
    month,
    today: todayLocal(),
    useCache: text(fd, "use_cache") === "yes",
    get: (name) => {
      const v = fd.get(name);
      return typeof v === "string" ? v : undefined;
    },
  });
  if (!result.ok) return { error: result.error };
  revalidatePath("/", "layout");
  redirect(`/?month=${month}&saved=${result.saved + result.cleared}`);
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
  const back = isMonth(month) ? `/close/${month}` : "/close";
  const result = addCashOnHand(openDb(), month, text(fd, "currency"));
  if (!result.ok) redirect(`${back}?notice=${encodeURIComponent(result.error)}&kind=warn`);
  revalidatePath("/", "layout");
  redirect(back);
}

// --- Settings, import -------------------------------------------------------------------------

export async function saveSettingsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = parseNumberInput(text(fd, "idle_cash_eur"));
  if (raw === null || !isValidIdleCashEur(raw)) return { error: `Enter the threshold as a number of euros, from 0 to ${MAX_IDLE_CASH_EUR.toLocaleString("en-US")}` };
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

