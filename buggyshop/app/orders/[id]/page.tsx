"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { loadOrders, type Order } from "@/lib/orders";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null | undefined>(undefined);

  useEffect(() => {
    setOrder(loadOrders().find((o) => String(o.id) === id) ?? null);
  }, [id]);

  if (order === undefined) return <p>Loading…</p>;
  if (order === null) {
    return (
      <>
        <h1>Order not found</h1>
        <p>
          There is no order #{id}. <Link href="/">Back to products</Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Order #{order.id}</h1>
      <p>
        Shipping to {order.name}, {order.address}, {order.zip}
      </p>
      <table>
        <tbody>
          {order.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.name} × {l.qty}
              </td>
              <td className="num">${(l.total ?? l.price * l.qty).toFixed(2)}</td>
            </tr>
          ))}
          <tr>
            <td>Shipping</td>
            <td className="num">{order.shipping === 0 ? "Free" : `$${order.shipping.toFixed(2)}`}</td>
          </tr>
          <tr>
            <th>Total</th>
            <th className="num">${order.total.toFixed(2)}</th>
          </tr>
        </tbody>
      </table>
    </>
  );
}
