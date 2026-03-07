---
name: youtube-curator
description: Monitor subscribed YouTube channels and deliver personalized video recommendations via Discord. Use when fetching new uploads from subscribed channels, categorizing videos by topic (gaming, tech, AI, auto), scoring relevance against watch preferences, presenting curated daily digests, collecting feedback via reactions, or replacing YouTube's algorithm with transparent user-owned curation.
metadata: {"clawdbot":{"emoji":"📺","requires":{"anyBins":["node","curl"]},"os":["linux","darwin"]}}
---

# YouTube Channel Curator

Fetch new uploads from your subscribed YouTube channels, categorize each video by user-defined topics, score relevance using a transparent weighted formula, and deliver curated recommendations to Discord as rich embeds. Unlike YouTube's opaque algorithm, every recommendation shows its reasoning and score. Feedback via reactions trains future scoring.

## When to Use

- Checking for new uploads across subscribed YouTube channels without opening YouTube
- Getting a daily or on-demand digest of relevant new videos filtered by category
- Categorizing videos by topic (gaming, tech, AI, automotive, music, education)
- Scoring and ranking videos by personal relevance instead of YouTube's algorithm
- Collecting watch/skip feedback to refine future recommendations
- Tracking watch history to avoid re-recommendations
- Configuring per-category weights and channel affinity scores
- Auditing which channels produce content you actually watch vs skip

## Prerequisites

### API Setup

```bash
# Option A: YouTube Data API v3 (higher quality, quota limited)
# 1. Create project at console.cloud.google.com
# 2. Enable YouTube Data API v3
# 3. Create API key (or OAuth2 for subscription access)

# Option B: RSS feeds (no API key, no quota, slightly delayed)
# YouTube channel RSS format:
# https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID

# Verify curl is available for RSS fallback
curl --version | head -1
```

### Data Directory

```bash
mkdir -p ~/.agents/data

# Initialize config
if [ ! -f ~/.agents/data/youtube-curator-config.json ]; then
  cat > ~/.agents/data/youtube-curator-config.json << 'EOF'
{
  "apiKey": "",
  "useRSS": true,
  "digestTime": "09:00",
  "timezone": "America/Chicago",
  "maxRecommendations": 10,
  "categories": {
    "gaming": {
      "keywords": ["gameplay", "walkthrough", "lets play", "gaming", "speedrun", "esports", "playthrough"],
      "weight": 1.0
    },
    "tech": {
      "keywords": ["review", "unboxing", "tech", "gadget", "hardware", "software", "benchmark"],
      "weight": 1.2
    },
    "ai": {
      "keywords": ["ai", "artificial intelligence", "machine learning", "llm", "neural", "gpt", "claude", "deep learning"],
      "weight": 1.5
    },
    "auto": {
      "keywords": ["car", "automotive", "racing", "engine", "mod", "build", "restoration", "detailing"],
      "weight": 0.8
    }
  },
  "scoring": {
    "categoryMatchWeight": 0.40,
    "channelAffinityWeight": 0.35,
    "keywordDensityWeight": 0.20,
    "recencyWeight": 0.05
  }
}
EOF
fi

# Initialize channel list
if [ ! -f ~/.agents/data/youtube-curator-channels.json ]; then
  echo '{"channels": []}' > ~/.agents/data/youtube-curator-channels.json
fi

# Initialize watch history
if [ ! -f ~/.agents/data/youtube-curator-history.json ]; then
  echo '{"watched": [], "skipped": [], "interested": []}' > ~/.agents/data/youtube-curator-history.json
fi

# Initialize sync state
if [ ! -f ~/.agents/data/youtube-curator-state.json ]; then
  echo '{"lastSync": null, "cachedVideos": []}' > ~/.agents/data/youtube-curator-state.json
fi
```

## Channel Management

### Add a Channel

```javascript
// Discord command: /curator add-channel <url-or-id> [category]
async function addChannel(interaction) {
  const input = interaction.options.getString('url');
  const category = interaction.options.getString('category') || 'uncategorized';

  // Extract channel ID from URL or use directly
  const channelId = extractChannelId(input);
  if (!channelId) {
    return interaction.reply('❌ Could not parse channel ID from input. Use a channel URL or raw ID.');
  }

  const channels = loadJSON(CHANNELS_PATH);

  // Check for duplicates
  if (channels.channels.find(c => c.channelId === channelId)) {
    return interaction.reply('⚠️ Channel already tracked.');
  }

  // Fetch channel metadata
  const meta = await fetchChannelMeta(channelId);

  channels.channels.push({
    channelId,
    name: meta.name || 'Unknown',
    addedAt: new Date().toISOString(),
    category,
    affinityScore: 0.5, // starts neutral
    totalVideos: 0,
    watchedCount: 0,
    skippedCount: 0
  });

  saveJSON(CHANNELS_PATH, channels);
  await interaction.reply(`✅ Added **${meta.name}** to ${category} category.`);
}

function extractChannelId(input) {
  // Handle various URL formats
  const patterns = [
    /youtube\.com\/channel\/(UC[\w-]+)/,
    /youtube\.com\/@([\w-]+)/,
    /youtube\.com\/c\/([\w-]+)/,
    /^(UC[\w-]{22})$/
  ];
  for (const p of patterns) {
    const m = input.match(p);
    if (m) return m[1];
  }
  return null;
}
```

### List Channels

```bash
# View all tracked channels with affinity scores
jq '.channels | sort_by(-.affinityScore) | .[] | "\(.affinityScore | tostring | .[0:4]) | \(.name) [\(.category)] (\(.watchedCount)w/\(.skippedCount)s)"' \
  ~/.agents/data/youtube-curator-channels.json
```

## Video Fetching

### RSS Feed Fetcher

```javascript
const { parseStringPromise } = require('xml2js');

async function fetchNewVideos(channels) {
  const allVideos = [];
  const state = loadJSON(STATE_PATH);
  const lastSync = state.lastSync ? new Date(state.lastSync) : new Date(Date.now() - 86400000);

  for (const channel of channels) {
    try {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
      const response = await fetch(rssUrl);
      const xml = await response.text();
      const parsed = await parseStringPromise(xml);

      const entries = parsed.feed?.entry || [];
      for (const entry of entries) {
        const published = new Date(entry.published[0]);
        if (published <= lastSync) continue;

        allVideos.push({
          videoId: entry['yt:videoId'][0],
          title: entry.title[0],
          channelId: channel.channelId,
          channelName: channel.name,
          channelCategory: channel.category,
          published: published.toISOString(),
          description: entry['media:group']?.[0]?.['media:description']?.[0] || '',
          thumbnail: `https://img.youtube.com/vi/${entry['yt:videoId'][0]}/mqdefault.jpg`,
          url: entry.link[0].$.href
        });
      }
    } catch (err) {
      console.error(`RSS fetch failed for ${channel.name}: ${err.message}`);
    }
  }

  // Update sync timestamp
  state.lastSync = new Date().toISOString();
  state.cachedVideos = allVideos;
  saveJSON(STATE_PATH, state);

  return allVideos;
}
```

### YouTube Data API Fetcher (Alternative)

```javascript
// Uses YouTube Data API v3 — costs ~3 units per channel per call
async function fetchViaAPI(channels, apiKey) {
  const allVideos = [];

  for (const channel of channels) {
    const url = `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet&channelId=${channel.channelId}&type=video` +
      `&order=date&maxResults=5&publishedAfter=${getLastSyncISO()}` +
      `&key=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.error) {
      console.error(`API error for ${channel.name}: ${data.error.message}`);
      continue;
    }

    for (const item of (data.items || [])) {
      allVideos.push({
        videoId: item.id.videoId,
        title: item.snippet.title,
        channelId: channel.channelId,
        channelName: channel.name,
        channelCategory: channel.category,
        published: item.snippet.publishedAt,
        description: item.snippet.description,
        thumbnail: item.snippet.thumbnails?.medium?.url || '',
        url: `https://youtube.com/watch?v=${item.id.videoId}`
      });
    }
  }

  return allVideos;
}
```

## Relevance Scoring

### Score Calculator

```javascript
function scoreVideo(video, config, channels, history) {
  const weights = config.scoring;
  const channel = channels.find(c => c.channelId === video.channelId);

  // 1. Category match (40%)
  let categoryScore = 0;
  let matchedCategory = 'uncategorized';
  const titleLower = video.title.toLowerCase();
  const descLower = (video.description || '').toLowerCase();

  for (const [cat, catConfig] of Object.entries(config.categories)) {
    const hits = catConfig.keywords.filter(
      kw => titleLower.includes(kw) || descLower.includes(kw)
    ).length;
    const catScore = Math.min(hits / 3, 1.0) * (catConfig.weight || 1.0);
    if (catScore > categoryScore) {
      categoryScore = catScore;
      matchedCategory = cat;
    }
  }

  // 2. Channel affinity (35%)
  const affinityScore = channel ? channel.affinityScore : 0.5;

  // 3. Keyword density (20%)
  const allKeywords = Object.values(config.categories).flatMap(c => c.keywords);
  const uniqueHits = new Set(allKeywords.filter(kw => titleLower.includes(kw)));
  const keywordScore = Math.min(uniqueHits.size / 5, 1.0);

  // 4. Recency (5%)
  const hoursAgo = (Date.now() - new Date(video.published)) / 3600000;
  const recencyScore = Math.max(0, 1 - hoursAgo / 168); // decays over 7 days

  // Weighted total
  const total = (
    categoryScore * weights.categoryMatchWeight +
    affinityScore * weights.channelAffinityWeight +
    keywordScore * weights.keywordDensityWeight +
    recencyScore * weights.recencyWeight
  );

  return {
    total: Math.round(total * 100) / 100,
    category: matchedCategory,
    breakdown: {
      categoryMatch: Math.round(categoryScore * 100),
      channelAffinity: Math.round(affinityScore * 100),
      keywordDensity: Math.round(keywordScore * 100),
      recency: Math.round(recencyScore * 100)
    }
  };
}
```

### Rank and Filter

```javascript
function rankVideos(videos, config, channels, history) {
  // Filter out already-watched
  const watchedIds = new Set(history.watched.map(w => w.videoId));
  const fresh = videos.filter(v => !watchedIds.has(v.videoId));

  // Score each video
  const scored = fresh.map(video => ({
    ...video,
    score: scoreVideo(video, config, channels, history)
  }));

  // Sort by score descending
  scored.sort((a, b) => b.score.total - a.score.total);

  // Split into "watch now" vs "maybe later"
  const threshold = 0.5;
  const watchNow = scored.filter(v => v.score.total >= threshold);
  const maybeLater = scored.filter(v => v.score.total < threshold && v.score.total >= 0.2);

  return {
    watchNow: watchNow.slice(0, config.maxRecommendations),
    maybeLater: maybeLater.slice(0, 5)
  };
}
```

## Discord Output

### Curate Command

```javascript
// Discord command: /curate [category]
async function curate(interaction) {
  await interaction.deferReply();

  const config = loadJSON(CONFIG_PATH);
  const channels = loadJSON(CHANNELS_PATH).channels;
  const history = loadJSON(HISTORY_PATH);

  // Fetch new videos
  const videos = config.useRSS
    ? await fetchNewVideos(channels)
    : await fetchViaAPI(channels, config.apiKey);

  if (videos.length === 0) {
    return interaction.editReply('📭 No new videos since last check.');
  }

  // Rank
  const { watchNow, maybeLater } = rankVideos(videos, config, channels, history);

  // Build embeds
  const embeds = watchNow.map((v, i) => ({
    title: `${i + 1}. ${v.title}`,
    url: v.url,
    color: scoreColor(v.score.total),
    thumbnail: { url: v.thumbnail },
    fields: [
      { name: 'Channel', value: v.channelName, inline: true },
      { name: 'Category', value: v.score.category, inline: true },
      { name: 'Score', value: `${(v.score.total * 100).toFixed(0)}%`, inline: true },
      {
        name: 'Why',
        value: `Cat: ${v.score.breakdown.categoryMatch}% | Affinity: ${v.score.breakdown.channelAffinity}% | Keywords: ${v.score.breakdown.keywordDensity}%`,
        inline: false
      }
    ],
    footer: { text: `Published ${timeAgo(v.published)}` }
  }));

  const msg = await interaction.editReply({
    content: `🎬 **${watchNow.length} videos to watch** (${videos.length} new total)`,
    embeds: embeds.slice(0, 10) // Discord limit
  });

  // Add reaction buttons for feedback
  await msg.react('✅'); // watched
  await msg.react('👍'); // interested
  await msg.react('🙅'); // skip
}

function scoreColor(score) {
  if (score >= 0.7) return 0x00FF00; // green
  if (score >= 0.5) return 0xFFA500; // orange
  return 0x808080;                     // gray
}

function timeAgo(isoDate) {
  const hours = (Date.now() - new Date(isoDate)) / 3600000;
  if (hours < 1) return `${Math.round(hours * 60)}m ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
```

### Reaction Feedback Handler

```javascript
// Collect feedback from reactions on curate messages
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.message.channel.name !== 'youtube-curator') return;

  const history = loadJSON(HISTORY_PATH);
  const embed = reaction.message.embeds[0];
  if (!embed?.url) return;

  const videoId = extractVideoId(embed.url);
  if (!videoId) return;

  const entry = { videoId, timestamp: new Date().toISOString(), userId: user.id };

  if (reaction.emoji.name === '✅') {
    history.watched.push(entry);
    updateChannelAffinity(videoId, 'watched');
  } else if (reaction.emoji.name === '👍') {
    history.interested.push(entry);
    updateChannelAffinity(videoId, 'interested');
  } else if (reaction.emoji.name === '🙅') {
    history.skipped.push(entry);
    updateChannelAffinity(videoId, 'skipped');
  }

  saveJSON(HISTORY_PATH, history);
});

function updateChannelAffinity(videoId, action) {
  const state = loadJSON(STATE_PATH);
  const video = state.cachedVideos.find(v => v.videoId === videoId);
  if (!video) return;

  const channels = loadJSON(CHANNELS_PATH);
  const channel = channels.channels.find(c => c.channelId === video.channelId);
  if (!channel) return;

  // Adjust affinity: watched +0.05, interested +0.02, skipped -0.03
  const delta = { watched: 0.05, interested: 0.02, skipped: -0.03 }[action] || 0;
  channel.affinityScore = Math.max(0, Math.min(1, channel.affinityScore + delta));
  channel[`${action}Count`] = (channel[`${action}Count`] || 0) + 1;

  saveJSON(CHANNELS_PATH, channels);
}
```

## Analytics

### Watch Pattern Report

```bash
# Top channels by watch rate
jq '
  .channels
  | map(select(.totalVideos > 0))
  | map(. + {watchRate: (.watchedCount / .totalVideos * 100)})
  | sort_by(-.watchRate)
  | .[:10]
  | .[]
  | "\(.watchRate | floor)% — \(.name) (\(.watchedCount)/\(.totalVideos))"
' ~/.agents/data/youtube-curator-channels.json

# Category distribution of watched videos (last 30 days)
python3 << 'PYEOF'
import json
from datetime import datetime, timedelta
from collections import Counter

history = json.load(open('/tmp/yt-history-sample.json'))  # substitute real path
cutoff = (datetime.now() - timedelta(days=30)).isoformat()
recent = [w for w in history['watched'] if w['timestamp'] > cutoff]
print(f"Watched {len(recent)} videos in last 30 days")
PYEOF
```

## Troubleshooting

### RSS Feed Returns Empty

```bash
# Test RSS feed directly
curl -s "https://www.youtube.com/feeds/videos.xml?channel_id=UC_CHANNEL_ID" | head -20

# Common issues:
# 1. Channel ID starts with UC (not @handle) — convert via API or page source
# 2. Channel has no recent uploads
# 3. Rate limited — add 1s delay between fetches
```

### API Quota Exceeded

```bash
# Check current quota usage at console.cloud.google.com
# Default: 10,000 units/day
# Search costs ~100 units per call
# With 50 channels: 50 * 100 = 5,000 units per full sync

# Mitigation: switch to RSS mode
jq '.useRSS = true' ~/.agents/data/youtube-curator-config.json > /tmp/ytc.json \
  && mv /tmp/ytc.json ~/.agents/data/youtube-curator-config.json
```

### Scoring Feels Wrong

```bash
# Debug a specific video's score
jq --arg vid "VIDEO_ID" '
  .cachedVideos[] | select(.videoId == $vid)
' ~/.agents/data/youtube-curator-state.json

# Reset a channel's affinity to neutral
jq --arg ch "CHANNEL_ID" '
  .channels |= map(if .channelId == $ch then .affinityScore = 0.5 else . end)
' ~/.agents/data/youtube-curator-channels.json > /tmp/ytc.json \
  && mv /tmp/ytc.json ~/.agents/data/youtube-curator-channels.json
```

## Tips

- Use RSS feeds instead of the API for daily use — zero quota cost, updates within 15 minutes of upload, and no OAuth needed.
- Start with high AI/tech weights and low everything else, then let reaction feedback rebalance over a few weeks.
- Channel affinity is the most powerful signal. A high-affinity channel with a low-scoring title still beats a low-affinity channel with a clickbait title.
- Run `/curate` manually for the first week instead of scheduling a daily digest. This gives you time to train the scoring before it runs unsupervised.
- The skip reaction (🙅) is more valuable than watch (✅) for tuning. Knowing what you don't want is stronger signal.
- Cap the daily digest at 10 videos. More than that creates decision fatigue and you'll skip the digest entirely.
- YouTube occasionally changes RSS feed format or adds delays. If feeds go stale, check the raw XML before debugging your code.
- Store the API key in the config file, not environment variables. The curator runs on a schedule, not always in your shell.
- Category keywords should be lowercase and match partial strings. "ai" matches "AI revolution" because of `.toLowerCase()`.
- Review channel affinity scores monthly — channels change content focus over time, and a formerly great tech channel might pivot to drama content.
