// WebProbe iOS MCP server: the agent's tools for the BuggyShop iOS app in the Simulator.
//
// Tools
//   launch_app()           (re)start the app, e.g. after a crash
//   snapshot()             the screen as an accessibility tree with refs like [ref=e5]
//   tap(ref)               tap that element
//   type(ref, text)        replace the text in a field
//   swipe(direction)       scroll the screen up or down
//   screenshot()           PNG of the screen (the WebProbe agent keeps this one for itself)
//
// The work is done by WebProbeDriver (ios/WebProbeDriver), an XCUITest that serves HTTP on
// 127.0.0.1:8100. If it isn't running, this server builds nothing but starts it with
// `xcodebuild test-without-building` from ios/build (run ios/build.sh first) and stops
// it on exit. WEBPROBE_IOS_BUGS picks the app's bugs ("all", "none" or ids); the agent can't.
//
// Transport is stdio, so stdout belongs to the MCP protocol: log to stderr only.

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
const IOS_DIR = path.join(here, "../../ios");
const PORT = Number(process.env.WEBPROBE_DRIVER_PORT ?? 8100);
const DRIVER = `http://127.0.0.1:${PORT}`;
const DEVICE = process.env.WEBPROBE_IOS_DEVICE ?? "iPhone 17";
// A full xcodebuild destination wins over the device name, e.g. "platform=iOS Simulator,id=<UDID>"
// in CI, where several simulators can share a name.
const DESTINATION = process.env.WEBPROBE_IOS_DESTINATION ?? `platform=iOS Simulator,name=${DEVICE}`;
const BUGS = process.env.WEBPROBE_IOS_BUGS ?? "all";

const log = (...args: unknown[]) => console.error("[ios-mcp]", ...args);
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

let driver: ChildProcess | undefined;
let launched = false;

async function call(method: "GET" | "POST", route: string, body?: object, timeoutMs = 60_000): Promise<{ ok: boolean; text: string }> {
  const res = await fetch(DRIVER + route, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { ok: res.ok, text: await res.text() };
}

const driverUp = () => call("GET", "/snapshot", undefined, 2_000).then(() => true, () => false);

// Start WebProbeDriver if nothing answers on the port, then launch the app once.
async function ready(): Promise<void> {
  if (!(await driverUp())) {
    const products = path.join(IOS_DIR, "build/Build/Products");
    const xctestrun = readdirSync(products).find((f) => f.endsWith(".xctestrun"));
    if (!xctestrun) throw new Error("No .xctestrun in ios/build. Run ios/build.sh first.");
    log("starting WebProbeDriver on", DESTINATION);
    driver = spawn(
      "xcodebuild",
      ["test-without-building", "-xctestrun", path.join(products, xctestrun), "-destination", DESTINATION,
        "-only-testing:WebProbeDriver/DriverTests/testServe"],
      { stdio: "ignore", env: { ...process.env, TEST_RUNNER_WEBPROBE_DRIVER_PORT: String(PORT) } },
    );
    for (let i = 0; i < 90 && !(await driverUp()); i++) await new Promise((r) => setTimeout(r, 2_000));
    if (!(await driverUp())) throw new Error("WebProbeDriver did not start within 3 minutes.");
  }
  if (!launched) {
    await call("POST", "/launch", { bugs: BUGS });
    launched = true;
  }
}

async function command(method: "GET" | "POST", route: string, body?: object) {
  try {
    await ready();
    const res = await call(method, route, body);
    return text(res.text, !res.ok);
  } catch (err) {
    return text(`Driver error: ${(err as Error).message}`, true);
  }
}

const refArg = z.string().describe("Element ref from the latest `snapshot`, e.g. e5");

const server = new McpServer({ name: "webprobe-ios", version: "0.1.0" });

server.registerTool(
  "launch_app",
  {
    title: "Launch app",
    description: "Restart the app from its first screen. Use it after a crash, or to start over.",
    inputSchema: {},
  },
  async () => {
    try {
      await ready();
      const res = await call("POST", "/launch", { bugs: BUGS });
      return text(`${res.text} Call snapshot to see the first screen.`, !res.ok);
    } catch (err) {
      return text(`Driver error: ${(err as Error).message}`, true);
    }
  },
);

server.registerTool(
  "snapshot",
  {
    title: "Screen snapshot",
    description:
      "Return the current screen as an accessibility tree (element types, labels, values). Each element " +
      "you can act on has a ref like [ref=e5]; pass it to `tap` or `type`. Refs are only valid until the " +
      "screen changes. Elements with no accessibility label show as (no label). If the app crashed, it says so.",
    inputSchema: {},
  },
  async () => command("GET", "/snapshot"),
);

server.registerTool(
  "tap",
  {
    title: "Tap",
    description: "Tap the element with this ref (buttons, cells, tabs, segments, steppers' + and - buttons).",
    inputSchema: { ref: refArg },
  },
  async ({ ref }) => command("POST", "/tap", { ref }),
);

server.registerTool(
  "type",
  {
    title: "Type",
    description: "Tap a text field and replace its text with `text`.",
    inputSchema: { ref: refArg, text: z.string() },
  },
  async ({ ref, text: value }) => command("POST", "/type", { ref, text: value }),
);

server.registerTool(
  "swipe",
  {
    title: "Swipe",
    description: "Scroll the screen: `up` shows what's further down, `down` goes back up.",
    inputSchema: { direction: z.enum(["up", "down"]) },
  },
  async ({ direction }) => command("POST", "/swipe", { direction }),
);

server.registerTool(
  "screenshot",
  {
    title: "Screenshot",
    description: "PNG of the current screen.",
    inputSchema: {},
  },
  async () => {
    try {
      await ready();
      const res = await call("GET", "/screenshot");
      if (!res.ok) return text(res.text, true);
      return { content: [{ type: "image" as const, data: res.text, mimeType: "image/png" }] };
    } catch (err) {
      return text(`Driver error: ${(err as Error).message}`, true);
    }
  },
);

async function shutdown() {
  if (driver) {
    await call("POST", "/quit", undefined, 5_000).catch(() => {});
    driver.kill();
  }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.stdin.on("close", shutdown);

await server.connect(new StdioServerTransport());
log("ready; driver at", DRIVER);
