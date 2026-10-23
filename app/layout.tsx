import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Nav } from "../components/Nav";

export const metadata: Metadata = {
  title: { default: "Finance K", template: "%s · Finance K" },
  description: "A local-first monthly net-worth tracker. Your data stays on this Mac.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <header className="topbar">
          <div className="topbar-inner">
            <a href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                K
              </span>
              Finance K
            </a>
            <Nav />
            <span className="local-tag">Data stays on this Mac</span>
          </div>
        </header>
        <main id="main" className="page">
          {children}
        </main>
      </body>
    </html>
  );
}
