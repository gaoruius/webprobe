"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { isBugOn } from "@/lib/bugs";

// `qty` is what the total is computed from; `shownQty` is what the input displays.
// They only diverge when the cart-zero-qty bug is on.
export type CartItem = { id: string; name: string; price: number; qty: number; shownQty: number };

type CartContextValue = {
  items: CartItem[];
  add: (item: { id: string; name: string; price: number }) => void;
  setQuantity: (id: string, qty: number) => void;
  clear: () => void;
  count: number;
  total: number;
  // Coupon percent off. Kept here, not on the cart page, so checkout charges the same total.
  discount: number;
  setDiscount: (percentOff: number) => void;
};

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "buggyshop-cart";
const DISCOUNT_KEY = "buggyshop-discount";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState(0);
  // Don't write to storage until we've read from it, or the first render's empty
  // cart would overwrite the saved one on every page load.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setItems(JSON.parse(saved));
      setDiscount(Number(localStorage.getItem(DISCOUNT_KEY)) || 0);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      localStorage.setItem(DISCOUNT_KEY, String(discount));
    } catch {}
  }, [items, discount, loaded]);

  function add(p: { id: string; name: string; price: number }) {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === p.id);
      if (existing) {
        return prev.map((i) => (i.id === p.id ? { ...i, qty: i.qty + 1, shownQty: i.qty + 1 } : i));
      }
      return [...prev, { ...p, qty: 1, shownQty: 1 }];
    });
  }

  function setQuantity(id: string, qty: number) {
    setItems((prev) => {
      if (qty <= 0) {
        // BUG cart-zero-qty: the input shows 0 but the item stays and keeps its old
        // quantity in the total. Correct behavior: remove the item.
        if (isBugOn("cart-zero-qty")) {
          return prev.map((i) => (i.id === id ? { ...i, shownQty: 0 } : i));
        }
        return prev.filter((i) => i.id !== id);
      }
      return prev.map((i) => (i.id === id ? { ...i, qty, shownQty: qty } : i));
    });
  }

  function clear() {
    setItems([]);
    setDiscount(0);
  }

  const count = items.reduce((n, i) => n + i.shownQty, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  return (
    <CartContext.Provider value={{ items, add, setQuantity, clear, count, total, discount, setDiscount }}>{children}</CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
