// WebProbe Android MCP server: the agent's tools for the BuggyShop Android app in the emulator.
//
// Tools (the same as ios-mcp, so the agent works on either)
//   launch_app()           (re)start the app, e.g. after a crash
//   snapshot()             the screen as an accessibility tree with refs like [ref=e5]
//   tap(ref)               tap that element
//   type(ref, text)        replace the text in a field
//   swipe(direction)       scroll the screen up or down
//   screenshot()           PNG of the screen (the WebProbe agent keeps this one for itself)
//
// Unlike iOS, Android needs no driver of our own on the device: adb and uiautomator ship with it.
// `uiautomator dump` gives the accessibility tree as XML; `input tap/text/swipe` acts on the screen.
// The app must already be installed (android/ci.sh does it). WEBPROBE_ANDROID_BUGS picks the
// app's bugs ("all", "none" or ids); the agent can't.
//
// Transport is stdio, so stdout belongs to the MCP protocol: log to stderr only.

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PKG = "dev.webprobe.buggyshop";
const BUGS = process.env.WEBPROBE_ANDROID_BUGS ?? "all";
const ADB = process.env.ADB ?? (process.env.ANDROID_HOME ? path.join(process.env.ANDROID_HOME, "platform-tools/adb") : "adb");

const log = (...args: unknown[]) => console.error("[android-mcp]", ...args);
const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const run = promisify(execFile);

async function shell(...args: string[]): Promise<string> {
  const { stdout } = await run(ADB, ["shell", ...args], { maxBuffer: 16 << 20 });
  return stdout;
}

// ---- The accessibility tree ----

type Node = { attrs: Record<string, string>; children: Node[] };
type Box = { x1: number; y1: number; x2: number; y2: number };

const unescape = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#10;/g, " ").replace(/&amp;/g, "&");

function parse(xml: string): Node {
  const root: Node = { attrs: {}, children: [] };
  const stack = [root];
  for (const m of xml.matchAll(/<node\b([^>]*?)(\/?)>|<\/node>/g)) {
    if (m[0].startsWith("</")) {
      stack.pop();
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = unescape(a[2]);
    const node: Node = { attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[2]) stack.push(node);
  }
  return root;
}

const box = (n: Node): Box => {
  const [x1, y1, x2, y2] = (n.attrs.bounds?.match(/\d+/g) ?? ["0", "0", "0", "0"]).map(Number);
  return { x1, y1, x2, y2 };
};
const empty = (b: Box) => b.x2 <= b.x1 || b.y2 <= b.y1;
const center = (b: Box) => ({ x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2) });

const isField = (n: Node) => (n.attrs.class ?? "").endsWith("EditText");
const actionable = (n: Node) => n.attrs.clickable === "true" || n.attrs.checkable === "true" || isField(n);
const own = (n: Node) => n.attrs["content-desc"] || "";

// The texts inside a node, the way TalkBack reads a button out: "Cart", "Reviews (0)".
function innerText(n: Node): string[] {
  return n.children.flatMap((c) => {
    if (actionable(c)) return [];
    const t = own(c) || c.attrs.text || "";
    return t ? [t, ...innerText(c)] : innerText(c);
  });
}

// What a person using TalkBack would hear an element called. A text field's name is its label
// (hint), its value is what's typed in it.
function nameOf(n: Node): string {
  if (isField(n)) return n.attrs.hint || own(n) || innerText(n).join(" ");
  return own(n) || n.attrs.text || (actionable(n) ? innerText(n).join(" ") : "");
}

function kind(n: Node): string {
  const cls = n.attrs.class ?? "";
  if (isField(n)) return n.attrs.password === "true" ? "secureTextField" : "textField";
  if (actionable(n)) return "button";
  if (cls.endsWith("ImageView")) return "image";
  return "text";
}

type Seen = { kind: string; name: string; box: Box };
let seen = new Map<string, Seen>();

async function dump(): Promise<Node> {
  for (let attempt = 0; ; attempt++) {
    try {
      await shell("uiautomator", "dump", "/sdcard/webprobe.xml");
      const xml = await shell("cat", "/sdcard/webprobe.xml");
      if (xml.includes("<hierarchy")) return parse(xml);
    } catch (err) {
      if (attempt >= 3) throw err;
    }
    if (attempt >= 3) throw new Error("uiautomator returned no screen");
    await sleep(500);
  }
}

// Every element on screen with the name and kind the snapshot gives it.
function elements(root: Node): (Seen & { node: Node })[] {
  const out: (Seen & { node: Node })[] = [];
  const walk = (n: Node) => {
    const b = box(n);
    if (n.attrs.class && !empty(b) && (actionable(n) || nameOf(n))) out.push({ kind: kind(n), name: nameOf(n), box: b, node: n });
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}

async function running(): Promise<boolean> {
  try {
    return (await shell("pidof", PKG)).trim() !== "";
  } catch {
    return false; // pidof exits 1 when there is no such process
  }
}

const notRunning = "The app is not running: it crashed or was closed. Relaunch it to continue.";

async function snapshot(): Promise<string> {
  if (!(await running())) return notRunning;
  const root = await dump();
  seen = new Map();
  const lines: string[] = [];
  let n = 0;
  // Texts inside a button are already its name: list them once, as the button.
  const walk = (node: Node, depth: number, inButton: boolean) => {
    const b = box(node);
    const name = nameOf(node);
    const show = Boolean(node.attrs.class) && !empty(b) && (actionable(node) || (name !== "" && !inButton));
    let next = depth;
    if (show) {
      const ref = `e${++n}`;
      const k = kind(node);
      seen.set(ref, { kind: k, name, box: b });
      let line = `${"  ".repeat(depth)}- ${k} ${name ? `"${name}"` : "(no label)"}`;
      const value = node.attrs.text;
      if (isField(node) && value && value !== name) line += ` value="${value}"`;
      if (node.attrs.enabled === "false") line += " [disabled]";
      if (node.attrs.selected === "true" || node.attrs.checked === "true") line += " [selected]";
      if (node.attrs.focused === "true" && isField(node)) line += " [focused]";
      lines.push(`${line} [ref=${ref}]`);
      next = depth + 1;
    }
    for (const c of node.children) walk(c, next, inButton || (show && actionable(node)));
  };
  walk(root, 0, false);
  return lines.join("\n");
}

// ---- Acting on the screen ----

async function keyboardShown(): Promise<boolean> {
  return /mInputShown=true/.test(await shell("dumpsys", "input_method"));
}

// Back closes the keyboard when it's up; when it isn't, back would leave the screen, so check first.
async function hideKeyboard() {
  if (await keyboardShown()) {
    await shell("input", "keyevent", "KEYCODE_BACK");
    await sleep(400);
  }
}

// The live element a ref stood for: same kind and name, nearest to where it was.
function find(root: Node, info: Seen) {
  const c0 = center(info.box);
  const dist = (b: Box) => Math.hypot(center(b).x - c0.x, center(b).y - c0.y);
  return elements(root)
    .filter((e) => e.kind === info.kind && e.name === info.name)
    .sort((a, b) => dist(a.box) - dist(b.box))[0];
}

const staleRef = (ref: string) => `No element ${ref} in the last snapshot. Take a new snapshot and use its refs.`;
const crashNote = async () => ((await running()) ? "" : "\nThe app is no longer running: it crashed or was closed.");

async function tap(ref: string) {
  const info = seen.get(ref);
  if (!info) return text(staleRef(ref), true);
  // The keyboard can cover what the agent wants; the layout moves once it's gone, so look again.
  await hideKeyboard();
  const live = find(await dump(), info);
  const { x, y } = center(live?.box ?? info.box);
  await shell("input", "tap", String(x), String(y));
  await sleep(700);
  return text(`Tapped ${ref}. Call snapshot to see the result.${await crashNote()}`);
}

// Single-quoted for the device's shell; input text needs %s for a space.
const quoted = (s: string) => `'${s.replace(/ /g, "%s").replace(/'/g, `'\\''`)}'`;

async function type(ref: string, value: string) {
  const info = seen.get(ref);
  if (!info) return text(staleRef(ref), true);
  await hideKeyboard();
  const live = find(await dump(), info);
  const { x, y } = center(live?.box ?? info.box);
  await shell("input", "tap", String(x), String(y));
  await sleep(600);
  // Never type into a field the agent didn't pick: a tap that missed would put the text elsewhere.
  const focused = elements(await dump()).find((e) => isField(e.node) && e.node.attrs.focused === "true");
  if (!focused || focused.name !== info.name) {
    return text(`Could not put the cursor in ${ref}. Take a new snapshot; if the field is hidden, swipe to it.`, true);
  }
  // Replace what's there: go to the end and delete back over it.
  const old = focused.node.attrs.text ?? "";
  if (old && old !== focused.name) await shell("input", "keyevent", "KEYCODE_MOVE_END", ...Array(old.length).fill("KEYCODE_DEL"));
  if (value) await shell("input", "text", quoted(value));
  await sleep(400);
  // Leave the keyboard down, so it doesn't cover what the agent taps next.
  await hideKeyboard();
  return text(`Typed into ${ref}. Call snapshot to see the result.${await crashNote()}`);
}

async function swipe(direction: "up" | "down") {
  const size = (await shell("wm", "size")).match(/(\d+)x(\d+)/);
  const [w, h] = size ? [Number(size[1]), Number(size[2])] : [1080, 2400];
  const [from, to] = direction === "up" ? [0.7, 0.3] : [0.3, 0.7];
  await shell("input", "swipe", String(w / 2), String(Math.round(h * from)), String(w / 2), String(Math.round(h * to)), "300");
  await sleep(600);
  return text(`Swiped ${direction}. Call snapshot to see the result.${await crashNote()}`);
}

let launched = false;

async function launch() {
  const installed = await shell("pm", "path", PKG).catch(() => "");
  if (!installed.includes("package:")) throw new Error("BuggyShop is not installed. Run android/ci.sh, or adb install the APK.");
  // A crash should end in "not running", not in a system dialog over the screen.
  await shell("settings", "put", "global", "hide_error_dialogs", "1").catch(() => {});
  await shell("am", "force-stop", PKG);
  await shell("am", "start", "-W", "-n", `${PKG}/.MainActivity`, "--es", "BUGS", BUGS);
  await sleep(1000);
  seen = new Map();
  launched = true;
}

async function command(fn: () => Promise<ReturnType<typeof text>>) {
  try {
    if (!launched) await launch();
    return await fn();
  } catch (err) {
    return text(`adb error: ${(err as Error).message}`, true);
  }
}

const refArg = z.string().describe("Element ref from the latest `snapshot`, e.g. e5");

const server = new McpServer({ name: "webprobe-android", version: "0.1.0" });

server.registerTool(
  "launch_app",
  {
    title: "Launch app",
    description: "Restart the app from its first screen. Use it after a crash, or to start over.",
    inputSchema: {},
  },
  async () => command(async () => {
    await launch();
    return text("Launched BuggyShop. Call snapshot to see the first screen.");
  }),
);

server.registerTool(
  "snapshot",
  {
    title: "Screen snapshot",
    description:
      "Return the current screen as an accessibility tree (element kinds, names, values). Each element " +
      "you can act on has a ref like [ref=e5]; pass it to `tap` or `type`. Refs are only valid until the " +
      "screen changes. Elements with no accessibility name show as (no label). If the app crashed, it says so.",
    inputSchema: {},
  },
  async () => command(async () => text(await snapshot())),
);

server.registerTool(
  "tap",
  {
    title: "Tap",
    description: "Tap the element with this ref (buttons, list items, tabs, chips).",
    inputSchema: { ref: refArg },
  },
  async ({ ref }) => command(() => tap(ref)),
);

server.registerTool(
  "type",
  {
    title: "Type",
    description: "Tap a text field and replace its text with `text`.",
    inputSchema: { ref: refArg, text: z.string() },
  },
  async ({ ref, text: value }) => command(() => type(ref, value)),
);

server.registerTool(
  "swipe",
  {
    title: "Swipe",
    description: "Scroll the screen: `up` shows what's further down, `down` goes back up.",
    inputSchema: { direction: z.enum(["up", "down"]) },
  },
  async ({ direction }) => command(() => swipe(direction)),
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
      const { stdout } = await run(ADB, ["exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 << 20 });
      return { content: [{ type: "image" as const, data: stdout.toString("base64"), mimeType: "image/png" }] };
    } catch (err) {
      return text(`adb error: ${(err as Error).message}`, true);
    }
  },
);

await server.connect(new StdioServerTransport());
log("ready; adb at", ADB);
