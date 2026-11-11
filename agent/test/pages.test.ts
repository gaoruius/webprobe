// The coverage gate decides when the agent may stop, so its page tracking gets tests.
// Inputs are real tool outputs from a Sonnet run.

import assert from "node:assert/strict";
import { test } from "node:test";
import { pagesIn } from "../src/agent.js";

const origin = "http://localhost:3000";

test("reads the current page from each tool's output", () => {
  assert.deepEqual(pagesIn('Opened http://localhost:3000/ (HTTP 200). Title: "BuggyShop"', origin).visited, ["/"]);
  assert.deepEqual(pagesIn("Clicked e15. Now at http://localhost:3000/cart. Call `snapshot`", origin).visited, ["/cart"]);
  assert.deepEqual(pagesIn("URL: http://localhost:3000/product/mug/\n\n- main", origin).visited, ["/product/mug"]);
});

test("collects same-site links from a snapshot and skips other sites", () => {
  const snapshot = `URL: http://localhost:3000/

- banner [ref=e2]:
    - link "BuggyShop" [ref=e3] [cursor=pointer]:
      - /url: /
      - link "Sign up" [ref=e6] [cursor=pointer]:
        - /url: /signup
          - link "Ceramic Mug" [ref=e21] [cursor=pointer]:
            - /url: /product/mug
  - contentinfo [ref=e40]:
    - link "Next.js" [ref=e41] [cursor=pointer]:
      - /url: https://nextjs.org`;
  assert.deepEqual(pagesIn(snapshot, origin).linked, ["/", "/signup", "/product/mug"]);
});

test("text that only mentions a URL is not a visit", () => {
  const out = "2 new network event(s):\nHTTP 500 POST http://localhost:3000/api/coupon";
  assert.deepEqual(pagesIn(out, origin), { visited: [], linked: [] });
});
