"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", label: "Summary", match: (p: string) => p === "/" },
  { href: "/accounts", label: "Accounts", match: (p: string) => p.startsWith("/accounts") },
  { href: "/close", label: "Close month", match: (p: string) => p.startsWith("/close") },
  { href: "/settings", label: "Settings", match: (p: string) => p.startsWith("/settings") },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Primary">
      {ITEMS.map((item) => (
        <Link key={item.href} href={item.href} aria-current={item.match(pathname) ? "page" : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
