// The scorer decides the numbers we publish, so it gets its own tests. The truth comes from
// the real manifest. Most reports are made up; `reviews` and the /product/[id] report are
// ones Gemini runs actually filed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { liveBugs, normalizePage, pageMatches, score, type ExtraBug, type TruthBug } from "../src/eval.js";
import type { BugReport } from "../src/tools.js";

const { bugs: truth, extras } = JSON.parse(
  readFileSync(new URL("../../buggyshop/bugs.manifest.json", import.meta.url), "utf8"),
) as { bugs: TruthBug[]; extras: ExtraBug[] };

const report = (r: Partial<BugReport>): BugReport => ({
  title: "",
  page: "/",
  category: "other",
  severity: "minor",
  steps: ["x"],
  expected: "",
  actual: "",
  evidence: "",
  ...r,
});

const reviews = report({
  title: "Clicking Reviews tab on product detail page throws TypeError",
  page: "/product/mug",
  category: "console",
});
const zeroQty = report({
  title: "Item stays in cart after setting quantity to 0",
  page: "http://localhost:3000/cart/",
  category: "functional",
  actual: "Quantity shows 0 and Total: $28.00",
});
const coupon = report({
  title: "Applying coupon shows no error",
  page: "/cart",
  category: "network",
  evidence: "POST /api/coupon 500",
});

test("normalizePage strips origin and trailing slash", () => {
  assert.equal(normalizePage("http://localhost:3000/cart/"), "/cart");
  assert.equal(normalizePage("/"), "/");
  assert.equal(normalizePage("/product/mug?tab=1"), "/product/mug");
});

test("pageMatches: * and route parameters match one segment", () => {
  assert.ok(pageMatches("/product/notebook", "/product/*"));
  assert.ok(pageMatches("/product/[id]", "/product/*"));
  assert.ok(pageMatches("/product/:slug", "/product/mug"));
  assert.ok(pageMatches("/product/<id>", "/product/lamp"));
  assert.ok(!pageMatches("/product", "/product/*"));
  assert.ok(!pageMatches("/cart", "/product/*"));
});

// Filed by a gemini-3.5-flash-lite run: the bug is in a component every product page uses.
test("a bug on every product page is found from any of them", () => {
  const s = score(
    [
      report({
        title: "Clicking Reviews tab on product page throws TypeError",
        page: "/product/[id]",
        category: "functional",
        evidence: "uncaught exception: TypeError: Cannot read properties of undefined (reading 'length')",
      }),
    ],
    liveBugs(truth, "all"),
  );
  assert.deepEqual(s.found.map((f) => f.id), ["reviews-tab-typeerror"]);
  assert.equal(s.falsePositives.length, 0);
});

test("matches reports to the right bug, even two on one page", () => {
  const s = score([reviews, zeroQty, coupon], liveBugs(truth, "all"));
  assert.deepEqual(s.found.map((f) => f.id).sort(), ["cart-zero-qty", "coupon-500-silent", "reviews-tab-typeerror"]);
  assert.ok(s.missed.includes("product-img-alt") && s.missed.includes("signup-email-validation"));
  assert.equal(s.recall, 3 / truth.length);
  assert.equal(s.precision, 1);
});

// Filed by a Haiku run: a real problem, but not the seeded zero-quantity bug.
const fractional = report({
  title: "Cart accepts fractional quantities (e.g. 2.5) and shows them in the header count",
  page: "/cart",
  category: "validation",
  actual: "Quantity 2.5 accepted; header shows Cart (2.5)",
});

test("another quantity bug on /cart is not the zero-quantity bug", () => {
  const s = score([fractional], liveBugs(truth, "all"));
  assert.equal(s.found.length, 0);
  assert.deepEqual(s.falsePositives, [0]);
});

test("a confirmed unseeded bug is an extra find: counts for precision, not recall", () => {
  const s = score([zeroQty, fractional], liveBugs(truth, "all"), extras);
  assert.deepEqual(s.extras, [{ id: "cart-fractional-qty", report: 1 }]);
  assert.equal(s.falsePositives.length, 0);
  assert.equal(s.precision, 1);
  assert.equal(s.recall, 1 / truth.length);
});

// Filed by a Haiku run on the clean site; its evidence has a discounted price ($87.75).
test("extras match on the title, not on numbers in the evidence", () => {
  const s = score(
    [
      report({
        title: "Invalid coupon leaves previously applied discount in the total",
        page: "/cart",
        evidence: "heading 'Total: $87.75' (subtotal is $97.50)",
      }),
    ],
    [],
    extras,
  );
  assert.deepEqual(s.extras, [{ id: "coupon-invalid-keeps-discount", report: 0 }]);
});

test("three bugs on the home page go to the right one by category and wording", () => {
  const s = score(
    [
      report({
        title: "Price: low to high puts the $9 notebook last",
        page: "/",
        category: "functional",
        evidence: "img Ceramic Mug $14, img Desk Lamp $39, img Dot Grid Notebook $9",
      }),
      report({ title: "Search for 'mug' returns no products", page: "/", category: "functional" }),
      report({ title: "Product images have no alt text", page: "/", category: "a11y" }),
    ],
    liveBugs(truth, "all"),
  );
  assert.deepEqual(
    s.found.map((f) => f.id),
    ["sort-price-string", "search-case-sensitive", "product-img-alt"],
  );
});

test("an a11y report about the shipping form is the ZIP bug, not the shipping-fee bug", () => {
  const s = score(
    [report({ title: "ZIP code field in the shipping form has no label", page: "/checkout", category: "a11y" })],
    liveBugs(truth, "all"),
  );
  assert.deepEqual(s.found.map((f) => f.id), ["checkout-zip-unlabeled"]);
});

test("a bug with several pages is found from any of them", () => {
  for (const page of ["/checkout", "/order/1001", "http://localhost:3000/orders/1001"]) {
    const s = score(
      [report({ title: "View order link goes to a 404 page", page, category: "network" })],
      liveBugs(truth, "all"),
    );
    assert.deepEqual(s.found.map((f) => f.id), ["order-link-404"], page);
  }
});

test("a second report of the same bug is a duplicate, not a new find", () => {
  const s = score([reviews, { ...reviews, title: "Reviews tab does not open" }], liveBugs(truth, "all"));
  assert.equal(s.found.length, 1);
  assert.equal(s.duplicates.length, 1);
  assert.equal(s.falsePositives.length, 0);
});

test("a report on the wrong page or about something else is a false positive", () => {
  const s = score(
    [report({ title: "Reviews tab broken", page: "/cart" }), report({ title: "Footer link is grey", page: "/" })],
    liveBugs(truth, "all"),
  );
  assert.deepEqual(s.falsePositives, [0, 1]);
  assert.equal(s.precision, 0);
});

test("on the clean site every report is a false positive and recall is undefined", () => {
  const s = score([reviews], liveBugs(truth, "none"));
  assert.equal(s.recall, null);
  assert.deepEqual(s.falsePositives, [0]);
});

test("no reports: recall 0, precision undefined", () => {
  const s = score([], liveBugs(truth, "all"));
  assert.equal(s.recall, 0);
  assert.equal(s.precision, null);
});

test("spec-only bugs: a bulk-discount report and a cart-not-cleared report each find their own bug", () => {
  const s = score(
    [
      report({ title: "No bulk discount for 10 or more of the same product", page: "/cart", category: "functional", actual: "10 mugs cost $140.00" }),
      report({ title: "Cart still has items after placing an order", page: "/checkout", category: "functional", actual: "Header shows Cart (2) instead of Cart (0)" }),
      zeroQty,
    ],
    liveBugs(truth, "all"),
  );
  assert.deepEqual(s.found.map((f) => f.id), ["bulk-discount-missing", "order-cart-not-cleared", "cart-zero-qty"]);
});
