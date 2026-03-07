---
name: weekly-skill-digest
description: Post a weekly digest of skill pipeline activity to Discord's #skill-digest channel every Sunday via cron. Use when reviewing skills built during the week, identifying stale skills not triggered in 30+ days as pruning candidates, tracking unbuilt ideas stuck in the backlog with raw or ready status, generating formatted Discord embed summaries, or manually triggering an ad-hoc digest. Reads from idea-backlog.json and skill-triggers.json.
metadata: {"clawdbot":{"emoji":"📰","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Weekly Skill Digest

Run on a cron schedule every Sunday. Post a digest to `#skill-digest` including: skills built that week, skills not triggered in 30+ days (pruning candidates), and ideas still sitting in `idea-backlog.json` with status `raw` or `ready` but not yet built. Format as a clean Discord embed.

## When to Use

- Every Sunday on a cron schedule (automated)
- Manually triggering a digest for the current week via the `digest` command
- Reviewing which skills were built recently and which are stale
- Identifying backlog ideas that have stalled in the pipeline
- Auditing the skill registry for pruning candidates
- Tracking pipeline health metrics (conversion rate, average build time)

## Prerequisites

### Shared Bot

Same Discord bot as the rest of the pipeline.

```bash
echo $DISCORD_BOT_TOKEN
```

### Channel Setup

The bot needs `SEND_MESSAGES` in `#skill-digest`.

### Cron Configuration

```bash
# Add to crontab: run every Sunday at 9:00 AM UTC
crontab -e
```

```cron
0 9 * * 0 /usr/local/bin/node ~/.agents/scripts/weekly-digest.js >> ~/.agents/logs/digest.log 2>&1
```

```bash
# Create the logs directory
mkdir -p ~/.agents/logs

# Verify the cron entry
crontab -l | grep weekly-digest
```

### Required Data Files

```bash
# Idea backlog (maintained by idea-inbox)
jq '.ideas | length' ~/.agents/data/idea-backlog.json

# Skill trigger log (for staleness detection)
if [ ! -f ~/.agents/data/skill-triggers.json ]; then
  echo '{"triggers": []}' > ~/.agents/data/skill-triggers.json
fi
```

### Trigger Log Schema

Track when each skill is activated to detect stale skills.

```json
{
  "triggers": [
    {
      "skill": "idea-inbox",
      "timestamp": "2026-02-27T14:30:00.000Z",
      "source": "discord-message"
    }
  ]
}
```

## Digest Sections

### Section 1: Skills Built This Week

Query the backlog for ideas with `status: "built"` and `built_at` within the last 7 days.

```javascript
const fs = require('fs');
const path = require('path');

const BACKLOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');
const TRIGGERS_PATH = path.join(process.env.HOME, '.agents', 'data', 'skill-triggers.json');
const SKILLS_DIR = path.join(process.env.HOME, '.agents', 'skills');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function getSkillsBuiltThisWeek(backlog) {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  return backlog.ideas.filter(idea =>
    idea.status === 'built' &&
    idea.built_at &&
    new Date(idea.built_at) >= oneWeekAgo
  );
}
```

```bash
# Shell query: ideas built in the last 7 days
jq --arg since "$(date -u -v-7d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%S.000Z)" \
  '[.ideas[] | select(.status == "built" and .built_at > $since)] | length' \
  ~/.agents/data/idea-backlog.json
```

### Section 2: Stale Skills (Not Triggered in 30+ Days)

Scan the trigger log for skills that haven't been activated recently.

```javascript
function getStaleSkills(triggerLog, allSkills) {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const lastTrigger = {};

  for (const trigger of triggerLog.triggers) {
    const ts = new Date(trigger.timestamp);
    if (!lastTrigger[trigger.skill] || ts > lastTrigger[trigger.skill]) {
      lastTrigger[trigger.skill] = ts;
    }
  }

  const stale = [];
  for (const skill of allSkills) {
    const lastUsed = lastTrigger[skill];
    if (!lastUsed) {
      stale.push({ skill, lastUsed: 'never', daysSince: Infinity });
    } else if (lastUsed < thirtyDaysAgo) {
      const daysSince = Math.floor((Date.now() - lastUsed.getTime()) / 86400000);
      stale.push({ skill, lastUsed: lastUsed.toISOString(), daysSince });
    }
  }

  return stale.sort((a, b) => b.daysSince - a.daysSince);
}
```

```bash
# Find skills with no triggers in 30+ days
jq --arg since "$(date -u -v-30d +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S.000Z)" \
  '[.triggers | group_by(.skill) | .[] |
    {skill: .[0].skill, last: (sort_by(.timestamp) | last | .timestamp)} |
    select(.last < $since)]' \
  ~/.agents/data/skill-triggers.json
```

### Section 3: Stalled Ideas in Backlog

Find ideas stuck in `raw` or `ready` status that haven't progressed.

```javascript
function getStalledIdeas(backlog) {
  return backlog.ideas.filter(idea =>
    idea.status === 'raw' || idea.status === 'ready'
  ).map(idea => ({
    id: idea.id,
    status: idea.status,
    author: idea.author,
    age: Math.floor(
      (Date.now() - new Date(idea.timestamp).getTime()) / 86400000
    ),
    preview: idea.raw_text.substring(0, 80)
  }));
}
```

```bash
# List stalled ideas with age in days
jq '[.ideas[] | select(.status == "raw" or .status == "ready") |
  {id, status, author, raw_text: .raw_text[:80],
   age_days: ((now - (.timestamp | fromdateiso8601)) / 86400 | floor)}]' \
  ~/.agents/data/idea-backlog.json
```

## Generating the Discord Embed

### Full Digest Assembly

```javascript
async function generateDigest(client) {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  const triggerLog = loadJSON(TRIGGERS_PATH) || { triggers: [] };

  const allSkills = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  const builtThisWeek = getSkillsBuiltThisWeek(backlog);
  const staleSkills = getStaleSkills(triggerLog, allSkills);
  const stalledIdeas = getStalledIdeas(backlog);

  const builtSection = builtThisWeek.length > 0
    ? builtThisWeek.map(idea =>
        `**${idea.skill_slug}** (${idea.id}) — built ${formatRelative(idea.built_at)}`
      ).join('\n')
    : '_No skills built this week._';

  const staleSection = staleSkills.length > 0
    ? staleSkills.slice(0, 10).map(s =>
        `**${s.skill}** — last used ${s.daysSince === Infinity ? 'never' : `${s.daysSince}d ago`}`
      ).join('\n')
    : '_All skills active within 30 days._';

  const stalledSection = stalledIdeas.length > 0
    ? stalledIdeas.slice(0, 10).map(idea =>
        `**${idea.id}** [${idea.status}] ${idea.age}d old — ${idea.preview}...`
      ).join('\n')
    : '_No stalled ideas in the backlog._';

  return { builtSection, staleSection, stalledSection, stats: {
    totalSkills: allSkills.length,
    builtCount: builtThisWeek.length,
    staleCount: staleSkills.length,
    stalledCount: stalledIdeas.length,
    totalIdeas: backlog.ideas.length
  }};
}
```

### Post the Embed

```javascript
async function postDigest(client) {
  const digestChannel = client.channels.cache.find(
    c => c.name === 'skill-digest'
  );
  if (!digestChannel) {
    console.error('[weekly-digest] #skill-digest channel not found');
    return;
  }

  const { builtSection, staleSection, stalledSection, stats } =
    await generateDigest(client);

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekLabel = `${formatDate(weekStart)} — ${formatDate(new Date())}`;

  const embed = {
    title: 'Weekly Skill Digest',
    description: `**${weekLabel}**\nRegistry: **${stats.totalSkills}** skills | Backlog: **${stats.totalIdeas}** ideas`,
    fields: [
      {
        name: `Built This Week (${stats.builtCount})`,
        value: builtSection,
        inline: false
      },
      {
        name: `Pruning Candidates (${stats.staleCount})`,
        value: staleSection,
        inline: false
      },
      {
        name: `Stalled Ideas (${stats.stalledCount})`,
        value: stalledSection,
        inline: false
      }
    ],
    color: 0x5865F2,  // Discord blurple
    footer: {
      text: 'Weekly Skill Digest | Runs every Sunday at 9:00 AM UTC'
    },
    timestamp: new Date().toISOString()
  };

  // Add pipeline stats to footer
  const pipelineStats = getPipelineStats(
    loadJSON(BACKLOG_PATH) || { ideas: [] }
  );
  embed.footer.text +=
    ` | Conversion: ${pipelineStats.conversionRate}%` +
    ` | Avg build: ${pipelineStats.avgTimeToBuilt}d`;

  await digestChannel.send({ embeds: [embed] });
  console.log('[weekly-digest] Digest posted successfully');
}
```

## Formatting Helpers

```javascript
function formatDate(date) {
  return date.toISOString().split('T')[0]; // 2026-02-27
}

function formatRelative(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
```

## Pipeline Health Metrics

```javascript
function getPipelineStats(backlog) {
  const statusCounts = {};
  for (const idea of backlog.ideas) {
    statusCounts[idea.status] = (statusCounts[idea.status] || 0) + 1;
  }

  const builtIdeas = backlog.ideas.filter(i => i.status === 'built' && i.built_at);
  const avgTimeToBuilt = builtIdeas.length > 0
    ? builtIdeas
        .map(i => new Date(i.built_at) - new Date(i.timestamp))
        .reduce((sum, ms) => sum + ms, 0) / builtIdeas.length
    : 0;

  return {
    statusCounts,
    avgTimeToBuilt: Math.round(avgTimeToBuilt / 86400000),
    conversionRate: backlog.ideas.length > 0
      ? Math.round((statusCounts.built || 0) / backlog.ideas.length * 100)
      : 0
  };
}
```

## Manual Trigger

Allow authorized users to trigger the digest on demand via Discord.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'skill-digest') return;
  if (!isAuthorizedUser(message.author.id)) return;

  if (message.content.toLowerCase().trim() === 'digest') {
    await message.reply('Generating digest...');
    await postDigest(client);
  }
});
```

Or from the command line:

```bash
# Run the digest script directly
node ~/.agents/scripts/weekly-digest.js

# Or with a specific date range
node ~/.agents/scripts/weekly-digest.js --since 2026-02-20 --until 2026-02-27
```

## Standalone Script

The digest can run as a standalone Node.js script invoked by cron.

```javascript
#!/usr/bin/env node
// ~/.agents/scripts/weekly-digest.js

const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once('ready', async () => {
  console.log(`[weekly-digest] Bot ready as ${client.user.tag}`);
  try {
    await postDigest(client);
  } catch (err) {
    console.error('[weekly-digest] Failed to post digest:', err);
  } finally {
    client.destroy();
    process.exit(0);
  }
});

const config = loadJSON(
  path.join(process.env.HOME, '.agents', 'config', 'discord-bot.json')
);
if (!config || !config.token) {
  console.error('[weekly-digest] Missing or invalid discord-bot.json');
  process.exit(1);
}

client.login(config.token);
```

## Trigger Logging Integration

For staleness detection to work, other skills must log their triggers.

```javascript
// Add this to any skill that should be tracked
function logTrigger(skillName, source = 'unknown') {
  const logPath = path.join(process.env.HOME, '.agents', 'data', 'skill-triggers.json');
  const log = loadJSON(logPath) || { triggers: [] };

  log.triggers.push({
    skill: skillName,
    timestamp: new Date().toISOString(),
    source: source
  });

  // Keep only last 90 days of triggers to prevent unbounded growth
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  log.triggers = log.triggers.filter(
    t => new Date(t.timestamp) >= ninetyDaysAgo
  );

  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
}
```

```bash
# Manually log a trigger
jq --arg skill "$SKILL_NAME" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
   '.triggers += [{skill: $skill, timestamp: $ts, source: "manual"}]' \
   ~/.agents/data/skill-triggers.json > /tmp/triggers-tmp.json \
   && mv /tmp/triggers-tmp.json ~/.agents/data/skill-triggers.json
```

## Troubleshooting

### Cron Job Not Firing

```bash
# Check cron service is running (macOS)
launchctl list | grep cron

# Check cron logs (macOS)
log show --predicate 'process == "cron"' --last 1h

# Test the script manually
node ~/.agents/scripts/weekly-digest.js
```

### Empty Digest Sections

```bash
# Verify backlog has data
jq '.ideas | length' ~/.agents/data/idea-backlog.json

# Verify trigger log has data
jq '.triggers | length' ~/.agents/data/skill-triggers.json

# Check for date parsing issues
jq '.ideas[] | select(.built_at != null) | .built_at' ~/.agents/data/idea-backlog.json
```

### Bot Can't Find #skill-digest Channel

```bash
# List channels visible to the bot
node -e "
const { Client, GatewayIntentBits } = require('discord.js');
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('ready', () => {
  const ch = c.channels.cache.find(c => c.name === 'skill-digest');
  console.log(ch ? 'Found: ' + ch.id : 'NOT FOUND');
  c.destroy();
});
c.login(process.env.DISCORD_BOT_TOKEN);
"
```

## Tips

- Run the cron at 9:00 AM UTC Sunday. Avoid 1:00-3:00 AM if DST applies in your timezone — cron jobs can fire twice or not at all during DST transitions.
- The trigger log grows indefinitely if not pruned. The `logTrigger` function above keeps only 90 days of data. Adjust this window based on your volume.
- Cap each digest section to 10 entries. Discord embed field values have a 1024-character limit — exceeding it silently truncates the message.
- The conversion rate (ideas built / total ideas) is the single most useful pipeline health metric. Track it over time to see if refinement is getting faster.
- Manual `digest` command in `#skill-digest` is useful for ad-hoc reviews before the weekly cron fires.
- Use the standalone script pattern (login, post, destroy, exit) for cron jobs. Long-running bot processes waste resources when they only need to act once a week.
- Color-code the embed using Discord blurple (`0x5865F2`) for the digest. Reserve green/amber/red for actionable status indicators in other skills.
- If the trigger log file is missing or corrupt, the digest should still post with the staleness section showing "trigger data unavailable" rather than crashing.
- The `logTrigger` function should be called by every pipeline skill. Without trigger data, the staleness section is blind.
