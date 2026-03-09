#!/usr/bin/env node
/**
 * CLI runner for racenight discovery pipeline.
 * Runs: scrape → enrich → tips → screenshots → post generation
 * Outputs JSON to stdout. Logs to stderr.
 *
 * Usage: node racenight-cli.js [--state TX]
 */
const { loadRacenightConfig } = require("./racenight-config");
const { scrapeMyRacePass } = require("./scraper-myracepass");
const { enrichTracks } = require("./track-enrichment");
const { generateTip } = require("./tip-generator");
const {
  captureRacenightScreenshots,
  cleanupOldScreenshots,
  getScreenshotRoute,
} = require("./racenight-screenshots");
const { generateRacenightPost } = require("./racenight-post-generator");

// Redirect console.log to stderr so only JSON goes to stdout.
// Imported modules (scraper, enrichment, etc.) use console.log for logging,
// which would otherwise pollute the JSON output stream.
const _origLog = console.log;
console.log = (...args) => console.error(...args);

async function main() {
  const args = process.argv.slice(2);
  const stateIdx = args.indexOf("--state");
  const stateOverride = stateIdx >= 0 ? args[stateIdx + 1] : null;

  const config = loadRacenightConfig();
  cleanupOldScreenshots(config.screenshot_cleanup_days || 7);

  // Step 1: Scrape
  console.error("[cli] Scraping MyRacePass...");
  const result = await scrapeMyRacePass(config, stateOverride);

  if (!result.structured || !result.tracks || result.tracks.length === 0) {
    const output = {
      success: false,
      error: result.structured
        ? "No matching tracks found tonight."
        : "Could not parse MyRacePass page structure.",
      tracks: [],
    };
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // Step 2: Enrich (adds state, surface, length, etc. from Supabase or AI research)
  console.error(`[cli] Found ${result.tracks.length} events. Enriching...`);
  const enriched = await enrichTracks(result.tracks);

  // Step 2b: Filter by region AFTER enrichment (location comes from Supabase, not the list page)
  const regions = stateOverride
    ? [stateOverride.toUpperCase()]
    : config.regions;
  const filtered = enriched.filter((t) => {
    if (!t.state) {
      console.error(`[cli] No state for ${t.name}, skipping`);
      return false;
    }
    return regions.includes(t.state.toUpperCase());
  });

  console.error(
    `[cli] Region filter: ${enriched.length} → ${filtered.length} tracks (regions: ${regions.join(", ")})`
  );

  if (filtered.length === 0) {
    const output = {
      success: false,
      error: `No tracks found in target regions (${regions.join(", ")}) tonight.`,
      tracks: [],
    };
    process.stdout.write(JSON.stringify(output));
    return;
  }

  // Step 3: Tips
  console.error("[cli] Generating tips...");
  for (const track of filtered) {
    try {
      track.tip = await generateTip(track);
    } catch (err) {
      console.error(`[cli] Tip failed for ${track.name}: ${err.message}`);
      track.tip = "Setup tip coming soon - check tenths.racing for real-time calculations.";
    }
  }

  // Step 4: Screenshots
  console.error("[cli] Capturing screenshots...");
  let screenshotMap = {};
  try {
    screenshotMap = await captureRacenightScreenshots(filtered, config);
  } catch (err) {
    console.error(`[cli] Screenshots failed: ${err.message}`);
  }

  // Step 5: Generate posts
  console.error("[cli] Generating posts...");
  const today = new Date();
  const mmdd =
    String(today.getMonth() + 1).padStart(2, "0") +
    String(today.getDate()).padStart(2, "0");

  for (const track of filtered) {
    const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
    track.promo_code = `TENTHS-${abbrev}-${mmdd}`;
    track.promo_url = `https://tenths.racing/promo/${track.promo_code}`;
    try {
      track.post_text = await generateRacenightPost(track, track.tip, track.promo_code);
    } catch (err) {
      console.error(`[cli] Post gen failed for ${track.name}: ${err.message}`);
      track.post_text = "";
    }
    track.screenshot_path = screenshotMap[abbrev] || null;
    const route = getScreenshotRoute(track);
    track.screenshot_label = route.label;
  }

  // Output
  const output = {
    success: true,
    regions: stateOverride ? [stateOverride] : config.regions,
    divisions: config.divisions,
    promo_max_uses: config.promo_max_uses || 10,
    tracks: filtered.map((t) => ({
      name: t.name,
      state: t.state,
      location: t.location,
      surface: t.surface,
      length: t.length,
      banking: t.banking,
      shape: t.shape,
      divisions_tonight: t.divisions_tonight,
      weather: t.weather,
      tip: t.tip,
      promo_code: t.promo_code,
      promo_url: t.promo_url,
      post_text: t.post_text,
      screenshot_path: t.screenshot_path,
      screenshot_label: t.screenshot_label,
      facebook_page_url: t.facebook_page_url,
      abbreviation: t.abbreviation || t.name.substring(0, 3).toUpperCase(),
      is_known: t.is_known || false,
      supabase_id: t.supabase_id || null,
    })),
  };

  process.stdout.write(JSON.stringify(output));
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({ success: false, error: err.message, tracks: [] })
  );
  process.exit(1);
});
