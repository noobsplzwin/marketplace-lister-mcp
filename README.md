# fb-marketplace-mcp

An MCP server that **creates and publishes Facebook Marketplace listings from local photos** — cross-platform (Windows / macOS / Linux), using a dedicated Playwright browser profile.

Unlike cookie-scraping tools, this never touches your day-to-day Chrome or any OS keychain. You log in **once** in a dedicated browser window; the session persists in its own profile for all future runs.

## Why this exists

Most "Facebook Marketplace" tools are either macOS-only (they decrypt your Chrome cookies via the macOS Keychain) or read-only (search, no posting). This one **posts**, runs anywhere Playwright runs, and holds its own login instead of borrowing yours.

## Tools

| Tool | What it does |
|------|--------------|
| `fb_login` | Opens the dedicated browser to Facebook's login page and waits briefly for you to sign in. Idempotent: if already signed in, returns instantly; if you need more time, just call it again. You only ever type your password on Facebook's own page. |
| `fb_login_status` | Reports whether the dedicated profile is logged in, and where the profile lives. |
| `scan_items` | Scans a folder: each subfolder is one item, its images are that item's photos. Folders starting with `_` or `.` are skipped. |
| `search_comps` | Looks up what similar items are listed for and returns price ranges (min / p25 / median / p75 / max). **Reference only — it does not recommend a price.** |
| `create_listing` | Fills the create-item form (title, price, description, category, condition, photos) and advances to the review step, **stopping before publish**. Returns a screenshot of the review page to confirm. |
| `publish_listing` | Publishes the listing currently on the review step. Call only after confirming the screenshot. |
| `list_my_listings` | Opens your "Selling" page and returns current listings (text + screenshot) to verify Active vs. under review. |

## Install

Requires Node.js 18+.

```bash
git clone <this repo>
cd fb-marketplace-mcp
npm install        # also downloads Chromium
npm run build
```

## Register with Claude Code

```bash
claude mcp add fb-marketplace -- node /absolute/path/to/fb-marketplace-mcp/dist/index.js
```

Or add to a project `.mcp.json`:

```json
{
  "mcpServers": {
    "fb-marketplace": {
      "command": "node",
      "args": ["C:/path/to/fb-marketplace-mcp/dist/index.js"],
      "env": { "FB_MCP_CHANNEL": "chrome" }
    }
  }
}
```

## First run

1. Ask Claude to "log in to Facebook Marketplace" → it calls `fb_login`, a browser window opens.
2. Sign in on Facebook's page (including any 2FA). Say you're done → `fb_login` again confirms.
3. From then on it's automatic. The session is saved; you won't log in again unless Facebook expires it.

## Typical flow

Put each item's photos in its own folder:

```
C:\sell\
  ninja-air-fryer\   IMG_8387.jpg  IMG_8390.jpg
  office-chair\      IMG_9001.jpg  IMG_9002.jpg
```

> "Post everything in `C:\sell` to Marketplace."

Claude calls `scan_items`, writes a title and description per item, **asks you for each price**, calls `create_listing` with that item's folder (you see a review screenshot), and on your OK calls `publish_listing`.

One folder per item is the whole interface. You never handle individual file paths: `create_listing` takes `folder` and uploads every image inside it, sorted by filename, so the first photo alphabetically becomes the cover.

Photos must be **files on disk** — an image pasted into a chat window can't be forwarded to the browser.

## Pricing: you set it

**The seller supplies every price.** Neither the tools nor the model estimate one.

That's a deliberate retreat. An earlier version derived a suggested asking range from comps, and measured against real listings it was unreliable enough to cost money: a search for `rice cooker` medians around **$15** because entry-level units dominate those two words, while a premium micom cooker that sells for **$85** used sits in the very same results. Automated pricing quietly lowballs exactly the items worth the most.

`search_comps` still exists as **reference material** — run it when you want to see the local market before deciding — but it reports ranges and declines to recommend:

```
search_comps({ query: "instant pot" })
→ close_match_stats: { count: 14, min: 20, p25: 53, median: 88, p75: 119, max: 300 }
   all_active_stats: { count: 26, min: 20, p25: 50, median: 73, p75: 100, max: 300 }
   observation: "14 active listings matching the query containing \"instant\":
                 $20–$300, median $88 ... Generic search terms pull in
                 entry-level units, so this range can sit far below what a
                 premium brand or model is actually worth. Reference only —
                 the seller sets the price."
```

### Why there are two sets of stats

Facebook's search is fuzzy: `staub dutch oven` returns mostly generic cast iron. So results are split. `close_match_stats` covers listings whose titles genuinely match; `all_active_stats` covers everything returned. Matching weights **rare** query words above common ones (searching "staub dutch oven", the word `staub` decides, not `oven`), and the rarest term becomes an **anchor** a comp must contain. Without that rule, two mid-frequency words out-vote the brand and a *Le Creuset tote bag* shows up as a comp for a Staub cocotte — observed in real results.

Even with both filters the numbers stay indicative, not authoritative — hence the seller deciding.

Search tips: fewer words find more results. Start broad ("rice cooker"), add the model number only if results are plentiful. Substring matching means common misspellings ("Instapot") fall outside the anchored set.

## Configuration (env vars)

| Var | Default | Purpose |
|-----|---------|---------|
| `FB_MCP_PROFILE_DIR` | `~/.fb-marketplace-mcp/profile` | Where the dedicated login session is stored. |
| `FB_MCP_CHANNEL` | *(bundled Chromium)* | Set to `chrome` or `msedge` to use an installed browser. Recommended on Windows if bundled Chromium fails to launch (`spawn UNKNOWN`). |

## Notes & limits

- **You publish; the tool never auto-publishes.** `create_listing` always stops at review; publishing is a separate, explicit call.
- Facebook has no official personal-Marketplace write API. This drives the real web UI via a real browser session, which is the most robust and least suspicious approach — but Facebook UI changes can break selectors; update `src/listing.ts` if a field stops filling.
- New listings often show "being reviewed" for a few minutes before going Active. That's normal.
- If Facebook shows a checkpoint/CAPTCHA, complete it yourself in the window — the tool won't try to bypass it.
- Photos are read straight from disk (no size limit beyond Facebook's own).

## Design note: why the browser, not the GraphQL API

Facebook has no official personal-Marketplace write API, and its internal GraphQL `doc_id`s rotate with every frontend release. Worse, replaying a write mutation straight over HTTP is exactly the fingerprint their anti-abuse systems look for. So **publishing goes through the real browser session**. Reading (`search_comps`) also uses the rendered page — the result cards already carry price, title, location, and the Sold badge, so there's nothing to gain from reverse-engineering the API and a maintenance burden to avoid.

## Roadmap

- Category-aware depreciation priors layered on top of `search_comps`, for items too rare to have local comps.
