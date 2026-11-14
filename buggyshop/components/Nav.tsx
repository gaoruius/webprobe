"use client";

import Link from "next/link";
import { isBugOn } from "@/lib/bugs";
import { useCart } from "./CartProvider";

export function Nav() {
  const { count } = useCart();
  return (
    <header className="nav">
      <Link href="/" className="brand">
        BuggyShop
      </Link>
      <nav>
        <Link href="/">Products</Link>
        <Link href="/signup">Sign up</Link>
        {/* BUG mobile-cart-link-hidden: on narrow screens the cart link is hidden to make room,
            but nothing replaces it, so on a phone there is no way to reach the cart. */}
        <Link href="/cart" className={isBugOn("mobile-cart-link-hidden") ? "hide-on-phone" : undefined}>
          Cart ({count})
        </Link>
      </nav>
    </header>
  );
}
