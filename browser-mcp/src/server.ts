// WebProbe browser MCP server: the agent's only way to touch a web page.
//
// Tools
//   navigate(url)          open a page (only on allowed origins)
//   snapshot()             the page as an accessibility tree with element refs like [ref=e5]
//   click(ref)             click the element with that ref
//   type(ref, text)        fill an input; optionally press Enter
//   console_errors()       console errors + uncaught exceptions since the last call
//   network_errors()       failed / 4xx / 5xx / blocked requests since the last call
//
// Transport is stdio, so stdout belongs to the MCP protocol: log to stderr only.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { z } from "zod";

// Safety: the agent may only reach the site under test (lecture 4/5: enforce rules in
// the harness, not in the prompt). Override with a comma-separated list of origins.
const ALLOWED_ORIGINS = new Set(
  (process.env.WEBPROBE_ALLOWED_ORIGINS ?? "http://localhost:3000").split(",").map((o) => o.trim()),
);

// Snapshots go straight into the model's context, so cap their size (context bloat).
const MAX_SNAPSHOT_CHARS = Number(process.env.WEBPROBE_MAX_SNAPSHOT_CHARS ?? 12000);

// Event buffers keep only the most recent entries so a noisy page can't grow them forever.
const MAX_BUFFERED_EVENTS = 50;

const ACTION_TIMEOUT_MS = 5000;

const log = (...args: unknown[]) => console.error("[browser-mcp]", ...args);

function isAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    // data: and blob: URLs are created by the page itself, not fetched from another site.
    return u.protocol === "data:" || u.protocol === "blob:" || ALLOWED_ORIGINS.has(u.origin);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Browser state: one browser, one page, shared by every tool call.
// ---------------------------------------------------------------------------

let browser: Browser | undefined;
let context: BrowserContext | undefined;
let page: Page | undefined;

const consoleEvents: string[] = [];
const networkEvents: string[] = [];

// Requests that have started but not finished; `settle` waits for this to reach zero.
let inFlightRequests = 0;

function remember(buffer: string[], entry: string) {
  buffer.push(entry);
  if (buffer.length > MAX_BUFFERED_EVENTS) buffer.shift();
}

function drain(buffer: string[]): string[] {
  return buffer.splice(0, buffer.length);
}

async function getPage(): Promise<Page> {
  if (!browser) {
    // WEBPROBE_BROWSER_CHANNEL=chrome uses the installed Google Chrome instead of
    // Playwright's bundled Chromium (handy when `npx playwright install` can't download).
    browser = await chromium.launch({
      headless: process.env.WEBPROBE_HEADED !== "1",
      channel: process.env.WEBPROBE_BROWSER_CHANNEL || undefined,
    });
    log("browser launched");
  }
  if (!context) {
    context = await browser.newContext();
    // The allowlist in `navigate` alone isn't enough: a click on an outside link, a redirect
    // or a script could still leave the site. Block every off-site request at the network layer.
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (isAllowed(url)) return route.continue();
      remember(networkEvents, `BLOCKED (not an allowed origin) ${route.request().method()} ${url}`);
      return route.abort("blockedbyclient");
    });
  }
  if (!page || page.isClosed()) {
    page = await context.newPage();
    // Listeners must be attached before the first navigation, or errors that happen
    // while the page loads are missed.
    page.on("console", (msg) => {
      if (msg.type() !== "error" && msg.type() !== "warning") return;
      const where = msg.location().url ? ` (at ${msg.location().url}:${msg.location().lineNumber})` : "";
      remember(consoleEvents, `console.${msg.type()}: ${msg.text()}${where}`);
    });
    page.on("pageerror", (err) => {
      remember(consoleEvents, `uncaught exception: ${err.name}: ${err.message}`);
    });
    page.on("request", () => {
      inFlightRequests++;
    });
    page.on("requestfinished", () => {
      inFlightRequests = Math.max(0, inFlightRequests - 1);
    });
    page.on("response", (res) => {
      if (res.status() >= 400) {
        remember(networkEvents, `HTTP ${res.status()} ${res.request().method()} ${res.url()}`);
      }
    });
    page.on("requestfailed", (req) => {
      inFlightRequests = Math.max(0, inFlightRequests - 1);
      const reason = req.failure()?.errorText ?? "unknown error";
      // Requests we blocked ourselves are already recorded by the route handler.
      if (!reason.includes("BLOCKED_BY_CLIENT")) {
        remember(networkEvents, `FAILED ${req.method()} ${req.url()} (${reason})`);
      }
    });
  }
  return page;
}

function currentPage(): Page | undefined {
  return page && !page.isClosed() && page.url() !== "about:blank" ? page : undefined;
}

// Let the page settle after an action: wait until no request has been in flight for
// QUIET_MS, up to SETTLE_TIMEOUT_MS. (waitForLoadState("networkidle") only covers the
// initial page load, so it returns immediately after a click and misses fetches the click
// starts — e.g. the coupon request — which then show up only after we've reported back.)
const QUIET_MS = 300;
const SETTLE_TIMEOUT_MS = 3000;

async function settle(p: Page) {
  await p.waitForLoadState("domcontentloaded", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (inFlightRequests > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= QUIET_MS) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------------------------------------------------------------------------
// Results. Errors are returned with isError instead of thrown, so the model sees them and
// can recover (lecture 5: raise the error to the agent). Messages say what to do next.
// ---------------------------------------------------------------------------

function text(t: string, isError = false) {
  return { content: [{ type: "text" as const, text: t }], isError };
}

const NO_PAGE = text("No page is open. Call `navigate` first.", true);

// Refs come from the latest snapshot and look like "e5". After the page navigates, Playwright
// prefixes them with a frame id ("f2e16"), so accept that form too.
const refSchema = z
  .string()
  .regex(/^(f\d+)?e\d+$/, "A ref looks like e5 or f2e16")
  .describe("Element ref from the latest `snapshot`, e.g. e5 or f2e16");

function staleRefHint(ref: string, err: unknown): string {
  const msg = (err as Error).message.split("\n")[0];
  return (
    `Could not act on ${ref}: ${msg}. Refs change whenever the page updates — ` +
    "call `snapshot` to get fresh refs, then try again."
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

const server = new McpServer({ name: "webprobe-browser", version: "0.2.0" });

server.registerTool(
  "navigate",
  {
    title: "Navigate",
    description:
      "Open a URL in the browser. Only the site under test is allowed. " +
      "Call `snapshot` afterwards to see the page content.",
    inputSchema: { url: z.string().describe("Absolute URL, e.g. http://localhost:3000/cart") },
  },
  async ({ url }) => {
    try {
      new URL(url);
    } catch {
      return text(`Invalid URL: ${url}. Use an absolute URL like http://localhost:3000/cart`, true);
    }
    if (!isAllowed(url)) {
      log("blocked navigation to", url);
      return text(
        `Blocked: ${new URL(url).origin} is not an allowed origin. ` +
          `Allowed: ${[...ALLOWED_ORIGINS].join(", ")}. Only test the site you were given.`,
        true,
      );
    }
    const p = await getPage();
    try {
      const res = await p.goto(url, { waitUntil: "networkidle", timeout: 15000 });
      return text(`Opened ${p.url()} (HTTP ${res?.status() ?? "?"}). Title: "${await p.title()}"`);
    } catch (err) {
      return text(`Navigation failed: ${(err as Error).message.split("\n")[0]}`, true);
    }
  },
);

server.registerTool(
  "snapshot",
  {
    title: "Page snapshot",
    description:
      "Return the current page as an accessibility tree (roles, names, values). Each element " +
      "you can act on has a ref like [ref=e5]; pass it to `click` or `type`. Refs are only " +
      "valid until the page changes, so take a new snapshot after every action.",
    inputSchema: {},
  },
  async () => {
    const p = currentPage();
    if (!p) return NO_PAGE;

    const tree = await p.ariaSnapshot({ mode: "ai" });
    const truncated =
      tree.length > MAX_SNAPSHOT_CHARS
        ? tree.slice(0, MAX_SNAPSHOT_CHARS) + `\n... [truncated ${tree.length - MAX_SNAPSHOT_CHARS} chars]`
        : tree;

    // The AI-mode tree leaves out images that have no accessible name, so report them
    // separately; otherwise that information would be lost entirely.
    const unnamedImages = await p.evaluate(() =>
      Array.from(document.querySelectorAll("img"))
        .filter(
          (img) =>
            !img.getAttribute("alt") &&
            !img.getAttribute("aria-label") &&
            !img.getAttribute("aria-labelledby") &&
            img.getAttribute("aria-hidden") !== "true" &&
            img.getAttribute("role") !== "presentation" &&
            img.getAttribute("alt") !== "",
        )
        .map((img) => img.getAttribute("src") ?? "(no src)"),
    );
    const imagesNote = unnamedImages.length
      ? `\n\nImages with no accessible name (not shown in the tree above): ${unnamedImages.length}\n` +
        unnamedImages.map((src) => `- img src=${src}`).join("\n")
      : "";

    return text(`URL: ${p.url()}\n\n${truncated}${imagesNote}`);
  },
);

server.registerTool(
  "click",
  {
    title: "Click",
    description: "Click an element by its ref from the latest `snapshot`.",
    inputSchema: { ref: refSchema },
  },
  async ({ ref }) => {
    const p = currentPage();
    if (!p) return NO_PAGE;
    try {
      await p.locator(`aria-ref=${ref}`).click({ timeout: ACTION_TIMEOUT_MS });
    } catch (err) {
      return text(staleRefHint(ref, err), true);
    }
    await settle(p);
    return text(`Clicked ${ref}. Now at ${p.url()}. Call \`snapshot\` to see the result.`);
  },
);

server.registerTool(
  "type",
  {
    title: "Type",
    description:
      "Replace the value of a text field (input, textarea, number field) found by its ref. " +
      "Set submit=true to press Enter afterwards.",
    inputSchema: {
      ref: refSchema,
      text: z.string().describe("The full new value of the field"),
      submit: z.boolean().optional().describe("Press Enter after typing (default false)"),
    },
  },
  async ({ ref, text: value, submit }) => {
    const p = currentPage();
    if (!p) return NO_PAGE;
    const field = p.locator(`aria-ref=${ref}`);
    try {
      await field.fill(value, { timeout: ACTION_TIMEOUT_MS });
      if (submit) await field.press("Enter", { timeout: ACTION_TIMEOUT_MS });
    } catch (err) {
      return text(staleRefHint(ref, err), true);
    }
    await settle(p);
    return text(
      `Typed ${JSON.stringify(value)} into ${ref}${submit ? " and pressed Enter" : ""}. ` +
        "Call `snapshot` to see the result.",
    );
  },
);

server.registerTool(
  "console_errors",
  {
    title: "Console errors",
    description:
      "Return console errors/warnings and uncaught exceptions recorded since the last call " +
      "(the list is cleared each time). Check it after actions that might have failed silently.",
    inputSchema: {},
  },
  async () => {
    const events = drain(consoleEvents);
    return text(
      events.length ? `${events.length} new console event(s):\n${events.join("\n")}` : "No new console errors.",
    );
  },
);

server.registerTool(
  "network_errors",
  {
    title: "Network errors",
    description:
      "Return requests that failed, got an HTTP 4xx/5xx response, or were blocked for leaving the " +
      "site, recorded since the last call (the list is cleared each time).",
    inputSchema: {},
  },
  async () => {
    const events = drain(networkEvents);
    return text(
      events.length ? `${events.length} new network event(s):\n${events.join("\n")}` : "No new network errors.",
    );
  },
);

// ---------------------------------------------------------------------------

async function shutdown() {
  await browser?.close().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await server.connect(new StdioServerTransport());
log(`ready; allowed origins: ${[...ALLOWED_ORIGINS].join(", ")}`);
