---
name: media-manager
description: Manage a home media collection via Discord — search, request, track, and convert movies and TV shows across Jellyseerr, Sonarr, Radarr, and NZB download clients. Use when adding shows or movies to the library, checking download status, processing BD/ISO disc rips on Unraid, handling wife's show requests from a Discord channel, or automating the full request-to-playable pipeline. Full Discord integration with reaction-based approval workflow.
metadata: {"clawdbot":{"emoji":"🎬","requires":{"anyBins":["jq","curl","ssh"]},"os":["linux","darwin","win32"]}}
---

# Media Manager

The hub for your home media pipeline. Accept movie and TV show names from Discord, search TMDB via Jellyseerr, check library status, and route approved requests through Sonarr/Radarr for automatic download. Monitor NZBGet/SABnzbd progress. Automate BD/ISO ripping and transcoding on Unraid over SSH. Post status updates back to Discord.

## When to Use

- Wife texts a show/movie name — check if you have it or request it
- Adding new media to the library
- Checking download status or library contents
- Ripping a Blu-ray disc or ISO on Unraid
- Monitoring download queues
- Reviewing/approving media requests via Discord reactions

## Prerequisites

### Shared Bot

Uses the OpenClaw Discord bot — no separate bot needed.

### Discord Channels

Create under a **Media** category:

| Channel | Purpose |
|---------|---------|
| `#media-requests` | Drop show/movie names here — entry point for all requests |
| `#media-status` | Download progress, library additions, conversion updates |
| `#disc-rip` | BD/ISO ripping jobs — start, monitor, complete disc conversions |

Bot needs `SEND_MESSAGES`, `ADD_REACTIONS`, `READ_MESSAGES`, `EMBED_LINKS` in all three.

### Media Services Configuration

Store API keys in `~/.agents/config/media-services.json`:

```bash
mkdir -p ~/.agents/config
cat > ~/.agents/config/media-services.json << 'TEMPLATE'
{
  "jellyseerr": { "baseUrl": "http://10.10.7.55:5055", "apiKey": "" },
  "sonarr": { "baseUrl": "http://10.10.7.55:8989", "apiKey": "", "qualityProfileId": 1, "rootFolderPath": "/tv" },
  "radarr": { "baseUrl": "http://10.10.7.55:7878", "apiKey": "", "qualityProfileId": 1, "rootFolderPath": "/movies" },
  "nzbget": { "baseUrl": "http://10.10.7.55:6789", "username": "nzbget", "password": "" },
  "sabnzbd": { "baseUrl": "http://10.10.7.55:8080", "apiKey": "" },
  "unraid": { "host": "10.10.7.55", "user": "root", "sshKeyPath": "~/.ssh/id_rsa", "isoPath": "/mnt/user/media/iso", "ripOutputPath": "/mnt/user/media/rips", "transcodePath": "/mnt/user/media/transcoded", "moviesPath": "/mnt/user/media/movies", "tvPath": "/mnt/user/media/tv" },
  "kids": {
    "radarr": { "baseUrl": "http://10.10.7.5:7878", "apiKey": "", "qualityProfileId": 1, "rootFolderPath": "/data/media/movies" },
    "sonarr": { "baseUrl": "http://10.10.7.5:8989", "apiKey": "", "qualityProfileId": 1, "rootFolderPath": "/data/media/tv" },
    "sabnzbd": { "baseUrl": "http://10.10.7.5:8080", "apiKey": "" }
  }
}
TEMPLATE

# Get API keys from each service's Settings > General page
# Get quality profile IDs: curl -s "http://HOST:PORT/api/v3/qualityprofile" -H "X-Api-Key: KEY" | jq '.[].id'
# Get root folder paths: curl -s "http://HOST:PORT/api/v3/rootfolder" -H "X-Api-Key: KEY" | jq '.[].path'
# Test SSH: ssh root@10.10.7.55 "echo 'Unraid SSH OK'"
```

### Data Directory

```bash
mkdir -p ~/.agents/data
[ ! -f ~/.agents/data/media-requests.json ] && echo '{"requests": []}' > ~/.agents/data/media-requests.json
[ ! -f ~/.agents/data/disc-rip-jobs.json ] && echo '{"jobs": []}' > ~/.agents/data/disc-rip-jobs.json
```

## Media Request Schema

Each request in `~/.agents/data/media-requests.json`:

```json
{
  "id": "MR-0001", "timestamp": "2026-02-28T12:00:00.000Z",
  "author": "disruptionengineer", "author_discord_id": "1439787060763426926",
  "raw_text": "The Bear", "media_type": "tv",
  "title": "The Bear", "year": 2022, "tmdb_id": 136315,
  "status": "new", "library_status": "not_in_library",
  "jellyseerr_request_id": null, "sonarr_id": null, "radarr_id": null,
  "download_progress": null, "requested_by": "wife",
  "channel_message_id": "1234567890123456789"
}
```

**Status values:** `new` | `searched` | `already_available` | `already_requested` | `requested` | `downloading` | `downloaded` | `available` | `denied` | `failed`

## Disc Rip Job Schema

Each job in `~/.agents/data/disc-rip-jobs.json`:

```json
{
  "id": "RIP-0001", "timestamp": "2026-02-28T12:00:00.000Z",
  "source_type": "iso", "source_path": "/mnt/user/media/iso/MovieTitle.iso",
  "title_name": "Movie Title", "rip_status": "pending",
  "transcode_preset": "HQ 1080p30 Surround", "progress_pct": 0
}
```

**Rip status values:** `pending` | `ripping` | `ripped` | `transcoding` | `transcoded` | `moving` | `complete` | `failed`

## Step-by-Step: Media Request Workflow

### Step 1: Listen and Detect Intent

Any message in `#media-requests` from an authorized user is treated as a media request. No commands needed.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'media-requests') return;
  if (message.author.bot || !isAuthorizedUser(message.author.id)) return;
  if (message.content.startsWith('[SYSTEM]')) return;
  await handleMediaRequest(message);
});

function detectIntent(text) {
  const lower = text.trim().toLowerCase();
  if (/^!status\b/.test(lower) || /^status\s+/i.test(lower))
    return { intent: 'status', query: lower.replace(/^!?status\s*/i, '') };
  if (/^!queue$|^!downloads$/.test(lower)) return { intent: 'queue' };
  if (/^!have\s+|^!search\s+|^do (?:we|i) have\s+/i.test(lower))
    return { intent: 'library_check', query: lower.replace(/^!?(?:have|search)\s*|^do (?:we|i) have\s*/i, '') };
  return { intent: 'request', query: text.trim() };
}
```

### Step 2: Search Jellyseerr / TMDB and Check Library

```javascript
async function searchMedia(query) {
  const config = loadConfig();
  const { baseUrl, apiKey } = config.jellyseerr;
  const resp = await fetch(
    `${baseUrl}/api/v1/search?query=${encodeURIComponent(query)}&page=1&language=en`,
    { headers: { 'X-Api-Key': apiKey } }
  );
  const data = await resp.json();
  return data.results.slice(0, 5).map(r => ({
    tmdb_id: r.id,
    title: r.title || r.name,
    year: (r.releaseDate || r.firstAirDate || '').substring(0, 4),
    media_type: r.mediaType,
    overview: (r.overview || '').substring(0, 200),
    poster_url: r.posterPath ? `https://image.tmdb.org/t/p/w500${r.posterPath}` : null,
    library_status: r.mediaInfo?.status === 5 ? 'available'
      : r.mediaInfo?.status === 3 ? 'processing'
      : r.mediaInfo?.status === 2 ? 'pending' : 'not_in_library'
  }));
}

async function checkLibrary(title, mediaType) {
  const config = loadConfig();
  const svc = mediaType === 'tv' ? config.sonarr : config.radarr;
  const endpoint = mediaType === 'tv' ? 'series' : 'movie';
  const resp = await fetch(`${svc.baseUrl}/api/v3/${endpoint}`, {
    headers: { 'X-Api-Key': svc.apiKey }
  });
  const items = await resp.json();
  const match = items.find(i => i.title.toLowerCase().includes(title.toLowerCase()));
  if (!match) return { in_library: false };
  if (mediaType === 'tv') {
    return { in_library: true, id: match.id, title: match.title, status: match.status,
      episodes_have: match.episodeFileCount, episodes_total: match.totalEpisodeCount,
      pct: Math.round((match.episodeFileCount / match.totalEpisodeCount) * 100) };
  }
  return { in_library: true, id: match.id, title: match.title,
    has_file: match.hasFile, size_gb: (match.sizeOnDisk / 1073741824).toFixed(1) };
}
```

### Step 3: Post Results with Reaction Controls

For each result, post an embed with title/year/overview/poster/type/status/TMDB ID. Color-code: green=available, grey=not in library, yellow=processing. Footer contains `requestId | Result N of M` (used to match reactions). Add 👍/👎 reactions for items not in library, 📺 for items already available. For kids-detected content, add 🧒 instead of/alongside 👍.

```javascript
async function postSearchResults(channel, results, requestId) {
  if (!results.length) { await channel.send(`No results for **${requestId}**. Try different spelling or add year.`); return; }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const embed = {
      title: `${i + 1}. ${r.title} (${r.year})`, description: r.overview || 'No description.',
      thumbnail: r.poster_url ? { url: r.poster_url } : undefined,
      fields: [{ name: 'Type', value: r.media_type === 'tv' ? 'TV Series' : 'Movie', inline: true },
        { name: 'Status', value: { available: '🟢 In Library', processing: '🟡 Downloading', pending: '🟠 Requested', not_in_library: '⚪ Not in Library' }[r.library_status], inline: true }],
      color: r.library_status === 'available' ? 0x2ECC71 : r.library_status === 'not_in_library' ? 0x95A5A6 : 0xF1C40F,
      footer: { text: `${requestId} | Result ${i + 1} of ${results.length}` }
    };
    const msg = await channel.send({ embeds: [embed] });
    if (r.library_status === 'not_in_library') { await msg.react('👍'); await msg.react('👎'); }
    else if (r.library_status === 'available') { await msg.react('📺'); }
  }
}
```

### Step 4: Handle Reactions — Approve or Deny

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || !isAuthorizedUser(user.id)) return;
  if (reaction.message.channel.name !== 'media-requests') return;
  const footerMatch = reaction.message.embeds?.[0]?.footer?.text?.match(/(MR-\d{4})/);
  if (!footerMatch) return;
  const requestId = footerMatch[1];
  if (reaction.emoji.name === '👍') await approveMediaRequest(requestId, reaction.message.channel);
  else if (reaction.emoji.name === '👎') await denyMediaRequest(requestId, reaction.message.channel);
  else if (reaction.emoji.name === '🧒') await approveKidsRequest(requestId, reaction.message.channel);
});

async function approveMediaRequest(requestId, channel) {
  const requests = loadRequests();
  const req = requests.requests.find(r => r.id === requestId);
  if (!req || req.status !== 'searched') return;
  const { baseUrl, apiKey } = loadConfig().jellyseerr;
  const body = { mediaType: req.media_type, mediaId: req.tmdb_id, is4k: false };
  if (req.media_type === 'tv') body.seasons = 'all';
  const resp = await fetch(`${baseUrl}/api/v1/request`, {
    method: 'POST', headers: { 'X-Api-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (resp.ok) {
    req.status = 'requested'; req.jellyseerr_request_id = (await resp.json()).id; saveRequests(requests);
    await channel.send(`**${requestId}** approved! **${req.title}** (${req.year}) sent to ${req.media_type === 'tv' ? 'Sonarr' : 'Radarr'}. Track in #media-status.`);
    const sc = channel.guild.channels.cache.find(c => c.name === 'media-status');
    if (sc) await sc.send(`[SYSTEM] TRACK_DOWNLOAD ${requestId}`);
  } else { await channel.send(`Failed to request **${req.title}**: ${(await resp.json()).message || 'Unknown error'}`); }
}

async function denyMediaRequest(requestId, channel) {
  const requests = loadRequests();
  const req = requests.requests.find(r => r.id === requestId);
  if (!req) return;
  req.status = 'denied'; saveRequests(requests);
  await channel.send(`**${requestId}** denied. **${req.title}** will not be added.`);
}
```

## Download Monitoring

Poll Sonarr/Radarr queues and post updates to `#media-status`.

```javascript
async function checkDownloadQueue() {
  const config = loadConfig();
  const [sonarrResp, radarrResp] = await Promise.all([
    fetch(`${config.sonarr.baseUrl}/api/v3/queue?page=1&pageSize=50`, { headers: { 'X-Api-Key': config.sonarr.apiKey } }),
    fetch(`${config.radarr.baseUrl}/api/v3/queue?page=1&pageSize=50`, { headers: { 'X-Api-Key': config.radarr.apiKey } })
  ]);
  return { tv: (await sonarrResp.json()).records || [], movies: (await radarrResp.json()).records || [] };
}

async function postQueueStatus(statusChannel) {
  const queue = await checkDownloadQueue();
  const all = [...queue.tv.map(i => ({ ...i, type: 'TV' })), ...queue.movies.map(i => ({ ...i, type: 'Movie' }))];
  if (!all.length) { await statusChannel.send('**Download Queue:** Empty.'); return; }
  const lines = all.map(item => {
    const pct = item.size > 0 ? Math.round(((item.size - item.sizeleft) / item.size) * 100) : 0;
    const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
    return `**${item.title}** [${item.type}]\n${bar} ${pct}% | ETA: ${item.timeleft || 'calculating...'}`;
  });
  await statusChannel.send({ embeds: [{ title: `Download Queue (${all.length} active)`, description: lines.join('\n\n'), color: 0x3498DB, timestamp: new Date().toISOString() }] });
}
```

```bash
# Check queues: swap SONARR_URL/RADARR_URL and keys as needed
curl -s "${SONARR_URL}/api/v3/queue?page=1&pageSize=50" -H "X-Api-Key: ${SONARR_KEY}" | jq '.records[] | {title, status, sizeleft, timeleft}'
```

## BD/ISO Ripping and Transcoding

### Listen in #disc-rip

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'disc-rip') return;
  if (message.author.bot || !isAuthorizedUser(message.author.id)) return;
  const ripMatch = message.content.match(/^!rip\s+(.+)$/i);
  const listMatch = message.content.match(/^!isos$/i);
  const statusMatch = message.content.match(/^!rip-status(?:\s+(RIP-\d{4}))?$/i);
  if (ripMatch) await startRipJob(ripMatch[1].trim(), message);
  if (listMatch) await listAvailableISOs(message);
  if (statusMatch) await showRipStatus(statusMatch?.[1], message);
});
```

### Start Rip Job and Execute Pipeline

```javascript
async function startRipJob(isoName, message) {
  const config = loadConfig();
  const { host, user, sshKeyPath, isoPath, ripOutputPath } = config.unraid;
  const jobs = loadRipJobs();
  const jobId = generateRipJobId(jobs);
  const fullIsoPath = isoName.startsWith('/') ? isoName : `${isoPath}/${isoName}`;
  const { stdout: exists } = await execAsync(
    `ssh -i ${sshKeyPath} ${user}@${host} "test -f '${fullIsoPath}' && echo 'yes' || echo 'no'"`
  );
  if (exists.trim() !== 'yes') {
    await message.reply(`ISO not found: \`${isoName}\`. Use \`!isos\` to list available files.`);
    return;
  }

  const outputDir = `${ripOutputPath}/${jobId}`;
  const job = {
    id: jobId, timestamp: new Date().toISOString(), author: message.author.username,
    source_type: 'iso', source_path: fullIsoPath, title_name: isoName.replace(/\.iso$/i, ''),
    rip_status: 'ripping', rip_output_path: outputDir, transcode_status: 'pending',
    transcode_preset: 'HQ 1080p30 Surround', progress_pct: 0
  };
  jobs.jobs.push(job); saveRipJobs(jobs);
  await message.reply(`**${jobId}** — Starting rip of \`${isoName}\`... Check with \`!rip-status ${jobId}\``);
  execRipOnUnraid(jobId, fullIsoPath, outputDir, message.channel);
}

async function execRipOnUnraid(jobId, isoPath, outputDir, channel) {
  const config = loadConfig();
  const { host, user, sshKeyPath } = config.unraid;
  const ripCmd = `mkdir -p '${outputDir}' && makemkvcon --minlength=120 --decrypt --directio=true mkv iso:'${isoPath}' all '${outputDir}' 2>&1`;
  try {
    const { stdout } = await execAsync(`ssh -i ${sshKeyPath} ${user}@${host} "${ripCmd}"`, { timeout: 3600000 });
    const jobs = loadRipJobs();
    const job = jobs.jobs.find(j => j.id === jobId);
    job.rip_status = 'ripped'; job.progress_pct = 50; saveRipJobs(jobs);
    await channel.send(`**${jobId}** — Rip complete!\n\`\`\`\n${stdout.split('\n').slice(-10).join('\n')}\n\`\`\`\nStarting transcode...`);
    await execTranscodeOnUnraid(jobId, outputDir, channel);
  } catch (err) {
    const jobs = loadRipJobs();
    jobs.jobs.find(j => j.id === jobId).rip_status = 'failed'; saveRipJobs(jobs);
    await channel.send(`**${jobId}** — Rip FAILED:\n\`\`\`\n${err.message}\n\`\`\``);
  }
}

async function execTranscodeOnUnraid(jobId, ripOutputDir, channel) {
  const config = loadConfig();
  const { host, user, sshKeyPath, transcodePath } = config.unraid;
  const outputDir = `${transcodePath}/${jobId}`;
  const jobs = loadRipJobs();
  const job = jobs.jobs.find(j => j.id === jobId);
  job.transcode_status = 'transcoding'; job.transcode_output_path = outputDir; saveRipJobs(jobs);
  await channel.send(`**${jobId}** — Transcoding with preset: **${job.transcode_preset}**...`);
  try {
    const transcodeCmd = `mkdir -p '${outputDir}' && for MKV in '${ripOutputDir}'/*.mkv; do BASENAME=$(basename "$MKV" .mkv); HandBrakeCLI -i "$MKV" -o "'${outputDir}'/${BASENAME}.mkv" -Z "HQ 1080p30 Surround" --encoder x265 --encoder-preset medium --encoder-tune film -q 20 --audio 1,2 --aencoder copy:ac3,av_aac --ab 0,192 --subtitle 1 2>&1; done`;
    await execAsync(`ssh -i ${sshKeyPath} ${user}@${host} "bash -c '${transcodeCmd}'"`, { timeout: 14400000 });
    job.transcode_status = 'transcoded'; job.progress_pct = 90; saveRipJobs(jobs);
    await channel.send(`**${jobId}** — Transcode complete! React 📂 to move to library or 🗑️ to discard.`);
  } catch (err) {
    job.transcode_status = 'failed'; saveRipJobs(jobs);
    await channel.send(`**${jobId}** — Transcode FAILED:\n\`\`\`\n${err.message}\n\`\`\``);
  }
}
```

### Move to Library and Trigger Scan

```javascript
async function moveToLibrary(jobId, mediaType, title, year, channel) {
  const config = loadConfig();
  const { host, user, sshKeyPath, moviesPath, tvPath } = config.unraid;
  const jobs = loadRipJobs();
  const job = jobs.jobs.find(j => j.id === jobId);
  const destBase = mediaType === 'movie' ? moviesPath : tvPath;
  const destDir = `${destBase}/${title} (${year})`;
  job.rip_status = 'moving'; saveRipJobs(jobs);
  await execAsync(`ssh -i ${sshKeyPath} ${user}@${host} "mkdir -p '${destDir}' && mv '${job.transcode_output_path}'/*.mkv '${destDir}/'"`);
  job.final_path = destDir; job.rip_status = 'complete'; job.progress_pct = 100; saveRipJobs(jobs);
  const svc = mediaType === 'movie' ? config.radarr : config.sonarr;
  const cmd = mediaType === 'movie' ? 'RescanMovie' : 'RescanSeries';
  await fetch(`${svc.baseUrl}/api/v3/command`, {
    method: 'POST', headers: { 'X-Api-Key': svc.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: cmd })
  });
  await channel.send(`**${jobId}** — **${title} (${year})** moved to \`${destDir}\`. Library scan triggered.`);
}
```

## Kids Server Integration (10.10.7.5)

A separate Unraid at `10.10.7.5` runs dedicated Radarr, Sonarr, SABnzbd, and Jellyfin for children's content.

| Service | URL |
|---------|-----|
| Radarr (Kids) | `http://10.10.7.5:7878` |
| Sonarr (Kids) | `http://10.10.7.5:8989` |
| SABnzbd (Kids) | `http://10.10.7.5:8080` |
| Jellyfin (Kids) | `http://10.10.7.5:8096` |

Root folders: `/data/media/movies`, `/data/media/tv`. Config keys stored under `kids.*` in `media-services.json`.

### Detecting and Routing Kids Content

Messages containing "kids", "children", "disney", "pixar", "nick", "cartoon", or "animated show/movie" route to kids server. Prefix `kids:` forces kids routing. `!have kids <title>` checks kids library. `!kids-queue` shows kids download queue.

```javascript
function isKidsRequest(text) {
  return /\bkids?\b|\bchildren'?s?\b|\bfor the kids\b|\bdisney\b|\bpixar\b|\bnick\b|\bcartoon\b|\banimated\b.*\b(show|movie|series)\b/i.test(text);
}

async function addToKidsServer(mediaType, tmdbId, title, channel) {
  const config = loadConfig();
  const svc = mediaType === 'tv' ? config.kids.sonarr : config.kids.radarr;
  const endpoint = mediaType === 'tv' ? 'series' : 'movie';
  const lookupUrl = mediaType === 'tv'
    ? `${svc.baseUrl}/api/v3/series/lookup?term=${encodeURIComponent(title)}`
    : `${svc.baseUrl}/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`;
  const result = mediaType === 'tv'
    ? (await (await fetch(lookupUrl, { headers: { 'X-Api-Key': svc.apiKey } })).json())[0]
    : await (await fetch(lookupUrl, { headers: { 'X-Api-Key': svc.apiKey } })).json();
  if (!result) { await channel.send(`Could not find **${title}** on kids server.`); return; }
  const addResp = await fetch(`${svc.baseUrl}/api/v3/${endpoint}`, {
    method: 'POST', headers: { 'X-Api-Key': svc.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...result, qualityProfileId: svc.qualityProfileId, rootFolderPath: svc.rootFolderPath, monitored: true,
      ...(mediaType === 'tv' ? { seasonFolder: true, addOptions: { searchForMissingEpisodes: true } }
        : { minimumAvailability: 'released', addOptions: { searchForMovie: true } }) })
  });
  if (addResp.ok) await channel.send(`Added **${result.title}** to kids server (10.10.7.5)!`);
}

// Always check BOTH servers for library lookups
async function checkBothServers(title, mediaType) {
  const [main, kids] = await Promise.all([checkLibrary(title, mediaType), checkKidsLibrary(title, mediaType)]);
  return { main, kids, found: main.in_library || kids.in_library };
}
```

## Commands Reference

### #media-requests Channel

| Input | What Happens |
|-------|-------------|
| `The Bear` | Search TMDB, show results with approval reactions |
| `Inception 2010` | Search with year hint for precision |
| `!have The Bear` | Check library on both servers |
| `!status MR-0001` | Check status of a specific request |
| `!queue` | Show active download queue (main server) |
| `!kids-queue` | Show kids server download queue |
| `kids: Bluey` | Search and route to kids server |
| `!have kids Bluey` | Check kids server library |
| `!pending` | List all pending/unapproved requests |

### #disc-rip Channel

| Command | What Happens |
|---------|-------------|
| `!isos` | List all ISO files on Unraid |
| `!rip MovieTitle.iso` | Start MakeMKV rip + HandBrake transcode pipeline |
| `!rip-status` | Show status of all rip jobs |
| `!rip-status RIP-0001` | Show status of specific rip job |
| `!preset <name>` | Change transcode preset |

### Reaction Controls

| Reaction | Channel | Action |
|----------|---------|--------|
| 👍 | `#media-requests` | Approve — send to Jellyseerr for download |
| 👎 | `#media-requests` | Deny — mark as rejected |
| 📺 | `#media-requests` | Acknowledge — already in library |
| 🧒 | `#media-requests` | Request on kids server |
| 🎬 | `#disc-rip` | Start transcode after rip |
| ⏸️ | `#disc-rip` | Hold — don't auto-transcode |
| 📂 | `#disc-rip` | Move transcoded files to library |
| 🗑️ | `#disc-rip` | Discard transcoded files |

## Utility Functions

```javascript
const HOME = os.homedir();
const REQUESTS_PATH = `${HOME}/.agents/data/media-requests.json`;
const RIP_JOBS_PATH = `${HOME}/.agents/data/disc-rip-jobs.json`;
const CONFIG_PATH = `${HOME}/.agents/config/media-services.json`;
const loadJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const saveJSON = (p, data) => { fs.writeFileSync(p + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(p + '.tmp', p); };
const loadConfig = () => loadJSON(CONFIG_PATH);
const loadRequests = () => loadJSON(REQUESTS_PATH);
const loadRipJobs = () => loadJSON(RIP_JOBS_PATH);
const saveRequests = (d) => saveJSON(REQUESTS_PATH, d);
const saveRipJobs = (d) => saveJSON(RIP_JOBS_PATH, d);
function generateId(prefix, items) {
  if (!items.length) return `${prefix}-0001`;
  return `${prefix}-${String(parseInt(items.at(-1).id.split('-')[1], 10) + 1).padStart(4, '0')}`;
}
const generateRequestId = (r) => generateId('MR', r.requests);
const generateRipJobId = (j) => generateId('RIP', j.jobs);
function isAuthorizedUser(discordId) {
  return loadJSON(`${HOME}/.agents/config/authorized-users.json`).authorized_users.some(u => u.discord_id === discordId);
}
```

```bash
# Count requests by status / list pending / service health
jq '[.requests[].status] | group_by(.) | map({status: .[0], count: length})' ~/.agents/data/media-requests.json
jq '.requests[] | select(.status == "new" or .status == "searched") | {id, title, status}' ~/.agents/data/media-requests.json
for svc in "5055/api/v1/status" "8989/api/v3/system/status" "7878/api/v3/system/status"; do curl -sf "http://10.10.7.55:$svc" > /dev/null && echo "UP: $svc" || echo "DOWN: $svc"; done
```

## Automated ISO-to-Library Pipeline

Zero manual intervention: `_iso_watch/` → HandBrake container (jlesage/handbrake, H.265 MKV 1080p30, `--encoder-tune film`) → `_converted/` → `iso-pipeline.sh` (cron `*/5`) moves to library → Radarr/Sonarr rescan → Discord notifications.

| Component | Location |
|-----------|----------|
| Watch Folder | `/mnt/user/data/media/_iso_watch/` |
| Output Folder | `/mnt/user/data/media/_converted/` |
| Pre/Post Hooks | `/mnt/user/appdata/HandBrake/hooks/` |
| Pipeline Script | `/mnt/user/data/media/_scripts/iso-pipeline.sh` |
| Cron Job | `*/5 * * * *` (persistent via `/boot/config/go`) |

**HandBrake:** Web UI at `http://10.10.7.55:7803`, source stable 30s, min duration 120s, auto-delete ISO. **Drop and forget:** `scp MovieTitle.iso root@10.10.7.55:/mnt/user/data/media/_iso_watch/`

```bash
ssh root@10.10.7.55 "docker logs --tail 50 HandBrake"       # container logs
ssh root@10.10.7.55 "tail -20 /mnt/user/data/media/_scripts/pipeline.log"  # pipeline log
```

## Transcode Presets

| Preset | Use Case |
|--------|----------|
| `HQ 1080p30 Surround` | Default — good quality, reasonable size |
| `Super HQ 1080p30 Surround` | Maximum quality 1080p |
| `Super HQ 2160p60 4K HEVC Surround` | 4K UHD Blu-ray |
| `Fast 1080p30` | Quick encode, slightly lower quality |

Set per-job with `!preset <name>` before starting a rip.

## Edge Cases

- **Ambiguous title** — Show top 5, ask user to add year
- **Jellyseerr down** — Fall back to direct Sonarr/Radarr API; warn about tracking gaps
- **SSH failed** — Retry once after 10s, post error if still failing
- **HandBrake stopped** — `docker ps --filter name=HandBrake` / `docker start HandBrake`
- **ISO no titles > 120s** — Set env `AUTOMATED_CONVERSION_SOURCE_MIN_DURATION=30`
- **Duplicate request** — Check `tmdb_id` in `media-requests.json`, alert with existing status
- **Download stalled** — Flag in `#media-status` after 30 min with no progress
- **Multiple MKVs** — TV season discs produce many files; transcode all, user picks via reactions

## Tips

- Wife types a show name, everything else is automated. Zero friction is the goal.
- Jellyseerr is the single source of truth -- forwards to Sonarr/Radarr automatically.
- Always check library before posting search results.
- Drop ISOs into `_iso_watch/` and walk away. For animated content use `--encoder-tune animation`.
- Atomic writes (`.tmp` then `mv`) prevent corruption. Tdarr for bulk optimization, HandBrake for disc processing.
- Pipeline script + cron survive Unraid reboots via `/boot/config/go`.
