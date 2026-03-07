const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(process.env.HOME, '.agents', 'data', 'tenths-screenshots');
const BASE_URL = 'https://tenths.racing';

// Actual crew-chief app routes (behind Clerk auth)
const THEME_PAGES = {
  setup_advice: '/setup',
  tech_explainer: '/engine',
  feature_announcement: '/dashboard',
  racing_tip: '/calculators/gear-ratio',
  product_highlight: '/calculators',
  community_poll: null,
  race_day_prompt: null
};

async function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

async function loginAsDemo(page) {
  await page.goto(`${BASE_URL}/sign-in`, { waitUntil: 'networkidle' });
  await page.fill('input[name="identifier"]', process.env.DEMO_USER_EMAIL);
  await page.click('button:has-text("Continue")');
  await page.waitForSelector('input[type="password"]', { timeout: 10000 });
  await page.fill('input[type="password"]', process.env.DEMO_USER_PASSWORD);
  await page.click('button:has-text("Continue")');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
}

async function captureScreenshots() {
  await ensureScreenshotDir();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 2
  });
  const page = await context.newPage();

  try {
    await loginAsDemo(page);

    for (const [theme, route] of Object.entries(THEME_PAGES)) {
      if (!route) continue;
      try {
        await page.goto(`${BASE_URL}${route}`, {
          waitUntil: 'networkidle', timeout: 15000
        });
        await page.waitForTimeout(1000); // let animations settle
        const filePath = path.join(SCREENSHOT_DIR, `${theme}.png`);
        await page.screenshot({ path: filePath, type: 'png' });
        console.log(`[screenshots] Captured: ${theme} -> ${filePath}`);
      } catch (err) {
        console.error(
          `[screenshots] Failed: ${theme} (${route}): ${err.message}`
        );
      }
    }
  } finally {
    await browser.close();
  }
}

function getScreenshotPath(theme) {
  if (!THEME_PAGES[theme]) return null;
  const filePath = path.join(SCREENSHOT_DIR, `${theme}.png`);
  return fs.existsSync(filePath) ? filePath : null;
}

module.exports = { captureScreenshots, getScreenshotPath, THEME_PAGES };
