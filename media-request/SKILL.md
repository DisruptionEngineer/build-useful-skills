---
name: media-request
description: Manage media requests and search your home media library via Jellyseerr and Emby. Use when requesting movies or TV shows, searching the existing library, checking what's currently playing, viewing download/request status, or getting recommendations for movie night. Covers Jellyseerr request workflows, Emby library queries, active session monitoring, and arr stack status.
metadata: {"clawdbot":{"emoji":"🎬","requires":{"anyBins":["node","curl"]},"os":["linux","darwin"]}}
---

# Media Request

Manage a home media server stack through Discord. Handle media requests via Jellyseerr, search the Emby library, monitor active playback sessions, check download status, and suggest recommendations. Bridges Discord with Jellyseerr (request management + TMDB search) and Emby (library + playback).

## When to Use

- A user wants to request a movie or TV show ("Add Dune to our watchlist")
- Searching the existing Emby library for titles, genres, or actors
- Checking what's currently streaming on any device ("What's playing right now?")
- Viewing the status of pending or in-progress download requests
- Getting movie or show recommendations for a specific mood or occasion
- Checking recently added content ("What's new in the library?")
- Querying whether a specific title is already available before requesting it

## Prerequisites

### Configuration File

All API keys, base URLs, and credentials are stored in `~/.agents/config/media-request-config.json`. Create this file with the following structure:

```json
{
  "jellyseerr": {
    "baseUrl": "https://jellyseerr.example.com",
    "apiKey": "YOUR_JELLYSEERR_API_KEY"
  },
  "emby": {
    "baseUrl": "http://YOUR_EMBY_HOST:8099",
    "apiKey": "YOUR_EMBY_API_KEY"
  },
  "jellyfin": {
    "baseUrl": "http://YOUR_JELLYFIN_HOST:8096",
    "apiKey": "YOUR_JELLYFIN_API_KEY"
  }
}
```

### Load Config Helper

```javascript
const fs = require('fs');
const os = require('os');
const path = require('path');

function loadConfig() {
  const configPath = path.join(os.homedir(), '.agents', 'config', 'media-request-config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
const config = loadConfig();
```

### Connectivity Check

```bash
# Load values from config file first
CONFIG="$HOME/.agents/config/media-request-config.json"
JELLYSEERR_URL=$(jq -r '.jellyseerr.baseUrl' "$CONFIG")
JELLYSEERR_API_KEY=$(jq -r '.jellyseerr.apiKey' "$CONFIG")
EMBY_URL=$(jq -r '.emby.baseUrl' "$CONFIG")
EMBY_API_KEY=$(jq -r '.emby.apiKey' "$CONFIG")

curl -s -o /dev/null -w "%{http_code}" -H "X-Api-Key: $JELLYSEERR_API_KEY" "$JELLYSEERR_URL/api/v1/status"
curl -s -o /dev/null -w "%{http_code}" "$EMBY_URL/emby/System/Info?api_key=$EMBY_API_KEY"
# Both should return 200
```

### Household and Arr Stack

Three users: **Derek** (admin), **Rachel**, **Austin** — authorized via `~/.agents/config/authorized-users.json`. Jellyseerr auto-routes requests to Radarr (movies), Sonarr (TV), Lidarr (music), Readarr (books) via Prowlarr indexers and SABnzbd. Bazarr handles subtitles. No direct arr API calls needed.

## Intent Classification

```javascript
const MEDIA_INTENTS = {
  request: {
    keywords: ['request', 'add', 'download', 'get me', 'can we get',
               'watchlist', 'want to watch', 'queue up', 'grab'],
    handler: 'handleMediaRequest'
  },
  search: {
    keywords: ['search', 'find', 'do we have', 'is there', 'look up',
               'what movies', 'what shows', 'browse', 'look for'],
    handler: 'handleLibrarySearch'
  },
  nowPlaying: {
    keywords: ['playing', 'watching', 'streaming', 'active', 'on right now',
               'currently', 'who is watching', 'what\'s on'],
    handler: 'handleNowPlaying'
  },
  status: {
    keywords: ['status', 'downloading', 'pending', 'progress', 'my requests',
               'queue', 'how long', 'eta', 'when will'],
    handler: 'handleRequestStatus'
  },
  recent: {
    keywords: ['recently added', 'new in', 'what\'s new', 'latest',
               'just added', 'recently', 'new movies', 'new shows'],
    handler: 'handleRecentlyAdded'
  },
  recommend: {
    keywords: ['recommend', 'suggest', 'what should', 'movie night',
               'something to watch', 'family movie', 'pick a movie',
               'in the mood for', 'feel like watching'],
    handler: 'handleRecommendation'
  }
};

function classifyMediaIntent(text) {
  const lower = text.toLowerCase();
  for (const [intent, config] of Object.entries(MEDIA_INTENTS)) {
    if (config.keywords.some(k => lower.includes(k))) {
      return { intent, handler: config.handler };
    }
  }
  return { intent: 'search', handler: 'handleLibrarySearch' };
}
```

## Message Listener

```javascript
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AUTH_PATH = path.join(os.homedir(), '.agents', 'config', 'authorized-users.json');

function loadConfig() {
  const configPath = path.join(os.homedir(), '.agents', 'config', 'media-request-config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}
const config = loadConfig();

const JELLYSEERR_URL = config.jellyseerr.baseUrl;
const JELLYSEERR_API_KEY = config.jellyseerr.apiKey;
const EMBY_URL = config.emby.baseUrl;
const EMBY_API_KEY = config.emby.apiKey;
const JELLYSEERR_HEADERS = { 'X-Api-Key': JELLYSEERR_API_KEY, 'Content-Type': 'application/json' };

const MEDIA_STATUS = { 1: 'Unknown', 2: 'Pending', 3: 'Processing', 4: 'Partially Available', 5: 'Available' };
const REQUEST_STATUS = { 1: 'Pending Approval', 2: 'Approved', 3: 'Declined' };

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessageReactions]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'media') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) return;

  await message.react('🎬');
  const { intent, handler } = classifyMediaIntent(message.content);
  try {
    const response = await handlers[handler](message.content, message.author.username);
    await message.reply(response);
  } catch (err) {
    console.error(`[media-request] ${intent} error:`, err);
    await message.reply('Something went wrong talking to the media server. Try again in a moment.');
  }
});
```

## Title Extraction

```javascript
function extractTitle(text) {
  const cleaned = text
    .replace(/^(can you |please |hey |yo |can we )/i, '')
    .replace(/^(request|add|download|get me|grab|search for|find|look up|do we have)\s+/i, '')
    .replace(/\s*(to our watchlist|to the library|to plex|to emby|to jellyfin)\s*/i, '')
    .replace(/\s*(season \d+|s\d+|the new season)\s*/i, '')
    .replace(/[?!.]+$/, '')
    .trim();
  const seasonMatch = text.match(/season\s+(\d+)|s(\d+)/i);
  const season = seasonMatch ? parseInt(seasonMatch[1] || seasonMatch[2]) : null;
  return { title: cleaned, season };
}
```

## Media Request Flow

### Search TMDB via Jellyseerr

```javascript
async function searchTMDB(query) {
  const url = `${JELLYSEERR_URL}/api/v1/search?query=${encodeURIComponent(query)}&page=1&language=en`;
  const resp = await fetch(url, { headers: JELLYSEERR_HEADERS });
  const data = await resp.json();
  if (!data.results?.length) return { found: false, results: [] };

  const results = data.results
    .filter(r => r.mediaType === 'movie' || r.mediaType === 'tv')
    .slice(0, 5)
    .map(r => ({
      id: r.id,
      title: r.title || r.name,
      mediaType: r.mediaType,
      year: (r.releaseDate || r.firstAirDate || '').substring(0, 4),
      overview: (r.overview || '').substring(0, 120),
      status: r.mediaInfo?.status || null
    }));
  return { found: true, results };
}
```

### Submit Request and Handle Response

```javascript
async function submitRequest(mediaType, tmdbId) {
  const body = { mediaType, mediaId: tmdbId };
  if (mediaType === 'tv') body.seasons = 'all';

  const resp = await fetch(`${JELLYSEERR_URL}/api/v1/request`, {
    method: 'POST', headers: JELLYSEERR_HEADERS, body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    return { success: false, error: err.message || `HTTP ${resp.status}` };
  }
  const data = await resp.json();
  return { success: true, requestId: data.id, status: data.status };
}

async function handleMediaRequest(text, username) {
  const { title } = extractTitle(text);
  if (!title || title.length < 2) {
    return 'What would you like to request? Try: "Request The Bear" or "Add Dune to our watchlist"';
  }

  const search = await searchTMDB(title);
  if (!search.found) return `No results found for **${title}**. Check spelling or try a different term.`;

  const top = search.results[0];
  if (top.status === 5) return `**${top.title}** (${top.year}) is already in the library! Open Emby to watch it.`;
  if (top.status === 2 || top.status === 3) return `**${top.title}** (${top.year}) has already been requested.`;

  const result = await submitRequest(top.mediaType, top.id);
  if (!result.success) return `Failed to request **${top.title}**: ${result.error}`;

  const typeLabel = top.mediaType === 'tv' ? 'TV Show' : 'Movie';
  return [
    `**${top.title}** (${top.year}) — ${typeLabel}`,
    `Status: ${REQUEST_STATUS[result.status] || 'Submitted'} | Requested by: ${username}`,
    top.overview ? `> ${top.overview}...` : '',
    `Request #${result.requestId} — auto-routed to ${top.mediaType === 'tv' ? 'Sonarr' : 'Radarr'}.`
  ].filter(Boolean).join('\n');
}
```

## Library Search

```javascript
async function searchEmbyLibrary(query, options = {}) {
  const params = new URLSearchParams({
    SearchTerm: query,
    IncludeItemTypes: options.type || 'Movie,Series',
    Limit: options.limit || 10,
    Recursive: true,
    Fields: 'Overview,Genres,CommunityRating,ProductionYear,RunTimeTicks',
    api_key: EMBY_API_KEY
  });
  if (options.genres) params.set('Genres', options.genres);

  const resp = await fetch(`${EMBY_URL}/emby/Items?${params}`);
  const data = await resp.json();
  return (data.Items || []).map(item => ({
    name: item.Name, year: item.ProductionYear, type: item.Type,
    rating: item.CommunityRating ? item.CommunityRating.toFixed(1) : 'N/A',
    runtime: item.RunTimeTicks ? `${Math.round(item.RunTimeTicks / 600000000)}m` : null
  }));
}

async function handleLibrarySearch(text, username) {
  const { title } = extractTitle(text);
  if (!title || title.length < 2) return 'What are you looking for? Try: "Search for action movies" or "Do we have Interstellar?"';

  const genreMatch = text.match(/\b(action|comedy|horror|drama|sci-fi|thriller|romance|animation|documentary|fantasy|mystery)\b/i);
  const results = await searchEmbyLibrary(title, { genres: genreMatch?.[1] });

  if (results.length === 0) {
    const tmdb = await searchTMDB(title);
    if (tmdb.found) {
      const top = tmdb.results[0];
      return `**${title}** is not in the library yet.\nFound on TMDB: **${top.title}** (${top.year})\nSay "request ${top.title}" to add it!`;
    }
    return `Nothing found for **${title}** in the library or on TMDB.`;
  }

  const lines = results.map(r => {
    const rating = r.rating !== 'N/A' ? ` | ${r.rating}` : '';
    return `- **${r.name}** (${r.year || '?'}) — ${r.type}${rating}${r.runtime ? ` | ${r.runtime}` : ''}`;
  });
  return [`**Library results for "${title}":**`, ...lines, `\n${results.length} result(s) in Emby.`].join('\n');
}
```

## Now Playing

```javascript
async function getActiveSessions() {
  const resp = await fetch(`${EMBY_URL}/emby/Sessions?api_key=${EMBY_API_KEY}`);
  const sessions = await resp.json();
  return sessions.filter(s => s.NowPlayingItem).map(s => ({
    user: s.UserName, device: s.DeviceName,
    title: s.NowPlayingItem.Name,
    series: s.NowPlayingItem.SeriesName || null,
    year: s.NowPlayingItem.ProductionYear,
    playState: s.PlayState?.IsPaused ? 'Paused' : 'Playing',
    progress: s.NowPlayingItem.RunTimeTicks && s.PlayState?.PositionTicks
      ? Math.round((s.PlayState.PositionTicks / s.NowPlayingItem.RunTimeTicks) * 100) : null
  }));
}

async function handleNowPlaying(text, username) {
  const sessions = await getActiveSessions();
  if (sessions.length === 0) return 'Nothing is playing right now. The server is idle.';

  const lines = sessions.map(s => {
    const title = s.series ? `${s.series} — ${s.title}` : `${s.title} (${s.year || '?'})`;
    const progress = s.progress !== null ? ` | ${s.progress}%` : '';
    return `- **${s.user}** on ${s.device}: ${title} [${s.playState}${progress}]`;
  });
  return [`**Currently Playing (${sessions.length} stream${sessions.length > 1 ? 's' : ''}):**`, ...lines].join('\n');
}
```

## Request Status

```javascript
async function getRequests(options = {}) {
  const params = new URLSearchParams({
    take: options.take || 20, skip: options.skip || 0, sort: 'added'
  });
  if (options.filter) params.set('filter', options.filter);

  const resp = await fetch(`${JELLYSEERR_URL}/api/v1/request?${params}`, { headers: JELLYSEERR_HEADERS });
  const data = await resp.json();
  return (data.results || []).map(r => ({
    id: r.id, title: r.media?.tmdbTitle || r.media?.title || 'Unknown',
    type: r.type === 'movie' ? 'Movie' : 'TV',
    status: REQUEST_STATUS[r.status] || 'Unknown',
    mediaStatus: MEDIA_STATUS[r.media?.status] || 'Unknown',
    requestedBy: r.requestedBy?.displayName || r.requestedBy?.username || '?',
    createdAt: new Date(r.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }));
}

async function handleRequestStatus(text, username) {
  const myOnly = /\bmy\b/i.test(text);
  const requests = await getRequests({ take: 15, filter: /\bpending\b/i.test(text) ? 'pending' : undefined });
  const filtered = myOnly ? requests.filter(r => r.requestedBy.toLowerCase() === username.toLowerCase()) : requests;

  if (filtered.length === 0) return myOnly ? `No requests found for **${username}**.` : 'No recent requests found.';

  const grouped = {};
  for (const r of filtered) { (grouped[r.mediaStatus] ??= []).push(r); }

  const sections = Object.entries(grouped).map(([status, items]) => {
    const icon = status === 'Available' ? '✅' : status === 'Processing' ? '⏳' : status === 'Pending' ? '🔄' : '❓';
    const lines = items.map(r => `  - ${r.title} (${r.type}) — ${r.createdAt} by ${r.requestedBy}`);
    return `${icon} **${status}:**\n${lines.join('\n')}`;
  });
  return [`**Request Status${myOnly ? ` for ${username}` : ''}:**`, ...sections].join('\n\n');
}
```

## Recently Added

```javascript
async function handleRecentlyAdded(text, username) {
  const resp = await fetch(`${EMBY_URL}/emby/Items/Latest?Limit=12&Fields=ProductionYear,DateCreated&api_key=${EMBY_API_KEY}`);
  const items = await resp.json();
  if (!items.length) return 'Nothing has been added recently.';

  const movies = items.filter(i => i.Type === 'Movie');
  const episodes = items.filter(i => i.Type === 'Episode');
  const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const sections = [];

  if (movies.length) sections.push(`**Recently Added Movies:**\n${movies.map(m => `  - **${m.Name}** (${m.ProductionYear || '?'}) — added ${fmt(m.DateCreated)}`).join('\n')}`);
  if (episodes.length) sections.push(`**Recently Added Episodes:**\n${episodes.map(e => `  - **${e.SeriesName}** — ${e.Name} (added ${fmt(e.DateCreated)})`).join('\n')}`);
  if (!sections.length) sections.push(`**Recently Added:**\n${items.map(i => `  - **${i.Name}** (${i.Type}) — added ${fmt(i.DateCreated)}`).join('\n')}`);
  return sections.join('\n\n');
}
```

## Recommendations

```javascript
async function handleRecommendation(text, username) {
  const lower = text.toLowerCase();
  const moods = {
    family: ['family', 'kids', 'children', 'all ages'],
    scary: ['scary', 'horror', 'spooky', 'creepy'],
    funny: ['funny', 'comedy', 'laugh', 'hilarious'],
    action: ['action', 'exciting', 'adventure', 'intense'],
    romantic: ['romantic', 'romance', 'date night'],
    chill: ['chill', 'relaxing', 'calm', 'background']
  };
  const genreMap = {
    family: 'Family,Animation,Comedy', scary: 'Horror,Thriller', funny: 'Comedy',
    action: 'Action,Adventure', romantic: 'Romance', chill: 'Documentary,Drama'
  };

  let genreFilter = null;
  for (const [mood, kws] of Object.entries(moods)) {
    if (kws.some(k => lower.includes(k))) { genreFilter = mood; break; }
  }

  const params = new URLSearchParams({
    SortBy: 'Random', SortOrder: 'Descending',
    IncludeItemTypes: /\bshow\b|\btv\b|\bseries\b/i.test(text) ? 'Series' : 'Movie',
    Limit: 5, Recursive: true,
    Fields: 'Overview,Genres,CommunityRating,ProductionYear,RunTimeTicks',
    MinCommunityRating: 6.0, api_key: EMBY_API_KEY
  });
  if (genreFilter && genreMap[genreFilter]) params.set('Genres', genreMap[genreFilter]);

  const resp = await fetch(`${EMBY_URL}/emby/Items?${params}`);
  const data = await resp.json();
  const items = data.Items || [];

  if (!items.length) return genreFilter ? `No ${genreFilter} titles in the library. Try requesting something new!` : 'Library is empty or no titles match.';

  const picks = items.map(item => {
    const genres = (item.Genres || []).slice(0, 3).join(', ');
    const rating = item.CommunityRating ? `${item.CommunityRating.toFixed(1)}` : '';
    const runtime = item.RunTimeTicks ? `${Math.round(item.RunTimeTicks / 600000000)}m` : '';
    const meta = [rating, runtime, genres].filter(Boolean).join(' | ');
    return `**${item.Name}** (${item.ProductionYear || '?'})${meta ? `\n  ${meta}` : ''}`;
  });

  return [`**Suggestions${genreFilter ? ` for "${genreFilter}" mood` : ''}** (from your library):`, '', ...picks].join('\n');
}
```

## Handler Registry and Utilities

```javascript
const handlers = {
  handleMediaRequest, handleLibrarySearch, handleNowPlaying,
  handleRequestStatus, handleRecentlyAdded, handleRecommendation
};

function isAuthorizedUser(discordId) {
  const fs = require('fs');
  try {
    const config = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
    return config.authorized_users.some(u => u.discord_id === discordId);
  } catch { return false; }
}

async function safeApiCall(label, fn) {
  try { return await fn(); } catch (err) {
    if (err.message.includes('ECONNREFUSED')) throw new Error(`${label}: Server unreachable.`);
    if (err.message.includes('401') || err.message.includes('403')) throw new Error(`${label}: Auth failed. Check API key.`);
    throw err;
  }
}

client.once('ready', () => console.log(`[media-request] Online as ${client.user.tag}`));
client.login(process.env.DISCORD_BOT_TOKEN);
```

## Deploy via OpenClaw

```bash
openclaw skills list
openclaw channels resolve media
openclaw channels status media
```

## API Quick Reference

```bash
# Load credentials from config
CONFIG="$HOME/.agents/config/media-request-config.json"
JELLYSEERR_URL=$(jq -r '.jellyseerr.baseUrl' "$CONFIG")
JELLYSEERR_API_KEY=$(jq -r '.jellyseerr.apiKey' "$CONFIG")
EMBY_URL=$(jq -r '.emby.baseUrl' "$CONFIG")
EMBY_API_KEY=$(jq -r '.emby.apiKey' "$CONFIG")

# Jellyseerr: search TMDB
curl -s -H "X-Api-Key: $JELLYSEERR_API_KEY" \
  "$JELLYSEERR_URL/api/v1/search?query=Interstellar" | jq '.results[:3] | map({id, title: (.title // .name), mediaType})'

# Jellyseerr: request a movie (mediaId = TMDB ID)
curl -s -X POST -H "X-Api-Key: $JELLYSEERR_API_KEY" -H "Content-Type: application/json" \
  "$JELLYSEERR_URL/api/v1/request" -d '{"mediaType":"movie","mediaId":157336}'

# Jellyseerr: list recent requests
curl -s -H "X-Api-Key: $JELLYSEERR_API_KEY" "$JELLYSEERR_URL/api/v1/request?take=10&sort=added" | jq '.results | map({id, type, status})'

# Emby: search library
curl -s "$EMBY_URL/emby/Items?SearchTerm=Dune&IncludeItemTypes=Movie,Series&Recursive=true&Limit=5&api_key=$EMBY_API_KEY" | jq '.Items | map({Name, Type})'

# Emby: active sessions
curl -s "$EMBY_URL/emby/Sessions?api_key=$EMBY_API_KEY" | jq 'map(select(.NowPlayingItem)) | map({UserName, NowPlaying: .NowPlayingItem.Name})'

# Emby: recently added
curl -s "$EMBY_URL/emby/Items/Latest?Limit=10&api_key=$EMBY_API_KEY" | jq 'map({Name, Type, SeriesName})'

# Emby: browse by genre
curl -s "$EMBY_URL/emby/Items?Genres=Action&IncludeItemTypes=Movie&SortBy=CommunityRating&SortOrder=Descending&Recursive=true&Limit=10&api_key=$EMBY_API_KEY" | jq '.Items | map({Name, CommunityRating})'
```

## Tips

- Always check Emby first before submitting a Jellyseerr request. If the title is already in the library, tell the user to just watch it instead of re-requesting.
- Jellyseerr's `/api/v1/search` hits TMDB, not the local library. Use Emby's `/emby/Items` for local searches. Mixing these up is the most common integration mistake.
- The `mediaInfo.status` field on Jellyseerr search results tells you if something is already requested (2/3) or available (5) without a separate call.
- Emby sessions include idle connections. Always filter on `NowPlayingItem` being present to avoid showing ghost sessions.
- For TV show requests, send `seasons: "all"` as the default. Users rarely want to cherry-pick seasons via chat.
- The Jellyseerr API key is base64-encoded. Pass it as-is in the `X-Api-Key` header; do not URL-encode it.
- Emby uses `api_key` as a query parameter, not a header. This differs from Jellyseerr's header-based auth.
- Recommendations pull from the existing Emby library with `SortBy=Random` and `MinCommunityRating=6.0` to avoid low-quality suggestions.
- Jellyseerr auto-routes movie requests to Radarr and TV requests to Sonarr. No direct arr stack calls needed.
- Genre strings must match Emby's internal names exactly (e.g., "Science Fiction" not "Sci-Fi"). Check `/emby/Genres` if searches return empty.
