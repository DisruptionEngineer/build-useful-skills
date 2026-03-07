# Fix saveJSON Directory Error + Collection Crawling — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix two bugs in the weekly-meal-planner skill: saveJSON crashing on missing directory, and recipe search discarding collection pages instead of crawling them for individual recipes.

**Architecture:** Both fixes are edits to SKILL.md, which is a skill-as-spec file (agent instructions, not compiled code). Fix 1 makes file I/O self-healing. Fix 2 adds a collection-crawling step to the search pipeline so collection pages become sources of individual recipes rather than dead ends.

**Tech Stack:** Markdown skill file with embedded JavaScript reference code.

---

### Task 1: Fix saveJSON to create directory if missing

**Files:**
- Modify: `SKILL.md:83-84` (loadJSON and saveJSON functions)

**Step 1: Replace loadJSON with defensive version**

Edit `SKILL.md` line 83. Replace:
```javascript
function loadJSON(p) { return JSON.parse(require('fs').readFileSync(p, 'utf8')); }
```
With:
```javascript
function loadJSON(p) {
  try { return JSON.parse(require('fs').readFileSync(p, 'utf8')); }
  catch { return null; }
}
```

**Step 2: Replace saveJSON with self-healing version**

Edit `SKILL.md` line 84. Replace:
```javascript
function saveJSON(p, d) { const t=p+'.tmp'; require('fs').writeFileSync(t,JSON.stringify(d,null,2)); require('fs').renameSync(t,p); }
```
With:
```javascript
function saveJSON(p, d) {
  const fs = require('fs'), path = require('path');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const t = p + '.tmp';
  fs.writeFileSync(t, JSON.stringify(d, null, 2));
  fs.renameSync(t, p);
}
```

**Step 3: Verify the edit reads correctly**

Read `SKILL.md` lines 78-95 and confirm:
- `loadJSON` has try/catch returning null
- `saveJSON` has `mkdirSync` before write
- Surrounding code (constants above, fetchWeekEvents below) is unchanged

**Step 4: Commit**

```bash
git add SKILL.md
git commit -m "fix: make saveJSON self-healing with mkdirSync and loadJSON null-safe"
```

---

### Task 2: Add extractRecipesFromCollection function

**Files:**
- Modify: `SKILL.md` — insert new section after the `isIndividualRecipeURL` code block (after line 323, before line 325)

**Step 1: Insert collection extraction function and agent instructions**

Insert after line 323 (the closing ` ``` ` of the isIndividualRecipeURL block), before the "**Search rules for the agent:**" line:

````markdown

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
````

**Step 2: Verify the new section reads correctly**

Read the area around the insertion to confirm:
- `isIndividualRecipeURL` code block ends cleanly
- New "### Collection Crawling" section follows
- "**Search rules for the agent:**" section follows after

**Step 3: Commit**

```bash
git add SKILL.md
git commit -m "feat: add extractRecipesFromCollection for crawling roundup pages"
```

---

### Task 3: Update searchRecipes to use collection crawling

**Files:**
- Modify: `SKILL.md:263-272` (the agent comment block inside searchRecipes)

**Step 1: Replace the search loop agent instructions**

Edit `SKILL.md` lines 263-272. Replace:
```javascript
  // Search for each needed style, collecting individual recipe URLs
  const candidates = [];
  for (const style of [...new Set(styles)]) {
    const query = styleQueries[style] || styleQueries.normal;
    // Agent: perform web search with this query. For each result:
    // 1. Check the URL passes isIndividualRecipeURL() below
    // 2. Fetch the page and confirm it has a single recipe (title, cook time, ingredients)
    // 3. Build the candidate object from the page's structured data
    // Continue searching until enough valid candidates are found
  }
```
With:
```javascript
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
```

**Step 2: Verify the edit reads correctly**

Read `SKILL.md` lines 260-285 and confirm:
- The search loop now references both individual and collection paths
- The `extractRecipesFromCollection` call is clearly documented
- The surrounding code (styleQueries above, preference filters below) is unchanged

**Step 3: Commit**

```bash
git add SKILL.md
git commit -m "feat: update searchRecipes to crawl collections instead of discarding them"
```

---

### Task 4: Update search rules list

**Files:**
- Modify: `SKILL.md` — the "Search rules for the agent:" numbered list (after the Recipe URL Validation section, now after the Collection Crawling section)

**Step 1: Update rule 1 and add rule 10**

Edit the search rules list. Change rule 1 from:
```
1. Always search for **individual recipe pages** — URLs like `budgetbytes.com/slow-cooker-chicken-tikka-masala/` not `allrecipes.com/gallery/best-dinners/`
```
To:
```
1. Always prefer **individual recipe pages** — URLs like `budgetbytes.com/slow-cooker-chicken-tikka-masala/`. When a search result is a collection page (e.g., `allrecipes.com/gallery/best-dinners/`), crawl it to extract individual recipe links instead of discarding it.
```

Add after rule 9:
```
10. When a search result fails `isIndividualRecipeURL()`, treat it as a collection page: fetch it, extract individual recipe links using `extractRecipesFromCollection()`, validate each, and add valid ones to candidates. Never discard a collection without first attempting to extract recipes from it.
```

**Step 2: Update the introductory text**

Edit the line before the search rules (currently `SKILL.md:246`). Change:
```
Find individual recipe pages that match the week's meal styles and household preferences. **Never return collection/listicle/gallery pages** — only single-recipe URLs that Mealie can import via JSON-LD `Recipe` schema.
```
To:
```
Find individual recipe pages that match the week's meal styles and household preferences. When search results include collection/listicle/gallery pages, crawl them to extract individual recipe URLs. Only individual single-recipe URLs (importable via JSON-LD `Recipe` schema) should become candidates.
```

**Step 3: Verify all search rules read correctly**

Read the full search rules section and confirm rules 1-10 are coherent and non-contradictory.

**Step 4: Commit**

```bash
git add SKILL.md
git commit -m "docs: update search rules to reflect collection crawling behavior"
```

---

### Task 5: Final review

**Step 1: Read full SKILL.md and verify coherence**

Read the entire file and check:
- `loadJSON` / `saveJSON` updated near top
- `searchRecipes` references collection crawling
- `extractRecipesFromCollection` section exists between URL validation and search rules
- Search rules 1 and 10 reference collection crawling
- Introductory text no longer says "never return collection pages"
- No broken markdown (unclosed code blocks, mismatched headers)

**Step 2: Verify no unintended changes**

Run `git diff HEAD~4` and confirm only the intended sections changed:
- Lines 83-84 area (loadJSON/saveJSON)
- Lines 246 area (intro text)
- Lines 263-272 area (search loop)
- New section between URL validation and search rules
- Search rules 1 and 10

**Step 3: Final commit if any cleanup needed**

Only if the review reveals issues. Otherwise, done.
