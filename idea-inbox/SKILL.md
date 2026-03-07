---
name: idea-inbox
description: Capture raw unstructured ideas from Discord's #idea-inbox channel into a local JSON backlog with zero friction. Use when receiving new project ideas from authorized users, logging brainstorm output with timestamps and unique IDs, checking for duplicate submissions, or bootstrapping the idea-to-skill pipeline. Communicates downstream with idea-scorer via idea-backlog.json.
metadata: {"clawdbot":{"emoji":"📥","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Idea Inbox

Listen on the Discord `#idea-inbox` channel for raw, unstructured idea messages from authorized users. Tag each with a `raw` status, assign a unique ID, store it in `~/.agents/data/idea-backlog.json`, and confirm receipt in the channel. This is the zero-friction entry point for the entire skill pipeline.

## When to Use

- A user posts a new idea in `#idea-inbox` that needs to be captured
- Ingesting brainstorm output or rough feature requests into the backlog
- Building a timestamped, searchable idea backlog from Discord messages
- Bootstrapping the idea-to-skill pipeline with raw input
- Checking whether an idea was already captured by searching the backlog
- Re-scanning recent `#idea-inbox` messages after a bot restart

## Prerequisites

### Bot Configuration

All skills in this pipeline share a single configurable Discord bot. Configure it once.

```bash
# Set the bot token as an environment variable
export DISCORD_BOT_TOKEN="your-bot-token-here"

# Or store it in the shared config file
mkdir -p ~/.agents/config
echo '{"token":"your-bot-token-here"}' > ~/.agents/config/discord-bot.json
```

The bot requires the following Gateway Intents:
- `Guilds`
- `GuildMessages`
- `MessageContent`
- `GuildMessageReactions` (used by downstream skills)

### Authorized Users

Only process messages from users on the authorized list. All pipeline skills read from this file.

```json
// ~/.agents/config/authorized-users.json
{
  "authorized_users": [
    { "discord_id": "123456789012345678", "name": "alice" },
    { "discord_id": "987654321098765432", "name": "bob" }
  ]
}
```

### Data Directory

Ensure the data directory and backlog file exist.

```bash
mkdir -p ~/.agents/data

# Initialize the backlog file if it doesn't exist
if [ ! -f ~/.agents/data/idea-backlog.json ]; then
  echo '{"ideas": []}' > ~/.agents/data/idea-backlog.json
fi
```

### Channel Setup

Create the `#idea-inbox` channel in your Discord server. The bot must have:
- `READ_MESSAGES` permission in `#idea-inbox`
- `SEND_MESSAGES` permission in `#idea-inbox`

## Backlog Schema

Each idea in `~/.agents/data/idea-backlog.json` follows this schema:

```json
{
  "ideas": [
    {
      "id": "IDEA-0001",
      "timestamp": "2026-02-27T14:30:00.000Z",
      "author": "alice",
      "author_discord_id": "123456789012345678",
      "raw_text": "A skill that watches a GitHub repo and auto-generates changelogs from PR titles",
      "status": "raw",
      "channel_message_id": "1234567890123456789",
      "scores": null,
      "refined_prompt": null
    }
  ]
}
```

### Status Values

| Status | Meaning | Set By |
|--------|---------|--------|
| `raw` | Captured, not yet scored | idea-inbox |
| `scored` | Scored by idea-scorer | idea-scorer |
| `refining` | In prompt-refiner refinement loop | idea-scorer |
| `ready` | Refined and confirmed, waiting for skill-factory | discord-prompt-refiner |
| `built` | SKILL.md generated and installed | discord-skill-factory |

## Step-by-Step Message Handling

### Step 1: Listen for Messages

Monitor `#idea-inbox` for new messages. Ignore bot messages and messages from unauthorized users.

```javascript
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs');
const path = require('path');

const BACKLOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');
const AUTH_PATH = path.join(process.env.HOME, '.agents', 'config', 'authorized-users.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'idea-inbox') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) {
    await message.reply('You are not on the authorized users list.');
    return;
  }
  await processIdea(message);
});
```

### Step 2: Validate the Message

Reject empty or trivially short messages.

```javascript
function validateIdea(text) {
  const trimmed = text.trim();
  if (trimmed.length < 10) {
    return { valid: false, reason: 'Idea too short. Please provide at least a sentence.' };
  }
  if (trimmed.length > 2000) {
    return { valid: false, reason: 'Idea exceeds 2000 characters. Please condense it.' };
  }
  return { valid: true, reason: null };
}
```

### Step 3: Generate a Unique ID

IDs follow the format `IDEA-XXXX`, incrementing from the last entry in the backlog.

```javascript
function generateIdeaId(backlog) {
  if (backlog.ideas.length === 0) return 'IDEA-0001';
  const lastId = backlog.ideas[backlog.ideas.length - 1].id;
  const num = parseInt(lastId.split('-')[1], 10) + 1;
  return `IDEA-${String(num).padStart(4, '0')}`;
}
```

### Step 4: Check for Duplicates

Before storing, check if a very similar idea already exists.

```javascript
function isDuplicate(backlog, newText) {
  const normalized = newText.toLowerCase().trim();
  return backlog.ideas.some(idea => {
    const existing = idea.raw_text.toLowerCase().trim();
    if (existing === normalized) return true;
    const newWords = new Set(normalized.split(/\s+/));
    const existingWords = new Set(existing.split(/\s+/));
    const intersection = [...newWords].filter(w => existingWords.has(w));
    const union = new Set([...newWords, ...existingWords]);
    return intersection.length / union.size > 0.85;
  });
}

function findSimilarIdea(backlog, text) {
  const normalized = text.toLowerCase().trim();
  return backlog.ideas.find(idea => {
    const existing = idea.raw_text.toLowerCase().trim();
    const newWords = new Set(normalized.split(/\s+/));
    const existingWords = new Set(existing.split(/\s+/));
    const intersection = [...newWords].filter(w => existingWords.has(w));
    const union = new Set([...newWords, ...existingWords]);
    return intersection.length / union.size > 0.85;
  });
}
```

### Step 5: Store in Backlog

Read the backlog, append the new idea, and write it back atomically.

```bash
# Read current backlog, append new idea, write back
jq --arg id "$IDEA_ID" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
   --arg author "$AUTHOR_NAME" \
   --arg author_id "$AUTHOR_DISCORD_ID" \
   --arg raw "$RAW_TEXT" \
   --arg msg_id "$MESSAGE_ID" \
   '.ideas += [{
     id: $id,
     timestamp: $ts,
     author: $author,
     author_discord_id: $author_id,
     raw_text: $raw,
     status: "raw",
     channel_message_id: $msg_id,
     scores: null,
     refined_prompt: null
   }]' ~/.agents/data/idea-backlog.json > /tmp/idea-backlog-tmp.json \
   && mv /tmp/idea-backlog-tmp.json ~/.agents/data/idea-backlog.json
```

### Step 6: Confirm Receipt in Channel

Reply in `#idea-inbox` with the assigned ID so the user has a reference.

```javascript
await message.reply(
  `**Captured!**\n` +
  `**ID:** \`${ideaId}\`\n` +
  `**Status:** raw\n` +
  `**Next:** Heading to idea-scorer for evaluation.`
);
```

If a duplicate is detected, reply with the existing idea's ID instead:

```javascript
if (isDuplicate(backlog, rawText)) {
  const existing = findSimilarIdea(backlog, rawText);
  await message.reply(
    `This looks similar to **${existing.id}** (status: ${existing.status}).\n` +
    `Reply with "force" to capture it anyway.`
  );
  return;
}
```

## Authorization Check

```javascript
function isAuthorizedUser(discordId) {
  const config = loadJSON(AUTH_PATH) || { authorized_users: [] };
  return config.authorized_users.some(u => u.discord_id === discordId);
}

function getAuthorName(discordId) {
  const config = loadJSON(AUTH_PATH) || { authorized_users: [] };
  const user = config.authorized_users.find(u => u.discord_id === discordId);
  return user ? user.name : 'unknown';
}
```

## Full Message Handler

```javascript
async function processIdea(message) {
  try {
    const validation = validateIdea(message.content);
    if (!validation.valid) {
      await message.reply(validation.reason);
      return;
    }

    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));

    if (isDuplicate(backlog, message.content)) {
      const existing = findSimilarIdea(backlog, message.content);
      await message.reply(
        `This looks similar to **${existing.id}** (status: ${existing.status}).\n` +
        `Reply with "force" to capture it anyway.`
      );
      return;
    }

    const ideaId = generateIdeaId(backlog);
    backlog.ideas.push({
      id: ideaId,
      timestamp: new Date().toISOString(),
      author: getAuthorName(message.author.id),
      author_discord_id: message.author.id,
      raw_text: message.content,
      status: 'raw',
      channel_message_id: message.id,
      scores: null,
      refined_prompt: null
    });

    fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));

    await message.reply(
      `**Captured!** ID: \`${ideaId}\` — heading to idea-scorer.`
    );
  } catch (err) {
    console.error(`[idea-inbox] Failed to process message ${message.id}:`, err);
    await message.reply('Something went wrong capturing your idea. Please try again.');
  }
}
```

## Backlog Queries

Quick commands for inspecting the backlog from the shell:

```bash
# Count all ideas
jq '.ideas | length' ~/.agents/data/idea-backlog.json

# List all raw ideas
jq '.ideas[] | select(.status == "raw") | {id, author, raw_text}' ~/.agents/data/idea-backlog.json

# Find idea by ID
jq '.ideas[] | select(.id == "IDEA-0012")' ~/.agents/data/idea-backlog.json

# Count ideas by status
jq '[.ideas[].status] | group_by(.) | map({status: .[0], count: length})' ~/.agents/data/idea-backlog.json
```

## Downstream Communication

After storing, the idea-scorer skill watches `idea-backlog.json` for new entries with `status: "raw"`. Optionally, post a machine-readable trigger to the channel:

```javascript
const channel = client.channels.cache.find(c => c.name === 'idea-inbox');
await channel.send(`[SYSTEM] NEW_IDEA ${ideaId}`);
```

## Tips

- Keep `#idea-inbox` low-ceremony. Users should be able to paste a half-baked thought without formatting requirements.
- The `IDEA-XXXX` format is padded to 4 digits. If you expect more than 9999 ideas, bump the padding in `generateIdeaId`.
- Always write the backlog atomically (write to tmp, then `mv`) to avoid corruption from concurrent writes.
- Store the Discord `channel_message_id` so you can link back to the original message later.
- Duplicate detection uses a simple Jaccard threshold of 0.85. Tune this lower for stricter dedup, higher if it rejects valid variations.
- The authorized-users file is read on every message. For high-volume servers, cache it in memory and reload on a timer.
- If the bot restarts, it won't replay old messages. Consider a startup scan of recent `#idea-inbox` messages to catch anything missed during downtime.
- All timestamps are UTC ISO 8601. Do not use local time — it makes cross-timezone collaboration confusing.
- The `force` command for duplicate overrides is intentionally low-friction. Users know their intent better than a string-matching heuristic.
