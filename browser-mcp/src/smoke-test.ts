// Smoke test: talk to the MCP server exactly the way an agent host would
// (tools/list, then tools/call), with BuggyShop running on localhost:3000.
//
// It plays a scripted "agent" that reproduces each seeded bug using only the MCP tools.
// That proves the tools are sufficient before we hand them to a real LLM.
//
//   npm run smoke            (exits 1 if any check fails)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BASE = process.env.WEBPROBE_TARGET ?? "http://localhost:3000";

const client = new Client({ name: "webprobe-smoke-test", version: "0.2.0" });
await client.connect(
  new StdioClientTransport({ command: "npx", args: ["tsx", "src/server.ts"], stderr: "ignore" }),
);

type Result = { text: string; isError: boolean };

async function call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[]).map((c) => c.text ?? "").join("\n");
  return { text, isError: Boolean(res.isError) };
}

// Find the ref of the first element whose snapshot line matches `pattern`.
function refOf(snapshot: string, pattern: RegExp): string {
  for (const line of snapshot.split("\n")) {
    if (pattern.test(line)) {
      const m = line.match(/\[ref=((?:f\d+)?e\d+)\]/);
      if (m) return m[1];
    }
  }
  throw new Error(`No element matching ${pattern} in snapshot:\n${snapshot}`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${!ok && detail ? `\n    ${detail.replace(/\n/g, "\n    ")}` : ""}`);
}

const { tools } = await client.listTools();
console.log("tools/list ->", tools.map((t) => t.name).join(", "), "\n");

// --- guard rails -----------------------------------------------------------
let r = await call("snapshot");
check("snapshot before navigate is an error", r.isError && r.text.includes("navigate"));

r = await call("navigate", { url: "https://example.com" });
check("navigate to an outside site is blocked", r.isError && r.text.startsWith("Blocked"));

r = await call("click", { ref: "button-1" });
check("malformed ref is rejected by the schema", r.isError, r.text);

// --- product-img-alt ---------------------------------------------------------
await call("navigate", { url: `${BASE}/` });
let snap = (await call("snapshot")).text;
check("snapshot has element refs", /\[ref=e\d+\]/.test(snap));
check(
  "[product-img-alt] unnamed images are reported",
  snap.includes("Images with no accessible name") && snap.includes("/img/mug.svg"),
  snap,
);

// --- leaving the site through a link is blocked at the network layer ----------
r = await call("click", { ref: refOf(snap, /link "Next\.js"/) });
const blocked = (await call("network_errors")).text;
check("clicking an outside link is blocked", blocked.includes("BLOCKED") && blocked.includes("nextjs.org"), blocked);
await call("navigate", { url: `${BASE}/` });
snap = (await call("snapshot")).text;

// --- cart-zero-qty --------------------------------------------------------------
await call("click", { ref: refOf(snap, /button "Add to cart"/) });
snap = (await call("snapshot")).text;
check("add to cart updates the nav count", /Cart \(1\)/.test(snap), snap);

await call("navigate", { url: `${BASE}/cart` });
snap = (await call("snapshot")).text;
r = await call("type", { ref: refOf(snap, /"Quantity of Ceramic Mug"/), text: "0" });
check("type into the quantity field", !r.isError, r.text);
snap = (await call("snapshot")).text;
check(
  "[cart-zero-qty] item still listed and total unchanged after qty 0",
  snap.includes("Ceramic Mug") && snap.includes("Total: $14.00"),
  snap,
);

// --- coupon-500-silent ----------------------------------------------------------
r = await call("type", { ref: refOf(snap, /textbox "Coupon code/), text: "SAVE10" });
check("type the coupon code", !r.isError, r.text);
snap = (await call("snapshot")).text;
await call("click", { ref: refOf(snap, /button "Apply"/) });
const net = (await call("network_errors")).text;
snap = (await call("snapshot")).text;
check("[coupon-500-silent] network_errors shows the 500", net.includes("HTTP 500") && net.includes("/api/coupon"), net);
check("[coupon-500-silent] page shows no message", !/coupon applied|could not apply|try again/i.test(snap), snap);

// --- reviews-tab-typeerror ------------------------------------------------------
await call("console_errors"); // clear anything from earlier pages
await call("navigate", { url: `${BASE}/product/mug` });
snap = (await call("snapshot")).text;
await call("click", { ref: refOf(snap, /tab "Reviews \(2\)"/) });
const cons = (await call("console_errors")).text;
snap = (await call("snapshot")).text;
check("[reviews-tab-typeerror] console_errors shows the TypeError", cons.includes("TypeError"), cons);
check("[reviews-tab-typeerror] reviews tab did not open", !snap.includes("Keeps coffee warm"), snap);

// --- signup-email-validation -----------------------------------------------------
await call("navigate", { url: `${BASE}/signup` });
snap = (await call("snapshot")).text;
await call("type", { ref: refOf(snap, /textbox "Email"/), text: "not-an-email" });
await call("type", { ref: refOf(snap, /textbox "Password"/), text: "testpass123" });
await call("click", { ref: refOf(snap, /button "Create account"/) });
snap = (await call("snapshot")).text;
check("[signup-email-validation] invalid email is accepted", snap.includes("Welcome, not-an-email"), snap);

// --- stale refs give a helpful error ---------------------------------------------
r = await call("click", { ref: "e9999" });
check("unknown ref returns a 'take a new snapshot' hint", r.isError && r.text.includes("snapshot"), r.text);

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
