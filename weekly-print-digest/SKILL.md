---
name: weekly-print-digest
description: Post a weekly 3D printing activity summary to Discord's #print-digest every Sunday with completed prints, active jobs, queue depth, filament alerts, stale requests, and lifetime stats. Use when reviewing weekly printing output, spotting stale unprocessed requests, monitoring filament levels at a glance, generating an on-demand digest, or tracking printing trends over time. Runs on a cron schedule every Sunday at 10 AM local time.
metadata: {"clawdbot":{"emoji":"📰","requires":{"anyBins":["jq"]},"os":["linux","darwin","win32"]}}
---

# Weekly Print Digest

Run on a cron schedule every Sunday (or on-demand via `!digest`). Aggregate data from all print pipeline data files and post a comprehensive summary to `#print-digest`. Report on completed prints, active jobs, queue depth, new requests, filament alerts, stale items, and lifetime statistics.

## When to Use

- Every Sunday at the scheduled digest time (cron trigger)
- User types `!digest` in `#print-digest` for an on-demand summary
- Reviewing what got printed this week at a glance
- Spotting stale requests sitting in `new` or `evaluated` status for 7+ days
- Checking filament levels before a big printing week

## Prerequisites

### Data Files

Reads from all three data files:
- `~/.agents/data/print-queue.json` — requests and active queue
- `~/.agents/data/print-history.json` — completed and failed prints
- `~/.agents/data/filament-inventory.json` — filament stock

### Channel Setup

`#print-digest` channel under the "3D Printing" category. Bot needs `SEND_MESSAGES`.

### Cron Schedule

```bash
# Add to crontab for Sunday at 10 AM local time
# crontab -e
0 10 * * 0 /path/to/trigger-digest.sh
```

Or use the OpenClaw scheduled task system if available.

## Utility Functions

```javascript
const fs = require('fs');
const path = require('path');
const os = require('os');

function loadJSON(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

const QUEUE_PATH = path.join(os.homedir(), '.agents/data/print-queue.json');
const HISTORY_PATH = path.join(os.homedir(), '.agents/data/print-history.json');
const INVENTORY_PATH = path.join(os.homedir(), '.agents/data/filament-inventory.json');

function loadQueue() { return loadJSON(QUEUE_PATH) || { requests: [] }; }
function loadHistory() { return loadJSON(HISTORY_PATH) || { history: [] }; }
function loadInventory() { return loadJSON(INVENTORY_PATH) || { spools: [] }; }
```

## Digest Sections

### Section 1: Prints Completed This Week

```javascript
async function getCompletedThisWeek() {
  const history = loadHistory().history;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  return history.filter(h =>
    h.status === 'completed' && h.completed_at > weekAgo
  );
}
```

Output format:
```
🖨️ Prints Completed: 3
• PR-0003 — Articulated Dragon (PLA Black, 6.2h)
• PR-0001 — Phone Stand (FIL-0001, 1.5h)
• PR-0007 — Cable Clip Set (PLA White, 0.8h)
```

### Section 2: Currently Printing

```javascript
function getCurrentlyPrinting() {
  const queue = loadQueue();
  return queue.requests.filter(r => r.status === 'printing');
}
```

```
⏳ Currently Printing: 1
• PR-0009 — Desk Organizer (started 2026-02-27T14:00)
```

### Section 3: Up Next in Queue

```javascript
function getQueuedByPriority() {
  const queue = loadQueue();
  return queue.requests
    .filter(r => r.status === 'queued')
    .sort((a, b) => (b.priority || 3) - (a.priority || 3))
    .slice(0, 5);
}
```

```
📋 In Queue: 4 requests waiting
• #1 PR-0005 — Shelf Bracket (P5)
• #2 PR-0008 — Desk Organizer (P3)
• #3 PR-0010 — Key Holder (P3)
• #4 PR-0012 — Coaster Set (P2)
```

### Section 4: Stale Requests

Requests sitting in `new` or `evaluated` status for 7+ days.

```javascript
function getStaleRequests() {
  const queue = loadQueue();
  const staleThreshold = new Date(Date.now() - 7 * 86400000).toISOString();
  return queue.requests.filter(r =>
    ['new', 'evaluated'].includes(r.status) && r.timestamp < staleThreshold
  );
}
```

```
🕸️ Stale Requests: 2
• PR-0004 — Custom bookend design (new, 12 days old)
• PR-0006 — Replacement oven knob (evaluated, 9 days old)
```

### Section 5: Filament Alert

```javascript
function getLowFilament() {
  const inventory = loadInventory();
  return inventory.spools.filter(s => s.weight_remaining_g < 200);
}
```

```
📦 Filament Alert
• FIL-0002 — PETG White: 40g remaining ⚠️
• FIL-0004 — PLA Gray: 95g remaining ⚠️
```

### Section 6: Lifetime Stats

```javascript
function getLifetimeStats() {
  const history = loadHistory().history;
  const total = history.length;
  const completed = history.filter(h => h.status === 'completed').length;
  const failed = history.filter(h => h.status === 'failed').length;
  const rate = total ? ((completed / total) * 100).toFixed(0) : 0;

  const durations = history
    .map(h => h.duration).filter(d => d?.endsWith('h'))
    .map(d => parseFloat(d));
  const avgTime = durations.length
    ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) + 'h'
    : 'N/A';

  return { total, completed, failed, rate, avgTime };
}
```

```
📊 All-Time Stats
Total: 42 | Completed: 38 | Failed: 4
Success Rate: 90% | Avg Print Time: 3.2h
```

## Building the Full Digest

```javascript
async function buildDigest(channel) {
  const completed = await getCompletedThisWeek();
  const printing = getCurrentlyPrinting();
  const queued = getQueuedByPriority();
  const stale = getStaleRequests();
  const lowFil = getLowFilament();
  const stats = getLifetimeStats();

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekLabel = `Week of ${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

  let output = `**📰 Weekly 3D Print Digest — ${weekLabel}**\n`;
  output += `${'━'.repeat(40)}\n\n`;

  // Completed
  if (completed.length) {
    output += `**🖨️ Prints Completed: ${completed.length}**\n`;
    for (const c of completed) {
      const info = [c.filament, c.duration].filter(Boolean).join(', ');
      output += `• ${c.id} — ${c.model_name || 'Unknown'}${info ? ` (${info})` : ''}\n`;
    }
  } else {
    output += '**🖨️ Prints Completed:** None this week\n';
  }
  output += '\n';

  // Printing
  if (printing.length) {
    output += `**⏳ Currently Printing: ${printing.length}**\n`;
    for (const p of printing) output += `• ${p.id} — ${p.model_name || p.raw_text}\n`;
    output += '\n';
  }

  // Queue
  const totalQueued = loadQueue().requests.filter(r => r.status === 'queued').length;
  output += `**📋 In Queue:** ${totalQueued} request(s) waiting\n`;
  output += `**🆕 New This Week:** ${getNewThisWeek().length} pending evaluation\n\n`;

  // Filament
  if (lowFil.length) {
    output += '**📦 Filament Alert**\n';
    for (const f of lowFil) output += `• ⚠️ ${f.material} ${f.color} — ${f.weight_remaining_g}g remaining\n`;
    output += '\n';
  }

  // Stale
  if (stale.length) {
    output += `**🕸️ Stale Requests: ${stale.length}**\n`;
    for (const s of stale) {
      const daysOld = Math.floor((Date.now() - new Date(s.timestamp).getTime()) / 86400000);
      output += `• ${s.id} — ${(s.model_name || s.raw_text || '?').slice(0, 40)} (${s.status}, ${daysOld}d old)\n`;
    }
    output += '\n';
  }

  // Stats
  output += `**📊 All-Time:** ${stats.total} prints | ${stats.rate}% success | avg ${stats.avgTime}\n`;
  output += `\n🔧 *Keep building. Layer by layer.*`;

  await channel.send(output);
}
```

## On-Demand Command

### `!digest` — Generate Digest Now

```javascript
if (message.content.trim() === '!digest') {
  if (!isAuthorizedUser(message.author.id)) return;
  await buildDigest(message.channel);
}
```

## Shell — Generate Digest Data

```bash
# Completed this week
jq --arg since "$(date -u -v-7d +%Y-%m-%dT%H:%M:%S.000Z)" \
   '[.history[] | select(.status == "completed" and .completed_at > $since)] | length' \
   ~/.agents/data/print-history.json

# Stale requests (7+ days old, still new/evaluated)
jq --arg cutoff "$(date -u -v-7d +%Y-%m-%dT%H:%M:%S.000Z)" \
   '[.requests[] | select((.status == "new" or .status == "evaluated") and .timestamp < $cutoff)] | length' \
   ~/.agents/data/print-queue.json

# Low filament count
jq '[.spools[] | select(.weight_remaining_g < 200)] | length' \
   ~/.agents/data/filament-inventory.json
```

## Tips

- Use `!digest` anytime for a mid-week snapshot — great for Sunday night print planning.
- Stale requests use a 7-day threshold. Anything sitting in "new" that long probably needs attention or rejection.
- The digest only counts `completed` prints in the "this week" section — failed prints aren't counted as completed.
- Filament alerts mirror the same 200g threshold from the filament-tracker skill's `!low` command.
- If the bot is offline during the scheduled cron time, the digest is skipped. Run `!digest` manually to catch up.
- The digest reads live data at post time, so last-minute completions are included.
- Queue count only includes `queued` items — `printing` items show under "Currently Printing."
- The motivational print pun at the end rotates. Feel free to add more to the array.
- All timestamps are UTC ISO 8601. Week calculations use Sunday as the start of the week.
