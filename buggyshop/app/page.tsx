import Link from "next/link";
import { PRODUCTS } from "@/lib/products";
import { isBugOn } from "@/lib/bugs";
import { AddToCartButton } from "@/components/AddToCartButton";

export default function HomePage() {
  return (
    <>
      <h1>Products</h1>
      <div className="grid">
        {PRODUCTS.map((p) => (
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
    </>
  );
}
