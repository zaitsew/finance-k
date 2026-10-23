import { COMMON_CURRENCIES } from "../src/core/money";
import { ACCOUNT_KINDS, ACCOUNT_SOURCES, BANKJAR_BANK_IDS, KIND_LABELS, SOURCE_LABELS, type Account } from "../src/core/types";
import { Field } from "./ui";

/** The account fields, shared by "Add account" and the edit card. Server-rendered; wrap it in an ActionForm. */
export function AccountFields({ account, editing = false }: { account?: Account; editing?: boolean }) {
  return (
    <>
      <datalist id="currencies">
        {COMMON_CURRENCIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="form-grid">
        <Field label="Institution" htmlFor="institution" hint="The bank, broker, exchange or wallet app.">
          <input id="institution" name="institution" className="input" required maxLength={80} defaultValue={account?.institution ?? ""} autoComplete="off" autoFocus={!editing} />
        </Field>
        <Field label="Account name" htmlFor="name" hint="For example Current account, ISA, Main wallet.">
          <input id="name" name="name" className="input" required maxLength={80} defaultValue={account?.name ?? ""} autoComplete="off" />
        </Field>
        <Field label="Kind" htmlFor="kind">
          <select id="kind" name="kind" className="select" defaultValue={account?.kind ?? "bank"}>
            {ACCOUNT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Currency" htmlFor="currency" hint="The main currency. Add more positions later.">
          <input id="currency" name="currency" className="input" required list="currencies" maxLength={3} defaultValue={account?.currency ?? "EUR"} autoComplete="off" style={{ textTransform: "uppercase" }} />
        </Field>
        <Field label="IBAN, last 4 digits" htmlFor="iban_last4" hint="Only the last four digits. Finance K never stores a full IBAN.">
          <input id="iban_last4" name="iban_last4" className="input" inputMode="numeric" pattern="\d{4}" title="Exactly four digits" defaultValue={account?.iban_last4 ?? ""} autoComplete="off" placeholder="1234" />
        </Field>
        <Field label="Opened on" htmlFor="opened_on">
          <input id="opened_on" name="opened_on" type="date" className="input" defaultValue={account?.opened_on ?? ""} />
        </Field>
        <Field label="Purpose" htmlFor="purpose" hint="What this account is for.">
          <input id="purpose" name="purpose" className="input" maxLength={300} defaultValue={account?.purpose ?? ""} />
        </Field>
        <Field label="Fees" htmlFor="fees_note" hint="Monthly fee, card fee, custody fee.">
          <input id="fees_note" name="fees_note" className="input" maxLength={300} defaultValue={account?.fees_note ?? ""} />
        </Field>
        <Field label="Data source" htmlFor="source" hint="How balances get in. Today: typed by hand.">
          <select id="source" name="source" className="select" defaultValue={account?.source ?? "manual"}>
            {ACCOUNT_SOURCES.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="BankJar bank" htmlFor="bankjar_bank_id" hint="Links the account to BankJar’s bank list.">
          <select id="bankjar_bank_id" name="bankjar_bank_id" className="select" defaultValue={account?.bankjar_bank_id ?? ""}>
            <option value="">None</option>
            {BANKJAR_BANK_IDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </Field>
        {editing ? (
          <>
            <Field label="Status" htmlFor="status">
              <select id="status" name="status" className="select" defaultValue={account?.status ?? "open"}>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <Field label="Closed on" htmlFor="closed_on" hint="Needed when the status is Closed.">
              <input id="closed_on" name="closed_on" type="date" className="input" defaultValue={account?.closed_on ?? ""} />
            </Field>
          </>
        ) : (
          <input type="hidden" name="status" value="open" />
        )}
        <Field label="Notes" htmlFor="notes" wide>
          <textarea id="notes" name="notes" className="textarea" maxLength={2000} defaultValue={account?.notes ?? ""} />
        </Field>
      </div>
    </>
  );
}
