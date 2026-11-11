// Bug switches. Every seeded bug has an id that matches bugs.manifest.json,
// so the eval script knows exactly which bugs are "live" in a given run.
//
// NEXT_PUBLIC_BUGS controls them (restart `next dev` after changing it):
//   unset / "all"            -> every bug on (default: this is a test target)
//   "none"                   -> clean site, used to measure false positives
//   "cart-zero-qty,coupon-500-silent" -> only the listed bugs

export const BUG_IDS = [
  "cart-zero-qty",
  "signup-email-validation",
  "product-img-alt",
  "coupon-500-silent",
  "reviews-tab-typeerror",
  "search-case-sensitive",
  "sort-price-string",
  "checkout-free-shipping",
  "checkout-zip-unlabeled",
  "order-link-404",
] as const;

export type BugId = (typeof BUG_IDS)[number];

const raw = (process.env.NEXT_PUBLIC_BUGS ?? "all").trim();

const enabled: Set<string> =
  raw === "all" ? new Set(BUG_IDS) : raw === "none" ? new Set() : new Set(raw.split(",").map((s) => s.trim()));

export function isBugOn(id: BugId): boolean {
  return enabled.has(id);
}
