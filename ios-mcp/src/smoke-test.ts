// Drives the iOS app through the MCP server, the same way the agent will, and checks that each
// seeded bug can be reproduced with the tools. Needs the simulator and ios/build (ios/build.sh).
//
//   npm run smoke            (exits 1 if any check fails)

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const client = new Client({ name: "webprobe-ios-smoke-test", version: "0.1.0" });
await client.connect(
  new StdioClientTransport({ command: "npx", args: ["tsx", path.join(here, "server.ts")], env: { ...process.env } as Record<string, string> }),
);

async function tool(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const res = await client.callTool({ name, arguments: args });
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

let failures = 0;
async function check(name: string, fn: () => Promise<boolean>) {
  try {
    const ok = await fn();
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failures++;
  } catch (err) {
    console.log(`✗ ${name}: ${(err as Error).message.split("\n")[0]}`);
    failures++;
  }
}

await check("launch and read the product list", async () => (await tool("launch_app")).includes("Launched") && (await tool("snapshot")).includes("Ceramic Mug"));

await check("[add-button-unlabeled] the add buttons have no label", async () => /button \(no label\)/.test(await tool("snapshot")));

await check("[search-case-sensitive] 'mug' finds nothing", async () => {
  await tool("type", { ref: await ref(/searchField/), text: "mug" });
  const snap = await tool("snapshot");
  return snap.includes("No products match") && !snap.includes("Ceramic Mug");
});

await check("[reviews-crash] Reviews on the lamp crashes the app", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button "Desk Lamp/) });
  await tool("tap", { ref: await ref(/"Reviews \(0\)"/) });
  return (await tool("snapshot")).includes("not running");
});

await check("[signup-email-validation] 'not-an-email' is accepted", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button "Sign up"/) });
  await tool("type", { ref: await ref(/textField placeholder="Email"/), text: "not-an-email" });
  await tool("type", { ref: await ref(/secureTextField placeholder="Password"/), text: "longenough1" });
  await tool("tap", { ref: await ref(/button "Create account"/) });
  return (await tool("snapshot")).includes("Welcome, not-an-email");
});

// A driver bug once tapped the keyboard instead of a field it covered, and the text went into the
// field above. Fill all three checkout fields and check each landed where it was sent.
await check("typing goes into the field that was asked for, even under the keyboard", async () => {
  await tool("launch_app");
  await tool("tap", { ref: await ref(/button \(no label\)/) });
  await tool("tap", { ref: await ref(/button "Cart"/) });
  await tool("tap", { ref: await ref(/"Checkout"/) });
  for (const [field, value] of [["Full name", "Ann Lee"], ["Street address", "1 Main St"], ["ZIP code", "95014"]]) {
    await tool("type", { ref: await ref(new RegExp(`placeholder="${field}"`)), text: value });
  }
  const snap = await tool("snapshot");
  return ['"Full name" value="Ann Lee"', '"Street address" value="1 Main St"', '"ZIP code" value="95014"'].every((s) => snap.includes(s));
});

await check("screenshot returns an image", async () => (await tool("screenshot")).includes("[image]"));

await client.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
