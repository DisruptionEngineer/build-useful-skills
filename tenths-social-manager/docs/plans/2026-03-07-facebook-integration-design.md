# Facebook Integration for Tenths Social Manager

Date: 2026-03-07
Status: Approved

## Goal

Extend the existing tenths-social-manager skill to publish platform-native content to a "Tenths Racing" Facebook Page, with auto-generated app screenshots and an analytics feedback loop via Facebook Insights.

## Constraints

- Additive only — no changes to existing X/Twitter functionality
- Unified Discord queue — one generation pass, one approval flow for both platforms
- Facebook Page (not personal profile) via Meta Graph API
- Screenshots on Facebook posts only; X stays text-only

## 1. Content Generation

The AI prompt expands to produce platform-specific content in a single call.

- **X**: Unchanged — punchy, 280-char max
- **Facebook**: 2-4 sentences, more descriptive, hashtags, call-to-action. ~500 char target.

Content object grows from:
```json
{ "x": { "text": "...", "char_count": 234 } }
```
To:
```json
{
  "x": { "text": "...", "char_count": 234 },
  "fb": { "text": "...", "char_count": 412, "hashtags": ["#shorttrackracing", "#setuptips"] }
}
```

When analytics data exists, the generation prompt includes top 3 performing Facebook themes so the AI leans toward what resonates.

### Discord Draft Embed

Expands to show both previews in a single embed:

```
Draft: RACING TIP
---
X Post (234/280)
Your cross-weight % matters more than...
---
Facebook Post (412 chars)
Getting your cross-weight dialed in is the single biggest...
#shorttrackracing #setuptips
---
React: approve both / reject both
```

One set of reactions controls both platforms.

## 2. App Screenshots via Playwright

A Playwright script runs before each content generation batch.

### Flow

1. Launch headless Chromium
2. Navigate to tenths.racing login page
3. Log in as demo user (credentials from env vars)
4. Navigate to feature pages based on theme-to-page mapping
5. Take viewport screenshots at 1200x630 (Facebook recommended image size)
6. Save to `~/.agents/data/tenths-screenshots/`

### Theme-to-Page Mapping (in config)

```json
{
  "screenshot_pages": {
    "setup_advice": "/setup",
    "tech_explainer": "/engine-simulator",
    "feature_announcement": "/dashboard",
    "racing_tip": "/gear-ratios",
    "product_highlight": "/dashboard",
    "community_poll": null,
    "race_day_prompt": null
  }
}
```

- Themes with `null` get no screenshot (text-only posts)
- Screenshots refresh each generation cycle so they stay current
- Screenshots are Facebook-only; X posts remain text-only

### Environment Variables

```bash
export DEMO_USER_EMAIL="demo@tenths.racing"
export DEMO_USER_PASSWORD="your-demo-password"
```

## 3. Facebook Publishing

### Meta Graph API Setup

1. Create a Facebook App at developers.facebook.com
2. Create the "Tenths Racing" Facebook Page
3. Generate a long-lived Page Access Token (~60 days, auto-refreshable)
4. Required permissions: `pages_manage_posts`, `pages_read_engagement`

### Environment Variables

```bash
export FB_PAGE_ID="your-page-id"
export FB_PAGE_ACCESS_TOKEN="your-page-access-token"
export FB_APP_ID="your-app-id"
export FB_APP_SECRET="your-app-secret"
```

### Publishing Flow

- Posts with screenshots: `POST /{page-id}/photos` with message text and image upload
- Text-only posts: `POST /{page-id}/feed`
- Returns Facebook post ID, stored in `platform_post_ids.fb`
- On approval, both `postToX()` and `postToFacebook()` fire independently
- If one platform fails, the other still posts — failures tracked per platform

### Config Update

```json
{
  "platforms": {
    "x": { "enabled": true, "auto_post": true },
    "fb": { "enabled": true, "auto_post": true }
  }
}
```

Each platform can be independently enabled/disabled.

## 4. Facebook Insights & Analytics Feedback Loop

### Data Collection

A daily cron job pulls engagement metrics from `GET /{page-id}/posts?fields=insights` for posts from the last 30 days.

Metrics tracked per post: reactions, comments, shares, clicks, reach.

### Storage

File: `~/.agents/data/tenths-fb-insights.json`

```json
{
  "last_fetched": "2026-03-07T12:00:00Z",
  "posts": {
    "POST-0012": {
      "fb_post_id": "123456",
      "theme": "racing_tip",
      "posted_at": "2026-03-05T18:00:00Z",
      "metrics": { "reactions": 24, "comments": 5, "shares": 3, "clicks": 18, "reach": 412 }
    }
  },
  "theme_performance": {
    "racing_tip": { "avg_engagement": 42, "post_count": 8, "trend": "up" },
    "setup_advice": { "avg_engagement": 31, "post_count": 6, "trend": "stable" }
  }
}
```

### Feedback Into Content Generation

- `theme_performance` is recomputed each time insights are fetched
- Average engagement = reactions + comments + shares + clicks per post, grouped by theme
- Trend = comparing last 5 posts to prior 5 (up/stable/down)
- Generation prompt includes: "Top performing Facebook themes: racing_tip (avg 42, trending up), setup_advice (avg 31, stable). Lean toward high-performing themes but maintain variety."
- Soft nudge, not hard constraint — keeps content diverse

### Cron

```bash
# Daily at 6AM ET
0 10 * * * cd ~/.agents && node -e "require('./skills/tenths-social-manager/insights.js').fetchFBInsights()" 2>&1 >> ~/logs/tenths-social.log
```

## 5. Page Setup (Manual, One-Time)

- Copy `fb-profile.png` and `fb-banner.png` from `crew-chief/public/` to the Facebook Page
- Page name: Tenths Racing
- Category: Sports & Recreation > Motorsports
- Bio: "Every Tenth Matters. Setup tools, engine sims, and tech resources for short-track racers. tenths.racing"
- Website: https://tenths.racing
- CTA button: "Use App" pointing to https://tenths.racing

## New Files

| File | Purpose |
|------|---------|
| `publisher-fb.js` | Facebook Graph API posting (photo + text, text-only) |
| `screenshots.js` | Playwright screenshot automation (login, navigate, capture) |
| `insights.js` | Facebook Insights fetcher and theme performance calculator |

## Dependencies

- `playwright` — headless browser for screenshots
- `node-fetch` or built-in `fetch` — Meta Graph API calls (no SDK needed, REST API is simple)
