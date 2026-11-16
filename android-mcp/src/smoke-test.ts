// Drives the Android app through the MCP server, the same way the agent will, and checks that each
// seeded bug can be reproduced with the tools. Needs a running emulator with BuggyShop installed
// (android/ci.sh does both in CI).
//
//   npm run smoke            (exits 1 if any check fails)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "webprobe-android-smoke-test", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({ command: "npx", args: ["tsx", path.join(here, "server.ts")], env: { ...process.env } as Record<string, string> }),
);

async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 120_000 });
  return (res.content as { type: string; text?: string }[]).map((c) => c.text ?? `[${c.type}]`).join("\n");
}

// The ref of the first snapshot line matching `pattern`.
async function ref(pattern: RegExp): Promise<string> {
  const snap = await tool("snapshot");
  const line = snap.split("\n").find((l) => pattern.test(l));
  const m = line?.match(/\[ref=(e\d+)\]/);
  if (!m) throw new Error(`No element matching ${pattern} in:\n${snap}`);
  return m[1];
}

// Snapshots until one contains `text`. Throws with the last snapshot, so a CI failure shows the screen.
async function waitFor(text: string, ms = 10_000): Promise<true> {
  const deadline = Date.now() + ms;
  for (;;) {
    const snap = await tool("snapshot");
    if (snap.includes(text)) return true;
    if (Date.now() > deadline) throw new Error(`"${text}" not on screen after ${ms / 1000}s:\n${snap}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

let failures = 0;
async function check(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) {
      console.log(await tool("snapshot"));
      failures++;
    }
  } catch (err) {
    console.log(`✗ ${name}: ${(err as Error).message}`);
    failures++;
  }
}

await check("launch and read the product list", async () => {
  await tool("launch_app");
  const snap = await tool("snapshot");
  console.log(snap); // what the agent sees, in the CI log
  return snap.includes("Ceramic Mug");
});

await check("[add-button-unlabeled] the add buttons have no label", async () => /button \(no label\)/.test(await tool("snapshot")));

await check("[search-case-sensitive] 'mug' finds nothing", async () => {
  await tool("type", { ref: await ref(/textField "Search products"/), text: "mug" });
  const snap = await tool("snapshot");
  return snap.includes("No products match") && !snap.includes("Ceramic Mug");
});

await check("[reviews-crash] Reviews on the lamp crashes the app", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button "Desk Lamp/) });
  await tool("tap", { ref: await ref(/"Reviews \(0\)"/) });
  return waitFor("not running");
});

await check("[signup-email-validation] 'not-an-email' is accepted", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button "Sign up"/) });
  await tool("type", { ref: await ref(/textField "Email"/), text: "not-an-email" });
  await tool("type", { ref: await ref(/secureTextField "Password"/), text: "longenough1" });
  await tool("tap", { ref: await ref(/button "Create account"/) });
  return waitFor("Welcome, not-an-email");
});

// Typing must land in the field that was asked for, even one the keyboard would cover.
await check("typing goes into the field that was asked for", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button \(no label\)/) });
  await tool("tap", { ref: await ref(/button "[^"]*Cart/) });
  await tool("tap", { ref: await ref(/button "Checkout"/) });
  for (const [field, value] of [["Full name", "Ann Lee"], ["Street address", "1 Main St"], ["ZIP code", "95014"]]) {
    await tool("type", { ref: await ref(new RegExp(`textField "${field}"`)), text: value });
  }
  const snap = await tool("snapshot");
  console.log(snap);
  return ['"Full name" value="Ann Lee"', '"Street address" value="1 Main St"', '"ZIP code" value="95014"'].every((s) => snap.includes(s));
});

await check("screenshot returns an image", async () => (await tool("screenshot")).includes("[image]"));

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
