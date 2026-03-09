#!/usr/bin/env node
/**
 * CLI runner for publishing a single racenight track.
 * Creates the promo in Supabase and posts to Facebook.
 * Reads track JSON from stdin.
 *
 * Usage: echo "<track_json>" | node racenight-publish-cli.js
 */
const { loadRacenightConfig } = require("./racenight-config");
const { createRacenightPromo } = require("./racenight-promo");
const { postToFacebook } = require("./publisher-fb");
const screenshots = require("./screenshots");

// Redirect console.log to stderr so only JSON goes to stdout.
const _origLog = console.log;
console.log = (...args) => console.error(...args);

async function main() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  const track = JSON.parse(input);
  const config = loadRacenightConfig();

  const result = { promo: null, fb_post_id: null, errors: [] };

  // 1. Create promo in Supabase
  try {
    result.promo = await createRacenightPromo(track, config);
    console.error(`[publish] Promo created: ${result.promo.code}`);
  } catch (err) {
    result.errors.push(`Promo: ${err.message}`);
    console.error(`[publish] Promo failed: ${err.message}`);
  }

  // 2. Post to Facebook with racenight screenshot override
  try {
    const fbPost = {
      theme: "race_night",
      content: {
        fb: {
          text: track.post_text,
          hashtags: [],
        },
      },
    };

    const originalGetScreenshotPath = screenshots.getScreenshotPath;
    screenshots.getScreenshotPath = () => track.screenshot_path;

    try {
      result.fb_post_id = await postToFacebook(fbPost);
      console.error(`[publish] Posted to FB: ${result.fb_post_id}`);
    } finally {
      screenshots.getScreenshotPath = originalGetScreenshotPath;
    }
  } catch (err) {
    result.errors.push(`Facebook: ${err.message}`);
    console.error(`[publish] FB failed: ${err.message}`);
  }

  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({ promo: null, fb_post_id: null, errors: [err.message] })
  );
  process.exit(1);
});
