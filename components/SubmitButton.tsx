"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/** Not used inside ActionForm (which has its own submit handler); for plain `<form action>` buttons. */
export function SubmitButton({ children, className = "btn btn-primary" }: { children: ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? "Working…" : children}
    </button>
  );
}
