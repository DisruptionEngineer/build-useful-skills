# Design: Fix saveJSON Directory Error + Collection Crawling

**Date:** 2026-03-07
**Status:** Approved
**Scope:** weekly-meal-planner SKILL.md

## Problem

Two bugs prevent the meal planner skill from completing a weekly cycle:

1. **saveJSON fails on missing directory** — `saveJSON` writes to `~/.agents/data/meal-plans.tmp` then renames to `meal-plans.json`, but the `~/.agents/data/` directory may not exist. Error: `[Errno 2] No such file or directory: '.../meal-plans.tmp' -> '.../meal-plans.json'`

2. **Collection pages kill recipe search** — Web searches return collection/roundup pages (e.g., "55 Best Slow Cooker Recipes"). The `isIndividualRecipeURL()` filter correctly rejects these, but since most top search results ARE collections, the agent ends up with zero or too few recipe candidates.

## Fix 1: Self-healing saveJSON + Defensive loadJSON

### saveJSON

Add `mkdirSync` before writing to ensure the parent directory exists:

```javascript
function saveJSON(p, d) {
  const fs = require('fs'), path = require('path');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = p + '.tmp';
  fs.writeFileSync(t, JSON.stringify(d, null, 2));
  fs.renameSync(t, p);
}
```

### loadJSON

Return `null` when the file doesn't exist, so callers can initialize with defaults:

```javascript
function loadJSON(p) {
  try { return JSON.parse(require('fs').readFileSync(p, 'utf8')); }
  catch { return null; }
}
```

Each caller (handleMealWeek, buildSchedule, etc.) checks for `null` and initializes the file with the prerequisite defaults if missing. This makes the shell prerequisite block optional.

## Fix 2: Collection Crawling

### New function: extractRecipesFromCollection

When `isIndividualRecipeURL()` rejects a search result, instead of discarding it, the agent crawls the collection page to extract individual recipe URLs.

**Steps:**
1. Fetch the collection page HTML
2. Extract `<a>` tags whose `href` points to individual recipe paths
3. Filter: prefer same-domain links, skip nav/footer/sidebar, skip nested collections
4. Cap at 5 recipes per collection page
5. Validate each extracted URL through `isIndividualRecipeURL()`
6. Fetch each valid URL to build candidate objects (title, cook time, tags, etc.)

### Updated searchRecipes flow

```
For each web search result:
  if isIndividualRecipeURL(result):
    add to candidates directly
  else:
    extractRecipesFromCollection(result.url, 5)
    add extracted individual recipes to candidates
  stop when enough valid candidates found
```

### Collection link extraction heuristics

- Look for `<a>` tags with href containing recipe-slug patterns (e.g., `/slow-cooker-chicken-tikka-masala/`)
- Prefer links on the same domain as the collection page
- Prefer links inside `<article>`, `<li>`, or elements with class/id containing "recipe"
- Skip navigation, footer, sidebar links
- Skip links matching `COLLECTION_URL_PATTERNS` (nested collections)

### New agent instruction (rule 10)

> When a search result is a collection/roundup/listicle page (detected by URL or title patterns), DO NOT discard it. Fetch the page and extract individual recipe links from it. Each extracted link must pass `isIndividualRecipeURL()` before becoming a candidate.

## Changes to SKILL.md

1. Update `saveJSON` function with `mkdirSync` guard
2. Update `loadJSON` function with try/catch null return
3. Add `extractRecipesFromCollection()` function + extraction heuristics
4. Update `searchRecipes()` to use collection crawling instead of discarding
5. Add agent search rule 10
