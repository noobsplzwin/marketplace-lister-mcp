# marketplace-lister-mcp

**Sell your stuff on Facebook Marketplace by talking to Claude.** Drop each item's photos into a folder, and Claude writes the listing, fills out the Marketplace form for you, and shows you a preview. Nothing goes public until you say so. It signs into Facebook in its own browser window, so it never touches the Chrome you use every day.

## Install

Two commands inside Claude Code:

```
/plugin marketplace add noobsplzwin/marketplace-lister-mcp
/plugin install marketplace-lister@marketplace-lister-mcp
```

You need [Node.js](https://nodejs.org) 18 or newer, and Chrome or Edge. Nothing to download, build, or configure by hand.

## Sign in once

Tell Claude:

> Log in to Facebook Marketplace

A browser window opens on Facebook's own login page. Sign in there like you normally would, including any code sent to your phone. That's it, forever. Claude never sees or asks for your password, and your login is saved in a private window that has nothing to do with your regular Chrome.

## A full example: selling a board game

Say you're selling your copy of Wingspan. Take a few photos and put them in a folder of their own:

```
Desktop/sell/
    wingspan/
        IMG_4821.jpg     the box, front on
        IMG_4822.jpg     the pieces laid out
        IMG_4823.jpg     the cards and score pads
```

Then tell Claude:

> Post everything in Desktop/sell to Marketplace

Claude looks in the folder, sees one item, and looks at the photos:

> Found 1 item with 3 photos: Wingspan, the board game.
> Two things before I write it up: what are you asking, and is everything in the box?

> $50, all the pieces are there, we played it maybe five times.

It writes the listing and shows you exactly what will be posted:

```
Title         Wingspan Board Game — Excellent Condition, All Pieces Included
Price         $50
Category      Toys & Games
Condition     Used - Like New

Description   Selling my copy of Wingspan, the bird-themed engine builder that
              won the Kennerspiel des Jahres. Played about five times, so the
              cards and box are still in great shape.

              Everything is included: the egg tray, all 170 bird cards, food
              tokens, dice tower and score pads. Nothing missing.

              Pickup downtown. Cash only.
```

You get a screenshot of the real Marketplace page, filled in and ready. Look it over:

> Change the pickup to the east end and publish it

Done. Two messages, and it's live.

**Selling ten things at once works the same way.** Give each item its own folder inside `Desktop/sell`, then say "post everything in Desktop/sell". Claude goes item by item, asks you the price for each, and shows you every preview before posting it.

## What stays in your hands

- **You set every price.** Claude never guesses one or quietly picks a number. It asks, every time. (If you want to see what similar things are going for first, ask, and it will look up local listings and show you the range. It won't tell you what to charge.)
- **Nothing publishes without you.** Claude always stops at the preview and waits.
- **You sign into Facebook yourself.** Claude never asks for your password and can't accept one.

## Good to know

- **Photos have to be real files in a folder.** An image pasted into the chat window can't be uploaded to Facebook.
- The first photo in the folder, alphabetically, becomes the cover photo.
- New listings often say "being reviewed" for a few minutes before going live. That's Facebook, not a problem.
- If Facebook shows a security check or CAPTCHA, finish it yourself in the window. Claude won't try to get around it.
- If a browser window won't open, install Google Chrome, or run `npx playwright install chromium` once.

## Which marketplaces

Facebook Marketplace today. Kijiji and Craigslist are planned, and the design keeps them side by side rather than replacing each other.

## Tools reference

For the curious. You never call these by name; Claude picks them.

| Tool | What it does |
|------|--------------|
| `fb_login` | Opens the private browser window at Facebook's login page and waits for you to sign in. Returns straight away if you're already signed in. |
| `fb_login_status` | Says whether you're currently signed in. |
| `scan_items` | Reads a folder and treats each subfolder as one item for sale. |
| `search_comps` | Looks up what similar items are listed for nearby and reports the price range. Reference only; it never recommends a price. |
| `create_listing` | Fills in the Marketplace form and stops at the preview, returning a screenshot. |
| `publish_listing` | Publishes the previewed listing. Runs only after you approve. |
| `list_my_listings` | Shows your current listings and whether they're live yet. |

Settings, if you ever need them: `FB_MCP_PROFILE_DIR` moves where your login is stored, `FB_MCP_CHANNEL` picks a specific browser (`chrome` or `msedge`).
