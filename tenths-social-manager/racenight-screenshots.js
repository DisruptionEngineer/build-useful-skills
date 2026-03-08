const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE, '.agents', 'data', 'tenths-racenight-screenshots'
);

/**
 * Determine which app page to screenshot based on track context.
 */
function getScreenshotRoute(track) {
  const surface = (track.surface || '').toLowerCase();
  const divisions = (track.matched_divisions || []).join(',');
  const shape = (track.shape || '').toLowerCase();

  if (shape.includes('figure') || shape.includes('f8') || divisions.includes('figure-8')) {
    return { route: '/calculators/gear-ratio', label: 'gear-ratio' };
  }
  if (surface.includes('dirt')) {
    return { route: '/setup', label: 'setup-dirt' };
  }
  if (surface.includes('asphalt')) {
    return { route: '/setup', label: 'setup-asphalt' };
  }
  if (surface.includes('mixed') || surface.includes('concrete')) {
    return { route: '/calculators/corner-weight', label: 'corner-weight' };
  }
  // Fallback: landing page hero
  return { route: '/', label: 'landing' };
}

/**
 * Capture screenshots for a list of enriched tracks.
 * Returns a map of track abbreviation -> screenshot file path.
 */
async function captureRacenightScreenshots(tracks, config) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  const baseUrl = config.crew_chief_url || 'https://tenths.racing';
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '').slice(4); // MMDD

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  const screenshots = {};
  let loggedIn = false;

  try {
    for (const track of tracks) {
      const abbrev = track.abbreviation
        || (track.name && track.name.substring(0, 3).toUpperCase())
        || 'UNK';
      const { route, label } = getScreenshotRoute(track);
      const filename = `${abbrev}-${today}.png`;
      const filePath = path.join(SCREENSHOT_DIR, filename);

      try {
        // Login on first protected route
        if (route !== '/' && !loggedIn) {
          await page.goto(`${baseUrl}/sign-in`, { waitUntil: 'networkidle', timeout: 20000 });
          await page.fill('input[type="email"]', process.env.DEMO_USER_EMAIL);
          await page.fill('input[type="password"]', process.env.DEMO_USER_PASSWORD);
          await page.click('button[type="submit"]');
          await page.waitForURL('**/dashboard', { timeout: 15000 });
          loggedIn = true;
        }

        await page.goto(`${baseUrl}${route}`, {
          waitUntil: 'networkidle',
          timeout: 15000
        });
        await page.waitForTimeout(1500); // let animations settle

        await page.screenshot({ path: filePath, type: 'png' });
        screenshots[abbrev] = filePath;
        console.log(`[racenight-ss] Captured: ${track.name} (${label}) → ${filename}`);
      } catch (err) {
        console.error(`[racenight-ss] Failed: ${track.name}: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }

  return screenshots;
}

/**
 * Clean up screenshots older than N days.
 */
function cleanupOldScreenshots(days) {
  if (!fs.existsSync(SCREENSHOT_DIR)) return;
  const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
  const files = fs.readdirSync(SCREENSHOT_DIR);
  let cleaned = 0;
  for (const file of files) {
    const filePath = path.join(SCREENSHOT_DIR, file);
    const stat = fs.statSync(filePath);
    if (stat.isFile() && stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[racenight-ss] Cleaned up ${cleaned} old screenshots`);
}

module.exports = { captureRacenightScreenshots, cleanupOldScreenshots, getScreenshotRoute };
