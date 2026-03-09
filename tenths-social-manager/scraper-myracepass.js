const { chromium } = require('playwright');

/**
 * Scrapes MyRacePass for tonight's events.
 *
 * As of March 2026, MyRacePass uses:
 *   URL:  /events/today  (old /schedule/?d= now 302-redirects to home)
 *   DOM:  .mrp-rowCard  cards with:
 *         - h3 > a[href*="/events/"]  → track name + event URL
 *         - p.text-muted              → date + event description
 *
 * Location/state is NOT available on the list page.
 * Filtering by region happens AFTER enrichment in racenight-cli.js.
 *
 * NOTE: If selectors break again, inspect /events/today and update below.
 */
async function scrapeMyRacePass(config, _stateOverride) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const tracks = [];

  try {
    const url = 'https://www.myracepass.com/events/today';
    console.log(`[scraper] Fetching ${url} (local date: ${today})`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Give JS-rendered content time to populate
    await page.waitForTimeout(5000);

    // Extract event cards from the new MRP layout
    const events = await page.evaluate(() => {
      const cards = document.querySelectorAll('.mrp-rowCard');
      if (cards.length === 0) {
        // Fallback: return raw page text for debugging
        const body = document.body?.innerText || '';
        return [{ fallback: true, raw_text: body.substring(0, 5000) }];
      }

      const results = [];
      for (const card of cards) {
        const info = card.querySelector('.mrp-rowCardInfo');
        if (!info) continue;

        // Track name from h3 > a
        const nameLink = info.querySelector('h3 a[href*="/events/"]');
        if (!nameLink) continue;

        // Event description from the second p.text-muted (first is date)
        const mutedEls = info.querySelectorAll('p.text-muted');
        const description = mutedEls.length > 1
          ? mutedEls[1].textContent?.trim() || ''
          : '';

        results.push({
          name: nameLink.textContent?.trim() || '',
          event_url: nameLink.href || '',
          description: description,
        });
      }

      return results;
    });

    // Fallback path — page loaded but no cards found
    if (events.length === 1 && events[0].fallback) {
      console.log('[scraper] No .mrp-rowCard elements found, returning raw text');
      await browser.close();
      return { raw_text: events[0].raw_text, structured: false };
    }

    console.log(`[scraper] Extracted ${events.length} event cards`);

    // De-duplicate by track name (same track may appear in multiple sections)
    const seen = new Set();
    for (const event of events) {
      const key = event.name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip practice-only and canceled events
      const desc = event.description.toUpperCase();
      if (desc.includes('CANCELED') || desc.includes('CANCELLED')) {
        console.log(`[scraper] Skipping canceled: ${event.name}`);
        continue;
      }

      tracks.push({
        name: event.name,
        state: null,          // populated during enrichment
        location: '',         // populated during enrichment
        divisions_tonight: [],  // populated from event page or enrichment
        matched_divisions: [],
        myracepass_url: event.event_url,
        event_description: event.description,
      });
    }
  } catch (err) {
    console.error(`[scraper] Error: ${err.message}`);
  } finally {
    await browser.close();
  }

  // Cap results
  const max = config.max_tracks_per_run || 20;
  if (tracks.length > max) {
    console.log(`[scraper] Capping from ${tracks.length} to ${max} tracks`);
    tracks.length = max;
  }

  console.log(`[scraper] Found ${tracks.length} events for ${today}`);
  return { tracks, structured: true };
}

module.exports = { scrapeMyRacePass };
