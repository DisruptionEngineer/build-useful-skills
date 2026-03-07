---
name: idea-scorer
description: Automatically score raw ideas from the backlog on Clarity, Scope, and Value axes and route them through the skill pipeline. Use when triaging new ideas in idea-backlog.json, prioritizing which ideas to refine first, filtering low-quality submissions, fast-tracking high-value ideas to #prompt-refiner, or posting scorecards to Discord's #idea-inbox channel. Communicates upstream with idea-inbox and downstream with discord-prompt-refiner.
metadata: {"clawdbot":{"emoji":"📊","requires":{"anyBins":["node","jq"]},"os":["linux","darwin","win32"]}}
---

# Idea Scorer

Watch `~/.agents/data/idea-backlog.json` for ideas with `status: "raw"`. Score each on three axes — Clarity, Scope, and Value — and post a scorecard back to `#idea-inbox`. Route ideas based on their scores: low clarity goes to `#prompt-refiner` for expansion, high scores across all axes get fast-tracked to `#prompt-refiner` with a flag.

## When to Use

- A new idea lands in `idea-backlog.json` with `status: "raw"`
- Triaging a batch of unscored ideas after a brainstorm session
- Deciding which ideas to refine first based on objective criteria
- Automatically routing low-clarity ideas to prompt refinement
- Fast-tracking high-value ideas directly to `#prompt-refiner`
- Manually overriding scores via the `override` command in Discord

## Prerequisites

### Shared Bot

This skill uses the same Discord bot configured in the idea-inbox skill.

```bash
# Bot token must be set
echo $DISCORD_BOT_TOKEN
# Or read from shared config
cat ~/.agents/config/discord-bot.json | jq -r '.token'
```

### Channel Permissions

The bot needs `SEND_MESSAGES` permission in:
- `#idea-inbox` (for posting scorecards)
- `#prompt-refiner` (for forwarding ideas)

### Backlog File

The backlog must exist and contain ideas from the idea-inbox skill.

```bash
# Verify backlog exists and has raw ideas
jq '.ideas[] | select(.status == "raw") | .id' ~/.agents/data/idea-backlog.json
```

## Scoring Axes

### Clarity (1–5)

How well-defined is the goal? Can you build it from the description alone?

| Score | Criteria | Example |
|-------|----------|---------|
| 1 | Incoherent or single word | "automation" |
| 2 | Vague intent, no specifics | "something for GitHub" |
| 3 | Clear goal, missing details | "a skill that watches PRs" |
| 4 | Goal + context, minor gaps | "watch PRs on my-repo and post summaries to Slack" |
| 5 | Fully actionable as-is | "watch PRs on org/repo, summarize diff, post to #pr-reviews with author and file list" |

### Scope (1–5)

Is this a single skill or a multi-skill project?

| Score | Criteria | Example |
|-------|----------|---------|
| 1 | Requires 5+ new skills or infrastructure | "build a full CI/CD platform" |
| 2 | Requires 3-4 skills or significant config | "multi-repo PR dashboard with analytics" |
| 3 | Requires 1-2 skills with moderate complexity | "GitHub PR watcher + Slack notifier" |
| 4 | Single skill, moderate complexity | "Slack notifier for deploy events" |
| 5 | Single skill, straightforward | "format JSON files in a directory" |

### Value (1–5)

How frequently would this skill be triggered?

| Score | Criteria | Example |
|-------|----------|---------|
| 1 | Once ever, or extremely niche | "migrate from Mercurial to Git once" |
| 2 | A few times a year | "annual license audit" |
| 3 | Monthly or on specific events | "quarterly dependency update" |
| 4 | Weekly or on common triggers | "weekly changelog generation" |
| 5 | Daily or on every commit/PR/deploy | "auto-lint on every push" |

## Scoring Logic

### Step 1: Watch for Raw Ideas

Poll the backlog file for ideas with `status: "raw"`.

```javascript
const fs = require('fs');
const path = require('path');

const BACKLOG_PATH = path.join(process.env.HOME, '.agents', 'data', 'idea-backlog.json');

function loadJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return null; }
}

function getRawIdeas() {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  return backlog.ideas.filter(idea => idea.status === 'raw');
}

// Poll every 30 seconds
setInterval(async () => {
  const rawIdeas = getRawIdeas();
  for (const idea of rawIdeas) {
    await scoreIdea(idea);
  }
}, 30_000);
```

### Step 2: Evaluate Each Axis

Use the LLM to score the raw text against each axis. Provide the rubric in the prompt so scores are consistent.

```javascript
async function evaluateIdea(rawText) {
  const prompt = `Score this idea on three axes. Return ONLY valid JSON.

Idea: "${rawText}"

Axes:
- clarity (1-5): How well-defined is the goal? 1=incoherent, 5=fully actionable
- scope (1-5): How contained is it? 1=massive multi-skill project, 5=single simple skill
- value (1-5): How frequently would it trigger? 1=once ever, 5=daily

Return: {"clarity": N, "scope": N, "value": N, "clarity_reason": "...", "scope_reason": "...", "value_reason": "..."}`;

  const result = await llm.complete(prompt);
  return JSON.parse(result);
}
```

### Step 3: Update the Backlog

Write scores back to the idea entry and update its status.

```javascript
function updateIdeaScores(ideaId, scores) {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  const idea = backlog.ideas.find(i => i.id === ideaId);
  if (!idea) throw new Error(`Idea ${ideaId} not found`);

  idea.scores = scores;
  idea.status = 'scored';

  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));
  return idea;
}
```

```bash
# Shell equivalent: update idea status and scores
jq --arg id "$IDEA_ID" \
   --argjson scores "$SCORES_JSON" \
   '(.ideas[] | select(.id == $id)) |= . + {
     status: "scored",
     scores: $scores
   }' ~/.agents/data/idea-backlog.json > /tmp/backlog-tmp.json \
   && mv /tmp/backlog-tmp.json ~/.agents/data/idea-backlog.json
```

### Step 4: Post Scorecard to #idea-inbox

Format the scores as a readable Discord embed.

```javascript
async function postScorecard(channel, idea, scores) {
  const total = scores.clarity + scores.scope + scores.value;
  const bar = (n) => '█'.repeat(n) + '░'.repeat(5 - n);

  const embed = {
    title: `Scorecard — ${idea.id}`,
    description: idea.raw_text.substring(0, 200),
    fields: [
      {
        name: `Clarity [${bar(scores.clarity)}] ${scores.clarity}/5`,
        value: scores.clarity_reason,
        inline: false
      },
      {
        name: `Scope   [${bar(scores.scope)}] ${scores.scope}/5`,
        value: scores.scope_reason,
        inline: false
      },
      {
        name: `Value   [${bar(scores.value)}] ${scores.value}/5`,
        value: scores.value_reason,
        inline: false
      },
      {
        name: 'Total',
        value: `**${total}/15**`,
        inline: true
      },
      {
        name: 'Routing',
        value: getRoutingDecision(scores),
        inline: true
      }
    ],
    color: total >= 12 ? 0x00ff00 : total >= 8 ? 0xffaa00 : 0xff0000,
    timestamp: new Date().toISOString()
  };

  await channel.send({ embeds: [embed] });
}
```

### Step 5: Route Based on Scores

Apply routing rules to determine the idea's next destination.

```javascript
function getRoutingDecision(scores) {
  const { clarity, scope, value } = scores;

  // Low clarity → needs refinement regardless of other scores
  if (clarity <= 2) {
    return '→ #prompt-refiner (low clarity, needs expansion)';
  }

  // High across all axes → fast-track
  if (clarity >= 4 && scope >= 4 && value >= 4) {
    return '→ #prompt-refiner (FAST-TRACK)';
  }

  // Decent scores → standard refinement
  if (clarity >= 3) {
    return '→ #prompt-refiner (standard path)';
  }

  // Low overall → park for review
  return 'Parked — needs manual review';
}
```

## Forwarding to #prompt-refiner

Send the idea to the refinement channel with context and flags.

```javascript
async function forwardToRefiner(client, idea, scores) {
  const refinerChannel = client.channels.cache.find(
    c => c.name === 'prompt-refiner'
  );
  if (!refinerChannel) {
    console.error('[idea-scorer] #prompt-refiner channel not found');
    return;
  }

  const isFastTrack = scores.clarity >= 4 && scores.scope >= 4 && scores.value >= 4;

  const message =
    `**Incoming Idea — ${idea.id}**\n` +
    (isFastTrack ? '**FAST-TRACK**\n' : '') +
    `**Author:** ${idea.author}\n` +
    `**Scores:** Clarity=${scores.clarity} Scope=${scores.scope} Value=${scores.value}\n` +
    `**Raw Text:**\n> ${idea.raw_text}\n` +
    `\n[SYSTEM] REFINE_IDEA ${idea.id}` +
    (isFastTrack ? ' FAST_TRACK' : '');

  await refinerChannel.send(message);

  // Update status in backlog
  updateIdeaStatus(idea.id, 'refining');
}

function updateIdeaStatus(ideaId, newStatus) {
  const backlog = loadJSON(BACKLOG_PATH) || { ideas: [] };
  const idea = backlog.ideas.find(i => i.id === ideaId);
  if (idea) idea.status = newStatus;
  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2));
}
```

```bash
# Update status to refining after forwarding
jq --arg id "$IDEA_ID" \
   '(.ideas[] | select(.id == $id)).status = "refining"' \
   ~/.agents/data/idea-backlog.json > /tmp/backlog-tmp.json \
   && mv /tmp/backlog-tmp.json ~/.agents/data/idea-backlog.json
```

## Batch Scoring

Score all unscored ideas at once from the command line:

```bash
# List all raw ideas and score them
jq -r '.ideas[] | select(.status == "raw") | .id' ~/.agents/data/idea-backlog.json | \
  while read -r id; do
    echo "Scoring $id..."
  done
```

## Score Adjustment

Allow authorized users to manually override scores by replying in `#idea-inbox`:

```javascript
client.on('messageCreate', async (message) => {
  if (message.channel.name !== 'idea-inbox') return;
  if (!isAuthorizedUser(message.author.id)) return;

  const overrideMatch = message.content.match(
    /^override\s+(IDEA-\d{4})\s+clarity=(\d)\s+scope=(\d)\s+value=(\d)/i
  );
  if (!overrideMatch) return;

  const [, ideaId, clarity, scope, value] = overrideMatch;
  const scores = {
    clarity: parseInt(clarity),
    scope: parseInt(scope),
    value: parseInt(value),
    clarity_reason: 'Manual override',
    scope_reason: 'Manual override',
    value_reason: 'Manual override'
  };

  updateIdeaScores(ideaId, scores);
  await message.reply(`Scores overridden for **${ideaId}**.`);
});
```

Override format in Discord:

```
override IDEA-0003 clarity=4 scope=5 value=3
```

## Troubleshooting

### Scores seem inconsistent

```bash
# Review all scored ideas to calibrate
jq '.ideas[] | select(.scores != null) | {id, raw: .raw_text[:80], scores}' \
  ~/.agents/data/idea-backlog.json
```

Ensure the scoring prompt includes the full rubric. Without the rubric, LLM scores drift across invocations.

### Ideas stuck in "raw" status

```bash
# Check if the scorer is running / manually trigger for a specific idea
jq '.ideas[] | select(.id == "IDEA-0005")' ~/.agents/data/idea-backlog.json
```

### #prompt-refiner channel not found

```bash
# List all channels the bot can see
node -e "
const { Client, GatewayIntentBits } = require('discord.js');
const c = new Client({ intents: [GatewayIntentBits.Guilds] });
c.once('ready', () => {
  c.channels.cache.forEach(ch => console.log(ch.name, ch.id));
  c.destroy();
});
c.login(process.env.DISCORD_BOT_TOKEN);
"
```

## Tips

- The scoring rubric in the LLM prompt is the single most important thing to get right. Without concrete examples at each level, scores will be inconsistent.
- Fast-track threshold (4/4/4) is deliberately high. Most ideas should go through standard refinement — fast-track is for ideas that are already near-complete specs.
- Always post the scorecard to `#idea-inbox` even for low-scoring ideas. Transparency in scoring builds trust and lets users improve their submissions.
- The `override` command lets authorized users correct bad LLM scores. Log overrides so you can tune the rubric later.
- Poll the backlog file rather than relying on inter-process messages. File-based state is debuggable, survives restarts, and avoids race conditions with message queues.
- Score reasons are short text fields. Keep them under 100 characters — they appear in Discord embeds which have field length limits.
- Color-code embeds: green (12+/15), amber (8-11/15), red (below 8/15). Visual cues help users scan scorecards quickly.
- If the LLM returns invalid JSON for scores, retry once. If it fails again, set all scores to 0 and flag the idea for manual review.
- The `[SYSTEM] REFINE_IDEA` message tag is what discord-prompt-refiner listens for. Do not change this format without updating the downstream skill.
