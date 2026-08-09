import { getPage } from "./browser.js";

/**
 * Pricing comparables ("comps"): search Marketplace from the SAME logged-in
 * session and read back what similar items actually list for.
 *
 * Deliberately read-only and DOM-based rather than replaying internal GraphQL:
 * doc_ids rotate with every frontend release, and the rendered result cards
 * carry everything we need (price, title, location, sold badge).
 */

const SORTS = ["best_match", "price_ascend", "price_descend", "creation_time_descend", "distance_ascend"] as const;
export type SortBy = (typeof SORTS)[number];

export interface CompsQuery {
  query: string;
  minPrice?: number;
  maxPrice?: number;
  daysSinceListed?: number; // 1 | 7 | 30
  sortBy?: SortBy;
  maxResults?: number;
}

export interface Comp {
  title: string;
  price: number | null;
  priceText: string;
  location?: string;
  sold: boolean;
  url: string;
  /** Fraction of the query's significant words present in the title (0–1). */
  relevance?: number;
}

export interface CompsStats {
  count: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

export interface CompsResult {
  url: string;
  query: string;
  scanned: number;
  active: Comp[];
  sold: Comp[];
  /** Subset of `active` whose titles actually match the query terms. */
  close: Comp[];
  /** The distinguishing term (brand/model) required of a close match, if any. */
  anchor: string | null;
  activeStats: CompsStats | null;
  soldStats: CompsStats | null;
  closeStats: CompsStats | null;
  /** Neutral description of the data found. Not a price recommendation. */
  observation: string;
}

export function buildSearchUrl(q: CompsQuery): string {
  const p = new URLSearchParams({ query: q.query });
  if (q.minPrice != null) p.set("minPrice", String(q.minPrice));
  if (q.maxPrice != null) p.set("maxPrice", String(q.maxPrice));
  if (q.daysSinceListed != null) p.set("daysSinceListed", String(q.daysSinceListed));
  p.set("sortBy", q.sortBy ?? "best_match");
  return `https://www.facebook.com/marketplace/search/?${p.toString()}`;
}

/** Parse "CA$1,234" / "$85" / "Free" out of a card's text. */
export function parsePrice(text: string): { price: number | null; priceText: string } {
  const m = text.match(/(?:CA|US|C|A)?\$\s?([\d][\d,]*(?:\.\d{1,2})?)/);
  if (m) return { price: Number(m[1].replace(/,/g, "")), priceText: m[0].trim() };
  if (/^\s*Free\b/im.test(text)) return { price: 0, priceText: "Free" };
  return { price: null, priceText: "" };
}

/**
 * Overlay badges Facebook renders inside result cards. These are not titles —
 * missing this makes half the comps come back titled "Just listed".
 */
const BADGE =
  /^(just listed|new listing|new|sold|pending|reserved|free|save(d)?|shipping available|local pickup|free shipping|sponsored|only \d+ left|\d+ (km|mi|miles|kilometres) away)$/i;

/**
 * Turn one result card's innerText into a Comp. Cards look roughly like:
 *   Just listed        <- optional badge
 *   CA$85
 *   Cuckoo CR-0675F 6-cup micom rice cooker
 *   Portland, OR
 */
export function parseCard(text: string, url: string): Comp | null {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  const sold = lines.some((l) => /^sold\b/i.test(l));
  const { price, priceText } = parsePrice(text);

  // Title = first line that is neither a price nor a badge. Prefer the longest
  // remaining candidate when several qualify — FB puts the real title first,
  // but short fragments occasionally precede it.
  const candidates = lines.filter(
    (l) => l !== priceText && !BADGE.test(l) && !/^(?:CA|US|C|A)?\$\s?[\d]/.test(l) && l.length > 2
  );
  if (candidates.length === 0) return null;

  // Last line is usually the location ("Portland, OR"); don't let it become the title.
  const last = lines[lines.length - 1];
  const looksLikeLocation = /^[A-Za-z .'-]+,\s*[A-Z]{2}$/.test(last);
  const titlePool = looksLikeLocation ? candidates.filter((c) => c !== last) : candidates;
  const title = titlePool[0] ?? candidates[0];
  if (!title) return null;

  return {
    title,
    price,
    priceText,
    location: looksLikeLocation ? last : undefined,
    sold,
    url,
  };
}

const STOPWORDS = new Set(["the", "a", "an", "and", "for", "with", "of", "in", "size", "new", "used"]);

export function queryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Unweighted fallback: fraction of query words present in the title (0–1). */
export function relevanceScore(query: string, title: string): number {
  const terms = queryTerms(query);
  if (terms.length === 0) return 1;
  const hay = title.toLowerCase();
  return terms.filter((t) => hay.includes(t)).length / terms.length;
}

/**
 * Relevance of each title to the query, weighting rare query terms higher (IDF).
 *
 * This matters for pricing: searching "staub dutch oven" returns mostly generic
 * cast iron, where "dutch"/"oven" appear everywhere and "staub" appears once.
 * Plain word-overlap ranks a KitchenAid Dutch oven ABOVE a "STAUB Cocotte" —
 * exactly backwards. Weighting by rarity puts the brand match on top.
 */
export function scoreTitles(query: string, titles: string[]): number[] {
  const terms = queryTerms(query);
  const n = titles.length;
  if (terms.length === 0 || n === 0) return titles.map(() => 1);

  const lower = titles.map((t) => t.toLowerCase());
  const idf = new Map<string, number>();
  for (const t of terms) {
    const df = lower.filter((h) => h.includes(t)).length;
    idf.set(t, df === 0 ? 0 : Math.log(n / df));
  }
  const total = terms.reduce((s, t) => s + (idf.get(t) ?? 0), 0);

  // Every term is equally common (or absent) — no signal to weight by.
  if (total <= 0) return titles.map((t) => relevanceScore(query, t));

  return lower.map((h) => {
    const hit = terms.reduce((s, t) => s + (h.includes(t) ? idf.get(t)! : 0), 0);
    return hit / total;
  });
}

/** Titles scoring at or above this are treated as genuine comparables. */
export const CLOSE_THRESHOLD = 0.5;

/**
 * The single most distinctive query term across this result set — usually the
 * brand or model. Returns null when no term stands out (e.g. "rice cooker",
 * where both words appear in every hit).
 *
 * Weighted scoring alone isn't enough: two mid-frequency words ("dutch",
 * "oven") can out-vote one rare brand ("staub"), which is how a Le Creuset
 * *tote bag* ends up priced as a comp for a Staub cocotte. Requiring the anchor
 * makes the brand non-negotiable.
 */
export function anchorTerm(query: string, titles: string[]): string | null {
  const terms = queryTerms(query);
  if (terms.length < 2 || titles.length === 0) return null;
  const lower = titles.map((t) => t.toLowerCase());
  let best: string | null = null;
  let bestIdf = 0;
  for (const t of terms) {
    const df = lower.filter((h) => h.includes(t)).length;
    if (df === 0) continue;
    const idf = Math.log(titles.length / df);
    if (idf > bestIdf) {
      bestIdf = idf;
      best = t;
    }
  }
  return best;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeStats(prices: number[]): CompsStats | null {
  const vals = prices.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (vals.length === 0) return null;
  const r = (n: number) => Math.round(n);
  return {
    count: vals.length,
    min: r(vals[0]),
    p25: r(percentile(vals, 0.25)),
    median: r(percentile(vals, 0.5)),
    p75: r(percentile(vals, 0.75)),
    max: r(vals[vals.length - 1]),
  };
}

/**
 * Neutral description of what was found. Deliberately NOT a recommendation.
 *
 * Measured against real listings, these numbers were unreliable enough to be
 * dangerous as advice: a search for "rice cooker" medians around $15 because
 * entry-level units dominate the words, while a premium micom cooker worth
 * ~$85 used sits in the same results. Generic queries systematically
 * understate good gear, so the seller sets the price and this is reference
 * material only.
 */
const ASKING_CAVEAT = "Asking prices are not sale prices.";
const SKEW_CAVEAT =
  "Generic search terms pull in entry-level units, so this range can sit far below what a premium brand or model is actually worth. Reference only — the seller sets the price.";

export function buildObservation(
  active: CompsStats | null,
  sold: CompsStats | null,
  close: CompsStats | null = null,
  anchor: string | null = null
): string {
  const anchored = anchor ? ` containing "${anchor}"` : "";
  if (!active && !sold && !close) {
    return "No comparable listings found. Widen the query (fewer words, drop the model number) or drop price filters.";
  }
  const parts: string[] = [];
  if (sold) {
    parts.push(`${sold.count} sold: $${sold.min}–$${sold.max}, median $${sold.median}.`);
  }
  if (close && close.count >= 3) {
    parts.push(
      `${close.count} active listings matching the query${anchored}: $${close.min}–$${close.max}, median $${close.median} (IQR $${close.p25}–$${close.p75}).`
    );
    if (active && Math.abs(close.median - active.median) / Math.max(active.median, 1) > 0.3) {
      parts.push(`The unfiltered result set medians $${active.median}, so loosely-related items shift it noticeably.`);
    }
  } else if (active) {
    parts.push(`${active.count} active listings: $${active.min}–$${active.max}, median $${active.median} (IQR $${active.p25}–$${active.p75}).`);
    parts.push(`Too few genuine matches${anchored} to isolate, so this covers loosely-related items — read the titles.`);
  }
  parts.push(ASKING_CAVEAT, SKEW_CAVEAT);
  return parts.join(" ");
}

export async function searchComps(q: CompsQuery): Promise<CompsResult> {
  const url = buildSearchUrl(q);
  const max = q.maxResults ?? 40;
  const page = await getPage();

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);

  // Scroll until the result count stops growing (lazy-loaded grid).
  let prevCount = 0;
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 2));
    await page.waitForTimeout(1800);
    const n = await page.evaluate(() => document.querySelectorAll('a[href*="/marketplace/item/"]').length);
    if (n === prevCount) break;
    prevCount = n;
  }

  const raw = (await page.evaluate(() => {
    const seen = new Set<string>();
    const out: Array<{ text: string; url: string }> = [];
    document.querySelectorAll('a[href*="/marketplace/item/"]').forEach((a) => {
      const el = a as HTMLAnchorElement;
      const href = el.href.split("?")[0];
      if (seen.has(href)) return;
      seen.add(href);
      const text = (el as HTMLElement).innerText || "";
      if (text.trim()) out.push({ text, url: href });
    });
    return out;
  })) as Array<{ text: string; url: string }>;

  const parsed = raw
    .map((r) => parseCard(r.text, r.url))
    .filter((c): c is Comp => !!c && c.price !== null)
    .slice(0, max);

  // Score against the whole result set so term rarity can be measured.
  const scores = scoreTitles(
    q.query,
    parsed.map((c) => c.title)
  );
  const comps = parsed.map((c, i) => ({ ...c, relevance: scores[i] }));

  const active = comps.filter((c) => !c.sold);
  const sold = comps.filter((c) => c.sold);

  const anchor = anchorTerm(
    q.query,
    parsed.map((c) => c.title)
  );
  const close = active.filter(
    (c) => (c.relevance ?? 0) >= CLOSE_THRESHOLD && (!anchor || c.title.toLowerCase().includes(anchor))
  );

  const activeStats = computeStats(active.map((c) => c.price!));
  const soldStats = computeStats(sold.map((c) => c.price!));
  const closeStats = computeStats(close.map((c) => c.price!));

  return {
    url,
    query: q.query,
    scanned: raw.length,
    anchor,
    active,
    sold,
    close,
    activeStats,
    soldStats,
    closeStats,
    observation: buildObservation(activeStats, soldStats, closeStats, anchor),
  };
}
