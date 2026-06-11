// Scrape Serenity's (@aleabitoreddit) public X timeline into the local knowledge
// base. Connects to the already-running Chrome via CDP (no separate browser
// download needed) so it reuses any logged-in session / cookies.
//
// Usage:
//   node scripts/scrape-x.mjs [handle] [maxScrolls]
// Output:
//   .data/x-posts.json
//
// X's public profile is readable without login, but content is rate-limited and
// rendered client-side, so we scroll incrementally and dedupe by status id.

import { chromium } from "playwright-core";
import { promises as fs } from "fs";
import path from "path";

const HANDLE = process.argv[2] || "aleabitoreddit";
const MAX_SCROLLS = Number(process.argv[3] || 80);
const CDP = process.env.CDP_URL || "http://localhost:29229";
const OUT = path.join(process.cwd(), ".data", "x-posts.json");

function extractTickers(text) {
  const set = new Set();
  for (const m of text.matchAll(/\$([A-Z]{1,6})\b/g)) set.add(m[1]);
  return [...set];
}

const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

// Article innerText looks like:
//   [Pinned]\nSerenity\n@aleabitoreddit\n·\nJun 4\n<body...>\n<counts...>
// Pull out the date and strip the header + trailing engagement numbers.
function cleanArticle(raw) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const dateRe = new RegExp(`^(?:${MONTHS})\\s+\\d{1,2}(?:,\\s*\\d{4})?$`);
  let date = "";
  let bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (dateRe.test(lines[i])) {
      date = lines[i];
      bodyStart = i + 1;
      break;
    }
  }
  // Trailing lines are engagement counts (numbers / K / M / dots).
  let bodyEnd = lines.length;
  while (bodyEnd > bodyStart) {
    const l = lines[bodyEnd - 1];
    if (/^[\d.,]+[KM]?$/.test(l) || l === "·" || l === "") bodyEnd--;
    else break;
  }
  const body = lines.slice(bodyStart, bodyEnd).join("\n").trim() || raw.trim();
  return { date, body, metrics: {} };
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP);
  const context = browser.contexts()[0] || (await browser.newContext());
  // Reuse an already-open x.com tab if present (keeps any human-loaded session).
  const pages = context.pages();
  let page = pages.find((p) => p.url().includes("x.com"));
  if (!page) page = pages[0] || (await context.newPage());

  console.log(`Navigating to https://x.com/${HANDLE} ...`);
  await page.goto(`https://x.com/${HANDLE}`, { waitUntil: "domcontentloaded" });
  try {
    await page.waitForSelector("article", { timeout: 20000 });
  } catch {
    console.log("WARN: no <article> appeared within 20s (login wall / rate limit?)");
  }
  await page.screenshot({ path: path.join(process.cwd(), ".data", "x-debug.png") }).catch(() => {});
  await page.waitForTimeout(2500);

  const posts = new Map();
  let stagnant = 0;

  for (let i = 0; i < MAX_SCROLLS && stagnant < 6; i++) {
    const batch = await page.$$eval("article", (articles) => {
      const out = [];
      for (const a of articles) {
        // Permalink: first /<user>/status/<id> link that isn't a photo/analytics sublink.
        let id = "";
        let url = "";
        for (const l of a.querySelectorAll('a[href*="/status/"]')) {
          const href = l.getAttribute("href") || "";
          const m = href.match(/^\/[^/]+\/status\/(\d+)$/);
          if (m) {
            id = m[1];
            url = `https://x.com${href}`;
            break;
          }
        }
        const text = (a.innerText || "").trim();
        if (id && text) out.push({ id, url, text });
      }
      return out;
    });

    const before = posts.size;
    for (const p of batch) {
      if (!posts.has(p.id)) {
        const { date, body, metrics } = cleanArticle(p.text);
        posts.set(p.id, {
          id: p.id,
          source: "x",
          url: p.url,
          date,
          text: body,
          tickers: extractTickers(body),
          metrics,
        });
      }
    }
    const added = posts.size - before;
    stagnant = added === 0 ? stagnant + 1 : 0;
    console.log(`scroll ${i + 1}: +${added} (total ${posts.size})`);

    await page.evaluate(() => {
      const arts = document.querySelectorAll("article");
      const last = arts[arts.length - 1];
      if (last) last.scrollIntoView({ block: "end" });
      window.scrollBy(0, window.innerHeight);
    });
    await page.waitForTimeout(1800);
  }

  const all = [...posts.values()].sort((a, b) => (a.date < b.date ? 1 : -1));
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify({ handle: HANDLE, scrapedAt: new Date().toISOString(), count: all.length, posts: all }, null, 2));
  console.log(`Saved ${all.length} posts -> ${OUT}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
