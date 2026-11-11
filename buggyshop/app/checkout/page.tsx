"use client";

import Link from "next/link";
import { useState } from "react";
import { useCart } from "@/components/CartProvider";
import { isBugOn } from "@/lib/bugs";
import { FREE_SHIPPING_OVER, SHIPPING, saveOrder, type Order } from "@/lib/orders";

export default function CheckoutPage() {
  const { items, clear, count, total, discount } = useCart();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [zip, setZip] = useState("");
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState<Order | null>(null);

  if (placed) {
    // BUG order-link-404: the link points at /order/<id>; the page is /orders/<id>.
    const href = isBugOn("order-link-404") ? `/order/${placed.id}` : `/orders/${placed.id}`;
    return (
      <>
        <h1>Checkout</h1>
        <p className="success">Thank you! Order #{placed.id} is placed.</p>
        <Link href={href}>View order #{placed.id}</Link>
      </>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <h1>Checkout</h1>
        <p>Your cart is empty.</p>
      </>
    );
  }

  const subtotal = total;
  const discountAmount = subtotal * (discount / 100);
  // BUG checkout-free-shipping: checks the number of items instead of their price,
  // so a $53 order still pays shipping.
  const free = isBugOn("checkout-free-shipping") ? count > FREE_SHIPPING_OVER : subtotal > FREE_SHIPPING_OVER;
  const shipping = free ? 0 : SHIPPING;
  const grandTotal = subtotal - discountAmount + shipping;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!name.trim() || !address.trim()) {
      setError("Please enter your name and address.");
      return;
    }
    if (!/^\d{5}$/.test(zip.trim())) {
      setError("ZIP code must be 5 digits.");
      return;
    }
    const order = saveOrder({
      name: name.trim(),
      address: address.trim(),
      zip: zip.trim(),
      lines: items.map((i) => ({ name: i.name, qty: i.qty, price: i.price })),
      subtotal,
      discount: discountAmount,
      shipping,
      total: grandTotal,
    });
    clear();
    setPlaced(order);
  }

  return (
    <>
      <h1>Checkout</h1>
      <table>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <td>
                {i.name} × {i.qty}
              </td>
              <td className="num">${(i.price * i.qty).toFixed(2)}</td>
            </tr>
          ))}
          <tr>
            <td>Subtotal</td>
            <td className="num">${subtotal.toFixed(2)}</td>
          </tr>
          {discount > 0 && (
            <tr>
              <td>Coupon ({discount}% off)</td>
              <td className="num">−${discountAmount.toFixed(2)}</td>
            </tr>
          )}
          <tr>
            <td>Shipping</td>
            <td className="num">{shipping === 0 ? "Free" : `$${shipping.toFixed(2)}`}</td>
          </tr>
          <tr>
            <th>Order total</th>
            <th className="num">${grandTotal.toFixed(2)}</th>
          </tr>
        </tbody>
      </table>
      <p className="muted">Free shipping when your items come to more than ${FREE_SHIPPING_OVER}.</p>

      <h2>Shipping address</h2>
      <form onSubmit={onSubmit} noValidate>
        <label>
          Full name
          <br />
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Street address
          <br />
          <input value={address} onChange={(e) => setAddress(e.target.value)} />
        </label>
        {/* BUG checkout-zip-unlabeled: the text sits next to the input but is not its label,
            so the field has no accessible name. */}
        {isBugOn("checkout-zip-unlabeled") ? (
          <div className="field">
            <span>ZIP code</span>
            <br />
            <input inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
        ) : (
          <label>
            ZIP code
            <br />
            <input inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button type="submit">Place order</button>
      </form>
    </>
  );
}
