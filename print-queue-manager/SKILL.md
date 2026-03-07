---
name: print-queue-manager
description: Manage the 3D print queue lifecycle via Discord commands in #print-queue for starting, completing, failing, requeuing, and reordering prints. Use when checking what's next to print, starting a print job with filament and time tracking, marking prints complete or failed, requeuing failed prints for another attempt, reordering the queue by priority, or viewing the active queue. Communicates upstream with print-evaluator and downstream with print-status-tracker and filament-tracker.
metadata: {"clawdbot":{"emoji":"🖨️","requires":{"anyBins":["jq"]},"os":["linux","darwin","win32"]}}
---

# Print Queue Manager

The command center for active 3D prints. Listen on `#print-queue` for lifecycle commands and `[SYSTEM] QUEUE_REQUEST` messages from the evaluator. Manage the full print lifecycle: queued → printing → completed/failed. Post status updates, track filament usage, and dispatch events downstream to print-status-tracker and filament-tracker.

## When to Use

- A `[SYSTEM] QUEUE_REQUEST` message arrives from print-evaluator
- User types `!queue` to see what's up next
- Starting a print with `!start PR-0001 FIL-001 4h`
- Marking a print done with `!done PR-0001`
- Logging a failed print with `!fail PR-0001 bed adhesion failure`
- Requeuing a failed print with `!requeue PR-0001`
- Reordering the queue with `!priority PR-0001 5`

## Prerequisites

### Channel Setup

Commands are issued in `#print-queue`. The bot needs `READ_MESSAGES` and `SEND_MESSAGES` in this channel.

### Data Files

- `~/.agents/data/print-queue.json` — the shared request/queue file
- `~/.agents/data/print-history.json` — completed and failed prints (append-only)

```bash
# Initialize history file
if [ ! -f ~/.agents/data/print-history.json ]; then
  echo '{"history": []}' > ~/.agents/data/print-history.json
fi
```

## Utility Functions

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}
function saveJSON(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filePath);
}

const QUEUE_PATH = path.join(os.homedir(), '.agents/data/print-queue.json');
function loadQueue() { return loadJSON(QUEUE_PATH) || { requests: [] }; }
function saveQueue(data) { saveJSON(QUEUE_PATH, data); }

const HISTORY_PATH = path.join(os.homedir(), '.agents/data/print-history.json');
function loadHistory() { return loadJSON(HISTORY_PATH) || { history: [] }; }
function appendHistory(entry) {
  const data = loadHistory();
  data.history.push(entry);
  saveJSON(HISTORY_PATH, data);
}
```

## Commands

### `!queue` — Show Current Queue

Display all active requests sorted by priority (highest first), grouped by status.

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'print-queue') return;
  if (!isAuthorizedUser(message.author.id)) return;

  if (message.content.trim() === '!queue') {
    const queue = loadQueue();
    const active = queue.requests.filter(
      r => ['queued', 'printing'].includes(r.status)
    );
    active.sort((a, b) => (b.priority || 3) - (a.priority || 3));

    const printing = active.filter(r => r.status === 'printing');
    const queued = active.filter(r => r.status === 'queued');

    let output = '**🖨️ Print Queue**\n\n';

    if (printing.length) {
      output += '**Currently Printing:**\n';
      for (const r of printing) {
        output += `🟢 \`${r.id}\` — ${r.model_name || r.raw_text} (started ${r.started_at?.slice(0, 16)})\n`;
      }
      output += '\n';
    }

    if (queued.length) {
      output += '**Up Next:**\n';
      for (const [i, r] of queued.entries()) {
        output += `🟡 #${i + 1} \`${r.id}\` — ${r.model_name || r.raw_text} (P${r.priority || 3})\n`;
      }
    }

    if (!active.length) output += 'Queue is empty! Submit requests in #print-requests.';

    await message.channel.send(output);
  }
});
```

### `!next` — Show Next Print

Show the highest-priority queued print with full details.

```javascript
if (message.content.trim() === '!next') {
  const queue = loadQueue();
  const queued = queue.requests
    .filter(r => r.status === 'queued')
    .sort((a, b) => (b.priority || 3) - (a.priority || 3));

  if (!queued.length) {
    await message.channel.send('✅ No prints queued — you\'re all caught up!');
    return;
  }

  const next = queued[0];
  await message.channel.send(
    `**⏭️ Next Up — ${next.id}**\n` +
    `**Model:** ${next.model_name || next.raw_text}\n` +
    `**Priority:** ${next.priority || 3}/5\n` +
    `**Source:** ${next.source}\n` +
    (next.url ? `**Link:** ${next.url}\n` : '') +
    (next.scores?.time_estimate ? `**Est. Time:** ${next.scores.time_estimate}\n` : '') +
    `\nStart it: \`!start ${next.id}\``
  );
}
```

### `!start PR-XXXX [filament] [time]` — Start a Print

```javascript
const startMatch = message.content.match(/^!start\s+(PR-\d{4})(?:\s+(\S+))?(?:\s+(\S+))?/i);
if (startMatch) {
  const [, requestId, filament, estTime] = startMatch;
  const queue = loadQueue();
  const request = queue.requests.find(r => r.id === requestId.toUpperCase());

  if (!request) { await message.reply(`\`${requestId}\` not found.`); return; }
  if (request.status === 'printing') { await message.reply(`\`${requestId}\` is already printing!`); return; }

  const now = new Date().toISOString();
  request.status = 'printing';
  request.started_at = now;
  if (filament) request.filament = filament;

  saveQueue(queue);

  await message.channel.send(
    `🟢 **Print Started — ${requestId}**\n` +
    `**Model:** ${request.model_name || request.raw_text}\n` +
    `**Started:** ${now.slice(0, 16)}\n` +
    (filament ? `**Filament:** ${filament}\n` : '') +
    (estTime ? `**Est. Time:** ${estTime}\n` : '')
  );

  // Notify #print-status
  const statusChannel = client.channels.cache.find(c => c.name === 'print-status');
  if (statusChannel) {
    await statusChannel.send(
      `[SYSTEM] PRINT_STARTED ${requestId}`
    );
  }
}
```

### `!done PR-XXXX [notes]` — Mark Complete

```javascript
const doneMatch = message.content.match(/^!done\s+(PR-\d{4})(?:\s+(.+))?/i);
if (doneMatch) {
  const [, requestId, notes] = doneMatch;
  const queue = loadQueue();
  const request = queue.requests.find(r => r.id === requestId.toUpperCase());

  if (!request) { await message.reply(`\`${requestId}\` not found.`); return; }

  const now = new Date().toISOString();
  request.status = 'completed';
  request.completed_at = now;
  if (notes) request.notes.push(notes);

  // Calculate duration
  let duration = null;
  if (request.started_at) {
    const hours = (new Date(now) - new Date(request.started_at)) / 3600000;
    duration = `${hours.toFixed(1)}h`;
  }

  saveQueue(queue);

  // Append to history
  appendHistory({
    id: request.id, model_name: request.model_name, url: request.url,
    source: request.source, author: request.author, filament: request.filament,
    started_at: request.started_at, completed_at: now,
    status: 'completed', duration, notes: request.notes
  });

  await message.channel.send(`✅ **${requestId}** — *${request.model_name || 'print'}* complete!` +
    (duration ? ` (${duration})` : ''));

  // Notify downstream
  const statusChannel = client.channels.cache.find(c => c.name === 'print-status');
  if (statusChannel) await statusChannel.send(`[SYSTEM] PRINT_COMPLETE ${requestId}`);

  const filamentChannel = client.channels.cache.find(c => c.name === 'filament');
  if (filamentChannel && request.filament) {
    await filamentChannel.send(
      `📎 **${requestId}** completed using **${request.filament}**. ` +
      `Don't forget to log usage: \`!use ${request.filament} <grams>\``
    );
  }
}
```

### `!fail PR-XXXX [reason]` — Mark Failed

```javascript
const failMatch = message.content.match(/^!fail\s+(PR-\d{4})(?:\s+(.+))?/i);
if (failMatch) {
  const [, requestId, reason] = failMatch;
  const queue = loadQueue();
  const request = queue.requests.find(r => r.id === requestId.toUpperCase());

  const now = new Date().toISOString();
  request.status = 'failed';
  request.failed_at = now;
  request.failure_reason = reason || 'No reason given';

  saveQueue(queue);
  appendHistory({
    id: request.id, model_name: request.model_name, url: request.url,
    status: 'failed', failure_reason: request.failure_reason,
    started_at: request.started_at, failed_at: now, filament: request.filament
  });

  await message.channel.send(
    `❌ **${requestId}** failed: ${request.failure_reason}\n` +
    `Requeue it: \`!requeue ${requestId}\``
  );
  const statusChannel = client.channels.cache.find(c => c.name === 'print-status');
  if (statusChannel) await statusChannel.send(`[SYSTEM] PRINT_FAILED ${requestId}`);
}
```

### `!requeue PR-XXXX` — Requeue a Failed Print

```bash
jq --arg id "PR-0001" \
   '(.requests[] | select(.id == $id)) |= . + {
     status: "queued", started_at: null, completed_at: null,
     failed_at: null, failure_reason: null
   }' ~/.agents/data/print-queue.json > /tmp/pq-tmp.json \
   && mv /tmp/pq-tmp.json ~/.agents/data/print-queue.json
```

### `!priority PR-XXXX <1-5>` — Adjust Priority

```bash
jq --arg id "PR-0001" --argjson p 5 \
   '(.requests[] | select(.id == $id)).priority = $p' \
   ~/.agents/data/print-queue.json > /tmp/pq-tmp.json \
   && mv /tmp/pq-tmp.json ~/.agents/data/print-queue.json
```

### `!note PR-XXXX <text>` — Add a Note

```javascript
const noteMatch = message.content.match(/^!note\s+(PR-\d{4})\s+(.+)/i);
if (noteMatch) {
  const [, requestId, noteText] = noteMatch;
  const queue = loadQueue();
  const request = queue.requests.find(r => r.id === requestId.toUpperCase());
  request.notes.push(noteText);
  saveQueue(queue);
  await message.reply(`📝 Note added to **${requestId}**.`);
}
```

### `!cancel PR-XXXX [reason]` — Cancel a Request

Sets status to `rejected` with an optional reason.

## History File Schema

```json
{
  "history": [
    {
      "id": "PR-0001",
      "model_name": "Phone Stand",
      "url": "https://makerworld.com/...",
      "source": "makerworld",
      "author": "disruptionengineer",
      "filament": "FIL-001",
      "started_at": "2026-02-27T14:00:00.000Z",
      "completed_at": "2026-02-27T18:30:00.000Z",
      "status": "completed",
      "duration": "4.5h",
      "notes": ["Printed at 0.2mm layer height"]
    }
  ]
}
```

## Tips

- `!queue` only shows active items — completed and failed prints move to history.
- You can start any queued item, not just the top one. Useful when a specific filament is already loaded.
- Filament tracking on `!start` is optional but recommended — it feeds into the weekly digest stats.
- Failed prints stay in the queue data until requeued or cancelled. They don't auto-disappear.
- The `!done` command automatically posts a filament usage reminder to `#filament` if a filament was specified on `!start`.
- All commands are case-insensitive for the ID (`pr-0001` works like `PR-0001`).
- Duration is auto-calculated from `started_at` to `completed_at` — no manual entry needed.
- History is append-only and never modified. It's the permanent audit log.
