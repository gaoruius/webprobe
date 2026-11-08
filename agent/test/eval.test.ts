// The scorer decides the numbers we publish, so it gets its own tests. The truth comes from
// the real manifest; the reports are made up, except the first, which is the report a
// Gemini run actually filed.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { liveBugs, normalizePage, score, type TruthBug } from "../src/eval.js";
import type { BugReport } from "../src/tools.js";

const truth = (
  JSON.parse(readFileSync(new URL("../../buggyshop/bugs.manifest.json", import.meta.url), "utf8")) as {
    bugs: TruthBug[];
  }
).bugs;

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

test("matches reports to the right bug, even two on one page", () => {
  const s = score([reviews, zeroQty, coupon], liveBugs(truth, "all"));
  assert.deepEqual(s.found.map((f) => f.id).sort(), ["cart-zero-qty", "coupon-500-silent", "reviews-tab-typeerror"]);
  assert.deepEqual(s.missed.sort(), ["product-img-alt", "signup-email-validation"]);
  assert.equal(s.recall, 3 / 5);
  assert.equal(s.precision, 1);
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
