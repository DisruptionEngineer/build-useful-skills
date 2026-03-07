# Facebook Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extend tenths-social-manager to publish platform-native content to a "Tenths Racing" Facebook Page with auto-generated app screenshots and analytics-driven content.

**Architecture:** Three new modules (screenshots.js, publisher-fb.js, insights.js) plus updates to SKILL.md sections for config, content generation, embeds, reaction handling, publishing, and cron. All additive -- no changes to existing X functionality.

**Tech Stack:** Playwright (screenshots), Meta Graph API via fetch (publishing/insights), Node.js

**Design doc:** `docs/plans/2026-03-07-facebook-integration-design.md`

---

### Task 1: Create screenshots.js -- Playwright Screenshot Automation

**Files:**
- Create: `screenshots.js`

**Step 1: Create the screenshots module**

This module logs into tenths.racing as the demo user via Clerk, navigates to feature pages, and captures 1200x630 screenshots for Facebook posts.

```javascript
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
```

**Step 2: Verify Playwright is available**

Run: `npm ls playwright 2>/dev/null || echo "not installed"`

If not installed, note it as a dependency. Do NOT install yet -- just verify.

**Step 3: Commit**

```bash
git add screenshots.js
git commit -m "feat: add Playwright screenshot automation for Facebook posts"
```

---

### Task 2: Create publisher-fb.js -- Facebook Graph API Publishing

**Files:**
- Create: `publisher-fb.js`

**Step 1: Create the Facebook publisher module**

Uses the Meta Graph API directly via fetch (no SDK). Handles both photo+text and text-only posts, plus token refresh.

```javascript
const fs = require('fs');
const path = require('path');
const { getScreenshotPath } = require('./screenshots');

const GRAPH_API = 'https://graph.facebook.com/v19.0';

function getFBConfig() {
  return {
    pageId: process.env.FB_PAGE_ID,
    accessToken: process.env.FB_PAGE_ACCESS_TOKEN,
    appId: process.env.FB_APP_ID,
    appSecret: process.env.FB_APP_SECRET
  };
}

async function postToFacebook(post) {
  const { pageId, accessToken } = getFBConfig();
  if (!pageId || !accessToken) {
    throw new Error('FB_PAGE_ID or FB_PAGE_ACCESS_TOKEN not set');
  }

  const fbContent = post.content.fb;
  if (!fbContent || !fbContent.text) {
    throw new Error('No Facebook content in post');
  }

  const text = fbContent.hashtags && fbContent.hashtags.length
    ? `${fbContent.text}\n\n${fbContent.hashtags.join(' ')}`
    : fbContent.text;

  const screenshotPath = getScreenshotPath(post.theme);

  if (screenshotPath) {
    return await postWithPhoto(pageId, accessToken, text, screenshotPath);
  } else {
    return await postTextOnly(pageId, accessToken, text);
  }
}

async function postTextOnly(pageId, accessToken, message) {
  const res = await fetch(`${GRAPH_API}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, access_token: accessToken })
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.id;
}

async function postWithPhoto(pageId, accessToken, message, imagePath) {
  const { FormData } = await import('formdata-node');
  const { fileFromPath } = await import('formdata-node/file-from-path');

  const form = new FormData();
  form.set('message', message);
  form.set('access_token', accessToken);
  form.set('source', await fileFromPath(imagePath));

  const res = await fetch(`${GRAPH_API}/${pageId}/photos`, {
    method: 'POST',
    body: form
  });
  const data = await res.json();
  if (data.error) throw new Error(`FB API: ${data.error.message}`);
  return data.post_id || data.id;
}

async function refreshPageToken() {
  const { appId, appSecret, accessToken } = getFBConfig();
  if (!appId || !appSecret) {
    console.warn('[fb] Cannot refresh: FB_APP_ID or FB_APP_SECRET not set');
    return null;
  }
  const url = `${GRAPH_API}/oauth/access_token`
    + `?grant_type=fb_exchange_token`
    + `&client_id=${appId}`
    + `&client_secret=${appSecret}`
    + `&fb_exchange_token=${accessToken}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`FB token refresh: ${data.error.message}`);
  }
  return data.access_token;
}

module.exports = { postToFacebook, refreshPageToken };
```

**Step 2: Commit**

```bash
git add publisher-fb.js
git commit -m "feat: add Facebook Graph API publisher with photo support"
```

---

### Task 3: Create insights.js -- Facebook Insights Fetcher

**Files:**
- Create: `insights.js`

**Step 1: Create the insights module**

Pulls engagement metrics from Facebook, computes per-theme performance, and stores results for the content generation feedback loop.

```javascript
const fs = require('fs');
const path = require('path');

const GRAPH_API = 'https://graph.facebook.com/v19.0';
const INSIGHTS_PATH = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-fb-insights.json'
);
const QUEUE_PATH = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-social-queue.json'
);

function loadInsights() {
  try {
    return JSON.parse(fs.readFileSync(INSIGHTS_PATH, 'utf8'));
  } catch {
    return { last_fetched: null, posts: {}, theme_performance: {} };
  }
}

function saveInsights(data) {
  fs.mkdirSync(path.dirname(INSIGHTS_PATH), { recursive: true });
  fs.writeFileSync(INSIGHTS_PATH, JSON.stringify(data, null, 2));
}

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return { posts: [] };
  }
}

async function fetchFBInsights() {
  const pageId = process.env.FB_PAGE_ID;
  const accessToken = process.env.FB_PAGE_ACCESS_TOKEN;
  if (!pageId || !accessToken) {
    console.error('[insights] FB credentials not set');
    return;
  }

  const since = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  const fields = 'id,created_time,insights.metric('
    + 'post_reactions_by_type_total,post_comments,post_shares,post_clicks)';
  const url = `${GRAPH_API}/${pageId}/posts`
    + `?fields=${fields}&since=${since}`
    + `&access_token=${accessToken}&limit=100`;

  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    console.error(`[insights] FB API error: ${data.error.message}`);
    return;
  }

  const insights = loadInsights();
  const queue = loadQueue();

  // Map FB post IDs back to queue posts
  const fbIdToPost = {};
  for (const post of queue.posts) {
    if (post.platform_post_ids && post.platform_post_ids.fb) {
      fbIdToPost[post.platform_post_ids.fb] = post;
    }
  }

  for (const fbPost of (data.data || [])) {
    const queuePost = fbIdToPost[fbPost.id];
    if (!queuePost) continue;

    const metrics = extractMetrics(
      (fbPost.insights && fbPost.insights.data) || []
    );
    insights.posts[queuePost.id] = {
      fb_post_id: fbPost.id,
      theme: queuePost.theme,
      posted_at: fbPost.created_time,
      metrics
    };
  }

  insights.theme_performance = computeThemePerformance(insights.posts);
  insights.last_fetched = new Date().toISOString();
  saveInsights(insights);
  console.log(
    `[insights] Updated: ${Object.keys(insights.posts).length} posts, `
    + `${Object.keys(insights.theme_performance).length} themes`
  );
}

function extractMetrics(insightsData) {
  const m = { reactions: 0, comments: 0, shares: 0, clicks: 0 };
  for (const metric of insightsData) {
    const val = metric.values && metric.values[0] && metric.values[0].value;
    if (!val) continue;
    switch (metric.name) {
      case 'post_reactions_by_type_total':
        m.reactions = typeof val === 'object'
          ? Object.values(val).reduce((a, b) => a + b, 0)
          : val;
        break;
      case 'post_comments': m.comments = val; break;
      case 'post_shares': m.shares = val; break;
      case 'post_clicks': m.clicks = val; break;
    }
  }
  return m;
}

function computeThemePerformance(posts) {
  const byTheme = {};
  for (const post of Object.values(posts)) {
    if (!byTheme[post.theme]) byTheme[post.theme] = [];
    const m = post.metrics;
    byTheme[post.theme].push({
      engagement: m.reactions + m.comments + m.shares + m.clicks,
      posted_at: post.posted_at
    });
  }

  const perf = {};
  for (const [theme, entries] of Object.entries(byTheme)) {
    entries.sort((a, b) => new Date(b.posted_at) - new Date(a.posted_at));
    const total = entries.reduce((s, e) => s + e.engagement, 0);
    const avg = Math.round(total / entries.length);

    let trend = 'stable';
    if (entries.length >= 6) {
      const recentAvg = entries.slice(0, 5)
        .reduce((s, e) => s + e.engagement, 0) / 5;
      const priorCount = Math.min(entries.length - 5, 5);
      const priorAvg = entries.slice(5, 10)
        .reduce((s, e) => s + e.engagement, 0) / priorCount;
      if (recentAvg > priorAvg * 1.2) trend = 'up';
      else if (recentAvg < priorAvg * 0.8) trend = 'down';
    }

    perf[theme] = { avg_engagement: avg, post_count: entries.length, trend };
  }
  return perf;
}

function getTopThemes(limit) {
  limit = limit || 3;
  const insights = loadInsights();
  return Object.entries(insights.theme_performance)
    .sort((a, b) => b[1].avg_engagement - a[1].avg_engagement)
    .slice(0, limit)
    .map(([theme, data]) =>
      `${theme.replace(/_/g, ' ')} (avg ${data.avg_engagement}, trending ${data.trend})`
    );
}

module.exports = { fetchFBInsights, loadInsights, getTopThemes };
```

**Step 2: Commit**

```bash
git add insights.js
git commit -m "feat: add Facebook Insights fetcher with theme performance tracking"
```

---

### Task 4: Update SKILL.md -- Prerequisites and Config

**Files:**
- Modify: `SKILL.md`

**Step 1: Add Facebook env vars to Prerequisites section (after line 33)**

Add these lines after the existing Supabase env vars block:

```bash
# Facebook Page (Meta Graph API)
export FB_PAGE_ID="your-page-id"
export FB_PAGE_ACCESS_TOKEN="your-page-access-token"
export FB_APP_ID="your-app-id"
export FB_APP_SECRET="your-app-secret"
# Demo user for screenshots (Clerk auth)
export DEMO_USER_EMAIL="demo@tenths.racing"
export DEMO_USER_PASSWORD="your-demo-password"
```

**Step 2: Update config JSON to include fb platform and screenshot_pages (line 41-49)**

Replace the config JSON block with:

```json
{
  "schedule": {
    "generate_days": ["monday","thursday"],
    "generate_time": "08:00",
    "post_times": ["12:00","18:00"],
    "timezone": "America/New_York"
  },
  "platforms": {
    "x": { "enabled": true, "auto_post": true },
    "fb": { "enabled": true, "auto_post": true }
  },
  "content_themes": [
    "feature_announcement","racing_tip","setup_advice",
    "community_poll","race_day_prompt","tech_explainer","product_highlight"
  ],
  "screenshot_pages": {
    "setup_advice": "/setup",
    "tech_explainer": "/engine",
    "feature_announcement": "/dashboard",
    "racing_tip": "/calculators/gear-ratio",
    "product_highlight": "/calculators",
    "community_poll": null,
    "race_day_prompt": null
  },
  "brand": {
    "name": "Tenths",
    "tagline": "Every Tenth Matters.",
    "url": "https://tenths.racing",
    "color": "#FF8A00",
    "voice": "Technical but approachable. Talk like a fellow racer in the pits, not a marketing team. Short sentences. Use racing terminology naturally."
  }
}
```

**Step 3: Update queue example to show fb content (line 56-58)**

Replace the queue JSON example with:

```json
{
  "posts": [{
    "id": "POST-0001", "status": "draft", "theme": "racing_tip",
    "content": {
      "x": { "text": "Your cross-weight % matters more than...", "char_count": 234 },
      "fb": {
        "text": "Getting your cross-weight dialed in is the single biggest...",
        "char_count": 412,
        "hashtags": ["#shorttrackracing", "#setuptips"]
      }
    },
    "scheduled_at": null, "posted_at": null,
    "discord_message_id": null, "platform_post_ids": {}
  }]
}
```

**Step 4: Commit**

```bash
git add SKILL.md
git commit -m "feat: update config with Facebook platform and screenshot pages"
```

---

### Task 5: Update SKILL.md -- Content Generation

**Files:**
- Modify: `SKILL.md`

**Step 1: Add insights and screenshots imports (after line 89)**

Add after the existing requires:

```javascript
const { getTopThemes } = require('./insights');
const { captureScreenshots } = require('./screenshots');
```

**Step 2: Update handleGenerate to capture screenshots before generation (line 156-177)**

Replace `handleGenerate` with:

```javascript
async function handleGenerate(message, theme) {
  await message.react('⏳');
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const context = buildContentContext(config, theme);
  try {
    // Capture fresh screenshots before generating content
    try { await captureScreenshots(); } catch (err) {
      console.warn('[tenths-social] Screenshot capture failed:', err.message);
    }
    const drafts = await generateDrafts(context, theme);
    const queue = loadQueue();
    let nextId = queue.posts.length + 1;
    for (const draft of drafts) {
      const post = {
        id: `POST-${String(nextId++).padStart(4, '0')}`,
        created_at: new Date().toISOString(),
        status: 'draft', theme: draft.theme, content: draft.content,
        scheduled_at: null, posted_at: null,
        discord_message_id: null, platform_post_ids: {}
      };
      const sent = await message.channel.send({
        embeds: [buildDraftEmbed(post)]
      });
      await sent.react('✅');
      await sent.react('✏️');
      await sent.react('❌');
      post.discord_message_id = sent.id;
      queue.posts.push(post);
    }
    saveQueue(queue);
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('🏁');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('❌');
    await message.reply(
      `Generation failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``
    );
  }
}
```

**Step 3: Update buildContentContext to include FB analytics (line 179-191)**

Replace `buildContentContext` with:

```javascript
function buildContentContext(config, theme) {
  let changelog = '';
  try {
    changelog = execSync(
      'git log --oneline --since="14 days ago" --no-merges',
      { cwd: REPO_PATH, encoding: 'utf8', timeout: 10000 }
    ).trim();
  } catch { changelog = 'No recent commits'; }
  const m = new Date().getMonth();
  const topThemes = getTopThemes(3);
  return {
    brand: config.brand, changelog,
    racingSeason: (m >= 3 && m <= 9) ? 'in-season' : 'off-season',
    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
    requestedTheme: theme || null,
    availableThemes: config.content_themes,
    features: [
      'Setup calculator', 'Engine simulator', 'Corner weight calc',
      'Gear ratio calc', 'Diagnostic troubleshooter', 'Session logger',
      'Division rulebooks (2026)', 'Tech inspection checklists'
    ],
    divisions: [
      'Ironman F8', 'Old School F8', 'Street Stock',
      'Juicebox', 'Compacts'
    ],
    targetAudience: 'Short-track racers who wrench their own cars.',
    fbTopThemes: topThemes
  };
}
```

**Step 4: Update generateDrafts prompt for dual-platform output (line 193-218)**

Replace `generateDrafts` with:

```javascript
async function generateDrafts(context, theme) {
  const fbInsightLine = context.fbTopThemes.length
    ? `\nFB TOP THEMES: ${context.fbTopThemes.join('; ')}. Lean toward these but maintain variety.`
    : '';

  const prompt = `Generate 2-3 social posts for Tenths racing app (tenths.racing).
VOICE: ${context.brand.voice} | TAGLINE: ${context.brand.tagline}
SEASON: ${context.racingSeason} | DAY: ${context.dayOfWeek}
${context.requestedTheme
    ? `THEME: ${context.requestedTheme}`
    : `THEMES: ${context.availableThemes.join(', ')}`}
CHANGELOG: ${context.changelog}
FEATURES: ${context.features.join('; ')}
DIVISIONS: ${context.divisions.join(', ')}
AUDIENCE: ${context.targetAudience}${fbInsightLine}

Generate for TWO platforms per post:
- x: Punchy tweet, max 280 chars
- fb: Facebook post, 2-4 descriptive sentences (~500 chars), include hashtags and call-to-action to tenths.racing

Return JSON array:
[{ theme, content: { x: { text, char_count }, fb: { text, char_count, hashtags: [] } } }]`;

  const escaped = prompt.replace(/'/g, "'\\''");
  try {
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --json --thinking medium --timeout 120`,
      { encoding: 'utf8', timeout: 150000, maxBuffer: 5 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    if (!envelope.success) {
      throw new Error(envelope.error || 'OpenClaw agent failed');
    }
    const text = envelope.result || envelope.content || envelope.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');
    return JSON.parse(match[0]);
  } catch (err) {
    console.warn('[tenths-social] OpenClaw failed, fallback:', err.message);
    return generateFallbackDrafts(context);
  }
}
```

**Step 5: Commit**

```bash
git add SKILL.md
git commit -m "feat: update content generation for dual-platform X + Facebook"
```

---

### Task 6: Update SKILL.md -- Discord Embeds (Draft + Quick Post)

**Files:**
- Modify: `SKILL.md`

**Step 1: Update buildDraftEmbed to show both platforms (line 243-248)**

Replace `buildDraftEmbed` with:

```javascript
function buildDraftEmbed(post) {
  const embed = new EmbedBuilder()
    .setTitle(`🏁 Draft: ${post.theme.replace(/_/g, ' ').toUpperCase()}`)
    .setColor(0xFF8A00)
    .addFields({
      name: '𝕏 Post',
      value: `\`\`\`\n${post.content.x.text}\n\`\`\`\n${post.content.x.char_count}/280 chars`
    });

  if (post.content.fb) {
    const fbText = post.content.fb.hashtags && post.content.fb.hashtags.length
      ? `${post.content.fb.text}\n${post.content.fb.hashtags.join(' ')}`
      : post.content.fb.text;
    embed.addFields({
      name: '📘 Facebook Post',
      value: `\`\`\`\n${fbText}\n\`\`\`\n${post.content.fb.char_count} chars`
    });
  }

  return embed.setTimestamp()
    .setFooter({ text: `${post.id} · React: ✅ approve · ✏️ edit · ❌ reject` });
}
```

**Step 2: Update handleQuickPost to include fb content (line 226-241)**

Replace `handleQuickPost` with:

```javascript
async function handleQuickPost(message, text) {
  if (!text || !text.trim()) {
    return message.reply('Usage: `!tenths quick Your tweet text here`');
  }
  text = text.trim();
  if (text.length > 280) {
    return message.reply(
      `${text.length}/280 chars. Shorten by ${text.length - 280}.`
    );
  }
  const queue = loadQueue();
  const post = {
    id: `POST-${String(queue.posts.length + 1).padStart(4, '0')}`,
    created_at: new Date().toISOString(),
    status: 'quick-draft', theme: 'on_demand',
    content: {
      x: { text, char_count: text.length },
      fb: { text, char_count: text.length, hashtags: [] }
    },
    scheduled_at: null, posted_at: null,
    discord_message_id: null, platform_post_ids: {}
  };
  const embed = new EmbedBuilder()
    .setTitle('⚡ Quick Post Preview').setColor(0xFF8A00)
    .addFields(
      { name: '𝕏 Post', value: `\`\`\`\n${text}\n\`\`\`\n${text.length}/280 chars` },
      { name: '📘 Facebook Post', value: `\`\`\`\n${text}\n\`\`\`\n${text.length} chars` }
    )
    .setTimestamp()
    .setFooter({ text: `${post.id} · ✅ post now · ❌ discard` });
  const sent = await message.channel.send({ embeds: [embed] });
  await sent.react('✅');
  await sent.react('❌');
  post.discord_message_id = sent.id;
  queue.posts.push(post);
  saveQueue(queue);
}
```

**Step 3: Commit**

```bash
git add SKILL.md
git commit -m "feat: update Discord embeds to show both X and Facebook previews"
```

---

### Task 7: Update SKILL.md -- Publishing and Reaction Handler

**Files:**
- Modify: `SKILL.md`

**Step 1: Replace Platform Publishing section (line 305-316)**

Replace with:

```javascript
const { TwitterApi } = require('twitter-api-v2');
const { postToFacebook } = require('./publisher-fb');

const xClient = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET
});

async function postToX(post) {
  const { data } = await xClient.v2.tweet(post.content.x.text);
  return data.id;
}

async function publishToAllPlatforms(post) {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const results = {};
  const errors = [];

  if (config.platforms.x && config.platforms.x.enabled) {
    try { results.x = await postToX(post); }
    catch (err) {
      results.x = { error: err.message };
      errors.push(`X: ${err.message}`);
    }
  }

  if (config.platforms.fb && config.platforms.fb.enabled && post.content.fb) {
    try { results.fb = await postToFacebook(post); }
    catch (err) {
      results.fb = { error: err.message };
      errors.push(`FB: ${err.message}`);
    }
  }

  return {
    results,
    errors,
    allFailed: errors.length > 0
      && Object.keys(results).every(function(k) { return results[k] && results[k].error; })
  };
}
```

**Step 2: Update the quick-draft approval in reaction handler (line 278-288)**

Replace the quick-draft approval block with:

```javascript
    if (post.status === 'quick-draft') {
      try {
        const { results, errors, allFailed } = await publishToAllPlatforms(post);
        post.platform_post_ids = results;
        post.status = allFailed ? 'failed' : 'posted';
        post.posted_at = allFailed ? undefined : new Date().toISOString();
        if (allFailed) post.failed_at = new Date().toISOString();
        saveQueue(queue);

        const links = [];
        if (results.x && !results.x.error) {
          links.push(`𝕏: https://x.com/TenthsRacing/status/${results.x}`);
        }
        if (results.fb && !results.fb.error) {
          links.push('📘 FB: posted');
        }

        const embed = new EmbedBuilder().setTimestamp();
        if (allFailed) {
          embed.setTitle(`❌ Post Failed: ${post.id}`).setColor(0xe74c3c)
            .setDescription(errors.join('\n'));
        } else {
          embed.setTitle(`🏁 Posted: ${post.id}`).setColor(0x2ecc71)
            .setDescription(
              links.join('\n')
              + (errors.length ? `\n⚠️ Partial: ${errors.join(', ')}` : '')
            );
        }
        await ch.send({ embeds: [embed] });
      } catch (err) {
        post.platform_post_ids = { x: { error: err.message } };
        saveQueue(queue);
        await ch.send(`❌ Post failed: \`${err.message.slice(0, 200)}\``);
      }
    }
```

**Step 3: Update checkAndPublish for multi-platform (line 322-342)**

Replace `checkAndPublish` with:

```javascript
async function checkAndPublish() {
  const queue = loadQueue();
  const now = new Date();
  const due = queue.posts.filter(function(p) {
    return p.status === 'approved' && p.scheduled_at
      && new Date(p.scheduled_at) <= now;
  });
  let changed = false;
  for (const post of due) {
    const { results, errors, allFailed } = await publishToAllPlatforms(post);
    post.platform_post_ids = results;
    if (allFailed) {
      post.status = 'failed';
      post.failed_at = now.toISOString();
      console.error(
        `[tenths-social] Post ${post.id} failed:`, errors.join('; ')
      );
    } else {
      post.status = 'posted';
      post.posted_at = now.toISOString();
      if (errors.length) {
        console.warn(
          `[tenths-social] Post ${post.id} partial:`, errors.join('; ')
        );
      }
    }
    changed = true;
  }
  if (changed) saveQueue(queue);
}
```

**Step 4: Update handleHistory to show both platform statuses (line 362-369)**

Replace `handleHistory` with:

```javascript
async function handleHistory(message, count) {
  const posted = loadQueue().posts.filter(function(p) {
    return p.status === 'posted';
  }).sort(function(a, b) {
    return new Date(b.posted_at) - new Date(a.posted_at);
  }).slice(0, count);
  if (!posted.length) return message.reply('No posts yet.');
  await message.channel.send({ embeds: [new EmbedBuilder()
    .setTitle('🏁 Recent Posts').setColor(0xFF8A00)
    .setDescription(posted.map(function(p, i) {
      const xOk = p.platform_post_ids && p.platform_post_ids.x
        && !p.platform_post_ids.x.error;
      const fbOk = p.platform_post_ids && p.platform_post_ids.fb
        && !p.platform_post_ids.fb.error;
      return `**${i+1}.** ${new Date(p.posted_at).toLocaleDateString()}`
        + ` — ${p.theme.replace(/_/g,' ')}`
        + ` ${xOk ? '𝕏 ✓' : '𝕏 ✗'} ${fbOk ? '📘 ✓' : '📘 ✗'}`;
    }).join('\n'))] });
}
```

**Step 5: Commit**

```bash
git add SKILL.md
git commit -m "feat: update publishing and reactions for dual-platform X + Facebook"
```

---

### Task 8: Update SKILL.md -- Cron, Troubleshooting, Tips, and Metadata

**Files:**
- Modify: `SKILL.md`

**Step 1: Update frontmatter description (line 3)**

Replace description with:

```
description: Manage social media for tenths.racing on X/Twitter and Facebook via Discord. Use when generating draft social posts, reviewing content batches, approving or rejecting scheduled posts, posting to X and Facebook, checking post history, auto-publishing approved content, managing the content calendar, looking up or adding tracks/cars/tires to Supabase, researching racing data, or creating promo/trial links for Tenths Pro.
```

**Step 2: Update opening paragraph (line 9)**

Replace with:

```
Generate, review, and publish social media content for tenths.racing on X/Twitter and Facebook. Twice weekly, the agent generates 2-3 draft posts (platform-native for both X and Facebook) using AI, posts them as rich embeds to Discord for review, and auto-publishes approved content at scheduled times. Facebook posts include auto-generated app screenshots. Facebook Insights analytics feed back into content generation to optimize themes. Also manages the Supabase racing database -- look up, research, and insert tracks, cars, and tires via Discord commands.
```

**Step 3: Update cron section (line 346-349)**

Replace the cron block with:

```bash
# Cron: generate Mon/Thu 8AM ET, publish every 15min, insights daily 6AM ET
0 12 * * 1,4 cd ~/.agents && openclaw agent --message "Run !tenths generate in #tenths-social" --timeout 120 2>&1 >> ~/logs/tenths-social.log
*/15 * * * * cd ~/.agents && node -e "require('./skills/tenths-social-manager/publisher.js').checkAndPublish()" 2>&1 >> ~/logs/tenths-social.log
0 10 * * * cd ~/.agents && node -e "require('./skills/tenths-social-manager/insights.js').fetchFBInsights()" 2>&1 >> ~/logs/tenths-social.log
```

**Step 4: Add Facebook to Platform Setup section (after line 606)**

Add:

```
Facebook: developers.facebook.com -> Create App -> Add Facebook Login + Pages API products -> Create "Tenths Racing" Page -> Graph API Explorer -> Get Page Access Token with pages_manage_posts, pages_read_engagement -> Exchange for long-lived token. Set profile pic and cover photo from crew-chief/public/fb-profile.png and fb-banner.png.
```

**Step 5: Add Facebook troubleshooting entries (after line 619)**

Add to the troubleshooting block:

```bash
# FB "OAuthException" -> Page Access Token expired. Run refreshPageToken() or regenerate in Graph Explorer.
# FB "Unsupported post request" -> check FB_PAGE_ID is the Page ID, not the App ID.
# FB photo upload fails -> ensure formdata-node is installed: npm install formdata-node
# Screenshots blank/login page -> DEMO_USER_EMAIL/PASSWORD wrong or Clerk login flow changed.
# Playwright not found -> npm install playwright && npx playwright install chromium
# Screenshots stale -> captureScreenshots() runs before each generate. Check logs for errors.
# FB insights empty -> Page needs >= 100 followers for some metrics. Basic metrics work immediately.
```

**Step 6: Add Facebook tips (before line 631)**

Add:

```
- Facebook posts include screenshots for visual themes (setup_advice, tech_explainer, etc). Text-only for polls and race-day prompts.
- FB insights drive content themes after ~2 weeks of data. Initial posts use even theme distribution.
- Page Access Tokens expire ~60 days. Set a calendar reminder or use refreshPageToken() in publisher-fb.js.
- Dependencies: playwright, formdata-node. Install with: npm install playwright formdata-node && npx playwright install chromium
```

**Step 7: Add Data Files subsection for insights (after the Queue subsection)**

Add:

```markdown
### Facebook Insights -- `~/.agents/data/tenths-fb-insights.json`

Engagement metrics per post and aggregated theme performance. Updated daily by cron.

```json
{
  "last_fetched": "2026-03-07T12:00:00Z",
  "posts": {
    "POST-0012": {
      "fb_post_id": "123456", "theme": "racing_tip",
      "metrics": { "reactions": 24, "comments": 5, "shares": 3, "clicks": 18 }
    }
  },
  "theme_performance": {
    "racing_tip": { "avg_engagement": 42, "post_count": 8, "trend": "up" }
  }
}
```
```

**Step 8: Add App Screenshots and Facebook Insights reference sections (after Platform Publishing)**

Add two new sections:

````markdown
## App Screenshots

Playwright captures screenshots of tenths.racing feature pages for Facebook posts. Runs before each content generation batch.

```javascript
const { captureScreenshots, getScreenshotPath, THEME_PAGES } = require('./screenshots');
// captureScreenshots() -- logs in as demo user, navigates each theme page, saves 1200x630 PNGs
// getScreenshotPath(theme) -- returns file path if screenshot exists, null otherwise
// See screenshots.js for full implementation
```

## Facebook Insights

Daily cron fetches engagement metrics from the Facebook Page and computes per-theme performance.

```javascript
const { fetchFBInsights, getTopThemes } = require('./insights');
// fetchFBInsights() -- pulls last 30 days of post metrics, computes theme_performance
// getTopThemes(3) -- returns ["racing tip (avg 42, trending up)", ...] for generation prompt
// Data stored in ~/.agents/data/tenths-fb-insights.json
// See insights.js for full implementation
```
````

**Step 9: Commit**

```bash
git add SKILL.md
git commit -m "feat: complete Facebook integration -- metadata, cron, troubleshooting, docs"
```

---

### Task 9: Final Verification

**Step 1: Syntax-check new modules**

Run:
```bash
node -c screenshots.js && echo "screenshots.js OK"
node -c publisher-fb.js && echo "publisher-fb.js OK"
node -c insights.js && echo "insights.js OK"
```

Expected: All three report "OK".

**Step 2: Read full SKILL.md and verify**

Check:
- Frontmatter description mentions Facebook
- Opening paragraph mentions Facebook, screenshots, insights
- Config has `platforms.fb` and `screenshot_pages`
- Queue example has `fb` content
- Imports include insights.js and screenshots.js
- `handleGenerate` calls `captureScreenshots()`
- `buildContentContext` calls `getTopThemes()`
- `generateDrafts` prompt asks for both x and fb content
- `buildDraftEmbed` shows Facebook preview
- `handleQuickPost` includes fb content
- `publishToAllPlatforms` calls both `postToX` and `postToFacebook`
- `checkAndPublish` uses `publishToAllPlatforms`
- `handleHistory` shows both platform statuses
- Cron includes insights job
- Troubleshooting has Facebook entries
- Tips section has Facebook entries

**Step 3: Verify clean git state**

Run: `git status`

Expected: Clean working tree.

**Step 4: Final cleanup commit if needed**

```bash
git add -A
git commit -m "chore: final cleanup for Facebook integration"
```
