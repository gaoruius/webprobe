import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/products";
import { AddToCartButton } from "@/components/AddToCartButton";
import { ProductTabs } from "@/components/ProductTabs";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <>
      <p>
        <Link href="/">← All products</Link>
      </p>
      <h1>{product.name}</h1>
      <p>${product.price}</p>
      <AddToCartButton id={product.id} name={product.name} price={product.price} />
      <ProductTabs product={product} />
    </>
  );
}
