import type { ReactNode } from "react";
import { formatEur, formatEurSigned } from "../src/core/money";

/** A signed EUR amount coloured by direction. Zero is neutral. */
export function Delta({ minor }: { minor: number }) {
  const cls = minor > 0 ? "pos" : minor < 0 ? "neg" : "muted";
  return <span className={`num ${cls}`}>{formatEurSigned(minor)}</span>;
}

export function Eur({ minor }: { minor: number }) {
  return <span className="num">{formatEur(minor)}</span>;
}

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "good"; children: ReactNode }) {
  const cls = kind === "warn" ? "banner banner-warn" : kind === "bad" ? "banner banner-bad" : kind === "good" ? "banner banner-good" : "banner";
  return (
    <div className={cls} role={kind === "bad" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Field({ label, htmlFor, hint, children, wide }: { label: string; htmlFor?: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`field${wide ? " wide" : ""}`}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
