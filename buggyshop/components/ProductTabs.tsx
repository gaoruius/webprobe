"use client";

import { useState } from "react";
import type { Product } from "@/lib/products";
import { isBugOn } from "@/lib/bugs";

export function ProductTabs({ product }: { product: Product }) {
  const [tab, setTab] = useState<"description" | "reviews">("description");

  function openReviews() {
    // BUG reviews-tab-typeerror: reads reviews from the wrong field, so the click
    // handler throws "Cannot read properties of undefined" and the tab never opens.
    const reviews = isBugOn("reviews-tab-typeerror")
      ? (product as unknown as { reviewList: Product["reviews"] }).reviewList
      : product.reviews;
    console.info(`Loading ${reviews.length} reviews`);
    setTab("reviews");
  }

  return (
    <section className="tabs">
      <div role="tablist" aria-label="Product details">
        <button role="tab" aria-selected={tab === "description"} onClick={() => setTab("description")}>
          Description
        </button>
        <button role="tab" aria-selected={tab === "reviews"} onClick={openReviews}>
          Reviews ({product.reviews.length})
        </button>
      </div>
      <div role="tabpanel">
        {tab === "description" ? (
          <p>{product.description}</p>
        ) : product.reviews.length === 0 ? (
          <p>No reviews yet.</p>
        ) : (
          <ul>
            {product.reviews.map((r, i) => (
              <li key={i}>
                <strong>{r.author}</strong> – {"★".repeat(r.rating)} {r.text}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
