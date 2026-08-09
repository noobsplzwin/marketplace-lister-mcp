import fs from "node:fs";
import path from "node:path";
import type { Page } from "playwright";
import { getPage } from "./browser.js";

const CREATE_URL = "https://www.facebook.com/marketplace/create/item";
const SELLING_URL = "https://www.facebook.com/marketplace/you/selling";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export interface ScannedItem {
  folder: string;
  name: string;
  photos: string[];
}

/** Scan a directory: each immediate subfolder is one item; its images are its photos. */
export function scanItems(root: string): ScannedItem[] {
  if (!fs.existsSync(root)) throw new Error(`Folder not found: ${root}`);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."));

  const collect = (dir: string): string[] =>
    fs
      .readdirSync(dir)
      .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
      .sort()
      .map((f) => path.join(dir, f));

  if (subdirs.length === 0) {
    // No subfolders: treat the root itself as a single item.
    return [{ folder: root, name: path.basename(root), photos: collect(root) }];
  }
  return subdirs.map((d) => {
    const dir = path.join(root, d.name);
    return { folder: dir, name: d.name, photos: collect(dir) };
  });
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

async function gotoCreate(page: Page): Promise<void> {
  // FB sometimes bounces the first navigation to the home feed; retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(CREATE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
      if (page.url().includes("/marketplace/create/item")) return;
    } catch {
      /* retry */
    }
    await page.waitForTimeout(2500);
  }
  await page.goto(CREATE_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
}

async function pickFromCombobox(page: Page, comboLabel: string, optionText: string): Promise<void> {
  await page.click(`label[role=combobox]:has-text("${comboLabel}")`, { timeout: 10000 });
  await page.waitForTimeout(1000);
  await page.click(`span:text-is("${optionText}")`, { timeout: 10000 });
  await page.waitForTimeout(700);
}

/**
 * Fill the whole create form and advance to the review ("List in more places")
 * step. Deliberately STOPS before Publish so the caller can confirm.
 * Returns a PNG screenshot buffer of the review page.
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

  await page.fill('label:has-text("Title") input', input.title, { timeout: 10000 });
  await page.fill('label:has-text("Price") input', String(input.price), { timeout: 10000 });
  await page.fill('label:has-text("Description") textarea', input.description, { timeout: 10000 });

  await pickFromCombobox(page, "Category", input.category);
  await pickFromCombobox(page, "Condition", input.condition);

  // Advance to the audience / review step.
  await page.click('div[role=button]:has-text("Next"), span:text-is("Next")', { timeout: 10000 });
  await page.waitForTimeout(2500);

  return await page.screenshot();
}

/** Click Publish on the review step. Returns the resulting URL. */
export async function publishListing(): Promise<string> {
  const page = await getPage();
  await page.click('div[role=button]:has-text("Publish"), span:text-is("Publish")', { timeout: 10000 });
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
