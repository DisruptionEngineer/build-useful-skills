---
name: family-assistant
description: Handle home-life queries about calendars, meal plans, shopping lists, weather, contacts, reminders, and photos via Home Assistant, Mealie, and Immich APIs. Use when someone asks what is on the calendar, what is for dinner, what is on the shopping list, what the weather is, to show family photos, or to find a contact. Integrates with HA REST API for calendars/weather/shopping, Mealie for meals/recipes, Immich for photo slideshows, and Nextcloud CardDAV for contacts.
metadata: {"clawdbot":{"emoji":"👨‍👩‍👧‍👦","requires":{"anyBins":["curl","jq","python3"]},"os":["linux","darwin"]}}
---

# Family Assistant

Handle everyday household queries for the Mattson family (Derek, Rachel) via the Jarvis voice assistant or Discord. Classify the incoming question, call the appropriate API (Home Assistant, Mealie, Immich, Nextcloud), and return a concise spoken or text answer. This is the knowledge layer — the voice pipeline (home-voice-assistant) calls these handlers after intent classification.

## When to Use

- Adding or modifying an HA integration handler (calendar, shopping, weather)
- Configuring family-aware calendar routing (Derek vs Rachel vs Family)
- Setting up Mealie meal plan and recipe search queries
- Adding Immich photo slideshow triggers
- Managing the HA shopping list via voice
- Configuring weather from HA entity or wttr.in forecast
- Looking up contacts from Nextcloud CardDAV
- Setting persistent reminders

## Prerequisites

```bash
# Home Assistant (primary data source)
HA_URL="http://10.10.7.60:8123"
HA_TOKEN="your-long-lived-access-token"

# Mealie (meal planning + recipes)
MEALIE_URL="http://10.10.7.55:9000"
MEALIE_TOKEN="your-mealie-api-token"       # Settings > API Tokens

# Immich (photo search + slideshows)
IMMICH_URL="https://photos.hotmessexpress.xyz"
IMMICH_API_KEY="your-immich-api-key"        # Administration > API Keys

# Nextcloud (contacts via CardDAV)
NEXTCLOUD_URL="https://hub.hotmessexpress.xyz"
NEXTCLOUD_USER="disruptionengineer"
NEXTCLOUD_APP_PASSWORD="your-app-password"

# Weather location default
WEATHER_LOCATION="Austin,TX"
```

```text
HA Calendar Entities:
  Derek:  calendar.personal, calendar.family_shared_derek
  Rachel: calendar.clinicals_rachel, calendar.lab_rachel, calendar.math_rachel
  Meals:  calendar.mealie_breakfast, calendar.mealie_lunch, calendar.mealie_dinner
  Sports: calendar.baseball_derek, calendar.basketball_derek

HA Shopping: todo.shopping_list (primary voice target)
HA Weather:  weather.forecast_home
```

## Family-Aware Calendar Queries

### Profile-Based Routing

```python
FAMILY_PROFILES = {
    "derek": {
        "calendars": ["calendar.personal", "calendar.family_shared_derek"],
        "name": "Derek"
    },
    "rachel": {
        "calendars": ["calendar.clinicals_rachel", "calendar.lab_rachel", "calendar.math_rachel"],
        "name": "Rachel"
    },
    "family": {
        "calendars": [
            "calendar.personal", "calendar.family_shared_derek",
            "calendar.clinicals_rachel", "calendar.lab_rachel",
            "calendar.math_rachel", "calendar.mealie_dinner"
        ],
        "name": "Family"
    }
}

def detect_profile(text):
    """Determine whose calendar to query from utterance."""
    if re.search(r"\brachel'?s?\b", text, re.I): return "rachel"
    if re.search(r"\bfamily\b", text, re.I): return "family"
    if re.search(r"\beveryone\b", text, re.I): return "family"
    return "derek"  # default user
```

### HA Calendar API

```bash
# Fetch events for a date range
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  "http://10.10.7.60:8123/api/calendars/calendar.personal?start=2026-03-06T00:00:00&end=2026-03-06T23:59:59"
# Returns: [{"summary": "Dentist", "start": {"dateTime": "2026-03-06T14:00:00-06:00"}, ...}]
```

### Calendar Handler

```python
def handle_calendar(text):
    profile_key = detect_profile(text)
    profile = FAMILY_PROFILES[profile_key]
    start, end, label = extract_date_range(text)

    events = []
    for cal in profile["calendars"]:
        url = f"{HA_URL}/api/calendars/{cal}?start={start}&end={end}"
        r = requests.get(url, headers=HA_HEADERS, timeout=5)
        if r.ok:
            for e in r.json():
                dt_str = e.get("start", {}).get("dateTime") or e.get("start", {}).get("date", "")
                events.append({"summary": e.get("summary", "Event"), "start": dt_str, "calendar": cal})

    events.sort(key=lambda e: e["start"])
    if not events:
        return f"Nothing on {profile['name']}'s calendar for {label}."

    lines = []
    for e in events[:8]:
        try:
            dt = datetime.fromisoformat(e["start"].replace("Z", "+00:00"))
            time_str = dt.strftime("%I:%M%p").lstrip("0")
        except Exception:
            time_str = "All day"
        lines.append(f"{e['summary']} at {time_str}")
    return f"{profile['name']}'s {label} ({len(events)} events): " + ", ".join(lines)

def extract_date_range(text):
    """Parse today/tomorrow/this week/weekend from utterance."""
    now = datetime.now()
    fmt = "%Y-%m-%dT%H:%M:%S"
    if "tomorrow" in text.lower():
        d = now + timedelta(days=1)
        return d.replace(hour=0, minute=0).strftime(fmt), d.replace(hour=23, minute=59).strftime(fmt), "tomorrow"
    if "this week" in text.lower():
        start = now - timedelta(days=now.weekday())
        end = start + timedelta(days=6)
        return start.strftime(fmt), end.replace(hour=23, minute=59).strftime(fmt), "this week"
    if "weekend" in text.lower():
        days_until_sat = (5 - now.weekday()) % 7
        sat = now + timedelta(days=days_until_sat)
        sun = sat + timedelta(days=1)
        return sat.replace(hour=0, minute=0).strftime(fmt), sun.replace(hour=23, minute=59).strftime(fmt), "this weekend"
    # Default: today
    return now.replace(hour=0, minute=0).strftime(fmt), now.replace(hour=23, minute=59).strftime(fmt), "today"
```

## Weather Queries

### Tier 1: HA Entity (Instant)

```python
def handle_weather_quick():
    """Read cached weather from HA entity (no API call, <100ms)."""
    r = requests.get(f"{HA_URL}/api/states/weather.forecast_home", headers=HA_HEADERS, timeout=5)
    if r.ok:
        d = r.json()
        attrs = d.get("attributes", {})
        return f"Currently {d['state']}, {attrs.get('temperature')} degrees with {attrs.get('humidity')}% humidity."
    return None
```

### Tier 2: wttr.in Forecast (Detailed)

```python
def handle_weather_forecast(text):
    """Detailed forecast via wttr.in for questions about tomorrow, rain, etc."""
    location = WEATHER_LOCATION
    loc_match = re.search(r"(?:weather|forecast)\s+(?:in|for|at)\s+([A-Za-z\s,]+)", text, re.I)
    if loc_match: location = loc_match.group(1).strip()

    r = requests.get(f"https://wttr.in/{location}?format=j1", timeout=5)
    if not r.ok: return f"Could not fetch forecast for {location}."
    data = r.json()
    current = data["current_condition"][0]
    tomorrow = data["weather"][1]

    if "tomorrow" in text.lower() or "rain" in text.lower():
        chance = max(int(h.get("chanceofrain", 0)) for h in tomorrow.get("hourly", [{"chanceofrain": 0}]))
        return f"Tomorrow in {location}: {tomorrow['maxtempF']}/{tomorrow['mintempF']}F, {chance}% chance of rain."
    return f"{location}: {current['weatherDesc'][0]['value']}, {current['temp_F']}F (feels {current['FeelsLikeF']}F), wind {current['windspeedMiles']}mph."
```

## Shopping List (HA Native)

HA's built-in `todo.shopping_list` is the primary voice target. Shows on dashboards and Companion app.

### HA Shopping API Patterns

```bash
# Add item
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "http://10.10.7.60:8123/api/services/todo/add_item" \
  -d '{"entity_id": "todo.shopping_list", "item": "milk"}'

# Get items (via WebSocket or service call)
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "http://10.10.7.60:8123/api/services/todo/get_items" \
  -d '{"entity_id": "todo.shopping_list", "status": "needs_action"}'

# Complete item
curl -s -X POST -H "Authorization: Bearer $HA_TOKEN" -H "Content-Type: application/json" \
  "http://10.10.7.60:8123/api/services/todo/update_item" \
  -d '{"entity_id": "todo.shopping_list", "item": "milk", "status": "completed"}'
```

### Shopping Handler

```python
def handle_shopping_add(text):
    """Add item to HA shopping list."""
    m = re.search(r"(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:shopping|grocery)\s*list", text, re.I)
    if not m: return "What should I add to the list?"
    item = m.group(1).strip()
    r = ha_post("/api/services/todo/add_item", {"entity_id": "todo.shopping_list", "item": item})
    return f"Added {item} to the shopping list." if r else f"Failed to add {item}."

def handle_shopping_query():
    """Read HA shopping list items."""
    r = ha_post("/api/services/todo/get_items", {"entity_id": "todo.shopping_list", "status": "needs_action"})
    # Parse response for item list
    items = parse_todo_items(r)
    if not items: return "The shopping list is empty."
    return f"Shopping list ({len(items)} items): {', '.join(items)}"
```

## Meal Planning (Mealie)

### Mealie API Patterns

```bash
# Today's meal plan
curl -s -H "Authorization: Bearer $MEALIE_TOKEN" \
  "http://10.10.7.55:9000/api/households/mealplans/today"

# This week's plans
curl -s -H "Authorization: Bearer $MEALIE_TOKEN" \
  "http://10.10.7.55:9000/api/households/mealplans?start_date=2026-03-06&end_date=2026-03-12"

# Recipe search
curl -s -H "Authorization: Bearer $MEALIE_TOKEN" \
  "http://10.10.7.55:9000/api/recipes?search=chicken&perPage=5"
```

### Meal Handler

```python
def handle_meal(text):
    mealie_url = CFG.get("mealie", {}).get("url", "")
    headers = {"Authorization": f"Bearer {os.environ.get('MEALIE_TOKEN', '')}"}

    if re.search(r"tonight|today|for dinner|for lunch", text, re.I):
        r = requests.get(f"{mealie_url}/api/households/mealplans/today", headers=headers, timeout=5)
        if r.ok:
            plans = r.json()
            dinner = next((p for p in plans if p.get("entryType") == "dinner"), plans[0] if plans else None)
            if dinner and dinner.get("recipe"):
                return f"Tonight's dinner: {dinner['recipe']['name']}"
        return "No dinner planned for tonight."

    if re.search(r"this week|meal plan|weekly", text, re.I):
        start = datetime.now().strftime("%Y-%m-%d")
        end = (datetime.now() + timedelta(days=6)).strftime("%Y-%m-%d")
        r = requests.get(f"{mealie_url}/api/households/mealplans?start_date={start}&end_date={end}", headers=headers, timeout=5)
        if r.ok:
            plans = r.json().get("items", [])
            if plans:
                lines = [f"{p['date']}: {p.get('recipe', {}).get('name', 'TBD')}" for p in plans]
                return "This week's meals: " + "; ".join(lines)
        return "No meal plans this week."

    # Recipe search
    query = re.sub(r"(find|search|recipe|for|with|a)\s*", "", text, flags=re.I).strip()
    r = requests.get(f"{mealie_url}/api/recipes", headers=headers, params={"search": query, "perPage": 3}, timeout=5)
    if r.ok:
        items = r.json().get("items", [])
        if items:
            return "Found: " + ", ".join(i["name"] for i in items[:3])
    return f"No recipes found for '{query}'."
```

## Immich Photo Slideshow

Voice commands trigger a slideshow on a separate display (tablet/HA dashboard), not the e-ink screen.

```python
def handle_slideshow(text):
    """Search Immich for photos and trigger slideshow on kitchen display."""
    immich_url = CFG.get("immich", {}).get("url", "")
    api_key = os.environ.get("IMMICH_API_KEY", "")
    if not immich_url or not api_key:
        return "Immich is not configured."

    # Extract search query
    query = re.sub(r"(show|display|play|me|some|photos?|pictures?|images?)\s*", "", text, flags=re.I).strip()
    if not query: query = "family"

    # Search via Immich smart search API
    r = requests.post(f"{immich_url}/api/search/smart", headers={"x-api-key": api_key},
                      json={"query": query, "type": "IMAGE"}, timeout=10)
    if not r.ok:
        return f"Immich search failed."

    assets = r.json().get("assets", {}).get("items", [])
    count = len(assets)
    if not count:
        return f"No photos found matching '{query}'."

    # Trigger HA browser_mod to show slideshow on kitchen tablet
    slideshow_entity = CFG.get("immich", {}).get("slideshow_entity", "")
    if slideshow_entity:
        album_url = f"{immich_url}/search?q={query}&type=image"
        ha_post("/api/services/browser_mod/navigate", {"entity_id": slideshow_entity, "url": album_url})

    return f"Found {count} photos matching '{query}'. Starting slideshow on the kitchen display."
```

## Contact Lookup (Nextcloud CardDAV)

```python
def lookup_contact(query):
    """Search Family Rolodex address book via CardDAV."""
    import base64
    auth = base64.b64encode(f"{NEXTCLOUD_USER}:{NEXTCLOUD_APP_PASSWORD}".encode()).decode()
    body = f'''<?xml version="1.0" encoding="UTF-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
  <d:prop><d:getetag/><card:address-data/></d:prop>
  <card:filter><card:prop-filter name="FN">
    <card:text-match collation="i;unicode-casemap" match-type="contains">{query}</card:text-match>
  </card:prop-filter></card:filter>
</card:addressbook-query>'''

    r = requests.request("REPORT", f"{NEXTCLOUD_URL}/remote.php/dav/addressbooks/users/{NEXTCLOUD_USER}/family-rolodex/",
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/xml; charset=utf-8", "Depth": "1"},
        data=body, timeout=10)
    if not r.ok: return f"Contact search failed."

    # Parse vCard from XML response
    import re as _re
    cards = _re.findall(r"BEGIN:VCARD[\s\S]*?END:VCARD", r.text)
    results = []
    for vc in cards[:3]:
        fn = _re.search(r"^FN[;:](.+)$", vc, _re.M)
        tel = _re.search(r"^TEL[;:](.+)$", vc, _re.M)
        name = fn.group(1).strip() if fn else "?"
        phone = tel.group(1).strip().split(":")[-1] if tel else None
        results.append(f"{name}: {phone}" if phone else name)
    return ", ".join(results) if results else f"No contacts matching '{query}'."
```

## Health Check

```bash
echo "--- HA ---"
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/"
echo -e "\n--- Mealie ---"
curl -s -o /dev/null -w "%{http_code}" "${MEALIE_URL}/api/app/about"
echo -e "\n--- Immich ---"
curl -s -o /dev/null -w "%{http_code}" -H "x-api-key: $IMMICH_API_KEY" "$IMMICH_URL/api/server/info"
echo -e "\n--- Nextcloud ---"
curl -s -o /dev/null -w "%{http_code}" -u "${NEXTCLOUD_USER}:${NEXTCLOUD_APP_PASSWORD}" \
  "${NEXTCLOUD_URL}/remote.php/dav/calendars/${NEXTCLOUD_USER}/"
echo -e "\n--- Weather ---"
curl -s -o /dev/null -w "%{http_code}" "wttr.in/Austin,TX?format=3"
```

## Tips

- HA calendar API at `/api/calendars/{entity}` returns JSON directly — no XML parsing needed. Always prefer this over raw CalDAV for voice queries.
- The HA shopping list (`todo.shopping_list`) is the default voice target because it syncs to dashboards and the Companion app. Mealie shopping is kept for recipe-linked ingredient lists only.
- Mealie's `/api/households/mealplans/today` returns an array, not a single object. Filter by `entryType` (breakfast, lunch, dinner, side) to get the right meal.
- Immich smart search uses CLIP embeddings — "beach photos" actually works for finding beach photos even without tags. The search is surprisingly accurate.
- Family profile detection defaults to Derek. For future voice ID, use speaker embeddings to auto-detect who's speaking.
- Weather uses HA entity for quick reads (Tier 1, cached) and wttr.in for detailed forecasts (Tier 2, live API). This avoids unnecessary API calls for simple "what's the weather" questions.
- CardDAV `text-match` with `collation="i;unicode-casemap"` is case-insensitive. "dentist" matches "Dr. Smith - Family Dentist".
- All HA API calls use a long-lived access token via environment variable `HA_TOKEN`. Generate at Profile > Long-Lived Access Tokens.
- Calendar URIs in HA follow the pattern `calendar.{friendly_name_slugified}`. Verify with `curl -s -H "Authorization: Bearer $HA_TOKEN" "$HA_URL/api/states" | jq '.[].entity_id' | grep calendar`.
- If Mealie is down, the meal handler returns a graceful fallback message rather than crashing the voice pipeline.
