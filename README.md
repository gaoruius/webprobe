# WebProbe

A front-end QA agent that explores a web app in a real browser, finds bugs, and files
structured bug reports — plus an eval suite that measures how well (and how reliably) it does.

> Status: **week 3.** The test site, the browser tool server, the agent loop (Claude, Gemini or
> open models on Groq), the eval scorer and a run viewer all work. On the 10-bug site, Claude
> Opus 5.5 found every bug in all 3 runs (~$0.55 a run), Haiku 5.5 found 87% for 2 cents, and
> Sonnet 5.5 only 57% because it stops early. No false positives on the buggy site, one in two
> runs on the clean site, and three real bugs nobody seeded ([Results](#results)).

## Layout

```
webprobe/
├── buggyshop/            Next.js shop with seeded, switchable bugs (the eval target)
│   ├── lib/bugs.ts       bug switches (NEXT_PUBLIC_BUGS)
│   └── bugs.manifest.json  ground truth for the eval — the agent never sees it
├── browser-mcp/          MCP server: the agent's only way to touch the browser
│   ├── src/server.ts     tools: navigate, snapshot, click, type, console_errors, network_errors
│   └── src/smoke-test.ts scripted run that reproduces every v0.1 bug through the tools
├── agent/                hand-written agent loop (MCP client + model providers)
│   ├── src/agent.ts      the loop: budgets, stuck detection, wrap-up turns
│   ├── src/providers/    claude.ts, gemini.ts, groq.ts behind one small interface
│   ├── src/tools.ts      report_bug and finish, the agent's own tools
│   ├── src/run.ts        one run against BuggyShop → runs/<time>/report.json + screenshots
│   └── src/eval.ts       scores runs against the manifest (tests in test/)
└── viewer/               Next.js app to browse runs: scores, bug reports, step timeline
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

```bash
# 3. the agent: put one of ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY in agent/.env
cd agent && npm install && npm start
#    provider: WEBPROBE_PROVIDER=claude|gemini|groq (default: the first one with a key)
#    model:    WEBPROBE_MODEL (defaults: claude-opus-5-5, gemini-3.8-flash, openai/gpt-oss-120b)
#    budgets:  WEBPROBE_MAX_STEPS (40), WEBPROBE_MAX_COST_USD (2), WEBPROBE_EFFORT (medium)
#    prompt:   WEBPROBE_PROMPT=budget  (tell the model its step budget; see Results)
#    against the clean site, tell the eval: WEBPROBE_LIVE_BUGS=none npm start

# 4. score runs
npm run eval -- runs/<dir> runs/<dir> ...           # recall, precision, false positives
npm test                                           # tests for the scorer

# 5. browse runs
cd viewer && npm install && npm run dev            # http://localhost:3001
```

If `npx playwright install` can't download Chromium, use your installed Chrome:
`WEBPROBE_BROWSER_CHANNEL=chrome npm run smoke`.

### Use it from an MCP host

`browser-mcp` is a standard stdio MCP server: register it with command `npx tsx src/server.ts`
(working directory `browser-mcp/`), then ask the host to explore http://localhost:3000.
So far it has been exercised by `smoke-test.ts` through the MCP client SDK, not yet from a desktop host.

## Seeded bugs

| id | category | page | what's wrong |
|---|---|---|---|
| `cart-zero-qty` | functional | /cart | qty → 0 keeps the item; total unchanged |
| `signup-email-validation` | validation | /signup | accepts `not-an-email` |
| `product-img-alt` | a11y | / | product images have no alt text |
| `coupon-500-silent` | network | /cart | coupon API returns 500, page shows nothing |
| `reviews-tab-typeerror` | console | /product/* | Reviews tab throws TypeError, never opens |

Added in v0.2, deeper in the site and needing more steps or some arithmetic to spot:

| id | category | page | what's wrong |
|---|---|---|---|
| `search-case-sensitive` | functional | / | search for "mug" finds nothing; "Mug" works |
| `sort-price-string` | functional | / | "Price: low to high" gives $14, $39, $9 (compares text) |
| `checkout-free-shipping` | functional | /checkout | $53 of items still pays $5 shipping (checks item count, not price) |
| `checkout-zip-unlabeled` | a11y | /checkout | ZIP code field has no accessible name |
| `order-link-404` | network | /checkout, /order/* | "View order" after placing an order goes to a 404 |

A bug's `page` can be a list when it can fairly be reported from more than one page. Runs record
the exact bugs that were live, so runs from v0.1 still score out of 5.

## Browser MCP server

| tool | notes |
|---|---|
| `navigate(url)` | only origins in `WEBPROBE_ALLOWED_ORIGINS` (default `http://localhost:3000`) |
| `snapshot()` | accessibility tree with element refs (`[ref=e5]`, `[ref=f2e16]` after navigation), capped by `WEBPROBE_MAX_SNAPSHOT_CHARS`; images with no accessible name are listed separately |
| `click(ref)` | click the element with that ref |
| `type(ref, text, submit?)` | replace a field's value; optionally press Enter |
| `console_errors()` | console errors/warnings + uncaught exceptions since the last call |
| `network_errors()` | failed, 4xx/5xx and blocked requests since the last call |
| `screenshot()` | PNG of the visible page. The agent hides it from the model and takes one itself for each bug filed |

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

## Agent loop

Written by hand instead of with a framework or the SDK's tool runner, so every decision is visible:

- **Any model.** The loop talks to a small `Provider` interface; `providers/claude.ts`,
  `gemini.ts` and `groq.ts` own each API's message format. The MCP tools don't change at all.
- **Two kinds of tools.** Browser tools come from the MCP server (`tools/list` maps almost 1:1
  onto model tool definitions). `report_bug` and `finish` run in the agent process: they are
  how results come back, so the bug list is structured data, not prose to parse.
- **Hard stops.** A step budget and a dollar budget, computed from the API's token usage.
  Three steps before the end the agent is told to file what it has and finish. After the last
  step it gets up to five report-only turns (browser tools disabled), so a model that explores
  to the very end still files what it saw.
- **Stuck detection.** The same call three times in a row gets a note telling it to change course.
- **History: append-only, except where it can't be.** Claude and Gemini get the history
  exactly as it happened: that keeps the prompt cache valid, and both reject edited history
  that carries their signed reasoning. Groq's free tier allows ~8K tokens a minute, so the Groq
  provider masks all but the last two tool results. The cost shows up in the runs: by the time
  the model writes its reports, the snapshot that showed the bug may already be masked.
- **Failures keep results.** Dropped connections and per-minute rate limits are retried; a
  daily quota stops the run at once. A run that fails still writes what it found.
- **Least privilege.** The MCP server process does not get the API key.
- **Generic prompt.** The system prompt describes how a QA engineer works, not the seeded bugs.
  Naming them would score well here and teach nothing about other sites.

## Eval

`bugs.manifest.json` gives each seeded bug a `match` regex. A report finds a bug when it is on
the bug's page (`*` and route parameters match any one segment) and the regex hits its title, actual or evidence; each bug counts once, further
reports of it are duplicates. A report of a real defect that was *not* seeded, once a person
has confirmed it in the code, goes in the manifest's `extras`: it counts as correct for
precision and stays out of recall. Extras match on a report's page and title only, because
evidence often shows other problems on the same page. Anything else is a false positive (on the clean site, every
report but extras). Keyword matching is crude, so false positives are listed for a human to
check rather than trusted. The agent never sees the manifest, and BuggyShop exposes no way to read it.

## Results

### v0.2: 10 bugs

Three Claude models, 40-step budget, BuggyShop with all 10 bugs on, 3 runs each:

| | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| recall (mean) | 87% (90, 70, 100) | 57% (50, 60, 60) | **100%** (every run) |
| precision | 100% | 100% | 100% |
| steps per run | 36–38 | **10–16** | 36–38 |
| time per run | ~1.5 min | ~35 s | ~2 min |
| cost per run | **~$0.02** | ~$0.08 | ~$0.55 |

| bug | Haiku | Sonnet | Opus |
|---|---|---|---|
| `cart-zero-qty` | 3/3 | 3/3 | 3/3 |
| `coupon-500-silent` | 3/3 | 3/3 | 3/3 |
| `reviews-tab-typeerror` | 3/3 | 3/3 | 3/3 |
| `signup-email-validation` | 1/3 | 3/3 | 3/3 |
| `product-img-alt` | 2/3 | **0/3** | 3/3 |
| `search-case-sensitive` | 3/3 | **0/3** | 3/3 |
| `sort-price-string` | 3/3 | 3/3 | 3/3 |
| `checkout-free-shipping` | 3/3 | **0/3** | 3/3 |
| `checkout-zip-unlabeled` | 2/3 | 2/3 | 3/3 |
| `order-link-404` | 3/3 | **0/3** | 3/3 |

The cheapest model beat the middle one. Sonnet stops after 10–16 of its 40 steps, and its
summaries say so ("I did not test checkout or search"), so it never reaches the bugs deeper in
the site. Haiku and Opus use nearly the whole budget. On this kind of task, how long a model
keeps exploring matters as much as how well it reasons, and one run per model would not have
shown it: Sonnet misses the same four bugs every time.

Is it the budget or the model? Steps undersell the gap: Sonnet makes ~3 tool calls per step, but
it still takes about 20 browser actions (navigate, click, type) per run where Haiku and Opus take
45–50. A prompt variant (`WEBPROBE_PROMPT=budget`) tells the model its step budget and asks it to
list what it has not tested before finishing. With it, Sonnet takes 14–18 steps and recall goes
from 57% to **67%** (70, 60, 70; 3 runs, $0.10 a run). It now always tests search and sort, but it
still writes "I did not test checkout" and calls finish anyway, so `order-link-404` stays at 0/3.

### v0.1: 5 bugs

Same setup with the first 5 bugs:

| | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|
| recall (mean) | 73% (80, 60, 80) | 80% (80, 80, 80) | **100%** (every run) |
| precision | 100% | 100% | 100% |
| cost per run | ~$0.01 | ~$0.06 | ~$0.38 |

Sonnet never checked alt text (0/3); Opus also tried negative and fractional quantities, an empty
coupon, a product that does not exist and a reload. Haiku's prompt caching turned ~94% of input
tokens into cache reads.

On the v0.1 clean site (every seeded bug off), Haiku, 2 runs: **5 reports, 1 false positive** (an empty
coupon code gets "not valid" and a server round trip, which is arguably fine). The other 4 were
real defects that were not seeded, including a third one found only here: after a valid coupon,
an invalid one shows an error but leaves the old discount in the total.

Two things the runs showed:
- **Agents overstate their coverage.** One run's summary says it tested an invalid email; its
  tool calls show it never typed one, and that run missed the signup bug. The eval reads tool
  calls and reports, never the summary.
- **The eval needs checking too.** The first scoring pass credited "accepts 2.5 mugs" as the
  zero-quantity bug (the pattern only asked for "quantity"), and an earlier one called a correct
  report a false positive because the manifest pinned a bug to one product page when it is on
  all of them. Both were fixed in the manifest, with a test for each.

### First runs on free tiers

Against BuggyShop with all 5 bugs on:

| model | steps | found | what happened |
|---|---|---|---|
| gemini-3.8-flash | 17 | 1 (`reviews-tab-typeerror`, step 14) | hit the free tier's 20 requests/day; the report was lost to the crash, which is why runs now save what they have on failure |
| openai/gpt-oss-120b (Groq) | 40 | 0 | saw the coupon 500 in `console_errors`, never filed it; ignored the 3-steps-left note |
| openai/gpt-oss-120b (Groq) | 41 | 0 | set a quantity to 0 and saw the item stay at `Total: $28.00`; ended with "no issues found" |
| qwen/qwen3.8-27b (Groq) | 19 | 0 | one reply needed more than the free tier's 1,000 output tokens a minute |
| gemini-3.5-flash-lite (15-step budget to fit the daily quota) | 16 | 1 (`reviews-tab-typeerror`), 0 false positives | finished on its own in 17 s; reported the bug on /product/notebook as `/product/[id]` |

The lite run also caught a bug in the ground truth: the manifest pinned the reviews bug to
/product/mug, but it lives in a component every product page uses. Manifest pages now take
`*` segments, and a report's route parameters (`[id]`, `:id`) match any segment.

What they show: the plumbing holds up across three APIs, but the open models on Groq saw bug
evidence and did not recognise it as a bug.

## Roadmap

- [x] BuggyShop with 5 switchable bugs + ground-truth manifest
- [x] MCP server: `navigate`, `snapshot`, origin allowlist, smoke test
- [x] tools: `click`, `type`, `console_errors`, `network_errors`; network-level origin blocking
- [x] tool: `screenshot`, attached to every bug report
- [x] agent loop (hand-written) with step/cost budgets and stuck detection
- [x] `BugReport` schema (zod) for structured output
- [x] providers: Claude, Gemini, Groq
- [x] eval scorer (recall, precision, duplicates, false positives) with tests
- [x] run viewer
- [x] first runs on free tiers
- [x] 3 runs each on Claude Haiku, Sonnet and Opus 5.5: recall 73% / 80% / 100%, precision 100%
- [x] 5 harder bugs (search, sort, checkout, order page); same 3 models: 87% / 57% / 100%
- [x] false-positive runs on the clean build: 1 false positive in 2 runs
- [ ] keep bug evidence when old tool results are masked (e.g. a notes tool)
- [ ] 35 bugs + 10 clean pages + 3 prompt-injection pages; dev/test split
- [ ] eval runner: recall, precision, pass^k, injection resistance, cost per run
- [ ] tracing (Langfuse) and a trace-replay UI
