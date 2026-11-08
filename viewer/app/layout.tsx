import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "WebProbe Runs",
  description: "Runs of the WebProbe QA agent, scored against BuggyShop's seeded bugs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>
              ◎
            </span>
            WebProbe
          </Link>
          <span className="topbar-note">QA agent runs</span>
        </header>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
