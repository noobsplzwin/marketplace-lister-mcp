#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { smoothLogin } from "./login.js";
import { isLoggedIn, profileDir, closeContext } from "./browser.js";
import { scanItems, fillListing, publishListing, postListing, listMine, photosInFolder } from "./listing.js";
import { searchComps } from "./comps.js";

const server = new McpServer({
  name: "marketplace-lister-mcp",
  version: "0.1.0",
});

const CONDITIONS = [
  "New", "Used - Like New", "Used - Good", "Used - Fair",
  "Nuevo", "Usado - Como nuevo", "Usado - Buen estado", "Usado - Aceptable",
] as const;

function img(buf: Buffer) {
  return { type: "image" as const, data: buf.toString("base64"), mimeType: "image/png" };
}
function text(s: string) {
  return { type: "text" as const, text: s };
}

server.tool(
  "fb_login",
  "Open the dedicated Facebook browser and sign in. If already signed in, returns instantly. Otherwise a real Facebook login page opens; the user completes login (and any 2FA) once, and the session is saved to a dedicated profile for all future runs. The user only ever types their password on Facebook's own page.",
  {},
  async () => {
    const r = await smoothLogin();
    return { content: [text(`${r.status}${r.account ? ` as ${r.account}` : ""}: ${r.message}`)] };
  }
);

server.tool(
  "fb_login_status",
  "Check whether the dedicated Facebook profile is currently logged in. Returns the profile directory path too.",
  {},
  async () => {
    const ok = await isLoggedIn().catch(() => false);
    return { content: [text(`logged_in: ${ok}\nprofile_dir: ${profileDir()}`)] };
  }
);

server.tool(
  "scan_items",
  "Scan a local folder for things to sell. Returns one of two modes. `grouped`: the folder has subfolders, each already one item, so pass its `folder` straight to create_listing. `ungrouped`: the folder holds loose photos, returned individually with timestamps, and YOU group them: view the images in the order returned (photos of one item are almost always consecutive, being the order they were shot in), decide where each item starts and ends, confirm the grouping with the seller, then call create_listing once per item with that item's paths in `photos`. Never treat a flat folder as a single item.",
  { folder: z.string().describe("Absolute path to the folder of photos, with or without per-item subfolders") },
  async ({ folder }) => {
    const items = scanItems(folder);
    return { content: [text(JSON.stringify(items, null, 2))] };
  }
);

server.tool(
  "search_comps",
  "Look up what similar items are listed for, as REFERENCE ONLY. Returns price ranges (min/p25/median/p75/max) for matching and loosely-matching listings. These numbers are NOT a price recommendation and must never be used to set or suggest a price on their own: Facebook's search is fuzzy, so generic terms pull in entry-level units and the median can land far below what a premium brand or model is worth. Show the numbers to the seller and let them decide. Results come from the account's own Marketplace location. Requires being logged in.",
  {
    query: z.string().describe("Search terms, e.g. 'Instant Pot 6 quart'. Fewer words find more comps; add the model number only if there are plenty of results."),
    min_price: z.number().optional(),
    max_price: z.number().optional(),
    days_since_listed: z.number().optional().describe("Limit to listings posted in the last N days (1, 7, or 30)"),
    sort_by: z.enum(["best_match", "price_ascend", "price_descend", "creation_time_descend", "distance_ascend"]).optional(),
    max_results: z.number().optional().describe("Cap on comps returned (default 40)"),
  },
  async ({ query, min_price, max_price, days_since_listed, sort_by, max_results }) => {
    if (!(await isLoggedIn())) {
      return { content: [text("Not logged in. Call fb_login first.")], isError: true };
    }
    const r = await searchComps({
      query,
      minPrice: min_price,
      maxPrice: max_price,
      daysSinceListed: days_since_listed,
      sortBy: sort_by,
      maxResults: max_results,
    });
    const brief = {
      anchor_term: r.anchor,
      query: r.query,
      searched_url: r.url,
      cards_seen: r.scanned,
      close_match_stats: r.closeStats,
      all_active_stats: r.activeStats,
      sold_stats: r.soldStats,
      observation: r.observation,
      pricing_note: "Reference data only. Do not set or suggest a price from these numbers — ask the seller for the price.",
      close_matches: r.close.map((c) => ({ price: c.price, title: c.title, location: c.location })),
      other_active: r.active
        .filter((c) => !r.close.includes(c))
        .map((c) => ({ price: c.price, title: c.title, relevance: Number((c.relevance ?? 0).toFixed(2)) })),
      sold: r.sold.map((c) => ({ price: c.price, title: c.title, location: c.location })),
    };
    return { content: [text(JSON.stringify(brief, null, 2))] };
  }
);

server.tool(
  "post_listing",
  "Fill AND publish in a single step, with no preview. Use this ONLY when the seller has explicitly said, in this conversation, that they do not need to see the filled-in form first. The default way to list something is create_listing (shows a screenshot of the filled form) followed by publish_listing after the seller approves that screenshot. Before either, show the seller the title, price and description in the message. The price must be the seller's own number, never an estimate.",
  {
    title: z.string(),
    price: z
      .union([z.string(), z.number()])
      .describe("The seller's own asking price. Ask them for it; do not infer, estimate, or derive it from comps."),
    description: z.string(),
    category: z.string().describe('Marketplace category exactly as the form shows it in the account\'s language. If it is wrong the error lists every valid one. English e.g. "Appliances", "Household"; Spanish e.g. "Electrodomésticos", "Hogar", "Muebles", "Venta de garaje", "Varios".'),
    condition: z.enum(CONDITIONS),
    folder: z.string().optional().describe("Folder holding this item's photos; every image in it is uploaded, sorted by filename."),
    photos: z.array(z.string()).optional().describe("Explicit photo paths (first is the cover), when picking specific files instead of a folder."),
  },
  async ({ title, price, description, category, condition, folder, photos }) => {
    if (!(await isLoggedIn())) {
      return { content: [text("Not logged in. Call fb_login first.")], isError: true };
    }
    let files: string[];
    try {
      files = photos?.length ? photos : photosInFolder(folder ?? "");
    } catch (e) {
      return { content: [text(`${e instanceof Error ? e.message : String(e)}\nPass either "folder" or "photos".`)], isError: true };
    }
    const { screenshot, url } = await postListing({ title, price, description, category, condition, photos: files });
    return {
      content: [
        text(`Published "${title}" at $${price} (${condition}, ${category}). Now at: ${url}`),
        img(screenshot),
      ],
    };
  }
);

server.tool(
  "create_listing",
  "The normal way to list something. Fills the form and stops on it, BEFORE clicking Next, WITHOUT publishing, returning a screenshot of the filled form and Facebook's preview. Show that screenshot to the seller and wait for their explicit approval, then call publish_listing in the same session (the draft lives only in the open browser and is lost if it closes). Before calling this, show the seller the title, price and description you propose. The price must come from the seller.",
  {
    title: z.string(),
    price: z
      .union([z.string(), z.number()])
      .describe("The seller's own asking price. Ask them for it; do not infer, estimate, or derive it from comps."),
    description: z.string(),
    category: z.string().describe('Marketplace category as the form shows it, e.g. "Appliances" / "Electrodomésticos", "Household" / "Hogar", "Furniture" / "Muebles"'),
    condition: z.enum(CONDITIONS),
    folder: z
      .string()
      .optional()
      .describe("Folder holding this item's photos; every image in it is uploaded, sorted by filename. Simplest option — prefer this over listing paths one by one."),
    photos: z
      .array(z.string())
      .optional()
      .describe("Explicit photo paths (first is the cover). Only needed when picking specific files instead of a whole folder."),
  },
  async ({ title, price, description, category, condition, folder, photos }) => {
    if (!(await isLoggedIn())) {
      return { content: [text("Not logged in. Call fb_login first.")], isError: true };
    }
    let files: string[];
    try {
      files = photos?.length ? photos : photosInFolder(folder ?? "");
    } catch (e) {
      return { content: [text(`${e instanceof Error ? e.message : String(e)}\nPass either "folder" or "photos".`)], isError: true };
    }
    const shot = await fillListing({ title, price, description, category, condition, photos: files });
    return {
      content: [
        text(`Draft ready for review: "${title}" — $${price} (${condition}, ${category}). Review the screenshot, then call publish_listing to publish, or discard by navigating away.`),
        img(shot),
      ],
    };
  }
);

server.tool(
  "publish_listing",
  "Publish the draft left by create_listing: clicks Next, then Publish. Call ONLY after the seller has seen the create_listing screenshot and explicitly approved publishing it. Returns the resulting URL.",
  {},
  async () => {
    const url = await publishListing();
    return { content: [text(`Published. Now at: ${url}`)] };
  }
);

server.tool(
  "list_my_listings",
  "Open the seller 'Selling' page and return the current listings as text plus a screenshot. Useful to verify what is Active vs. under review.",
  {},
  async () => {
    const { text: t, screenshot } = await listMine();
    return { content: [text(t.slice(0, 4000)), img(screenshot)] };
  }
);

process.on("SIGINT", async () => {
  await closeContext();
  process.exit(0);
});
process.on("SIGTERM", async () => {
  await closeContext();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("marketplace-lister-mcp running on stdio");
