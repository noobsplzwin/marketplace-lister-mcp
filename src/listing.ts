import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { getPage } from "./browser.js";

const CREATE_URL = "https://www.facebook.com/marketplace/create/item";
const SELLING_URL = "https://www.facebook.com/marketplace/you/selling";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

/**
 * Form labels per UI language. Facebook renders the create form in the
 * account's language, so every label is tried in each language in turn.
 */
const UI = {
  title: ["Title", "Título"],
  price: ["Price", "Precio"],
  description: ["Description", "Descripción"],
  category: ["Category", "Categoría"],
  condition: ["Condition", "Estado"],
  moreDetails: ["More details", "Más detalles"],
  next: ["Next", "Siguiente"],
  publish: ["Publish", "Publicar"],
} as const;

/** Each condition as Facebook names it in English and in Spanish. */
const CONDITION_ALIASES: string[][] = [
  ["New", "Nuevo"],
  ["Used - Like New", "Usado - Como nuevo"],
  ["Used - Good", "Usado - Buen estado"],
  ["Used - Fair", "Usado - Aceptable"],
];

function conditionCandidates(condition: string): string[] {
  const hit = CONDITION_ALIASES.find((a) => a.some((x) => x.toLowerCase() === condition.toLowerCase()));
  return hit ?? [condition];
}

/** First locator among `label:has-text(<name>) <tag>` that exists on the page. */
async function labelled(page: Page, names: readonly string[], tag: string, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (true) {
    for (const n of names) {
      const loc = page.locator(`label:has-text("${n}") ${tag}`).first();
      if ((await loc.count()) > 0) return loc;
    }
    if (Date.now() > deadline) throw new Error(`Form field not found: ${names.join(" / ")}`);
    await page.waitForTimeout(500);
  }
}

/**
 * A button whose whole visible text is exactly one of `names`. Exact on
 * purpose: a substring match on "Publicar" also hits the paid "Promocionar
 * tras publicar" toggle.
 */
function exactButton(page: Page, names: readonly string[]) {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(${names.map(esc).join("|")})\\s*$`);
  return page.locator("div[role=button]").filter({ hasText: re }).first();
}

/** Click the first visible button whose text is exactly one of `names`. */
async function clickButton(page: Page, names: readonly string[], timeout = 10000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (true) {
    const loc = exactButton(page, names);
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      await loc.click({ timeout });
      return true;
    }
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(500);
  }
}

/** "15000", "15.000", "$ 15.000" all match a price of 15000 regardless of separators. */
export function priceAppears(text: string, price: string | number): boolean {
  const digits = String(price).replace(/[.,](\d{1,2})$/, "").replace(/\D/g, "");
  if (!digits) return true;
  const re = new RegExp(`(^|\\D)${digits.split("").join("[.,\\s\\u00a0\\u202f]?")}(\\D|$)`);
  return re.test(text);
}

export interface ScannedItem {
  folder: string;
  name: string;
  photos: string[];
}

export interface LoosePhoto {
  path: string;
  name: string;
  /** File modification time, ISO 8601. Photos of one item usually cluster. */
  modified: string;
  /**
   * Seconds between this photo and the previous one, null for the first.
   * Can be negative when files are not in chronological order, which is itself
   * a boundary signal: an older photo appearing mid-run came from another batch.
   */
  secondsAfterPrevious: number | null;
}

export type ScanResult =
  | { mode: "grouped"; folder: string; items: ScannedItem[] }
  | { mode: "ungrouped"; folder: string; photos: LoosePhoto[]; hint: string };

const UNGROUPED_HINT =
  "These photos are not sorted into items yet. Read them in the order given: " +
  "photos of the same item are almost always consecutive, since that is the " +
  "order they were taken in. Decide where one item ends and the next begins, " +
  "confirm the grouping with the seller, then call create_listing once per " +
  "item passing that item's photo paths in `photos`. A large jump in " +
  "secondsAfterPrevious, in either direction, marks a break between batches " +
  "and often a new item. Timestamps are only a hint though: copying a folder " +
  "resets them all to the same second. The images decide.";

function collect(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Scan a folder of things to sell.
 *
 * Subfolders present: each one is an item, already grouped by the seller.
 * Only loose images: they are returned individually so the model can look at
 * them and work out which photos belong to which item. Returning them as one
 * item would silently merge a whole moving sale into a single listing.
 */
export function scanItems(root: string): ScanResult {
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."));

  if (subdirs.length > 0) {
    return {
      mode: "grouped",
      folder: root,
      items: subdirs.map((d) => {
        const dir = path.join(root, d.name);
        return { folder: dir, name: d.name, photos: collect(dir) };
      }),
    };
  }

  const files = collect(root);
  if (files.length === 0) throw new Error(`No images or item subfolders in ${root}`);

  let prev: number | null = null;
  const photos: LoosePhoto[] = files.map((p) => {
    const ms = fs.statSync(p).mtimeMs;
    const gap = prev === null ? null : Math.round((ms - prev) / 1000);
    prev = ms;
    return {
      path: p,
      name: path.basename(p),
      modified: new Date(ms).toISOString(),
      secondsAfterPrevious: gap,
    };
  });

  return { mode: "ungrouped", folder: root, photos, hint: UNGROUPED_HINT };
}

export interface ListingInput {
  title: string;
  price: string | number;
  description: string;
  category: string; // e.g. "Appliances", "Household"
  condition: string; // "New" | "Used - Like New" | "Used - Good" | "Used - Fair"
  photos: string[]; // absolute paths
}

/** Every image in a folder, sorted. Lets callers pass a folder instead of paths. */
export function photosInFolder(folder: string): string[] {
  if (!fs.existsSync(folder)) throw new Error(`Folder not found: ${folder}`);
  const files = fs
    .readdirSync(folder)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(folder, f));
  if (files.length === 0) throw new Error(`No images in ${folder}`);
  return files;
}

/**
 * Open the create form, waiting for the form itself rather than the URL.
 *
 * Facebook bounces this route back to the Marketplace feed fairly often, and
 * does so persistently once you have opened it many times in quick succession.
 * Back off between tries, and if it never lands, say that plainly instead of
 * failing later on a missing field.
 */
async function gotoCreate(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(CREATE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      /* keep trying */
    }
    await page.waitForTimeout(3000 + attempt * 2000);
    if (page.url().includes("/marketplace/create/item") && (await page.locator("label[role=combobox]").count()) > 0) {
      return;
    }
  }
  throw new Error(
    "Facebook kept redirecting away from the create-listing form (now at " +
      page.url() +
      "). This usually means too many listing attempts in a short window. " +
      "Wait 20-30 minutes and try again; the login itself is still fine."
  );
}

/**
 * Choose an option from one of the form's comboboxes.
 *
 * The option list is virtualised: entries that need scrolling are not in the
 * DOM at all, so clicking by exact text silently misses anything below the
 * fold. Scroll until it appears, match case-insensitively, and when it really
 * is not there, report the options that are, so the caller can pick a real one
 * instead of guessing.
 */
async function pickFromCombobox(page: Page, comboLabels: readonly string[], optionTexts: string[]): Promise<void> {
  const box = page.locator(comboLabels.map((l) => `label[role=combobox]:has-text("${l}")`).join(", ")).first();
  await box.click({ timeout: 15000 });
  await page.waitForTimeout(1200);

  const wanted = optionTexts.map((o) => o.toLowerCase());
  const seen = new Set<string>();
  for (let i = 0; i < 40; i++) {
    // Options are plain spans in the document, with no listbox wrapper to scope
    // to, so collect every short visible leaf span and match on text.
    const options: string[] = await page.evaluate(() =>
      [...document.querySelectorAll("span")]
        .filter((s) => s.offsetParent && !s.children.length)
        .map((s) => (s.textContent || "").trim())
        .filter((t) => t.length > 0 && t.length < 50)
    );
    options.forEach((o) => seen.add(o));

    const match = options.find((o) => wanted.includes(o.toLowerCase()));
    if (match) {
      await page.locator(`span:text-is(${JSON.stringify(match)})`).first().click({ timeout: 10000 });
      await page.waitForTimeout(800);
      return;
    }

    // Scroll the popup. Walk up from a known category option to the nearest
    // ancestor that is an actual scroll container (overflow auto/scroll); a
    // bare scrollHeight check stops at clipped text spans and scrolls nothing.
    const moved = await page.evaluate(() => {
      const anchor = [...document.querySelectorAll("span")].find(
        (s) =>
          s.offsetParent &&
          !s.children.length &&
          /^(Tools|Furniture|Household|Garden|Appliances|Herramientas|Muebles|Hogar|Jardinería|Electrodomésticos)$/.test(
            (s.textContent || "").trim()
          )
      );
      let el: HTMLElement | null = (anchor?.parentElement as HTMLElement) ?? null;
      while (el && !(el.scrollHeight > el.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(el).overflowY))) {
        el = el.parentElement;
      }
      if (!el) return false;
      const before = el.scrollTop;
      el.scrollTop += 220;
      return el.scrollTop !== before;
    });
    await page.waitForTimeout(350);
    if (!moved && i > 3) break;
  }

  await page.keyboard.press("Escape").catch(() => {});
  throw new Error(
    `"${optionTexts[0]}" is not an option for ${comboLabels.join(" / ")}. Available: ${[...seen].join(", ") || "(none found)"}`
  );
}

/**
 * Fill the whole create form and STOP on it, before Next, so the caller can
 * confirm. Returns a PNG screenshot of the filled form with Facebook's live
 * preview beside it.
 */
export async function fillListing(input: ListingInput): Promise<Buffer> {
  for (const p of input.photos) {
    if (!fs.existsSync(p)) throw new Error(`Photo not found: ${p}`);
  }
  const page = await getPage();
  await gotoCreate(page);
  await page.waitForTimeout(2500);

  const fileInput = 'input[type=file][accept*="image"]';
  await page.setInputFiles(fileInput, input.photos, { timeout: 20000 });
  await page.waitForTimeout(3500);

  await (await labelled(page, UI.title, "input")).fill(input.title);
  await (await labelled(page, UI.price, "input")).fill(String(input.price).replace(/[^\d]/g, ""));

  await pickFromCombobox(page, UI.category, [input.category]);
  await pickFromCombobox(page, UI.condition, conditionCandidates(input.condition));

  // The description lives in a collapsed "More details" section on newer
  // versions of the form. Expand it only if the textarea is not already there.
  const desc = await labelled(page, UI.description, "textarea", 1500).catch(() => null);
  if (!desc) await clickButton(page, UI.moreDetails, 5000);
  await (await labelled(page, UI.description, "textarea")).fill(input.description);

  // Deliberately do NOT click Next here. On a live es-AR account the Next
  // click alone once published the listing (the review step's Publish button
  // was already spinning in the screenshot taken 2.5s later, with nothing else
  // having clicked it). Root cause unknown, so Next is only ever clicked from
  // publishListing(), i.e. after the seller has approved this screenshot.
  await waitForUploads(page);
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(800);
  return await page.screenshot();
}

/** Wait (bounded) until Next is enabled, which is how the form signals the photos finished uploading. */
async function waitForUploads(page: Page, timeout = 60000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const next = exactButton(page, UI.next);
    if ((await next.count()) > 0 && (await next.getAttribute("aria-disabled")) !== "true") return;
    await page.waitForTimeout(1000);
  }
}

/**
 * Fill and publish in one go, for when the seller has already approved the
 * wording and price.
 *
 * Splitting this into fill-then-publish leaves a draft alive only in the open
 * browser, so any interruption between the two loses it. Doing both inside one
 * call removes that window entirely: it either posts or it doesn't.
 *
 * The visual check the two-step flow bought is replaced by a stricter one. The
 * review page is read back and the title and price must appear on it before
 * anything is published, which catches a field that silently failed to fill.
 */
export async function postListing(input: ListingInput): Promise<{ screenshot: Buffer; url: string }> {
  const screenshot = await fillListing(input);

  const page = await getPage();
  const review = await page.innerText("body");
  const missing: string[] = [];
  if (!review.includes(input.title.slice(0, 40))) missing.push("title");
  if (!priceAppears(review, input.price)) missing.push("price");
  if (missing.length) {
    throw new Error(
      `Stopping before publish: the form preview does not show the ${missing.join(" or ")} that was asked for. ` +
        `Nothing was posted. Check the form and try again.`
    );
  }

  const url = await publishListing();
  return { screenshot, url };
}

/**
 * Click Publish on the review step. Returns the resulting URL.
 *
 * This only works while the draft from create_listing is still on screen, which
 * holds as long as the server keeps running: both calls share one browser. If
 * the browser has been restarted in between, the draft is gone, and a bare
 * selector timeout would not explain why. Say what happened instead.
 */
export async function publishListing(): Promise<string> {
  const page = await getPage();
  const noDraft = () =>
    new Error(
      "No draft is waiting to be published (currently at " +
        page.url() +
        "). A draft only survives while the browser stays open, so run create_listing again and publish without restarting in between."
    );

  // create_listing leaves the filled form on screen; advance to the review step now.
  const next = exactButton(page, UI.next);
  if ((await next.count()) > 0) {
    await waitForUploads(page);
    await next.click({ timeout: 10000 });
    await page.waitForTimeout(3000);
  }

  // Next can itself publish (see fillListing). If the create flow is gone
  // already, report where we ended up instead of looking for a button.
  if (!page.url().includes("/marketplace/create")) return page.url();

  const publish = exactButton(page, UI.publish);
  const deadline = Date.now() + 30000;
  while ((await publish.count()) === 0 || (await publish.getAttribute("aria-disabled")) === "true") {
    if (!page.url().includes("/marketplace/create")) return page.url();
    if (Date.now() > deadline) {
      if ((await publish.count()) === 0) throw noDraft();
      // Present but disabled for 30s: most likely already publishing.
      await page.waitForTimeout(5000);
      return page.url();
    }
    await page.waitForTimeout(1000);
  }
  await publish.click({ timeout: 10000 });
  await page.waitForTimeout(5000);
  return page.url();
}

export interface MyListing {
  title: string;
  price: string;
  status: string;
}

/** Read the seller's current listings from the "Selling" page. */
export async function listMine(): Promise<{ text: string; screenshot: Buffer }> {
  const page = await getPage();
  await page.goto(SELLING_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  const text = await page.innerText("body");
  const screenshot = await page.screenshot();
  return { text, screenshot };
}
