"use client";

import { startTransition, useActionState, type ReactNode } from "react";
import type { ActionState } from "../src/server/action-state";

/**
 * A form wired to a server action. The fields keep what the person typed when the action
 * returns an error, and the message shows above the buttons. Submitting with Enter works.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, run, pending] = useActionState(action, {} as ActionState);
  return (
    <form
      className={className}
      data-pending={pending ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => run(data));
      }}
    >
      {children}
      <div aria-live="polite">
        {state.error ? (
          <p role="alert" className="banner banner-bad" style={{ marginTop: "1rem", marginBottom: 0 }}>
            {state.error}
          </p>
        ) : null}
        {state.notice ? (
          <p role="status" className="banner banner-good" style={{ marginTop: "1rem", marginBottom: 0 }}>
            {state.notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
