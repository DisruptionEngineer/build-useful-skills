---
name: weekly-meal-planner
description: Plan 3-5 weekly dinners for 2 via Discord using Home Assistant calendar-aware busyness scoring, Mealie integration, and Rachel's shopping preferences. Use when starting a new meal planning week, searching for dinner recipes, evaluating suggestions via Discord reactions, auto-detecting leftover nights from schedule density, matching slow cooker meals to days someone is home to prep, assigning meals to optimal weekdays based on Rachel's work and class schedule plus family events, importing recipes into Mealie, generating scaled shopping lists, or receiving morning dinner notifications with crockpot alerts.
metadata: {"clawdbot":{"emoji":"🍽️","requires":{"anyBins":["jq","curl"]},"os":["linux","darwin"]}}
---

# Weekly Meal Planner

Analyze Home Assistant calendars to plan 3–5 dinners per week (scaled to 2 servings), auto-detecting leftover nights from schedule density. Rachel's work/class schedule (clinicals, lab, math — each weighted by exhaustion), Derek's availability for slow cooker prep, kids' sports, and evening commitments all feed a 0–1 busyness score per day. Days above threshold become automatic leftover nights. Approved recipes are imported into Mealie, assigned to optimal days, and a morning notification with crockpot/thaw alerts posts to Discord daily.

## When to Use

- Starting a new meal planning cycle (Saturday cron or `!mealweek`)
- Searching for dinner recipes matching household preferences
- Evaluating recipe cards in Discord (✅ ❌ ⏭️ ✏️)
- Checking which days are auto-detected as leftover nights
- Matching slow cooker meals to days Derek or Rachel is home to prep
- Assigning meals to days using busyness scores from HA calendars
- Generating a shopping list scaled to 2 with Rachel's substitutions and never-buy list
- Getting morning dinner notifications with crockpot/thaw/marinate alerts

## Prerequisites

### Environment & Data

```bash
# HA_TOKEN env var — long-lived token from HA Profile > Security
# MEALIE_URL, MEALIE_API_TOKEN — from Mealie Settings > API Tokens
mkdir -p ~/.agents/data

# Initialize config — see below for full schema
[ ! -f ~/.agents/data/meal-planner-config.json ] && cat > ~/.agents/data/meal-planner-config.json << 'CONF'
{
  "timezone": "America/Chicago",
  "mealsPerWeek": { "min": 3, "max": 5 },
  "leftoverThreshold": 0.65,
  "prepWindowHours": { "start": 9, "end": 15 },
  "homeAssistant": { "url": "http://10.10.7.60:8123", "tokenEnvVar": "HA_TOKEN" },
  "calendars": {
    "derek_personal":   { "entity_id": "calendar.personal",            "role": "derek_availability", "canWrite": true },
    "family":           { "entity_id": "calendar.family_shared_derek", "role": "family_events",      "canWrite": true },
    "rachel_clinicals": { "entity_id": "calendar.clinicals_rachel",    "role": "rachel_work", "exhaustionWeight": 0.85 },
    "rachel_lab":       { "entity_id": "calendar.lab_rachel",          "role": "rachel_work", "exhaustionWeight": 0.55 },
    "rachel_math":      { "entity_id": "calendar.math_rachel",         "role": "rachel_work", "exhaustionWeight": 0.25 },
    "mealie_dinner":    { "entity_id": "calendar.mealie_dinner",       "role": "existing_plan" },
    "birthdays":        { "entity_id": "calendar.contact_birthdays",   "role": "context_only" }
  },
  "futureCalendars": [
    { "entity_id": "calendar.baseball_kid1", "role": "kids_sports", "eveningLoadWeight": 0.20 },
    { "entity_id": "calendar.basketball_kid1", "role": "kids_sports", "eveningLoadWeight": 0.20 },
    { "entity_id": "calendar.soccer_kid1", "role": "kids_sports", "eveningLoadWeight": 0.20 }
  ],
  "scoring": { "rachelExhaustionWeight":0.40, "eveningCommitmentWeight":0.25, "derekAbsenceWeight":0.15, "kidsEveningWeight":0.10, "allDayBusyWeight":0.10 },
  "dayOverrides": { "saturday": {"forceStyle":"adventure","busynessCapOverride":0.30}, "friday": {"forceStyle":"light","busynessCapOverride":0.50} }
}
CONF

[ ! -f ~/.agents/data/meal-plans.json ] && echo '{"plans":[],"candidates":[]}' > ~/.agents/data/meal-plans.json
[ ! -f ~/.agents/data/recipe-preferences.json ] && cat > ~/.agents/data/recipe-preferences.json << 'EOF'
{"permanent_denials":[],"favorites":[],"dietary_notes":["No shellfish (Rachel allergy)","Cooking for 2 adults"],"household_rules":["Saturday = adventure day","Weeknight ≤45min unless crockpot","≥1 vegetarian/week","Friday = lighter fare"]}
EOF
[ ! -f ~/.agents/data/shopping-preferences.json ] && cat > ~/.agents/data/shopping-preferences.json << 'EOF'
{"default_servings":2,"substitutions":[{"original":"fresh lemongrass","replacement":"lemongrass paste (tube)"}],"never_buy":[{"ingredient":"anchovy paste","action":"omit"},{"ingredient":"fish sauce","action":"substitute","substitute":"soy sauce + lime juice"}],"store_notes":[{"ingredient":"gochujang","note":"Asian aisle Kroger or H Mart"}]}
EOF
```

### Cron Schedule

```bash
0 9 * * 6 /path/to/trigger-meal-search.sh   # Recipe search Saturday 9 AM
0 8 * * * /path/to/trigger-morning-dinner.sh  # Morning notification daily 8 AM
```

## HA Calendar Integration

### Fetch All Calendar Events

```javascript
const PLANS_PATH = `${process.env.HOME}/.agents/data/meal-plans.json`;
const CONFIG_PATH = `${process.env.HOME}/.agents/data/meal-planner-config.json`;
const PREFS_PATH = `${process.env.HOME}/.agents/data/recipe-preferences.json`;
const SHOP_PATH = `${process.env.HOME}/.agents/data/shopping-preferences.json`;
function loadJSON(p) {
  try { return JSON.parse(require('fs').readFileSync(p, 'utf8')); }
  catch { return null; }
}
function saveJSON(p, d) {
  const fs = require('fs'), path = require('path');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = p + '.tmp';
  fs.writeFileSync(t, JSON.stringify(d, null, 2));
  fs.renameSync(t, p);
}

async function fetchWeekEvents(weekStart, weekEnd, config) {
  const token = process.env[config.homeAssistant.tokenEnvVar], ha = config.homeAssistant.url;
  const allCals = [
    ...Object.entries(config.calendars).map(([id,cal]) => ({...cal, calendarId:id, optional:false})),
    ...(config.futureCalendars||[]).map(fc => ({...fc, calendarId:fc.entity_id, optional:true}))
  ];

  const results = await Promise.allSettled(allCals.map(async cal => {
    const res = await fetch(`${ha}/api/calendars/${cal.entity_id}?start=${weekStart}T00:00:00&end=${weekEnd}T23:59:59`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    if (!res.ok) { if (cal.optional) return []; throw new Error(`${cal.entity_id}: ${res.status}`); }
    return (await res.json()).map(evt => {
      const start = new Date(evt.start.dateTime || evt.start.date), end = new Date(evt.end.dateTime || evt.end.date);
      return { calendarId:cal.calendarId, entity_id:cal.entity_id, role:cal.role,
        summary: cal.canWrite!==false ? (evt.summary||'') : '[Busy]',
        start, end, isAllDay: !evt.start.dateTime };
    });
  }));
  const errors = results.filter((r,i) => r.status==='rejected' && !allCals[i].optional);
  if (errors.length) console.error(`Calendar fetch failed: ${errors.map(e=>e.reason.message).join(', ')}`);
  return results.filter(r=>r.status==='fulfilled').flatMap(r=>r.value).sort((a,b)=>a.start-b.start);
}
```

## Busyness Scoring Engine

### Score Each Day (0.0 – 1.0)

```javascript
function tzHour(dt, tz) { return parseInt(dt.toLocaleString('en-US',{hour:'numeric',hour12:false,timeZone:tz})); }

function scoreDayBusyness(dayEvents, date, config) {
  const w = config.scoring, tz = config.timezone || 'America/Chicago';
  const dayName = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
  const ps = config.prepWindowHours.start, pe = config.prepWindowHours.end;

  // Rachel's peak exhaustion weight (clinicals=0.85, lab=0.55, math=0.25)
  const rachelExhaustion = dayEvents.filter(e => e.role === 'rachel_work').reduce((max, e) => {
    const cal = Object.values(config.calendars).find(c => c.entity_id === e.entity_id);
    return Math.max(max, cal?.exhaustionWeight ?? 0);
  }, 0.0);

  // Evening commitment — Rachel/family event ending ≥ 18:00
  const eveningCommitment = dayEvents.some(e =>
    ['rachel_work','family_events'].includes(e.role) && !e.isAllDay && tzHour(e.end,tz) >= 18) ? 1.0 : 0.0;

  // Derek/Rachel busy in prep window (9am–3pm)
  const busyInPrep = (role) => dayEvents.some(e => e.role===role && !e.isAllDay && tzHour(e.start,tz)<pe && tzHour(e.end,tz)>ps);
  const derekBusy = busyInPrep('derek_availability'), rachelBusy = busyInPrep('rachel_work');

  // Kids evening sports
  const kidsEvening = dayEvents.filter(e => e.role==='kids_sports' && tzHour(e.end,tz)>=17)
    .reduce((m,e) => Math.max(m, (config.futureCalendars||[]).find(c=>c.entity_id===e.entity_id)?.eveningLoadWeight ?? 0.20), 0.0);

  // All-day busy (vacation, travel)
  const allDayBusy = dayEvents.some(e => e.isAllDay &&
    ['rachel_work','derek_availability','family_events'].includes(e.role)) ? 1.0 : 0.0;

  const busynessScore = Math.min(1.0, Math.round((
    rachelExhaustion * w.rachelExhaustionWeight + eveningCommitment * w.eveningCommitmentWeight +
    (derekBusy?1:0) * w.derekAbsenceWeight + kidsEvening * w.kidsEveningWeight + allDayBusy * w.allDayBusyWeight
  ) * 100) / 100);

  const prepPersonHome = !derekBusy ? 'derek' : (!rachelBusy ? 'rachel' : null);
  const slowCookerEligible = prepPersonHome && busynessScore >= 0.45;
  const resolvedStyle = resolveMealStyle(dayName.toLowerCase(), busynessScore, slowCookerEligible, config);

  return {
    date, dayName, busynessScore, isLeftoverNight: busynessScore >= config.leftoverThreshold,
    prepPersonHome, slowCookerEligible, resolvedStyle,
    breakdown: { rachelExhaustion, eveningCommitment, derekAbsence: derekBusy?1:0, kidsEvening, allDayBusy },
    events: dayEvents.map(e => ({ calendar: e.calendarId, summary: e.summary, start: e.start.toISOString(), end: e.end.toISOString() }))
  };
}

```

### Style Resolution & Week Analysis

```javascript
function resolveMealStyle(dayName, score, slowCookerOk, config) {
  const ov = config.dayOverrides?.[dayName];
  if (ov?.forceStyle && score <= (ov.busynessCapOverride ?? 1.0)) return ov.forceStyle;
  if (score >= config.leftoverThreshold) return 'leftover';
  if (slowCookerOk) return 'slow-cooker';
  return score >= 0.45 ? 'quick' : 'normal';
}

function analyzeWeek(events, weekStart, config) {
  const start = new Date(weekStart);
  return Array.from({length:7}, (_,i) => {
    const d = new Date(start); d.setDate(start.getDate()+i);
    const ds = d.toISOString().slice(0,10);
    return scoreDayBusyness(events.filter(e => e.start.toISOString().slice(0,10)===ds), ds, config);
  });
}
```

## Meal Day Selection & Assignment

### Select 3–5 Cook Days

```javascript
function selectMealDays(dayScores, config) {
  const { min, max } = config.mealsPerWeek;
  // Saturday always included — pull it from full list, not just cookable
  const saturday = dayScores.find(ds => ds.dayName === 'Saturday');
  const othersBelow = dayScores.filter(ds => ds.dayName !== 'Saturday' && !ds.isLeftoverNight)
    .sort((a, b) => a.busynessScore - b.busynessScore);
  // Guarantee min — if not enough non-leftover days, take least-busy regardless
  const pool = othersBelow.length >= min - (saturday ? 1 : 0)
    ? othersBelow
    : dayScores.filter(ds => ds.dayName !== 'Saturday').sort((a, b) => a.busynessScore - b.busynessScore);
  const rest = pool.slice(0, max - (saturday ? 1 : 0));
  return [saturday, ...rest].filter(Boolean).slice(0, max)
    .sort((a, b) => a.date.localeCompare(b.date));
}

```

### Assign Recipes to Days

```javascript
function assignMealsToDays(recipes, mealDays, config) {
  const used = new Set(), usedD = new Set(), assignments = [];
  const isSlow = r => r.tags?.some(t => /slow.?cook|crock.?pot|instant.?pot/i.test(t));
  const sorted = [...recipes].sort((a,b) => (isSlow(a)?0:1)-(isSlow(b)?0:1) || (b.total_time_min||45)-(a.total_time_min||45));

  for (const r of sorted) {
    if (used.size >= mealDays.length) break;
    const day = mealDays.find(d => {
      if (usedD.has(d.date)) return false;
      if (isSlow(r)) return d.resolvedStyle === 'slow-cooker';
      if (d.resolvedStyle === 'adventure') return (r.total_time_min||45) >= 45;
      if (d.resolvedStyle === 'quick') return (r.total_time_min||45) <= 30;
      return true;
    });
    if (day) { assignments.push({ date:day.date, day:day.dayName, recipe_id:r.id, mealie_slug:null, assignment_reason:buildReason(day,r) }); usedD.add(day.date); used.add(r.id); }
  }
  // Fill remaining
  for (const d of mealDays) { if (usedD.has(d.date)) continue; const r=recipes.find(x=>!used.has(x.id)); if(r) { assignments.push({date:d.date,day:d.dayName,recipe_id:r.id,mealie_slug:null,assignment_reason:`Fill — ${d.dayName}`}); usedD.add(d.date); used.add(r.id); } }
  return assignments.sort((a,b)=>a.date.localeCompare(b.date));
}

function buildReason(day, recipe) {
  const p = [];
  if (day.resolvedStyle==='adventure') p.push('Adventure day');
  if (day.resolvedStyle==='light') p.push('Friday lighter');
  if (day.resolvedStyle==='slow-cooker') p.push(`Crockpot — ${day.prepPersonHome} home, prep by 10am`);
  if (day.resolvedStyle==='quick') p.push('Quick cook');
  if (day.breakdown.rachelExhaustion>0) { const l = day.breakdown.rachelExhaustion>=0.8?'clinicals':day.breakdown.rachelExhaustion>=0.5?'lab':'math'; p.push(`Rachel: ${l}`); }
  p.push(`${(day.busynessScore*100).toFixed(0)}% busy | ${recipe.total_time_min||'~45'}min`);
  return p.join(' | ');
}
```

## Recipe Search & Discord Flow

### Search Recipes

Find individual recipe pages that match the week's meal styles and household preferences. **Never return collection/listicle/gallery pages** — only single-recipe URLs that Mealie can import via JSON-LD `Recipe` schema.

```javascript
async function searchRecipes(planId, prefs, count) {
  const plans = loadJSON(PLANS_PATH);
  const plan = plans.plans.find(p => p.id === planId);
  const styles = plan.dayScores.filter(ds => !ds.isLeftoverNight).map(ds => ds.resolvedStyle);

  // Build style-specific search queries targeting INDIVIDUAL recipes
  const styleQueries = {
    adventure:    'site:bonappetit.com OR site:seriouseats.com OR site:halfbakedharvest.com "recipe" impressive dinner',
    normal:       'site:budgetbytes.com OR site:cookingclassy.com OR site:damndelicious.net dinner recipe',
    quick:        'site:skinnytaste.com OR site:budgetbytes.com OR site:damndelicious.net 30 minute dinner recipe',
    'slow-cooker':'site:budgetbytes.com OR site:therecipecritic.com OR site:damndelicious.net slow cooker crockpot recipe',
    light:        'site:cookingclassy.com OR site:skinnytaste.com OR site:pinchofyum.com light healthy dinner recipe'
  };

  // Search for each needed style, collecting individual recipe URLs
  const candidates = [];
  for (const style of [...new Set(styles)]) {
    const query = styleQueries[style] || styleQueries.normal;
    // Agent: perform web search with this query. For each result:
    // 1. Check the URL with isIndividualRecipeURL()
    // 2. IF INDIVIDUAL: fetch the page, confirm single recipe, build candidate object
    // 3. IF COLLECTION: call extractRecipesFromCollection(result.url, 5)
    //    — add each extracted individual recipe to candidates
    // 4. Continue searching until enough valid candidates are found
    // This ensures collection pages are MINED for recipes, not discarded
  }

  // Apply preference filters
  const denials = prefs.permanent_denials.map(d => d.source_url);
  const dietaryNotes = prefs.dietary_notes; // e.g. "No shellfish (Rachel allergy)"
  return candidates
    .filter(c => !denials.includes(c.source_url))
    .filter(c => isIndividualRecipeURL(c))
    .slice(0, count)
    .map(c => ({ ...c, plan_id: planId, status: 'suggested', decided_at: null }));
}
```

### Recipe URL Validation

Reject collection/listicle/gallery pages. Only accept URLs pointing to a single recipe with importable structured data.

```javascript
// URL path patterns that indicate collection pages (NOT individual recipes)
const COLLECTION_URL_PATTERNS = [
  /\/gallery\//i,        // allrecipes.com/gallery/...
  /\/collection\//i,     // tasteofhome.com/collection/...
  /\/recipes\/photos\//i,// foodnetwork.com/recipes/photos/...
  /\/g\d+\//i,           // thepioneerwoman.com/food-cooking/meals-menus/g31981626/...
  /\/meals-menus\/g/i,   // thepioneerwoman.com roundups
  /\/roundup\//i,
  /\/best-.*-recipes/i,  // catch-all for "best X recipes" category paths
];

// Title patterns that indicate listicle/collection pages
const COLLECTION_TITLE_PATTERNS = [
  /^\d+\s+(best|easy|quick|fancy|impressive|perfect|favorite)/i,  // "55 Best Dinner Recipes"
  /\d+\s+(dinner|recipe|meal)\s*(idea|recipe)s?\s*(for|of|that|to)/i, // "40 Dinner Ideas for Tonight"
  /\d+\s+(ways|things)\s+to\s+(cook|make)/i,
];

function isIndividualRecipeURL(candidate) {
  const url = candidate.source_url || '';
  const title = candidate.title || '';

  // Reject if URL matches collection patterns
  if (COLLECTION_URL_PATTERNS.some(p => p.test(url))) return false;

  // Reject if title matches listicle patterns
  if (COLLECTION_TITLE_PATTERNS.some(p => p.test(title))) return false;

  // Reject if missing key single-recipe signals (collection pages never have these)
  if (candidate.total_time_min === null && candidate.servings === 0 && (!candidate.tags || candidate.tags.length === 0)) return false;

  return true;
}
```

### Collection Crawling

When a search result is a collection/roundup page, the agent extracts individual recipe URLs from it instead of discarding it.

```javascript
const MAX_RECIPES_PER_COLLECTION = 5;

async function extractRecipesFromCollection(collectionUrl, maxRecipes = MAX_RECIPES_PER_COLLECTION) {
  // Agent: fetch the collection page HTML, then:
  // 1. Find all <a> tags with href pointing to recipe-slug paths
  //    - Prefer links on the SAME DOMAIN as collectionUrl
  //    - Prefer links inside <article>, <li>, or elements with class/id containing "recipe"
  //    - Skip navigation, footer, sidebar links
  //    - Skip links matching COLLECTION_URL_PATTERNS (nested collections)
  // 2. For each extracted link (up to maxRecipes):
  //    a. Build a candidate object: { source_url, title: link text }
  //    b. Validate with isIndividualRecipeURL(candidate)
  //    c. If valid, fetch the individual recipe page and populate full candidate fields:
  //       { id: uuid(), title, description, total_time_min, tags, source_url, cuisine, difficulty, servings }
  // 3. Return array of fully populated, validated candidates

  // Extraction priority for links on the page:
  // - First: links inside elements with class/id matching /recipe/i
  // - Second: links inside <article> or <li> elements
  // - Last: any remaining links with recipe-slug-shaped paths (e.g., /chicken-tikka-masala/)
  // Always skip: links to categories, tags, about pages, navigation, social media
}
```

**Collection crawling rules for the agent:**
1. Only crawl a page as a collection if `isIndividualRecipeURL()` returns false for it
2. Cap extraction at 5 individual recipes per collection page
3. Every extracted recipe URL MUST pass `isIndividualRecipeURL()` before becoming a candidate
4. Prefer same-domain links — a collection on budgetbytes.com should yield budgetbytes.com recipe links
5. Each extracted recipe must be fetched individually to confirm it has structured recipe data (title, cook time, ingredients)
6. If a collection page yields zero valid individual recipes after crawling, discard it and move on

**Search rules for the agent:**
1. Always search for **individual recipe pages** — URLs like `budgetbytes.com/slow-cooker-chicken-tikka-masala/` not `allrecipes.com/gallery/best-dinners/`
2. Every candidate URL MUST have a single recipe with: a title, cook time, ingredients list, and instructions
3. Prefer recipe blogs known for clean structured data: Budget Bytes, Damn Delicious, Cooking Classy, Half Baked Harvest, Pinch of Yum, Serious Eats, Bon Appetit, Skinnytaste, The Recipe Critic
4. Avoid category/gallery/collection pages from allrecipes.com, tasteofhome.com, foodnetwork.com, thepioneerwoman.com — their individual recipe pages are fine, but their roundup/gallery URLs are not
5. Before adding a candidate, verify the URL path looks like a single recipe slug (e.g. `/chicken-tikka-masala/`) not a category path (e.g. `/gallery/best-chicken-recipes/`)
6. Apply `isIndividualRecipeURL()` to every candidate before posting to Discord
7. Respect `dietary_notes` — no shellfish for Rachel, cooking for 2 adults
8. Respect `household_rules` — Saturday adventure, weeknight ≤45min unless crockpot, ≥1 vegetarian/week, Friday lighter fare
9. Each candidate object must include: `{ id: uuid(), title, description, total_time_min, tags, source_url, cuisine, difficulty, servings }`

### Weekly Cycle

```javascript
async function handleMealWeek(channel) {
  const config = loadJSON(CONFIG_PATH);
  const plans = loadJSON(PLANS_PATH);
  const today = new Date();

  // Calculate Saturday–Friday range
  const saturday = new Date(today);
  const dow = today.getDay();
  saturday.setDate(today.getDate() + ((6 - dow + 7) % 7));
  const friday = new Date(saturday); friday.setDate(saturday.getDate() + 6);
  const weekStart = saturday.toISOString().slice(0, 10);
  const weekEnd = friday.toISOString().slice(0, 10);

  // Fetch HA calendars and score the week
  const events = await fetchWeekEvents(weekStart, weekEnd, config);
  const dayScores = analyzeWeek(events, weekStart, config);
  const mealDays = selectMealDays(dayScores, config);
  const leftoverDays = dayScores.filter(ds => !mealDays.some(md => md.date === ds.date));

  const planId = `MP-${String(plans.plans.length + 1).padStart(4, '0')}`;
  plans.plans.push({
    id: planId, week_start: weekStart, week_end: weekEnd,
    status: 'planning', created_at: new Date().toISOString(),
    finalized_at: null, meals: [], dayScores, channel_message_id: null
  });
  saveJSON(PLANS_PATH, plans);

  // Post week analysis
  let analysis = `🍽️ **Week of ${weekStart}** (\`${planId}\`)\n`;
  for (const ds of dayScores) {
    const icon = ds.isLeftoverNight ? '🍕' : ds.resolvedStyle === 'slow-cooker' ? '🍲' :
                 ds.resolvedStyle === 'adventure' ? '🌟' : ds.resolvedStyle === 'quick' ? '⚡' : '🍳';
    analysis += `${icon} **${ds.dayName}** — ${ds.isLeftoverNight ? 'Leftovers' : ds.resolvedStyle} [${(ds.busynessScore*100).toFixed(0)}%]`;
    if (ds.prepPersonHome && ds.slowCookerEligible) analysis += ` 🏠 ${ds.prepPersonHome}`;
    analysis += '\n';
  }
  analysis += `\n📋 **${mealDays.length} meals**, ${leftoverDays.length} leftover nights. Searching...`;
  await channel.send(analysis);

  // Search and post recipe cards with reaction controls
  const candidates = await searchRecipes(planId, loadJSON(PREFS_PATH), mealDays.length + 3);
  for (const recipe of candidates) {
    const msg = await channel.send({ embeds: [{
      title: `🍳 ${recipe.id} — ${recipe.title}`, url: recipe.source_url,
      description: recipe.description?.substring(0, 200) || '',
      fields: [
        { name: 'Cuisine', value: recipe.cuisine || '?', inline: true },
        { name: 'Time', value: `${recipe.total_time_min || '?'}min`, inline: true },
        { name: 'Tags', value: recipe.tags?.join(', ') || 'none', inline: true }
      ],
      footer: { text: '✅ Approve  ❌ Deny forever  ⏭️ Skip week  ✏️ Revise' },
      color: recipe.difficulty === 'easy' ? 0x2ECC71 : recipe.difficulty === 'medium' ? 0xF1C40F : 0xE74C3C
    }] });
    recipe.channel_message_id = msg.id;
    for (const emoji of ['✅', '❌', '⏭️', '✏️']) await msg.react(emoji);
  }
  plans.candidates.push(...candidates);
  saveJSON(PLANS_PATH, plans);
  await channel.send(`📋 **${candidates.length} recipes posted!** Need ${mealDays.length} approvals.`);
}
```

### Reaction Handler

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (reaction.message.channel.name !== 'meal-planning' || user.bot) return;
  const plans = loadJSON(PLANS_PATH);
  const c = plans.candidates.find(x => x.channel_message_id === reaction.message.id);
  if (!c || c.status !== 'suggested') return;
  const ch = reaction.message.channel, emoji = reaction.emoji.name;
  c.decided_at = new Date().toISOString(); c.author_reaction = user.username;

  if (emoji === '✅') {
    c.status = 'approved';
    const plan = plans.plans.find(p => p.id === c.plan_id);
    const count = plans.candidates.filter(x => x.plan_id === c.plan_id && x.status === 'approved').length;
    const needed = selectMealDays(plan.dayScores, loadJSON(CONFIG_PATH)).length;
    saveJSON(PLANS_PATH, plans);
    if (count >= needed) { await ch.send(`🎉 **${count} approved — building!**`); return buildSchedule(ch, c.plan_id); }
    await ch.send(`✅ **${c.title}** approved (${count}/${needed})`);
  } else if (emoji === '❌') {
    c.status = 'denied_permanent';
    const prefs = loadJSON(PREFS_PATH);
    prefs.permanent_denials.push({ title: c.title, source_url: c.source_url, denied_at: c.decided_at });
    saveJSON(PREFS_PATH, prefs);
    await ch.send(`❌ **${c.title}** permanently denied.`);
  } else if (emoji === '⏭️') { c.status = 'denied_week'; }
  else if (emoji === '✏️') {
    await ch.send(`✏️ Revision notes for **${c.title}**? (2 min)`);
    try { c.revision_notes = (await ch.awaitMessages({filter:m=>m.author.id===user.id,max:1,time:120000})).first().content; c.status='revision_requested'; }
    catch { await ch.send('⏰ Timed out.'); }
  }
  saveJSON(PLANS_PATH, plans);
});
```

### Build Schedule

```javascript
async function buildSchedule(channel, planId) {
  const config = loadJSON(CONFIG_PATH);
  const plans = loadJSON(PLANS_PATH);
  const plan = plans.plans.find(p => p.id === planId);
  const approved = plans.candidates.filter(c => c.plan_id === planId && c.status === 'approved');
  const mealDays = selectMealDays(plan.dayScores, config);

  plan.meals = assignMealsToDays(approved, mealDays, config);

  // Import to Mealie
  for (const meal of plan.meals) {
    const recipe = approved.find(c => c.id === meal.recipe_id);
    if (!recipe) continue;
    try {
      recipe.mealie_slug = await importToMealie(recipe);
      meal.mealie_slug = recipe.mealie_slug;
      await createMealieMealPlanEntry(meal, recipe);
    } catch (err) { console.error(`Mealie failed: ${err.message}`); }
  }

  plan.status = 'finalized';
  plan.finalized_at = new Date().toISOString();
  saveJSON(PLANS_PATH, plans);

  // Post final schedule — meals + leftover nights
  let out = `🍽️ **Meal Plan — ${plan.week_start} to ${plan.week_end}**\n${'━'.repeat(45)}\n\n`;
  for (const ds of plan.dayScores) {
    const meal = plan.meals.find(m => m.date === ds.date);
    if (meal) {
      const r = approved.find(c => c.id === meal.recipe_id);
      const icon = ds.resolvedStyle === 'adventure' ? '🌟' : ds.resolvedStyle === 'slow-cooker' ? '🍲' : '🍳';
      out += `${icon} **${ds.dayName}** — **${r.title}** (${r.total_time_min||'?'}min)\n   📋 _${meal.assignment_reason}_\n`;
    } else {
      out += `🍕 **${ds.dayName}** — Leftovers [${(ds.busynessScore*100).toFixed(0)}% busy]\n`;
    }
  }
  out += `\n📦 Mealie synced | 🛒 \`!shoplist\` for shopping list`;
  await channel.send(out);
}
```

## Mealie Integration

```javascript
async function importToMealie(recipe) {
  const res = await fetch(`${process.env.MEALIE_URL}/api/recipes/create/url`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.MEALIE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: recipe.source_url })
  });
  return (await res.text()).replace(/"/g, '');
}

async function createMealieMealPlanEntry(meal, recipe) {
  const recipeRes = await fetch(`${process.env.MEALIE_URL}/api/recipes/${recipe.mealie_slug}`,
    { headers: { 'Authorization': `Bearer ${process.env.MEALIE_API_TOKEN}` } });
  const mealieRecipe = await recipeRes.json();
  await fetch(`${process.env.MEALIE_URL}/api/households/mealplans`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.MEALIE_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date: meal.date, entryType: 'dinner', title: recipe.title, text: meal.assignment_reason, recipeId: mealieRecipe.id })
  });
}
```

## Shopping List

```javascript
async function generateShoppingList(channel, planId) {
  const plans = loadJSON(PLANS_PATH), plan = plans.plans.find(p => p.id === planId);
  const recipes = plans.candidates.filter(c => c.plan_id === planId && c.status === 'approved' && c.mealie_slug);
  const sp = loadJSON(SHOP_PATH);
  const subs = new Map(sp.substitutions.map(s => [s.original.toLowerCase(), s.replacement]));
  const bans = new Map(sp.never_buy.map(n => [n.ingredient.toLowerCase(), n]));
  const notes = new Map(sp.store_notes.map(n => [n.ingredient.toLowerCase(), n.note]));
  const final = [], omitted = [], swapped = [];

  for (const r of recipes) {
    const full = await (await fetch(`${process.env.MEALIE_URL}/api/recipes/${r.mealie_slug}`,
      { headers: { 'Authorization': `Bearer ${process.env.MEALIE_API_TOKEN}` } })).json();
    const scale = sp.default_servings / (parseInt(full.recipeYield) || 4);
    for (const ing of (full.recipeIngredient || [])) {
      let t = scaleIngredient(ing.note || ing.display || '', scale), lo = t.toLowerCase();
      const ban = [...bans.entries()].find(([k]) => lo.includes(k));
      if (ban) { if (ban[1].action==='omit') { omitted.push(t); continue; } if (ban[1].substitute) { swapped.push([t,ban[1].substitute]); t=ban[1].substitute; } }
      const sub = [...subs.entries()].find(([k]) => lo.includes(k));
      if (sub) { swapped.push([t,sub[1]]); t=t.replace(new RegExp(sub[0],'i'),sub[1]); }
      final.push({ t, r: r.title, n: [...notes.entries()].find(([k]) => lo.includes(k))?.[1] });
    }
  }
  let out = `🛒 **Shopping List — ${plan.week_start}** (scaled to 2)\n━━━━━━━━━━━━━━━━━━━\n`;
  for (const i of final) { out += `• ${i.t} _(${i.r})_`; if (i.n) out += ` 📍 ${i.n}`; out += '\n'; }
  if (swapped.length) { out += '\n**🔄 Swaps:**\n'; for (const [f,t] of swapped) out += `• ~~${f}~~ → **${t}**\n`; }
  if (omitted.length) { out += '\n**🚫 Omitted:**\n'; for (const o of omitted) out += `• ~~${o}~~\n`; }
  await channel.send(out);
}

function scaleIngredient(text, factor) {
  if (factor === 1) return text;
  return text.replace(/(\d+\/\d+|\d+\.?\d*)/, (m) => {
    const n = m.includes('/') ? m.split('/').reduce((a,b)=>a/b) : parseFloat(m);
    const s = n * factor;
    if (s === Math.floor(s)) return String(s);
    const f = {0.25:'1/4',0.33:'1/3',0.5:'1/2',0.67:'2/3',0.75:'3/4'}[Math.round((s%1)*100)/100];
    return f ? (Math.floor(s)>0 ? `${Math.floor(s)} ${f}` : f) : s.toFixed(1).replace(/\.0$/,'');
  });
}
```

## Morning Notification

```javascript
async function morningDinnerNotification(channel) {
  const plans = loadJSON(PLANS_PATH), plan = plans.plans.find(p => p.status === 'finalized');
  if (!plan) return;
  const today = new Date().toISOString().slice(0, 10);
  const meal = plan.meals.find(m => m.date === today);
  const ds = plan.dayScores?.find(d => d.date === today);

  if (!meal) {
    if (ds?.isLeftoverNight) await channel.send(`🍕 **${ds.dayName}** — Leftover night! [${(ds.busynessScore*100).toFixed(0)}% busy] 🛋️`);
    return;
  }
  const recipe = plans.candidates.find(c => c.id === meal.recipe_id);
  if (!recipe) return;

  const alerts = [];
  const isSlow = recipe.tags?.some(t => /slow.?cook|crock.?pot|instant.?pot/i.test(t));
  if (ds?.prepPersonHome && isSlow) alerts.push(`🍲 **${ds.prepPersonHome}**, start crockpot prep by 10am!`);
  if (recipe.mealie_slug) {
    try {
      const full = await (await fetch(`${process.env.MEALIE_URL}/api/recipes/${recipe.mealie_slug}`,
        { headers: { 'Authorization': `Bearer ${process.env.MEALIE_API_TOKEN}` } })).json();
      const steps = (full.recipeInstructions||[]).map(s=>s.text||'').join(' ').toLowerCase();
      if (/thaw|defrost/.test(steps)) alerts.push('🧊 Something needs thawing!');
      if (/marinat|hours ahead/.test(steps)) alerts.push('⏰ Advance prep needed');
    } catch {}
  }

  let out = `☀️ **Tonight — ${meal.day}**: **${recipe.title}** (${recipe.total_time_min||'?'}min)\n`;
  out += `🔗 ${recipe.source_url}\n📋 _${meal.assignment_reason}_\n`;
  if (alerts.length) { out += '\n⚠️ '; out += alerts.join(' | '); }
  await channel.send(out);

  await fetch(`http://10.10.7.60:8123/api/events/meal_plan_updated`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${process.env.HA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: recipe.title, url: recipe.source_url })
  }).catch(() => {});
}
```

## Commands

```javascript
const COMMANDS = {
  '!mealweek':   'Start new weekly planning cycle — analyze calendar, search recipes, post cards',
  '!mealplan':   'Show full week schedule with leftover nights marked',
  '!tonight':    'What\'s for dinner tonight? (or confirm leftover night)',
  '!mealstatus': 'Show approval progress (X/Y approved)',
  '!mealreset':  'Archive current plan, start fresh',
  '!shoplist':   'Generate scaled shopping list with Rachel\'s preferences',
  '!search <q>': 'Manual recipe search to add a candidate card',
  '!favorites':  'Show household favorite recipes',
  '!sub add/list/remove': 'Manage ingredient substitutions',
  '!neverbuy add/list/remove': 'Manage never-buy list',
  '!storenote add/list': 'Manage store-specific notes',
  '!deny list/remove': 'Manage permanent recipe denials',
  '!mealhelp':   'Show all commands'
};
```

## Shell Helpers

```bash
# Plan status
jq '.plans[-1]|{id,status,meals:(.meals|length),days:[.dayScores[]|{d:.dayName,b:.busynessScore,s:.resolvedStyle}]}' ~/.agents/data/meal-plans.json
# This week's HA events
for E in calendar.personal calendar.family_shared_derek calendar.clinicals_rachel calendar.lab_rachel calendar.math_rachel; do echo "--- ${E#calendar.} ---"
  curl -sH "Authorization: Bearer $HA_TOKEN" "http://10.10.7.60:8123/api/calendars/${E}?start=$(date -v+sat +%Y-%m-%d)T00:00:00&end=$(date -v+fri -v+1w +%Y-%m-%d)T23:59:59" \
    | python3 -c "import sys,json;[print(f'  {e[\"start\"].get(\"dateTime\",e[\"start\"][\"date\"])[:16]}  {e[\"summary\"]}') for e in json.load(sys.stdin)]" 2>/dev/null; done
```

## Scheduling Rules

| Busyness Score | Day Type | Meal Style |
|---|---|---|
| Saturday (score ≤ 0.30) | Adventure override | Complex new recipe, up to 180 min |
| Friday (score ≤ 0.50) | Light override | Easy/leftover-friendly, ≤ 45 min |
| 0.00 – 0.44 | Clear day | Normal cook, ≤ 60 min |
| 0.45 – 0.64 + someone home 9–3 | Prep window available | Slow cooker — set AM, eat PM |
| 0.45 – 0.64, nobody home | Busy, no prep | Quick cook only, ≤ 30 min |
| ≥ 0.65 | Leftover night | No meal planned |

**Weights:** Rachel exhaustion 40% (clinicals=0.85, lab=0.55, math=0.25) · Evening 25% · Derek absence 15% · Kids 10% · All-day 10%

## Tips

- Plan 3–5 meals, embrace leftovers. 4 planned + 3 leftover nights = a good week.
- Clinicals almost always trigger leftover nights (0.85 × 0.40 = 0.34 alone; add evening → over 0.65).
- Crockpot alert names WHO starts it ("Derek, start crockpot by 10am!") based on 9am–3pm window.
- Use ✏️ revision notes over ❌ permanent deny. "Something like this but chicken" beats a flat rejection.
- Add kids' sports to `futureCalendars` when they appear in HA — zero code changes needed.
- Tune `leftoverThreshold` (0.65): raise for fewer leftover nights, lower for more.
- Saturday stays as adventure day unless busyness exceeds 0.30.
- Morning notifications fire on leftover nights too — nobody wonders what's for dinner.
