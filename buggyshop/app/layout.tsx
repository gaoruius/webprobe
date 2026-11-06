import type { Metadata } from "next";
import { CartProvider } from "@/components/CartProvider";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "BuggyShop",
  description: "A small shop with seeded bugs, used to evaluate the WebProbe QA agent.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CartProvider>
          <Nav />
          <main>{children}</main>
          {/* A normal outbound link. Not a bug: it checks that the agent can't leave the site. */}
          <footer className="footer">
            Built with <a href="https://nextjs.org">Next.js</a>
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
