# Race Night Automation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `!tenths racenight` Discord command that discovers tonight's races via MyRacePass, generates personalized Facebook posts with crew-chief physics tips, creates time-limited free Pro promos, and publishes with track @tags.

**Architecture:** Extends tenths-social-manager with 5 new modules (scraper, enrichment, tip generator, screenshots, orchestrator). Crew-chief gets database migrations for racenight grants + a modified promo redemption flow that bypasses Stripe for one-evening Pro access.

**Tech Stack:** Node.js, Playwright, Discord.js, Meta Graph API, Supabase, Open-Meteo API, OpenClaw agent

**Design doc:** `docs/plans/2026-03-08-racenight-automation-design.md`

---

## Phase 1: Crew-Chief Database & Subscription Changes

### Task 1: Migration — Add columns to tracks and promotions tables

**Files:**
- Create: `crew-chief/supabase/migrations/20260308120000_add_racenight_columns.sql`

**Step 1: Write the migration**

```sql
-- Add racenight support columns to tracks table
ALTER TABLE public.tracks
  ADD COLUMN IF NOT EXISTS facebook_page_url TEXT,
  ADD COLUMN IF NOT EXISTS abbreviation TEXT,
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Add racenight flag to promotions table
ALTER TABLE public.promotions
  ADD COLUMN IF NOT EXISTS racenight BOOLEAN DEFAULT false;

-- Index for looking up racenight promos
CREATE INDEX IF NOT EXISTS idx_promotions_racenight
  ON public.promotions (racenight) WHERE racenight = true;
```

**Step 2: Apply the migration**

Run: `cd ~/Code/crew-chief && npx supabase db push` or apply via Supabase dashboard SQL editor.
Expected: Success, no errors.

**Step 3: Verify columns exist**

Run in Supabase SQL editor:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'tracks' AND column_name IN ('facebook_page_url', 'abbreviation', 'lat', 'lng');
```
Expected: 4 rows returned.

**Step 4: Commit**

```bash
cd ~/Code/crew-chief
git add supabase/migrations/20260308120000_add_racenight_columns.sql
git commit -m "feat: add racenight columns to tracks and promotions tables"
```

---

### Task 2: Migration — Create racenight_grants table

**Files:**
- Create: `crew-chief/supabase/migrations/20260308120001_create_racenight_grants.sql`

**Step 1: Write the migration**

```sql
CREATE TABLE public.racenight_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  promo_code TEXT NOT NULL,
  track_name TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Index for checking active grants by user
CREATE INDEX idx_racenight_grants_user_active
  ON public.racenight_grants (user_id, is_active) WHERE is_active = true;

-- Index for expiry cleanup
CREATE INDEX idx_racenight_grants_expiry
  ON public.racenight_grants (expires_at) WHERE is_active = true;

-- RLS policies
ALTER TABLE public.racenight_grants ENABLE ROW LEVEL SECURITY;

-- Users can read their own grants
CREATE POLICY "Users can read own grants"
  ON public.racenight_grants FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can do everything (for the social manager bot)
CREATE POLICY "Service role full access"
  ON public.racenight_grants FOR ALL
  USING (auth.role() = 'service_role');
```

**Step 2: Apply the migration**

Run: Apply via Supabase dashboard SQL editor.
Expected: Table created, policies applied.

**Step 3: Verify**

```sql
SELECT table_name FROM information_schema.tables WHERE table_name = 'racenight_grants';
```
Expected: 1 row.

**Step 4: Commit**

```bash
cd ~/Code/crew-chief
git add supabase/migrations/20260308120001_create_racenight_grants.sql
git commit -m "feat: create racenight_grants table with RLS policies"
```

---

### Task 3: Update useSubscription to check racenight grants

The subscription hook needs to also check `racenight_grants` for active Pro access.

**Files:**
- Modify: `crew-chief/src/hooks/useSubscription.ts`
- Modify: `crew-chief/src/lib/types/subscription.ts`

**Step 1: Add RacenightGrant type**

In `src/lib/types/subscription.ts`, add after the `Subscription` interface:

```typescript
export interface RacenightGrant {
  id: string
  user_id: string
  promo_code: string
  track_name: string
  granted_at: string
  expires_at: string
  is_active: boolean
}
```

**Step 2: Update useSubscription hook**

In `src/hooks/useSubscription.ts`, modify the hook to also query `racenight_grants`:

After the existing subscription fetch, add a parallel query:

```typescript
// Check for active racenight grant
const { data: racenightGrant } = await supabase
  .from('racenight_grants')
  .select('*')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .gt('expires_at', new Date().toISOString())
  .order('expires_at', { ascending: false })
  .limit(1)
  .maybeSingle()
```

Update the `isPro` derivation to be:

```typescript
const isPro = isSubscriptionActive(subscription?.status) || !!racenightGrant
```

Add `racenightGrant` and `isRacenightAccess` to the returned context so components can display "Race Night Access — expires at X" if needed.

**Step 3: Verify the app still builds**

Run: `cd ~/Code/crew-chief && npm run build`
Expected: Build succeeds.

**Step 4: Manual test**

In Supabase, insert a test racenight grant for your user with `expires_at` 1 hour from now. Log into the app and verify Pro features are accessible. Delete the test row after.

**Step 5: Commit**

```bash
cd ~/Code/crew-chief
git add src/hooks/useSubscription.ts src/lib/types/subscription.ts
git commit -m "feat: check racenight_grants for Pro access in useSubscription"
```

---

### Task 4: Racenight promo redemption flow

The promo page currently always redirects to Stripe checkout. For racenight promos, it needs to:
1. Allow email-only signup (no credit card)
2. Create a `racenight_grants` record directly
3. Skip Stripe entirely

**Files:**
- Create: `crew-chief/src/app/api/racenight/grant/route.ts`
- Modify: `crew-chief/src/app/(marketing)/promo/[code]/page.tsx`
- Modify: `crew-chief/src/app/(marketing)/promo/[code]/PromoLandingClient.tsx`

**Step 1: Create the racenight grant API route**

Create `src/app/api/racenight/grant/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user }, error: authError } = await supabase.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { promoCode } = await request.json()
  if (!promoCode) {
    return NextResponse.json({ error: 'Promo code required' }, { status: 400 })
  }

  // Validate promo code
  const { data: promo, error: promoError } = await supabase
    .from('promotions')
    .select('*')
    .eq('code', promoCode)
    .eq('is_active', true)
    .eq('racenight', true)
    .single()

  if (promoError || !promo) {
    return NextResponse.json({ error: 'Invalid or expired promo code' }, { status: 400 })
  }

  // Check expiry
  if (promo.valid_until && new Date(promo.valid_until) < new Date()) {
    return NextResponse.json({ error: 'This race night promo has expired' }, { status: 400 })
  }

  // Check max uses
  if (promo.max_uses && promo.use_count >= promo.max_uses) {
    return NextResponse.json({ error: 'All free spots have been claimed' }, { status: 400 })
  }

  // Check if user already has an active grant for this promo
  const { data: existingGrant } = await supabase
    .from('racenight_grants')
    .select('id')
    .eq('user_id', user.id)
    .eq('promo_code', promoCode)
    .single()

  if (existingGrant) {
    return NextResponse.json({ error: 'You already claimed this promo' }, { status: 400 })
  }

  // Create the grant
  const { error: grantError } = await supabase
    .from('racenight_grants')
    .insert({
      user_id: user.id,
      promo_code: promoCode,
      track_name: promo.description?.replace('Race night promo - ', '') || 'Race Night',
      expires_at: promo.valid_until
    })

  if (grantError) {
    return NextResponse.json({ error: 'Failed to activate promo' }, { status: 500 })
  }

  // Increment use count
  await supabase.rpc('increment_promo_use_count', { promo_id: promo.id })

  // Track redemption
  await supabase.from('promotion_redemptions').insert({
    promotion_id: promo.id,
    user_id: user.id
  })

  return NextResponse.json({
    success: true,
    expires_at: promo.valid_until,
    track_name: promo.description?.replace('Race night promo - ', '') || 'Race Night'
  })
}
```

**Step 2: Modify the promo page server component**

In `src/app/(marketing)/promo/[code]/page.tsx`, the server component already fetches the promo. Add `racenight` to the data passed to `PromoLandingClient`:

```typescript
// After fetching promo, pass racenight flag
<PromoLandingClient
  code={code}
  trialDays={promo.trial_days}
  description={promo.description}
  racenight={promo.racenight || false}
/>
```

**Step 3: Modify PromoLandingClient for racenight flow**

When `racenight` is true:
- Change CTA text: "Get FREE Pro Access Tonight" instead of "Start Free Trial"
- Show expiry time instead of trial duration
- On click: call `/api/racenight/grant` instead of `/api/stripe/checkout`
- On success: redirect to `/dashboard` with a toast

Key changes in the client component:

```typescript
// Props
interface PromoLandingProps {
  code: string
  trialDays: number
  description: string | null
  racenight: boolean
}

// In the component:
async function handleRacenightClaim() {
  setLoading(true)
  try {
    const res = await fetch('/api/racenight/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promoCode: code })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    // Redirect to dashboard
    window.location.href = '/dashboard'
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to activate')
  } finally {
    setLoading(false)
  }
}

// In JSX — conditionally render:
// If racenight: show "FREE tonight" badge, handleRacenightClaim on click
// If not racenight: existing Stripe checkout flow
```

**Step 4: Verify build**

Run: `cd ~/Code/crew-chief && npm run build`
Expected: Build succeeds.

**Step 5: Commit**

```bash
cd ~/Code/crew-chief
git add src/app/api/racenight/grant/route.ts \
        src/app/\(marketing\)/promo/\[code\]/page.tsx \
        src/app/\(marketing\)/promo/\[code\]/PromoLandingClient.tsx
git commit -m "feat: add racenight promo redemption flow bypassing Stripe"
```

---

### Task 5: Expiry enforcement — deactivate expired grants

**Files:**
- Create: `crew-chief/supabase/migrations/20260308120002_racenight_expiry_cron.sql`

**Step 1: Create a pg_cron job (if available) or a Supabase Edge Function**

Option A — pg_cron (if enabled on your Supabase plan):

```sql
-- Enable pg_cron extension if not already
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Run every hour: deactivate expired grants
SELECT cron.schedule(
  'deactivate-expired-racenight-grants',
  '0 * * * *',
  $$UPDATE public.racenight_grants SET is_active = false WHERE expires_at < now() AND is_active = true$$
);
```

Option B — If pg_cron is not available, create a Supabase Edge Function:

Create `crew-chief/supabase/functions/expire-racenight-grants/index.ts`:

```typescript
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from 'jsr:@supabase/supabase-js@2'

Deno.serve(async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data, error } = await supabase
    .from('racenight_grants')
    .update({ is_active: false })
    .lt('expires_at', new Date().toISOString())
    .eq('is_active', true)
    .select('id')

  return new Response(JSON.stringify({
    deactivated: data?.length ?? 0,
    error: error?.message ?? null
  }), { headers: { 'Content-Type': 'application/json' } })
})
```

Deploy and set up a cron trigger via Supabase dashboard (every hour).

**Step 2: Test expiry**

Insert a test grant with `expires_at` in the past. Run the function/cron. Verify `is_active` flipped to false.

**Step 3: Commit**

```bash
cd ~/Code/crew-chief
git add supabase/migrations/20260308120002_racenight_expiry_cron.sql
# or: git add supabase/functions/expire-racenight-grants/
git commit -m "feat: add hourly cron to deactivate expired racenight grants"
```

---

## Phase 2: Social Manager — Core Modules

### Task 6: Racenight config file and loader

**Files:**
- Create: `tenths-social-manager/racenight-config.js`

**Step 1: Create the config module**

```javascript
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-racenight-config.json'
);

const DEFAULT_CONFIG = {
  regions: ['OH', 'PA', 'MI', 'IN', 'WV', 'KY'],
  divisions: ['figure-8', 'street-stock', 'compact', 'factory-stock', 'hornet'],
  max_tracks_per_run: 20,
  promo_max_uses: 10,
  promo_expiry_hour_utc: 10, // 6 AM ET = 10 UTC (during EDT)
  screenshot_cleanup_days: 7,
  crew_chief_url: 'https://tenths.racing',
  // Fuzzy match aliases: MyRacePass class name → our division ID
  division_aliases: {
    'figure 8': 'figure-8',
    'fig 8': 'figure-8',
    'f8': 'figure-8',
    'figure-8': 'figure-8',
    'figure eight': 'figure-8',
    'street stock': 'street-stock',
    'streetstock': 'street-stock',
    'compact': 'compact',
    'compacts': 'compact',
    'mini stock': 'compact',
    'factory stock': 'factory-stock',
    'pure stock': 'factory-stock',
    'hornet': 'hornet',
    'hornets': 'hornet',
    'front wheel drive': 'hornet',
    'fwd': 'hornet'
  }
};

function loadRacenightConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveRacenightConfig(config) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function matchDivision(className, config) {
  const normalized = className.toLowerCase().trim();
  const aliases = config.division_aliases || DEFAULT_CONFIG.division_aliases;
  // Direct alias match
  if (aliases[normalized]) return aliases[normalized];
  // Substring match against configured divisions
  for (const div of config.divisions) {
    if (normalized.includes(div.replace('-', ' ')) || normalized.includes(div)) {
      return div;
    }
  }
  // Substring match against aliases
  for (const [alias, div] of Object.entries(aliases)) {
    if (normalized.includes(alias)) return div;
  }
  return null;
}

module.exports = { loadRacenightConfig, saveRacenightConfig, matchDivision, DEFAULT_CONFIG };
```

**Step 2: Write default config to disk**

```javascript
// Quick test: node -e "require('./racenight-config').saveRacenightConfig(require('./racenight-config').DEFAULT_CONFIG)"
```

**Step 3: Test matchDivision**

```bash
node -e "
const { matchDivision, DEFAULT_CONFIG } = require('./racenight-config');
console.assert(matchDivision('Figure 8', DEFAULT_CONFIG) === 'figure-8');
console.assert(matchDivision('Street Stock', DEFAULT_CONFIG) === 'street-stock');
console.assert(matchDivision('Mini Stock', DEFAULT_CONFIG) === 'compact');
console.assert(matchDivision('Late Model', DEFAULT_CONFIG) === null);
console.log('All matchDivision tests passed');
"
```

Expected: "All matchDivision tests passed"

**Step 4: Commit**

```bash
cd ~/Code/build-useful-skills/tenths-social-manager
git add racenight-config.js
git commit -m "feat: add racenight config module with division fuzzy matching"
```

---

### Task 7: MyRacePass scraper

**Files:**
- Create: `tenths-social-manager/scraper-myracepass.js`

**Step 1: Write the scraper**

```javascript
const { chromium } = require('playwright');
const { matchDivision } = require('./racenight-config');

/**
 * Scrapes MyRacePass for tonight's races.
 * MyRacePass URL pattern: https://www.myracepass.com/schedule/?d=YYYY-MM-DD
 * The schedule page lists events grouped by track.
 *
 * NOTE: MyRacePass page structure may change. If selectors break,
 * inspect https://www.myracepass.com/schedule/ and update selectors below.
 */
async function scrapeMyRacePass(config, stateOverride) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const regions = stateOverride ? [stateOverride.toUpperCase()] : config.regions;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  const page = await context.newPage();

  const tracks = [];

  try {
    // Navigate to MyRacePass schedule for today
    const url = `https://www.myracepass.com/schedule/?d=${today}`;
    console.log(`[scraper] Fetching ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    // MyRacePass schedule page structure:
    // Each event block contains track name, location, and class list.
    // The exact selectors need to be verified against the live site.
    // This implementation uses a best-effort approach with fallback.

    // Try to extract event blocks
    const events = await page.evaluate(() => {
      const results = [];

      // MyRacePass uses various layouts — try common patterns
      // Pattern 1: Event cards/rows with track info
      const eventElements = document.querySelectorAll(
        '.schedule-event, .event-row, [class*="event"], .race-listing, tr[class*="event"]'
      );

      for (const el of eventElements) {
        const text = el.textContent || '';
        // Try to extract structured data
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
          const track = {
            name: trackEl.textContent?.trim() || '',
            url: trackEl.href || '',
            location: locationEl?.textContent?.trim() || '',
            classes: Array.from(classEls).map(c => c.textContent?.trim()).filter(Boolean),
            raw_text: text.substring(0, 500)
          };
          if (track.name) results.push(track);
        }
      }

      // Fallback: if no structured elements found, try parsing page text
      if (results.length === 0) {
        const body = document.body?.innerText || '';
        return [{ fallback: true, raw_text: body.substring(0, 5000) }];
      }

      return results;
    });

    // If we got fallback text, use AI to parse it (handled by caller)
    if (events.length === 1 && events[0].fallback) {
      console.log('[scraper] Structured extraction failed, returning raw text for AI parsing');
      await browser.close();
      return { raw_text: events[0].raw_text, structured: false };
    }

    // Process structured results
    for (const event of events) {
      // Extract state from location (e.g., "Rossburg, OH" → "OH")
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
```

**Step 2: Manual test**

```bash
cd ~/Code/build-useful-skills/tenths-social-manager
node -e "
const { scrapeMyRacePass } = require('./scraper-myracepass');
const { loadRacenightConfig } = require('./racenight-config');
scrapeMyRacePass(loadRacenightConfig()).then(r => console.log(JSON.stringify(r, null, 2)));
"
```

Expected: Either structured track results or raw text (depends on MyRacePass page structure). Inspect output and adjust selectors in the `page.evaluate` block as needed.

**Step 3: Commit**

```bash
git add scraper-myracepass.js
git commit -m "feat: add MyRacePass Playwright scraper for race discovery"
```

---

### Task 8: Track enrichment module

**Files:**
- Create: `tenths-social-manager/track-enrichment.js`

**Step 1: Write the enrichment module**

```javascript
const { createClient } = require('@supabase/supabase-js');
const { execAsync } = require('./utils');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Enrich a list of discovered tracks with:
 * 1. Supabase cached data (if known)
 * 2. AI-researched data (if new)
 * 3. Tonight's weather from Open-Meteo
 */
async function enrichTracks(tracks) {
  const enriched = [];

  for (const track of tracks) {
    console.log(`[enrich] Processing: ${track.name}`);

    // 1. Check Supabase cache
    const cached = await lookupTrack(track.name, track.state);

    let trackData;
    if (cached) {
      console.log(`[enrich] Cache hit: ${track.name}`);
      trackData = {
        ...track,
        is_known: true,
        surface: cached.surface,
        length: cached.length,
        banking: cached.banking,
        shape: cached.shape,
        facebook_page_url: cached.facebook_page_url,
        abbreviation: cached.abbreviation,
        lat: cached.lat,
        lng: cached.lng,
        supabase_id: cached.id
      };
    } else {
      console.log(`[enrich] Cache miss, researching: ${track.name}`);
      const researched = await researchTrack(track.name, track.state);
      trackData = {
        ...track,
        is_known: false,
        ...researched
      };
      // Save to Supabase for future runs
      await saveTrack(trackData);
    }

    // 2. Fetch weather
    if (trackData.lat && trackData.lng) {
      trackData.weather = await fetchWeather(trackData.lat, trackData.lng);
    } else {
      trackData.weather = null;
    }

    enriched.push(trackData);
  }

  return enriched;
}

async function lookupTrack(name, state) {
  // Try exact name match first, then fuzzy
  let { data } = await supabase
    .from('tracks')
    .select('*')
    .ilike('name', `%${name}%`)
    .limit(1)
    .maybeSingle();

  return data;
}

async function researchTrack(name, state) {
  // Use OpenClaw agent to research track details
  const prompt = `Research the short track racing venue "${name}" in ${state || 'USA'}.
Return ONLY a JSON object with these fields:
{
  "surface": "dirt" | "asphalt" | "concrete" | "mixed",
  "length": "1/4 mile" (track length as string),
  "banking": "12 degrees" (banking angle as string, or "flat" if unknown),
  "shape": "oval" | "figure-8" | "road-course" | "d-shaped",
  "elevation": number (feet above sea level, estimate if needed),
  "lat": number (latitude),
  "lng": number (longitude),
  "facebook_page_url": "https://facebook.com/..." (official FB page URL, or null),
  "abbreviation": "XXX" (3-4 letter abbreviation, e.g. PVL for Painesville)
}`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --json --thinking medium --timeout 60`,
      { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    const text = envelope.result || envelope.content || envelope.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch (err) {
    console.error(`[enrich] Research failed for ${name}: ${err.message}`);
  }

  // Fallback: minimal data
  return {
    surface: 'unknown',
    length: 'unknown',
    banking: 'unknown',
    shape: 'oval',
    lat: null,
    lng: null,
    facebook_page_url: null,
    abbreviation: name.substring(0, 3).toUpperCase()
  };
}

async function saveTrack(trackData) {
  const id = trackData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { error } = await supabase.from('tracks').upsert({
    id,
    name: trackData.name,
    location: trackData.location || `${trackData.state}, USA`,
    surface: trackData.surface,
    length: trackData.length,
    banking: trackData.banking,
    shape: trackData.shape,
    facebook_page_url: trackData.facebook_page_url,
    abbreviation: trackData.abbreviation,
    lat: trackData.lat,
    lng: trackData.lng
  }, { onConflict: 'id' });

  if (error) console.error(`[enrich] Save failed for ${trackData.name}: ${error.message}`);
}

async function fetchWeather(lat, lng) {
  // Open-Meteo free API — no key needed
  const url = `https://api.open-meteo.com/v1/forecast`
    + `?latitude=${lat}&longitude=${lng}`
    + `&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation_probability`
    + `&temperature_unit=fahrenheit`
    + `&wind_speed_unit=mph`
    + `&timezone=America/New_York`
    + `&forecast_days=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    // Find the 6 PM hour (typical race start)
    const hours = data.hourly?.time || [];
    const raceHourIndex = hours.findIndex(t => t.includes('T18:'));
    const i = raceHourIndex >= 0 ? raceHourIndex : Math.min(18, hours.length - 1);

    return {
      temp_f: data.hourly.temperature_2m[i],
      humidity: data.hourly.relative_humidity_2m[i],
      wind_speed_mph: data.hourly.wind_speed_10m[i],
      wind_direction: data.hourly.wind_direction_10m[i],
      precip_chance: data.hourly.precipitation_probability[i]
    };
  } catch (err) {
    console.error(`[weather] Failed for ${lat},${lng}: ${err.message}`);
    return null;
  }
}

module.exports = { enrichTracks, lookupTrack, fetchWeather };
```

**Step 2: Create utils.js** (shared helper)

```javascript
// tenths-social-manager/utils.js
const { promisify } = require('util');
const execAsync = promisify(require('child_process').exec);
module.exports = { execAsync };
```

**Step 3: Test weather fetch**

```bash
node -e "
const { fetchWeather } = require('./track-enrichment');
// Painesville OH coords
fetchWeather(41.7242, -81.2457).then(w => console.log('Weather:', JSON.stringify(w, null, 2)));
"
```

Expected: JSON with temp_f, humidity, wind_speed_mph, wind_direction, precip_chance.

**Step 4: Commit**

```bash
git add track-enrichment.js utils.js
git commit -m "feat: add track enrichment module with Supabase cache and Open-Meteo weather"
```

---

### Task 9: Tip generator — crew-chief physics knowledge prompt

**Files:**
- Create: `tenths-social-manager/tip-generator.js`

**Step 1: Write the tip generator**

This module builds a physics-knowledge prompt from crew-chief domain data. The knowledge is embedded directly (not imported from crew-chief code) to keep the social manager self-contained.

```javascript
/**
 * Generates a racing tip for a specific track using crew-chief physics knowledge.
 * The tip is generated by AI with a rich context prompt containing:
 * - Track specifics (surface, shape, banking, length)
 * - Tonight's weather
 * - Tire compound data
 * - Weight distribution principles
 * - Division constraints
 */
const { execAsync } = require('./utils');

// Crew-chief physics knowledge pack — extracted from crew-chief domain data
const PHYSICS_KNOWLEDGE = `
## Tire Compound Reference
- Hoosier D55 (dirt, soft): 9-14 psi, high grip, wears fast on abrasive surfaces
- Hoosier D40 (dirt, medium): 10-15 psi, balanced grip/durability
- Hoosier D25 (dirt, hard): 12-16 psi, durable on heavy/wet dirt
- Hoosier G60 (dual-surface): dirt 12-16 psi, asphalt 22-28 psi, versatile
- Hoosier F45 (asphalt, soft): 18-28 psi, max grip on clean asphalt
- Hoosier F35 (asphalt, hard): 22-36 psi, durable for long runs
- DOT Street tires: 24-36 psi, limited grip, common in entry-level classes

## Surface Handling Principles
- DIRT: Lower tire pressures = more footprint = more grip. Track goes from tacky (early) to slick (late). Adjust spring rates softer as track slicks off.
- ASPHALT: Higher pressures for consistent contact patch. Temperature matters — hot asphalt = greasy, cold = more grip. Camber is critical.
- MIXED/CONCRETE CORNERS: Biggest challenge is braking zone transition. Concrete has less grip than asphalt. Adjust cross-weight for the corner surface, not the straightaway.
- FIGURE-8 CROSSOVER: Weight transfer through the intersection is different than a corner. Cross-weight % around 51-53% keeps car neutral through the X. Braking is the key skill.

## Weight Distribution
- LEFT-SIDE %: Higher (55-57%) = more mechanical grip turning left. Lower = more balanced for figure-8/road course.
- CROSS-WEIGHT %: 50% = neutral. Above 50% = tighter (more push). Below 50% = looser. Adjust 0.5% at a time.
- REAR %: Higher rear % = better forward bite out of corners but can cause snap-oversteer on entry.

## Cornering Physics (simplified for tips)
- Roll stiffness: Stiffer front = more understeer (push). Stiffer rear = more oversteer (loose).
- Load transfer: Heavier cars transfer more weight in corners. Lower center of gravity reduces transfer.
- Tire grip is non-linear: doubling the load does NOT double the grip. This is why cross-weight matters.

## Weather Effects
- HIGH HUMIDITY (>70%): Dirt tracks stay wetter/tackier longer. Can run softer compounds.
- LOW HUMIDITY (<40%): Dirt dries out fast, goes slick early. Harder compounds or higher pressures.
- HOT TEMPS (>85°F): Asphalt gets greasy. Reduce pressures 1-2 psi. Dirt goes dry faster.
- COLD TEMPS (<60°F): More mechanical grip on asphalt. Dirt stays heavy/tacky.
- WIND: Crosswinds affect high-profile cars (street stocks). Adjust sway bar or spring on windward side.
- RAIN CHANCE >50%: Packed dirt = greasy mud. Raise ride height. Softest compounds.

## Division Quick Reference
- Figure 8 classes: RWD only, cross-weight critical for intersection, typically GM/Ford/Mopar V8s, weight 3200-3600 lbs
- Street Stock: Minimal mods, focus on weight placement and tire management
- Compacts: Lighter cars (2200-2800 lbs), front-heavy, need aggressive rear spring rates
- Factory Stock/Pure Stock: Nearly stock, setup gains come from weight distribution and tire pressures
- Hornets/FWD: Front-wheel-drive, completely different dynamics — weight transfer to front is your friend
`;

async function generateTip(track) {
  const weatherStr = track.weather
    ? `Temperature: ${track.weather.temp_f}°F, Humidity: ${track.weather.humidity}%, Wind: ${track.weather.wind_speed_mph} mph, Precip chance: ${track.weather.precip_chance}%`
    : 'Weather data unavailable';

  const prompt = `You are a veteran short-track racing crew chief with 30+ years of experience.
Generate ONE specific, actionable racing tip for TONIGHT's races at this track.

TRACK: ${track.name}
SURFACE: ${track.surface || 'unknown'}
LENGTH: ${track.length || 'unknown'}
BANKING: ${track.banking || 'unknown'}
SHAPE: ${track.shape || 'oval'}
DIVISIONS TONIGHT: ${(track.divisions_tonight || []).join(', ') || 'various'}
WEATHER TONIGHT: ${weatherStr}

${PHYSICS_KNOWLEDGE}

RULES:
- Be specific to THIS track and TONIGHT's conditions
- Reference actual numbers (psi, %, lbs, degrees)
- Keep it to 1-2 sentences max
- Sound like a crew chief talking to a driver in the pits, not a textbook
- Do NOT start with "Tip:" or any prefix — just give the tip directly
- If the track surface is unknown, give a general but still useful tip based on the divisions running

Return ONLY the tip text, nothing else.`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --thinking low --timeout 60`,
      { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    const tip = (envelope.result || envelope.content || envelope.text || '').trim();
    // Strip any quotes or prefixes the AI might add
    return tip.replace(/^["']|["']$/g, '').replace(/^(Tip:|💡|Pro tip:)\s*/i, '');
  } catch (err) {
    console.error(`[tip-gen] Failed for ${track.name}: ${err.message}`);
    return getFallbackTip(track);
  }
}

function getFallbackTip(track) {
  const surface = (track.surface || '').toLowerCase();
  if (surface.includes('dirt')) {
    return 'The track will change all night — start conservative on tire pressures and adjust after hot laps. Watch the cushion build up in turns 1 and 3.';
  } else if (surface.includes('asphalt')) {
    return 'Check your tire pressures after hot laps — asphalt temps swing fast and a 2 psi difference can mean push vs. loose.';
  } else {
    return 'Get to the track early for hot laps — learning the surface tonight is worth more than any setup change you can make in the pits.';
  }
}

module.exports = { generateTip, PHYSICS_KNOWLEDGE };
```

**Step 2: Test tip generation (manual)**

```bash
node -e "
const { generateTip } = require('./tip-generator');
generateTip({
  name: 'Eldora Speedway', surface: 'dirt', length: '1/2 mile',
  banking: '24 degrees', shape: 'oval',
  divisions_tonight: ['Street Stock', 'Modifieds'],
  weather: { temp_f: 78, humidity: 45, wind_speed_mph: 8, precip_chance: 10 }
}).then(tip => console.log('TIP:', tip));
"
```

Expected: A specific, actionable 1-2 sentence tip mentioning dirt, the weather conditions, and practical setup advice.

**Step 3: Commit**

```bash
git add tip-generator.js
git commit -m "feat: add tip generator with crew-chief physics knowledge pack"
```

---

### Task 10: Racenight dynamic screenshots

**Files:**
- Create: `tenths-social-manager/racenight-screenshots.js`

**Step 1: Write the screenshot module**

```javascript
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SCREENSHOT_DIR = path.join(
  process.env.HOME, '.agents', 'data', 'tenths-racenight-screenshots'
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
 * Returns a map of track abbreviation → screenshot file path.
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
      const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
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
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(filePath);
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[racenight-ss] Cleaned up ${cleaned} old screenshots`);
}

module.exports = { captureRacenightScreenshots, cleanupOldScreenshots, getScreenshotRoute };
```

**Step 2: Test screenshot route selection**

```bash
node -e "
const { getScreenshotRoute } = require('./racenight-screenshots');
console.log(getScreenshotRoute({ surface: 'dirt', shape: 'oval', matched_divisions: [] }));
console.log(getScreenshotRoute({ surface: 'asphalt', shape: 'figure-8', matched_divisions: ['figure-8'] }));
console.log(getScreenshotRoute({ surface: 'mixed', shape: 'oval', matched_divisions: [] }));
console.log(getScreenshotRoute({ surface: '', shape: '', matched_divisions: [] }));
"
```

Expected:
```
{ route: '/setup', label: 'setup-dirt' }
{ route: '/calculators/gear-ratio', label: 'gear-ratio' }
{ route: '/calculators/corner-weight', label: 'corner-weight' }
{ route: '/', label: 'landing' }
```

**Step 3: Commit**

```bash
git add racenight-screenshots.js
git commit -m "feat: add dynamic racenight screenshot capture with track-contextual routing"
```

---

### Task 11: Promo creation module

**Files:**
- Create: `tenths-social-manager/racenight-promo.js`

**Step 1: Write the promo module**

```javascript
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Create a racenight promo code for a specific track.
 * The promo expires at 6 AM ET the next morning.
 */
async function createRacenightPromo(track, config) {
  const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
  const today = new Date();
  const mmdd = String(today.getMonth() + 1).padStart(2, '0')
    + String(today.getDate()).padStart(2, '0');
  const code = `TENTHS-${abbrev}-${mmdd}`;

  // Calculate expiry: 6 AM ET next morning
  // config.promo_expiry_hour_utc is 10 (6 AM ET during EDT) or 11 (during EST)
  const expiryHourUTC = config.promo_expiry_hour_utc || 10;
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(expiryHourUTC, 0, 0, 0);
  const validUntil = tomorrow.toISOString();

  // valid_from: now
  const validFrom = today.toISOString();

  const maxUses = config.promo_max_uses || 10;
  const description = `Race night promo - ${track.name} ${today.getMonth() + 1}/${today.getDate()}`;

  // Check if promo already exists for this track/date
  const { data: existing } = await supabase
    .from('promotions')
    .select('code')
    .eq('code', code)
    .maybeSingle();

  if (existing) {
    console.log(`[promo] Already exists: ${code}`);
    return { code, url: `https://tenths.racing/promo/${code}`, existing: true };
  }

  const { error } = await supabase.from('promotions').insert({
    code,
    trial_days: 1,
    max_uses: maxUses,
    valid_from: validFrom,
    valid_until: validUntil,
    description,
    is_active: true,
    racenight: true,
    use_count: 0
  });

  if (error) {
    console.error(`[promo] Creation failed for ${code}: ${error.message}`);
    throw new Error(`Failed to create promo: ${error.message}`);
  }

  console.log(`[promo] Created: ${code} (${maxUses} uses, expires ${validUntil})`);
  return {
    code,
    url: `https://tenths.racing/promo/${code}`,
    max_uses: maxUses,
    expires: validUntil,
    existing: false
  };
}

module.exports = { createRacenightPromo };
```

**Step 2: Commit**

```bash
git add racenight-promo.js
git commit -m "feat: add racenight promo creation module"
```

---

## Phase 3: Social Manager — Discord Integration & Orchestrator

### Task 12: Facebook post generator

**Files:**
- Create: `tenths-social-manager/racenight-post-generator.js`

**Step 1: Write the post content generator**

```javascript
const { execAsync } = require('./utils');
const { PHYSICS_KNOWLEDGE } = require('./tip-generator');

/**
 * Generate a personalized Facebook post for a race night track.
 * Uses AI with track context, weather, and physics knowledge.
 */
async function generateRacenightPost(track, tip, promoCode) {
  const weatherStr = track.weather
    ? `${track.weather.temp_f}°F, ${track.weather.humidity}% humidity, wind ${track.weather.wind_speed_mph} mph, ${track.weather.precip_chance}% chance of rain`
    : 'Weather data not available';

  const fbTag = track.facebook_page_url
    ? `@${extractFBPageName(track.facebook_page_url)}`
    : '';

  const prompt = `Write a Facebook post promoting free race-night access to the Tenths racing app.

TRACK: ${track.name} (${track.state || ''})
SURFACE: ${track.surface || 'unknown'}
LENGTH: ${track.length || 'unknown'}
BANKING: ${track.banking || 'unknown'}
SHAPE: ${track.shape || 'oval'}
DIVISIONS TONIGHT: ${(track.divisions_tonight || []).join(', ')}
WEATHER: ${weatherStr}
PROMO CODE: ${promoCode}
PROMO URL: https://tenths.racing/promo/${promoCode}
RACE TIP: ${tip}
FB TAG: ${fbTag}

FORMAT — write EXACTLY this structure:
1. Opening line with racing emoji and track name (mention TONIGHT)
2. 1-2 sentences about tonight's specific conditions at this track (surface, weather, what makes tonight interesting)
3. The race tip prefixed with 💡
4. The promo CTA: "🎁 First 10 racers get FREE full access to Tenths tonight — your crew chief in your pocket. No credit card needed."
5. The promo link: "👉 tenths.racing/promo/${promoCode}"
6. The FB tag line (if provided): "${fbTag}"
7. Hashtags line: 3-5 relevant hashtags

VOICE: Technical but approachable. Talk like a fellow racer, not marketing. Short sentences.
MAX LENGTH: 600 characters total (excluding hashtags line).

Return ONLY the post text, nothing else.`;

  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const { stdout } = await execAsync(
      `openclaw agent --message '${escaped}' --thinking low --timeout 60`,
      { encoding: 'utf8', timeout: 90000, maxBuffer: 2 * 1024 * 1024 }
    );
    const envelope = JSON.parse(stdout);
    let post = (envelope.result || envelope.content || envelope.text || '').trim();
    // Strip markdown quotes if AI wraps output
    post = post.replace(/^```[\s\S]*?```$/gm, '').trim();
    return post;
  } catch (err) {
    console.error(`[post-gen] Failed for ${track.name}: ${err.message}`);
    return buildFallbackPost(track, tip, promoCode, fbTag);
  }
}

function buildFallbackPost(track, tip, promoCode, fbTag) {
  const lines = [
    `🏁 Racing TONIGHT at ${track.name}!`,
    '',
    track.weather
      ? `It's ${track.weather.temp_f}°F with ${track.weather.humidity}% humidity — ${track.surface || 'the track'} is going to be interesting tonight.`
      : `Tonight's races are on at ${track.name}.`,
    '',
    `💡 ${tip}`,
    '',
    `🎁 First 10 racers get FREE full access to Tenths tonight — your crew chief in your pocket. No credit card needed.`,
    '',
    `👉 tenths.racing/promo/${promoCode}`,
  ];
  if (fbTag) lines.push('', fbTag);
  lines.push('', '#ShortTrackRacing #RaceNight #TenthsRacing');
  return lines.join('\n');
}

function extractFBPageName(url) {
  if (!url) return '';
  // Extract page name from URL like https://facebook.com/PainesvilleSpeedway
  const match = url.match(/facebook\.com\/([^/?]+)/);
  return match ? match[1] : '';
}

module.exports = { generateRacenightPost };
```

**Step 2: Commit**

```bash
git add racenight-post-generator.js
git commit -m "feat: add racenight Facebook post content generator"
```

---

### Task 13: Main orchestrator + Discord command

**Files:**
- Create: `tenths-social-manager/racenight.js`

**Step 1: Write the orchestrator**

This is the main module that ties everything together. It exports the `handleRacenight` function called by the Discord command handler.

```javascript
const { EmbedBuilder } = require('discord.js');
const { loadRacenightConfig } = require('./racenight-config');
const { scrapeMyRacePass } = require('./scraper-myracepass');
const { enrichTracks } = require('./track-enrichment');
const { generateTip } = require('./tip-generator');
const { captureRacenightScreenshots, cleanupOldScreenshots } = require('./racenight-screenshots');
const { createRacenightPromo } = require('./racenight-promo');
const { generateRacenightPost } = require('./racenight-post-generator');
const { postToFacebook } = require('./publisher-fb');
const { getScreenshotRoute } = require('./racenight-screenshots');
const fs = require('fs');

/**
 * Main racenight orchestrator.
 * Called by: !tenths racenight [optional state]
 */
async function handleRacenight(message, stateOverride) {
  const config = loadRacenightConfig();

  // Cleanup old screenshots
  cleanupOldScreenshots(config.screenshot_cleanup_days || 7);

  // Step 1: Discovery
  const regionLabel = stateOverride || config.regions.join(', ');
  const statusMsg = await message.channel.send({
    embeds: [new EmbedBuilder()
      .setTitle('🏁 Race Night Discovery')
      .setDescription(`Searching MyRacePass for tonight's races...\n**Regions:** ${regionLabel}\n**Divisions:** ${config.divisions.join(', ')}`)
      .setColor(0xFF8A00)
      .setTimestamp()]
  });

  let result;
  try {
    result = await scrapeMyRacePass(config, stateOverride);
  } catch (err) {
    await statusMsg.edit({
      embeds: [new EmbedBuilder()
        .setTitle('❌ Scraping Failed')
        .setDescription(`MyRacePass scrape error: ${err.message}`)
        .setColor(0xFF0000)]
    });
    return;
  }

  if (!result.structured || !result.tracks || result.tracks.length === 0) {
    await statusMsg.edit({
      embeds: [new EmbedBuilder()
        .setTitle('🏁 Race Night Discovery')
        .setDescription(result.structured
          ? 'No matching tracks found racing tonight in your configured regions/divisions.'
          : 'Could not parse MyRacePass page structure. Selectors may need updating.')
        .setColor(0xFFAA00)]
    });
    return;
  }

  const tracks = result.tracks;
  await statusMsg.edit({
    embeds: [new EmbedBuilder()
      .setTitle('🏁 Race Night Discovery')
      .setDescription(`Found **${tracks.length}** tracks racing tonight. Enriching data & generating posts...`)
      .setColor(0xFF8A00)
      .setTimestamp()]
  });

  // Step 2: Enrich tracks
  const enriched = await enrichTracks(tracks);

  // Step 3: Generate tips
  for (const track of enriched) {
    track.tip = await generateTip(track);
  }

  // Step 4: Capture screenshots
  const screenshots = await captureRacenightScreenshots(enriched, config);

  // Step 5: Generate post content + promo codes (promo NOT created yet)
  for (const track of enriched) {
    const abbrev = track.abbreviation || track.name.substring(0, 3).toUpperCase();
    const today = new Date();
    const mmdd = String(today.getMonth() + 1).padStart(2, '0')
      + String(today.getDate()).padStart(2, '0');
    track.promo_code = `TENTHS-${abbrev}-${mmdd}`;
    track.promo_url = `https://tenths.racing/promo/${track.promo_code}`;
    track.post_text = await generateRacenightPost(track, track.tip, track.promo_code);
    track.screenshot_path = screenshots[abbrev] || null;
    track.status = 'pending'; // pending | approved | skipped
  }

  // Step 6: Post Discord embeds
  const trackMessages = [];
  for (const track of enriched) {
    const { label } = getScreenshotRoute(track);
    const weatherLine = track.weather
      ? `🌡️ ${track.weather.temp_f}°F | ${track.weather.humidity}% humidity | Wind ${track.weather.wind_speed_mph} mph | ${track.weather.precip_chance}% rain`
      : '🌡️ Weather data unavailable';

    const embed = new EmbedBuilder()
      .setTitle(`🏁 RACE NIGHT: ${track.name}`)
      .setColor(0xFF8A00)
      .addFields(
        {
          name: '📍 Track Info',
          value: `${track.location || track.state || 'USA'} | ${track.length || '?'} | ${track.surface || '?'} | ${track.banking || '?'}`,
          inline: false
        },
        {
          name: '🏎️ Tonight',
          value: (track.divisions_tonight || []).join(', ') || 'Various classes',
          inline: true
        },
        {
          name: '🌡️ Weather',
          value: weatherLine,
          inline: true
        },
        {
          name: '📝 Facebook Post',
          value: track.post_text.length > 1024
            ? track.post_text.substring(0, 1021) + '...'
            : track.post_text,
          inline: false
        },
        {
          name: '💡 Tip',
          value: track.tip,
          inline: false
        },
        {
          name: '🎟️ Promo',
          value: `\`${track.promo_code}\` (0/${config.promo_max_uses} used)\n🔗 ${track.promo_url}\n⏰ Expires: 6:00 AM ET tomorrow`,
          inline: true
        },
        {
          name: '📸 Screenshot',
          value: track.screenshot_path ? `✅ ${label}` : '❌ None',
          inline: true
        },
        {
          name: '🏷️ FB Tag',
          value: track.facebook_page_url || 'No FB page found',
          inline: true
        }
      )
      .setFooter({ text: 'React: ✅ Approve | ✏️ Edit | ❌ Skip' })
      .setTimestamp();

    const sent = await message.channel.send({ embeds: [embed] });
    await sent.react('✅');
    await sent.react('✏️');
    await sent.react('❌');
    trackMessages.push({ message: sent, track });
  }

  // Step 7: Summary embed with batch controls
  const summaryEmbed = new EmbedBuilder()
    .setTitle('📊 Race Night Summary')
    .setDescription(`${enriched.length} tracks found | 0 approved | 0 skipped`)
    .setColor(0xFF8A00)
    .setFooter({ text: 'React: ✅ Approve ALL | ❌ Cancel ALL' })
    .setTimestamp();

  const summaryMsg = await message.channel.send({ embeds: [summaryEmbed] });
  await summaryMsg.react('✅');
  await summaryMsg.react('❌');

  // Step 8: Set up reaction collectors
  setupReactionHandlers(trackMessages, summaryMsg, config, message.channel);
}

function setupReactionHandlers(trackMessages, summaryMsg, config, channel) {
  const TIMEOUT = 30 * 60 * 1000; // 30 minute timeout
  let approved = 0;
  let skipped = 0;
  const total = trackMessages.length;

  // Per-track reaction collectors
  for (const { message: msg, track } of trackMessages) {
    const collector = msg.createReactionCollector({
      filter: (reaction, user) => !user.bot && ['✅', '✏️', '❌'].includes(reaction.emoji.name),
      time: TIMEOUT,
      max: 1
    });

    collector.on('collect', async (reaction) => {
      if (reaction.emoji.name === '✅') {
        await approveTrack(track, config, channel);
        track.status = 'approved';
        approved++;
      } else if (reaction.emoji.name === '❌') {
        track.status = 'skipped';
        skipped++;
        await channel.send(`⏭️ Skipped: ${track.name}`);
      } else if (reaction.emoji.name === '✏️') {
        await channel.send(`✏️ **Edit ${track.name}** — Reply with your changes and I'll regenerate.`);
        // Edit handling: wait for next message in channel
        // For MVP, user can re-run !tenths racenight after making notes
      }
      updateSummary(summaryMsg, total, approved, skipped);
    });
  }

  // Summary batch controls
  const summaryCollector = summaryMsg.createReactionCollector({
    filter: (reaction, user) => !user.bot && ['✅', '❌'].includes(reaction.emoji.name),
    time: TIMEOUT,
    max: 1
  });

  summaryCollector.on('collect', async (reaction) => {
    if (reaction.emoji.name === '✅') {
      // Approve all pending
      for (const { track } of trackMessages) {
        if (track.status === 'pending') {
          await approveTrack(track, config, channel);
          track.status = 'approved';
          approved++;
        }
      }
      await channel.send(`✅ **Approved all** — ${approved} tracks published.`);
    } else if (reaction.emoji.name === '❌') {
      // Cancel all pending
      for (const { track } of trackMessages) {
        if (track.status === 'pending') {
          track.status = 'skipped';
          skipped++;
        }
      }
      await channel.send(`❌ **Cancelled all** remaining tracks.`);
    }
    updateSummary(summaryMsg, total, approved, skipped);
  });
}

async function approveTrack(track, config, channel) {
  try {
    // 1. Create promo in Supabase
    const promo = await createRacenightPromo(track, config);
    console.log(`[racenight] Promo created: ${promo.code}`);

    // 2. Post to Facebook
    const fbPost = {
      theme: 'race_night',
      content: {
        fb: {
          text: track.post_text,
          hashtags: [] // hashtags already in post_text
        }
      }
    };

    // Override getScreenshotPath for racenight
    const originalGetScreenshotPath = require('./screenshots').getScreenshotPath;
    require('./screenshots').getScreenshotPath = () => track.screenshot_path;

    const fbPostId = await postToFacebook(fbPost);
    console.log(`[racenight] Published to FB: ${fbPostId}`);

    // Restore original
    require('./screenshots').getScreenshotPath = originalGetScreenshotPath;

    await channel.send(`✅ **Published: ${track.name}**\n🎟️ Promo: \`${track.promo_code}\`\n📘 FB Post ID: ${fbPostId}`);
  } catch (err) {
    console.error(`[racenight] Publish failed for ${track.name}: ${err.message}`);
    await channel.send(`❌ **Failed: ${track.name}** — ${err.message}`);
  }
}

function updateSummary(summaryMsg, total, approved, skipped) {
  const pending = total - approved - skipped;
  summaryMsg.edit({
    embeds: [new EmbedBuilder()
      .setTitle('📊 Race Night Summary')
      .setDescription(`${total} tracks found | ${approved} approved | ${skipped} skipped | ${pending} pending`)
      .setColor(pending === 0 ? 0x00FF00 : 0xFF8A00)
      .setTimestamp()]
  }).catch(() => {});
}

module.exports = { handleRacenight };
```

**Step 2: Commit**

```bash
git add racenight.js
git commit -m "feat: add racenight orchestrator with Discord embeds and reaction handlers"
```

---

### Task 14: Wire up the Discord command

**Files:**
- Modify: `tenths-social-manager/SKILL.md` (command handler section)

**Step 1: Add racenight to the command handler**

In the `SKILL.md` command handler switch statement, add:

```javascript
case 'racenight': await handleRacenightCommand(message, args.slice(1)); break;
```

Add the import at the top of the command handler:

```javascript
const { handleRacenight } = require('./racenight');
```

Add the handler function:

```javascript
async function handleRacenightCommand(message, args) {
  const stateOverride = args[0] || null; // e.g., "TX"
  await message.react('⏳');
  try {
    await handleRacenight(message, stateOverride);
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('🏁');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('❌');
    await message.reply(`Race night failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
  }
}
```

Also update the default help message to include `racenight`:

```javascript
default: await message.reply('Commands: `generate`, `quick`, `queue`, `schedule`, `history`, `post`, `themes`, `stats`, `lookup`, `addtrack`, `addcar`, `addtire`, `promo`, `racenight`');
```

**Step 2: Update the Discord commands table in SKILL.md**

Add this row to the Discord Commands table:

```markdown
| `!tenths racenight [state]` | Discover tonight's races, generate personalized FB posts + promos |
```

**Step 3: Commit**

```bash
git add SKILL.md
git commit -m "feat: wire up !tenths racenight Discord command and update docs"
```

---

### Task 15: End-to-end manual test

**Step 1: Start the Discord bot**

Ensure all env vars are set (FB credentials, Supabase, demo user, etc.) and start the bot in the `#tenths-social` channel.

**Step 2: Run the command**

```
!tenths racenight
```

**Step 3: Verify the flow**

Check for:
- [ ] Bot responds with "Searching MyRacePass..." status
- [ ] Track embeds appear with correct info (surface, weather, divisions)
- [ ] Each embed has a personalized Facebook post draft
- [ ] Each embed has a physics-informed tip
- [ ] Promo codes follow `TENTHS-XXX-MMDD` format
- [ ] Reactions (✅ ✏️ ❌) appear on each embed
- [ ] Summary embed appears with "Approve ALL" option
- [ ] Approving a track creates the promo in Supabase `promotions` table
- [ ] Approving a track publishes to Facebook with screenshot
- [ ] The promo URL (`tenths.racing/promo/TENTHS-XXX-MMDD`) loads correctly
- [ ] Signing up via promo grants Pro access without credit card
- [ ] Pro access expires after 6 AM the next morning

**Step 4: Test edge cases**

- `!tenths racenight TX` — state override works
- Run on a day with no races — "No matching tracks found" message
- Approve ALL — batch publish works
- Cancel ALL — no promos created for remaining tracks

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: race night automation complete — end-to-end workflow verified"
```

---

## File Summary

### New files (tenths-social-manager)
| File | Purpose |
|------|---------|
| `racenight-config.js` | Config loader + division fuzzy matching |
| `scraper-myracepass.js` | Playwright MyRacePass schedule scraper |
| `track-enrichment.js` | Supabase cache + AI research + weather |
| `tip-generator.js` | Crew-chief physics knowledge → race tips |
| `racenight-screenshots.js` | Dynamic Playwright screenshots per track |
| `racenight-promo.js` | Time-limited promo code creation |
| `racenight-post-generator.js` | AI-powered Facebook post generation |
| `racenight.js` | Main orchestrator + Discord reaction handlers |
| `utils.js` | Shared helpers (execAsync) |

### New files (crew-chief)
| File | Purpose |
|------|---------|
| `supabase/migrations/20260308120000_add_racenight_columns.sql` | Add columns to tracks + promotions |
| `supabase/migrations/20260308120001_create_racenight_grants.sql` | New racenight_grants table |
| `supabase/migrations/20260308120002_racenight_expiry_cron.sql` | Hourly expiry enforcement |
| `src/app/api/racenight/grant/route.ts` | Racenight promo redemption API |

### Modified files (crew-chief)
| File | Change |
|------|--------|
| `src/hooks/useSubscription.ts` | Also check racenight_grants for Pro |
| `src/lib/types/subscription.ts` | Add RacenightGrant interface |
| `src/app/(marketing)/promo/[code]/page.tsx` | Pass racenight flag to client |
| `src/app/(marketing)/promo/[code]/PromoLandingClient.tsx` | Racenight-specific CTA + claim flow |
