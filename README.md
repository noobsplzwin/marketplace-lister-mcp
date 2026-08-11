# marketplace-lister-mcp

**Sell your stuff on Facebook Marketplace by talking to Claude.** Point it at a folder of photos, or just photograph the thing from your phone, and Claude works out what each item is, writes the listing and fills out the Marketplace form for you. Nothing goes public until you approve the wording. It signs into Facebook in its own browser window, so it never touches the Chrome you use every day.

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

## Two ways to list something

Both start the same way: you show Claude the photos and say what you want for the item. It works out what the thing is, writes the listing, and shows you the wording. Nothing is posted until you say go.

### 1. Photos already on your computer

Photograph everything you want to sell and drop the photos into one folder. No sorting, no renaming, no subfolders:

```
Desktop/sell/
    IMG_4821.jpg
    IMG_4822.jpg
    IMG_4823.jpg
    IMG_4824.jpg
    IMG_4825.jpg
    IMG_4826.jpg
    IMG_4827.jpg
```

Then tell Claude:

> List everything in Desktop/sell on Marketplace

Claude looks at every photo and works out where one item ends and the next begins:

> I see three things here:
>
> 1. Wingspan board game (photos 1-3): box, pieces laid out, cards and score pads
> 2. A KitchenAid stand mixer in red (photos 4-5)
> 3. A pair of Blundstone boots (photos 6-7)
>
> Sound right? And what are you asking for each?

> Yes. $50 for Wingspan, $200 for the mixer, $90 for the boots. Boots are size 8, worn one winter.

It writes all three listings and shows you each one before anything is posted:

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

> Looks good, post them

Each one goes up as you approve it. Three items, a handful of messages, and you never opened Facebook yourself.

**If Claude groups something wrong**, just say so: "photos 4 and 5 are two different mixers" or "the last photo goes with the boots". It regroups and carries on.

**Prefer to sort them yourself?** Put each item in its own subfolder and Claude will use your grouping as-is instead of guessing.

### 2. Photograph it with your phone

You don't have to move files around at all. Open Claude Code on your phone, at [claude.ai/code](https://claude.ai/code), and it drives the session on your computer.

Stand in front of the thing you're selling, take the photos right there in the conversation, and say:

> Sell this on Marketplace, $80

The photos land on your computer as ordinary files, so Claude reads them, identifies the item, writes the listing and shows you the wording. Reply "post it" and it's live, without you touching a keyboard.

This is the fastest way to clear out a room: photograph, price, approve, next.

Your computer does need to be awake with Claude Code running, since the phone is a remote control for the session on your machine rather than a separate app.

## What stays in your hands

- **You set every price.** Claude never guesses one or quietly picks a number. It asks, every time. (If you want to see what similar things are going for first, ask, and it will look up local listings and show you the range. It won't tell you what to charge.)
- **Nothing publishes without you.** Claude always stops at the preview and waits.
- **You sign into Facebook yourself.** Claude never asks for your password and can't accept one.

## Good to know

- Photos taken or attached in the conversation are saved on your computer automatically, so the phone route needs no folder at all.
- Grouping works best when you shoot one item at a time, since Claude reads the photos in order and looks for where the subject changes. Photograph the mixer, then the boots, not alternating.
- The first photo of each item becomes the cover photo, so lead with the clearest full view.
- **Posting from a folder you've used before?** Ask Claude to check what you already have listed first. It can read your Selling page, and photos tend to linger in a folder long after the thing sold.
- New listings often say "being reviewed" for a few minutes before going live. That's Facebook, not a problem.
- If Facebook shows a security check or CAPTCHA, finish it yourself in the window. Claude won't try to get around it.
- If a browser window won't open, install Google Chrome, or run `npx playwright install chromium` once.

## Coming later

**Suggested prices from the local market.** Right now you name every price. Claude can look up what similar things are going for if you ask, but it stops short of recommending a number, and that is deliberate: an early version did suggest prices and got it wrong in the expensive direction. Searching "rice cooker" turns up mostly $10 units, so it would happily have talked you into selling a $150 cooker for $15. Doing this properly means reading condition and brand off the photos, and weighting what actually sold over what people are merely asking. Until it can do that, the number stays yours.

**Kijiji, then Craigslist.** One folder of photos, posted to several sites in one go, without writing the listing three times.

## Tools reference

For the curious. You never call these by name; Claude picks them.

| Tool | What it does |
|------|--------------|
| `fb_login` | Opens the private browser window at Facebook's login page and waits for you to sign in. Returns straight away if you're already signed in. |
| `fb_login_status` | Says whether you're currently signed in. |
| `scan_items` | Reads a folder. Subfolders are treated as ready-made items; loose photos come back individually for Claude to group by looking at them. |
| `search_comps` | Looks up what similar items are listed for nearby and reports the price range. Reference only; it never recommends a price. |
| `post_listing` | Uploads the photos, fills the form, checks the page really shows your title and price, and publishes. Runs only after you've approved the wording. |
| `create_listing` | Fills the form and stops at the preview instead of posting, if you'd rather see the page first. |
| `publish_listing` | Publishes a listing left at the preview by `create_listing`. |
| `list_my_listings` | Shows your current listings and whether they're live yet. |

Settings, if you ever need them: `FB_MCP_PROFILE_DIR` moves where your login is stored, `FB_MCP_CHANNEL` picks a specific browser (`chrome` or `msedge`).
