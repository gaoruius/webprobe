"use client";

import { useState } from "react";
import { useCart } from "./CartProvider";

export function AddToCartButton({ id, name, price }: { id: string; name: string; price: number }) {
  const { add } = useCart();
  const [added, setAdded] = useState(false);
  return (
    <button
      onClick={() => {
        add({ id, name, price });
        setAdded(true);
      }}
    >
      {added ? "Added ✓" : "Add to cart"}
    </button>
  );
}
