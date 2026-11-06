# WebProbe

A front-end QA agent that explores a web app in a real browser, finds bugs, and files
structured bug reports — plus an eval suite that measures how well (and how reliably) it does.

> Status: **week 2.** The test site and the browser tool server work — a scripted run through the
> MCP tools reproduces all 5 seeded bugs. The agent loop and eval runner come next.

## Layout

```
webprobe/
├── buggyshop/            Next.js shop with seeded, switchable bugs (the eval target)
│   ├── lib/bugs.ts       bug switches (NEXT_PUBLIC_BUGS)
│   └── bugs.manifest.json  ground truth for the eval — the agent never sees it
└── browser-mcp/          MCP server: the agent's only way to touch the browser
    ├── src/server.ts     tools: navigate, snapshot, click, type, console_errors, network_errors
    └── src/smoke-test.ts scripted run that reproduces every seeded bug through the tools
```

## Run it

```bash
# 1. the test site (all bugs on)
cd buggyshop && npm install && npm run dev        # http://localhost:3000
#    clean site for false-positive runs:  npm run dev:clean
#    a subset:  NEXT_PUBLIC_BUGS=cart-zero-qty,coupon-500-silent npx next dev -p 3000

# 2. the browser MCP server (in another terminal)
cd browser-mcp && npm install && npx playwright install chromium
npm run smoke                                      # 16 checks; exits 1 if any fail
```

If `npx playwright install` can't download Chromium, use your installed Chrome:
`WEBPROBE_BROWSER_CHANNEL=chrome npm run smoke`.

### Use it from an MCP host

`browser-mcp` is a standard stdio MCP server: register it with command `npx tsx src/server.ts`
(working directory `browser-mcp/`), then ask the host to explore http://localhost:3000.
So far it has been exercised by `smoke-test.ts` through the MCP client SDK, not yet from a desktop host.

## Seeded bugs (v0.1)

| id | category | page | what's wrong |
|---|---|---|---|
| `cart-zero-qty` | functional | /cart | qty → 0 keeps the item; total unchanged |
| `signup-email-validation` | validation | /signup | accepts `not-an-email` |
| `product-img-alt` | a11y | / | product images have no alt text |
| `coupon-500-silent` | network | /cart | coupon API returns 500, page shows nothing |
| `reviews-tab-typeerror` | console | /product/mug | Reviews tab throws TypeError, never opens |

## Browser MCP server

| tool | notes |
|---|---|
| `navigate(url)` | only origins in `WEBPROBE_ALLOWED_ORIGINS` (default `http://localhost:3000`) |
| `snapshot()` | accessibility tree with element refs (`[ref=e5]`, `[ref=f2e16]` after navigation), capped by `WEBPROBE_MAX_SNAPSHOT_CHARS`; images with no accessible name are listed separately |
| `click(ref)` | click the element with that ref |
| `type(ref, text, submit?)` | replace a field's value; optionally press Enter |
| `console_errors()` | console errors/warnings + uncaught exceptions since the last call |
| `network_errors()` | failed, 4xx/5xx and blocked requests since the last call |

Design choices:
- **Rules live in the tool server, not the prompt.** Off-site requests are blocked at the
  network layer (`context.route`), so a click on an outside link can't leave the site either.
- **Small context.** Snapshots are accessibility trees, not HTML. The AI-mode tree drops images
  that have no accessible name, so `snapshot` lists those separately instead of losing them.
- **Errors go back to the model.** Tool failures return `isError` with a next step
  ("refs change whenever the page updates — call `snapshot`"), rather than throwing.
- **Wait for the page to settle.** After `click`/`type` the server waits until no request has
  been in flight for 300 ms (max 3 s), so `network_errors` sees requests the action started.
- Logs go to stderr because stdout carries the MCP protocol.

## Roadmap

- [x] BuggyShop with 5 switchable bugs + ground-truth manifest
- [x] MCP server: `navigate`, `snapshot`, origin allowlist, smoke test
- [x] tools: `click`, `type`, `console_errors`, `network_errors`; network-level origin blocking
- [ ] tool: `screenshot` (visual/layout bugs)
- [ ] agent loop (hand-written first) with step/cost budgets and stuck detection
- [ ] `BugReport` schema (zod) for structured output
- [ ] 35 bugs + 10 clean pages + 3 prompt-injection pages; dev/test split
- [ ] eval runner: recall, precision, pass^k, injection resistance, cost per run
- [ ] tracing (Langfuse) and a trace-replay UI
