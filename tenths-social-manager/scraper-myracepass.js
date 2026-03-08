const { chromium } = require('playwright');
const { matchDivision } = require('./racenight-config');

/**
 * Scrapes MyRacePass for tonight's races.
 * MyRacePass URL pattern: https://www.myracepass.com/schedule/?d=YYYY-MM-DD
 *
 * NOTE: MyRacePass page structure may change. If selectors break,
 * inspect https://www.myracepass.com/schedule/ and update selectors below.
 */
async function scrapeMyRacePass(config, stateOverride) {
  const today = new Date().toISOString().split('T')[0];
  const regions = stateOverride ? [stateOverride.toUpperCase()] : config.regions;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const tracks = [];

  try {
    const url = `https://www.myracepass.com/schedule/?d=${today}`;
    console.log(`[scraper] Fetching ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // Extract event data from the page
    const events = await page.evaluate(() => {
      const results = [];

      // MyRacePass uses various layouts — try common patterns
      const eventElements = document.querySelectorAll(
        '.schedule-event, .event-row, [class*="event"], .race-listing, tr[class*="event"]'
      );

      for (const el of eventElements) {
        const text = el.textContent || '';
        const trackEl = el.querySelector(
          '.track-name, .event-track, [class*="track"], a[href*="/tracks/"]'
        );
        const locationEl = el.querySelector(
          '.track-location, .event-location, [class*="location"], [class*="city"]'
        );
        const classEls = el.querySelectorAll(
          '.race-class, .event-class, [class*="class"], [class*="division"]'
        );

        if (trackEl) {
          results.push({
            name: trackEl.textContent?.trim() || '',
            url: trackEl.href || '',
            location: locationEl?.textContent?.trim() || '',
            classes: Array.from(classEls).map(c => c.textContent?.trim()).filter(Boolean),
            raw_text: text.substring(0, 500)
          });
        }
      }

      // Fallback: if no structured elements found, return page text
      if (results.length === 0) {
        const body = document.body?.innerText || '';
        return [{ fallback: true, raw_text: body.substring(0, 5000) }];
      }

      return results;
    });

    // If we got fallback text, return it for AI parsing
    if (events.length === 1 && events[0].fallback) {
      console.log('[scraper] Structured extraction failed, returning raw text for AI parsing');
      await browser.close();
      return { raw_text: events[0].raw_text, structured: false };
    }

    // Process structured results
    for (const event of events) {
      const stateMatch = event.location.match(/\b([A-Z]{2})\b/);
      const state = stateMatch ? stateMatch[1] : null;

      // Filter by region
      if (state && !regions.includes(state)) continue;

      // Match divisions
      const matchedDivisions = [];
      for (const cls of event.classes) {
        const matched = matchDivision(cls, config);
        if (matched) matchedDivisions.push({ original: cls, matched });
      }

      // Only include if at least one compatible division
      if (matchedDivisions.length === 0 && event.classes.length > 0) continue;

      tracks.push({
        name: event.name,
        state: state,
        location: event.location,
        divisions_tonight: matchedDivisions.map(d => d.original),
        matched_divisions: matchedDivisions.map(d => d.matched),
        myracepass_url: event.url || null,
        raw_classes: event.classes
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

  console.log(`[scraper] Found ${tracks.length} matching tracks for ${today}`);
  return { tracks, structured: true };
}

module.exports = { scrapeMyRacePass };
