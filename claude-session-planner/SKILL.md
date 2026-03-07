---
name: claude-session-planner
description: Optimize Claude Code session scheduling via Discord using Home Assistant calendars (Nextcloud/CalDAV). Use when analyzing calendar availability across personal and family calendars, finding optimal 5-hour coding windows, distinguishing between mobile planning and desktop coding work, generating ASCII timeline visualizations, creating calendar blocks via HA service calls, or tracking session usage patterns over time.
metadata: {"clawdbot":{"emoji":"📅","requires":{"anyBins":["node","curl"]},"os":["linux","darwin"]}}
---

# Claude Code Window Optimizer

Analyze Home Assistant calendars (backed by Nextcloud/CalDAV) to find optimal 5-hour windows for Claude Code sessions. Queries the HA REST API for events across personal, family, and school calendars, distinguishes planning work (mobile-friendly) from coding work (desktop-required), generates ASCII timeline visualizations in Discord, ranks candidate windows by quality, and creates calendar blocks via HA service calls to protect reserved time.

## When to Use

- Finding the next best 5-hour window for a Claude Code session
- Checking calendar conflicts across personal, family, and school calendars via Home Assistant
- Deciding whether to plan (mobile) or code (desktop) based on current context
- Generating a visual timeline of available slots for the coming days
- Booking a Claude Code session block on your personal calendar via HA
- Reviewing historical session patterns to optimize future scheduling

## Prerequisites

### Home Assistant Calendar Access

```bash
# Verify HA is reachable and list calendars
curl -s -H "Authorization: Bearer $HA_TOKEN" http://10.10.7.60:8123/api/ | jq .
curl -s -H "Authorization: Bearer $HA_TOKEN" http://10.10.7.60:8123/api/calendars | jq '.[].entity_id'
# Expected entities: calendar.personal, calendar.family_shared_derek,
#   calendar.clinicals_rachel, calendar.lab_rachel, calendar.math_rachel,
#   calendar.contact_birthdays, calendar.mealie_{breakfast,lunch,dinner,side}
```

### Data Files

Config: `~/.agents/data/claude-planner-config.json`
History: `~/.agents/data/claude-session-history.json`
Task rules: `~/.agents/data/calendar-task-mapping.json`

```json
// claude-planner-config.json structure
{
  "timezone": "America/Chicago",
  "workingHours": { "start": "07:00", "end": "22:00" },
  "sessionDuration": 300,
  "minSessionDuration": 180,
  "homeAssistant": { "url": "http://10.10.7.60:8123", "tokenEnvVar": "HA_TOKEN" },
  "calendars": {
    "personal":  { "entity_id": "calendar.personal", "label": "Personal", "canWrite": true, "owner": "derek" },
    "family":    { "entity_id": "calendar.family_shared_derek", "label": "Family Shared", "canWrite": true, "owner": "derek" },
    "clinicals": { "entity_id": "calendar.clinicals_rachel", "label": "Clinicals (Rachel)", "canWrite": false, "owner": "rachel" },
    "lab":       { "entity_id": "calendar.lab_rachel", "label": "Lab (Rachel)", "canWrite": false, "owner": "rachel" },
    "math":      { "entity_id": "calendar.math_rachel", "label": "Math (Rachel)", "canWrite": false, "owner": "rachel" },
    "birthdays": { "entity_id": "calendar.contact_birthdays", "label": "Birthdays", "canWrite": false, "owner": "shared" }
  },
  "preferences": {
    "preferredCodingHours": { "start": "09:00", "end": "17:00" },
    "preferredPlanningHours": { "start": "07:00", "end": "09:00" },
    "avoidAfter": "20:00",
    "planningRatio": 0.3, "codingRatio": 0.7,
    "bufferMinutes": 15
  },
  "scoring": {
    "meetingFreeMarginWeight": 0.30, "timeOfDayWeight": 0.25,
    "taskClassificationWeight": 0.25, "streakBonusWeight": 0.10,
    "dayBalanceWeight": 0.10
  }
}
```

```json
// calendar-task-mapping.json
{
  "planningKeywords": ["plan", "review", "discuss", "brainstorm", "design", "spec", "meeting", "standup", "retro"],
  "codingKeywords": ["implement", "build", "code", "fix", "debug", "test", "deploy", "refactor", "pr"],
  "blockingKeywords": ["focus", "deep work", "heads down", "dnd", "clinicals", "lab", "exam"],
  "defaultClassification": "coding"
}
```

## Calendar Fetching & Event Classification

```javascript
const CONFIG_PATH = `${process.env.HOME}/.agents/data/claude-planner-config.json`;
const HISTORY_PATH = `${process.env.HOME}/.agents/data/claude-session-history.json`;
const TASK_MAPPING_PATH = `${process.env.HOME}/.agents/data/calendar-task-mapping.json`;

function loadJSON(path) { return JSON.parse(require('fs').readFileSync(path, 'utf8')); }
function saveJSON(path, data) { require('fs').writeFileSync(path, JSON.stringify(data, null, 2)); }

function classifyEvent(title, showTitle) {
  if (!showTitle || !title) return 'unknown';
  const lower = title.toLowerCase();
  const rules = loadJSON(TASK_MAPPING_PATH);
  if (rules.blockingKeywords.some(kw => lower.includes(kw))) return 'blocking';
  if (rules.planningKeywords.some(kw => lower.includes(kw))) return 'planning';
  if (rules.codingKeywords.some(kw => lower.includes(kw))) return 'coding';
  return rules.defaultClassification;
}

async function fetchCalendarEvents(config, startDate, endDate) {
  const ha = config.homeAssistant;
  const token = process.env[ha.tokenEnvVar];
  if (!token) throw new Error(`Missing env var: ${ha.tokenEnvVar}`);

  const startStr = startDate.toISOString().replace(/\.\d{3}Z$/, '');
  const endStr = endDate.toISOString().replace(/\.\d{3}Z$/, '');
  const events = [];

  for (const [id, cal] of Object.entries(config.calendars)) {
    try {
      const url = `${ha.url}/api/calendars/${cal.entity_id}?start=${startStr}&end=${endStr}`;
      const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) { console.error(`HA API error for ${cal.entity_id}: ${response.status}`); continue; }
      const haEvents = await response.json();

      for (const evt of haEvents) {
        const start = new Date(evt.start.dateTime || evt.start.date);
        const end = new Date(evt.end.dateTime || evt.end.date);
        events.push({
          calendarId: id, calendarLabel: cal.label,
          title: cal.canWrite ? (evt.summary || '') : '[Busy]',
          start: start.toISOString(), end: end.toISOString(),
          duration: (end - start) / 60000,
          isAllDay: !evt.start.dateTime, owner: cal.owner,
          classification: classifyEvent(evt.summary || '', cal.canWrite)
        });
      }
    } catch (err) {
      console.error(`Failed to fetch calendar ${id}: ${err.message}`);
    }
  }
  return events.sort((a, b) => new Date(a.start) - new Date(b.start));
}
```

### Bash: Quick Calendar Check

```bash
HA_URL="http://10.10.7.60:8123"
TODAY=$(date +%Y-%m-%d)
TOMORROW=$(date -v+1d +%Y-%m-%d)

for ENTITY in calendar.personal calendar.family_shared_derek calendar.clinicals_rachel; do
  echo "=== $ENTITY ==="
  curl -s -H "Authorization: Bearer $HA_TOKEN" \
    "${HA_URL}/api/calendars/${ENTITY}?start=${TODAY}T00:00:00&end=${TOMORROW}T00:00:00" \
    | jq -r '.[] | "\(.start.dateTime // .start.date) — \(.summary)"'
done
```

## Window Finding & Scoring

```javascript
function findAvailableWindows(events, config, targetDate) {
  const dayStart = parseTime(config.workingHours.start, targetDate);
  const dayEnd = parseTime(config.workingHours.end, targetDate);
  const sessionMs = config.sessionDuration * 60000;
  const minSessionMs = config.minSessionDuration * 60000;
  const bufferMs = config.preferences.bufferMinutes * 60000;

  const dayEvents = events.filter(e => {
    const eStart = new Date(e.start), eEnd = new Date(e.end);
    return eStart < dayEnd && eEnd > dayStart && !e.isAllDay;
  }).sort((a, b) => new Date(a.start) - new Date(b.start));

  const windows = [];
  let cursor = dayStart.getTime();

  for (const event of dayEvents) {
    const eventStart = new Date(event.start).getTime();
    const eventEnd = new Date(event.end).getTime();
    const gapEnd = eventStart - bufferMs;

    if (gapEnd - cursor >= minSessionMs) {
      const windowDuration = Math.min(gapEnd - cursor, sessionMs);
      windows.push({
        start: new Date(cursor),
        end: new Date(cursor + windowDuration),
        duration: windowDuration / 60000,
        beforeEvent: event.calendarLabel ? `${event.classification} on ${event.calendarLabel}` : null,
        type: determineWindowType(cursor, config)
      });
    }
    cursor = Math.max(cursor, eventEnd + bufferMs);
  }

  // Remaining time after last event
  if (dayEnd.getTime() - cursor >= minSessionMs) {
    const windowDuration = Math.min(dayEnd.getTime() - cursor, sessionMs);
    windows.push({
      start: new Date(cursor), end: new Date(cursor + windowDuration),
      duration: windowDuration / 60000, beforeEvent: null,
      type: determineWindowType(cursor, config)
    });
  }
  return windows;
}

function determineWindowType(timestampMs, config) {
  const hour = new Date(timestampMs).getHours();
  const planStart = parseInt(config.preferences.preferredPlanningHours.start);
  const planEnd = parseInt(config.preferences.preferredPlanningHours.end);
  if (hour >= planStart && hour < planEnd) return 'planning';
  const codingStart = parseInt(config.preferences.preferredCodingHours.start);
  const codingEnd = parseInt(config.preferences.preferredCodingHours.end);
  if (hour >= codingStart && hour < codingEnd) return 'coding';
  return 'flexible';
}

function parseTime(timeStr, targetDate) {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const d = new Date(targetDate);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function scoreWindow(window, config, history) {
  const weights = config.scoring;
  const marginScore = Math.min(window.duration / config.sessionDuration, 1.0);

  const hour = window.start.getHours();
  const codingPref = config.preferences.preferredCodingHours;
  const inPreferred = hour >= parseInt(codingPref.start) && hour < parseInt(codingPref.end);
  const timeScore = inPreferred ? 1.0 : 0.4;

  const typeScore = window.type === 'coding' ? 1.0 : window.type === 'planning' ? 0.7 : 0.5;
  const streakScore = Math.min(history.streaks.current / 5, 1.0);

  const todayCount = history.sessions.filter(
    s => s.date === window.start.toISOString().split('T')[0]
  ).length;
  const balanceScore = todayCount === 0 ? 1.0 : 0.3;

  const total = (
    marginScore * weights.meetingFreeMarginWeight +
    timeScore * weights.timeOfDayWeight +
    typeScore * weights.taskClassificationWeight +
    streakScore * weights.streakBonusWeight +
    balanceScore * weights.dayBalanceWeight
  );

  return {
    total: Math.round(total * 100) / 100,
    breakdown: {
      margin: Math.round(marginScore * 100), timeOfDay: Math.round(timeScore * 100),
      taskType: Math.round(typeScore * 100), streak: Math.round(streakScore * 100),
      balance: Math.round(balanceScore * 100)
    }
  };
}
```

## ASCII Timeline Visualization

```javascript
function renderTimeline(date, events, windows, config) {
  const startHour = parseInt(config.workingHours.start);
  const endHour = parseInt(config.workingHours.end);
  const width = 60;
  const hoursTotal = endHour - startHour;
  const lines = [];

  lines.push(`📅 ${date} — Claude Code Window Planner`);
  lines.push('═'.repeat(width + 12));

  // Hour header
  let header = '        ';
  for (let h = startHour; h <= endHour; h += 2) {
    const pos = Math.round(((h - startHour) / hoursTotal) * width);
    header = header.substring(0, pos + 8) + `${h}`.padStart(2, '0') + header.substring(pos + 10);
  }
  lines.push(header);

  // Events row — filled blocks for busy time
  let eventRow = 'Events  |' + '·'.repeat(width) + '|';
  for (const event of events) {
    const eStart = new Date(event.start).getHours() + new Date(event.start).getMinutes() / 60;
    const eEnd = new Date(event.end).getHours() + new Date(event.end).getMinutes() / 60;
    const startPos = Math.round(((eStart - startHour) / hoursTotal) * width);
    const endPos = Math.round(((eEnd - startHour) / hoursTotal) * width);
    const bar = '█'.repeat(Math.max(endPos - startPos, 1));
    eventRow = eventRow.substring(0, startPos + 9) + bar + eventRow.substring(startPos + 9 + bar.length);
  }
  lines.push(eventRow);

  // Available windows row
  let windowRow = 'Windows |' + ' '.repeat(width) + '|';
  for (const win of windows) {
    const wStart = win.start.getHours() + win.start.getMinutes() / 60;
    const wEnd = win.end.getHours() + win.end.getMinutes() / 60;
    const startPos = Math.round(((wStart - startHour) / hoursTotal) * width);
    const endPos = Math.round(((wEnd - startHour) / hoursTotal) * width);
    const bar = '░'.repeat(Math.max(endPos - startPos, 1));
    windowRow = windowRow.substring(0, startPos + 9) + bar + windowRow.substring(startPos + 9 + bar.length);
  }
  lines.push(windowRow);

  lines.push('═'.repeat(width + 12));
  lines.push('Legend: █ = Event  ░ = Available  💻 = Coding  📱 = Planning');
  lines.push('');

  // Ranked windows (top 5)
  lines.push('**Ranked Windows:**');
  for (let i = 0; i < Math.min(windows.length, 5); i++) {
    const w = windows[i];
    const timeStr = `${formatTime(w.start)}–${formatTime(w.end)}`;
    const icon = w.type === 'coding' ? '💻' : '📱';
    const score = w.score ? `${(w.score.total * 100).toFixed(0)}%` : '—';
    lines.push(`  ${i + 1}. ${icon} ${timeStr} (${Math.round(w.duration)}min) — Score: ${score}`);
    if (w.beforeEvent) lines.push(`     ⤷ Before: ${w.beforeEvent}`);
  }
  return lines.join('\n');
}

function formatTime(date) {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
```

## Discord Integration

### Plan Session Command

```javascript
async function planSession(interaction) {
  await interaction.deferReply();
  const daysAhead = interaction.options.getInteger('days-ahead') || 3;
  const config = loadJSON(CONFIG_PATH);
  const history = loadJSON(HISTORY_PATH);

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + daysAhead * 86400000);
  const events = await fetchCalendarEvents(config, startDate, endDate);

  const allResults = [];
  for (let d = 0; d < daysAhead; d++) {
    const targetDate = new Date(startDate.getTime() + d * 86400000);
    const dateStr = targetDate.toISOString().split('T')[0];
    const windows = findAvailableWindows(events, config, targetDate);

    windows.forEach(w => { w.score = scoreWindow(w, config, history); });
    windows.sort((a, b) => b.score.total - a.score.total);

    const dayEvents = events.filter(e => e.start.startsWith(dateStr) && !e.isAllDay);
    allResults.push({
      date: dateStr,
      timeline: renderTimeline(dateStr, dayEvents, windows, config),
      bestWindow: windows[0] || null,
      windowCount: windows.length
    });
  }

  const best = allResults
    .filter(r => r.bestWindow)
    .sort((a, b) => b.bestWindow.score.total - a.bestWindow.score.total)[0];

  let content = '```\n';
  for (const day of allResults) content += day.timeline + '\n\n';
  content += '```';

  if (best) {
    const bw = best.bestWindow;
    content += `\n\n🏆 **Best window**: ${best.date} ${formatTime(bw.start)}–${formatTime(bw.end)}`;
    content += ` (${bw.type}, ${Math.round(bw.duration)}min, score ${(bw.score.total * 100).toFixed(0)}%)`;
    content += `\n\nReact ✅ to book this window on your personal calendar.`;
  } else {
    content += `\n\n❌ No suitable windows found in the next ${daysAhead} days.`;
  }

  const msg = await interaction.editReply(content);
  if (best) {
    await msg.react('✅');
    msg._pendingWindow = { date: best.date, window: best.bestWindow };
  }
}
```

### Booking Handler — HA Calendar Event Creation

```javascript
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot || reaction.message.channel.name !== 'claude-planner' || reaction.emoji.name !== '✅') return;
  const pendingWindow = reaction.message._pendingWindow;
  if (!pendingWindow) return;

  const config = loadJSON(CONFIG_PATH);
  const history = loadJSON(HISTORY_PATH);
  const win = pendingWindow.window;

  await createHACalendarEvent(config, {
    entity_id: config.calendars.personal.entity_id,
    summary: '💻 Claude Code Session',
    start: win.start.toISOString(),
    end: win.end.toISOString(),
    description: `Type: ${win.type}\nScore: ${(win.score.total * 100).toFixed(0)}%\nBooked via Claude Session Planner`
  });

  history.sessions.push({
    date: pendingWindow.date, start: win.start.toISOString(), end: win.end.toISOString(),
    type: win.type, duration: win.duration, score: win.score.total, status: 'booked'
  });

  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const hadYesterday = history.sessions.some(s => s.date === yesterday);
  history.streaks.current = hadYesterday ? history.streaks.current + 1 : 1;
  history.streaks.best = Math.max(history.streaks.best, history.streaks.current);
  saveJSON(HISTORY_PATH, history);

  await reaction.message.reply(
    `✅ Booked **${win.type}** session: ${formatTime(win.start)}–${formatTime(win.end)} on ${pendingWindow.date}\n` +
    `📊 Session streak: ${history.streaks.current} days`
  );
});
```

### Home Assistant Calendar Event Creation

```javascript
async function createHACalendarEvent(config, eventData) {
  const token = process.env[config.homeAssistant.tokenEnvVar];
  const startDt = new Date(eventData.start);
  const endDt = new Date(eventData.end);

  const response = await fetch(`${config.homeAssistant.url}/api/services/calendar/create_event`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_id: eventData.entity_id,
      summary: eventData.summary,
      start_date_time: startDt.toISOString().replace('Z', '+00:00'),
      end_date_time: endDt.toISOString().replace('Z', '+00:00'),
      description: eventData.description || ''
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HA create_event failed (${response.status}): ${body}`);
  }
  return true;
}
```

### Bash: Book a Session via HA

```bash
HA_URL="http://10.10.7.60:8123"
START="2026-03-03T09:00:00"
END="2026-03-03T14:00:00"

curl -s -X POST \
  -H "Authorization: Bearer $HA_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"entity_id\":\"calendar.personal\",\"summary\":\"💻 Claude Code Session\",\"start_date_time\":\"$START\",\"end_date_time\":\"$END\",\"description\":\"Booked via Claude Session Planner\"}" \
  "${HA_URL}/api/services/calendar/create_event"
```

## Session Analytics

```bash
# Sessions this week
jq --arg start "$(date -v-7d +%Y-%m-%d)" '
  .sessions | map(select(.date >= $start))
  | group_by(.type)
  | map({type: .[0].type, count: length, totalMinutes: (map(.duration) | add)})
' ~/.agents/data/claude-session-history.json

# Average session score by day of week
python3 << 'PYEOF'
import json, os
from datetime import datetime
from collections import defaultdict

path = os.path.expanduser('~/.agents/data/claude-session-history.json')
history = json.load(open(path))
by_day = defaultdict(list)
for s in history['sessions']:
    dow = datetime.fromisoformat(s['date']).strftime('%A')
    by_day[dow].append(s.get('score', 0))

for day in ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']:
    scores = by_day.get(day, [])
    avg = sum(scores)/len(scores) if scores else 0
    bar = '█' * int(avg * 20)
    print(f'{day:9s} {bar} {avg:.0%} ({len(scores)} sessions)')
PYEOF
```

## Troubleshooting

```bash
# Check HA connectivity
curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $HA_TOKEN" http://10.10.7.60:8123/api/
# Should return 200. Common issues:
#   - HA_TOKEN not set — export from env
#   - HA unreachable — verify you're on 10.10.7.x network
#   - Token expired — check HA Profile > Security (tokens last 10 years)
#   - Calendar integration not loaded — check HA Settings > Integrations

# List all calendar entities (useful if an entity is missing)
curl -s -H "Authorization: Bearer $HA_TOKEN" \
  http://10.10.7.60:8123/api/states \
  | jq '[.[] | select(.entity_id | startswith("calendar.")) | .entity_id]'

# Adjust minimum session duration for tighter schedules
jq '.minSessionDuration = 120' ~/.agents/data/claude-planner-config.json > /tmp/cp.json \
  && mv /tmp/cp.json ~/.agents/data/claude-planner-config.json
```

## Tips

- A 3-hour meeting-free block beats a 5-hour block with a standup in the middle. Fewest interruptions wins.
- Schedule planning work for early morning / commute (phone-only). Save desk hours for coding.
- 15-minute buffers before meetings prevent getting deep in code right before a context switch.
- Rachel's school calendars are read-only but critical: clinicals shift family logistics and your available hours.
- HA REST API has no local rate limits. One fetch per entity per sync is fine.
- `calendar.create_event` writes back to Nextcloud via CalDAV; syncs to all devices in ~30 seconds.
- Track streaks. Daily consistency beats marathon sessions for momentum.
- Limit to one Claude Code session per day; context switching wastes ~20 minutes each restart.
- Tune `meetingFreeMarginWeight` higher if you hate interruptions, `timeOfDayWeight` if you're a morning person.
- Review session history monthly. If most sessions are evenings, restructure daytime, don't add more evenings.
