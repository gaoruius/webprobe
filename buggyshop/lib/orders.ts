// Orders live in localStorage: the shop has no backend beyond the coupon API.

export type Order = {
  id: number;
  name: string;
  address: string;
  zip: string;
  lines: { name: string; qty: number; price: number }[];
  subtotal: number;
  discount: number;
  shipping: number;
  total: number;
};

const KEY = "buggyshop-orders";

export function loadOrders(): Order[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveOrder(order: Omit<Order, "id">): Order {
  const orders = loadOrders();
  const saved = { ...order, id: 1001 + orders.length };
  try {
    localStorage.setItem(KEY, JSON.stringify([...orders, saved]));
  } catch {}
  return saved;
}

export const SHIPPING = 5;
export const FREE_SHIPPING_OVER = 50;
