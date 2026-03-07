---
name: print-request-inbox
description: Capture 3D print requests from Discord's #print-requests channel with zero-friction URL and text intake. Use when receiving MakerWorld, Thingiverse, or Printables links from authorized users, logging print ideas with automatic metadata extraction, building a timestamped print queue, or routing requests into the evaluation pipeline. Communicates downstream with print-evaluator.
metadata: {"clawdbot":{"emoji":"📥","requires":{"anyBins":["jq","curl"]},"os":["linux","darwin","win32"]}}
---

# Print Request Inbox

Listen on the Discord `#print-requests` channel for 3D print requests from authorized users. Accept MakerWorld URLs, Thingiverse URLs, Printables URLs, or plain text descriptions. Extract model metadata from links, assign a unique `PR-XXXX` ID, store the request in `~/.agents/data/print-queue.json`, and confirm receipt in the channel. This is the zero-friction entry point for the 3D print pipeline.

## When to Use

- A user posts a MakerWorld, Thingiverse, or Printables link in `#print-requests`
- Someone describes a print they want in plain text ("I need a phone stand")
- Ingesting batch print requests after browsing a model site
- Building a searchable backlog of all print requests with timestamps
- Checking whether a model was already requested by searching the queue

## Prerequisites

### Bot Configuration

All skills in this pipeline share the OpenClaw Discord bot. No separate bot needed — OpenClaw routes messages from `#print-requests` to this skill via bindings in `openclaw.json`.

### Model Configuration

This skill uses the local Ollama Qwen3 8B model for any LLM-assisted processing (metadata extraction fallback, intent detection). Configured in `openclaw.json`:

```json
{
  "models": {
    "providers": {
      "ollama": {
        "baseUrl": "http://127.0.0.1:11434/v1",
        "apiKey": "ollama-local",
        "api": "ollama",
        "models": [{ "id": "qwen3:8b", "name": "Qwen3 8B" }]
      }
    }
  }
}
```

Responses may have a slight lag compared to cloud models — this is expected and acceptable for a print queue workflow.

### Authorized Users

Only process messages from users on the authorized list.

```json
// ~/.agents/config/authorized-users.json
{
  "authorized_users": [
    { "discord_id": "1439787060763426926", "name": "disruptionengineer" }
  ]
}
```

### Data Directory

Ensure the data directory and queue file exist.

```bash
mkdir -p ~/.agents/data

# Initialize the queue file if it doesn't exist
if [ ! -f ~/.agents/data/print-queue.json ]; then
  echo '{"requests": []}' > ~/.agents/data/print-queue.json
fi
```

### Channel Setup

Create the `#print-requests` channel in your Discord server under a "3D Printing" category. The OpenClaw bot must have `READ_MESSAGES` and `SEND_MESSAGES` permission in `#print-requests`.

## Queue Schema

Each request in `~/.agents/data/print-queue.json` follows this schema:

```json
{
  "requests": [
    {
      "id": "PR-0001",
      "timestamp": "2026-02-27T18:00:00.000Z",
      "author": "disruptionengineer",
      "author_discord_id": "1439787060763426926",
      "raw_text": "https://makerworld.com/en/models/123456",
      "url": "https://makerworld.com/en/models/123456",
      "model_name": "Articulated Dragon",
      "thumbnail_url": "https://cdn.makerworld.com/...",
      "source": "makerworld",
      "status": "new",
      "priority": null,
      "scores": null,
      "notes": [],
      "filament": null,
      "started_at": null,
      "completed_at": null,
      "failed_at": null,
      "failure_reason": null,
      "channel_message_id": "1234567890123456789"
    }
  ]
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `new` | Captured, not yet evaluated |
| `evaluated` | Scored by print-evaluator |
| `queued` | Approved and waiting to print |
| `printing` | Currently on the printer |
| `completed` | Successfully printed |
| `failed` | Print failed (reason logged) |
| `rejected` | Not going to print this |

## Step-by-Step Message Handling

### Step 1: Listen for Messages

Monitor `#print-requests` for new messages. Ignore bot messages and messages from unauthorized users.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'print-requests') return;
  if (message.author.bot) return;
  if (!isAuthorizedUser(message.author.id)) {
    await message.reply('⛔ You are not on the authorized users list.');
    return;
  }
  // Ignore system messages from other skills
  if (message.content.startsWith('[SYSTEM]')) return;
  await processRequest(message);
});
```

### Step 2: Detect and Parse URLs

Scan the message for supported model hosting URLs.

```javascript
const URL_PATTERNS = {
  makerworld: /https?:\/\/(?:www\.)?makerworld\.com\/\S+/i,
  thingiverse: /https?:\/\/(?:www\.)?thingiverse\.com\/\S+/i,
  printables: /https?:\/\/(?:www\.)?printables\.com\/\S+/i,
};

function detectSource(text) {
  for (const [source, pattern] of Object.entries(URL_PATTERNS)) {
    const match = text.match(pattern);
    if (match) return { source, url: match[0] };
  }
  return { source: 'text', url: null };
}
```

### Step 3: Extract Metadata from URL

Fetch the page and extract OpenGraph meta tags for model name and thumbnail.

```bash
# Extract OpenGraph metadata from a URL
URL="https://makerworld.com/en/models/123456"
HTML=$(curl -sL -A "Mozilla/5.0" "$URL")

# Parse og:title
MODEL_NAME=$(echo "$HTML" | grep -oP 'property="og:title"\s+content="\K[^"]+')

# Parse og:image
THUMBNAIL=$(echo "$HTML" | grep -oP 'property="og:image"\s+content="\K[^"]+')

# Parse og:description
DESCRIPTION=$(echo "$HTML" | grep -oP 'property="og:description"\s+content="\K[^"]+' | head -c 300)
```

```javascript
async function extractMetadata(url) {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
    const html = await resp.text();
    const ogTitle = html.match(/property="og:title"\s+content="([^"]+)"/)?.[1];
    const ogImage = html.match(/property="og:image"\s+content="([^"]+)"/)?.[1];
    return { model_name: ogTitle || null, thumbnail_url: ogImage || null };
  } catch {
    return { model_name: null, thumbnail_url: null };
  }
}
```

### Step 4: Handle Bare URLs Without Context

If the message is just a URL with no description, ask for context.

```javascript
function isBareUrl(text) {
  const trimmed = text.trim();
  return /^https?:\/\/\S+$/.test(trimmed);
}

// If bare URL, ask what it's for
if (isBareUrl(message.content)) {
  await message.reply(
    '🔗 Got the link! What is this for? (gift, functional part, decoration, just cool?)\n' +
    "I'll capture it either way — reply to add context."
  );
}
```

### Step 5: Generate a Unique ID

IDs follow the format `PR-XXXX`, incrementing from the last entry in the queue.

```javascript
function generateRequestId(queue) {
  if (queue.requests.length === 0) return 'PR-0001';
  const lastId = queue.requests[queue.requests.length - 1].id;
  const num = parseInt(lastId.split('-')[1], 10) + 1;
  return `PR-${String(num).padStart(4, '0')}`;
}
```

```bash
# Generate next ID
LAST_NUM=$(jq -r '.requests[-1].id // "PR-0000"' ~/.agents/data/print-queue.json | grep -oP '\d+')
NEXT_NUM=$(printf "%04d" $((10#$LAST_NUM + 1)))
REQUEST_ID="PR-$NEXT_NUM"
```

### Step 6: Store in Queue

Read the queue, append the new request, and write it back atomically.

```bash
jq --arg id "$REQUEST_ID" \
   --arg ts "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
   --arg author "$AUTHOR_NAME" \
   --arg author_id "$AUTHOR_DISCORD_ID" \
   --arg raw "$RAW_TEXT" \
   --arg url "$URL" \
   --arg model "$MODEL_NAME" \
   --arg thumb "$THUMBNAIL_URL" \
   --arg source "$SOURCE" \
   --arg msg_id "$MESSAGE_ID" \
   '.requests += [{
     id: $id, timestamp: $ts, author: $author, author_discord_id: $author_id,
     raw_text: $raw, url: $url, model_name: $model, thumbnail_url: $thumb,
     source: $source, status: "new", priority: null, scores: null,
     notes: [], filament: null, started_at: null, completed_at: null,
     failed_at: null, failure_reason: null, channel_message_id: $msg_id
   }]' ~/.agents/data/print-queue.json > /tmp/print-queue-tmp.json \
   && mv /tmp/print-queue-tmp.json ~/.agents/data/print-queue.json
```

### Step 7: Confirm Receipt in Channel

Reply in `#print-requests` with the assigned ID and model info.

```javascript
await message.reply(
  `📥 **Print Request Captured!**\n` +
  `**ID:** \`${requestId}\`\n` +
  `**Model:** ${modelName || 'Text description'}\n` +
  `**Source:** ${source}\n` +
  `**Status:** new\n` +
  `**Next:** Heading to print-evaluator for scoring.`
);

// Post system trigger for downstream evaluation
await channel.send(`[SYSTEM] EVALUATE_REQUEST ${requestId}`);
```

## Duplicate Detection

Before storing, check if the same URL was already requested.

```javascript
function isDuplicate(queue, url) {
  if (!url) return false;
  return queue.requests.some(r => r.url === url && r.status !== 'rejected');
}

if (isDuplicate(queue, url)) {
  const existing = queue.requests.find(r => r.url === url);
  await message.reply(
    `⚠️ This model was already requested as **${existing.id}** (status: ${existing.status}).\n` +
    `Reply "force" to submit it anyway.`
  );
  return;
}
```

## Queue Queries

Quick commands for inspecting the queue from the shell:

```bash
# Count all requests
jq '.requests | length' ~/.agents/data/print-queue.json

# List all new requests
jq '.requests[] | select(.status == "new") | {id, model_name, source}' ~/.agents/data/print-queue.json

# Find request by ID
jq '.requests[] | select(.id == "PR-0003")' ~/.agents/data/print-queue.json

# Count requests by status
jq '[.requests[].status] | group_by(.) | map({status: .[0], count: length})' ~/.agents/data/print-queue.json

# List all MakerWorld requests
jq '.requests[] | select(.source == "makerworld") | {id, model_name, status}' ~/.agents/data/print-queue.json
```

## Downstream Communication

After storing, post a system message so the print-evaluator skill picks it up:

```javascript
await channel.send(`[SYSTEM] EVALUATE_REQUEST ${requestId}`);
```

The print-evaluator watches for `[SYSTEM] EVALUATE_REQUEST` messages in `#print-requests` and scores the request immediately.

## Tips

- Keep `#print-requests` low-ceremony. Users should be able to paste a bare MakerWorld link without any formatting.
- The `PR-XXXX` format is padded to 4 digits. If you somehow exceed 9999 prints, bump the padding.
- Always write the queue atomically (write to tmp, then `mv`) to avoid corruption from concurrent writes.
- Store the Discord `channel_message_id` so you can link back to the original message later.
- Metadata extraction gracefully degrades — if a site blocks scraping, the request still gets captured with the raw URL.
- MakerWorld and Printables have reliable OpenGraph tags. Thingiverse is less consistent — model name may need a fallback to the `<title>` tag.
- All timestamps are UTC ISO 8601. Do not use local time.
- The authorized-users file is read on every message. For high-volume use, cache it and reload on a timer.
- Processing uses the local Ollama Qwen3 8B model — expect 2-5 second response lag vs cloud, which is perfectly fine for a print queue.
- If the bot restarts, it won't replay old messages. Consider a startup scan of recent `#print-requests` messages to catch anything missed during downtime.
