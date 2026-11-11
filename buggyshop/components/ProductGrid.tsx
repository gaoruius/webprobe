"use client";

import Link from "next/link";
import { useState } from "react";
import type { Product } from "@/lib/products";
import { isBugOn } from "@/lib/bugs";
import { AddToCartButton } from "./AddToCartButton";

type Sort = "featured" | "price-asc" | "price-desc";

const SORTS: { id: Sort; label: string }[] = [
  { id: "featured", label: "Featured" },
  { id: "price-asc", label: "Price: low to high" },
  { id: "price-desc", label: "Price: high to low" },
];

function sorted(products: Product[], sort: Sort): Product[] {
  if (sort === "featured") return products;
  // BUG sort-price-string: compares prices as text, so $9 sorts after $39.
  const cmp = isBugOn("sort-price-string")
    ? (a: Product, b: Product) => String(a.price).localeCompare(String(b.price))
    : (a: Product, b: Product) => a.price - b.price;
  const asc = [...products].sort(cmp);
  return sort === "price-asc" ? asc : asc.reverse();
}

function matches(p: Product, query: string): boolean {
  const q = query.trim();
  // BUG search-case-sensitive: "mug" finds nothing because the name is "Ceramic Mug".
  return isBugOn("search-case-sensitive") ? p.name.includes(q) : p.name.toLowerCase().includes(q.toLowerCase());
}

export function ProductGrid({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("featured");
  const shown = sorted(
    products.filter((p) => matches(p, query)),
    sort,
  );

  return (
    <>
      <div className="toolbar">
        <label>
          Search products{" "}
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div role="group" aria-label="Sort by">
          {SORTS.map((s) => (
            <button key={s.id} className="toggle" aria-pressed={sort === s.id} onClick={() => setSort(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p>No products match “{query.trim()}”.</p>
      ) : (
        <div className="grid">
          {shown.map((p) => (
            <div className="card" key={p.id}>
              {/* BUG product-img-alt: product images have no alt text. */}
              {isBugOn("product-img-alt") ? <img src={p.image} /> : <img src={p.image} alt={p.name} />}
              <h2>
                <Link href={`/product/${p.id}`}>{p.name}</Link>
              </h2>
              <p>${p.price}</p>
              <AddToCartButton id={p.id} name={p.name} price={p.price} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
