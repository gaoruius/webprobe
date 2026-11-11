import { PRODUCTS } from "@/lib/products";
import { ProductGrid } from "@/components/ProductGrid";

export default function HomePage() {
  return (
    <>
      <h1>Products</h1>
      <ProductGrid products={PRODUCTS} />
    </>
  );
}
