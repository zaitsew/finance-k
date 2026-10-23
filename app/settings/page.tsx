import type { Metadata } from "next";
import { ActionForm } from "../../components/ActionForm";
import { Field } from "../../components/ui";
import { dataDir, dbPath } from "../../src/server/db";
import { openDb } from "../../src/server/db";
import { idleCashEur } from "../../src/server/repo";
import { rateStats } from "../../src/server/rates/store";
import { importAction, saveSettingsAction } from "../../src/server/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  const db = openDb();
  const stats = rateStats(db);
  return (
    <div className="page-narrow stack" style={{ margin: "0 auto" }}>
      <div className="page-head">
        <h1 className="title">Settings</h1>
      </div>

      <section className="card" aria-labelledby="idle-h">
        <h2 className="sect" id="idle-h">
          Idle cash
        </h2>
        <ActionForm action={saveSettingsAction}>
          <Field label="Idle cash limit, EUR" htmlFor="idle_cash_eur" hint="A bank account holding more EUR cash than this gets a link to BankJar’s savings offers.">
            <input id="idle_cash_eur" name="idle_cash_eur" className="input input-cell num" defaultValue={idleCashEur(db)} inputMode="decimal" />
          </Field>
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </ActionForm>
      </section>

      <section className="card" aria-labelledby="export-h">
        <h2 className="sect" id="export-h">
          Export
        </h2>
        <p className="muted">One JSON file with every account, position, saved month and cached rate. Keep it as a backup, or move it to another Mac.</p>
        <div className="form-actions">
          <a className="btn btn-primary" href="/api/export" download>
            Download export
          </a>
        </div>
      </section>

      <section className="card" aria-labelledby="import-h">
        <h2 className="sect" id="import-h">
          Import
        </h2>
        <p className="muted">
          Replaces everything in this app with the contents of an export file. The file is checked first; if anything is wrong, nothing changes.
        </p>
        <ActionForm action={importAction}>
          <div className="stack" style={{ marginTop: "0.75rem" }}>
            <Field label="Export file" htmlFor="file">
              <input id="file" name="file" type="file" accept="application/json,.json" className="input" style={{ paddingTop: "0.4rem" }} />
            </Field>
            <label className="row">
              <input type="checkbox" name="confirm" value="yes" /> I understand this replaces all current data
            </label>
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn-danger">
              Import and replace
            </button>
          </div>
        </ActionForm>
      </section>

      <section className="card" aria-labelledby="about-h">
        <h2 className="sect" id="about-h">
          Where your data is
        </h2>
        <dl className="stack">
          <div>
            <dt className="stat-label">Database file</dt>
            <dd style={{ wordBreak: "break-all" }}>
              <code>{dbPath(dataDir())}</code>
            </dd>
          </div>
          <div>
            <dt className="stat-label">Rate cache</dt>
            <dd>
              {stats.rows} rates{stats.latest ? `, newest ${stats.latest}` : ""}
            </dd>
          </div>
          <div>
            <dt className="stat-label">What leaves this Mac</dt>
            <dd>
              Only public rate lookups (ECB, Bank of Russia, CoinGecko) and, when idle cash shows, one request for BankJar’s top savings offer. None of them carries your balances or account names.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
