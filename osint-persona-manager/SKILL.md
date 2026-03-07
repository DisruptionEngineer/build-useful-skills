---
name: osint-persona-manager
description: Manage OSINT investigation personas via Discord commands. Use when creating persona profiles with consistent backstories, tracking accounts across platforms, enforcing operational security rules, logging interactions for audit trails, coordinating team persona assignments, running consistency checks, or generating persona-consistent content drafts. Designed for authorized security researchers.
metadata: {"clawdbot":{"emoji":"🎭","requires":{"anyBins":["node","jq"]},"os":["linux","darwin"]}}
---

# OSINT Persona Manager

Manage the full lifecycle of OSINT investigation personas from Discord. Create detailed profiles with backstories, track accounts across platforms, enforce operational security boundaries, log every interaction for audit compliance, and coordinate team assignments. This is a management and tracking tool only — humans operate the actual accounts.

## When to Use

- Creating a new investigation persona with a consistent backstory and digital footprint plan
- Tracking which accounts belong to which persona across multiple platforms
- Assigning personas to team members for coordinated operations
- Running consistency checks before deploying a persona to detect conflicting details
- Logging interactions and activities for compliance audit trails
- Generating content drafts that match a specific persona's writing style
- Reviewing persona status and activity across the team
- Enforcing operational security rules (timing, VPN, separation)

## Prerequisites

### Data Directory Setup

```bash
# Initialize data files if absent
mkdir -p ~/.agents/data

if [ ! -f ~/.agents/data/osint-personas.json ]; then
  echo '{"personas": [], "version": 1}' > ~/.agents/data/osint-personas.json
fi

if [ ! -f ~/.agents/data/persona-assignments.json ]; then
  echo '{"assignments": []}' > ~/.agents/data/persona-assignments.json
fi

if [ ! -f ~/.agents/data/persona-interaction-log.json ]; then
  echo '{"log": []}' > ~/.agents/data/persona-interaction-log.json
fi

if [ ! -f ~/.agents/data/persona-opsec-rules.json ]; then
  cat > ~/.agents/data/persona-opsec-rules.json << 'EOF'
{
  "rules": {
    "requireVPN": true,
    "minTimeBetweenPersonas": 30,
    "maxDailyInteractions": 50,
    "forbiddenOverlaps": ["same-ip", "same-browser-fingerprint", "same-email-domain"],
    "requiredFields": ["name", "backstory", "interests", "writingStyle"]
  }
}
EOF
fi
```

### Channel Setup

```bash
# Verify bot access to #osint-personas channel
# Channel should be restricted to authorized OSINT team members only
# Required permissions: READ_MESSAGES, SEND_MESSAGES, ADD_REACTIONS, EMBED_LINKS
```

## Persona Profile Schema

### Profile Structure

```json
{
  "id": "PERSONA-0001",
  "name": "Alex Rivera",
  "status": "active",
  "createdAt": "2026-02-15T10:00:00Z",
  "createdBy": "operator-discord-id",
  "backstory": {
    "age": 34,
    "location": "Portland, OR",
    "occupation": "Freelance graphic designer",
    "education": "BFA from RISD",
    "interests": ["digital art", "hiking", "indie music", "coffee roasting"],
    "personality": "Introverted but opinionated about design trends",
    "background": "Moved to Portland after college, freelances for small agencies"
  },
  "writingStyle": {
    "tone": "casual-professional",
    "quirks": ["uses em-dashes frequently", "lowercase i sometimes", "references design jargon"],
    "vocabulary": "mid-level",
    "emojiUsage": "minimal",
    "avgSentenceLength": "medium"
  },
  "accounts": [
    {
      "platform": "twitter",
      "username": "arivera_design",
      "status": "active",
      "createdAt": "2026-02-16T14:30:00Z",
      "lastActive": "2026-03-01T09:15:00Z",
      "notes": "Primary engagement account"
    }
  ],
  "opsec": {
    "vpnRegion": "us-west",
    "browserProfile": "firefox-profile-3",
    "timezoneEmulation": "America/Los_Angeles",
    "activeHours": {"start": "08:00", "end": "23:00"}
  },
  "tags": ["investigation-alpha", "tech-sector"]
}
```

## Core Operations

### Create a Persona

```javascript
// Discord command handler: /persona create
async function createPersona(interaction) {
  const name = interaction.options.getString('name');
  const occupation = interaction.options.getString('occupation');
  const location = interaction.options.getString('location');
  const tags = interaction.options.getString('tags')?.split(',').map(t => t.trim()) || [];

  const personas = loadJSON(PERSONAS_PATH) || { personas: [] };
  const nextId = `PERSONA-${String(personas.personas.length + 1).padStart(4, '0')}`;

  const persona = {
    id: nextId,
    name,
    status: 'draft',
    createdAt: new Date().toISOString(),
    createdBy: interaction.user.id,
    backstory: {
      occupation,
      location,
      interests: [],
      personality: '',
      background: ''
    },
    writingStyle: {
      tone: 'neutral',
      quirks: [],
      vocabulary: 'mid-level',
      emojiUsage: 'minimal',
      avgSentenceLength: 'medium'
    },
    accounts: [],
    opsec: {
      vpnRegion: '',
      browserProfile: '',
      timezoneEmulation: '',
      activeHours: { start: '09:00', end: '17:00' }
    },
    tags
  };

  personas.personas.push(persona);
  saveJSON(PERSONAS_PATH, personas);
  logActivity(nextId, 'created', interaction.user.id, { name, occupation });

  await interaction.reply({
    embeds: [buildPersonaCard(persona, 'Created')]
  });
}
```

### List Personas

```javascript
// Discord command handler: /persona list [status] [tag]
async function listPersonas(interaction) {
  const statusFilter = interaction.options.getString('status'); // active|draft|retired
  const tagFilter = interaction.options.getString('tag');
  const personas = loadJSON(PERSONAS_PATH) || { personas: [] };

  let filtered = personas.personas;
  if (statusFilter) filtered = filtered.filter(p => p.status === statusFilter);
  if (tagFilter) filtered = filtered.filter(p => p.tags.includes(tagFilter));

  if (filtered.length === 0) {
    return interaction.reply('No personas match the filter.');
  }

  const embed = {
    title: `📋 Personas (${filtered.length})`,
    color: 0x5865F2,
    fields: filtered.slice(0, 25).map(p => ({
      name: `${statusEmoji(p.status)} ${p.name} (${p.id})`,
      value: [
        `**Status:** ${p.status}`,
        `**Accounts:** ${p.accounts.length} across ${new Set(p.accounts.map(a => a.platform)).size} platforms`,
        `**Tags:** ${p.tags.join(', ') || 'none'}`,
        `**Last active:** ${getLastActive(p) || 'never'}`
      ].join('\n'),
      inline: true
    }))
  };

  await interaction.reply({ embeds: [embed] });
}

function statusEmoji(status) {
  return { active: '🟢', draft: '📝', retired: '🔴', suspended: '⏸️' }[status] || '❓';
}
```

### Add Account to Persona

```javascript
// Discord command handler: /persona add-account <persona-id> <platform> <username>
async function addAccount(interaction) {
  const personaId = interaction.options.getString('persona-id');
  const platform = interaction.options.getString('platform');
  const username = interaction.options.getString('username');

  const personas = loadJSON(PERSONAS_PATH) || { personas: [] };
  const persona = personas.personas.find(p => p.id === personaId);
  if (!persona) return interaction.reply(`❌ Persona ${personaId} not found.`);

  // Check for username conflicts across all personas
  const conflict = findUsernameConflict(personas, platform, username, personaId);
  if (conflict) {
    return interaction.reply(
      `⚠️ Username \`${username}\` on ${platform} is already tracked under **${conflict.name}** (${conflict.id}). This would violate persona separation.`
    );
  }

  persona.accounts.push({
    platform,
    username,
    status: 'active',
    createdAt: new Date().toISOString(),
    lastActive: null,
    notes: ''
  });

  saveJSON(PERSONAS_PATH, personas);
  logActivity(personaId, 'account-added', interaction.user.id, { platform, username });

  await interaction.reply(`✅ Added \`${username}\` on **${platform}** to persona **${persona.name}**.`);
}
```

### Assign Persona to Team Member

```javascript
// Discord command handler: /persona assign <persona-id> <user>
async function assignPersona(interaction) {
  const personaId = interaction.options.getString('persona-id');
  const assignee = interaction.options.getUser('user');

  const assignments = loadJSON(ASSIGNMENTS_PATH) || { assignments: [] };

  // Check if user already has max assignments
  const userAssignments = assignments.assignments.filter(
    a => a.assigneeId === assignee.id && a.status === 'active'
  );
  if (userAssignments.length >= 3) {
    return interaction.reply(
      `⚠️ ${assignee.username} already has ${userAssignments.length} active assignments. Max is 3 for opsec reasons.`
    );
  }

  assignments.assignments.push({
    personaId,
    assigneeId: assignee.id,
    assigneeName: assignee.username,
    assignedAt: new Date().toISOString(),
    assignedBy: interaction.user.id,
    status: 'active'
  });

  saveJSON(ASSIGNMENTS_PATH, assignments);
  logActivity(personaId, 'assigned', interaction.user.id, {
    assignee: assignee.username, assigneeId: assignee.id
  });

  await interaction.reply(`✅ Persona **${personaId}** assigned to ${assignee.username}.`);
}
```

## Logging and Audit Trail

### Activity Logger

```javascript
const LOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'persona-interaction-log.json');

function logActivity(personaId, action, operatorId, details = {}) {
  const log = loadJSON(LOG_PATH) || { log: [] };
  log.log.push({
    timestamp: new Date().toISOString(),
    personaId,
    action,       // created | account-added | assigned | interaction | retired | opsec-violation
    operatorId,
    details,
    sessionId: crypto.randomUUID()
  });
  saveJSON(LOG_PATH, log);
}
```

### View Activity Log

```bash
# View last 20 log entries for a persona
jq '.log | map(select(.personaId == "PERSONA-0001")) | sort_by(.timestamp) | reverse | .[0:20]' \
  ~/.agents/data/persona-interaction-log.json

# Count interactions by type
jq '.log | group_by(.action) | map({action: .[0].action, count: length})' \
  ~/.agents/data/persona-interaction-log.json

# Export audit report for date range
jq --arg from "2026-02-01" --arg to "2026-03-01" \
  '.log | map(select(.timestamp >= $from and .timestamp <= $to))' \
  ~/.agents/data/persona-interaction-log.json > /tmp/audit-report.json
```

## Consistency Checking

### Run Consistency Check

```python
#!/usr/bin/env python3
"""Check all personas for conflicting or overlapping details."""
import json
from pathlib import Path
from collections import defaultdict

data_dir = Path.home() / '.agents' / 'data'
personas = json.loads((data_dir / 'osint-personas.json').read_text())['personas']

issues = []

# Check 1: Duplicate usernames across personas
platform_users = defaultdict(list)
for p in personas:
    for acc in p['accounts']:
        key = f"{acc['platform']}:{acc['username']}"
        platform_users[key].append(p['id'])

for key, pids in platform_users.items():
    if len(pids) > 1:
        issues.append({
            'severity': 'critical',
            'type': 'duplicate-username',
            'detail': f'{key} claimed by: {", ".join(pids)}'
        })

# Check 2: Same location across too many personas
locations = defaultdict(list)
for p in personas:
    loc = p.get('backstory', {}).get('location', '')
    if loc:
        locations[loc].append(p['id'])

for loc, pids in locations.items():
    if len(pids) > 2:
        issues.append({
            'severity': 'warning',
            'type': 'location-cluster',
            'detail': f'{len(pids)} personas in {loc}: {", ".join(pids)}'
        })

# Check 3: Overlapping interests (>60% match = suspicious)
for i, p1 in enumerate(personas):
    for p2 in personas[i+1:]:
        i1 = set(p1.get('backstory', {}).get('interests', []))
        i2 = set(p2.get('backstory', {}).get('interests', []))
        if i1 and i2:
            overlap = len(i1 & i2) / max(len(i1 | i2), 1)
            if overlap > 0.6:
                issues.append({
                    'severity': 'warning',
                    'type': 'interest-overlap',
                    'detail': f'{p1["id"]} and {p2["id"]} share {overlap:.0%} interests'
                })

# Check 4: Same VPN region across active personas
vpn_regions = defaultdict(list)
for p in personas:
    if p['status'] == 'active':
        region = p.get('opsec', {}).get('vpnRegion', '')
        if region:
            vpn_regions[region].append(p['id'])

for region, pids in vpn_regions.items():
    if len(pids) > 1:
        issues.append({
            'severity': 'critical',
            'type': 'vpn-collision',
            'detail': f'{len(pids)} active personas on VPN region {region}: {", ".join(pids)}'
        })

# Report
print(f'\n{"="*50}')
print(f'Consistency Report: {len(personas)} personas checked')
print(f'Issues found: {len(issues)}')
print(f'{"="*50}')
for issue in sorted(issues, key=lambda x: x['severity']):
    icon = '🔴' if issue['severity'] == 'critical' else '🟡'
    print(f'{icon} [{issue["severity"]}] {issue["type"]}: {issue["detail"]}')
```

### Discord Consistency Report

```javascript
// Discord command handler: /persona check [persona-id]
async function runConsistencyCheck(interaction) {
  await interaction.deferReply();

  const { execAsync } = require('./utils');
  const { stdout } = await execAsync('python3 ~/.agents/scripts/persona-consistency-check.py');

  const lines = stdout.trim().split('\n');
  const criticals = lines.filter(l => l.includes('[critical]')).length;
  const warnings = lines.filter(l => l.includes('[warning]')).length;

  const color = criticals > 0 ? 0xFF0000 : warnings > 0 ? 0xFFA500 : 0x00FF00;

  await interaction.editReply({
    embeds: [{
      title: '🔍 Persona Consistency Report',
      description: stdout.slice(0, 4000),
      color,
      footer: { text: `${criticals} critical | ${warnings} warnings` }
    }]
  });
}
```

## OpSec Enforcement

### Pre-Interaction Compliance Check

```javascript
// Run before any persona interaction to enforce opsec rules
async function checkOpsecCompliance(personaId, operatorId) {
  const opsecData = loadJSON(OPSEC_RULES_PATH) || { rules: {} };
  const rules = opsecData.rules;
  const logData = loadJSON(LOG_PATH) || { log: [] };
  const log = logData.log;
  const violations = [];

  // Rule 1: Minimum time between switching personas
  const recentLogs = log
    .filter(e => e.operatorId === operatorId && e.action === 'interaction')
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  if (recentLogs.length > 0) {
    const lastEntry = recentLogs[0];
    if (lastEntry.personaId !== personaId) {
      const minutesSince = (Date.now() - new Date(lastEntry.timestamp)) / 60000;
      if (minutesSince < rules.minTimeBetweenPersonas) {
        violations.push(
          `⏱️ Only ${Math.round(minutesSince)}m since last persona switch (min: ${rules.minTimeBetweenPersonas}m)`
        );
      }
    }
  }

  // Rule 2: Daily interaction limit
  const today = new Date().toISOString().split('T')[0];
  const todayCount = log.filter(
    e => e.personaId === personaId && e.action === 'interaction' && e.timestamp.startsWith(today)
  ).length;

  if (todayCount >= rules.maxDailyInteractions) {
    violations.push(`📊 Daily limit reached (${todayCount}/${rules.maxDailyInteractions})`);
  }

  return violations;
}
```

## Common Operations

### Export Persona for Briefing

```bash
# Generate a briefing document for a specific persona
jq --arg id "PERSONA-0001" '
  .personas[] | select(.id == $id) | {
    name,
    backstory,
    accounts: [.accounts[] | {platform, username, status}],
    writingStyle,
    opsec: {vpnRegion, timezoneEmulation, activeHours}
  }
' ~/.agents/data/osint-personas.json | python3 -m json.tool
```

### Retire a Persona

```javascript
// Discord command handler: /persona retire <persona-id> <reason>
async function retirePersona(interaction) {
  const personaId = interaction.options.getString('persona-id');
  const reason = interaction.options.getString('reason');

  const personas = loadJSON(PERSONAS_PATH) || { personas: [] };
  const persona = personas.personas.find(p => p.id === personaId);
  if (!persona) return interaction.reply(`❌ Persona ${personaId} not found.`);

  persona.status = 'retired';
  persona.retiredAt = new Date().toISOString();
  persona.retireReason = reason;

  // Deactivate all accounts
  persona.accounts.forEach(a => { a.status = 'retired'; });

  // Unassign from all team members
  const assignments = loadJSON(ASSIGNMENTS_PATH) || { assignments: [] };
  assignments.assignments
    .filter(a => a.personaId === personaId && a.status === 'active')
    .forEach(a => { a.status = 'released'; a.releasedAt = new Date().toISOString(); });

  saveJSON(PERSONAS_PATH, personas);
  saveJSON(ASSIGNMENTS_PATH, assignments);
  logActivity(personaId, 'retired', interaction.user.id, { reason });

  await interaction.reply(`🔴 Persona **${persona.name}** (${personaId}) retired. All accounts deactivated, assignments released.`);
}
```

### Generate Writing Style Draft

```javascript
// Generate a content draft matching a persona's writing style
function generateStylePrompt(persona, topic) {
  const style = persona.writingStyle;
  return `Write a short social media post about "${topic}" in this voice:
- Tone: ${style.tone}
- Quirks: ${style.quirks.join(', ')}
- Vocabulary level: ${style.vocabulary}
- Emoji usage: ${style.emojiUsage}
- Sentence length: ${style.avgSentenceLength}
- Interests to reference: ${persona.backstory.interests.join(', ')}
- Occupation context: ${persona.backstory.occupation}

Keep it authentic and natural. No hashtag spam. 1-3 sentences max.`;
}
```

## Utility Functions

### JSON Helpers

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(process.env.HOME, '.agents', 'data');
const PERSONAS_PATH = path.join(DATA_DIR, 'osint-personas.json');
const ASSIGNMENTS_PATH = path.join(DATA_DIR, 'persona-assignments.json');
const LOG_PATH = path.join(DATA_DIR, 'persona-interaction-log.json');
const OPSEC_RULES_PATH = path.join(DATA_DIR, 'persona-opsec-rules.json');

function loadJSON(filepath) {
  try { return JSON.parse(fs.readFileSync(filepath, 'utf8')); }
  catch { return null; }
}

function saveJSON(filepath, data) {
  const tmp = filepath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, filepath);
}

function buildPersonaCard(persona, action) {
  return {
    title: `${statusEmoji(persona.status)} ${persona.name} — ${action}`,
    color: 0x5865F2,
    fields: [
      { name: 'ID', value: persona.id, inline: true },
      { name: 'Status', value: persona.status, inline: true },
      { name: 'Occupation', value: persona.backstory.occupation || 'Not set', inline: true },
      { name: 'Location', value: persona.backstory.location || 'Not set', inline: true },
      { name: 'Accounts', value: `${persona.accounts.length} tracked`, inline: true },
      { name: 'Tags', value: persona.tags.join(', ') || 'none', inline: true }
    ],
    timestamp: new Date().toISOString()
  };
}
```

## Troubleshooting

### Persona Data File Corruption

```bash
# Validate JSON integrity
python3 -c "import json; json.load(open('$HOME/.agents/data/osint-personas.json')); print('OK')"

# Restore from backup (if using atomic writes, .tmp shouldn't exist)
ls ~/.agents/data/osint-personas.json.tmp 2>/dev/null && echo "WARN: temp file found, last write may have failed"

# Count personas by status
jq '.personas | group_by(.status) | map({status: .[0].status, count: length})' \
  ~/.agents/data/osint-personas.json
```

### Assignment Conflicts

```bash
# Find users with multiple active persona assignments
jq '.assignments | map(select(.status == "active")) | group_by(.assigneeId) | map(select(length > 1)) | map({user: .[0].assigneeName, count: length, personas: [.[].personaId]})' \
  ~/.agents/data/persona-assignments.json
```

### Audit Log Size Management

```bash
# Count log entries
jq '.log | length' ~/.agents/data/persona-interaction-log.json

# Archive entries older than 90 days
python3 -c "
import json
from datetime import datetime, timedelta
cutoff = (datetime.now() - timedelta(days=90)).isoformat()
data = json.load(open('$HOME/.agents/data/persona-interaction-log.json'))
old = [e for e in data['log'] if e['timestamp'] < cutoff]
current = [e for e in data['log'] if e['timestamp'] >= cutoff]
json.dump({'log': old}, open('/tmp/persona-log-archive.json', 'w'), indent=2)
data['log'] = current
json.dump(data, open('$HOME/.agents/data/persona-interaction-log.json', 'w'), indent=2)
print(f'Archived {len(old)} entries, kept {len(current)}')
"
```

## Tips

- Never reuse usernames across personas — even on different platforms. Username search tools cross-reference everything.
- Keep persona backstories shallow enough to maintain but deep enough to be believable. Three hobbies and one strong opinion per persona is the sweet spot.
- The 30-minute minimum between persona switches isn't arbitrary — it matches the time needed to fully change browser profiles, VPN endpoints, and get into character.
- Store persona photos in a separate encrypted volume, never in the JSON files. Reference by hash only.
- Run consistency checks before every operation, not just weekly. Conflicts compound fast.
- Assign max 2-3 personas per operator. More than that and writing style drift becomes detectable.
- Log every interaction, even failed ones. Audit trails with gaps are worse than no audit trail.
- Retirement doesn't mean deletion. Keep retired persona profiles indefinitely — they're evidence.
- VPN region must match persona's claimed timezone. A Portland persona routing through a Singapore exit node is an immediate tell.
- Review writing style templates quarterly. People's online communication patterns evolve — static personas get stale.
