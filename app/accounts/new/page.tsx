import Link from "next/link";
import type { Metadata } from "next";
import { AccountFields } from "../../../components/AccountForm";
import { ActionForm } from "../../../components/ActionForm";
import { createAccountAction } from "../../../src/server/actions";

export const metadata: Metadata = { title: "Add account" };

export default function NewAccountPage() {
  return (
    <div className="page-narrow" style={{ margin: "0 auto" }}>
      <div className="page-head">
        <h1 className="title">Add an account</h1>
        <Link href="/accounts" className="btn btn-quiet">
          Back to accounts
        </Link>
      </div>
      <section className="card">
        <ActionForm action={createAccountAction}>
          <AccountFields />
          <div className="form-actions">
            <button type="submit" className="btn btn-primary">
              Add account
            </button>
            <span className="caption muted">Bank, broker, pension and cash accounts start with a cash position. You add crypto and securities on the next page.</span>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
