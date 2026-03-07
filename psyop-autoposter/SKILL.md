---
name: psyop-autoposter
description: Run the PsyOpGuard headline analysis autoposter from Discord. Use when triggering daily analysis runs, posting NCI scorecards to Discord and X, running dry-run previews, comparing manipulation scores across news sources, or managing the autoposter schedule. Integrates with the existing PsyOpGuard pipeline and shares the Discord bot configuration with other OpenClaw skills.
metadata: {"clawdbot":{"emoji":"🛡️","requires":{"anyBins":["python3","node"]},"os":["linux","darwin"]}}
---

# PsyOpGuard Autoposter

Operate the PsyOpGuard headline analysis autoposter via Discord commands. Fetches top headlines from NewsAPI, scores them through the NCI (Narrative Confidence Index) engine, and posts results as rich embeds to Discord and optionally to X/Twitter. Supports on-demand runs, dry-run previews, multi-source comparison mode, and scheduled daily posts.

## When to Use

- Triggering a daily NCI analysis run from Discord with `!psyop scan`
- Previewing what the autoposter would post without actually posting with `!psyop dry-run`
- Running a multi-source comparison across news outlets with `!psyop compare`
- Posting NCI scorecards as Discord embeds with color-coded risk levels
- Cross-posting analysis results from Discord to X/Twitter
- Checking autoposter status, last run time, or recent post history
- Managing the cron schedule for automated daily runs

## Prerequisites

### PsyOpGuard Repository

The autoposter lives inside the PsyOpGuard monorepo. The agent must have access to the repo root.

```bash
# Verify the repo is cloned
ls ~/Code/psy-op-guard/autoposter/daily_post.py

# Install autoposter dependencies
pip install -r ~/Code/psy-op-guard/autoposter/requirements.txt
```

### Environment Variables

The autoposter requires these environment variables. Set them in your shell or in a `.env` file at the repo root.

```bash
# Required: NewsAPI key for headline fetching
export NEWS_API_KEY="your-newsapi-key"

# Required for X/Twitter posting (optional for Discord-only mode)
export X_API_KEY="your-x-api-key"
export X_API_SECRET="your-x-api-secret"
export X_ACCESS_TOKEN="your-x-access-token"
export X_ACCESS_SECRET="your-x-access-secret"

# Required: Discord bot token (shared with other OpenClaw skills)
export DISCORD_BOT_TOKEN="your-bot-token"
```

### Bot Configuration

This skill shares the Discord bot with all other OpenClaw pipeline skills. See `~/.agents/config/discord-bot.json` for token configuration.

The bot requires these permissions in the `#psyop-feed` channel:
- `READ_MESSAGES`
- `SEND_MESSAGES`
- `EMBED_LINKS` (for rich scorecard embeds)
- `ADD_REACTIONS` (for confirmation workflows)

### Authorized Users

Only authorized users can trigger analysis runs. The skill reads from the shared authorized-users file.

```json
// ~/.agents/config/authorized-users.json
{
  "authorized_users": [
    { "discord_id": "123456789012345678", "name": "alice" }
  ]
}
```

### Channel Setup

Create a `#psyop-feed` channel in your Discord server for autoposter output. Optionally create `#psyop-logs` for verbose run logs.

## Discord Commands

| Command | Description |
|---------|-------------|
| `!psyop scan` | Fetch headlines, analyze, post scorecard to Discord |
| `!psyop dry-run` | Analyze and preview without posting anywhere |
| `!psyop compare` | Multi-source comparison across 6 news outlets |
| `!psyop x` | Analyze and cross-post to both Discord and X |
| `!psyop status` | Show last run time, headline count, post history |
| `!psyop history [n]` | Show last N scorecards (default: 5) |

## Command Handler

### Step 1: Listen for Commands

```javascript
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');
const REPO_ROOT = path.join(process.env.HOME, 'Code', 'psy-op-guard');
const HISTORY_PATH = path.join(process.env.HOME, '.agents', 'data', 'psyop-history.json');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'psyop-feed') return;
  if (message.author.bot) return;
  if (!message.content.startsWith('!psyop')) return;
  if (!isAuthorized(message.author.id)) {
    await message.reply('Not authorized. Check authorized-users.json.');
    return;
  }
  await handleCommand(message);
});
```

### Step 2: Parse and Route Commands

```javascript
async function handleCommand(message) {
  const args = message.content.split(/\s+/).slice(1);
  const subcommand = args[0] || 'scan';

  switch (subcommand) {
    case 'scan':
      await runAnalysis(message, { dryRun: false, postToX: false });
      break;
    case 'dry-run':
      await runAnalysis(message, { dryRun: true, postToX: false });
      break;
    case 'compare':
      await runComparison(message, { dryRun: false, postToX: false });
      break;
    case 'x':
      await runAnalysis(message, { dryRun: false, postToX: true });
      break;
    case 'status':
      await showStatus(message);
      break;
    case 'history':
      await showHistory(message, parseInt(args[1]) || 5);
      break;
    default:
      await message.reply(
        'Unknown command. Use: `scan`, `dry-run`, `compare`, `x`, `status`, `history [n]`'
      );
  }
}
```

## Running the Autoposter

### Step 3: Execute the Python Pipeline

The core analysis runs via the existing Python autoposter module. Invoke it as a subprocess to capture structured output.

```javascript
async function runAnalysis(message, { dryRun, postToX }) {
  await message.react('⏳');

  const cmdArgs = ['python3', '-m', 'autoposter.daily_post'];
  if (dryRun || !postToX) cmdArgs.push('--dry-run');

  try {
    const output = execSync(cmdArgs.join(' '), {
      cwd: REPO_ROOT,
      timeout: 60000,
      encoding: 'utf-8',
      env: { ...process.env }
    });

    const result = parseAutoposterOutput(output);
    const embed = buildScorecardEmbed(result);

    await message.channel.send({ embeds: [embed] });

    if (postToX && !dryRun) {
      // Re-run without --dry-run to actually post to X
      execSync('python3 -m autoposter.daily_post', {
        cwd: REPO_ROOT,
        timeout: 60000,
        env: { ...process.env }
      });
      await message.react('🐦');
    }

    saveToHistory(result);
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('✅');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('❌');
    await message.reply(`Analysis failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
  }
}
```

### Step 4: Parse Output

The Python autoposter prints structured output. Parse it to extract the headline, score, and breakdown.

```javascript
function parseAutoposterOutput(output) {
  const lines = output.split('\n');
  const selectedMatch = lines.find(l => l.startsWith('Selected:'));
  const flagged = lines
    .filter(l => l.includes('[flagged]'))
    .map(l => {
      const match = l.match(/\[flagged\]\s+([\d.]+)%\s+(.+)/);
      return match ? { score: parseFloat(match[1]), title: match[2].trim() } : null;
    })
    .filter(Boolean);

  // Extract the formatted tweet between the ─── separators
  const sepIdx = lines.reduce((acc, l, i) => {
    if (l.includes('────')) acc.push(i);
    return acc;
  }, []);

  const tweetText = sepIdx.length >= 2
    ? lines.slice(sepIdx[0] + 1, sepIdx[1]).join('\n').trim()
    : '';

  // Extract char count
  const charMatch = lines.find(l => l.includes('/ 280 chars'));
  const charCount = charMatch ? parseInt(charMatch.match(/\((\d+)/)?.[1] || '0') : 0;

  return {
    timestamp: new Date().toISOString(),
    flaggedHeadlines: flagged,
    selectedHeadline: selectedMatch || null,
    tweetText,
    charCount,
    totalAnalyzed: lines.filter(l => l.includes('[flagged]') || l.includes('[low]')).length,
    isDryRun: output.includes('Dry run complete')
  };
}
```

## Discord Embeds

### Step 5: Build the Scorecard Embed

```javascript
function buildScorecardEmbed(result) {
  const riskColor = getRiskColor(result);

  const embed = new EmbedBuilder()
    .setTitle('🛡️ PsyOpGuard Daily Scan')
    .setColor(riskColor)
    .setTimestamp()
    .setFooter({ text: 'PsyOpGuard NCI Engine' });

  if (result.flaggedHeadlines.length > 0) {
    const top = result.flaggedHeadlines[0];
    embed.setDescription(
      `**Headlines Analyzed:** ${result.totalAnalyzed}\n` +
      `**Flagged:** ${result.flaggedHeadlines.length}\n\n` +
      `**Top Flag:**\n> ${top.title}\n\n` +
      `**NCI Score:** ${top.score}%`
    );

    const flagList = result.flaggedHeadlines
      .slice(0, 5)
      .map((h, i) => `${i + 1}. ${riskEmoji(h.score)} **${h.score}%** — ${h.title}`)
      .join('\n');

    embed.addFields({ name: 'Flagged Headlines', value: flagList });
  } else {
    embed.setDescription(
      `**Headlines Analyzed:** ${result.totalAnalyzed}\n` +
      `**Flagged:** 0\n\n` +
      `No headlines crossed the manipulation threshold today.`
    );
  }

  if (result.tweetText) {
    embed.addFields({
      name: result.isDryRun ? 'Preview (not posted)' : 'Posted Content',
      value: `\`\`\`\n${result.tweetText.slice(0, 1000)}\n\`\`\``
    });
  }

  return embed;
}

function getRiskColor(result) {
  if (result.flaggedHeadlines.length === 0) return 0x2ecc71; // green
  const topScore = result.flaggedHeadlines[0]?.score || 0;
  if (topScore > 70) return 0xe74c3c; // red
  if (topScore > 40) return 0xf1c40f; // yellow
  return 0x2ecc71; // green
}

function riskEmoji(score) {
  if (score > 70) return '🔴';
  if (score > 40) return '🟡';
  return '🟢';
}
```

## Multi-Source Comparison

### Step 6: Run Comparison Mode

```javascript
async function runComparison(message, { dryRun, postToX }) {
  await message.react('⏳');

  try {
    const output = execSync(
      'python3 -m autoposter.daily_post --compare --dry-run',
      { cwd: REPO_ROOT, timeout: 120000, encoding: 'utf-8', env: { ...process.env } }
    );

    const embed = new EmbedBuilder()
      .setTitle('🛡️ PsyOpGuard Source Comparison')
      .setColor(0x3498db)
      .setTimestamp()
      .setFooter({ text: 'PsyOpGuard NCI Engine' });

    // Parse per-source lines: "  Reuters:      avg=XX.X%  (N headlines)"
    const sourceLines = output.split('\n').filter(l => l.match(/^\s+\w.*avg=/));
    const sources = sourceLines.map(l => {
      const match = l.match(/^\s+(.+?)\s+avg=([\d.]+)%\s+\((\d+)/);
      return match ? { name: match[1].trim(), avg: parseFloat(match[2]), count: parseInt(match[3]) } : null;
    }).filter(Boolean);

    if (sources.length > 0) {
      const sorted = sources.sort((a, b) => b.avg - a.avg);
      const list = sorted
        .map(s => `${riskEmoji(s.avg)} **${s.name}** — ${s.avg}% avg (${s.count} headlines)`)
        .join('\n');
      embed.setDescription(list);
    }

    // Extract the comparison tweet
    const sepIdx = output.split('\n').reduce((acc, l, i) => {
      if (l.includes('────')) acc.push(i);
      return acc;
    }, []);
    const lines = output.split('\n');
    if (sepIdx.length >= 2) {
      const tweet = lines.slice(sepIdx[0] + 1, sepIdx[1]).join('\n').trim();
      embed.addFields({ name: 'Comparison Tweet', value: `\`\`\`\n${tweet.slice(0, 1000)}\n\`\`\`` });
    }

    await message.channel.send({ embeds: [embed] });
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('✅');
  } catch (err) {
    await message.reactions.cache.get('⏳')?.remove();
    await message.react('❌');
    await message.reply(`Comparison failed:\n\`\`\`\n${err.message.slice(0, 500)}\n\`\`\``);
  }
}
```

## History and Status

### Step 7: Track Run History

```javascript
function saveToHistory(result) {
  const historyDir = path.dirname(HISTORY_PATH);
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir, { recursive: true });

  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch {}
  }

  history.unshift({
    timestamp: result.timestamp,
    totalAnalyzed: result.totalAnalyzed,
    flaggedCount: result.flaggedHeadlines.length,
    topScore: result.flaggedHeadlines[0]?.score || 0,
    topHeadline: result.flaggedHeadlines[0]?.title || null,
    isDryRun: result.isDryRun
  });

  // Keep last 90 days
  history = history.slice(0, 90);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));
}

async function showStatus(message) {
  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch {}
  }

  const last = history[0];
  const totalRuns = history.filter(h => !h.isDryRun).length;
  const avgTop = history.length > 0
    ? (history.reduce((sum, h) => sum + h.topScore, 0) / history.length).toFixed(1)
    : '0.0';

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Autoposter Status')
    .setColor(0x9b59b6)
    .addFields(
      { name: 'Last Run', value: last ? last.timestamp : 'Never', inline: true },
      { name: 'Total Runs', value: String(totalRuns), inline: true },
      { name: 'Avg Top Score', value: `${avgTop}%`, inline: true }
    );

  if (last) {
    embed.addFields(
      { name: 'Last Top Flag', value: last.topHeadline || 'None', inline: false }
    );
  }

  await message.channel.send({ embeds: [embed] });
}

async function showHistory(message, count) {
  let history = [];
  if (fs.existsSync(HISTORY_PATH)) {
    try { history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8')); } catch {}
  }

  const entries = history.slice(0, Math.min(count, 10));
  if (entries.length === 0) {
    await message.reply('No history yet. Run `!psyop scan` first.');
    return;
  }

  const list = entries.map((h, i) => {
    const date = h.timestamp.split('T')[0];
    const tag = h.isDryRun ? ' (dry-run)' : '';
    return `**${i + 1}.** ${date}${tag} — ${riskEmoji(h.topScore)} ${h.topScore}% top score, ${h.flaggedCount} flagged / ${h.totalAnalyzed} analyzed`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🛡️ Recent Scans')
    .setColor(0x9b59b6)
    .setDescription(list);

  await message.channel.send({ embeds: [embed] });
}
```

## Scheduled Daily Runs

Set up a cron job to trigger the autoposter automatically. The cron invokes the Python module directly; Discord notifications are optional.

```bash
# Run daily at 8:00 AM ET (13:00 UTC) — posts to X
0 13 * * * cd ~/Code/psy-op-guard && python3 -m autoposter.daily_post 2>&1 >> ~/logs/psyop-autoposter.log

# Run comparison every Sunday at 10:00 AM ET (15:00 UTC)
0 15 * * 0 cd ~/Code/psy-op-guard && python3 -m autoposter.daily_post --compare 2>&1 >> ~/logs/psyop-autoposter.log
```

To also post to Discord from the cron job, use a webhook:

```bash
# Post to Discord via webhook after the cron run
WEBHOOK_URL="https://discord.com/api/webhooks/YOUR_WEBHOOK_ID/YOUR_WEBHOOK_TOKEN"

# Run analysis, capture output, post to Discord
OUTPUT=$(cd ~/Code/psy-op-guard && python3 -m autoposter.daily_post --dry-run 2>&1)

curl -H "Content-Type: application/json" \
  -d "{\"content\": \"**Daily PsyOpGuard Scan** (auto)\n\`\`\`\n${OUTPUT:0:1900}\n\`\`\`\"}" \
  "$WEBHOOK_URL"
```

## NCI Vector Reference

The PsyOpGuard NCI engine scores headlines across 5 manipulation vectors:

| Vector | Emoji | What It Measures |
|--------|-------|------------------|
| Authority Manipulation | 🏛️ | Appeals to institutional authority, official-sounding language |
| Emotional Fractionation | 💔 | Emotional push-pull to create dependency on the narrative |
| Cognitive Load | 🧠 | Information density that overwhelms critical thinking |
| Narrative Control | 📖 | Framing, question manipulation, perspective steering |
| Limbic Targeting | ⚡ | Urgency and fear triggers that bypass rational processing |

### Score Thresholds

| Range | Risk Level | Color | Action |
|-------|-----------|-------|--------|
| 0-40% | Low | 🟢 Green | Below threshold, not flagged |
| 40-70% | Medium | 🟡 Yellow | Flagged, moderate manipulation signals |
| 70-95% | High | 🔴 Red | Strong manipulation indicators |

The minimum score threshold for flagging is **40%** (configurable in `daily_post.py` as `MIN_SCORE_THRESHOLD`).

## Troubleshooting

### "No articles fetched from NewsAPI"

```bash
# Test your NewsAPI key directly
curl -s "https://newsapi.org/v2/top-headlines?country=us&pageSize=1" \
  -H "X-Api-Key: $NEWS_API_KEY" | python3 -m json.tool

# Common causes: expired free-tier key, rate limit (100 req/day on free plan)
```

### "Tweepy Forbidden (403)"

The X API app needs Elevated access with read+write permissions. Check at developer.x.com under your app settings.

### Bot not responding to commands

```bash
# Verify the bot token is set
echo $DISCORD_BOT_TOKEN | head -c 10

# Check that MessageContent intent is enabled in the Discord Developer Portal
# Bot > Privileged Gateway Intents > Message Content Intent must be ON
```

### Duplicate post detection

The autoposter keeps a dedup ledger at `autoposter/posted_headlines.json`. If a headline was already posted today (UTC), it will be skipped.

```bash
# View today's posted headlines
cat ~/Code/psy-op-guard/autoposter/posted_headlines.json | python3 -m json.tool

# Clear the ledger to re-post
echo '{}' > ~/Code/psy-op-guard/autoposter/posted_headlines.json
```

## Tips

- Always run `!psyop dry-run` first to preview results before posting to X. The 280-char limit can truncate important context.
- The `--compare` mode calls NewsAPI once per source (6 sources). On the free tier (100 req/day), this uses 6 requests per comparison run. Budget accordingly.
- Discord embeds have a 4096-character description limit. The skill truncates long output automatically, but check embed rendering in `#psyop-feed` after changes.
- The NCI engine runs entirely on heuristics (keyword matching + structural analysis). It does not call external ML models, so analysis is fast and free.
- Cross-posting to X uses tweepy's OAuth 1.0a flow. If you rotate API keys, update all four `X_*` environment variables at once.
- The history file at `~/.agents/data/psyop-history.json` is capped at 90 entries. For long-term analytics, export it periodically.
- Schedule the cron job outside of 1:00-3:00 AM local time to avoid daylight saving transitions causing double or missed runs.
- The dedup guard is per-headline, per-day. The same headline can be posted on different days if it resurfaces.
- Use the webhook approach for cron-triggered Discord posts rather than running the full bot, since the bot may not be online during cron execution.
- The `#psyop-logs` channel is optional but recommended for debugging. Pipe verbose subprocess stderr there to keep `#psyop-feed` clean.
