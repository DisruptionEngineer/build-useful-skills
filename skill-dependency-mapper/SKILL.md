---
name: skill-dependency-mapper
description: Scan the skills directory and map dependencies, conflicts, and reuse opportunities between new and existing skills. Use when a new skill is created by discord-skill-factory, auditing the skill registry for overlap, detecting near-duplicate skills by description similarity, identifying shared tool and data file dependencies, or posting conflict and reuse reports to Discord's #skill-registry channel. Communicates upstream with discord-skill-factory via [SYSTEM] NEW_SKILL messages.
metadata: {"clawdbot":{"emoji":"🗺️","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Skill Dependency Mapper

After any new skill is created, scan `~/.agents/skills/` and compare the new skill's tools, APIs, and workflows against all existing skills. Flag potential reuse opportunities or conflicts and post a summary to `#skill-registry`. If a near-duplicate skill exists, warn before proceeding.

## When to Use

- A new skill has just been created by discord-skill-factory (triggered via `[SYSTEM] NEW_SKILL`)
- Auditing the entire skill registry for overlap and redundancy
- Checking whether a proposed skill duplicates existing functionality
- Identifying shared dependencies (CLI tools, APIs, data files) across skills
- Generating a conflict/reuse report for the `#skill-registry` channel
- Running a periodic full audit of all installed skills

## Prerequisites

### Shared Bot

Same Discord bot as the rest of the pipeline.

```bash
echo $DISCORD_BOT_TOKEN
```

### Channel Setup

The bot needs `READ_MESSAGES` and `SEND_MESSAGES` in `#skill-registry`.

### Skills Directory

```bash
# List all installed skills
ls ~/.agents/skills/
```

## Dependency Extraction

### Step 1: Listen for New Skill Notifications

```javascript
const fs = require('fs');
const path = require('path');

const SKILLS_DIR = path.join(process.env.HOME, '.agents', 'skills');

client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'skill-registry') return;

  const systemMatch = message.content.match(
    /\[SYSTEM\] NEW_SKILL (\S+) (IDEA-\d{4})/
  );

  if (systemMatch) {
    const slug = systemMatch[1];
    const ideaId = systemMatch[2];
    await analyzeNewSkill(message.channel, slug, ideaId);
  }
});
```

### Step 2: Parse SKILL.md for Dependencies

Read the new skill's SKILL.md and extract tools, APIs, channels, and data files it references.

```javascript
function extractDependencies(skillMdContent) {
  const deps = {
    bins: [],       // CLI tools required
    apis: [],       // External APIs referenced
    channels: [],   // Discord channels used
    dataFiles: [],  // Local data files read/written
    skills: [],     // Other skills referenced
    intents: []     // Discord intents needed
  };

  // Extract bins from metadata
  const metaMatch = skillMdContent.match(/metadata:\s*({.*})/);
  if (metaMatch) {
    try {
      const meta = JSON.parse(metaMatch[1]);
      deps.bins = meta?.clawdbot?.requires?.anyBins || [];
    } catch (e) { /* ignore parse errors */ }
  }

  // Extract Discord channels (#channel-name patterns)
  const channelMatches = skillMdContent.match(/#[a-z][a-z0-9-]+/g) || [];
  deps.channels = [...new Set(
    channelMatches
      .map(c => c.replace('#', ''))
      .filter(c => !['idea', 'prompt', 'skill'].includes(c))
  )];

  // Extract data file paths
  const fileMatches = skillMdContent.match(
    /~\/\.agents\/(?:data|config)\/[a-z0-9-]+\.json/g
  ) || [];
  deps.dataFiles = [...new Set(fileMatches)];

  // Extract references to other skills
  const skillRefMatches = skillMdContent.match(
    /(?:skill-writer|idea-inbox|idea-scorer|prompt-refiner|skill-factory|dependency-mapper|skill-digest|[a-z]+-[a-z]+)\s+skill/gi
  ) || [];
  deps.skills = [...new Set(
    skillRefMatches.map(s => s.replace(/\s+skill$/i, '').toLowerCase())
  )];

  // Extract API/service references
  const apiPatterns = [
    /discord\.js/gi, /slack api/gi, /github api/gi,
    /openai/gi, /anthropic/gi, /webhook/gi
  ];
  for (const pattern of apiPatterns) {
    const matches = skillMdContent.match(pattern);
    if (matches) deps.apis.push(matches[0].toLowerCase());
  }
  deps.apis = [...new Set(deps.apis)];

  return deps;
}
```

### Step 3: Scan All Existing Skills

Build a dependency map of every installed skill.

```javascript
function scanAllSkills() {
  const skills = {};
  const dirs = fs.readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  for (const dir of dirs) {
    const skillPath = path.join(SKILLS_DIR, dir, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;

    const content = fs.readFileSync(skillPath, 'utf8');
    skills[dir] = {
      slug: dir,
      deps: extractDependencies(content),
      description: extractDescription(content),
      lineCount: content.split('\n').length
    };
  }

  return skills;
}

function extractDescription(content) {
  const match = content.match(/^description:\s*(.+)$/m);
  return match ? match[1].trim() : '';
}
```

```bash
# Quick scan from the command line
for dir in ~/.agents/skills/*/; do
  skill=$(basename "$dir")
  if [ -f "$dir/SKILL.md" ]; then
    bins=$(grep -o '"anyBins":\[[^]]*\]' "$dir/SKILL.md" 2>/dev/null || echo "none")
    echo "$skill: $bins"
  fi
done
```

### Step 4: Compare Against Existing Skills

```javascript
function compareSkills(newSlug, newDeps, allSkills) {
  const report = {
    conflicts: [],
    reuse_opportunities: [],
    near_duplicates: [],
    shared_deps: []
  };

  for (const [slug, skill] of Object.entries(allSkills)) {
    if (slug === newSlug) continue;
    const existingDeps = skill.deps;

    // Shared data files (potential conflict — concurrent writes)
    const sharedFiles = newDeps.dataFiles.filter(
      f => existingDeps.dataFiles.includes(f)
    );
    if (sharedFiles.length > 0) {
      report.conflicts.push({
        skill: slug,
        type: 'shared_data_file',
        detail: `Both read/write: ${sharedFiles.join(', ')}`,
        severity: 'warning'
      });
    }

    // Shared channels (coordination needed)
    const sharedChannels = newDeps.channels.filter(
      c => existingDeps.channels.includes(c)
    );
    if (sharedChannels.length > 0) {
      report.shared_deps.push({
        skill: slug,
        type: 'shared_channel',
        detail: `Both use: #${sharedChannels.join(', #')}`
      });
    }

    // Shared bins (reuse opportunity)
    const sharedBins = newDeps.bins.filter(
      b => existingDeps.bins.includes(b)
    );
    if (sharedBins.length > 0) {
      report.reuse_opportunities.push({
        skill: slug,
        type: 'shared_tools',
        detail: `Shared tools: ${sharedBins.join(', ')}`
      });
    }

    // Near-duplicate (high description similarity)
    const similarity = computeSimilarity(
      skill.description, allSkills[newSlug]?.description || ''
    );
    if (similarity > 0.7) {
      report.near_duplicates.push({
        skill: slug,
        similarity: Math.round(similarity * 100),
        description: skill.description
      });
    }
  }

  return report;
}
```

### Step 5: Compute Description Similarity

```javascript
function computeSimilarity(desc1, desc2) {
  if (!desc1 || !desc2) return 0;

  const tokenize = (s) => new Set(
    s.toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );

  const set1 = tokenize(desc1);
  const set2 = tokenize(desc2);
  const intersection = [...set1].filter(w => set2.has(w));
  const union = new Set([...set1, ...set2]);

  return union.size > 0 ? intersection.length / union.size : 0;
}
```

## Posting the Report

### Standard Report

```javascript
async function postReport(channel, newSlug, ideaId, report, totalSkills) {
  const sections = [];

  if (report.near_duplicates.length > 0) {
    sections.push({
      name: 'Near-Duplicate Skills',
      value: report.near_duplicates
        .map(d => `**${d.skill}** (${d.similarity}% similar)\n> ${d.description}`)
        .join('\n'),
      inline: false
    });
  }

  if (report.conflicts.length > 0) {
    sections.push({
      name: 'Potential Conflicts',
      value: report.conflicts
        .map(c => `**${c.skill}** — ${c.detail}`)
        .join('\n'),
      inline: false
    });
  }

  if (report.reuse_opportunities.length > 0) {
    sections.push({
      name: 'Reuse Opportunities',
      value: report.reuse_opportunities
        .map(r => `**${r.skill}** — ${r.detail}`)
        .join('\n'),
      inline: false
    });
  }

  if (report.shared_deps.length > 0) {
    sections.push({
      name: 'Shared Dependencies',
      value: report.shared_deps
        .map(s => `**${s.skill}** — ${s.detail}`)
        .join('\n'),
      inline: false
    });
  }

  if (sections.length === 0) {
    sections.push({
      name: 'No Issues Found',
      value: 'This skill has no overlaps or conflicts with existing skills.',
      inline: false
    });
  }

  const color = report.near_duplicates.length > 0
    ? 0xff0000
    : report.conflicts.length > 0
      ? 0xffaa00
      : 0x00ff00;

  const embed = {
    title: `Dependency Report — ${newSlug} (${ideaId})`,
    fields: sections,
    color,
    footer: { text: `Scanned ${totalSkills} skills in ~/.agents/skills/` },
    timestamp: new Date().toISOString()
  };

  await channel.send({ embeds: [embed] });
}
```

### Near-Duplicate Warning

When a near-duplicate is found, post a prominent warning.

```javascript
async function warnDuplicate(channel, newSlug, duplicateSlug, similarity) {
  await channel.send(
    `**DUPLICATE WARNING**\n` +
    `\`${newSlug}\` is **${similarity}% similar** to existing skill \`${duplicateSlug}\`.\n\n` +
    `Options:\n` +
    `1. **Merge** — combine into the existing skill\n` +
    `2. **Differentiate** — adjust the new skill's scope\n` +
    `3. **Replace** — delete the old skill and keep the new one\n` +
    `4. **Proceed** — keep both (reply \`proceed\`)\n\n` +
    `Reply with your choice or \`proceed\` to keep both.`
  );
}
```

## Full Skill Registry Audit

Run a complete audit across all skills, not just triggered by new additions.

```bash
# Generate a full dependency matrix
node -e "
const fs = require('fs');
const path = require('path');
const dir = path.join(process.env.HOME, '.agents', 'skills');

const skills = fs.readdirSync(dir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

console.log('Skill Registry Audit');
console.log('====================');
console.log('Total skills:', skills.length);

for (const skill of skills) {
  const mdPath = path.join(dir, skill, 'SKILL.md');
  if (fs.existsSync(mdPath)) {
    const content = fs.readFileSync(mdPath, 'utf8');
    const lines = content.split('\n').length;
    console.log('  ' + skill + ': ' + lines + ' lines');
  }
}
"
```

```bash
# Find skills sharing the same data files
for dir in ~/.agents/skills/*/; do
  skill=$(basename "$dir")
  if [ -f "$dir/SKILL.md" ]; then
    files=$(grep -o '~/\.agents/data/[a-z0-9-]*\.json' "$dir/SKILL.md" 2>/dev/null)
    if [ -n "$files" ]; then
      echo "$skill: $files"
    fi
  fi
done | sort -t: -k2
```

## Data Flow

```
  ~/.agents/skills/*
         |
    [scan all SKILL.md files]
         |
    [extract dependencies per skill]
         |
    [compare new vs existing]
         |
    ┌────┴────────────────┐
    │                     │
  conflicts          reuse opportunities
  duplicates         shared dependencies
    │                     │
    └────┬────────────────┘
         |
    [post report to #skill-registry]
```

## Troubleshooting

### False Duplicate Warnings

The Jaccard similarity threshold of 0.7 may trigger on skills that share vocabulary but differ in purpose.

```javascript
// Raise the threshold for fewer false positives
const SIMILARITY_THRESHOLD = 0.75;

// Or add a whitelist of known non-duplicates
const knownPairs = [
  ['idea-inbox', 'idea-scorer'],  // related but distinct
];
```

### Missing Dependencies in Extraction

The regex-based extraction may miss dependencies expressed in unusual formats.

```bash
# Manual check: search for tool references in a skill
grep -iE 'require|import|exec|spawn|child_process' ~/.agents/skills/my-skill/SKILL.md
```

### Large Skill Directory Slows Scanning

```javascript
// Cache the scan results and invalidate on filesystem change
const chokidar = require('chokidar');
let cachedSkills = null;

chokidar.watch(SKILLS_DIR, { depth: 1 }).on('change', () => {
  cachedSkills = null;
});

function getCachedSkills() {
  if (!cachedSkills) cachedSkills = scanAllSkills();
  return cachedSkills;
}
```

## Tips

- Run the full audit periodically (weekly via weekly-skill-digest), not just on new skill creation. Skills evolve through manual edits that can introduce new overlaps.
- The Jaccard similarity on descriptions is a rough heuristic. For production use, consider embedding-based semantic similarity for more accurate duplicate detection.
- Shared data files are the most dangerous conflict type. Two skills writing to the same JSON file can corrupt each other's data. Flag these as high-severity.
- Shared channels are usually fine — multiple skills listening on the same channel is by design in this pipeline. Only flag if two skills would respond to the same `[SYSTEM]` trigger pattern.
- Keep the dependency extraction regexes simple and add new patterns as you encounter them. Over-engineering the parser upfront wastes time on patterns you'll never see.
- The registry audit output makes a great input for weekly-skill-digest. Export the report as JSON for easy consumption.
- When a near-duplicate is found, suggest merging rather than deleting. The newer version may have improvements worth folding into the existing skill.
- Log all dependency reports to `~/.agents/data/dependency-reports.json` for historical tracking and trend analysis.
