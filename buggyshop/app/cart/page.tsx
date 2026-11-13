"use client";

import Link from "next/link";
import { useState } from "react";
import { BULK_PERCENT_OFF, bulkApplies, useCart } from "@/components/CartProvider";
import { isBugOn } from "@/lib/bugs";

export default function CartPage() {
  const { items, setQuantity, total, discount, setDiscount } = useCart();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  async function applyCoupon() {
    setMessage(null);
    try {
      const res = await fetch("/api/coupon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // BUG coupon-500-silent: server errors are swallowed; the user sees nothing.
        if (isBugOn("coupon-500-silent")) return;
        setMessage({ kind: "error", text: data.error ?? "Could not apply coupon. Please try again." });
        return;
      }
      setDiscount(data.percentOff);
      setMessage({ kind: "success", text: `Coupon applied: ${data.percentOff}% off` });
    } catch {
      setMessage({ kind: "error", text: "Network error. Please try again." });
    }
  }

  if (items.length === 0) {
    return (
      <>
        <h1>Cart</h1>
        <p>Your cart is empty.</p>
      </>
    );
  }

  const finalTotal = total * (1 - discount / 100);

  return (
    <>
      <h1>Cart</h1>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Price</th>
            <th>Quantity</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.name}
                {bulkApplies(i) && <span className="muted"> · {BULK_PERCENT_OFF}% bulk discount</span>}
              </td>
              <td>${i.price}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  aria-label={`Quantity of ${i.name}`}
                  value={i.shownQty}
                  onChange={(e) => setQuantity(i.id, Number(e.target.value))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <label>
          Coupon code{" "}
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SAVE10" />
        </label>{" "}
        <button onClick={applyCoupon}>Apply</button>
      </p>
      {message && <p className={message.kind}>{message.text}</p>}

      <h2>Total: ${finalTotal.toFixed(2)}</h2>
      <p className="muted">Free shipping when your items come to more than $50.</p>
      <Link href="/checkout" className="button">
        Checkout
      </Link>
    </>
  );
}
