import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { chromium, type BrowserContext, type Page } from "playwright";

/**
 * Singleton dedicated browser profile. This is the whole point of the
 * cross-platform design: login state lives in ITS OWN user-data-dir, not in
 * the user's day-to-day Chrome and not in any OS keychain. The user logs in
 * once (in the fb_login tool) and the session persists here across restarts.
 */

// One profile per marketplace, so adding another platform later doesn't share
// or clobber this one's session. Falls back to the pre-rename location so an
// existing login keeps working without signing in again.
const LEGACY_DIR = path.join(os.homedir(), ".fb-marketplace-mcp", "profile");
const DEFAULT_DIR = path.join(os.homedir(), ".marketplace-lister-mcp", "facebook");

const PROFILE_DIR =
  process.env.FB_MCP_PROFILE_DIR ||
  (fs.existsSync(DEFAULT_DIR) || !fs.existsSync(LEGACY_DIR) ? DEFAULT_DIR : LEGACY_DIR);

// Optional: use an installed Chrome/Edge channel instead of bundled Chromium.
// Bundled Chromium is the default so `npx` works with zero extra setup.
const CHANNEL = process.env.FB_MCP_CHANNEL; // e.g. "chrome" | "msedge"

let ctx: BrowserContext | null = null;

async function launch(channel?: string): Promise<BrowserContext> {
  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel,
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

/**
 * Whether the cached context's browser is still running. Tracked through the
 * context's own "close" event rather than by evaluating script in a page: a
 * page that is mid-navigation (e.g. right after the user submits the login
 * form) rejects evaluate(), and treating that as a dead browser used to close
 * the window out from under the user while they were signing in.
 */
let closed = true;

async function isAlive(c: BrowserContext): Promise<boolean> {
  if (closed) return false;
  try {
    if (c.pages().length === 0) await c.newPage();
    return true;
  } catch {
    return false;
  }
}

function track(c: BrowserContext): BrowserContext {
  closed = false;
  c.on("close", () => {
    if (ctx === c) {
      closed = true;
      ctx = null;
    }
  });
  return c;
}

export async function getContext(): Promise<BrowserContext> {
  if (ctx) {
    if (await isAlive(ctx)) return ctx;
    await ctx.close().catch(() => {});
    ctx = null;
  }
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  // Prefer an installed browser: nearly everyone has one, and it keeps install
  // fast by not requiring Playwright's ~150 MB Chromium download. Bundled
  // Chromium is the last resort, and some Windows setups can't spawn it at all
  // ("spawn UNKNOWN"), which is why this walks a list instead of picking one.
  const order = CHANNEL ? [CHANNEL] : ["chrome", "msedge", undefined];
  const errors: string[] = [];
  for (const ch of order) {
    try {
      ctx = track(await launch(ch));
      return ctx;
    } catch (e) {
      errors.push(`[${ch ?? "bundled Chromium"}] ${String(e).split("\n")[0]}`);
    }
  }
  throw new Error(
    `Could not launch a browser (tried: ${order.map((c) => c ?? "bundled Chromium").join(", ")}).\n` +
      `Install Google Chrome, or run: npx playwright install chromium\n` +
      `To pin one, set FB_MCP_CHANNEL=chrome (or msedge).\n` +
      `Errors:\n${errors.join("\n")}`
  );
}

export async function getPage(): Promise<Page> {
  const c = await getContext();
  const pages = c.pages();
  return pages.length ? pages[0] : await c.newPage();
}

/** True if a Facebook session cookie (c_user) is present. */
export async function isLoggedIn(): Promise<boolean> {
  const c = await getContext();
  const cookies = await c.cookies("https://www.facebook.com");
  return cookies.some((ck) => ck.name === "c_user" && !!ck.value);
}

export async function closeContext(): Promise<void> {
  if (ctx) {
    await ctx.close().catch(() => {});
    ctx = null;
  }
}

export function profileDir(): string {
  return PROFILE_DIR;
}
