import { isBugOn } from "@/lib/bugs";

const COUPONS: Record<string, number> = { SAVE10: 10, WELCOME20: 20 };

export async function POST(request: Request) {
  // Part of BUG coupon-500-silent: the coupon service is "down". The bug the agent
  // should report is that the cart page shows no error when this happens.
  if (isBugOn("coupon-500-silent")) {
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }

  const { code } = await request.json().catch(() => ({ code: "" }));
  const percentOff = COUPONS[String(code).trim().toUpperCase()];
  if (!percentOff) {
    return Response.json({ error: "This coupon code is not valid." }, { status: 400 });
  }
  return Response.json({ percentOff });
}
