"use client";

import Link from "next/link";
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
        <Link href="/cart">Cart ({count})</Link>
      </nav>
    </header>
  );
}
