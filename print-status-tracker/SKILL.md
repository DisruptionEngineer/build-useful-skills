---
name: print-status-tracker
description: Track 3D print completions and failures in #print-status with history logging, duration calculations, and lifetime statistics. Use when viewing recent print history, searching past prints by model name, checking success rates and average print times, reviewing which filaments get used most, or posting completion and failure summaries. Communicates upstream with print-queue-manager.
metadata: {"clawdbot":{"emoji":"📊","requires":{"anyBins":["jq"]},"os":["linux","darwin","win32"]}}
---

# Print Status Tracker

Listen on `#print-status` for `[SYSTEM] PRINT_COMPLETE` and `[SYSTEM] PRINT_FAILED` messages from the queue manager. Post formatted completion or failure summaries with duration, filament, and notes. Provide `!history` and `!stats` commands for searching past prints and viewing lifetime statistics.

## When to Use

- A `[SYSTEM] PRINT_COMPLETE PR-XXXX` message arrives in `#print-status`
- A `[SYSTEM] PRINT_FAILED PR-XXXX` message arrives in `#print-status`
- User types `!history` to see recent prints
- User types `!stats` to see lifetime printing statistics
- Searching for a specific model printed in the past

## Prerequisites

### Data Files

- `~/.agents/data/print-queue.json` — reads request details
- `~/.agents/data/print-history.json` — the permanent append-only history log

### Channel Setup

`#print-status` channel under the "3D Printing" category. Bot needs `READ_MESSAGES` and `SEND_MESSAGES`.

## System Message Handling

### Print Complete

When `[SYSTEM] PRINT_COMPLETE PR-XXXX` arrives:

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'print-status') return;

  const completeMatch = message.content.match(/\[SYSTEM\] PRINT_COMPLETE (PR-\d{4})/);
  if (completeMatch) {
    const requestId = completeMatch[1];
    const request = getRequest(requestId);
    const history = getHistoryEntry(requestId);

    await message.channel.send({
      embeds: [{
        title: `✅ Print Complete — ${requestId}`,
        description: `**${request.model_name || request.raw_text}**`,
        fields: [
          { name: 'Started', value: request.started_at?.slice(0, 16) || '?', inline: true },
          { name: 'Completed', value: request.completed_at?.slice(0, 16) || '?', inline: true },
          { name: 'Duration', value: history.duration || '?', inline: true },
          ...(request.filament ? [{ name: 'Filament', value: request.filament, inline: true }] : []),
          ...(request.notes?.length ? [{ name: 'Notes', value: request.notes.map(n => `• ${n}`).join('\n'), inline: false }] : [])
        ],
        color: 0x27AE60,
        timestamp: new Date().toISOString()
      }]
    });
  }
});
```

### Print Failed

When `[SYSTEM] PRINT_FAILED PR-XXXX` arrives:

```javascript
const failMatch = message.content.match(/\[SYSTEM\] PRINT_FAILED (PR-\d{4})/);
if (failMatch) {
  const requestId = failMatch[1];
  const request = getRequest(requestId);

  await message.channel.send({
    embeds: [{
      title: `❌ Print Failed — ${requestId}`,
      description: `**${request.model_name || request.raw_text}**`,
      fields: [
        { name: 'Started', value: request.started_at?.slice(0, 16) || '?', inline: true },
        { name: 'Failed', value: request.failed_at?.slice(0, 16) || '?', inline: true },
        { name: 'Reason', value: request.failure_reason || 'No reason given', inline: false }
      ],
      color: 0xE74C3C,
      timestamp: new Date().toISOString()
    }]
  });
}
```

## Commands

### `!history [search]` — Recent Print History

```javascript
if (message.content.startsWith('!history')) {
  const search = message.content.replace('!history', '').trim().toLowerCase();
  const history = loadHistory();
  let entries = history.history.slice(-10).reverse();

  if (search) {
    entries = history.history.filter(h =>
      (h.model_name || '').toLowerCase().includes(search) ||
      (h.raw_text || '').toLowerCase().includes(search)
    ).slice(-10).reverse();
  }

  let output = '**📜 Print History**\n\n';
  for (const h of entries) {
    const emoji = h.status === 'completed' ? '✅' : '❌';
    const name = (h.model_name || h.raw_text || 'Unknown').slice(0, 40);
    const info = [h.filament, h.duration, (h.completed_at || h.failed_at || '?').slice(0, 10)]
      .filter(Boolean).join(' • ');
    output += `${emoji} \`${h.id}\` ${name} — ${info}\n`;
  }

  await message.channel.send(output || 'No print history yet.');
}
```

### `!stats` — Lifetime Statistics

```javascript
if (message.content.trim() === '!stats') {
  const history = loadHistory().history;
  const total = history.length;
  const completed = history.filter(h => h.status === 'completed').length;
  const failed = history.filter(h => h.status === 'failed').length;
  const rate = total ? ((completed / total) * 100).toFixed(0) : 0;

  // Average duration
  const durations = history
    .map(h => h.duration)
    .filter(d => d?.endsWith('h'))
    .map(d => parseFloat(d));
  const avgTime = durations.length ? (durations.reduce((a, b) => a + b, 0) / durations.length).toFixed(1) + 'h' : 'N/A';

  // Most used filament
  const filCounts = {};
  history.forEach(h => { if (h.filament) filCounts[h.filament] = (filCounts[h.filament] || 0) + 1; });
  const topFil = Object.entries(filCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A';

  // This week / month
  const now = Date.now();
  const weekCount = history.filter(h => {
    const d = h.completed_at || h.failed_at;
    return d && (now - new Date(d).getTime()) < 7 * 86400000;
  }).length;
  const monthCount = history.filter(h => {
    const d = h.completed_at || h.failed_at;
    return d && (now - new Date(d).getTime()) < 30 * 86400000;
  }).length;

  await message.channel.send(
    `**📊 Print Statistics**\n\n` +
    `Total Prints: **${total}**\n` +
    `Completed: **${completed}** | Failed: **${failed}**\n` +
    `Success Rate: **${rate}%**\n` +
    `Avg Print Time: **${avgTime}**\n` +
    `Top Filament: **${topFil}**\n` +
    `This Week: **${weekCount}** | This Month: **${monthCount}**`
  );
}
```

## Shell Queries

```bash
# Last 10 prints
jq '.history | sort_by(.completed_at // .failed_at) | reverse | .[0:10] | .[] | {id, model_name, status, duration}' ~/.agents/data/print-history.json

# Success rate
jq '.history | {total: length, completed: [.[] | select(.status == "completed")] | length} | .completed / .total * 100' ~/.agents/data/print-history.json

# Search by model name
jq --arg q "dragon" '.history[] | select(.model_name | ascii_downcase | contains($q)) | {id, model_name, status}' ~/.agents/data/print-history.json
```

## Tips

- History is append-only — records are never deleted or modified. It's the permanent audit log.
- Search in `!history` is case-insensitive and matches both `model_name` and `raw_text`.
- Duration is auto-calculated from timestamps — no manual entry needed.
- The `!stats` command aggregates across all time. Use `!history` for recent items.
- Failed prints with reasons are valuable debugging data. Always include a reason with `!fail`.
- Top Filament stat requires consistent filament ID usage when starting prints.
- Completion and failure embeds are posted automatically — no user action needed.
- History data feeds into the weekly digest for trend analysis.
