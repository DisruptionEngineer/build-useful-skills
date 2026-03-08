# Race Night Automation — Design Document

**Date:** 2026-03-08
**Projects:** tenths-social-manager (primary), crew-chief (promo/subscription changes)
**Approach:** Extend tenths-social-manager with `!tenths racenight` command

---

## Overview

Automate a race-night promotional workflow: discover tonight's races via MyRacePass, generate personalized Facebook posts with physics-informed tips per track, create time-limited free Pro promos (10 uses, expires 6 AM), and publish with track @tags — all triggered by a single Discord command.

---

## 1. End-to-End Workflow

```
!tenths racenight [optional state override]
       │
       ▼
  1. DISCOVER — Scrape MyRacePass for tonight's races
     filtered by configured regions & divisions
       │
       ▼
  2. ENRICH — Per track: check Supabase cache or AI-research
     new tracks. Fetch tonight's weather via Open-Meteo.
       │
       ▼
  3. GENERATE — Per track: AI produces personalized Facebook
     post + race tip using crew-chief physics knowledge.
       │
       ▼
  4. SCREENSHOT — Playwright captures context-specific app
     screenshots (setup calc for dirt, gear ratio for F8, etc.)
       │
       ▼
  5. PREVIEW — Discord embeds per track with draft post,
     promo details, screenshot info. React to approve/edit/skip.
       │
       ▼
  6. PUBLISH — On approval: create promo in Supabase,
     post to Facebook with track @tag + screenshot + promo link.
```

---

## 2. Race Discovery

### Data Sources
- **Primary:** MyRacePass (Playwright scraping)
- **Supplementary:** Individual track websites (future expansion)

### Configuration (`~/.agents/data/tenths-racenight-config.json`)
```json
{
  "regions": ["OH", "PA", "MI", "IN", "WV", "KY"],
  "divisions": ["figure-8", "street-stock", "compact", "factory-stock", "hornet"],
  "max_tracks_per_run": 20,
  "promo_max_uses": 10,
  "promo_expiry_hour_utc": 10,
  "screenshot_cleanup_days": 7,
  "crew_chief_url": "https://tenths.racing"
}
```

### Scraping Strategy
1. Navigate MyRacePass schedule pages for today's date
2. Extract: track name, location, state, divisions racing, start time
3. Filter by configured `regions` (state abbreviation) and `divisions` (fuzzy match)
4. Deduplicate against Supabase `tracks` table
5. Cap at `max_tracks_per_run`, prioritizing known tracks
6. Optional state override: `!tenths racenight TX`

### Per-Track Output
```json
{
  "name": "Painesville Speedway",
  "state": "OH",
  "divisions_tonight": ["Ironman F8", "Street Stock", "Compacts"],
  "start_time": "6:00 PM",
  "myracepass_url": "https://www.myracepass.com/tracks/...",
  "is_known": true
}
```

---

## 3. Track Enrichment & Tip Generation

### Enrichment Flow
1. **Known track** → Use cached Supabase data (surface, length, banking, shape, Facebook URL)
2. **New track** → AI researches specs, saves to Supabase (reuses `!tenths addtrack` logic)
3. **Weather** → Open-Meteo API with track lat/lng for tonight's conditions

### Tip Generation — Crew-Chief Physics Knowledge Pack

The AI prompt is injected with domain knowledge extracted from crew-chief:

- **Surface handling:** Dirt vs asphalt vs mixed — grip levels, weather effects
- **Tire compounds:** Hoosier D-series (dirt, 9-16 psi), F-series (asphalt, 18-36 psi), G60 (dual-surface)
- **Weight distribution:** Left-side %, cross-weight %, rear % effects on handling per track shape
- **Cornering physics:** Roll stiffness, load transfer, understeer gradient as practical tips
- **Division constraints:** Legal parts/specs per class (e.g., Holley 4412 only in Ironman F8)

Tips are specific to the track's surface, tonight's weather, and the divisions running.

---

## 4. Promo System — Racenight Grants

### Promo Code Format
`TENTHS-{TRACK_ABBREV}-{MMDD}` (e.g., `TENTHS-ELD-0315`)

### Promo Record
```json
{
  "code": "TENTHS-ELD-0315",
  "trial_days": 1,
  "max_uses": 10,
  "valid_from": "2026-03-15T15:00:00Z",
  "valid_until": "2026-03-16T10:00:00Z",
  "description": "Race night promo - Eldora Speedway 3/15",
  "is_active": true,
  "racenight": true
}
```

### Differences from Regular Promos

| Attribute | Regular Promo | Racenight Promo |
|-----------|--------------|-----------------|
| Trial length | 30 days | 1 day (expires 6 AM) |
| Max uses | Unlimited | 10 |
| Credit card | Required | Not required |
| Valid window | 90 days | ~15 hours |
| Creation | Manual | Auto-generated |

### Redemption Flow (crew-chief changes)
1. User visits `tenths.racing/promo/TENTHS-ELD-0315`
2. Detects `racenight: true` → email-only signup (Supabase Auth, no Stripe)
3. Creates `racenight_grants` record with `expires_at` = 6 AM next morning
4. User gets immediate Pro access
5. Hourly cron/edge function deactivates expired grants

### Pro Access Check (SubscriptionProvider)
- Active Stripe subscription → Pro
- Active racenight grant (not expired) → Pro
- Neither → Free tier

---

## 5. Facebook Post Format

### Structure
```
🏁 Racing TONIGHT at [Track Name]!

[1-2 sentences: surface, conditions, divisions tonight.
Specific to this track.]

💡 [1-2 sentence race tip grounded in crew-chief physics.
Tire pressure, setup, driving technique for tonight.]

🎁 First 10 racers get FREE full access to Tenths tonight —
your crew chief in your pocket. No credit card needed.

👉 tenths.racing/promo/TENTHS-XXX-MMDD

@[TrackFacebookPage]

#ShortTrackRacing #[TrackHashtag] #RaceNight #[DivisionTag]
```

### Track Facebook Tagging
- `facebook_page_url` stored in Supabase `tracks` table
- Discovered during AI research step for new tracks
- Omitted if not found (post still works without @tag)

---

## 6. Dynamic Screenshot Strategy

### Per-Track Contextual Screenshots
Playwright captures app screenshots with values relevant to each track:

| Track Context | App Page | Content Shown |
|---------------|----------|---------------|
| Dirt oval | `/setup` | Setup rec with dirt tire pressures, spring rates |
| Asphalt oval | `/setup` | Setup rec with asphalt compounds, higher pressures |
| Figure-8 | `/calculators/gear-ratio` | RPM chart for figure-8 speeds |
| Mixed surface | `/calculators/corner-weight` | Corner weight balance calculator |
| Engine class | `/engine` | Power curve for division's allowed engine |
| Fallback | Landing hero | Main Tenths hero section |

### Dynamic Value Injection
- Navigate to relevant page as demo user
- Pre-fill forms with track-appropriate values (surface, conditions, etc.)
- Capture at 1200x630 @ 2x (Facebook recommended)
- Stored: `~/.agents/data/tenths-racenight-screenshots/{TRACK_ABBREV}-{MMDD}.png`
- Auto-cleanup after 7 days

---

## 7. Discord UX

### Command
```
!tenths racenight [optional state]
```

### Flow
1. **Discovery message** — "Searching MyRacePass... Found N tracks."
2. **Per-track embeds** — One embed each with:
   - Track info (name, location, surface, length, banking)
   - Divisions racing tonight + weather
   - Draft Facebook post text
   - Race tip preview
   - Promo code + link + expiry
   - Screenshot type
   - FB tag target
   - Reactions: ✅ Approve | ✏️ Edit | ❌ Skip
3. **Summary embed** — "N tracks found | 0 approved | 0 skipped"
   - Reactions: ✅ Approve ALL | ❌ Cancel ALL

### Reaction Behavior
- **✅ on track embed** → Create promo in Supabase + publish to Facebook
- **✅ on summary** → Approve all unapproved tracks at once
- **✏️** → Bot asks for edits, regenerates post
- **❌ on track** → Skip, no promo created
- **❌ on summary** → Cancel all remaining

**Promos are only created after approval**, not during generation.

---

## 8. Data Model Changes

### Supabase Schema Changes (crew-chief)

**`tracks` table — new columns:**
- `facebook_page_url` text nullable
- `abbreviation` text nullable
- `lat` float nullable
- `lng` float nullable

**`promotions` table — new column:**
- `racenight` boolean default false

**New table: `racenight_grants`:**
```sql
CREATE TABLE racenight_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  promo_code text NOT NULL,
  track_name text NOT NULL,
  granted_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  is_active boolean DEFAULT true
);
```

**Expiry enforcement:**
```sql
-- Hourly cron or edge function
UPDATE racenight_grants
SET is_active = false
WHERE expires_at < now() AND is_active = true;
```

### New Social Manager Files

| File | Purpose |
|------|---------|
| `racenight.js` | Main orchestrator |
| `scraper-myracepass.js` | Playwright MyRacePass scraper |
| `track-enrichment.js` | AI research + Supabase cache |
| `tip-generator.js` | Crew-chief physics prompt builder |
| `racenight-screenshots.js` | Dynamic Playwright screenshot capture |

---

## 9. Success Criteria

- `!tenths racenight` returns track results within 60 seconds
- Each post is genuinely personalized (surface, weather, tip specific to that track)
- Promo codes work end-to-end: signup → Pro access → auto-expire at 6 AM
- No promo codes created for skipped tracks
- Facebook posts include track @tag when available
- Screenshots show contextually relevant app content per track
